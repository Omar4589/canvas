import test from 'node:test';
import assert from 'node:assert/strict';
import { haversineMeters } from './normalizeAddress.js';
import { buildingKeyForCoords } from './buildingKey.js';
import { streetOf } from './streetName.js';
import { COHORT_DEFAULTS, cohortSummary, isCohortOutlier, buildCohorts, cohortOutliers } from './pinCohorts.js';

// docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S1.2.

const pt = (id, lat, lng, street = 'MAIN ST', zip5 = '06824') => ({
  id,
  lat,
  lng,
  street,
  zip5,
  spotKey: buildingKeyForCoords([lng, lat]),
});
// A Fairfield street: six homes ~80 m apart along a line.
const street = (n = 6, base = 41.16, lng = -73.25, name = 'MAIN ST') =>
  Array.from({ length: n }, (_, i) => pt(`h${i}`, base + i * 0.0007, lng, name));

// ── The oracle: the repair script's streetOutliers body as it was before the move, inlined verbatim
// (only its inputs adapted to points), so "the repair script's shortlist is unchanged" is a test.
const oracle = (points, MIN_METERS) => {
  const MIN_COHORT = 3;
  const OUTLIER_FACTOR = 4;
  const median = (xs) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const medoidOf = (ps) => {
    let best = ps[0];
    let bestSum = Infinity;
    for (const p of ps) {
      let sum = 0;
      for (const q of ps) sum += haversineMeters(p.lat, p.lng, q.lat, q.lng);
      if (sum < bestSum) {
        bestSum = sum;
        best = p;
      }
    }
    return best;
  };
  const cohorts = new Map();
  for (const h of points) {
    const key = `${h.street}|${h.zip5}`;
    const arr = cohorts.get(key) || [];
    arr.push({ h, lat: h.lat, lng: h.lng });
    cohorts.set(key, arr);
  }
  const flagged = new Map();
  for (const members of cohorts.values()) {
    const byPin = new Map();
    for (const m of members) {
      const k = buildingKeyForCoords([m.lng, m.lat]);
      if (k && !byPin.has(k)) byPin.set(k, m);
    }
    const ps = [...byPin.values()];
    if (ps.length < MIN_COHORT) continue;
    const centre = medoidOf(ps);
    const dists = ps.map((p) => haversineMeters(centre.lat, centre.lng, p.lat, p.lng));
    const spread = median(dists.filter((d) => d > 0));
    const threshold = Math.max(MIN_METERS, spread * OUTLIER_FACTOR);
    for (const m of members) {
      const d = haversineMeters(centre.lat, centre.lng, m.lat, m.lng);
      if (d > threshold) flagged.set(String(m.h.id), { distance: Math.round(d), cohortSize: ps.length });
    }
  }
  return flagged;
};
const repairShape = (m) => new Map([...m].map(([k, v]) => [k, { distance: v.distance, cohortSize: v.cohortSize }]));

test('the oracle: cohortOutliers with the repair script options reproduces the old streetOutliers exactly', () => {
  const pts = [
    ...street(8),
    pt('far', 41.9, -72.9), // 80 km off on MAIN ST
    pt('tower1', 41.161, -73.25), pt('tower2', 41.161, -73.25), pt('tower3', 41.161, -73.25), // one spot
    ...street(5, 41.18, -73.26, 'OAK AVE'),
    pt('oakfar', 41.18, -73.20, 'OAK AVE'),
    pt('lone1', 41.2, -73.3, 'LONE LN'), pt('lone2', 41.21, -73.3, 'LONE LN'), // too few spots
    pt('otherzip', 41.16, -73.25, 'MAIN ST', '06825'), // a different cohort (ZIP is in the key)
  ];
  for (const minMeters of [250, 100, 1000]) {
    const got = repairShape(cohortOutliers(pts, { minMeters, zipFallback: false, medoidMax: Infinity }));
    assert.deepEqual(got, oracle(pts, minMeters), `minMeters ${minMeters}`);
  }
  assert.ok(oracle(pts, 250).has('far') && oracle(pts, 250).has('oakfar'), 'the fixture has real outliers');
});

