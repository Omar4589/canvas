import { test } from 'node:test';
import assert from 'node:assert';
import * as turf from '@turf/turf';

import { computeBoundary, computeCentroid, computeTerritories } from '../src/services/turf/boundary.js';

// The book-outline containment contract.
//
// A book's outline must CONTAIN the book's own houses. It used to not: computeBoundary walked a
// relaxing maxEdge ladder (0.4 → 0.6 → 1.2 km) but returned on the first rung that produced a
// `Polygon` — and turf.concave happily returns a valid Polygon that has triangulated an outlying
// house away. Measured before the fix: 1 of 13 houses outside at maxEdge 0.4, 0 outside at 1.2.
//
// The OTHER cause of a door sitting outside its outline is deliberate and must survive: books are
// clipped to Voronoi cells so they never overlap (computeTerritories), and balanced k-means trades
// geometric purity for even book sizes, so a book can own houses nearer a neighbour's centroid.
// Those get clipped out and no ring-free geometry can fix it. The last two tests pin BOTH sides of
// that trade so neither silently flips.

const hh = (lng, lat) => ({ location: { coordinates: [lng, lat] } });
const inside = (h, poly) => {
  if (!poly) return false;
  try {
    return turf.booleanPointInPolygon(turf.point(h.location.coordinates), poly);
  } catch {
    return false;
  }
};
const outsideCount = (houses, poly) => houses.filter((h) => !inside(h, poly)).length;

// A tight 3x3 block around (-76.90, 38.93).
const cluster = (lng = -76.9, lat = 38.93) => {
  const out = [];
  for (let i = 0; i < 9; i++) out.push(hh(lng + (i % 3) * 0.0008, lat + Math.floor(i / 3) * 0.0008));
  return out;
};

test('computeBoundary contains an outlier the concave hull would have dropped', () => {
  const houses = [];
  for (let i = 0; i < 12; i++) houses.push(hh(-76.9 + (i % 4) * 0.0008, 38.93 + Math.floor(i / 4) * 0.0008));
  houses.push(hh(-76.89, 38.938)); // ~0.9km stray — triangulated away at maxEdge 0.4
  assert.strictEqual(outsideCount(houses, computeBoundary(houses)), 0);
});

test('computeBoundary contains its houses at every stray distance', () => {
  for (const strayLng of [-76.893, -76.89, -76.885, -76.88]) {
    const houses = [...cluster(), hh(strayLng, 38.929)];
    assert.strictEqual(
      outsideCount(houses, computeBoundary(houses)),
      0,
      `stray at lng ${strayLng} fell outside its own book's outline`
    );
  }
});

test('a stray inside its own Voronoi cell survives the territory clip', () => {
  // Book B parked far east, so the stray always stays on Book A's side of the seam — the
  // concave-hull drop is then the SOLE cause, and the fix must carry through the clip.
  const b = cluster(-76.7);
  for (const strayLng of [-76.893, -76.89, -76.885, -76.88]) {
    const a = [...cluster(), hh(strayLng, 38.929)];
    const books = [
      { households: a, centroid: computeCentroid(a) },
      { households: b, centroid: computeCentroid(b) },
    ];
    assert.strictEqual(
      outsideCount(a, computeTerritories(books)[0]),
      0,
      `stray at lng ${strayLng} was clipped out of its own territory`
    );
  }
});

test('adjacent books still do not overlap, and the Voronoi clip still bites', () => {
  // A long dense street running toward a neighbouring cluster: the far end of A is nearer B's
  // centroid, so the clip legitimately trims it off A's outline.
  const a = [];
  for (let i = 0; i < 24; i++) a.push(hh(-76.9 + i * 0.001, 38.93 + (i % 2) * 0.0004));
  const b = [];
  for (let i = 0; i < 9; i++) b.push(hh(-76.879 + (i % 3) * 0.0008, 38.9315 + Math.floor(i / 3) * 0.0008));
  const books = [
    { households: a, centroid: computeCentroid(a) },
    { households: b, centroid: computeCentroid(b) },
  ];
  const [ta, tb] = computeTerritories(books);

  // Non-overlap is the whole reason computeTerritories exists — the containment fix must not
  // buy containment by letting books bleed into each other.
  const overlap = turf.intersect(turf.featureCollection([turf.feature(ta), turf.feature(tb)]));
  assert.strictEqual(overlap, null, 'adjacent book territories overlap');

  // ...and the honest cost: cause 2 still puts some of A's doors outside A's outline. This is
  // by design (the book-colored ring on the map is what stays authoritative), so assert it
  // rather than let a future change silently "fix" it into overlapping books.
  assert.ok(outsideCount(a, ta) > 0, 'expected the Voronoi clip to still trim far-end doors');
});

test('degenerate books keep their existing fallbacks', () => {
  assert.strictEqual(computeBoundary([]), null);
  const one = computeBoundary([hh(-76.9, 38.93)]);
  assert.strictEqual(one?.type, 'Polygon'); // buffered circle
  const two = computeBoundary([hh(-76.9, 38.93), hh(-76.899, 38.931)]);
  assert.strictEqual(two?.type, 'Polygon');
});
