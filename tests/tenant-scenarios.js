import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
const themes = JSON.parse(
  readFileSync(new URL('../server/wedding-themes.json', import.meta.url), 'utf8'),
);

export async function tenantScenarios({
  admin,
  csrf,
  app,
  origin,
  password,
  image,
  startGuest,
  upload,
}) {
  const change = (agent, token, method, path) =>
    agent[method]('/api/admin' + path)
      .set('Origin', origin)
      .set('X-CSRF-Token', token);
  const root = (method, path) => change(admin, csrf, method, path);
  const account = { email: 'studio@example.org', username: 'studio-foto', password, active: true };
  const created = await root('post', '/users').send(account).expect(201);
  await root('post', '/users').send(account).expect(409);
  await root('post', '/users')
    .send({ ...account, username: 'second', email: 'second@example.org' })
    .expect(201);
  const studio = request.agent(app),
    auth = (await studio.get('/api/auth')).body;
  const login = await studio
    .post('/api/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', auth.csrf)
    .send({ username: account.username, password })
    .expect(200);
  assert.equal(login.body.role, 'project');
  const own = (method, path) => change(studio, login.body.csrf, method, path);
  for (const route of ['/users', '/system']) await studio.get('/api/admin' + route).expect(403);
  await own('post', '/users').send(account).expect(403);
  await own('put', '/event').send({}).expect(403);
  const pr = (
    await root('post', '/projects')
      .send({ name: 'Dimas & Putri', owner_id: created.body.id })
      .expect(201)
  ).body.id;
  const second = (await own('post', '/projects').send({ name: 'Resepsi' }).expect(201)).body.id;
  assert.deepEqual(
    (await studio.get('/api/admin/projects')).body.map((p) => p.id).sort(),
    [pr, second].sort(),
  );
  await own('put', '/projects/legacy').send({ name: 'Other' }).expect(404);
  await own('post', '/qrs').send({ project_id: 'legacy', label: 'No' }).expect(404);
  const balance = async () => {
    const { total, allocated, available } = (await studio.get('/api/admin/quota').expect(200)).body;
    return { total, allocated, available };
  };
  const grant = (photo_quota) =>
    root('put', '/users/' + created.body.id).send({
      username: account.username,
      email: account.email,
      active: true,
      photo_quota,
    });
  const make = (project_id, total_limit, per_session_limit = 2) =>
    own('post', '/qrs').send({
      project_id,
      total_limit,
      per_session_limit,
      label: 'Alokasi studio',
    });
  await make(pr, 5).expect(409);
  await make(pr, null).expect(403);
  await own('put', '/users/' + created.body.id)
    .send({ ...account, photo_quota: 9999 })
    .expect(403);
  await grant(500).expect(200);
  const first = (await make(pr, 100).expect(201)).body;
  const middle = (await make(second, 150).expect(201)).body;
  const last = (await make(pr, 200).expect(201)).body;
  assert.deepEqual(await balance(), { total: 500, allocated: 450, available: 50 });
  await grant(449).expect(409);
  await make(second, 51).expect(409);
  const race = await Promise.all([make(pr, 50), make(second, 50)]);
  assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
  const winner = race.find((r) => r.status === 201).body;
  assert.equal(winner.max_sessions, 25);
  await own('put', '/qrs/' + first.id)
    .send({ total_limit: 101 })
    .expect(409);
  await root('put', '/qrs/' + first.id)
    .send({ total_limit: 101 })
    .expect(409);
  await own('put', '/qrs/' + first.id)
    .send({ total_limit: 50 })
    .expect(200);
  await grant(450).expect(200);
  for (const q of [first, middle, last, winner]) await own('delete', '/qrs/' + q.id).expect(200);
  assert.deepEqual(await balance(), { total: 450, allocated: 0, available: 450 });
  await grant(2).expect(200);
  await root('put', '/system').send({ default_total: 2, default_per: 2 }).expect(200);
  const qr = (
    await own('post', '/qrs')
      .send({ project_id: pr, label: 'Tamu', code: 'wedding-dimas-putri' })
      .expect(201)
  ).body;
  const other = (
    await root('post', '/qrs')
      .send({ project_id: 'legacy', label: 'Other', total_limit: 1, per_session_limit: 1 })
      .expect(201)
  ).body;
  const secondQr = (
    await root('post', '/qrs')
      .send({ project_id: second, label: 'Resepsi', total_limit: 1, per_session_limit: 1 })
      .expect(201)
  ).body;
  assert.deepEqual(await balance(), { total: 2, allocated: 2, available: 0 });
  await own('put', '/qrs/' + secondQr.id)
    .send({ total_limit: 5000 })
    .expect(403);
  await own('delete', '/qrs/' + secondQr.id).expect(403);
  const base = '/api/invites/studio-foto/' + qr.code;
  assert.equal(qr.url, origin + '/studio-foto/wedding-dimas-putri');
  assert.equal(qr.total_limit, 2);
  await own('post', '/qrs')
    .send({ project_id: second, label: 'Duplikat', code: qr.code })
    .expect(409);
  await own('put', '/qrs/' + qr.id)
    .send({ label: 'Tamu VIP', per_session_limit: 1 })
    .expect(200);
  await own('put', '/qrs/' + qr.id)
    .send({ label: 'Tamu VIP', per_session_limit: 2, active: true })
    .expect(200);
  assert.equal((await studio.get('/api/admin/qrs')).body.length, 2);
  for (const route of [
    '/qrs/' + other.id + '/usage',
    '/qrs/' + other.id + '/png',
    '/projects/legacy/event',
  ])
    await studio.get('/api/admin' + route).expect(404);
  await own('delete', '/qrs/' + other.id).expect(404);
  await request(app)
    .get('/api/invites/other/' + qr.code + '/event')
    .expect(404);
  const project = '/projects/' + pr;
  const initial = (await studio.get('/api/admin' + project + '/event')).body;
  assert.equal(initial.filters.length, 10);
  const event = {
    ...initial,
    partner_one: 'Dimas',
    partner_two: 'Putri',
    welcome_message: 'Selamat datang!',
    title: 'Akad',
    theme: '#733737',
    position: 'right',
  };
  const form = own('put', project + '/event').field('settings', JSON.stringify(event));
  for (const slot of ['logo', 'banner', 'background', 'decoration', 'hero'])
    form.attach(slot, image, slot + '.jpg');
  await form.expect(200);
  await own('put', project + '/event')
    .field('settings', JSON.stringify(event))
    .expect(409);
  const fresh = (await request(app).get(base + '/event')).body;
  assert.equal(fresh.partner_one, 'Dimas');
  assert.equal(Object.keys(fresh.images).length, 5);
  assert.equal((await request(app).get(fresh.images.logo)).type, 'image/jpeg');
  let revision = fresh.revision;
  const otherProject = '/api/admin/projects/' + second + '/event';
  const unchanged = (await studio.get(otherProject)).body;
  for (const [index, t] of themes.entries()) {
    const appearance = {
      ...fresh.appearance,
      preset: t.id,
      background: t.background,
      font: t.font,
      button: t.button,
      scale: 110,
      buttonLabel: 'Ambil foto',
    };
    const action = index % 2 ? root : own;
    const save = action('put', project + '/event').field(
      'settings',
      JSON.stringify({ ...event, theme: t.accent, position: t.position, appearance, revision }),
    );
    if (!index) save.attach('couple', image, 'potret.jpg');
    await save.expect(200);
    const published = (
      await request(app)
        .get(base + '/event')
        .expect(200)
    ).body;
    assert.deepEqual(published.appearance, appearance);
    assert.equal(published.theme, t.accent);
    assert.equal(published.position, t.position);
    assert.equal(published.revision, ++revision);
    assert.equal((await request(app).get(published.images.couple)).type, 'image/jpeg');
  }
  const bad = { ...event, revision, appearance: { ...fresh.appearance, scale: 999 } };
  await own('put', project + '/event')
    .field('settings', JSON.stringify(bad))
    .expect(400);
  await own('put', '/projects/legacy/event').field('settings', JSON.stringify(event)).expect(404);
  assert.deepEqual((await studio.get(otherProject)).body, unchanged);
  const legacy = (await admin.get('/api/admin/projects/legacy/event')).body;
  const active = { ...legacy, appearance: { ...legacy.appearance, preset: 'garden' } };
  await root('put', '/projects/legacy/event').field('settings', JSON.stringify(active)).expect(200);
  assert.equal((await request(app).get('/api/event')).body.appearance.preset, 'garden');
  await own('put', project + '/filters')
    .send({ filters: ['Dreamy'] })
    .expect(200);
  assert.deepEqual((await request(app).get(base + '/event')).body.filters, ['Dreamy']);
  assert.equal(
    (await studio.get('/api/admin/projects/' + second + '/event')).body.filters.length,
    10,
  );
  const guest = await startGuest(qr);
  const saved = (await upload(qr, guest)).body;
  assert.equal(saved.session.remaining, 1);
  assert.equal((await guest.agent.get('/api/qr/' + qr.code)).body.session.remaining, 1);
  assert.equal((await request(app).get(base + '/photos')).body.total, 1);
  assert.equal((await request(app).get('/api/photos')).body.total, 0);
  const photo = saved.photo.id,
    secondBase = '/api/invites/studio-foto/' + secondQr.code;
  for (const route of [
    '/media/' + photo,
    secondBase + '/media/' + photo,
    secondBase + '/images/logo',
  ])
    await request(app).get(route).expect(404);
  await request(app).get(saved.photo.url).expect(200);
  await own('put', '/photos/' + photo)
    .send({ message: 'Edit', rotate: 90 })
    .expect(200);
  const bytes = (await request(app).get(saved.photo.url)).body;
  assert.equal((await sharp(bytes).metadata()).width, 480);
  const legacyPhoto = (await upload(other, await startGuest(other))).body.photo;
  await studio.get('/api/admin/media/' + legacyPhoto.id).expect(404);
  await own('put', '/photos/' + legacyPhoto.id)
    .send({ message: 'No' })
    .expect(404);
  await own('delete', '/photos/' + legacyPhoto.id).expect(404);
  const parallel = await Promise.all([upload(qr, guest), upload(qr, guest)]);
  assert.deepEqual(parallel.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await guest.agent.get('/api/qr/' + qr.code)).body.session.remaining, 0);
  assert.equal((await studio.get('/api/admin/photos')).body.total, 2);
  const stats = (await studio.get('/api/admin/overview')).body;
  assert.equal(stats.users, undefined);
  assert.equal(stats.uploaded, 2);
  assert.equal(stats.recent.length, 2);
  assert.equal(stats.projects.length, 2);
  await own('put', '/qrs/' + qr.id)
    .send({ label: 'Nonaktif', active: false })
    .expect(200);
  await request(app)
    .get(base + '/photos')
    .expect(403);
  await request(app).get(saved.photo.url).expect(403);
  await grant(10).expect(200);
  const refund = (await make(second, 8).expect(201)).body;
  const refundGuest = await startGuest(refund);
  const photoToDelete = (await upload(refund, refundGuest)).body.photo;
  await own('delete', '/photos/' + photoToDelete.id).expect(200);
  assert.equal((await balance()).available, 0);
  await own('delete', '/qrs/' + refund.id).expect(200);
  assert.deepEqual(await balance(), { total: 10, allocated: 3, available: 7 });
  assert.equal(
    (await studio.get('/api/admin/qrs')).body.some((q) => q.id === refund.id),
    false,
  );
  assert.ok(
    (await admin.get('/api/admin/qrs?include_archived=1')).body.find((q) => q.id === refund.id)
      .deleted_at,
  );
  assert.equal(
    (await studio.get('/api/admin/qrs/' + refund.id + '/usage').expect(200)).body.qr.used_count,
    1,
  );
  await own('delete', '/qrs/' + refund.id).expect(404);
  await request(app)
    .get('/api/qr/' + refund.code)
    .expect(404);
  await grant(2).expect(409);
  await root('put', '/users/' + created.body.id)
    .send({ ...account, active: false })
    .expect(200);
  await studio.get('/api/admin/overview').expect(401);
  await request(app)
    .get(secondBase + '/event')
    .expect(403);
}