test('a long road is not flagged for being long; an 80 km outlier is', () => {
  const road = Array.from({ length: 12 }, (_, i) => pt(`r${i}`, 41.1 + i * 0.01, -73.3, 'POST RD')); // ~12 km
  assert.equal(cohortOutliers(road).size, 0);
  const withFar = [...road, pt('x', 41.9, -72.5, 'POST RD')];
  assert.deepEqual([...cohortOutliers(withFar).keys()], ['x']);
});

test('a cohort needs minCohort spots: two spots judge nothing, and a tower is one spot', () => {
  assert.equal(cohortSummary([pt('a', 41.1, -73.3), pt('b', 41.9, -72.5)]), null);
  const tower = [1, 2, 3, 4].map((n) => pt(`t${n}`, 41.1, -73.3));
  assert.equal(cohortSummary(tower), null, 'four units on one spot are one opinion');
});

test('the ZIP fallback: a lone far home on a short street is judged by its ZIP; a lone near one is not flagged', () => {
  const zip = [
    ...street(6, 41.16, -73.25, 'MAIN ST'),
    ...street(6, 41.165, -73.255, 'ELM ST'),
    pt('cul', 41.162, -73.252, 'SHORT CT'), // its street has one spot
    pt('lost', 41.66, -72.93, 'TINY LN'), // Bristol CT, ~60 km away, one spot on its street
  ];
  assert.equal(cohortOutliers(zip).size, 0, 'without the fallback, short streets are never judged');
  const r = cohortOutliers(zip, { zipFallback: true });
  assert.deepEqual([...r.keys()], ['lost']);
  assert.equal(r.get('lost').cohort, 'zip');
});

test('the ZIP fallback judges nothing when the ZIP itself is too small or the point has no ZIP', () => {
  const tiny = [pt('a', 41.1, -73.3, 'A ST'), pt('b', 41.9, -72.5, 'B ST')];
  assert.equal(cohortOutliers(tiny, { zipFallback: true }).size, 0);
  const noZip = [...street(6), pt('x', 41.9, -72.5, 'NOWHERE RD', '')];
  assert.equal(cohortOutliers(noZip, { zipFallback: true }).has('x'), false);
});

test('a ZIP cohort uses the coordinate median and runs fast at 20,000 spots', () => {
  const many = Array.from({ length: 20000 }, (_, i) => pt(`z${i}`, 41.1 + (i % 200) * 0.0005, -73.3 + Math.floor(i / 200) * 0.0005, `S${i}`));
  const t0 = Date.now();
  const s = cohortSummary(many, 'zip');
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
  assert.equal(s.kind, 'zip');
  assert.ok(s.threshold >= COHORT_DEFAULTS.zipMinMeters);
});

test('a very long street switches to the coordinate median past medoidMax', () => {
  const long = Array.from({ length: 30 }, (_, i) => pt(`p${i}`, 41.1 + i * 0.001, -73.3, 'POST RD'));
  const a = cohortSummary(long, 'street', { medoidMax: 10 });
  const b = cohortSummary(long, 'street', { medoidMax: Infinity });
  assert.ok(a && b);
  assert.ok(Math.abs(a.centre.lat - b.centre.lat) < 0.002, 'both centres sit mid-street');
});

test('buildCohorts: evidence and judged points may differ; isCohortOutlier agrees with cohortOutliers', () => {
  const evidence = street(8);
  const cohorts = buildCohorts(evidence, { zipFallback: true });
  const near = pt('n', 41.1615, -73.25);
  const far = pt('f', 41.9, -72.5);
  assert.equal(isCohortOutlier(near, cohorts.summaryFor(near)), false);
  assert.equal(isCohortOutlier(far, cohorts.summaryFor(far)), true);
  const all = [...evidence, far];
  assert.equal(cohortOutliers(all).has('f'), isCohortOutlier(far, buildCohorts(all).summaryFor(far)));
  assert.equal(isCohortOutlier(far, null), false, 'no cohort, no opinion');
});

test('streetOf groups units and spellings the way the cohorts expect', () => {
  assert.equal(streetOf('100 Main St Apt 4'), 'Main St');
  assert.equal(streetOf('857 Post Rd 146'), 'Post Rd 146'); // the bare unit stays: cohorts are per street string
});
