// Rasterizes the marketing/social SVG sources in public/ to committed PNGs:
//   og-image.svg          -> og-image.png         (1200x630, Open Graph card)
//   apple-touch-icon.svg  -> apple-touch-icon.png (180x180, iOS home-screen icon)
// Social scrapers / iOS need a raster image, so we generate these locally and
// commit the PNGs. Deliberately NOT part of the production build (no build-host
// font/raster surprises). Run after editing a source SVG:
//   npm run og:image
// Requires the `sharp` devDependency.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const dir = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(dir, '..', 'public');

const ASSETS = [
  { svg: 'og-image.svg', png: 'og-image.png', w: 1200, h: 630 },
  { svg: 'apple-touch-icon.svg', png: 'apple-touch-icon.png', w: 180, h: 180 },
];

async function main() {
  for (const { svg, png, w, h } of ASSETS) {
    // Higher density renders the SVG crisply, then fit exactly to target size.
    await sharp(readFileSync(path.join(pub, svg)), { density: 144 })
      .resize(w, h, { fit: 'fill' })
      .png()
      .toFile(path.join(pub, png));
    console.log('wrote', path.relative(path.join(dir, '..'), path.join(pub, png)));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
