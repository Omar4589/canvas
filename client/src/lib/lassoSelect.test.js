import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pointInRing,
  ringBBox,
  doorsInRing,
  snapBuildings,
  applySelection,
  planDoorSelection,
  SELECTION_CAP,
} from './lassoSelect.js';

const SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10]];
// A U: a base spanning x 0–10 up to y 3, with prongs at x 0–3 and x 7–10 up to y 10.
const U_SHAPE = [[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10]];
// A bowtie — the edges cross at (5,5), so even-odd leaves two triangular lobes inside.
const BOWTIE = [[0, 0], [10, 10], [10, 0], [0, 10]];

const ids = (rows) => rows.map((r) => r.id);

test('pointInRing: inside and outside a convex ring', () => {
  assert.equal(pointInRing(5, 5, SQUARE), true);
  assert.equal(pointInRing(0.001, 9.999, SQUARE), true);
  assert.equal(pointInRing(-0.001, 5, SQUARE), false);
  assert.equal(pointInRing(10.001, 5, SQUARE), false);
  assert.equal(pointInRing(5, 20, SQUARE), false);
});

test('pointInRing: a ring with fewer than 3 vertices holds nothing', () => {
  assert.equal(pointInRing(0, 0, []), false);
  assert.equal(pointInRing(0, 0, [[0, 0], [1, 1]]), false);
  assert.equal(pointInRing(0, 0, null), false);
});

test('pointInRing: a closing vertex equal to the first changes nothing', () => {
  const closed = [...SQUARE, [0, 0]];
  for (const [x, y] of [[5, 5], [-1, 5], [9.9, 0.1], [11, 11]]) {
    assert.equal(pointInRing(x, y, closed), pointInRing(x, y, SQUARE), `(${x},${y})`);
  }
});

test('pointInRing: on-vertex is decided by the half-open rule, not an epsilon', () => {
  // Deterministic but NOT symmetric — the bottom-left corner reads inside, the top-right
  // outside. Pinned so a rewrite can't quietly flip a lasso's edge behaviour.
  assert.equal(pointInRing(0, 0, SQUARE), true);
  assert.equal(pointInRing(10, 10, SQUARE), false);
});

test('pointInRing: concave — the notch of a U is outside', () => {
  assert.equal(pointInRing(5, 1, U_SHAPE), true, 'the base');
  assert.equal(pointInRing(1, 6, U_SHAPE), true, 'the left prong');
  assert.equal(pointInRing(9, 6, U_SHAPE), true, 'the right prong');
  assert.equal(pointInRing(5, 6, U_SHAPE), false, 'the notch between the prongs');
});

test('pointInRing: self-crossing — both lobes of a bowtie are inside, the gap is not', () => {
  assert.equal(pointInRing(1, 5, BOWTIE), true);
  assert.equal(pointInRing(9, 5, BOWTIE), true);
  assert.equal(pointInRing(5, 1, BOWTIE), false);
  assert.equal(pointInRing(5, 9, BOWTIE), false);
});

test('ringBBox: bounds in one pass, null for a degenerate ring', () => {
  assert.deepEqual(ringBBox(U_SHAPE), { minX: 0, minY: 0, maxX: 10, maxY: 10 });
  assert.equal(ringBBox([[1, 1], [2, 2]]), null);
  assert.equal(ringBBox(null), null);
});

test('ringBBox: a 200k-vertex ring does not overflow the stack', () => {
  // The spatial.js lesson (server/src/services/turf/spatial.js:59-61): Math.min(...xs) spreads one
  // argument per vertex and throws RangeError past ~100k. A densified freehand path gets big.
  const ring = [];
  for (let i = 0; i < 200000; i++) ring.push([i % 1000, Math.floor(i / 1000)]);
  const bb = ringBBox(ring);
  assert.equal(bb.minX, 0);
  assert.equal(bb.maxX, 999);
  assert.equal(bb.minY, 0);
  assert.equal(bb.maxY, 199);
});

test('doorsInRing: reads both payload shapes and skips ungeocoded doors', () => {
  const doors = [
    { id: 'nested', location: { lng: 5, lat: 5 } }, // the /map payload
    { id: 'flat', lng: 6, lat: 6 }, // the /doors payload
    { id: 'outside', lng: 50, lat: 50 },
    { id: 'nopin', location: null },
    { id: 'undef' },
  ];
  assert.deepEqual(ids(doorsInRing({ doors, ring: SQUARE })), ['nested', 'flat']);
  assert.deepEqual(doorsInRing({ doors, ring: [[0, 0]] }), []);
  assert.deepEqual(doorsInRing({ doors: [], ring: SQUARE }), []);
});

