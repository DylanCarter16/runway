// Renders the app icons in public/icons from one SVG. Run after changing the artwork:
// node scripts/make-icons.mjs
// sharp comes with Next.js (image optimization), so it needs no extra install.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const TIE = '#B8135F';
const WHITE = '#FFFFFF';

/**
 * The runway bar from DESIGN.md: a track, most of its prep window filled, and the "now" tick.
 * `pad` shrinks the artwork toward the centre (maskable icons keep it inside the 80% safe zone).
 */
function svg({ pad, radius }) {
  const inner = 512 - pad * 2;
  const s = inner / 512;
  const t = (n) => pad + n * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${TIE}"/>
  <rect x="${t(96)}" y="${t(236)}" width="${320 * s}" height="${40 * s}" rx="${20 * s}" fill="none" stroke="${WHITE}" stroke-width="${14 * s}"/>
  <rect x="${t(96)}" y="${t(236)}" width="${216 * s}" height="${40 * s}" rx="${20 * s}" fill="${WHITE}"/>
  <rect x="${t(322)}" y="${t(176)}" width="${16 * s}" height="${160 * s}" rx="${8 * s}" fill="${WHITE}"/>
</svg>`;
}

const OUT = path.join(import.meta.dirname, '..', 'public', 'icons');

const targets = [
  { file: 'icon-192.png', size: 192, pad: 0, radius: 96 },
  { file: 'icon-512.png', size: 512, pad: 0, radius: 96 },
  // Full-bleed square; the platform applies its own mask.
  { file: 'icon-maskable-512.png', size: 512, pad: 56, radius: 0 },
  // iOS rounds the corners itself and shows transparency as black.
  { file: 'apple-touch-icon.png', size: 180, pad: 16, radius: 0 },
];

await mkdir(OUT, { recursive: true });
for (const { file, size, pad, radius } of targets) {
  await sharp(Buffer.from(svg({ pad, radius })))
    .resize(size, size)
    .png()
    .toFile(path.join(OUT, file));
  console.log(`wrote public/icons/${file}`);
}
