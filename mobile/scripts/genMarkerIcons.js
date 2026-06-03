// Generates the status-colored building/book marker sprites used by the canvasser
// map (map.jsx) and books overview (books.jsx). These replaced the old
// Mapbox.MarkerView overlays — which intercepted pinch-zoom touches — with native
// SymbolLayer icons that never block map gestures.
//
// The glyph paths mirror the original BuildingGlyph / BookGlyph SVGs; only the
// fill is swapped per status. Output is 128x128 PNGs (matching the house-* pins)
// into assets/icons/. Re-run after a design change:  node scripts/genMarkerIcons.js
//
// Requires `sharp` (already a dependency).

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Must match STATUS_COLOR in the (now-removed) marker components.
const STATUS_COLORS = { grey: '#9ca3af', yellow: '#f59e0b', green: '#22c55e' };

const SIZE = 128; // px, matches house-*.png

function buildingSvg(color) {
  const windows = Array.from({ length: 12 }, (_, i) => {
    const r = Math.floor(i / 3);
    const c = i % 3;
    return `<rect x="${7 + c * 3.6}" y="${5 + r * 3.6}" width="2.2" height="2.2" rx="0.4" fill="#ffffff" opacity="0.9"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24">
    <rect x="5" y="2.5" width="14" height="19" rx="1.4" fill="${color}" stroke="#ffffff" stroke-width="1.3"/>
    ${windows}
  </svg>`;
}

function bookSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24">
    <rect x="4" y="3" width="15.5" height="18" rx="1.8" fill="${color}" stroke="#ffffff" stroke-width="1.4"/>
    <line x1="7.4" y1="3.6" x2="7.4" y2="20.4" stroke="#ffffff" stroke-width="1.1" opacity="0.85"/>
    <line x1="10" y1="8" x2="16.5" y2="8" stroke="#ffffff" stroke-width="1.1" opacity="0.7"/>
    <line x1="10" y1="11" x2="16.5" y2="11" stroke="#ffffff" stroke-width="1.1" opacity="0.7"/>
    <line x1="10" y1="14" x2="14.5" y2="14" stroke="#ffffff" stroke-width="1.1" opacity="0.7"/>
  </svg>`;
}

async function main() {
  const outDir = path.join(__dirname, '..', 'assets', 'icons');
  fs.mkdirSync(outDir, { recursive: true });
  const jobs = [];
  for (const [name, color] of Object.entries(STATUS_COLORS)) {
    jobs.push(['building-' + name, buildingSvg(color)]);
    jobs.push(['book-' + name, bookSvg(color)]);
  }
  for (const [file, svg] of jobs) {
    const out = path.join(outDir, file + '.png');
    await sharp(Buffer.from(svg)).png().toFile(out);
    console.log('wrote', path.relative(path.join(__dirname, '..'), out));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
