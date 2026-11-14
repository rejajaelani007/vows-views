import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import {
  checkOwner,
  accountQuota,
  isSuper,
  onlySuper,
  projectFor,
  managementRoutes,
  qrSelect,
  slug,
  readEvent,
  sendImage,
  overview,
} from './projects.js';
import QRCode from 'qrcode';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { resolve, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { transaction, expireSessions, allocatedSessions, serializeQr } from './db.js';
import { createStorage } from './storage.js';
import { DatabaseRateLimitStore } from './rate-limit.js';
import {
  token,
  hashToken,
  id,
  hoursFromNow,
  cookieOptions,
  verifyPassword,
  hashPassword,
  fail,
  HttpError,
} from './security.js';

const qrInput = z
  .object({
    label: z.string().trim().min(1).max(100),
    total_limit: z.number().int().min(1).nullable(),
    per_session_limit: z.number().int().min(1),
    active: z.boolean().default(true),
  })
  .refine((v) => v.total_limit === null || v.per_session_limit <= v.total_limit, {
    message: 'Kuota per sesi tidak boleh melebihi kuota total.',
  });
const loginInput = z
  .object({
    email: z.string().trim().min(1).max(254).optional(),
    username: z.string().trim().min(1).max(64).optional(),
    password: z.string().min(1).max(128),
  })
  .refine((v) => Boolean(v.email || v.username), 'Masukkan username atau email.');
const dateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
    { message: 'Tanggal tidak valid.' },
  );
const eventInput = z.object({
  partner_one: z.string().trim().min(1).max(50),
  partner_two: z.string().trim().min(1).max(50),
  wedding_date: dateInput.or(z.literal('')),
  venue: z.string().trim().max(160),
  welcome_message: z.string().trim().min(1).max(500),
});
const listInput = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(60).default(24),
    qr: z.string().max(64).optional(),
    search: z.string().max(100).optional(),
    from: dateInput.optional(),
    to: dateInput.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'Tanggal akhir tidak boleh sebelum tanggal awal.',
  });
const uuidInput = z.string().uuid();
const messageInput = z.string().trim().max(500, 'Pesan maksimal 500 karakter.').default('');
const makeUpload = (maxUploadBytes) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadBytes, files: 1, fields: 1, parts: 2, fieldSize: 2048 },
    fileFilter: (_, file, cb) =>
      cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
  }).single('photo');
const dummyPasswordHash = hashPassword('unused-constant-for-timing-comparison');
const photoResult = (p, media = '/media') => ({
  id: p.id,
  url: `${media}/${p.id}`,
  thumbnail: `${media}/${p.id}/thumb`,
  created_at: p.created_at,
  width: p.width,
  height: p.height,
  message: p.message || '',
});

