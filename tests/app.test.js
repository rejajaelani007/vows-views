import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { openDatabase, databaseAdapter } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createAdmin } from '../server/security.js';
import { migrateDatabase } from '../server/migrations.js';

const origin = 'http://localhost:5173';
let db, app, directory, admin, csrf, image;
const password = 'test-only-password-2026!';
async function fixtureDatabase() {
  if (process.env.WEDDING_TEST_LIBSQL !== '1')
    return openDatabase(directory, { url: '', serverless: false });
  const { createClient } = await import('@libsql/client');
  const { pathToFileURL } = await import('node:url');
  const client = createClient({ url: pathToFileURL(join(directory, 'wedding.sqlite')).href });
  const database = databaseAdapter(client, true);
  const schema = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
  await database.exec(schema.replace(/^PRAGMA .*;\r?\n/gm, ''));
  await migrateDatabase(database);
  return database;
}
beforeEach(async () => {
  directory = await mkdtemp(join(process.env.WEDDING_TEST_ROOT || tmpdir(), 'wedding-test-'));
  db = await fixtureDatabase();
  await createAdmin(db, 'test@example.com', password);
  app = await createApp({ db, dataDir: directory, publicUrl: origin, disableRateLimit: true });
  image = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#e5b5b1' } })
    .jpeg()
    .toBuffer();
  admin = request.agent(app);
  const auth = await admin.get('/api/auth');
  const login = await admin
    .post('/api/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', auth.body.csrf)
    .send({ email: 'test@example.com', password });
  assert.equal(login.status, 200);
  csrf = login.body.csrf;
});
afterEach(async () => {
  db.close();
  // Native libSQL on Windows retains file mappings until process exit. Its
  // parent test owns and removes the entire fixture directory after that exit.
  if (process.env.WEDDING_TEST_LIBSQL !== '1')
    await rm(directory, { recursive: true, force: true });
});

async function createQr(total = 6, per = 3, label = 'Wedding booth') {
  const response = await admin
    .post('/api/admin/qrs')
    .set('Origin', origin)
    .set('X-CSRF-Token', csrf)
    .send({ label, total_limit: total, per_session_limit: per, active: true });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}
async function startGuest(qr) {
  const agent = request.agent(app);
  const response = await agent.post(`/api/guest/${qr.code}/session`).set('Origin', origin);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return { agent, session: response.body };
}
async function upload(
  qr,
  guest,
  key = randomUUID(),
  buffer = image,
  filename = 'photo.jpg',
  type = 'image/jpeg',
  message,
) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const submission = guest.agent
      .post(`/api/guest/${qr.code}/photos`)
      .set('Origin', origin)
      .set('X-CSRF-Token', guest.session.csrf)
      .set('Idempotency-Key', key);
    if (message !== undefined) submission.field('message', message);
    const response = await submission.attach('photo', buffer, { filename, contentType: type });
    if (response.status !== 503 || attempt === 29) return response;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
async function counter(qr) {
  return (await db.prepare('SELECT used_count FROM qr_codes WHERE id=?').get(qr.id)).used_count;
}

test('messages persist with the photo, preserve line breaks, and keep the original on retry', async () => {
  const qr = await createQr(),
    guest = await startGuest(qr),
    key = randomUUID();
  const message = 'Selamat menempuh hidup baru! 💕\nBahagia selalu bersama.';
  const saved = await upload(qr, guest, key, image, 'photo.jpg', 'image/jpeg', `  ${message}  `);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.photo.message, message);
  assert.equal((await request(app).get('/api/photos')).body.photos[0].message, message);
  assert.equal((await admin.get('/api/admin/photos')).body.photos[0].message, message);
  const replay = await upload(qr, guest, key, image, 'photo.jpg', 'image/jpeg', 'Pesan berubah');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.photo.message, message);
  assert.equal(await counter(qr), 1);
  assert.equal(
    (await db.prepare('SELECT message FROM photos WHERE id=?').get(saved.body.photo.id)).message,
    message,
  );
});

