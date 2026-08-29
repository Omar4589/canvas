import { test } from 'node:test';
import assert from 'node:assert';
import { crewCounts } from './turfCrewCounts.js';
import { bookStatusSet } from './bookStatusFilter.js';

// The report that motivated this module (production, 2026-08-29): the Turf Cutting header read
// "ASSIGNED 8 · 83 books unassigned" while the filter pill inches to its right read
// "Assigned 14 | Unassigned 83", on a pass of 97 books. Nothing was miscounted — the strip's
// headline counted CANVASSERS, the pill counted BOOKS, and one word carried both units. The
// map's "Crew load" pill made it worse by printing turfs.length (97, the whole pass) as the
// crew's load. These tests pin each number to its unit and to the pill it must agree with.

const book = (id) => ({ _id: id });
// "u3!" marks a deactivated member — the ADDITIVE `user.inactive` flag /turfs/assignments sets.
const user = (id) => ({ id: id.replace(/!$/, ''), firstName: 'C', lastName: id, ...(id.endsWith('!') ? { inactive: true } : {}) });

// The page's own turfId -> [user] map, built from /turfs/assignments.
const mapOf = (pairs) => {
  const m = new Map();
  for (const [turfId, ids] of pairs) m.set(String(turfId), ids.map(user));
  return m;
};

// `turfs` here is always the PUBLISHED set — drafts never reach this helper (TurfsPage passes
// publishedTurfs), because a draft can't be assigned and so isn't "unassigned work".
test('the reported screenshot: 8 canvassers hold 14 of 97 books', () => {
  const turfs = Array.from({ length: 97 }, (_, i) => book(`b${i}`));
  // 14 distinct books carrying 15 assignment rows across 8 people — one book is co-assigned,
  // which is exactly what makes "sum the crew panel's per-person book counts" the wrong fix.
  const assigned = mapOf([
    ['b0', ['u1']], ['b1', ['u1']], ['b2', ['u2']], ['b3', ['u2']],
    ['b4', ['u3']], ['b5', ['u3']], ['b6', ['u4']], ['b7', ['u4']],
    ['b8', ['u5']], ['b9', ['u5']], ['b10', ['u6']], ['b11', ['u7']],
    ['b12', ['u8']], ['b13', ['u7', 'u8']],
  ]);
  const c = crewCounts(turfs, assigned);
  assert.equal(c.canvassers, 8, 'headline counts PEOPLE, deduped across books');
  assert.equal(c.assignedBooks, 14, 'crew pill counts BOOKS the crew holds, not the pass');
  assert.equal(c.unassignedBooks, 83);
  // The number the crew pill used to print. If assignedBooks ever equals it again, the
  // "N canvassers · N books" sentence is claiming the crew holds the entire pass.
  assert.notEqual(c.assignedBooks, turfs.length);
});

test('canvassers and books are different units — one person can hold every book', () => {
  const turfs = [book('a'), book('b'), book('c')];
  const c = crewCounts(turfs, mapOf([['a', ['solo']], ['b', ['solo']], ['c', ['solo']]]));
  assert.equal(c.canvassers, 1);
  assert.equal(c.assignedBooks, 3);
  assert.equal(c.unassignedBooks, 0);
});

test('...and one book can hold every canvasser', () => {
  const turfs = [book('a'), book('b')];
  const c = crewCounts(turfs, mapOf([['a', ['x', 'y', 'z']]]));
  assert.equal(c.canvassers, 3);
  assert.equal(c.assignedBooks, 1);
  assert.equal(c.unassignedBooks, 1);
});

test('assignedBooks + unassignedBooks always equals the book count', () => {
  // The same partition the Assigned/Unassigned filter chips make, so the strip's hint and the
  // Unassigned pill can never disagree — they are now two readings of one walk.
  for (const assigned of [[], [['a', ['u']]], [['a', ['u']], ['b', ['v']]]]) {
    const turfs = [book('a'), book('b'), book('c')];
    const c = crewCounts(turfs, mapOf(assigned));
    assert.equal(c.assignedBooks + c.unassignedBooks, turfs.length);
  }
});

