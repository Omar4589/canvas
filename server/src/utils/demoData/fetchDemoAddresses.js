// One-time dev helper: pull REAL residential address points (real rooftops on real
// streets) from OpenStreetMap (Overpass) and write demoAddresses.json — the committed
// fixture seedDemoOrg.js places demo households on. Only the addresses/coordinates are
// real; the voters attached to them at seed time are fabricated. The seed script itself
// never touches the network.
//
//   node src/utils/demoData/fetchDemoAddresses.js
//
// Why real addresses: synthesizing house coordinates along street centerlines dropped
// pins onto schools and parking lots and formed thin ribbons. Real address points
// cluster into believable neighborhoods and always land on actual homes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Beaverdale / Drake-area Des Moines, IA — a dense, fully-addressed residential grid.
const BBOX = [41.598, -93.678, 41.618, -93.648]; // [south, west, north, east]
const DEFAULT_CITY = 'Des Moines';

// Building/tag values that mean "not a home" — everything else with a street address
// is treated as residential (house, residential, apartments, detached, terrace, …).
const NON_RESIDENTIAL_BUILDING = new Set([
  'school', 'church', 'commercial', 'retail', 'office', 'industrial', 'hospital',
  'fire_station', 'public', 'civic', 'university', 'college', 'kindergarten',
  'sports_centre', 'supermarket', 'warehouse', 'chapel', 'government',
]);

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const [S, W, N, E] = BBOX;
const query =
  `[out:json][timeout:120];(` +
  `node["addr:housenumber"]["addr:street"](${S},${W},${N},${E});` +
  `way["addr:housenumber"]["addr:street"](${S},${W},${N},${E});` +
  `);out tags center;`;

async function fetchOverpass() {
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': 'doorline-demo-fixture/1.0 (one-time address trace)',
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

function coordOf(el) {
  if (el.type === 'node') return [el.lon, el.lat];
  const c = el.center || {};
  return [c.lon, c.lat];
}

function isResidential(tags) {
  const building = String(tags.building || '').toLowerCase();
  if (NON_RESIDENTIAL_BUILDING.has(building)) return false;
  // Anything that's a shop / office / amenity / tourism POI is not a home.
  if (tags.amenity || tags.shop || tags.office || tags.tourism) return false;
  return true;
}

const data = await fetchOverpass();

const seen = new Set();
const addresses = [];
for (const el of data.elements || []) {
  const tags = el.tags || {};
  const [lng, lat] = coordOf(el);
  if (lng == null || lat == null) continue;
  if (!tags['addr:housenumber'] || !tags['addr:street']) continue;
  if (!isResidential(tags)) continue;

  // Some OSM nodes carry a multi-unit range ("1504,1506" / "1211;1213" / "1446-1448")
  // for a duplex on one point — take the first number so the display address is clean.
  const housenumber = String(tags['addr:housenumber']).trim().split(/[;,]/)[0].trim();
  const street = String(tags['addr:street']).trim();
  const key = `${housenumber} ${street}`.toLowerCase();
  if (seen.has(key)) continue; // some buildings carry duplicate address nodes
  seen.add(key);

  addresses.push({
    housenumber,
    street,
    city: (tags['addr:city'] || DEFAULT_CITY).trim(),
    zip: tags['addr:postcode'] ? String(tags['addr:postcode']).trim().slice(0, 5) : null,
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
  });
}

// Deterministic order so the seed produces the same dataset every run: by street,
// then numeric house number.
addresses.sort(
  (a, b) =>
    a.street.localeCompare(b.street) ||
    (parseInt(a.housenumber, 10) || 0) - (parseInt(b.housenumber, 10) || 0)
);

const fixture = {
  note: 'Real residential address points (OpenStreetMap, Beaverdale/Drake area, Des Moines IA), traced once via fetchDemoAddresses.js. Addresses and coordinates are REAL; the voters attached to them by the demo seed are fabricated.',
  source: 'OpenStreetMap via Overpass API (ODbL)',
  bbox: BBOX,
  fetchedAt: new Date().toISOString().slice(0, 10),
  addresses,
};

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'demoAddresses.json');
fs.writeFileSync(outPath, JSON.stringify(fixture, null, 0));
const streets = new Set(addresses.map((a) => a.street)).size;
console.log(`Wrote ${addresses.length} real addresses (${streets} streets) → ${outPath}`);