export async function createApp({
  db,
  dataDir,
  publicUrl = 'http://localhost:5173',
  production = false,
  trustProxy = false,
  disableRateLimit = false,
  storage: suppliedStorage,
  serveFrontend = true,
  maxUploadBytes = process.env.VERCEL === '1' ? 4 * 1024 * 1024 : 12 * 1024 * 1024,
}) {
  const storage = suppliedStorage || (await createStorage({ dataDir }));
  const upload = makeUpload(maxUploadBytes);
  const maxUploadMB = Math.floor(maxUploadBytes / 1024 / 1024);
  if (storage.recover) {
    const rows = await db
      .prepare('SELECT storage_name,thumb_name FROM photos WHERE deleted_at IS NULL')
      .all();
    await storage.recover(new Set(rows.flatMap((p) => [p.storage_name, p.thumb_name])));
  }
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          imgSrc: [
            "'self'",
            'blob:',
            'data:',
            'https://images.unsplash.com',
            'https://*.public.blob.vercel-storage.com',
          ],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '20kb' }));
  app.use('/api', (_, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  let limiterNumber = 0;
  const limiter = (limit, minutes) =>
    disableRateLimit
      ? (_, __, next) => next()
      : rateLimit({
          windowMs: minutes * 60000,
          limit,
          standardHeaders: 'draft-7',
          legacyHeaders: false,
          store: db.remote
            ? new DatabaseRateLimitStore(db, `limiter-${limiterNumber++}`)
            : undefined,
          message: {
            message: 'Terlalu banyak permintaan. Silakan coba lagi sebentar.',
            code: 'RATE_LIMITED',
          },
        });
  app.use('/api', limiter(6000, 5));
  app.use('/api', (req, _, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.get('Origin') !== new URL(publicUrl).origin
    )
      return next(new HttpError(403, 'Origin permintaan tidak diizinkan.', 'ORIGIN_INVALID'));
    next();
  });
  const qrByCode = async (code) => await db.prepare(`${qrSelect} WHERE q.code=?`).get(code);
  const qrById = async (qrId) => await db.prepare(`${qrSelect} WHERE q.id=?`).get(qrId);
  const requireQr = async (code) => {
    const qr = await qrByCode(code);
    if (!qr || qr.deleted_at)
      fail(404, 'QR Code tidak ditemukan. Pastikan tautan yang dipindai benar.', 'QR_NOT_FOUND');
    return qr;
  };
  const ensureActive = (qr) => {
    if (!qr.active || !qr.owner_active)
      fail(403, 'QR Code ini sedang dinonaktifkan oleh penyelenggara.', 'QR_DISABLED');
  };
  const adminAuth = async (req, _, next) => {
    const raw = req.cookies.admin_session;
    const session =
      raw &&
      (await db
        .prepare(
          'SELECT s.*,a.email,a.username,a.role,a.id AS user_id FROM admin_sessions s JOIN admins a ON a.id=s.admin_id WHERE a.active=1 AND token_hash=? AND expires_at>?',
        )
        .get(hashToken(raw), new Date().toISOString()));
    if (!session)
      return next(new HttpError(401, 'Silakan masuk sebagai admin.', 'UNAUTHENTICATED'));
    req.admin = session;
    if (!['GET', 'HEAD'].includes(req.method) && req.get('X-CSRF-Token') !== session.csrf)
      return next(
        new HttpError(403, 'Sesi keamanan tidak valid. Muat ulang halaman.', 'CSRF_INVALID'),
      );
    next();
  };
  async function guestSession(req, qr, csrf = true) {
    const raw = req.cookies[`guest_${qr.id}`];
    const session =
      raw &&
      (await db
        .prepare('SELECT * FROM guest_sessions WHERE token_hash=? AND qr_id=?')
        .get(hashToken(raw), qr.id));
    if (!session || session.expires_at <= new Date().toISOString())
      fail(401, 'Sesi foto telah berakhir. Buka ulang tautan QR.', 'SESSION_EXPIRED');
    if (csrf && req.get('X-CSRF-Token') !== session.csrf)
      fail(403, 'Token keamanan sesi tidak valid.', 'CSRF_INVALID');
    return session;
  }
  const sessionResult = (session, qr) => ({
    id: session.id,
    csrf: session.csrf,
    photo_count: session.photo_count,
    photo_limit: session.photo_limit,
    remaining: Math.min(
      session.photo_limit - session.photo_count,
      qr.total_limit === null ? Infinity : qr.total_limit - qr.used_count,
    ),
    expires_at: session.expires_at,
    label: qr.label,
  });

  app.get('/api/health', async (_, res) => {
    await db.prepare('SELECT id FROM settings WHERE id=1').get();
    res.json({ ok: true });
  });
  app.get('/api/event', async (_, res) => res.json(await readEvent(db, 'legacy', '/api/event')));
  app.get('/api/event/images/:slot', async (req, res) =>
    sendImage(db, 'legacy', req.params.slot, res),
  );
  app.get('/api/auth', async (req, res) => {
    const raw = req.cookies.admin_session;
    const session =
      raw &&
      (await db
        .prepare(
          'SELECT s.csrf,a.email,a.username,a.role,a.id AS user_id FROM admin_sessions s JOIN admins a ON a.id=s.admin_id WHERE a.active=1 AND token_hash=? AND expires_at>?',
        )
        .get(hashToken(raw), new Date().toISOString()));
    if (session) return res.json({ authenticated: true, ...session });
    const csrf = token();
    res.cookie('login_csrf', csrf, cookieOptions(production, 3600000));
    res.json({
      authenticated: false,
      csrf,
      setup_required: !(await db.prepare('SELECT id FROM admins LIMIT 1').get()),
    });
  });
  app.post('/api/auth/login', limiter(10, 15), async (req, res) => {
    if (!req.cookies.login_csrf || req.get('X-CSRF-Token') !== req.cookies.login_csrf)
      fail(403, 'Muat ulang halaman login lalu coba kembali.', 'CSRF_INVALID');
    const input = loginInput.parse(req.body);
    const identifier = (input.username ?? input.email).toLowerCase();
    const admin = await db
      .prepare('SELECT * FROM admins WHERE active=1 AND (email=? OR username=?)')
      .get(identifier, identifier);
    const valid = await verifyPassword(input.password, admin?.password_hash || dummyPasswordHash);
    if (!admin || !valid) fail(401, 'Email atau password tidak sesuai.', 'INVALID_CREDENTIALS');
    const raw = token(),
      csrf = token();
    await db
      .prepare('DELETE FROM admin_sessions WHERE expires_at<=?')
      .run(new Date().toISOString());
    const issued = await db
      .prepare(
        'INSERT INTO admin_sessions(token_hash,admin_id,csrf,expires_at) SELECT ?,id,?,? FROM admins WHERE id=? AND active=1 AND password_hash=?',
      )
      .run(hashToken(raw), csrf, hoursFromNow(12), admin.id, admin.password_hash);
    if (!issued.changes) fail(401, 'Akun telah berubah. Silakan login kembali.');
    res.clearCookie('login_csrf', cookieOptions(production));
    res.cookie('admin_session', raw, cookieOptions(production, 12 * 3600000));
    res.json({
      authenticated: true,
      csrf,
      email: admin.email,
      username: admin.username,
      role: admin.role,
      user_id: admin.id,
    });
  });
  app.post('/api/auth/logout', adminAuth, async (req, res) => {
    await db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(req.admin.token_hash);
    res.clearCookie('admin_session', cookieOptions(production));
    res.json({ ok: true });
  });

  const invite = '/api/invites/:username/:code';
  const inviteBase = (qr) => `/api/invites/${qr.username}/${qr.code}`;
  const guestMedia = (qr) => (qr.project_id === 'legacy' ? '/media' : inviteBase(qr) + '/media');
  app.use(invite, async (req, _, next) => {
    const qr = await requireQr(req.params.code);
    if (qr.username !== req.params.username) fail(404, 'Undangan tidak ditemukan.');
    ensureActive(qr);
    req.qr = qr;
    next();
  });
  app.get(invite + '/event', async (req, res) =>
    res.json(await readEvent(db, req.qr.project_id, inviteBase(req.qr))),
  );
  app.get(invite + '/images/:slot', async (req, res) =>
    sendImage(db, req.qr.project_id, req.params.slot, res),
  );
  app.get(invite + '/photos', async (req, res) =>
    res.json(
      await listPhotos(req.query, {
        project: req.qr.project_id,
        media: inviteBase(req.qr) + '/media',
      }),
    ),
  );
  app.get('/api/qr/:code', async (req, res) => {
    const qr = await requireQr(req.params.code);
    ensureActive(qr);
    const existing = req.cookies[`guest_${qr.id}`];
    const session =
      existing &&
      (await db
        .prepare('SELECT * FROM guest_sessions WHERE token_hash=? AND qr_id=? AND expires_at>?')
        .get(hashToken(existing), qr.id, new Date().toISOString()));
    res.json({
      path: `/${qr.username}/${qr.code}`,
      session: session ? sessionResult(session, qr) : null,
      label: qr.label,
      remaining: qr.total_limit === null ? null : qr.total_limit - qr.used_count,
      per_session_limit: qr.per_session_limit,
    });
  });
  app.post('/api/guest/:code/session', limiter(1200, 60), async (req, res) => {
    const result = await transaction(db, async () => {
      await expireSessions(db);
      const qr = await requireQr(req.params.code);
      ensureActive(qr);
      const existing = req.cookies[`guest_${qr.id}`];
      const session =
        existing &&
        (await db
          .prepare('SELECT * FROM guest_sessions WHERE token_hash=? AND qr_id=? AND expires_at>?')
          .get(hashToken(existing), qr.id, new Date().toISOString()));
      if (session) return { session, qr };
      if (qr.total_limit !== null && qr.used_count >= qr.total_limit)
        fail(409, 'Kuota foto untuk QR Code ini telah habis.', 'QUOTA_EXHAUSTED');
      if (
        qr.total_limit !== null &&
        (await allocatedSessions(db, qr.id)) >= Math.floor(qr.total_limit / qr.per_session_limit)
      )
        fail(409, 'Seluruh slot sesi untuk QR Code ini sudah teralokasi.', 'SESSIONS_EXHAUSTED');
      const raw = token(),
        sid = id(),
        csrf = token();
      await db
        .prepare(
          'INSERT INTO guest_sessions(id,qr_id,token_hash,csrf,photo_limit,expires_at) VALUES(?,?,?,?,?,?)',
        )
        .run(sid, qr.id, hashToken(raw), csrf, qr.per_session_limit, hoursFromNow(24));
      return {
        session: await db.prepare('SELECT * FROM guest_sessions WHERE id=?').get(sid),
        qr,
        raw,
      };
    });
    if (result.raw)
      res.cookie(`guest_${result.qr.id}`, result.raw, cookieOptions(production, 24 * 3600000));
    res.json(sessionResult(result.session, result.qr));
  });

  let concurrentUploads = 0;
  const uploadCapacity = (_, res, next) => {
    if (concurrentUploads >= 4)
      return next(
        new HttpError(
          503,
          'Photo booth sedang menyimpan beberapa foto. Coba lagi sebentar.',
          'UPLOAD_BUSY',
        ),
      );
    concurrentUploads++;
    let released = false;
    const release = () => {
      if (!released) {
        concurrentUploads--;
        released = true;
      }
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
  app.post(
    '/api/guest/:code/photos',
    limiter(1200, 60),
    async (req, _, next) => {
      try {
        const qr = await requireQr(req.params.code);
        ensureActive(qr);
        await guestSession(req, qr);
        uuidInput.parse(req.get('Idempotency-Key'));
        next();
      } catch (error) {
        next(error);
      }
    },
    uploadCapacity,
    upload,
    async (req, res) => {
      const qr = await requireQr(req.params.code),
        session = await guestSession(req, qr);
      const requestKey = req.get('Idempotency-Key');
      const previous = await db
        .prepare('SELECT * FROM photos WHERE session_id=? AND request_key=?')
        .get(session.id, requestKey);
      if (previous)
        return res.json({
          photo: photoResult(previous, guestMedia(qr)),
          session: sessionResult(session, qr),
          replayed: true,
        });
      const message = messageInput.parse(req.body?.message);
      if (!req.file)
        fail(400, `Pilih foto JPEG, PNG, atau WebP (maksimal ${maxUploadMB} MB).`, 'INVALID_IMAGE');
      let encoded, thumb;
      try {
        const image = sharp(req.file.buffer, {
          limitInputPixels: 50000000,
          animated: false,
          failOn: 'warning',
        });
        const meta = await image.metadata();
        const mimeFormats = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
        if (
          meta.format !== mimeFormats[req.file.mimetype] ||
          (meta.pages || 1) > 1 ||
          !meta.width ||
          !meta.height ||
          meta.width < 100 ||
          meta.height < 100
        )
          fail(
            400,
            'File harus foto statis yang valid, minimal 100 × 100 piksel.',
            'INVALID_IMAGE',
          );
        encoded = await image
          .rotate()
          .resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 92, mozjpeg: true })
          .toBuffer({ resolveWithObject: true });
        thumb = await sharp(encoded.data)
          .resize({ width: 640, height: 800, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer();
      } catch (error) {
        if (error instanceof HttpError) throw error;
        fail(
          400,
          'Foto tidak dapat dibaca. Coba foto JPEG, PNG, atau WebP yang lain.',
          'INVALID_IMAGE',
        );
      }
      const photoId = id();
      const objectId = id();
      let storageName = `${objectId}.jpg`,
        thumbName = `${objectId}-thumb.jpg`;
      let keepFiles = false;
      let result;
      try {
        storageName = await storage.write(storageName, encoded.data);
        thumbName = await storage.write(thumbName, thumb);
        result = await transaction(db, async () => {
          const latestQr = await requireQr(req.params.code);
          ensureActive(latestQr);
          const latestSession = await guestSession(req, latestQr);
          const duplicate = await db
            .prepare('SELECT * FROM photos WHERE session_id=? AND request_key=?')
            .get(latestSession.id, requestKey);
          if (duplicate)
            return {
              photo: photoResult(duplicate, guestMedia(latestQr)),
              session: sessionResult(latestSession, latestQr),
              replayed: true,
            };
          if (
            latestSession.status !== 'active' ||
            latestSession.photo_count >= latestSession.photo_limit
          )
            fail(409, 'Kuota foto untuk sesi Anda telah habis.', 'SESSION_QUOTA_EXHAUSTED');
          if (latestQr.total_limit !== null && latestQr.used_count >= latestQr.total_limit)
            fail(409, 'Kuota foto QR Code telah mencapai batas.', 'QUOTA_EXHAUSTED');
          await db
            .prepare(
              'INSERT INTO photos(id,qr_id,session_id,storage_name,thumb_name,original_filename,file_size,width,height,request_key,message) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            )
            .run(
              photoId,
              qr.id,
              session.id,
              storageName,
              thumbName,
              basename(req.file.originalname).slice(0, 255),
              encoded.data.length,
              encoded.info.width,
              encoded.info.height,
              requestKey,
              message,
            );
          await db
            .prepare('UPDATE qr_codes SET used_count=used_count+1,updated_at=? WHERE id=?')
            .run(new Date().toISOString(), qr.id);
          await db
            .prepare(
              "UPDATE guest_sessions SET photo_count=photo_count+1,status=CASE WHEN photo_count+1>=photo_limit THEN 'completed' ELSE 'active' END WHERE id=?",
            )
            .run(session.id);
          return {
            photo: photoResult(
              await db.prepare('SELECT * FROM photos WHERE id=?').get(photoId),
              guestMedia(latestQr),
            ),
            session: sessionResult(
              await db.prepare('SELECT * FROM guest_sessions WHERE id=?').get(session.id),
              await qrById(qr.id),
            ),
            replayed: false,
          };
        });
        keepFiles = !result.replayed;
      } catch (error) {
        // A lost COMMIT response may still mean success. Preserve the objects;
        // retrying the same idempotency key will reconcile the database result.
        if (error.commitUncertain) keepFiles = true;
        throw error;
      } finally {
        if (!keepFiles)
          await Promise.all([
            storage.remove(storageName).catch(() => {}),
            storage.remove(thumbName).catch(() => {}),
          ]);
      }
      // Finish cleanup before ending the response: a serverless instance may
      // stop executing as soon as the response has been sent.
      res.status(result.replayed ? 200 : 201).json(result);
    },
  );

  async function listPhotos(query, { admin, project, media = '/media' } = {}) {
    const input = listInput.parse(query),
      conditions = ['p.deleted_at IS NULL'],
      params = [];
    if (project) {
      conditions.push('q.project_id=?');
      params.push(project);
    }
    if (admin && !isSuper(admin)) {
      conditions.push('q.project_id IN (SELECT id FROM projects WHERE owner_id=?)');
      params.push(admin.admin_id);
    }
    if (admin && input.qr) {
      conditions.push('p.qr_id=?');
      params.push(input.qr);
    }
    if (admin && input.search) {
      conditions.push('(p.original_filename LIKE ? OR q.label LIKE ? OR p.id LIKE ?)');
      params.push(...Array(3).fill(`%${input.search}%`));
    }
    if (admin && input.from) {
      conditions.push('p.created_at>=?');
      params.push(`${input.from}T00:00:00+07:00`);
      params[params.length - 1] = new Date(params.at(-1)).toISOString();
    }
    if (admin && input.to) {
      conditions.push('p.created_at<?');
      params.push(
        new Date(new Date(`${input.to}T00:00:00+07:00`).getTime() + 86400000).toISOString(),
      );
    }
    const where = conditions.join(' AND '),
      total = (
        await db
          .prepare(
            `SELECT COUNT(*) count FROM photos p JOIN qr_codes q ON q.id=p.qr_id WHERE ${where}`,
          )
          .get(...params)
      ).count;
    const photos = await db
      .prepare(
        `SELECT p.*,q.label AS qr_label FROM photos p JOIN qr_codes q ON q.id=p.qr_id WHERE ${where} ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, input.limit, (input.page - 1) * input.limit);
    return {
      photos: photos.map((p) =>
        admin
          ? {
              ...photoResult(p, media),
              qr_label: p.qr_label,
              qr_id: p.qr_id,
              session_id: p.session_id,
              original_filename: p.original_filename,
              file_size: p.file_size,
            }
          : photoResult(p, media),
      ),
      total,
      page: input.page,
      pages: Math.ceil(total / input.limit),
    };
  }
  app.get('/api/photos', async (req, res) =>
    res.json(await listPhotos(req.query, { project: 'legacy' })),
  );
  async function mediaResponse(req, res, project, admin) {
    const photo = await db
      .prepare(
        `SELECT p.*,q.project_id,pr.owner_id FROM photos p JOIN qr_codes q ON q.id=p.qr_id JOIN projects pr ON pr.id=q.project_id WHERE p.id=? AND p.deleted_at IS NULL`,
      )
      .get(req.params.id);
    if (!photo || (project && project !== photo.project_id)) fail(404, 'Foto tidak ditemukan.');
    if (admin) checkOwner(admin, photo);
    res.set({
      'Cache-Control': 'private, no-store',
      'Content-Type': 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
    });
    const name = req.path.endsWith('/thumb') ? photo.thumb_name : photo.storage_name;
    if (photo.project_id !== 'legacy' && storage.sendScoped)
      return storage.sendScoped(res, name, req.query.download === '1');
    return storage.send(res, name, req.query.download === '1');
  }
  const mediaRoutes = (base) => [base + '/:id', base + '/:id/thumb'];
  app.get(mediaRoutes('/media'), (req, res) => mediaResponse(req, res, 'legacy'));
  app.get(mediaRoutes(invite + '/media'), (req, res) => mediaResponse(req, res, req.qr.project_id));
  app.use('/api/admin', adminAuth);
  managementRoutes(app, db, eventInput);
  app.get(mediaRoutes('/api/admin/media'), (req, res) => mediaResponse(req, res, null, req.admin));
  app.get('/api/admin/overview', async (req, res) => res.json(await overview(db, req.admin)));
  app.get('/api/admin/quota', async (req, res) => {
    const defaults = await db
      .prepare('SELECT default_total,default_per FROM settings WHERE id=1')
      .get();
    res.json({ ...(await accountQuota(db, req.admin.admin_id)), ...defaults });
  });
  app.get('/api/admin/qrs', async (req, res) => {
    await expireSessions(db);
    const rows = await db
      .prepare(
        `${qrSelect} WHERE (q.deleted_at IS NULL OR ?) AND (? OR p.owner_id=?)
         ORDER BY (q.deleted_at IS NOT NULL),q.created_at DESC`,
      )
      .all(
        Number(req.query.include_archived === '1'),
        Number(isSuper(req.admin)),
        req.admin.admin_id,
      );
    res.json(await Promise.all(rows.map((q) => serializeQr(db, q, publicUrl))));
  });
  async function validateAllocation(creatorId, total, previous = 0) {
    const balance = await accountQuota(db, creatorId);
    if (balance.total === null) return;
    if (total === null) fail(403, 'QR tanpa batas hanya tersedia untuk QR milik Admin Utama.');
    if (total - previous > balance.available)
      fail(
        409,
        `Kuota foto tidak mencukupi. Maksimal alokasi untuk QR ini ${balance.available + previous} foto.`,
        'ACCOUNT_QUOTA_EXCEEDED',
      );
  }
  app.post('/api/admin/qrs', async (req, res) => {
    const qr = await db.transaction(async () => {
      const pr = await projectFor(db, req.admin, req.body.project_id ?? 'legacy');
      const defaults = await db
        .prepare(
          'SELECT default_total AS total_limit,default_per AS per_session_limit FROM settings WHERE id=1',
        )
        .get();
      const v = qrInput.parse({ ...defaults, ...req.body }),
        qrId = id();
      await validateAllocation(req.admin.admin_id, v.total_limit);
      const code = req.body.code
        ? slug.parse(req.body.code)
        : randomBytes(24).toString('base64url');
      if (await qrByCode(code)) fail(409, 'Kode QR sudah digunakan. Pilih kode lain.');
      await db
        .prepare(
          'INSERT INTO qr_codes(id,project_id,label,code,total_limit,per_session_limit,active,created_by) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          qrId,
          pr.id,
          v.label,
          code,
          v.total_limit,
          v.per_session_limit,
          Number(v.active),
          req.admin.admin_id,
        );
      return serializeQr(db, await qrById(qrId), publicUrl);
    });
    // Preserve the response URL for integrations predating project selection.
    if (req.body.project_id === undefined && qr.legacy_url) qr.url = qr.legacy_url;
    res.status(201).json(qr);
  });
  app.use('/api/admin/qrs/:id', async (req, _, next) => {
    const qr = checkOwner(req.admin, await qrById(req.params.id));
    if (qr.deleted_at && !(req.method === 'GET' && req.path === '/usage'))
      fail(404, 'QR Code tidak ditemukan.');
    if (req.method !== 'GET' && !isSuper(req.admin) && qr.created_by !== req.admin.admin_id)
      fail(403, 'Hanya pembuat QR atau Admin Utama yang dapat mengubah QR ini.');
    next();
  });
  app.put('/api/admin/qrs/:id', async (req, res) => {
    const qr = await transaction(db, async () => {
      await expireSessions(db);
      const old = await qrById(req.params.id);
      checkOwner(req.admin, old);
      if (old.deleted_at) fail(404, 'QR Code tidak ditemukan.');
      const input = qrInput.parse({ ...old, active: Boolean(old.active), ...req.body });
      await validateAllocation(old.created_by, input.total_limit, old.total_limit);
      const hasHistory = await db
        .prepare('SELECT id FROM guest_sessions WHERE qr_id=? LIMIT 1')
        .get(old.id);
      if (hasHistory && input.per_session_limit !== old.per_session_limit)
        fail(
          409,
          'Kuota per sesi tidak dapat diubah setelah QR memiliki riwayat sesi. Buat QR baru.',
        );
      if (
        input.total_limit !== null &&
        input.total_limit <
          Math.max(old.used_count, (await allocatedSessions(db, old.id)) * input.per_session_limit)
      )
        fail(409, 'Kuota total harus tetap menampung foto dan slot sesi yang sudah dialokasikan.');
      await db
        .prepare(
          'UPDATE qr_codes SET label=?,total_limit=?,per_session_limit=?,active=?,updated_at=? WHERE id=?',
        )
        .run(
          input.label,
          input.total_limit,
          input.per_session_limit,
          Number(input.active),
          new Date().toISOString(),
          old.id,
        );
      return await serializeQr(db, await qrById(old.id), publicUrl);
    });
    res.json(qr);
  });
  app.delete('/api/admin/qrs/:id', async (req, res) => {
    await transaction(db, async () => {
      const old = checkOwner(req.admin, await qrById(req.params.id));
      if (old.deleted_at) fail(404, 'QR Code tidak ditemukan.');
      if (
        await db.prepare('SELECT id FROM guest_sessions WHERE qr_id=? LIMIT 1').get(req.params.id)
      )
        await db
          .prepare('UPDATE qr_codes SET active=0,deleted_at=?,updated_at=? WHERE id=?')
          .run(new Date().toISOString(), new Date().toISOString(), old.id);
      else await db.prepare('DELETE FROM qr_codes WHERE id=?').run(old.id);
    });
    res.json({ ok: true });
  });
  app.get('/api/admin/qrs/:id/png', async (req, res) => {
    const qr = await qrById(req.params.id);
    if (!qr) fail(404, 'QR Code tidak ditemukan.');
    const png = await QRCode.toBuffer(`${publicUrl}/${qr.username}/${qr.code}`, {
      width: 1200,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#382f2c', light: '#ffffff' },
    });
    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `inline; filename="wedding-qr-${qr.id}.png"`,
    });
    res.send(png);
  });
  app.get('/api/admin/qrs/:id/usage', async (req, res) => {
    await expireSessions(db);
    const qr = await qrById(req.params.id);
    if (!qr) fail(404, 'QR Code tidak ditemukan.');
    const page = z.coerce.number().int().min(1).default(1).parse(req.query.page);
    const total = (
      await db.prepare('SELECT COUNT(*) count FROM guest_sessions WHERE qr_id=?').get(qr.id)
    ).count;
    const sessions = await db
      .prepare(
        'SELECT id,photo_count,photo_limit,status,created_at,expires_at FROM guest_sessions WHERE qr_id=? ORDER BY created_at DESC LIMIT 20 OFFSET ?',
      )
      .all(qr.id, (page - 1) * 20);
    res.json({
      qr: await serializeQr(db, qr, publicUrl),
      sessions,
      total,
      page,
      pages: Math.ceil(total / 20),
    });
  });
  app.get('/api/admin/photos', async (req, res) =>
    res.json(await listPhotos(req.query, { admin: req.admin, media: '/api/admin/media' })),
  );
  app.use('/api/admin/photos/:id', async (req, _, next) => {
    checkOwner(
      req.admin,
      await db
        .prepare(
          'SELECT pr.owner_id FROM photos p JOIN qr_codes q ON q.id=p.qr_id JOIN projects pr ON pr.id=q.project_id WHERE p.id=?',
        )
        .get(req.params.id),
    );
    next();
  });
  app.put('/api/admin/photos/:id', async (req, res) => {
    const message = messageInput.parse(req.body.message);
    const rotate = z
      .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
      .default(0)
      .parse(req.body.rotate);
    if (rotate) {
      const old = await db
        .prepare('SELECT * FROM photos WHERE id=? AND deleted_at IS NULL')
        .get(req.params.id);
      if (!old) fail(404, 'Foto tidak ditemukan.');
      const encoded = await sharp(await storage.read(old.storage_name))
        .rotate(rotate)
        .jpeg({ quality: 94 })
        .toBuffer({ resolveWithObject: true });
      const thumb = await sharp(encoded.data)
        .resize({ width: 640, height: 800, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      const key = id(),
        written = [];
      try {
        written.push(await storage.write(key + '.jpg', encoded.data));
        written.push(await storage.write(key + '-thumb.jpg', thumb));
        const update = await db.transaction(() =>
          db
            .prepare(
              'UPDATE photos SET message=?,storage_name=?,thumb_name=?,width=?,height=?,file_size=? WHERE id=? AND storage_name=? AND deleted_at IS NULL',
            )
            .run(
              message,
              ...written,
              encoded.info.width,
              encoded.info.height,
              encoded.data.length,
              old.id,
              old.storage_name,
            ),
        );
        if (!update.changes) fail(409, 'Foto telah berubah. Muat ulang galeri.');
      } catch (error) {
        if (!error.commitUncertain)
          await Promise.allSettled(written.map((name) => storage.remove(name)));
        throw error;
      }
      await Promise.allSettled(
        [old.storage_name, old.thumb_name].map((name) => storage.remove(name)),
      );
      return res.json({ message });
    }
    const result = await db
      .prepare('UPDATE photos SET message=? WHERE id=? AND deleted_at IS NULL')
      .run(message, req.params.id);
    if (!result.changes) fail(404, 'Foto tidak ditemukan.');
    res.json({ message });
  });
  app.delete('/api/admin/photos/:id', async (req, res) => {
    const photo = await db.prepare('SELECT * FROM photos WHERE id=?').get(req.params.id);
    if (!photo) fail(404, 'Foto tidak ditemukan.');
    if (!photo.deleted_at)
      await db
        .prepare('UPDATE photos SET deleted_at=? WHERE id=?')
        .run(new Date().toISOString(), photo.id);
    await Promise.all([
      storage.remove(photo.storage_name).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      }),
      storage.remove(photo.thumb_name).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      }),
    ]);
    res.json({ ok: true });
  });
  app.put('/api/admin/event', onlySuper, async (req, res) => {
    const v = eventInput.parse(req.body);
    await db
      .prepare(
        'UPDATE settings SET partner_one=?,partner_two=?,wedding_date=?,venue=?,welcome_message=? WHERE id=1',
      )
      .run(v.partner_one, v.partner_two, v.wedding_date, v.venue, v.welcome_message);
    res.json(await db.prepare('SELECT * FROM settings WHERE id=1').get());
  });
  app.use('/api', (_, __, next) => next(new HttpError(404, 'Endpoint tidak ditemukan.')));
  const dist = resolve('dist');
  if (serveFrontend && existsSync(resolve(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false }));
    app.get('/{*path}', (_, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  app.use((error, _, res, __) => {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        message: error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(' '),
        code: 'VALIDATION_ERROR',
      });
    if (
      error instanceof multer.MulterError &&
      error.code === 'LIMIT_FIELD_VALUE' &&
      error.field === 'message'
    )
      return res
        .status(400)
        .json({ message: 'Pesan maksimal 500 karakter.', code: 'VALIDATION_ERROR' });
    if (error instanceof multer.MulterError)
      return res.status(400).json({
        message: `Upload tidak valid. Gunakan satu foto berukuran maksimal ${maxUploadMB} MB.`,
        code: 'UPLOAD_INVALID',
      });
    if (error instanceof HttpError)
      return res.status(error.status).json({ message: error.message, code: error.code });
    if (error.type === 'entity.too.large')
      return res.status(413).json({ message: 'Data terlalu besar.', code: 'TOO_LARGE' });
    if (error.type === 'entity.parse.failed')
      return res.status(400).json({ message: 'Format data tidak valid.', code: 'INVALID_JSON' });
    if (error.status === 404)
      return res.status(404).json({ message: 'File tidak ditemukan.', code: 'FILE_NOT_FOUND' });
    console.error('Request failed:', error.code || error.name);
    res
      .status(500)
      .json({ message: 'Terjadi kesalahan pada server. Coba kembali.', code: 'SERVER_ERROR' });
  });
  return app;
}
