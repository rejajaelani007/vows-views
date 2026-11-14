/** Export both share cards. The price and demo URL come from the supplied reference;
 * set PROMO_WHATSAPP to an authorized contact when the brand supplies one. */
import sharp from 'sharp';
import QRCode from 'qrcode';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile } from 'node:fs/promises';
const target = fileURLToPath(new URL('../docs/promosi/', import.meta.url));
const photo = await sharp(
  await readFile(new URL('../src/assets/wedding-editorial.webp', import.meta.url)),
)
  .jpeg({ quality: 89 })
  .toBuffer();
const demo = 'https://wedding-cam-gallery.vercel.app/';
const qr = QRCode.create(demo, { errorCorrectionLevel: 'M' }).modules;
const wine = '#491d30',
  garnet = '#722e47',
  cream = '#fff8ed',
  pink = '#f1d9d6',
  gold = '#9f774b',
  ink = '#3c2a2d';
const xml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (k) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[k],
  );
const txt = (x, y, s, size, opts = {}) =>
  `<text x="${x}" y="${y}" font-family="${opts.family || 'Segoe UI,Arial,sans-serif'}" font-size="${size}" fill="${opts.color || ink}" font-weight="${opts.bold ? 700 : 400}" font-style="${opts.italic ? 'italic' : 'normal'}" letter-spacing="${opts.spacing || 0}">${xml(s)}</text>`;
const serif = (x, y, s, n, o) => txt(x, y, s, n, { family: 'Georgia,serif', color: wine, ...o });
const label = (x, y, s, o = {}) =>
  txt(x, y, s, 18, { bold: true, spacing: 2.3, color: gold, ...o });
const rect = (x, y, w, h, fill, rx = 0) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>`;
const line = (x, y, x2, y2, c = gold) =>
  `<path d="M${x} ${y}L${x2} ${y2}" fill="none" stroke="${c}" stroke-width="1.6"/>`;
const pic = (x, y, w, h) =>
  `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" xlink:href="data:image/jpeg;base64,${photo.toString('base64')}"/></svg>`;
const bloom = (x, y, r) =>
  `<g transform="translate(${x} ${y})" fill="none" stroke="#bd9c79" stroke-width="1.8">${Array.from({ length: 8 }, (_, i) => `<ellipse cx="0" cy="${-r * 0.56}" rx="${r * 0.33}" ry="${r * 0.52}" transform="rotate(${i * 45})"/>`).join('')}<circle r="${r * 0.18}"/></g>`;