test('doorsInRing: the bbox prefilter is exactly equivalent to a full ray cast', () => {
  // Seeded LCG — same cloud every run.
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const doors = [];
  for (let i = 0; i < 2000; i++) doors.push({ id: `d${i}`, lng: rand() * 20 - 5, lat: rand() * 20 - 5 });
  for (const ring of [SQUARE, U_SHAPE, BOWTIE]) {
    const naive = doors.filter((d) => pointInRing(d.lng, d.lat, ring));
    assert.deepEqual(ids(doorsInRing({ doors, ring })), ids(naive));
    assert.ok(naive.length > 0);
  }
});

test('snapBuildings: a ring that slices a building takes every unit at that pin', () => {
  // Two units at one pin ~0.4 m apart — one rounded key (buildings.js rounds to 5 decimals), but
  // the glyph is drawn at the FIRST unit's real coordinate, so a lasso edge can fall between them.
  const unitA = { id: 'a', lng: -96, lat: 41 };
  const unitB = { id: 'b', lng: -96.000004, lat: 41.000004 };
  const neighbor = { id: 'c', lng: -96.0002, lat: 41.0002 };
  const doors = [unitA, unitB, neighbor];
  const ring = [
    [-96.000002, 40.999995],
    [-95.999995, 40.999995],
    [-95.999995, 41.000002],
    [-96.000002, 41.000002],
  ];
  const hits = doorsInRing({ doors, ring });
  assert.deepEqual(ids(hits), ['a'], 'the ring caught only one of the two units');
  assert.deepEqual(ids(snapBuildings(hits, doors)), ['a', 'b']);
  // …and the neighbour 20 m away keeps its own key.
  assert.deepEqual(ids(snapBuildings([neighbor], doors)), ['c']);
});

test('snapBuildings: nothing to expand → the same array back (reference-stable)', () => {
  const doors = [{ id: 'a', lng: -96, lat: 41 }, { id: 'c', lng: -96.0002, lat: 41.0002 }];
  const hits = [doors[0]];
  assert.equal(snapBuildings(hits, doors), hits);
  assert.equal(snapBuildings([], doors).length, 0);
});

test('applySelection: add unions, subtract removes, ids stay strings', () => {
  const start = new Set(['a']);
  const added = applySelection(start, [{ id: 'b' }, { id: 'c' }, { id: 'a' }], 'add');
  assert.deepEqual([...added.ids].sort(), ['a', 'b', 'c']);
  assert.equal(added.added, 2);
  assert.equal(added.overCap, false);
  assert.equal(start.size, 1, 'the input Set is never mutated');

  const removed = applySelection(added.ids, ['b'], 'subtract');
  assert.deepEqual([...removed.ids].sort(), ['a', 'c']);
  assert.equal(removed.removed, 1);
  assert.equal(removed.overCap, false);
});

test('applySelection: an over-cap lasso is refused WHOLE, never truncated', () => {
  const current = new Set();
  for (let i = 0; i < SELECTION_CAP - 5; i++) current.add(`d${i}`);
  const hits = [];
  for (let i = 0; i < 10; i++) hits.push({ id: `new${i}` });

  const refused = applySelection(current, hits, 'add');
  assert.equal(refused.overCap, true);
  assert.equal(refused.added, 0);
  assert.equal(refused.wouldBe, SELECTION_CAP + 5);
  assert.equal(refused.ids, current, 'the untouched Set comes back by reference');
  assert.equal(current.size, SELECTION_CAP - 5);

  // Exactly at the cap is allowed.
  const fits = applySelection(current, hits.slice(0, 5), 'add');
  assert.equal(fits.overCap, false);
  assert.equal(fits.ids.size, SELECTION_CAP);

  // Subtract can never be over cap, even from an at-cap selection.
  const cut = applySelection(fits.ids, [{ id: 'new0' }], 'subtract');
  assert.equal(cut.overCap, false);
  assert.equal(cut.ids.size, SELECTION_CAP - 1);
});

