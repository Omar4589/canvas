// Optimize raw marketing screenshots (client/shots-raw/, gitignored) into the
// committed webp assets the landing page imports (client/src/assets/marketing/).
// Usage: npm run shots:optimize              (sharp is already a devDependency via og:image)
//        npm run shots:optimize -- map.png   (only the named raw captures; the rest stay untouched)
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.resolve(__dirname, '../shots-raw');
const OUT = path.resolve(__dirname, '../src/assets/marketing');

// name → max output width (px). Raw captures are 2880-wide (1440 @ 2x DPR).
// `extract` (optional) crops the raw capture first, in RAW pixels. The hero shows the map alone: the
// whole console rendered at ~27% scale, so its sidebar and filter column read as noise, and the toast
// and phone overlays in Hero.jsx carry the "live field app" half of the story. The crop keeps the
// Mapbox logo and attribution along the bottom edge.
const BUDGETS = {
  'map.png': { out: 'shot-map.webp', width: 1400, extract: { left: 1060, top: 445, width: 1820, height: 1355 } }, // hero
  'turfs.png': { out: 'shot-turfs.webp', width: 1600 },
  'timeline.png': { out: 'shot-timeline.webp', width: 1600 },
  'portal.png': { out: 'shot-portal.webp', width: 1600 },
  'phone-books.png': { out: 'shot-phone-books.webp', width: 760 },   // real device shots (1206 wide)
  'phone-door.png': { out: 'shot-phone-door.webp', width: 760 },
  'phone-survey.png': { out: 'shot-phone-survey.webp', width: 760 },
};

const only = process.argv.slice(2);

fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [src, { out, width, extract }] of Object.entries(BUDGETS)) {
  if (only.length && !only.includes(src)) continue;
  const from = path.join(RAW, src);
  if (!fs.existsSync(from)) {
    console.log(`skip ${src} (not captured)`);
    continue;
  }
  const to = path.join(OUT, out);
  const img = sharp(from);
  const meta = await img.metadata();
  if (extract) img.extract(extract);
  const outWidth = Math.min(width, extract ? extract.width : meta.width);
  await img
    .resize({ width: outWidth, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(to);
  const kb = Math.round(fs.statSync(to).size / 1024);
  total += kb;
  console.log(`${src} → ${out}  ${outWidth}w  ${kb} KB`);
}
console.log(`total: ${total} KB${total > 1200 ? '  ⚠️ over the ~1.2 MB budget' : ''}`);
