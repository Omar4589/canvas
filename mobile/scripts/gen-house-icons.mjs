// Generates the 4 colored house map-icon PNGs used by the mobile map.
// Run with: node scripts/gen-house-icons.mjs (from mobile/).
//
// Output: mobile/assets/icons/house-{status}.png at 128x128 (2x density of 64x64).
// Modern two-tone house: rounded body in the status color, slightly darker
// roof, small white window + door, soft drop shadow. One pre-colored variant
// per canvass status — the streets-v12 sprite no longer bundles Maki icons.

import { fileURLToPath } from 'url';
import path from 'path';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../assets/icons');

const STATUS_COLORS = {
  unknocked: '#9ca3af',
  not_home: '#3b82f6',
  surveyed: '#22c55e',
  wrong_address: '#ef4444',
};

function darken(hex, amount = 0.2) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - amount)));
  return `rgb(${r},${g},${b})`;
}

// 64×64 logical, exported at 128×128 for crisp rendering at @2x.
function houseSvg(color) {
  const dark = darken(color);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <ellipse cx="32" cy="60" rx="19" ry="2.8" fill="rgba(0,0,0,0.22)"/>
  <rect x="11" y="28" width="42" height="26" rx="3" fill="${color}" stroke="#ffffff" stroke-width="2"/>
  <path d="M 6 30 L 31 8 Q 32 7, 33 8 L 58 30 Z"
        fill="${dark}" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
  <rect x="17" y="34" width="9" height="9" rx="1.5" fill="#ffffff"/>
  <line x1="21.5" y1="34" x2="21.5" y2="43" stroke="${color}" stroke-width="1"/>
  <line x1="17" y1="38.5" x2="26" y2="38.5" stroke="${color}" stroke-width="1"/>
  <rect x="32" y="38" width="11" height="16" rx="1.5" fill="#ffffff"/>
  <circle cx="41" cy="47" r="0.9" fill="${dark}"/>
</svg>`;
}

for (const [status, color] of Object.entries(STATUS_COLORS)) {
  const out = path.join(OUT_DIR, `house-${status}.png`);
  await sharp(Buffer.from(houseSvg(color)))
    .resize(128, 128)
    .png()
    .toFile(out);
  console.log(`wrote ${out}`);
}
