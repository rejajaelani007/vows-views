// Optional desktop/mobile viewport smoke test. Build first, then set CHROMIUM_BIN
// to an installed Chrome or Edge binary. Uses an isolated profile, synthetic
// camera and a temporary database, with no production credentials.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { openDatabase } from '../server/db.js';
import { createStorage } from '../server/storage.js';
import { createAdmin, id, hashPassword } from '../server/security.js';
import { createApp } from '../server/app.js';
import { filterNames } from '../server/projects.js';

const binary =
  process.env.CHROMIUM_BIN || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const dir = await mkdtemp(join(tmpdir(), 'wedding-browser-'));
const db = await openDatabase(dir, { url: '', serverless: false });
const storage = await createStorage({ dataDir: dir, provider: 'local', serverless: false });
let server, browser, socket, closed, closeBrowser;
async function until(fn, description, timeout = 12000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await fn();
    if (result) return result;
    await delay(100);
  } while (Date.now() < deadline);
  throw Error('Timed out: ' + description);
}
try {
  const pass = 'fixture-only-password';
  await createAdmin(db, 'root@example.org', pass);
  await db
    .prepare(
      "INSERT INTO admins(id,email,username,password_hash,role) VALUES('u','studio@example.org','studio',?,'project')",
    )
    .run(hashPassword(pass));
  await db
    .prepare("INSERT INTO projects(id,owner_id,name) VALUES('p','u','Dimas dan Putri')")
    .run();
  await db
    .prepare(
      "INSERT INTO qr_codes(id,project_id,label,code,total_limit,per_session_limit,created_by) VALUES(?,'p','Acara','akad',11,11,(SELECT id FROM admins WHERE role='super' LIMIT 1))",
    )
    .run(id());
  const { createServer } = await import('node:http');
  server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  server.on('request', await createApp({ db, storage, publicUrl: origin, disableRateLimit: true }));
  // A constant YUV frame makes filtered JPEGs directly comparable across shots.
  const width = 320,
    height = 240;
  const y = Buffer.alloc(width * height, 132),
    u = Buffer.alloc((width * height) / 4, 98),
    v = Buffer.alloc((width * height) / 4, 162);
  const camera = join(dir, 'camera.y4m');
  await writeFile(
    camera,
    Buffer.concat([Buffer.from('YUV4MPEG2 W320 H240 F20:1 Ip A1:1 C420jpeg\nFRAME\n'), y, u, v]),
  );
  const profile = join(dir, 'profile');
  browser = spawn(
    binary,
    [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--use-file-for-fake-video-capture=' + camera,
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  closed = once(browser, 'exit');
  const port = await until(async () => {
    try {
      return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    } catch {
      return '';
    }
  }, 'browser debugger');
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  socket = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  let seq = 0;
  const pending = new Map(),
    errors = [];
  socket.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id) {
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.exceptionThrown')
      errors.push(
        msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text,
      );
  };
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const key = ++seq;
      pending.set(key, (m) => (m.error ? reject(Error(m.error.message)) : resolve(m.result)));
      socket.send(JSON.stringify({ id: key, method, params }));
    });
  closeBrowser = () => call('Browser.close');
  const evaluate = async (expression) => {
    const r = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = (expression) => until(() => evaluate(expression), expression);
  const click = async (expression) => {
    await wait(`Boolean(${expression})`);
    await evaluate(`(${expression}).click()`);
  };
  const button = (text) =>
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)} && !b.disabled)`;
  await call('Runtime.enable');
  await call('Network.enable');
  await call('Network.setBlockedURLs', { urls: ['https://*'] });
  console.log('Browser ready');
  await call('Page.navigate', { url: origin + '/studio/akad' });
  await wait("document.querySelector('.quota-notice')?.textContent.includes('11 foto')");
  await click("document.querySelector('.hero-actions a')");
  await wait(`document.querySelectorAll('.filter-strip img').length===${filterNames.length + 1} &&
    [...document.querySelectorAll('.filter-strip img')].every(img=>img.complete && img.naturalWidth>0)`);
  assert.equal(
    await evaluate("document.querySelectorAll('.filter-strip canvas, .filter-strip video').length"),
    0,
  );
  assert.equal(await evaluate("document.querySelector('video').srcObject"), null);
  await click(button('Aktifkan kamera'));
  await wait(
    "document.querySelector('video')?.videoWidth>0 && !document.querySelector('.shutter')?.disabled",
  );
  await click("document.querySelector('.timer-toggle input')");
  const signatures = new Set();
  for (const [index, name] of ['Original', ...filterNames].entries()) {
    if (index === 5)
      await call('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true,
      });
    await click(button(name));
    if (index) await wait("document.querySelector('.live-filter')?.width>0");
    assert.equal(
      await evaluate(
        "document.querySelectorAll('.camera-stage video.visible, .camera-stage canvas.live-filter').length",
      ),
      1,
    );
    await click("document.querySelector('.shutter:not(:disabled)')");
    await wait("document.querySelector('.capture-preview')?.naturalWidth>0");
    const capture = await evaluate(
      `(async()=>{const img=document.querySelector('.capture-preview');const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return c.toDataURL('image/png').split(',')[1];})()`,
    );
    await click(button('Save photo'));
    await wait("!!document.querySelector('.saved-banner')");
    const row = await db.prepare('SELECT * FROM photos ORDER BY created_at DESC LIMIT 1').get();
    const result = await storage.read(row.storage_name);
    const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
    const preview = await sharp(Buffer.from(capture, 'base64')).removeAlpha().raw().toBuffer();
    assert.deepEqual([info.width, info.height], [width, height]);
    assert.equal(data.length, preview.length);
    let diff = 0;
    for (let k = 0; k < data.length; k++) diff += Math.abs(preview[k] - data[k]);
    assert.ok(diff / data.length < 4, `${name}: saved JPEG differs from the preview`);
    console.log('Captured', name, info.width, info.height);
    const signature = [0, 1, 2]
      .map((ch) => {
        let sum = 0;
        for (let i = ch; i < data.length; i += 3) sum += data[i];
        return Math.round(sum / (width * height));
      })
      .join(',');
    assert.ok(!signatures.has(signature), name + ' must change saved pixels');
    signatures.add(signature);
    assert.equal((await db.prepare('SELECT used_count FROM qr_codes').get()).used_count, index + 1);
    if (index < 10) {
      await click(button('Foto lagi'));
      await wait(
        "!document.querySelector('.shutter')?.disabled && !!document.querySelector('.shutter')",
      );
    }
  }
  await call('Page.reload');
  await wait("document.querySelector('.quota-notice')?.textContent.includes('habis')");
  assert.ok(await evaluate("document.querySelector('.shutter').disabled"));
  // Exercise the same editor and login controls operators use in production.
  async function login(identifier) {
    await call('Page.navigate', { url: origin + '/admin' });
    await wait("!!document.querySelector('#email')");
    await evaluate(
      `(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [selector,value] of [['#email',${JSON.stringify(identifier)}],['#password',${JSON.stringify(pass)}]]){const el=document.querySelector(selector);set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));}})()`,
    );
    await click(
      "document.querySelector('.login-card button[type=submit],.login-card form button')",
    );
    await wait("!!document.querySelector('.admin-main')");
  }
  await call('Emulation.clearDeviceMetricsOverride');
  await login('studio');
  await wait("document.querySelectorAll('.overview-summaries .panel').length===2");
  for (const width of [1440, 390]) {
    await call('Emulation.setDeviceMetricsOverride', {
      width,
      height: 920,
      deviceScaleFactor: 1,
      mobile: false,
    });
    assert.ok(
      await evaluate('document.documentElement.scrollWidth<=innerWidth'),
      'dashboard fits ' + width,
    );
    assert.ok(
      await evaluate(`[...document.querySelectorAll('.overview-summaries h2,.overview-list li')].every(el=>{
      const box=el.getBoundingClientRect(), panel=el.closest('.panel').getBoundingClientRect();
      return box.left-panel.left>=16 && panel.right-box.right>=16;
    })`),
      'panel insets at ' + width,
    );
    if (process.env.THEME_QA_DIR) {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(process.env.THEME_QA_DIR, { recursive: true });
      await evaluate(
        "document.querySelector('.overview-summaries').scrollIntoView({block:'center',behavior:'instant'})",
      );
      const shot = await call('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
      await writeFile(
        join(process.env.THEME_QA_DIR, 'overview-' + width + '.jpg'),
        Buffer.from(shot.data, 'base64'),
      );
    }
  }
  await call('Emulation.clearDeviceMetricsOverride');
  assert.equal(await evaluate('!!document.querySelector(\'a[href="/admin/users"]\')'), false);
  await click('document.querySelector(\'a[href="/admin/themes"]\')');
  const previewDoc = "document.querySelector('.proof iframe').contentDocument";
  const publicEvent = async () =>
    await (await fetch(origin + '/api/invites/studio/akad/event')).json();
  const initialTheme = await publicEvent();
  const themes = JSON.parse(
    await readFile(new URL('../server/wedding-themes.json', import.meta.url), 'utf8'),
  );
  await wait("document.querySelectorAll('.theme-shelf button').length===10");
  for (const [i, t] of themes.entries()) {
    await click(`document.querySelectorAll('.theme-shelf button')[${i}]`);
    for (const mode of ['Desktop', 'Tablet', 'Mobile']) {
      await click(button(mode));
      await wait(
        `${previewDoc}.querySelector('.w-${t.id} .designed-hero .photo-arch img')?.naturalWidth>0`,
      );
      assert.equal(
        await evaluate(
          `${previewDoc}.documentElement.scrollWidth<=${previewDoc}.documentElement.clientWidth+1`,
        ),
        true,
        t.id + ' ' + mode,
      );
      assert.equal(
        await evaluate(`${previewDoc}.defaultView.innerWidth`),
        { Desktop: 1200, Tablet: 768, Mobile: 390 }[mode],
      );
    }
  }
  assert.deepEqual(await publicEvent(), initialTheme, 'previews do not publish');
  await click(button('Cancel'));
  await wait(`!!${previewDoc}.querySelector('.w-original')`);
  await click("document.querySelectorAll('.theme-shelf button')[7]");
  await evaluate(`(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    for(const [label,v] of [['Warna background','#f2e5d5'],['Teks tombol Take Photo','Potret bersama']]){
      const el=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()===label).querySelector('input');
      set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
    }})()`);
  await wait(
    `${previewDoc}.querySelector('.hero-actions .btn-primary')?.textContent.trim()==='Potret bersama' && ${previewDoc}.defaultView.getComputedStyle(${previewDoc}.querySelector('.w-garden')).backgroundColor==='rgb(242, 229, 213)'`,
  );
  assert.deepEqual(await publicEvent(), initialTheme);
  if (process.env.THEME_QA_DIR) {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(process.env.THEME_QA_DIR, { recursive: true });
    const shot = await call('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    await writeFile(
      join(process.env.THEME_QA_DIR, 'theme-settings.jpg'),
      Buffer.from(shot.data, 'base64'),
    );
  }
  await click(button('Apply Theme'));
  await until(async () => (await publicEvent()).appearance.preset === 'garden', 'apply theme');
  assert.equal((await publicEvent()).appearance.buttonLabel, 'Potret bersama');
  await wait(
    "!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Save Changes') || Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Save Changes').disabled",
  );
  await call('Page.reload');
  await wait(
    `!!document.querySelector('.proof iframe')?.contentDocument.querySelector('.w-garden')`,
  );
  await click(button('Reset Theme'));
  await wait(`!!${previewDoc}.querySelector('.w-original')`);
  assert.equal((await publicEvent()).appearance.preset, 'garden');
  await click(button('Save Changes'));
  await until(async () => (await publicEvent()).appearance.preset === 'original', 'save reset');
  console.log(
    'PASS: ten themes at three viewport sizes, live colors/CTA, cancel/apply/reset, persistence and publication.',
  );
  await click('document.querySelector(\'a[href="/admin/settings"]\')');
  await wait("!!document.querySelector('.asset-grid input')");
  const cover = join(dir, 'cover.jpg');
  await writeFile(
    cover,
    await sharp({ create: { width: 650, height: 400, channels: 3, background: '#8e958c' } })
      .jpeg()
      .toBuffer(),
  );
  const tree = await call('DOM.getDocument');
  const node = await call('DOM.querySelector', {
    nodeId: tree.root.nodeId,
    selector: '.asset-grid input',
  });
  await call('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [cover] });
  await click(button('Gunakan hasil crop'));
  await click(button('Pratinjau halaman'));
  await wait("!!document.querySelector('.landing-preview .photo-arch img[src^=blob]')");
  await click('document.querySelector(\'button[aria-label="Tutup dialog"]\')');
  await click(button('Simpan pengaturan'));
  await until(
    async () =>
      await db
        .prepare("SELECT slot FROM project_images WHERE project_id='p' AND slot='hero'")
        .get(),
    'persist cropped cover',
  );
  await click('document.querySelector(\'a[href="/admin/filters"]\')');
  await click("document.querySelector('.filter-checks input')");
  await click(button('Simpan pengaturan'));
  await until(
    async () =>
      JSON.parse(
        (await db.prepare("SELECT filters_json FROM projects WHERE id='p'").get()).filters_json ??
          '[]',
      ).length === 9,
    'persist filters',
  );
  await click(button('Keluar'));
  await wait("!!document.querySelector('#email')");
  await login('root@example.org');
  await click('document.querySelector(\'a[href="/admin/users"]\')');
  await wait("document.querySelector('main table')?.innerText.includes('studio@example.org')");
  const fill = async (selector, value) =>
    evaluate(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  await click(
    "[...document.querySelectorAll('main tr')].find(row=>row.textContent.includes('studio@example.org')).querySelector('button')",
  );
  await fill('[role="dialog"] input[type="number"]', '100');
  await click(button('Simpan akun'));
  await wait("!document.querySelector('[role=dialog]')");
  await click(button('Keluar'));
  await wait("!!document.querySelector('#email')");
  await login('studio');
  await click('document.querySelector(\'a[href="/admin/qrs"]\')');
  for (const name of ['Resepsi A', 'Resepsi B']) {
    await click(button('Buat QR code'));
    await wait("!!document.querySelector('#qr-label')");
    await fill('#qr-label', name);
    await fill('#qr-total', '50');
    await fill('#qr-per', '2');
    await wait("document.querySelector('.quota-calculator')?.textContent.includes('25 sesi')");
    await click("document.querySelector('.modal-actions .btn-primary')");
    await wait(
      `!document.querySelector('[role=dialog]') && document.querySelector('.qr-table')?.textContent.includes(${JSON.stringify(name)})`,
    );
  }
  await wait(
    "document.querySelector('.admin-page-title button')?.disabled && document.querySelector('[aria-label=\"Saldo kuota akun\"]')?.textContent.includes('Tersedia untuk QR 0')",
  );
  console.log(
    'PASS: admin grants 100 photos, studio creates two 50-photo QR codes, each allows 25 sessions, third allocation blocked.',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: landing, scoped navigation, 11 camera presets, full-resolution JPEGs, desktop/mobile viewports and exhausted quota after refresh.',
  );
} catch (error) {
  console.error(error.message);
  throw error;
} finally {
  if (closeBrowser) {
    closeBrowser().catch(() => {});
    await Promise.race([closed, delay(3000)]);
  }
  socket?.close();
  if (browser && browser.exitCode === null) {
    browser.kill();
    await Promise.race([closed, delay(2000)]);
  }
  if (server) {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
  db.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
}
