import { test } from 'node:test';
import assert from 'node:assert';
import * as turf from '@turf/turf';

import { computeBoundary, computeCentroid, computeTerritories } from '../src/services/turf/boundary.js';

// The book-outline contract: every house INSIDE its own book's shape, and shapes NEVER overlap.
//
// Both at once. The old centroid-seeded construction (one Voronoi cell per book) could not do
// this — balanced k-means legitimately gives a book doors nearer a neighbor's centroid, and the
// clip cut them out of their own outline; an earlier version of this file even pinned that loss
// as "by design". computeTerritories now builds each territory as
//
//   hull ∩ union(Voronoi cells of the book's OWN doors)
//
// over a diagram seeded with EVERY booked door: each door is inside its own cell by definition
// and inside its hull (computeBoundary verifies containment), so it is inside the intersection;
// cells are disjoint across books, so territories are too. A door surrounded by another book's
// houses gets a pocket island (MultiPolygon) — that is the correct shape, not an artifact.

const hh = (lng, lat) => ({ location: { coordinates: [lng, lat] } });
const inside = (h, geom) => {
  if (!geom) return false;
  try {
    return turf.booleanPointInPolygon(turf.point(h.location.coordinates), geom);
  } catch {
    return false;
  }
};
const outsideCount = (houses, geom) => houses.filter((h) => !inside(h, geom)).length;
const overlapArea = (g1, g2) => {
  if (!g1 || !g2) return 0;
  try {
    const ov = turf.intersect(turf.featureCollection([turf.feature(g1), turf.feature(g2)]));
    return ov ? turf.area(ov) : 0;
  } catch {
    return 0;
  }
};
const asBooks = (...householdLists) =>
  householdLists.map((households) => ({ households, centroid: computeCentroid(households) }));

// A tight 3x3 block around (lng, lat).
const cluster = (lng = -76.9, lat = 38.93) => {
  const out = [];
  for (let i = 0; i < 9; i++) out.push(hh(lng + (i % 3) * 0.0008, lat + Math.floor(i / 3) * 0.0008));
  return out;
};

// ---------- computeBoundary (the hull): containment-verified, unchanged contract ----------

test('computeBoundary contains an outlier the concave hull would have dropped', () => {
  const houses = [];
  for (let i = 0; i < 12; i++) houses.push(hh(-76.9 + (i % 4) * 0.0008, 38.93 + Math.floor(i / 4) * 0.0008));
  houses.push(hh(-76.89, 38.938)); // ~0.9km stray — triangulated away at maxEdge 0.4
  assert.strictEqual(outsideCount(houses, computeBoundary(houses)), 0);
});

test('computeBoundary contains its houses at every stray distance', () => {
  for (const strayLng of [-76.893, -76.89, -76.885, -76.88]) {
    const houses = [...cluster(), hh(strayLng, 38.929)];
    assert.strictEqual(outsideCount(houses, computeBoundary(houses)), 0, `stray at lng ${strayLng} fell outside`);
  }
});

test('degenerate books keep their existing fallbacks', () => {
  assert.strictEqual(computeBoundary([]), null);
  assert.strictEqual(computeBoundary([hh(-76.9, 38.93)])?.type, 'Polygon'); // buffered circle
  assert.strictEqual(computeBoundary([hh(-76.9, 38.93), hh(-76.899, 38.931)])?.type, 'Polygon');
});

// ---------- computeTerritories: containment AND disjointness, simultaneously ----------

test('a door SURROUNDED by another book is contained via a pocket island', async () => {
  const a = [...cluster(), hh(-76.8785, 38.9308)]; // stray sits inside B's grid
  const b = cluster(-76.879);
  const [ta, tb] = await computeTerritories(asBooks(a, b));

  assert.strictEqual(outsideCount(a, ta), 0, "A's doors (incl. the surrounded stray) all inside A");
  assert.strictEqual(outsideCount(b, tb), 0, "B's doors all inside B");
  assert.ok(overlapArea(ta, tb) < 1, 'territories must not overlap (m²)');
  // The pocket is the point of the construction: A = main blob + island around the stray.
  assert.strictEqual(ta.type, 'MultiPolygon', "the surrounded stray's book grows a pocket island");
});