function floral(x, y) {
  return `<g transform="translate(${x} ${y})"><path d="M0 78Q92 75 152 0M30 73Q30 42 61 40Q59 63 30 73M64 60Q89 65 106 46Q80 43 64 60" stroke="#b49673" fill="none" stroke-width="2.5"/>${bloom(110, 28, 22)}${bloom(139, 16, 12)}</g>`;
}
function qrBox(x, y, unit) {
  const pad = 4 * unit,
    n = qr.size,
    w = (n + 8) * unit;
  let d = '';
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.get(r, c)) d += `M${pad + c * unit} ${pad + r * unit}h${unit}v${unit}h-${unit}z`;
  return `<g transform="translate(${x} ${y})" shape-rendering="crispEdges">${rect(0, 0, w, w, '#fff')}<path d="${d}" fill="#21151c"/></g>`;
}
function phone(x, y, scale, dashboard = false) {
  let inside = '';
  if (dashboard) {
    inside += label(21, 66, 'STUDIO', { spacing: 1.5 });
    inside += serif(21, 108, 'Dashboard', 31);
    inside +=
      rect(20, 127, 161, 67, '#eedcd9', 7) +
      txt(31, 151, 'Project wedding', 14) +
      txt(31, 175, 'Galeri tamu', 19, { bold: true });
    ['Landing page', 'Theme Settings', 'QR codes', 'Photo library'].forEach((v, i) => {
      inside +=
        rect(22, 213 + 39 * i, 8, 8, i % 2 ? gold : garnet, 2) +
        txt(40, 223 + 39 * i, v, 17) +
        line(22, 232 + i * 39, 178, 232 + i * 39, '#dfd4c6');
    });
  } else {
    inside +=
      txt(19, 65, 'WEDDING CAMERA', 14, { bold: true, spacing: 1.1 }) +
      pic(12, 77, 178, 171) +
      rect(12, 248, 178, 141, cream) +
      txt(22, 273, '10 Camera Filters', 17, { bold: true }) +
      rect(20, 285, 86, 22, pink, 9) +
      txt(26, 301, 'Wedding Glow', 11, { bold: true }) +
      txt(112, 301, 'Romantic', 12) +
      `<circle cx="100" cy="346" r="26" fill="none" stroke="${garnet}" stroke-width="2"/><circle cx="100" cy="346" r="20" fill="${garnet}"/>`;
  }
  return `<g transform="translate(${x} ${y}) scale(${scale})">${rect(4, 7, 202, 403, '#32152155', 28)}${rect(0, 0, 202, 403, '#372a2d', 28)}${rect(6, 6, 190, 391, cream, 23)}${rect(69, 13, 65, 9, '#372a2d', 5)}${inside}${rect(75, 383, 52, 4, '#8f7e78', 2)}</g>`;
}
function scene(y, h) {
  return (
    rect(0, y, 1080, h, '#e8d7c4') +
    pic(0, y, 622, h) +
    rect(622, y, 458, h, pink) +
    floral(902, y + 8) +
    label(652, y + 35, 'PRODUCT PREVIEW', { color: garnet }) +
    phone(830, y + 64, 0.85, true) +
    phone(642, y + 52, 0.96, false)
  );
}
function bar(y) {
  return (
    rect(0, y, 1080, 66, wine) +
    label(55, y + 41, 'PAKET FOTO DIGITAL', { color: '#e6cbb5' }) +
    serif(629, y + 45, 'Rp1.000 / foto', 39, { color: cream })
  );
}
function mast(y) {
  return (
    serif(54, y, 'Vows & Views', 48) +
    label(635, y - 4, 'WEDDING PHOTOGRAPHY', { spacing: 2.1 }) +
    line(55, y + 19, 1025, y + 19)
  );
}
function footer(y, h, story) {
  const unit = 5,
    w = (qr.size + 8) * unit;
  return (
    rect(0, y, 1080, h, wine) +
    label(54, y + 43, 'COBA DEMO', { color: '#f2d3ac' }) +
    serif(54, y + 98, 'Buat kenangan pernikahanmu', 39, { color: cream }) +
    serif(54, y + 145, 'lebih berkesan!', 43, { color: cream, italic: true }) +
    txt(55, y + 191, 'wedding-cam-gallery.vercel.app', 29, { color: cream }) +
    txt(55, y + 228, 'WhatsApp: ' + (process.env.PROMO_WHATSAPP || '[kontak studio]'), 25, {
      color: '#f2d5d5',
    }) +
    qrBox(1028 - w, y + 28, unit) +
    (story ? floral(850, y + 275) : '')
  );
}
function story() {
  return (
    mast(251) +
    label(55, 329, 'KAMERA TAMU  /  GALERI PERNIKAHAN') +
    serif(50, 415, 'Abadikan Momen Bahagia,', 72) +
    serif(54, 484, 'Kumpulkan Kenangan', 61, { italic: true }) +
    serif(54, 549, 'dari Setiap Tamu!', 61, { italic: true }) +
    txt(56, 601, 'Scan QR dari HP, ambil foto tanpa instal aplikasi.', 34) +
    scene(625, 448) +
    bar(1073) +
    label(55, 1184, 'UNTUK TAMU & PENYELENGGARA') +
    txt(55, 1228, '10 filter kamera', 39, { bold: true }) +
    txt(55, 1267, 'Wedding Glow, Romantic, Vintage Brown, Classic Film & lainnya.', 27) +
    line(55, 1292, 1024, 1292) +
    txt(55, 1336, '10 tema pernikahan', 39, { bold: true }) +
    txt(55, 1377, 'Atur halaman, QR, dan kuota foto tamu dari dashboard.', 29) +
    txt(55, 1413, 'Foto yang dikirim otomatis masuk ke satu galeri digital.', 29) +
    footer(1440, 480, true)
  );
}
function feed() {
  return (
    mast(76) +
    label(55, 139, 'KAMERA TAMU  /  GALERI PERNIKAHAN') +
    serif(52, 218, 'Abadikan Momen Bahagia,', 72) +
    serif(53, 278, 'Kumpulkan Kenangan dari Setiap Tamu!', 48, { italic: true }) +
    txt(56, 326, 'Scan QR dengan smartphone. Ambil foto tanpa instal aplikasi.', 30) +
    scene(353, 452) +
    bar(805) +
    label(54, 914, '01  /  UNTUK TAMU') +
    label(552, 914, '02  /  DASHBOARD ACARA') +
    serif(54, 962, '10 filter kamera', 39) +
    serif(552, 962, '10 tema pernikahan', 39) +
    line(530, 899, 530, 1077, '#cebaa7') +
    txt(54, 1001, 'Wedding Glow, Romantic, Vintage Brown,', 23) +
    txt(54, 1033, 'Classic Film & lainnya. Kuota per tamu.', 23) +
    txt(54, 1065, 'Kirim foto → otomatis masuk satu galeri.', 23) +
    txt(552, 1001, 'Atur landing page, foto, dan background.', 23) +
    txt(552, 1033, 'Sesuaikan tampilan dan kelola QR Code.', 23) +
    txt(552, 1065, 'Lihat foto tamu dan kelola galeri digital.', 23) +
    footer(1094, 256, false)
  );
}
await mkdir(target, { recursive: true });
for (const [name, h, content] of [
  ['story-status', 1920, story()],
  ['feed-portrait', 1350, feed()],
]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="${h}">${rect(0, 0, 1080, h, cream)}${rect(0, 0, 1080, 12, garnet)}${h === 1920 ? floral(862, 78) : ''}${content}</svg>`;
  await sharp(Buffer.from(svg))
    .png()
    .toFile(target + 'vows-views-' + name + '.png');
}
