import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeRoads } from './artifact.js';
import { buildRoadGraph } from './graph.js';

// Finds the committed county road artifacts covering a campaign's doors and builds one
// walking graph from them. Everything is local: the artifacts are files in the repo
// (see utils/roadData/fetchCountyRoads.js), so a cut never touches the network and no
// coordinate ever leaves the server.
//
// Counties are chosen by GEOMETRY, not by Household.countyValue — that field comes from
// whatever column the import file happened to carry and defaults to null, so half a
// campaign can have no county at all. A bounding-box overlap needs nothing but the door
// coordinates the cut already loaded.

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../data/roads');

// Building a county graph costs a few hundred milliseconds and ~15 MB. A worker cuts the
// same county over and over, so keep the most recent few rather than rebuilding per job.
const MAX_CACHED = 3;
const graphCache = new Map();
let manifest = null;

const boundsOf = (roads) => {
  let w = Infinity;
  let e = -Infinity;
  let s = Infinity;
  let n = -Infinity;
  for (const r of roads) {
    for (const [lng, lat] of r.coords) {
      if (lng < w) w = lng;
      if (lng > e) e = lng;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  }
  return { w, e, s, n };
};

// One pass over the data directory, kept in memory: each artifact's id and its bounds.
const loadManifest = () => {
  if (manifest) return manifest;
  let files = [];
  try {
    files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    files = []; // no artifacts committed yet — the cut simply stays straight-line
  }
  manifest = files.map((file) => {
    const raw = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'));
    return { file, fips: raw.fips || file.replace('.json', ''), bounds: boundsOf(decodeRoads(raw)) };
  });
  return manifest;
};

const overlaps = (a, b, padDeg) =>
  a.w - padDeg <= b.e && a.e + padDeg >= b.w && a.s - padDeg <= b.n && a.n + padDeg >= b.s;

export const boundsOfDoors = (households) => {
  let w = Infinity;
  let e = -Infinity;
  let s = Infinity;
  let n = -Infinity;
  for (const h of households) {
    const c = h.location?.coordinates;
    if (!Array.isArray(c) || c.length !== 2) continue;
    if (c[0] < w) w = c[0];
    if (c[0] > e) e = c[0];
    if (c[1] < s) s = c[1];
    if (c[1] > n) n = c[1];
  }
  return Number.isFinite(w) ? { w, e, s, n } : null;
};

// Returns { graph, counties } or null when nothing covers these doors. The pad lets a
// campaign that sits just inside a county line still pick up the neighbouring streets a
// canvasser would actually walk (~5 km).
export const loadRoadGraph = (households, { padDeg = 0.05 } = {}) => {
  const bounds = boundsOfDoors(households);
  if (!bounds) return null;

  const hits = loadManifest()
    .filter((m) => overlaps(bounds, m.bounds, padDeg))
    .sort((a, b) => (a.fips < b.fips ? -1 : 1)); // deterministic node numbering
  if (!hits.length) return null;

  const key = hits.map((h) => h.fips).join(',');
  const cached = graphCache.get(key);
  if (cached) {
    // refresh recency without disturbing insertion order semantics elsewhere
    graphCache.delete(key);
    graphCache.set(key, cached);
    return cached;
  }

  const roads = [];
  for (const m of hits) {
    roads.push(...decodeRoads(JSON.parse(readFileSync(join(DATA_DIR, m.file), 'utf8'))));
  }
  if (!roads.length) return null;

  const value = { graph: buildRoadGraph(roads), counties: hits.map((h) => h.fips) };
  graphCache.set(key, value);
  while (graphCache.size > MAX_CACHED) graphCache.delete(graphCache.keys().next().value);
  return value;
};

// Test seam — the cache would otherwise outlive a fixture swap.
export const _resetRoadGraphCache = () => { graphCache.clear(); manifest = null; };
