import catalog from '../server/filter-presets.json' with { type: 'json' };
export type FilterName = string;
export const names = catalog.map((p) => p.name);
const presets = Object.fromEntries(catalog.map((p) => [p.name, p]));
// Precompute the channel curves once for preview, thumbnails and the capture.
const tables = Object.fromEntries(
  catalog.map(({ name, contrast, red, green, blue }) => [
    name,
    [red, green, blue].map((offset) =>
      Float32Array.from({ length: 256 }, (_, i) => (i - 128) * contrast + 128 + offset),
    ),
  ]),
);
export function gradePixels(pixels: Uint8ClampedArray, name: FilterName) {
  if (name === 'Original') return;
  const { saturation: sat, grain } = presets[name],
    [red, green, blue] = tables[name];
  let seed = 127;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i],
      g = pixels[i + 1],
      b = pixels[i + 2],
      l = (54 * r + 183 * g + 19 * b) >>> 8;
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const noise = ((seed >>> 24) / 255 - 0.5) * grain;
    pixels[i] = red[Math.max(0, Math.min(255, Math.round(l + (r - l) * sat)))] + noise;
    pixels[i + 1] = green[Math.max(0, Math.min(255, Math.round(l + (g - l) * sat)))] + noise;
    pixels[i + 2] = blue[Math.max(0, Math.min(255, Math.round(l + (b - l) * sat)))] + noise;
  }
}
export function renderFrame(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  name: FilterName,
  mirror = false,
) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw Error('Kanvas foto tidak tersedia.');
  const { width: w, height: h } = canvas;
  ctx.save();
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, w, h);
  ctx.restore();
  if (name === 'Original') return;
  if (presets[name].softFocus) {
    const dx = Math.max(1, Math.round(w / 300));
    ctx.save();
    ctx.globalAlpha = presets[name].softFocus;
    ctx.drawImage(canvas, dx, 0, w, h);
    ctx.drawImage(canvas, -dx, dx, w, h);
    ctx.restore();
  }
  const frame = ctx.getImageData(0, 0, w, h);
  gradePixels(frame.data, name);
  ctx.putImageData(frame, 0, 0);
}