test('agrees book-for-book with the Assigned filter chip', () => {
  const turfs = [book('a'), book('b'), book('c'), book('d')];
  const assigned = mapOf([['a', ['u1']], ['c', ['u2', 'u3']]]);
  const c = crewCounts(turfs, assigned);
  // Count the chip's way: one coverage key per book, via the shared bookStatusFilter rules.
  let chipAssigned = 0;
  for (const t of turfs) {
    const keys = bookStatusSet({ assigned: (assigned.get(String(t._id)) || []).length > 0 });
    if (keys.has('assigned')) chipAssigned += 1;
  }
  assert.equal(c.assignedBooks, chipAssigned);
  assert.equal(c.unassignedBooks, turfs.length - chipAssigned);
});

test('an assignment row for a book the list does not carry is ignored', () => {
  // /turfs hides archived books; /turfs/assignments never joins Turf, so a stale row can name
  // a book the page never received. The old strip counted that person, the crew pill did not.
  const turfs = [book('a')];
  const c = crewCounts(turfs, mapOf([['a', ['u1']], ['ghost', ['u2']]]));
  assert.equal(c.canvassers, 1, 'a ghost row must not inflate the headline');
  assert.equal(c.assignedBooks, 1);
});

test('empty pass and empty crew', () => {
  assert.deepEqual(crewCounts([], new Map()), {
    canvassers: 0, assignedBooks: 0, unassignedBooks: 0, inactiveCanvassers: 0, booksAllInactive: 0,
  });
  const turfs = [book('a'), book('b')];
  assert.deepEqual(crewCounts(turfs, new Map()), {
    canvassers: 0, assignedBooks: 0, unassignedBooks: 2, inactiveCanvassers: 0, booksAllInactive: 0,
  });
});

// Deactivating a member deliberately KEEPS their books (memberships.js skips
// releaseAssignedWork), so the ruling is: name it, never silently reclassify it.
test('a deactivated canvasser still counts — the book stays assigned', () => {
  const turfs = [book('a'), book('b')];
  const c = crewCounts(turfs, mapOf([['a', ['gone!']], ['b', ['here']]]));
  assert.equal(c.canvassers, 2, 'still a canvasser: the count must not move');
  assert.equal(c.assignedBooks, 2, 'the book must not flip to unassigned');
  assert.equal(c.unassignedBooks, 0);
  assert.equal(c.inactiveCanvassers, 1);
  assert.equal(c.booksAllInactive, 1, 'nobody on the roster can open book a');
});

test('a book with one active canvasser beside a deactivated one is NOT flagged', () => {
  const turfs = [book('a')];
  const c = crewCounts(turfs, mapOf([['a', ['gone!', 'here']]]));
  assert.equal(c.inactiveCanvassers, 1, 'the person is still named');
  assert.equal(c.booksAllInactive, 0, 'but the book is walkable — never flag it');
});

test('one deactivated person across many books counts once', () => {
  const turfs = [book('a'), book('b'), book('c')];
  const c = crewCounts(turfs, mapOf([['a', ['gone!']], ['b', ['gone!']], ['c', ['here']]]));
  assert.equal(c.inactiveCanvassers, 1);
  assert.equal(c.booksAllInactive, 2);
  assert.equal(c.canvassers, 2);
});

test('turfId is matched as a string, as the page stores it', () => {
  // The page keys the map with String(a.turfId) while book ids arrive as ObjectId-ish objects.
  const turfs = [{ _id: { toString: () => 'oid1' } }];
  const c = crewCounts(turfs, mapOf([['oid1', ['u1']]]));
  assert.equal(c.assignedBooks, 1);
  assert.equal(c.canvassers, 1);
});
