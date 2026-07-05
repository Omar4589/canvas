// One-time dev helper: trace real residential street centerlines from OpenStreetMap
// (Overpass API) and write demoStreets.json, the committed fixture seedDemoOrg.js
// generates demo households from. The seed script itself never touches the network —
// re-run this only if you want a different neighborhood or a fresh trace.
//
//   node src/utils/demoData/fetchDemoStreets.js
//
// Geometry is clipped to the bbox (Overpass returns full ways for anything that
// touches it), then segments are picked longest-first with a per-street cap so the
// fixture covers many distinct street names instead of a few mile-long ways.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Beaverdale / northwest Des Moines, IA — caucus country, dense single-family grid.
const BBOX = [41.598, -93.678, 41.618, -93.648]; // [south, west, north, east]
const MIN_SEGMENT_M = 150;
const TARGET_TOTAL_M = 14000;
const MAX_SEGMENTS = 55;
const MAX_PER_STREET = 2;

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const [S, W, N, E] = BBOX;
const query = `[out:json][timeout:60];way["highway"="residential"]["name"](${S},${W},${N},${E});out geom;`;

function segmentLengthMeters(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const x = dLng * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
    total += 6371000 * Math.hypot(dLat, x);
  }
  return total;
}

async function fetchOverpass() {
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        // Overpass 406s requests without a descriptive User-Agent.
        headers: {
          'User-Agent': 'doorline-demo-fixture/1.0 (one-time street trace)',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (res.ok) return await res.json();
      console.warn(`${url} → ${res.status}, trying next endpoint`);
    } catch (err) {
      console.warn(`${url} failed: ${err.message}, trying next endpoint`);
    }
  }
  throw new Error('All Overpass endpoints failed');
}

const data = await fetchOverpass();

const inside = (p) => p.lat >= S && p.lat <= N && p.lon >= W && p.lon <= E;

// Clip each way to maximal runs of consecutive in-bbox points.
const segments = [];
for (const way of data.elements || []) {
  const name = way.tags?.name;
  if (!name || !way.geometry) continue;
  let run = [];
  for (const p of [...way.geometry, null]) {
    if (p && inside(p)) {
      run.push([Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))]);
    } else {
      if (run.length >= 2) {
        const lengthM = Math.round(segmentLengthMeters(run));
        if (lengthM >= MIN_SEGMENT_M) segments.push({ name, lengthM, coords: run });
      }
      run = [];
    }
  }
}

segments.sort((a, b) => b.lengthM - a.lengthM);
const perStreet = new Map();
const picked = [];
let total = 0;
for (const seg of segments) {
  if (total >= TARGET_TOTAL_M || picked.length >= MAX_SEGMENTS) break;
  const count = perStreet.get(seg.name) || 0;
  if (count >= MAX_PER_STREET) continue;
  perStreet.set(seg.name, count + 1);
  picked.push(seg);
  total += seg.lengthM;
}

const fixture = {
  note: 'Real residential street centerlines (OpenStreetMap, Beaverdale, Des Moines IA), clipped to bbox, traced once via fetchDemoStreets.js. Addresses/house numbers generated from these are FABRICATED.',
  source: 'OpenStreetMap via Overpass API (ODbL)',
  bbox: BBOX,
  fetchedAt: new Date().toISOString().slice(0, 10),
  streets: picked,
};

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'demoStreets.json');
fs.writeFileSync(outPath, JSON.stringify(fixture, null, 1));
console.log(
  `Wrote ${picked.length} segments (${total} m, ${perStreet.size} distinct streets) → ${outPath}`
);