test('messages are optional and reject overlong input without consuming quota or storage', async () => {
  const qr = await createQr(),
    guest = await startGuest(qr);
  const invalid = await upload(
    qr,
    guest,
    randomUUID(),
    image,
    'photo.jpg',
    'image/jpeg',
    'a'.repeat(501),
  );
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, 'VALIDATION_ERROR');
  const oversizedField = await upload(
    qr,
    guest,
    randomUUID(),
    image,
    'photo.jpg',
    'image/jpeg',
    'a'.repeat(3000),
  );
  assert.equal(oversizedField.status, 400);
  assert.equal(oversizedField.body.code, 'VALIDATION_ERROR');
  assert.match(oversizedField.body.message, /Pesan maksimal 500/);
  assert.equal(await counter(qr), 0);
  assert.equal((await readdir(join(directory, 'photos'))).length, 0);
  const boundary = await upload(
    qr,
    guest,
    randomUUID(),
    image,
    'photo.jpg',
    'image/jpeg',
    'a'.repeat(500),
  );
  assert.equal(boundary.status, 201);
  assert.equal(boundary.body.photo.message.length, 500);
  const blank = await upload(qr, guest, randomUUID(), image, 'photo.jpg', 'image/jpeg', '   \n ');
  assert.equal(blank.status, 201);
  assert.equal(blank.body.photo.message, '');
  const omitted = await upload(qr, guest);
  assert.equal(omitted.status, 201);
  assert.equal(omitted.body.photo.message, '');
});

test('message migration upgrades old databases once and preserves old photos and quota', async () => {
  const qr = await createQr(),
    guest = await startGuest(qr),
    saved = await upload(qr, guest);
  assert.equal(saved.status, 201);
  await db.exec('ALTER TABLE photos DROP COLUMN message');
  await migrateDatabase(db);
  await migrateDatabase(db);
  const photo = await db.prepare('SELECT * FROM photos WHERE id=?').get(saved.body.photo.id);
  assert.equal(photo.message, '');
  assert.equal(await counter(qr), 1);
  assert.equal((await request(app).get(saved.body.photo.url)).status, 200);
  assert.equal(
    (await db.prepare('PRAGMA table_info(photos)').all()).filter(
      (column) => column.name === 'message',
    ).length,
    1,
  );
});

