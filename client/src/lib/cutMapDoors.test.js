import { test } from 'node:test';
import assert from 'node:assert';
import { passBookIds, isLooseDoor, visibleCutDoors, countLooseDoors } from './cutMapDoors.js';

// cutMapDoors.js is the ONE place the Turf Cutting map's loose-door rule lives, so this is
// where it gets locked down. The regression under test (shipped + caught in prod, 2026-07):
// "loose" was judged as `turfId == null`, but Household.turfId is a single global pointer a
// cut only re-points for the doors it SELECTS — so doors a targeted Pass-2 cut skipped still
// carried their Pass-1 book ids. Result: looseDoorCount === 0 (the "Not in a book" toggle
// row never rendered) while those same doors stayed on the map as gray dots. The companion
// regression: judged by turfId-null, a brand-new pass BEFORE its first cut hid every door —
// a blank pre-cut map.

const T = (id) => ({ _id: id }); // a book (turf) as the page's turfsQ returns it
const D = (id, turfId) => ({ id, turfId }); // a door as /turfs/doors returns it

// Pass 2 has two books; the doors mix all three real-world cases.
const PASS2_BOOKS = passBookIds([T('b21'), T('b22')]);
const DOORS = [
  D('d1', 'b21'), // in a Pass-2 book
  D('d2', 'b22'), // in a Pass-2 book
  D('d3', 'b11'), // THE BUG: skipped by the targeted cut, still carries its Pass-1 book id
  D('d4', 'b12'), // same — another stale Pass-1 pointer
  D('d5', null), // voter imported after the cut (turfId never set)
];

test('a door carrying another pass\'s book id is LOOSE — the production bug', () => {
  assert.equal(isLooseDoor(D('d3', 'b11'), PASS2_BOOKS), true);
  // and by turfId-presence it would have (wrongly) read as booked:
  assert.notEqual(!!D('d3', 'b11').turfId, isLooseDoor(D('d3', 'b11'), PASS2_BOOKS) === false);
});

test('doors in this pass\'s books are never loose; null turfId is loose', () => {
  assert.equal(isLooseDoor(D('d1', 'b21'), PASS2_BOOKS), false);
  assert.equal(isLooseDoor(D('d5', null), PASS2_BOOKS), true);
});

test('toggle off (default): only this pass\'s booked doors are drawn', () => {
  const visible = visibleCutDoors(DOORS, PASS2_BOOKS, false);
  assert.deepEqual(visible.map((d) => d.id), ['d1', 'd2']);
});

test('toggle on: every door is drawn, stale-pointer and null alike', () => {
  const visible = visibleCutDoors(DOORS, PASS2_BOOKS, true);
  assert.equal(visible.length, DOORS.length);
});

test('before any cut (no books) NOTHING hides — the blank pre-cut-map regression', () => {
  const noBooks = passBookIds([]);
  assert.equal(visibleCutDoors(DOORS, noBooks, false).length, DOORS.length);
  // and the toggle row stays hidden: no books means the count is 0, not "everything is loose"
  assert.equal(countLooseDoors(DOORS, noBooks), 0);
});

test('the toggle count matches exactly the doors the default view hides', () => {
  const count = countLooseDoors(DOORS, PASS2_BOOKS);
  assert.equal(count, 3); // d3 + d4 (stale Pass-1 ids) + d5 (null)
  assert.equal(count, DOORS.length - visibleCutDoors(DOORS, PASS2_BOOKS, false).length);
});

test('undefined/empty doors are safe (queries still loading)', () => {
  assert.deepEqual(visibleCutDoors(undefined, PASS2_BOOKS, false), []);
  assert.equal(countLooseDoors(undefined, PASS2_BOOKS), 0);
});