// The rows a page hands planDoorSelection, covering every gate.
const ROWS = [
  { id: 'a', status: 'unknocked', effortId: 'e1' },
  // Desk-marked in March, excluded from books in April: unmarkable today, and dropping it from the
  // unmark payload would strand its mark forever.
  { id: 'b', status: 'restricted', effortId: 'e1', excludedFromTurf: true },
  { id: 'c', status: 'not_home', effortId: null }, // Intake — one of these 400s a whole mark batch
  { id: 'd', status: 'surveyed', effortId: 'e1' },
  { id: 'e', status: 'unknocked', effortId: 'e1', doNotKnock: true },
  { id: 'f', status: 'not_home', effortId: 'e1' },
];

test('planDoorSelection: mark and unmark payloads diverge on an excluded, desk-marked door', () => {
  const plan = planDoorSelection(ROWS, { forRound: true, sendsPassId: false });
  assert.deepEqual(plan.markIds, ['a', 'd', 'f'], 'no Intake, no excluded, no do-not-knock');
  assert.deepEqual(plan.unmarkIds, ['a', 'b', 'd', 'e', 'f'], 'only Intake is dropped');
  assert.ok(!plan.markIds.includes('b') && plan.unmarkIds.includes('b'));
});

test('planDoorSelection: an explicit passId keeps Intake doors in the unmark payload', () => {
  // unrestrict-doors with a passId never resolves a round per door, so Intake is harmless there.
  const plan = planDoorSelection(ROWS, { forRound: true, sendsPassId: true });
  assert.deepEqual(plan.unmarkIds, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(plan.markIds, ['a', 'd', 'f'], 'the mark payload is unchanged');
});

test('planDoorSelection: per-round buckets partition the selection', () => {
  const plan = planDoorSelection(ROWS, { forRound: true });
  assert.equal(plan.total, 6);
  assert.equal(plan.perRound, true);
  assert.equal(plan.markable, 2, 'a (unknocked) + f (reached)');
  assert.equal(plan.unknocked, 1);
  assert.equal(plan.reached, 1);
  assert.equal(plan.completedThisRound, 1); // d
  assert.equal(plan.alreadyRestricted, 0); // b is counted once, under cannotMark
  assert.equal(plan.cannotMark, 3); // b excluded, c Intake, e do-not-knock
  assert.deepEqual(plan.cannotMarkReasons, { intake: 1, excluded: 1, doNotKnock: 1 });
  assert.equal(
    plan.markable + plan.alreadyRestricted + plan.completedThisRound + plan.cannotMark,
    plan.total,
    'every selected door lands in exactly one bucket'
  );
});

test('planDoorSelection: without a pass scope the per-round buckets are suppressed', () => {
  // The Map page's global status is sticky-completed and campaign-wide (households.js:610) — a
  // different question from the one the server asks about the target round. Claiming "completed
  // this round" off it would be a confident lie, so those buckets come back null and the server's
  // response tally owns them.
  const plan = planDoorSelection(ROWS, { forRound: false });
  assert.equal(plan.perRound, false);
  assert.equal(plan.alreadyRestricted, null);
  assert.equal(plan.completedThisRound, null);
  assert.equal(plan.reached, null);
  assert.equal(plan.unknocked, null);
  assert.equal(plan.markable, plan.markIds.length, 'every eligible door — the server narrows it');
  assert.equal(plan.markable, 3);
  assert.equal(plan.cannotMark, 3, 'the eligibility gates ARE campaign-wide facts, so they print');
});

test('planDoorSelection: a missing effortId field is not Intake', () => {
  // The Turf page's /doors rows carry no effortId — every door there is the pass's effort by
  // construction. Reading `undefined` as Intake would empty both payloads on that whole page.
  const plan = planDoorSelection([{ id: 'x', status: 'unknocked' }], { forRound: true, sendsPassId: false });
  assert.deepEqual(plan.markIds, ['x']);
  assert.deepEqual(plan.unmarkIds, ['x']);
  assert.equal(plan.cannotMark, 0);
});

test('planDoorSelection: an empty selection is all zeros', () => {
  const plan = planDoorSelection([], { forRound: true });
  assert.equal(plan.total, 0);
  assert.equal(plan.markable, 0);
  assert.deepEqual(plan.markIds, []);
  assert.deepEqual(plan.unmarkIds, []);
});
