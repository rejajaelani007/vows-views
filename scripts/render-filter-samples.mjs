// Regenerate after changing a preset: node --experimental-strip-types scripts/render-filter-samples.mjs
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import catalog from '../server/filter-presets.json' with { type: 'json' };
import { gradePixels } from '../src/camera-filters.ts';

const directory = new URL('../src/assets/filter-samples/', import.meta.url);
await mkdir(directory, { recursive: true });
const width = 144;
const height = 96;
const sample = await sharp(
  fileURLToPath(new URL('../src/assets/wedding-editorial.webp', import.meta.url)),
)
  .resize(width, height, { fit: 'cover' })
  .ensureAlpha()
  .raw()
  .toBuffer();
for (const preset of catalog) {
  const pixels = new Uint8ClampedArray(sample);
  if (preset.softFocus) {
    // Same two one-pixel offsets as renderFrame at thumbnail size.
    for (const [dx, dy] of [
      [1, 0],
      [-1, 1],
    ]) {
      const previous = pixels.slice();
      for (let y = dy; y < height; y++) {
        for (let x = Math.max(0, dx); x < Math.min(width, width + dx); x++) {
          const to = (y * width + x) * 4;
          const from = ((y - dy) * width + x - dx) * 4;
          for (let c = 0; c < 3; c++)
            pixels[to + c] += (previous[from + c] - previous[to + c]) * preset.softFocus;
        }
      }
    }
  }
  gradePixels(pixels, preset.name);
  const file = preset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.webp';
  await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } })
    .removeAlpha()
    .webp({ quality: 78 })
    .toFile(fileURLToPath(new URL(file, directory)));
}
