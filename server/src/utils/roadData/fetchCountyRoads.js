// Download one county's TIGER/Line ROADS layer and write the compact artifact the
// road-aware turf cut reads. Mirrors utils/demoData/fetchDemoAddresses.js: fetched
// OFFLINE by a developer, the RESULT is committed, and nothing hits the network at
// runtime. That keeps census.gov out of the request path entirely — no third party
// ever sees a customer coordinate, so there is no DPA §6 subprocessor question.
//
//   node src/utils/roadData/fetchCountyRoads.js 12021        # Collier County, FL
//   node src/utils/roadData/fetchCountyRoads.js 12021 --year 2024
//
// TIGER/Line is a work of the US Census Bureau — a US federal government work, so it
// is PUBLIC DOMAIN: no attribution obligation, no share-alike, free for commercial
// use. (OpenStreetMap maps these streets in more detail but carries ODbL share-alike,
// which is why TIGER is the default.)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { readFileSync, rmSync } from 'node:fs';

import { readRoads } from '../../services/turf/roads/shapefile.js';
import { encodeRoads } from '../../services/turf/roads/artifact.js';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../data/roads');

const fips = process.argv[2];
const yearArg = process.argv.indexOf('--year');
const year = yearArg > 0 ? process.argv[yearArg + 1] : '2024';

if (!/^\d{5}$/.test(fips || '')) {
  console.error('usage: node src/utils/roadData/fetchCountyRoads.js <5-digit county FIPS> [--year YYYY]');
  console.error('  e.g. 12021 = Collier County FL, 12071 = Lee County FL');
  process.exit(1);
}

const url = `https://www2.census.gov/geo/tiger/TIGER${year}/ROADS/tl_${year}_${fips}_roads.zip`;
const work = join(tmpdir(), `tiger-${fips}-${year}`);

console.log(`fetching ${url}`);
mkdirSync(work, { recursive: true });
const zip = join(work, 'roads.zip');
// curl/unzip rather than a dependency: this is a developer script, not server code.
execFileSync('curl', ['-sSL', '--fail', '-o', zip, url], { stdio: 'inherit' });
execFileSync('unzip', ['-o', '-q', zip, '-d', work], { stdio: 'inherit' });

const shp = readFileSync(join(work, `tl_${year}_${fips}_roads.shp`));
const dbf = readFileSync(join(work, `tl_${year}_${fips}_roads.dbf`));
const roads = readRoads(shp, dbf);
if (!roads.length) throw new Error('no walkable roads parsed — wrong layer or an empty county?');

const artifact = encodeRoads(roads, { fips, year });
mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, `${fips}.json`);
writeFileSync(out, JSON.stringify(artifact));
rmSync(work, { recursive: true, force: true });

const vertices = roads.reduce((s, r) => s + r.coords.length, 0);
console.log(`wrote ${out}`);
console.log(`  ${roads.length} walkable lines, ${vertices} vertices`);
console.log(`  ${(JSON.stringify(artifact).length / 1048576).toFixed(2)} MB on disk`);
console.log('  commit this file — it is public-domain geometry and is read at cut time');
