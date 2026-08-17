import { test } from 'node:test';
import assert from 'node:assert';

import { hilbertSort } from '../src/services/turf/spatial.js';
import { balancedKMeans } from '../src/services/turf/balancedKMeans.js';
import { computeWalkOrder } from '../src/services/turf/walkOrder.js';

// The cut PROMISES reproducibility — balancedKMeans' header says a worker re-run
// reproduces the same books, boundary.js says the same for shapes, and the docs
// republish both. It is only true if the door array arrives in a canonical order,
// because seeds are picked by POSITION in the Hilbert-sorted array and equally-placed
// doors break ties by index. Mongo guarantees no order without a sort, so
// generateTurf sorts every cut-feeding load by _id (byId) and hilbertSort keeps
// a total order. These tests pin the half that can be checked without a database:
// given the same doors in a different arrival order, the cut must not move.

const grid = (n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    // deterministic pseudo-scatter — no Math.random, mirroring the module's own rule
    const a = (i * 2654435761) % 4294967296;
    out.push({
      id: `d${i}`,
      lng: -81.72 + ((a % 1000) / 1000) * 0.05,
      lat: 25.94 + (((a / 1000) | 0) % 1000) / 1000 * 0.05,
    });
  }
  return out;
};

// An apartment stack: many doors sharing ONE geocode. These are the doors that tie on
// every geometric key, so they are the ones an unstable order actually reorders.
const stacked = (n, lng, lat) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, lng, lat }));