test('new install has zero stats, empty gallery, and no dummy QR/photo records', async () => {
  const stats = await admin.get('/api/admin/overview');
  for (const key of [
    'total_qr',
    'active_qr',
    'total_quota',
    'used_quota',
    'uploaded',
    'published',
    'remaining_quota',
    'sessions',
  ])
    assert.equal(stats.body[key], 0);
  assert.deepEqual((await request(app).get('/api/photos')).body.photos, []);
});
test('admin routes reject anonymous access for reads and writes', async () => {
  for (const path of ['/overview', '/qrs', '/photos'])
    assert.equal((await request(app).get(`/api/admin${path}`)).status, 401);
  assert.equal(
    (await request(app).post('/api/admin/qrs').set('Origin', origin).send({})).status,
    401,
  );
});
test('login rejects wrong credentials, missing CSRF and foreign origins', async () => {
  const guest = request.agent(app),
    auth = await guest.get('/api/auth');
  assert.equal(
    (
      await guest
        .post('/api/auth/login')
        .set('Origin', origin)
        .send({ email: 'test@example.com', password })
    ).status,
    403,
  );
  assert.equal(
    (
      await guest
        .post('/api/auth/login')
        .set('Origin', 'https://evil.invalid')
        .set('X-CSRF-Token', auth.body.csrf)
        .send({ email: 'test@example.com', password })
    ).status,
    403,
  );
  assert.equal(
    (
      await guest
        .post('/api/auth/login')
        .set('Origin', origin)
        .set('X-CSRF-Token', auth.body.csrf)
        .send({ email: 'test@example.com', password: 'wrong' })
    ).status,
    401,
  );
});
test('admin session has HttpOnly/SameSite cookie, requires CSRF, and logout revokes access', async () => {
  const fresh = request.agent(app),
    auth = await fresh.get('/api/auth');
  const login = await fresh
    .post('/api/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', auth.body.csrf)
    .send({ email: 'test@example.com', password });
  const cookie = login.headers['set-cookie'].find((v) => v.startsWith('admin_session='));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal((await fresh.post('/api/admin/qrs').set('Origin', origin).send({})).status, 403);
  assert.equal(
    (
      await fresh
        .post('/api/auth/logout')
        .set('Origin', origin)
        .set('X-CSRF-Token', login.body.csrf)
    ).status,
    200,
  );
  assert.equal((await fresh.get('/api/admin/overview')).status, 401);
});
test('QR CRUD validates limits, generates unique camera URL and real PNG', async () => {
  const invalid = await admin
    .post('/api/admin/qrs')
    .set('Origin', origin)
    .set('X-CSRF-Token', csrf)
    .send({ label: 'x', total_limit: 2, per_session_limit: 3 });
  assert.equal(invalid.status, 400);
  const qr = await createQr(100, 3);
  assert.equal(qr.max_sessions, 33);
  assert.equal(qr.unallocated, 1);
  assert.match(qr.url, /\/camera\/[\w-]{32}$/);
  const png = await admin.get(`/api/admin/qrs/${qr.id}/png`);
  assert.equal(png.status, 200);
  assert.equal((await sharp(png.body).metadata()).width, 1200);
  assert.equal((await request(app).get(`/api/admin/qrs/${qr.id}/png`)).status, 401);
  assert.equal(
    (await admin.delete(`/api/admin/qrs/${qr.id}`).set('Origin', origin).set('X-CSRF-Token', csrf))
      .status,
    200,
  );
});
test('unknown and disabled QR cannot create guest sessions', async () => {
  assert.equal(
    (await request(app).post('/api/guest/missing/session').set('Origin', origin)).status,
    404,
  );
  const qr = await createQr();
  await db.prepare('UPDATE qr_codes SET active=0 WHERE id=?').run(qr.id);
  const response = await request(app).post(`/api/guest/${qr.code}/session`).set('Origin', origin);
  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'QR_DISABLED');
});
test('opening a session reserves a slot but does not consume photo quota; cookie resumes it', async () => {
  const qr = await createQr(),
    guest = await startGuest(qr);
  const response = await guest.agent.post(`/api/guest/${qr.code}/session`).set('Origin', origin);
  assert.equal(response.body.id, guest.session.id);
  assert.equal(await counter(qr), 0);
  assert.equal((await db.prepare('SELECT COUNT(*) count FROM guest_sessions').get()).count, 1);
});
test('session admission floors division and does not allocate the remainder', async () => {
  const qr = await createQr(10, 3);
  await Promise.all(Array.from({ length: 3 }, () => startGuest(qr)));
  const denied = await request(app).post(`/api/guest/${qr.code}/session`).set('Origin', origin);
  assert.equal(denied.status, 409);
  assert.equal(denied.body.code, 'SESSIONS_EXHAUSTED');
  assert.equal(await counter(qr), 0);
});
test('expired empty sessions release their slot; sessions with uploads retain theirs', async () => {
  const qr = await createQr(2, 2),
    guest = await startGuest(qr);
  await db.prepare("UPDATE guest_sessions SET expires_at='2000-01-01T00:00:00Z'").run();
  const next = await startGuest(qr);
  assert.notEqual(next.session.id, guest.session.id);
  assert.equal((await upload(qr, next)).status, 201);
  await db.prepare("UPDATE guest_sessions SET expires_at='2000-01-01T00:00:00Z'").run();
  const denied = await request(app).post(`/api/guest/${qr.code}/session`).set('Origin', origin);
  assert.equal(denied.status, 409);
});
test('successful upload persists decoded JPEG, thumbnail, metadata and both counters', async () => {
  const qr = await createQr(),
    guest = await startGuest(qr),
    saved = await upload(qr, guest);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.session.remaining, 2);
  assert.equal(await counter(qr), 1);
  assert.equal((await db.prepare('SELECT photo_count FROM guest_sessions').get()).photo_count, 1);
  const media = await request(app).get(saved.body.photo.url);
  assert.equal(media.status, 200);
  const meta = await sharp(media.body).metadata();
  assert.equal(meta.width, 640);
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.exif, undefined);
  assert.equal((await request(app).get(saved.body.photo.thumbnail)).status, 200);
  const gallery = await request(app).get('/api/photos');
  assert.equal(gallery.body.total, 1);
  assert.equal(gallery.body.photos[0].id, saved.body.photo.id);
  assert.equal(gallery.body.photos[0].session_id, undefined);
  assert.equal(gallery.body.photos[0].storage_name, undefined);
});
test('concurrent uploads cannot exceed per-session or global quota', async () => {
  const qr = await createQr(6, 3),
    guests = await Promise.all([startGuest(qr), startGuest(qr)]);
  const uploads = await Promise.all(
    guests.flatMap((guest) => Array.from({ length: 8 }, () => upload(qr, guest))),
  );
  assert.equal(uploads.filter((r) => r.status === 201).length, 6);
  assert.equal(uploads.filter((r) => r.status === 409).length, 10);
  assert.equal(await counter(qr), 6);
  assert.equal((await db.prepare('SELECT COUNT(*) count FROM photos').get()).count, 6);
  for (const s of await db.prepare('SELECT photo_count FROM guest_sessions').all())
    assert.equal(s.photo_count, 3);
  assert.equal((await readdir(join(directory, 'photos'))).length, 12);
});
test('simultaneous identical idempotency keys store one photo and charge once', async () => {
  const qr = await createQr(),
    guest = await startGuest(qr),
    key = randomUUID();
  const results = await Promise.all(Array.from({ length: 5 }, () => upload(qr, guest, key)));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(new Set(results.map((r) => r.body.photo.id)).size, 1);
  assert.equal(await counter(qr), 1);
  assert.equal((await readdir(join(directory, 'photos'))).length, 2);
});
test('malformed/oversized/mislabeled files do not consume quota or leave files', async () => {
  const qr = await createQr(),
    guest = await startGuest(qr);
  assert.equal(
    (await upload(qr, guest, randomUUID(), Buffer.from('<script>alert(1)</script>'))).status,
    400,
  );
  assert.equal((await upload(qr, guest, randomUUID(), image, 'fake.png', 'image/png')).status, 400);
  assert.equal(
    (await upload(qr, guest, randomUUID(), image, 'fake.svg', 'image/svg+xml')).status,
    400,
  );
  assert.equal(
    (await upload(qr, guest, randomUUID(), Buffer.alloc(12 * 1024 * 1024 + 1))).status,
    400,
  );
  assert.equal(await counter(qr), 0);
  assert.equal((await readdir(join(directory, 'photos'))).length, 0);
});
test('database failure rolls back quota/session and removes newly written files', async () => {
  const qr = await createQr(),
    guest = await startGuest(qr);
  await db.exec(
    "CREATE TRIGGER fail_upload BEFORE UPDATE ON qr_codes BEGIN SELECT RAISE(ABORT,'simulated failure'); END;",
  );
  assert.equal((await upload(qr, guest)).status, 500);
  assert.equal(await counter(qr), 0);
  assert.equal((await db.prepare('SELECT photo_count FROM guest_sessions').get()).photo_count, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) count FROM photos').get()).count, 0);
  assert.equal((await readdir(join(directory, 'photos'))).length, 0);
});
test('guest session ownership, CSRF, expiry and disabled QR are revalidated on upload', async () => {
  const qr = await createQr(),
    other = await createQr(),
    guest = await startGuest(qr);
  assert.equal((await upload(other, guest)).status, 401);
  const forged = { ...guest, session: { ...guest.session, csrf: 'forged' } };
  assert.equal((await upload(qr, forged)).status, 403);
  await db.prepare('UPDATE qr_codes SET active=0 WHERE id=?').run(qr.id);
  assert.equal((await upload(qr, guest)).status, 403);
  await db.prepare('UPDATE qr_codes SET active=1 WHERE id=?').run(qr.id);
  await db.prepare("UPDATE guest_sessions SET expires_at='2000-01-01T00:00:00Z'").run();
  assert.equal((await upload(qr, guest)).status, 401);
  assert.equal(await counter(qr), 0);
});
test('QR history cannot be deleted, session size cannot change, total cannot undercut allocated slots', async () => {
  const qr = await createQr();
  await startGuest(qr);
  assert.equal(
    (await admin.delete(`/api/admin/qrs/${qr.id}`).set('Origin', origin).set('X-CSRF-Token', csrf))
      .status,
    409,
  );
  const change = (body) =>
    admin.put(`/api/admin/qrs/${qr.id}`).set('Origin', origin).set('X-CSRF-Token', csrf).send(body);
  assert.equal(
    (await change({ label: qr.label, total_limit: 6, per_session_limit: 2, active: true })).status,
    409,
  );
  assert.equal(
    (await change({ label: qr.label, total_limit: 2, per_session_limit: 2, active: true })).status,
    409,
  );
  assert.equal(
    (await change({ label: 'Updated', total_limit: 12, per_session_limit: 3, active: false }))
      .status,
    200,
  );
});
test('photo deletion hides media and gallery but preserves usage and uploaded totals', async () => {
  const qr = await createQr(),
    guest = await startGuest(qr),
    saved = await upload(qr, guest);
  assert.equal(
    (
      await admin
        .delete(`/api/admin/photos/${saved.body.photo.id}`)
        .set('Origin', origin)
        .set('X-CSRF-Token', csrf)
    ).status,
    200,
  );
  assert.equal((await request(app).get(saved.body.photo.url)).status, 404);
  assert.equal((await request(app).get('/api/photos')).body.total, 0);
  assert.equal(await counter(qr), 1);
  const stats = (await admin.get('/api/admin/overview')).body;
  assert.equal(stats.uploaded, 1);
  assert.equal(stats.published, 0);
  assert.equal(stats.used_quota, 1);
  assert.equal((await readdir(join(directory, 'photos'))).length, 0);
});
test('gallery pagination, admin filters, metadata and usage monitoring return real records', async () => {
  const qr = await createQr(6, 3, 'Main hall'),
    other = await createQr(6, 3, 'Garden'),
    guest = await startGuest(qr),
    second = await startGuest(other);
  await upload(qr, guest);
  await upload(other, second);
  const listing = (await request(app).get('/api/photos?limit=1&page=2')).body;
  assert.equal(listing.total, 2);
  assert.equal(listing.pages, 2);
  assert.equal(listing.photos.length, 1);
  const filtered = (await admin.get(`/api/admin/photos?qr=${qr.id}&search=Main`)).body;
  assert.equal(filtered.total, 1);
  assert.equal(filtered.photos[0].session_id, guest.session.id);
  assert.equal((await admin.get('/api/admin/photos?from=2000-01-01&to=2000-01-02')).body.total, 0);
  const usage = (await admin.get(`/api/admin/qrs/${qr.id}/usage`)).body;
  assert.equal(usage.sessions[0].photo_count, 1);
  assert.equal(usage.qr.used_count, 1);
  assert.equal(usage.sessions[0].token_hash, undefined);
  assert.equal(usage.sessions[0].csrf, undefined);
  assert.equal((await request(app).get('/api/photos?page=-1')).status, 400);
});
test('event settings persist across database reopen', async () => {
  const event = {
    partner_one: 'Nadia',
    partner_two: 'Arif',
    wedding_date: '2026-12-20',
    venue: 'Jakarta',
    welcome_message: 'Selamat datang di hari bahagia kami.',
  };
  assert.equal(
    (
      await admin
        .put('/api/admin/event')
        .set('Origin', origin)
        .set('X-CSRF-Token', csrf)
        .send(event)
    ).status,
    200,
  );
  db.close();
  db = await fixtureDatabase();
  assert.equal((await db.prepare('SELECT * FROM settings WHERE id=1').get()).partner_one, 'Nadia');
});

test('invalid dates and reversed date ranges return validation errors', async () => {
  for (const query of ['from=2026-99-01', 'to=2026-02-31', 'from=2026-11-20&to=2026-11-01']) {
    const response = await admin.get(`/api/admin/photos?${query}`);
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'VALIDATION_ERROR');
  }
});

test('studio accounts, dashboards, dynamic galleries, assets, quotas and filters stay scoped to their projects', async () => {
  const { tenantScenarios } = await import('./tenant-scenarios.js');
  await tenantScenarios({admin,csrf,app,origin,password,image,startGuest,upload});
});
