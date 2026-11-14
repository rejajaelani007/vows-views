import { z } from 'zod';
import { readFileSync } from 'node:fs';
import multer from 'multer';
import sharp from 'sharp';
import { fail, id, hashPassword } from './security.js';

export const filterNames = JSON.parse(
  readFileSync(new URL('./filter-presets.json', import.meta.url), 'utf8'),
)
  .filter((p) => p.name !== 'Original')
  .map((p) => p.name);
const catalog = JSON.parse(readFileSync(new URL('./wedding-themes.json', import.meta.url), 'utf8'));
const hex = z.string().regex(/^#[a-fA-F0-9]{6}$/);
const appearance = z
  .object({
    preset: z.enum(['original', ...catalog.map((t) => t.id)]),
    background: hex,
    font: z.enum(['classic', 'modern', 'book', 'retro']),
    ornament: z.enum(['signature', 'floral', 'none']),
    scale: z.number().int().min(75).max(115),
    button: z.enum(['soft', 'pill', 'square']),
    buttonLabel: z.string().trim().min(1).max(32),
  })
  .strict();
const original = {
  preset: 'original',
  background: '#fbf8f3',
  font: 'classic',
  ornament: 'signature',
  scale: 100,
  button: 'soft',
  buttonLabel: 'Take your photo',
};
const slots = ['hero', 'background', 'banner', 'decoration', 'logo', 'couple'];
const slotType = z.enum(slots);
export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Gunakan huruf kecil, angka, atau tanda hubung.');
const username = slug.refine(
  (v) => !['admin', 'api', 'media', 'camera', 'gallery', 'assets'].includes(v),
  'Nama ini digunakan oleh sistem.',
);
const projectName = z.string().trim().min(1).max(100);
const password = z.string().min(12).max(128);
const account = z.object({
  username,
  email: z.email().max(254),
  active: z.boolean().default(true),
});
export const isSuper = (admin) => admin.role === 'super';
export function onlySuper(req, res, next) {
  if (!isSuper(req.admin)) fail(403, 'Hanya Admin Utama yang dapat melakukan tindakan ini.');
  next();
}
export const qrSelect = `SELECT q.*,p.owner_id,p.name AS project_name,a.username,a.active AS owner_active
  FROM qr_codes q JOIN projects p ON p.id=q.project_id JOIN admins a ON a.id=p.owner_id`;
export function checkOwner(admin, row) {
  if (!row || (!isSuper(admin) && row.owner_id !== admin.admin_id))
    fail(404, 'Data tidak ditemukan.');
  return row;
}
export async function projectFor(db, admin, projectId) {
  return checkOwner(admin, await db.prepare('SELECT * FROM projects WHERE id=?').get(projectId));
}
export async function readEvent(db, projectId, base) {
  const project = await db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  const legacy = await db
    .prepare(
      'SELECT partner_one,partner_two,venue,wedding_date,welcome_message FROM settings WHERE id=1',
    )
    .get();
  const defaults =
    projectId === 'legacy'
      ? legacy
      : {
          partner_one: 'Pengantin',
          partner_two: 'Pasangan',
          venue: '',
          wedding_date: '',
          welcome_message: 'Selamat datang di hari bahagia kami.',
        };
  const images = await db
    .prepare('SELECT slot FROM project_images WHERE project_id=?')
    .all(projectId);
  return {
    ...defaults,
    title: 'The wedding of',
    theme: '#9c5363',
    position: 'left',
    appearance: original,
    ...JSON.parse(project?.event_json || '{}'),
    filters: JSON.parse(project?.filters_json || 'null') ?? filterNames,
    images: Object.fromEntries(
      images.map(({ slot }) => [slot, `${base}/images/${slot}?v=${project.revision}`]),
    ),
    revision: project?.revision ?? 0,
  };
}
export async function sendImage(db, projectId, slot, res) {
  const row = await db
    .prepare('SELECT jpeg FROM project_images WHERE project_id=? AND slot=?')
    .get(projectId, slotType.parse(slot));
  if (!row) fail(404, 'Gambar tidak ditemukan.');
  res.type('jpeg').send(Buffer.from(row.jpeg));
}
export function managementRoutes(app, db, eventInput) {
  const users = '/api/admin/users',
    projects = '/api/admin/projects';
  app.use(users, onlySuper);
  app.get(users, async (_, res) =>
    res.json(
      await db.prepare('SELECT id,email,username,role,active FROM admins ORDER BY username').all(),
    ),
  );
  async function unique(account, except = '') {
    if (
      await db
        .prepare('SELECT id FROM admins WHERE id<>? AND (email=? OR username=?)')
        .get(except, account.email, account.username)
    )
      fail(409, 'Username atau email sudah digunakan.');
  }
  app.post(users, async (req, res) => {
    const v = account.extend({ password }).strict().parse(req.body),
      userId = id();
    const hash = hashPassword(v.password);
    await db.transaction(async () => {
      await unique(v);
      await db
        .prepare(
          "INSERT INTO admins(id,username,email,password_hash,role,active) VALUES(?,?,?,?,'project',?)",
        )
        .run(userId, v.username, v.email, hash, Number(v.active));
    });
    res.status(201).json({ id: userId });
  });
  app.put(users + '/:id', async (req, res) => {
    const v = account.extend({ password: password.optional() }).strict().parse(req.body);
    const hash = v.password && hashPassword(v.password);
    await db.transaction(async () => {
      const original = await db.prepare('SELECT * FROM admins WHERE id=?').get(req.params.id);
      if (!original) fail(404, 'Akun tidak ditemukan.');
      if (!v.active && original.id === req.admin.admin_id)
        fail(409, 'Akun yang sedang Anda gunakan harus tetap aktif.');
      await unique(v, original.id);
      await db
        .prepare('UPDATE admins SET username=?,email=?,password_hash=?,active=? WHERE id=?')
        .run(v.username, v.email, hash || original.password_hash, Number(v.active), original.id);
      if (hash || !v.active)
        await db.prepare('DELETE FROM admin_sessions WHERE admin_id=?').run(original.id);
    });
    res.json({ ok: true });
  });
  app.use('/api/admin/system', onlySuper);
  app.get('/api/admin/system', async (_, res) =>
    res.json(await db.prepare('SELECT default_total,default_per FROM settings WHERE id=1').get()),
  );
  app.put('/api/admin/system', async (req, res) => {
    const limit = z.number().int().min(1).max(1000000);
    const v = z
      .object({ default_total: limit, default_per: limit })
      .refine((v) => v.default_total >= v.default_per)
      .parse(req.body);
    await db
      .prepare('UPDATE settings SET default_total=?,default_per=? WHERE id=1')
      .run(v.default_total, v.default_per);
    res.json(v);
  });
  app.get(projects, async (req, res) => {
    res.json(
      await db
        .prepare(
          `SELECT p.id,p.name,p.owner_id,a.username,
      (SELECT COUNT(*) FROM qr_codes WHERE project_id=p.id) qr_count,
      (SELECT SUM(used_count) FROM qr_codes WHERE project_id=p.id) photo_count,
      (SELECT q.code FROM qr_codes q WHERE q.project_id=p.id AND q.active=1 AND a.active=1 ORDER BY q.created_at LIMIT 1) code
      FROM projects p JOIN admins a ON a.id=p.owner_id WHERE ? OR p.owner_id=? ORDER BY p.name,p.id`,
        )
        .all(Number(isSuper(req.admin)), req.admin.admin_id),
    );
  });
  app.post(projects, async (req, res) => {
    const v = z
      .object({ name: projectName, owner_id: z.string().optional() })
      .strict()
      .parse(req.body);
    const owner = v.owner_id ?? req.admin.admin_id;
    if (!isSuper(req.admin) && owner !== req.admin.admin_id)
      fail(403, 'Pemilik project tidak valid.');
    if (!(await db.prepare('SELECT id FROM admins WHERE id=? AND active=1').get(owner)))
      fail(400, 'Pilih pemilik yang aktif.');
    const projectId = id();
    await db
      .prepare('INSERT INTO projects(id,owner_id,name) VALUES(?,?,?)')
      .run(projectId, owner, v.name);
    res.status(201).json({ id: projectId });
  });
  app.use(projects + '/:projectId', async (req, _, next) => {
    req.project = await projectFor(db, req.admin, req.params.projectId);
    next();
  });
  app.put(projects + '/:projectId', async (req, res) => {
    const v = z.object({ name: projectName }).strict().parse(req.body);
    await db.prepare('UPDATE projects SET name=? WHERE id=?').run(v.name, req.project.id);
    res.json({ ok: true });
  });
  app.delete(projects + '/:projectId', async (req, res) => {
    await db.transaction(async () => {
      if (
        req.project.id === 'legacy' ||
        (await db.prepare('SELECT id FROM qr_codes WHERE project_id=? LIMIT 1').get(req.project.id))
      )
        fail(409, 'Project bawaan atau project yang masih memiliki QR harus dipertahankan.');
      await db.prepare('DELETE FROM projects WHERE id=?').run(req.project.id);
    });
    res.json({ ok: true });
  });
  const root = projects + '/:projectId';
  app.get(root + '/event', async (req, res) =>
    res.json(await readEvent(db, req.project.id, `/api/admin/projects/${req.project.id}`)),
  );
  app.get(root + '/images/:slot', async (req, res) =>
    sendImage(db, req.project.id, req.params.slot, res),
  );
  app.put(root + '/filters', async (req, res) => {
    const filters = z
      .array(z.enum(filterNames))
      .max(10)
      .refine((v) => new Set(v).size === v.length)
      .parse(req.body.filters);
    await db
      .prepare('UPDATE projects SET filters_json=? WHERE id=?')
      .run(JSON.stringify(filters), req.project.id);
    res.json({ filters });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 6, fields: 1, parts: 8, fileSize: 700000, fieldSize: 8000 },
  }).fields(slots.map((name) => ({ name, maxCount: 1 })));
  const landing = eventInput.extend({
    title: projectName,
    theme: hex,
    appearance: appearance.optional(),
    position: z.enum(['left', 'center', 'right']),
    revision: z.number().int().nonnegative(),
    remove: z.array(slotType).default([]),
  });
  app.put(root + '/event', upload, async (req, res) => {
    let input;
    try {
      input = JSON.parse(req.body.settings);
    } catch {
      fail(400, 'Pengaturan tampilan tidak valid.');
    }
    const { revision, remove, ...v } = landing.parse(input);
    const images = [];
    for (const [slot, files] of Object.entries(req.files || {})) {
      try {
        const image = sharp(files[0].buffer, { limitInputPixels: 16000000 });
        const meta = await image.metadata();
        if (!['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages || 1) > 1) throw Error();
        // Keep individual rows below libSQL limits.
        const jpeg = await image
          .rotate()
          .resize({ width: 1600, height: 1200, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        if (jpeg.length > 900000) throw Error();
        images.push([slot, jpeg]);
      } catch {
        fail(400, 'Gunakan gambar JPEG, PNG, atau WebP yang valid.');
      }
    }
    await db.transaction(async () => {
      const result = await db
        .prepare('UPDATE projects SET event_json=?,revision=revision+1 WHERE id=? AND revision=?')
        .run(
          JSON.stringify(
            req.project.id === 'legacy'
              ? {
                  title: v.title,
                  theme: v.theme,
                  position: v.position,
                  appearance: v.appearance ?? JSON.parse(req.project.event_json).appearance,
                }
              : { ...v, appearance: v.appearance ?? JSON.parse(req.project.event_json).appearance },
          ),
          req.project.id,
          revision,
        );
      if (!result.changes) fail(409, 'Tampilan telah berubah. Muat ulang sebelum menyimpan.');
      if (req.project.id === 'legacy')
        await db
          .prepare(
            'UPDATE settings SET partner_one=?,partner_two=?,wedding_date=?,venue=?,welcome_message=? WHERE id=1',
          )
          .run(v.partner_one, v.partner_two, v.wedding_date, v.venue, v.welcome_message);
      for (const slot of remove)
        await db
          .prepare('DELETE FROM project_images WHERE project_id=? AND slot=?')
          .run(req.project.id, slot);
      for (const [slot, jpeg] of images)
        await db
          .prepare('INSERT OR REPLACE INTO project_images(project_id,slot,jpeg) VALUES(?,?,?)')
          .run(req.project.id, slot, jpeg);
    });
    res.json(await readEvent(db, req.project.id, `/api/admin/projects/${req.project.id}`));
  });
}

export async function overview(db, admin) {
  const args = [Number(isSuper(admin)), admin.admin_id];
  const visible = 'SELECT id FROM projects WHERE ? OR owner_id=?';
  const scopedQr = `SELECT id FROM qr_codes WHERE project_id IN (${visible})`;
  const qr = await db
    .prepare(
      `SELECT COUNT(*) total_qr, COALESCE(SUM(active),0) active_qr,COALESCE(SUM(total_limit),0) total_quota,COALESCE(SUM(used_count),0) used_quota FROM qr_codes WHERE project_id IN (${visible})`,
    )
    .get(...args);
  const photo = await db
    .prepare(
      `SELECT COUNT(*) uploaded,COUNT(CASE WHEN deleted_at IS NULL THEN 1 END) published FROM photos WHERE qr_id IN (${scopedQr})`,
    )
    .get(...args);
  const { count: sessions } = await db
    .prepare(`SELECT COUNT(*) count FROM guest_sessions WHERE qr_id IN (${scopedQr})`)
    .get(...args);
  const days = await db
    .prepare(
      `SELECT date(created_at,'+7 hours') day,COUNT(*) count FROM photos WHERE qr_id IN (${scopedQr}) AND created_at>=? GROUP BY day ORDER BY day`,
    )
    .all(...args, new Date(Date.now() - 14 * 86400000).toISOString());
  const projects = await db
    .prepare(
      `SELECT p.name,p.id,coalesce(sum(q.used_count),0) total FROM projects p LEFT JOIN qr_codes q ON q.project_id=p.id WHERE p.id IN (${visible}) GROUP BY p.id ORDER BY p.name`,
    )
    .all(...args);
  const recent = await db
    .prepare(
      `SELECT p.id,p.created_at,q.label,pr.name FROM photos p JOIN qr_codes q ON q.id=p.qr_id JOIN projects pr ON pr.id=q.project_id WHERE pr.id IN (${visible}) ORDER BY p.created_at DESC LIMIT 8`,
    )
    .all(...args);
  const users = isSuper(admin)
    ? (await db.prepare('SELECT COUNT(*) count FROM admins').get()).count
    : undefined;
  return {
    ...qr,
    ...photo,
    sessions,
    days,
    projects,
    recent,
    users,
    remaining_quota: qr.total_quota - qr.used_quota,
  };
}
