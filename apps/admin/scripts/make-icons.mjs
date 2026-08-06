// Regenerates every PWA/favicon icon asset from branding/proplyst-logo.png. Re-run this
// (`node scripts/make-icons.mjs` from apps/admin/) whenever the source logo changes -- run once
// this session (2026-08-06) to derive public/icons/* from the source lockup.
import sharp from 'sharp';
import fs from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'branding', 'proplyst-logo.png');
const OUT = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

// Background sampled from the logo's own corner (a near-black navy, not pure #000) -- keeps every
// generated icon visually consistent with the source lockup rather than introducing a mismatched
// flat colour.
const BG = { r: 0, g: 6, b: 21, alpha: 1 };

// The source lockup (555x319) is the full "Proplyst" wordmark + tagline; app icons need just the
// mark (P + skyline + house) -- the wordmark is illegible at 192px and below. Bounding box found
// by iterative visual crop-and-check this session.
const MARK_CROP = { left: 178, top: 2, width: 195, height: 192 };

async function croppedMark() {
  return sharp(SRC).extract(MARK_CROP).toBuffer();
}

// Standard icons ("any" purpose): mark filling most of the square, small margin.
async function standardIcon(size, outPath) {
  const mark = await croppedMark();
  const inner = Math.round(size * 0.86);
  const resizedMark = await sharp(mark).resize(inner, inner, { fit: 'contain', background: BG }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: resizedMark, gravity: 'center' }])
    .png()
    .toFile(outPath);
}

// Maskable icon: mark must stay within the ~80% "safe zone" so an aggressive OS circle/squircle
// crop never clips it -- more padding than the standard icons, background fills edge-to-edge.
async function maskableIcon(size, outPath) {
  const mark = await croppedMark();
  const inner = Math.round(size * 0.6);
  const resizedMark = await sharp(mark).resize(inner, inner, { fit: 'contain', background: BG }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: resizedMark, gravity: 'center' }])
    .png()
    .toFile(outPath);
}

await standardIcon(192, path.join(OUT, 'icon-192.png'));
await standardIcon(512, path.join(OUT, 'icon-512.png'));
await maskableIcon(512, path.join(OUT, 'icon-maskable-512.png'));
await standardIcon(180, path.join(OUT, 'apple-touch-icon.png')); // Apple's recommended exact size
await standardIcon(32, path.join(OUT, 'favicon-32.png'));

console.log('Icons written to', OUT);
