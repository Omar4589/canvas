// Optimize raw marketing screenshots (client/shots-raw/, gitignored) into the
// committed webp assets the landing page imports (client/src/assets/marketing/).
// Usage: npm run shots:optimize   (sharp is already a devDependency via og:image)
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.resolve(__dirname, '../shots-raw');
const OUT = path.resolve(__dirname, '../src/assets/marketing');

// name → max output width (px). Raw captures are 2880-wide (1440 @ 2x DPR).
const BUDGETS = {
  'map.png': { out: 'shot-map.webp', width: 2200 },      // hero — largest on screen
  'turfs.png': { out: 'shot-turfs.webp', width: 1600 },
  'timeline.png': { out: 'shot-timeline.webp', width: 1600 },
  'portal.png': { out: 'shot-portal.webp', width: 1600 },
  'dashboard.png': { out: 'shot-dashboard.webp', width: 1600 },
  'phone-books.png': { out: 'shot-phone-books.webp', width: 900 },
  'phone-door.png': { out: 'shot-phone-door.webp', width: 900 },
};

fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [src, { out, width }] of Object.entries(BUDGETS)) {
  const from = path.join(RAW, src);
  if (!fs.existsSync(from)) {
    console.log(`skip ${src} (not captured)`);
    continue;
  }
  const to = path.join(OUT, out);
  const img = sharp(from);
  const meta = await img.metadata();
  await img
    .resize({ width: Math.min(width, meta.width), withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(to);
  const kb = Math.round(fs.statSync(to).size / 1024);
  total += kb;
  console.log(`${src} → ${out}  ${Math.min(width, meta.width)}w  ${kb} KB`);
}
console.log(`total: ${total} KB${total > 1200 ? '  ⚠️ over the ~1.2 MB budget' : ''}`);
