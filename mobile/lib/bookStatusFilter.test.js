import { test } from 'node:test';
import assert from 'node:assert';
import { bookProgressKey, bookStatusSet, matchesBookStatus } from './bookStatusFilter.js';

// Mirror of client/src/lib/bookStatusFilter.test.js — the shared rules pinned on the mobile
// copy too, so a drift between the two mirrors fails a test instead of shipping a screen
// where a book reads Completed on the phone and Restricted on the web.
//
// The regression that motivated the two-group rule (shipped as one flat union until 2026-08):
// an admin picking Not started + In progress + Unassigned — "show me the work" — got every
// completed book back too, because completed-but-unassigned books matched on "unassigned".
// On a round with desk-restricted books (which read completed: every non-unknocked door
// counts as knocked), those were the exact books being filtered away.

// A /turfs/progress row as the oracle returns it.
const P = (total, knocked, statusCounts = {}) => ({ total, knocked, statusCounts });

test('progress bucket: not started / in progress / completed', () => {
  assert.equal(bookProgressKey(P(65, 0)), 'not_started');
  assert.equal(bookProgressKey(P(65, 23)), 'in_progress');
  assert.equal(bookProgressKey(P(65, 65, { surveyed: 40, not_home: 20, refused: 5 })), 'completed');
});

test('a fully off-limits book reads RESTRICTED, never completed', () => {
  assert.equal(bookProgressKey(P(40, 40, { restricted: 40 })), 'restricted');
  assert.equal(bookProgressKey(P(40, 40, { restricted: 35, no_soliciting: 5 })), 'restricted');
});

test('a finished book with ANY real work stays completed', () => {
  assert.equal(bookProgressKey(P(40, 40, { surveyed: 10, restricted: 30 })), 'completed');
});

test('mid-round restricted marks do not flip the bucket early', () => {
  assert.equal(bookProgressKey(P(40, 30, { restricted: 10, not_home: 20, unknocked: 10 })), 'in_progress');
});

test('no progress row / zero eligible doors = no progress bucket', () => {
  assert.equal(bookProgressKey(undefined), null);
  assert.equal(bookProgressKey(P(0, 0)), null);
  assert.deepEqual([...bookStatusSet({ assigned: false, progress: P(0, 0) })], ['unassigned']);
});

test('the Books screen loading fallback (total from book.doors, no statusCounts) still buckets', () => {
  // While the progress query loads, books.jsx synthesizes { total: book.doors, knocked: 0 } —
  // the book reads not_started, and restricted is unreachable until real statusCounts arrive.
  assert.equal(bookProgressKey({ total: 40, knocked: 0, statusCounts: undefined }), 'not_started');
});

test('a book carries exactly one coverage key plus at most one progress key', () => {
  assert.deepEqual([...bookStatusSet({ assigned: true, progress: P(65, 23) })], ['assigned', 'in_progress']);
  assert.deepEqual([...bookStatusSet({ assigned: false, progress: P(40, 40, { restricted: 40 }) })], ['unassigned', 'restricted']);
});

// ---------------------------------------------------------------------------
// matchesBookStatus — OR within a group, AND across the two groups.

const sel = (...keys) => new Set(keys);

test('empty filter shows every book', () => {
  assert.equal(matchesBookStatus(sel(), sel()), true);
  assert.equal(matchesBookStatus(bookStatusSet({ assigned: false, progress: P(40, 40, { restricted: 40 }) }), new Set()), true);
});

test('one chip from one group leaves the other group unconstrained — old behavior kept', () => {
  const assignedDone = bookStatusSet({ assigned: true, progress: P(65, 65, { surveyed: 65 }) });
  assert.equal(matchesBookStatus(assignedDone, sel('completed')), true);
  assert.equal(matchesBookStatus(assignedDone, sel('assigned')), true);
  assert.equal(matchesBookStatus(assignedDone, sel('not_started')), false);
});

test('THE regression: Unassigned + Not started + In progress no longer readmits completed books', () => {
  const filter = sel('unassigned', 'not_started', 'in_progress');
  assert.equal(matchesBookStatus(bookStatusSet({ assigned: false, progress: P(65, 65, { surveyed: 65 }) }), filter), false);
  assert.equal(matchesBookStatus(bookStatusSet({ assigned: false, progress: P(40, 40, { restricted: 40 }) }), filter), false);
  assert.equal(matchesBookStatus(bookStatusSet({ assigned: false, progress: P(65, 0) }), filter), true);
  assert.equal(matchesBookStatus(bookStatusSet({ assigned: false, progress: P(65, 23) }), filter), true);
  assert.equal(matchesBookStatus(bookStatusSet({ assigned: true, progress: P(65, 23) }), filter), false);
});

test('within a group the chips still union', () => {
  const filter = sel('not_started', 'in_progress');
  assert.equal(matchesBookStatus(bookStatusSet({ assigned: true, progress: P(65, 0) }), filter), true);
  assert.equal(matchesBookStatus(bookStatusSet({ assigned: false, progress: P(65, 23) }), filter), true);
  assert.equal(matchesBookStatus(bookStatusSet({ assigned: true, progress: P(65, 65, { surveyed: 65 }) }), filter), false);
});

test('the Restricted chip finds off-the-table books, and Completed no longer does', () => {
  const restrictedBook = bookStatusSet({ assigned: false, progress: P(40, 40, { restricted: 40 }) });
  assert.equal(matchesBookStatus(restrictedBook, sel('restricted')), true);
  assert.equal(matchesBookStatus(restrictedBook, sel('completed')), false);
});

test('a book with no progress bucket cannot pass a progress selection', () => {
  const zeroDoors = bookStatusSet({ assigned: false, progress: P(0, 0) });
  assert.equal(matchesBookStatus(zeroDoors, sel('not_started')), false);
  assert.equal(matchesBookStatus(zeroDoors, sel('unassigned')), true);
});
