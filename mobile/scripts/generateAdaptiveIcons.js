/* eslint-disable no-console */
// Generates the Android adaptive-icon layers from the Doorline brand mark
// (the red map-pin with a white doorway — see components/Logo.jsx `LogoMark`).
//
// Why this exists: Android masks the adaptive-icon FOREGROUND to a circle/squircle
// and only guarantees the inner ~66% "safe zone" is visible. The old config pointed
// `adaptiveIcon.foregroundImage` at the full-bleed `appstore.png`, so the launcher
// cropped its edges and the logo looked zoomed-in. This renders the pin padded
// inside the safe zone on a transparent canvas, so it sits centered like on iOS.
//
//   node scripts/generateAdaptiveIcons.js
//
// Outputs (referenced from app.json android.adaptiveIcon):
//   assets/AppIcons/adaptive-foreground.png  — red pin + white door, transparent bg
//   assets/AppIcons/adaptive-monochrome.png  — single-color silhouette for themed icons

const path = require('path');
const sharp = require('sharp');

const BRAND = '#DC2626'; // colors.brand
const CANVAS = 1024; // adaptive-icon layer size
const PIN_HEIGHT = 600; // keep within the ~625px safe-zone circle, centered
const PIN_W_UNITS = 36; // LogoMark viewBox is 0 0 36 44
const PIN_H_UNITS = 44;

const scale = PIN_HEIGHT / PIN_H_UNITS;
const pinWidth = PIN_W_UNITS * scale;
const offsetX = (CANVAS - pinWidth) / 2;
const offsetY = (CANVAS - PIN_HEIGHT) / 2;

// Paths copied verbatim from LogoMark so the app icon and in-app logo stay identical.
const PIN_OUTER =
  'M18 0 C8.06 0 0 8.06 0 18 C0 29.5 12 36.5 17 43.2 C17.5 43.9 18.5 43.9 19 43.2 C24 36.5 36 29.5 36 18 C36 8.06 27.94 0 18 0 Z';
const DOORWAY =
  'M12 11 L12 26 L24 26 L24 11 C24 8.79 22.21 7 20 7 L16 7 C13.79 7 12 8.79 12 11 Z';
const KNOB = { x: 20.4, y: 17.2, w: 1.8, h: 1.8, r: 0.9 };

function group(inner) {
  return `<g transform="translate(${offsetX} ${offsetY}) scale(${scale})">${inner}</g>`;
}

// Full-color foreground: red pin, white doorway cut, red knob.
const foregroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">${group(
  `<path d="${PIN_OUTER}" fill="${BRAND}"/>` +
    `<path d="${DOORWAY}" fill="#ffffff"/>` +
    `<rect x="${KNOB.x}" y="${KNOB.y}" width="${KNOB.w}" height="${KNOB.h}" rx="${KNOB.r}" fill="${BRAND}"/>`
)}</svg>`;

// Monochrome layer (Android 13+ themed icons): a single opaque silhouette with the
// doorway as a real hole (even-odd compound path); the OS tints it. White on
// transparent — the system uses the alpha, not the color.
const monochromeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">${group(
  `<path fill-rule="evenodd" d="${PIN_OUTER} ${DOORWAY}" fill="#ffffff"/>`
)}</svg>`;

const outDir = path.join(__dirname, '..', 'assets', 'AppIcons');

async function render(svg, filename) {
  const out = path.join(outDir, filename);
  await sharp(Buffer.from(svg)).png().toFile(out);
  const meta = await sharp(out).metadata();
  console.log(`wrote ${filename} (${meta.width}x${meta.height})`);
}

(async () => {
  await render(foregroundSvg, 'adaptive-foreground.png');
  await render(monochromeSvg, 'adaptive-monochrome.png');
  console.log('done');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