const shuffled = (arr, seed = 1) => {
  const a = arr.slice();
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
// what generateTurf's byId does before anything else touches the doors
const canonical = (arr) => arr.slice().sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

test('hilbertSort is a total order — same doors, any arrival order, same sequence', () => {
  const doors = [...grid(300), ...stacked(40, -81.7, 25.95)];
  const a = hilbertSort(canonical(doors)).map((p) => p.id);
  const b = hilbertSort(canonical(shuffled(doors, 7))).map((p) => p.id);
  const c = hilbertSort(canonical(doors.slice().reverse())).map((p) => p.id);
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
});

test('doors sharing a Hilbert cell order by x/y, not by arrival', () => {
  // The `|| a.x - b.x || a.y - b.y` half of the comparator. It only does work when two
  // doors QUANTISE INTO THE SAME CELL, which needs a wide bbox — the far corners are
  // what make that happen, and without them the two doors land in cells 0 and 65535 and
  // the test proves nothing. Keep the pair sub-cell (~0.1 m apart); at ~0.5 m they
  // separate again and this goes vacuous. Verified to FAIL on the old `a.h - b.h`.
  const cell = () => [
    { id: 'east', lng: -81.700000, lat: 25.95 },
    { id: 'west', lng: -81.700001, lat: 25.95 },
    { id: 'far1', lng: -81.60, lat: 26.0 },
    { id: 'far2', lng: -81.80, lat: 25.9 },
  ];
  const hs = hilbertSort(cell()).map((p) => p.h);
  assert.ok(new Set(hs).size < hs.length, 'fixture must actually tie on h, or this tests nothing');
  assert.deepEqual(hilbertSort(cell()).map((p) => p.id), hilbertSort(cell().reverse()).map((p) => p.id));
});

test('balancedKMeans books are identical under a reordered load', async () => {
  const doors = [...grid(500), ...stacked(60, -81.71, 25.96)];
  const cut = async (arr) =>
    (await balancedKMeans(canonical(arr).map((d) => ({ doc: d.id, lng: d.lng, lat: d.lat })), 65, { tolerance: 0.4 }))
      .map((book) => book.slice().sort().join(','))
      .sort();
  const base = await cut(doors);
  assert.deepEqual(await cut(shuffled(doors, 3)), base);
  assert.deepEqual(await cut(shuffled(doors, 99)), base);
  assert.deepEqual(await cut(doors.slice().reverse()), base);
});

// ---------- the chunked pre-split (250k-scale path) ----------
//
// Above chunkThreshold the clusterer splits the Hilbert order into contiguous runs
// and cuts each independently (balancedKMeans.js header). Its determinism claim is
// that chunk boundaries are a pure function of (n, threshold) over a deterministic
// sort — so a shuffled arrival order must still yield IDENTICAL books through the
// chunked path, and a sub-threshold input must be untouched by the threshold knob.

test('chunked path: books identical under a reordered load', async () => {
  const doors = [...grid(900), ...stacked(60, -81.71, 25.96)];
  // threshold far below n forces the pre-split (multiple runs) without a huge fixture
  const cut = async (arr) =>
    (await balancedKMeans(
      canonical(arr).map((d) => ({ doc: d.id, lng: d.lng, lat: d.lat })),
      65,
      { tolerance: 0.4, chunkThreshold: 300 }
    ))
      .map((book) => book.slice().sort().join(','))
      .sort();
  const base = await cut(doors);
  assert.deepEqual(await cut(shuffled(doors, 3)), base);
  assert.deepEqual(await cut(doors.slice().reverse()), base);
});

test('chunked path: every door lands in exactly one book, none over the hard cap', async () => {
  const doors = grid(900);
  const books = await balancedKMeans(
    canonical(doors).map((d) => ({ doc: d.id, lng: d.lng, lat: d.lat })),
    65,
    { tolerance: 0.4, chunkThreshold: 300 }
  );
  const all = books.flat();
  assert.strictEqual(all.length, doors.length, 'no door dropped or duplicated across chunk seams');
  assert.strictEqual(new Set(all).size, doors.length);
  const hardMax = Math.ceil(65 * (1 + 0.4 * 1.5));
  for (const book of books) assert.ok(book.length <= hardMax, `book of ${book.length} exceeds hardMax ${hardMax}`);
});

test('sub-threshold inputs are untouched by the threshold knob (small cuts stay identical)', async () => {
  const doors = grid(400);
  const items = canonical(doors).map((d) => ({ doc: d.id, lng: d.lng, lat: d.lat }));
  const norm = (books) => books.map((b) => b.slice().sort().join(',')).sort();
  const withDefault = norm(await balancedKMeans(items, 65, { tolerance: 0.4 }));
  const withHugeThreshold = norm(await balancedKMeans(items, 65, { tolerance: 0.4, chunkThreshold: 1e9 }));
  assert.deepEqual(withDefault, withHugeThreshold);
});

test('walk order is identical under a reordered load', () => {
  const doors = [...grid(120), ...stacked(20, -81.705, 25.945)];
  const order = (arr) =>
    computeWalkOrder(
      canonical(arr).map((d) => ({ _id: d.id, location: { coordinates: [d.lng, d.lat] } })),
      { optimize: true }
    );
  const base = order(doors);
  assert.deepEqual(order(shuffled(doors, 11)), base);
  assert.deepEqual(order(doors.slice().reverse()), base);
});

test('co-located doors keep ARRIVAL order — which is why the caller\'s sort is load-bearing', () => {
  // The comparator pins everything with distinct coordinates. An apartment stack is
  // the one case it cannot: identical lng/lat means identical h, x and y, so the
  // comparator returns 0 and the stable sort hands back arrival order. That order
  // reaches walkOrder (printed packet sequence, Household.walkOrder) and, when a
  // stack outgrows one book, book membership. generateTurf's `byId()` on every
  // cut-feeding load is what makes it canonical, and turfCutDeterminism.int.test.js
  // is the test that fails if one of those wrappers is dropped.
  const stack = stacked(6, -81.7, 25.95);
  assert.deepEqual(hilbertSort(stack).map((p) => p.id), ['s0', 's1', 's2', 's3', 's4', 's5']);
  assert.deepEqual(hilbertSort(stack.slice().reverse()).map((p) => p.id), ['s5', 's4', 's3', 's2', 's1', 's0']);
  // ...and canonicalising first removes the difference, which is what the cut does.
  assert.deepEqual(
    hilbertSort(canonical(stack.slice().reverse())).map((p) => p.id),
    hilbertSort(canonical(stack)).map((p) => p.id)
  );
});
