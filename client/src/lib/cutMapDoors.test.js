import { test } from 'node:test';
import assert from 'node:assert';
import { passBookIds, isLooseDoor, visibleCutDoors, countLooseDoors, drawnCutDoors, isOffLimitsDoor } from './cutMapDoors.js';

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

// ---------------------------------------------------------------------------
// drawnCutDoors — "what is the map ACTUALLY drawing", the pool a lasso may catch.
// Two of the page's three visibility mechanisms live in Mapbox layer state (the
// book-status chips' setFilter, the Houses layer's visibility) and are invisible to
// `visibleCutDoors`, so a lasso hit-tested against that alone would select doors that
// are not on the screen — and then desk-restrict them.

// Doors carry coordinates here: the chip filter is applied per BUILDING (rounded key).
const P = (id, turfId, lng, lat) => ({ id, turfId, lng, lat });

test('no chip active: drawnCutDoors is exactly visibleCutDoors', () => {
  const doors = [P('d1', 'b21', -96.1, 41.1), P('d2', 'b22', -96.2, 41.2), P('d3', 'b11', -96.3, 41.3)];
  const drawn = drawnCutDoors({ doors, bookIds: PASS2_BOOKS, showLoose: true, visibleBookIds: null });
  assert.deepEqual(drawn, visibleCutDoors(doors, PASS2_BOOKS, true));
});

test('Houses layer off: NOTHING is drawn, so nothing is selectable', () => {
  const doors = [P('d1', 'b21', -96.1, 41.1)];
  assert.deepEqual(
    drawnCutDoors({ doors, bookIds: PASS2_BOOKS, showLoose: true, visibleBookIds: null, housesVisible: false }),
    []
  );
  // …even with a chip that would otherwise pass the door through.
  assert.deepEqual(
    drawnCutDoors({
      doors,
      bookIds: PASS2_BOOKS,
      showLoose: true,
      visibleBookIds: new Set(['b21']),
      housesVisible: false,
    }),
    []
  );
});

test('a book-status chip hides the other books\' doors', () => {
  const doors = [P('d1', 'b21', -96.1, 41.1), P('d2', 'b22', -96.2, 41.2)];
  const drawn = drawnCutDoors({ doors, bookIds: PASS2_BOOKS, showLoose: false, visibleBookIds: new Set(['b21']) });
  assert.deepEqual(drawn.map((d) => d.id), ['d1']);
});

test('ANY active chip hides loose doors — their turfId is in no book\'s id list', () => {
  // The regression this pins: the map draws loose dots with turfId '' (doorsToGeoJSON), and
  // `['in', ['get','turfId'], [...bookIds]]` never matches '', so "Not in a book" being ON
  // does NOT put them back on screen while a chip is active.
  const doors = [P('d1', 'b21', -96.1, 41.1), P('d5', null, -96.5, 41.5)];
  const drawn = drawnCutDoors({
    doors,
    bookIds: PASS2_BOOKS,
    showLoose: true, // Layers → "Not in a book" is ON
    visibleBookIds: new Set(['b21', 'b22']), // …but a chip is active
  });
  assert.deepEqual(drawn.map((d) => d.id), ['d1']);
});

test('the loose-door toggle still applies before the chip filter', () => {
  const doors = [P('d1', 'b21', -96.1, 41.1), P('d3', 'b11', -96.3, 41.3)];
  // Chip lets b11 through, but the door is loose for THIS pass and the toggle is off.
  const drawn = drawnCutDoors({
    doors,
    bookIds: PASS2_BOOKS,
    showLoose: false,
    visibleBookIds: new Set(['b21', 'b11']),
  });
  assert.deepEqual(drawn.map((d) => d.id), ['d1']);
});

test('a stacked building is drawn or hidden as ONE pin, by its first unit\'s book', () => {
  // Same rounded coordinate = one building pin, whose turfId is the FIRST unit's (groupDoors).
  const stack = [P('u1', 'b21', -96.4, 41.4), P('u2', 'b22', -96.4, 41.4)];
  const chip = new Set(['b21']);
  // The pin passes the chip, so BOTH units are on the screen and both are selectable —
  // judging u2 on its own turfId would let the lasso miss a door whose pin it ringed.
  const shown = drawnCutDoors({ doors: stack, bookIds: PASS2_BOOKS, showLoose: false, visibleBookIds: chip });
  assert.deepEqual(shown.map((d) => d.id), ['u1', 'u2']);
  // And when the pin's own book is filtered out, neither unit is drawn.
  const hidden = drawnCutDoors({
    doors: stack,
    bookIds: PASS2_BOOKS,
    showLoose: false,
    visibleBookIds: new Set(['b22']),
  });
  assert.deepEqual(hidden.map((d) => d.id), []);
});

