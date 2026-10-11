import { haversineMeters } from './normalizeAddress.js';

// Where a street is, and which pins are nowhere near it. Pure.
//
// Lifted out of migrations/repairImportPins.js (its "street outlier" signal) so that every import, the
// placement pass and the operator script judge "this pin is far from its street" by one rule
// (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S1.2). The rule, unchanged: a cohort is the doors on one
// street in one ZIP; its centre is the MEDOID of its distinct spots (never a mean — an outlier drags a
// mean toward itself), its spread is the median non-zero distance from that centre, and a door is an
// outlier when it sits farther than max(minMeters, outlierFactor × spread) from the centre. One point per
// spot: a 40-unit tower is one opinion about where its street is, not forty. A cohort needs `minCohort`
// spots to have an opinion at all — the same street name recurs miles apart on rural routes, which is
// what makes a fixed distance threshold useless.
//
// New with the pin-fixes build: the ZIP FALLBACK. A door whose street has too few spots to judge (most
// rural roads, every cul-de-sac) is judged against every spot in its ZIP instead, with a wider floor
// (zipMinMeters). A ZIP can hold tens of thousands of spots, so its centre is the coordinate-wise median
// (median latitude, median longitude: robust like a medoid, O(k log k) instead of O(k²)). The repair
// script keeps zipFallback off, so its output is byte-for-byte what it was.
//
// A point is { id, lat, lng, street, zip5, spotKey }: `street` from streetName.js's streetOf, `zip5` the
// first five characters of the ZIP, `spotKey` from buildingKey.js. Callers drop points with no coordinate.

export const COHORT_DEFAULTS = Object.freeze({
  minMeters: 250,
  minCohort: 3,
  outlierFactor: 4,
  zipMinMeters: 3000,
  zipFallback: false,
  // A street with more distinct spots than this uses the coordinate-wise median too: the medoid is
  // O(k²) and a few roads (Post Rd across three towns) run to thousands of spots. The repair script
  // passes Infinity, keeping its old medoid everywhere.
  medoidMax: 2000,
});

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// The member minimising summed distance to the others.
const medoidOf = (points) => {
  let best = points[0];
  let bestSum = Infinity;
  for (const p of points) {
    let sum = 0;
    for (const q of points) sum += haversineMeters(p.lat, p.lng, q.lat, q.lng);
    if (sum < bestSum) {
      bestSum = sum;
      best = p;
    }
  }
  return { lat: best.lat, lng: best.lng };
};

const coordinateMedian = (points) => ({ lat: median(points.map((p) => p.lat)), lng: median(points.map((p) => p.lng)) });

// One point per spot, in first-seen order (the medoid's tie-break depends on order, so keep it stable).
const distinctSpots = (members) => {
  const bySpot = new Map();
  for (const m of members) {
    if (m.spotKey && !bySpot.has(m.spotKey)) bySpot.set(m.spotKey, m);
  }
  return [...bySpot.values()];
};

const streetKeyOf = (p) => `${p.street}|${p.zip5 || ''}`;

/**
 * One cohort's centre and threshold, or null when it has fewer than `minCohort` spots.
 * kind 'street' → medoid (or the coordinate median past medoidMax) and minMeters; kind 'zip' → the
 * coordinate median and zipMinMeters.
 */
export const cohortSummary = (members, kind = 'street', opts = {}) => {
  const o = { ...COHORT_DEFAULTS, ...opts };
  const spots = distinctSpots(members);
  if (spots.length < o.minCohort) return null;
  const centre = kind === 'zip' || spots.length > o.medoidMax ? coordinateMedian(spots) : medoidOf(spots);
  const dists = spots.map((p) => haversineMeters(centre.lat, centre.lng, p.lat, p.lng));
  const spread = median(dists.filter((d) => d > 0));
  const floor = kind === 'zip' ? o.zipMinMeters : o.minMeters;
  return { kind, centre, threshold: Math.max(floor, spread * o.outlierFactor), size: spots.length };
};

export const distanceToCentre = (point, summary) =>
  haversineMeters(summary.centre.lat, summary.centre.lng, point.lat, point.lng);

// Is one point (a door, or a lookup answer) an outlier against a cohort summary? No summary, no opinion.
export const isCohortOutlier = (point, summary) => !!summary && distanceToCentre(point, summary) > summary.threshold;

/**
 * Build every cohort over `points` once. `summaryFor(point)` hands back the point's street cohort, or —
 * with zipFallback, when the street has fewer than minCohort spots — its ZIP cohort, or null.
 * The points a cohort is built from (the evidence) and the points judged against it may differ: the
 * placement pass builds from every door with a real location and judges only the doors it may flag.
 */
export const buildCohorts = (points, opts = {}) => {
  const o = { ...COHORT_DEFAULTS, ...opts };
  const streets = new Map();
  const zips = new Map();
  for (const p of points) {
    const sk = streetKeyOf(p);
    let s = streets.get(sk);
    if (!s) streets.set(sk, (s = []));
    s.push(p);
    if (o.zipFallback && p.zip5) {
      let z = zips.get(p.zip5);
      if (!z) zips.set(p.zip5, (z = []));
      z.push(p);
    }
  }
  const streetSummaries = new Map();
  for (const [k, members] of streets) streetSummaries.set(k, cohortSummary(members, 'street', o));
  const zipSummaries = new Map();
  for (const [k, members] of zips) zipSummaries.set(k, cohortSummary(members, 'zip', o));
  const summaryFor = (point) => {
    const s = streetSummaries.get(streetKeyOf(point));
    if (s) return s;
    if (!o.zipFallback || !point.zip5) return null;
    return zipSummaries.get(point.zip5) || null;
  };
  return { summaryFor };
};

/**
 * Every point farther from its cohort's centre than the cohort's threshold, judged against cohorts built
 * from the same points. Returns Map<id, { distance, cohortSize, cohort: 'street' | 'zip' }>.
 */
export const cohortOutliers = (points, opts = {}) => {
  const cohorts = buildCohorts(points, opts);
  const flagged = new Map();
  for (const p of points) {
    const s = cohorts.summaryFor(p);
    if (!s) continue;
    const d = distanceToCentre(p, s);
    if (d > s.threshold) flagged.set(String(p.id), { distance: Math.round(d), cohortSize: s.size, cohort: s.kind });
  }
  return flagged;
};
