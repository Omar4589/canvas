import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  moveTargetCandidates,
  planLassoMove,
  moveSourceLine,
  pickMergePrimary,
  moveDoorsToast,
  moveBooksToast,
  emptiedDonors,
} from './moveTargets.js';

// moveTargets.js is the pure half of the two bulk-move surfaces on the Turf Cutting page.
// Under lock: who the picker offers (exclusions, draft badge, the eligible-count fallback,
// holdsAll), the pass-membership loose rule for the donor breakdown, the born-live merge
// survivor, the toast grammar, and the emptied-donor filter over the server's `from[]`.

const turfs = [
  { _id: 'a', name: 'Book A', status: 'published', doorCount: 40, eligibleDoorCount: 38 },
  { _id: 'b', name: 'Book B', status: 'draft', doorCount: 12 },
  { _id: 'c', name: 'Book C', status: 'published', doorCount: 9 },
  { _id: 'z', name: 'Old stub', status: 'archived', doorCount: 5 },
];
const colors = new Map([['a', '#111'], ['b', '#222'], ['c', '#333']]);

test('candidates: archived dropped, exclusions honored, eligible count preferred, draft flagged', () => {
  const rows = moveTargetCandidates(turfs, colors, { excludeIds: new Set(['c']) });
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b']);
  assert.equal(rows[0].doors, 38, 'eligibleDoorCount wins over doorCount');
  assert.equal(rows[1].doors, 12, 'doorCount is the fallback');
  assert.equal(rows[0].draft, false);
  assert.equal(rows[1].draft, true);
  assert.equal(rows[0].color, '#111');
});

test('candidates: holdsAll disables only the book holding the WHOLE selection', () => {
  const donorCounts = new Map([['a', 3], ['b', 1]]);
  const rows = moveTargetCandidates(turfs, colors, { donorCounts, selectionSize: 3 });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.a.holdsAll, true);
  assert.equal(byId.a.holdsSome, 3);
  assert.equal(byId.b.holdsAll, false);
  assert.equal(byId.b.holdsSome, 1);
  assert.equal(byId.c.holdsAll, false);
});

test('candidates: empty inputs are safe', () => {
  assert.deepEqual(moveTargetCandidates(null, null, {}), []);
  assert.deepEqual(moveTargetCandidates([], new Map()), []);
});

test('planLassoMove: donors grouped by book, loose judged by PASS membership', () => {
  const passTurfIds = new Set(['a', 'b']);
  const rows = [
    { id: '1', turfId: 'a' },
    { id: '2', turfId: 'a' },
    { id: '3', turfId: 'b' },
    { id: '4', turfId: null }, // never booked
    { id: '5', turfId: 'prior-pass-book' }, // stale prior-round id = LOOSE here
  ];
  const plan = planLassoMove(rows, passTurfIds);
  assert.equal(plan.total, 5);
  assert.deepEqual([...plan.donors.entries()], [['a', 2], ['b', 1]]);
  assert.equal(plan.looseCount, 2);
});

test('planLassoMove: empty selection', () => {
  const plan = planLassoMove([], new Set());
  assert.equal(plan.total, 0);
  assert.equal(plan.donors.size, 0);
  assert.equal(plan.looseCount, 0);
});

test('moveSourceLine grammar: one donor, many donors, loose clause, loose-only', () => {
  const nameOf = (id) => ({ a: 'Book A', b: 'Book B', c: 'Book C' })[id];
  assert.equal(moveSourceLine({ donors: new Map([['a', 25]]), looseCount: 0 }, nameOf), 'They leave “Book A” (25)');
  assert.equal(
    moveSourceLine({ donors: new Map([['a', 25], ['b', 8]]), looseCount: 4 }, nameOf),
    'They leave “Book A” (25) and “Book B” (8) · 4 aren\'t in any book yet'
  );
  assert.equal(
    moveSourceLine({ donors: new Map([['a', 1], ['b', 2], ['c', 3]]), looseCount: 0 }, nameOf),
    'They leave “Book A” (1), “Book B” (2) and “Book C” (3)'
  );
  assert.equal(moveSourceLine({ donors: new Map(), looseCount: 1 }, nameOf), "1 isn't in any book yet");
  assert.equal(moveSourceLine({}, nameOf), '');
});

test('pickMergePrimary: a published book survives a mixed selection (born-live); all-draft keeps the first', () => {
  assert.equal(pickMergePrimary([{ _id: 'd1', status: 'draft' }, { _id: 'p1', status: 'published' }]), 'p1');
  assert.equal(pickMergePrimary([{ _id: 'd1', status: 'draft' }, { _id: 'd2', status: 'draft' }]), 'd1');
  assert.equal(pickMergePrimary([]), '');
});

test('toast grammar', () => {
  assert.equal(moveDoorsToast({ moved: 37, toName: 'Book 7', isNew: false }), 'Moved 37 doors to “Book 7”.');
  assert.equal(moveDoorsToast({ moved: 1, toName: 'North Hill', isNew: true }), 'Moved 1 door to new book “North Hill”.');
  assert.equal(
    moveBooksToast({ doors: 130, mergedCount: 2, toName: 'Book 7', isNew: false }),
    'Moved 130 doors into “Book 7” — 2 books merged away.'
  );
  assert.equal(
    moveBooksToast({ doors: 60, mergedCount: 3, toName: 'North Hill', isNew: true }),
    'Merged 3 books into new book “North Hill”.'
  );
});

test('emptiedDonors filters the response `from[]`, tolerating missing payloads', () => {
  const res = {
    from: [
      { id: 'a', name: 'Book A', doorCount: 0, emptied: true },
      { id: 'b', name: 'Book B', doorCount: 2, emptied: false },
    ],
  };
  assert.deepEqual(emptiedDonors(res).map((d) => d.id), ['a']);
  assert.deepEqual(emptiedDonors(null), []);
  assert.deepEqual(emptiedDonors({}), []);
});