test('undefined doors are safe (the query is still loading)', () => {
  assert.deepEqual(drawnCutDoors({ doors: undefined, bookIds: PASS2_BOOKS, showLoose: false }), []);
});

// ---------------------------------------------------------------------------
// hideOffLimits — the "Restricted & no soliciting" Layers row. Hides single-home dots whose
// PER-ROUND status is restricted/no_soliciting; a stacked building keeps every unit (its pin
// never takes a status color, and dropping units would change stack totals / pin ownership).
// Threaded through drawnCutDoors so a hidden dot is also un-selectable — same rule as the
// other three visibility mechanisms above.

// A door as /turfs/doors?withStatus=1 returns it: coordinates + this round's passStatus.
const S = (id, turfId, lng, lat, passStatus) => ({ id, turfId, lng, lat, passStatus });

test('off-limits statuses are restricted and no_soliciting, judged on passStatus', () => {
  assert.equal(isOffLimitsDoor(S('d1', 'b21', -96.1, 41.1, 'restricted')), true);
  assert.equal(isOffLimitsDoor(S('d2', 'b21', -96.1, 41.1, 'no_soliciting')), true);
  assert.equal(isOffLimitsDoor(S('d3', 'b21', -96.1, 41.1, 'surveyed')), false);
  // The global Household.status is NOT the judge — a prior round's restriction stays drawn.
  assert.equal(isOffLimitsDoor({ id: 'd4', status: 'restricted', passStatus: 'unknocked' }), false);
});

test('hideOffLimits drops restricted/no-soliciting SINGLES, keeps everything else', () => {
  const doors = [
    S('d1', 'b21', -96.1, 41.1, 'restricted'),
    S('d2', 'b21', -96.2, 41.2, 'no_soliciting'),
    S('d3', 'b21', -96.3, 41.3, 'surveyed'),
    S('d4', 'b22', -96.4, 41.4, 'unknocked'),
  ];
  const drawn = drawnCutDoors({ doors, bookIds: PASS2_BOOKS, showLoose: false, hideOffLimits: true });
  assert.deepEqual(drawn.map((d) => d.id), ['d3', 'd4']);
  // Off by default: nothing changes.
  const off = drawnCutDoors({ doors, bookIds: PASS2_BOOKS, showLoose: false });
  assert.equal(off.length, doors.length);
});

test('a stacked building keeps ALL its units — restricted ones included', () => {
  // Two units at one rounded key, one of them restricted: the stack is drawn whole, so
  // both stay selectable (a lasso catches a building as a unit, and the pin shows no status).
  const stack = [S('u1', 'b21', -96.5, 41.5, 'restricted'), S('u2', 'b21', -96.5, 41.5, 'unknocked')];
  const drawn = drawnCutDoors({ doors: stack, bookIds: PASS2_BOOKS, showLoose: false, hideOffLimits: true });
  assert.deepEqual(drawn.map((d) => d.id), ['u1', 'u2']);
  // Even a FULLY off-limits stack stays: buildings are never status-filtered.
  const allRestricted = [S('u3', 'b21', -96.6, 41.6, 'restricted'), S('u4', 'b21', -96.6, 41.6, 'restricted')];
  assert.equal(drawnCutDoors({ doors: allRestricted, bookIds: PASS2_BOOKS, showLoose: false, hideOffLimits: true }).length, 2);
});

test('a hidden off-limits single is out of the pool even when its book passes the chips', () => {
  const doors = [S('d1', 'b21', -96.1, 41.1, 'restricted'), S('d2', 'b21', -96.2, 41.2, 'not_home')];
  const drawn = drawnCutDoors({
    doors,
    bookIds: PASS2_BOOKS,
    showLoose: false,
    visibleBookIds: new Set(['b21']),
    hideOffLimits: true,
  });
  assert.deepEqual(drawn.map((d) => d.id), ['d2']);
});

test('an off-limits door with no coordinates is dropped when hiding (it was never drawable)', () => {
  const doors = [{ id: 'd1', turfId: 'b21', passStatus: 'restricted' }, S('d2', 'b21', -96.2, 41.2, 'unknocked')];
  const drawn = drawnCutDoors({ doors, bookIds: PASS2_BOOKS, showLoose: false, hideOffLimits: true });
  assert.deepEqual(drawn.map((d) => d.id), ['d2']);
});