test('the dense street that used to lose 7/24 doors now keeps them all', async () => {
  const a = [];
  for (let i = 0; i < 24; i++) a.push(hh(-76.9 + i * 0.001, 38.93 + (i % 2) * 0.0004));
  const b = [];
  for (let i = 0; i < 9; i++) b.push(hh(-76.879 + (i % 3) * 0.0008, 38.9315 + Math.floor(i / 3) * 0.0008));
  const [ta, tb] = await computeTerritories(asBooks(a, b));

  assert.strictEqual(outsideCount(a, ta), 0, 'no far-end door clipped out of its own book');
  assert.strictEqual(outsideCount(b, tb), 0);
  assert.ok(overlapArea(ta, tb) < 1, 'still non-overlapping');
});

test('a stray inside its own frontier (far neighbor) stays contained', async () => {
  const b = cluster(-76.7); // neighbor far east — the stray is on A's side of every seam
  for (const strayLng of [-76.893, -76.89, -76.885, -76.88]) {
    const a = [...cluster(), hh(strayLng, 38.929)];
    const [ta] = await computeTerritories(asBooks(a, b));
    assert.strictEqual(outsideCount(a, ta), 0, `stray at lng ${strayLng} fell outside its territory`);
  }
});

test('an identical coordinate split across two books does not crash; the owner contains it', async () => {
  const shared = hh(-76.8788, 38.9304);
  const a = [...cluster(), shared]; // A seen first → A owns the shared coordinate's cell
  const b = [...cluster(-76.879), hh(-76.8788, 38.9304)];
  const [ta, tb] = await computeTerritories(asBooks(a, b));
  assert.ok(ta && tb, 'both territories computed');
  assert.strictEqual(inside(shared, ta), true, "first-seen book's shape contains the shared coordinate");
});

test('single-book passes fall back to the plain hull', async () => {
  const a = cluster();
  const [ta] = await computeTerritories(asBooks(a));
  assert.deepStrictEqual(ta, computeBoundary(a));
});

test('onlyIndices computes just the requested books and matches the full run exactly', async () => {
  const books = asBooks([...cluster(), hh(-76.8785, 38.9308)], cluster(-76.879), cluster(-76.87, 38.94));
  const full = await computeTerritories(books);
  const partial = await computeTerritories(books, { onlyIndices: new Set([0]) });
  assert.deepStrictEqual(partial[0], full[0], 'selective run reproduces the full-run shape byte-for-byte');
  assert.strictEqual(partial[1], undefined, 'unrequested books come back undefined (stored shapes kept)');
  assert.strictEqual(partial[2], undefined);
});

test('deterministic: two runs on the same input are identical (worker re-runs must reproduce)', async () => {
  const books = asBooks([...cluster(), hh(-76.8785, 38.9308)], cluster(-76.879));
  assert.deepStrictEqual(await computeTerritories(books), await computeTerritories(books));
});

test('scale smoke: ~2k doors / 16 books — full containment, disjoint, fast', async () => {
  // Deterministic LCG; grid-cluster into books, then swap strays across neighbors.
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const K = 16;
  const books = Array.from({ length: K }, () => ({ households: [] }));
  for (let i = 0; i < 2000; i++) {
    const b = Math.floor(rnd() * K);
    books[b].households.push(hh(-82.35 + (b % 4) * 0.01 + rnd() * 0.009, 28.18 + Math.floor(b / 4) * 0.01 + rnd() * 0.009));
  }
  for (let b = 0; b < K; b++) {
    for (let s = 0; s < 3 && books[b].households.length > 8; s++) {
      books[(b + 1) % K].households.push(books[b].households.pop());
    }
  }
  books.forEach((b) => { b.centroid = computeCentroid(b.households); });

  const territories = await computeTerritories(books);
  let out = 0;
  books.forEach((b, i) => { out += outsideCount(b.households, territories[i]); });
  assert.strictEqual(out, 0, `${out} door(s) outside their book's shape`);
  // Disjointness spot-check across adjacent pairs (the ones that actually share seams).
  for (let i = 0; i < K - 1; i++) {
    assert.ok(overlapArea(territories[i], territories[i + 1]) < 1, `books ${i}/${i + 1} overlap`);
  }
});
