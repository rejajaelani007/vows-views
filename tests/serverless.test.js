import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { databaseAdapter, openDatabase, transaction } from '../server/db.js';
import { createStorage } from '../server/storage.js';
import { createApp } from '../server/app.js';
import { createAdmin } from '../server/security.js';
import { runtimeConfig, startApplication } from '../server/runtime.js';
import { DatabaseRateLimitStore } from '../server/rate-limit.js';
import handler from '../api/index.js';

test('shared startup serves the API and provisions the first local admin once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wedding-runtime-'));
  const values = {
    VERCEL: '',
    NODE_ENV: 'development',
    DATA_DIR: directory,
    PUBLIC_URL: 'http://localhost:5173',
    TURSO_DATABASE_URL: '',
    TURSO_AUTH_TOKEN: '',
    STORAGE_PROVIDER: 'local',
    ADMIN_EMAIL: 'startup@example.com',
    ADMIN_PASSWORD: 'startup-test-password',
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  let runtime;
  try {
    runtime = await startApplication();
    assert.equal((await request(runtime.app).get('/api/health')).status, 200);
    assert.equal((await request(runtime.app).get('/api/photos')).body.total, 0);
    assert.equal((await runtime.db.prepare('SELECT COUNT(*) count FROM admins').get()).count, 1);
    runtime.db.close();
    runtime = undefined;
    runtime = await startApplication();
    assert.equal((await runtime.db.prepare('SELECT COUNT(*) count FROM admins').get()).count, 1);
  } finally {
    runtime?.db.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('Function returns a safe retryable error when Vercel configuration is missing', async () => {
  const values = {
    VERCEL: '1',
    PUBLIC_URL: 'https://fixture.vercel.app',
    TURSO_DATABASE_URL: 'libsql://fixture.turso.io',
    TURSO_AUTH_TOKEN: '',
    STORAGE_PROVIDER: 'vercel-blob',
    BLOB_READ_WRITE_TOKEN: 'test-secret-must-not-leak',
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    for (let i = 0; i < 2; i++) {
      const response = await request(handler).get('/api/health');
      assert.equal(response.status, 503);
      assert.equal(response.body.code, 'CONFIG_MISSING_ENV');
      assert.match(response.body.message, /TURSO_AUTH_TOKEN/);
      assert.doesNotMatch(response.body.message, /test-secret-must-not-leak|fixture\.turso\.io/);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.body.stack, undefined);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Vercel refuses local persistence and validates the canonical HTTPS origin', async () => {
  await assert.rejects(openDatabase('/not-created', { url: '', serverless: true }), /Turso/);
  await assert.rejects(createStorage({ provider: 'local', serverless: true }), /STORAGE_PROVIDER/);
  const env = {
    VERCEL: '1',
    TURSO_DATABASE_URL: 'libsql://example.turso.io',
    TURSO_AUTH_TOKEN: 'test',
    STORAGE_PROVIDER: 'vercel-blob',
    BLOB_READ_WRITE_TOKEN: 'test',
    VERCEL_URL: 'photos.vercel.app',
  };
  assert.equal(runtimeConfig(env).publicUrl, 'https://photos.vercel.app');
  assert.equal(runtimeConfig(env).serveFrontend, false);
  assert.equal(
    runtimeConfig({
      ...env,
      STORAGE_PROVIDER: ' vercel-blob\n',
      PUBLIC_URL: ' https://fixture.vercel.app/ \n',
    }).publicUrl,
    'https://fixture.vercel.app',
  );
  assert.throws(
    () => runtimeConfig({ ...env, STORAGE_PROVIDER: 'local' }),
    (error) => error.code === 'CONFIG_INVALID_STORAGE_PROVIDER',
  );
  assert.equal(
    runtimeConfig({ ...env, PUBLIC_URL: 'https://wedding.example/' }).publicUrl,
    'https://wedding.example',
  );
  assert.throws(() => runtimeConfig({ ...env, TURSO_AUTH_TOKEN: '' }), /Turso/);
  assert.throws(() => runtimeConfig({ ...env, PUBLIC_URL: 'http://wedding.example' }), /HTTPS/);
  assert.throws(
    () => runtimeConfig({ ...env, PUBLIC_URL: 'https://wedding.example/path' }),
    /origin/,
  );
});

test('remote helpers use the transaction connection; failed COMMIT is marked uncertain', async () => {
  let committed = 0,
    rolledBack = 0,
    closed = 0;
  const calls = [];
  const connection = {
    async execute({ sql }) {
      calls.push(sql);
      return { rows: [{ value: 42 }] };
    },
    async commit() {
      committed++;
      throw new Error('Connection lost');
    },
    async rollback() {
      rolledBack++;
    },
    close() {
      closed++;
    },
  };
  const db = databaseAdapter(
    {
      async transaction(mode) {
        assert.equal(mode, 'write');
        return connection;
      },
      execute() {
        throw new Error('Query escaped its transaction');
      },
    },
    true,
  );
  await assert.rejects(
    transaction(db, async () => {
      assert.equal((await db.prepare('SELECT value').get()).value, 42);
      await db.prepare('UPDATE counter').run();
    }),
    (error) => error.commitUncertain === true,
  );
  assert.deepEqual(calls, ['SELECT value', 'UPDATE counter']);
  assert.equal(committed, 1);
  assert.equal(rolledBack, 1);
  assert.equal(closed, 1);
});

test('shared rate counters survive independent store instances and reset after expiry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wedding-rate-'));
  const db = await openDatabase(directory, { url: '', serverless: false });
  try {
    const one = new DatabaseRateLimitStore(db, 'login');
    const two = new DatabaseRateLimitStore(db, 'login');
    one.init({ windowMs: 900000 });
    two.init({ windowMs: 900000 });
    const hits = await Promise.all(
      Array.from({ length: 12 }, (_, i) => (i % 2 ? one : two).increment('guest-ip')),
    );
    assert.deepEqual(
      hits.map((h) => h.totalHits).sort((a, b) => a - b),
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    await db.prepare('UPDATE rate_limits SET reset_time=0').run();
    assert.equal((await two.increment('guest-ip')).totalHits, 1);
    await one.resetKey('guest-ip');
    assert.equal((await two.increment('guest-ip')).totalHits, 1);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('cloud storage upload, retry, deletion and partial failure preserve gallery/quota invariants', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wedding-cloud-'));
  const db = await openDatabase(directory, { url: '', serverless: false });
  const objects = new Map();
  let failThumb = false,
    failDelete = false;
  const storage = await createStorage({
    provider: 'vercel-blob',
    token: 'test-only-token',
    sdk: {
      async put(path, bytes, options) {
        assert.equal(options.access, 'public');
        assert.equal(options.allowOverwrite, false);
        if (failThumb && path.endsWith('-thumb.jpg')) throw new Error('Storage unavailable');
        const url = `https://test.public.blob.vercel-storage.com/${path}`;
        objects.set(url, bytes);
        return { url };
      },
      async del(path) {
        if (failDelete) throw new Error('Delete unavailable');
        objects.delete(
          path.startsWith('https:') ? path : `https://test.public.blob.vercel-storage.com/${path}`,
        );
      },
    },
  });
  try {
    const origin = 'http://localhost:5173';
    await createAdmin(db, 'cloud@example.com', 'cloud-test-password');
    const app = await createApp({
      db,
      storage,
      dataDir: undefined,
      serveFrontend: false,
      publicUrl: origin,
      disableRateLimit: true,
      maxUploadBytes: 4 * 1024 * 1024,
    });
    const admin = request.agent(app);
    const auth = (await admin.get('/api/auth')).body;
    const login = await admin
      .post('/api/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', auth.csrf)
      .send({ email: 'cloud@example.com', password: 'cloud-test-password' });
    assert.equal(login.status, 200);
    const qr = (
      await admin
        .post('/api/admin/qrs')
        .set('Origin', origin)
        .set('X-CSRF-Token', login.body.csrf)
        .send({ label: 'Cloud wedding', total_limit: 3, per_session_limit: 3 })
    ).body;
    const list = await admin.get('/api/admin/qrs');
    assert.equal(list.body[0].id, qr.id); // Never serialize unresolved promises.
    const guest = request.agent(app);
    const session = (await guest.post(`/api/guest/${qr.code}/session`).set('Origin', origin)).body;
    const image = await sharp({
      create: { width: 120, height: 100, channels: 3, background: 'red' },
    })
      .jpeg()
      .toBuffer();
    const key = randomUUID();
    const upload = (buffer = image, requestKey = key) =>
      guest
        .post(`/api/guest/${qr.code}/photos`)
        .set('Origin', origin)
        .set('X-CSRF-Token', session.csrf)
        .set('Idempotency-Key', requestKey)
        .field('message', 'Bahagia selalu, bersama selamanya!')
        .attach('photo', buffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    const saved = await upload();
    assert.equal(saved.status, 201);
    assert.equal(saved.body.photo.message, 'Bahagia selalu, bersama selamanya!');
    assert.equal(
      (await request(app).get('/api/photos')).body.photos[0].message,
      saved.body.photo.message,
    );
    assert.equal(objects.size, 2);
    assert.equal((await upload()).body.replayed, true);
    assert.equal(objects.size, 2);
    const media = await request(app).get(saved.body.photo.url);
    assert.equal(media.status, 302);
    assert.match(
      media.headers.location,
      /^https:\/\/test\.public\.blob\.vercel-storage\.com\/photos\//,
    );
    assert.equal(media.headers['cache-control'], 'no-store');
    assert.match(media.headers['content-security-policy'], /public\.blob\.vercel-storage\.com/);
    const download = await request(app).get(`${saved.body.photo.url}?download=1`);
    assert.match(download.headers.location, /download=1/);
    failThumb = true;
    assert.equal((await upload(image, randomUUID())).status, 500);
    assert.equal(objects.size, 2);
    assert.equal((await db.prepare('SELECT used_count FROM qr_codes').get()).used_count, 1);
    assert.equal((await upload(Buffer.alloc(4 * 1024 * 1024 + 1), randomUUID())).status, 400);
    failDelete = true;
    const remove = () =>
      admin
        .delete(`/api/admin/photos/${saved.body.photo.id}`)
        .set('Origin', origin)
        .set('X-CSRF-Token', login.body.csrf);
    assert.equal((await remove()).status, 500);
    assert.equal((await request(app).get(saved.body.photo.url)).status, 404);
    failDelete = false;
    assert.equal((await remove()).status, 200);
    assert.equal(objects.size, 0);
    assert.equal((await request(app).get('/api/photos')).body.total, 0);
    assert.equal((await db.prepare('SELECT used_count FROM qr_codes').get()).used_count, 1);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
