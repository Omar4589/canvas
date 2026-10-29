import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addVoterBody, bookClosed, doorResultBody, doorTurfId, pendingDoorVerdict, surveyBody } from './doorPaths.js';

// The book every door write names, and the two places the phone acts on a door's book changing under
// it (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §E.1, §E.5, §E.6).

const bootstrap = {
  households: [
    { _id: 'h1', turfId: 'b1', status: 'unknocked' },
    { _id: 'h2', turfId: null, status: 'unknocked' },
    { _id: 'h3', status: 'unknocked' },
  ],
};

test('doorTurfId reads the door’s book from the cached bootstrap, or null', () => {
  assert.equal(doorTurfId(bootstrap, 'h1'), 'b1');
  assert.equal(doorTurfId(bootstrap, 'h2'), null, 'a door with no book');
  assert.equal(doorTurfId(bootstrap, 'h3'), null, 'a door without the field');
  assert.equal(doorTurfId(bootstrap, 'h9'), null, 'a door not in the cache');
  assert.equal(doorTurfId(undefined, 'h1'), null, 'no bootstrap yet');
  assert.equal(doorTurfId({}, 'h1'), null, 'a bootstrap without households');
  // Ids compare, and go out, as strings.
  assert.equal(doorTurfId({ households: [{ _id: 7, turfId: 42 }] }, '7'), '42');
});

test('every door write names the book it was tapped in, or null — the key is never left out', () => {
  assert.deepEqual(doorResultBody({ note: 'Gate locked', turfId: 'b1' }), { note: 'Gate locked', turfId: 'b1' });
  assert.deepEqual(doorResultBody({ note: null, turfId: null }), { note: null, turfId: null });
  assert.deepEqual(doorResultBody(), { note: null, turfId: null });

  const answers = [{ questionKey: 'q1', value: 'yes' }];
  assert.deepEqual(surveyBody({ surveyTemplateId: 't1', answers, note: null, turfId: 'b1' }), {
    surveyTemplateId: 't1',
    answers,
    note: null,
    turfId: 'b1',
  });
  assert.equal(surveyBody({ surveyTemplateId: 't1', answers, note: 'Call back' }).note, 'Call back');
  assert.equal(surveyBody({ surveyTemplateId: 't1', answers, note: null }).turfId, null);

  assert.deepEqual(addVoterBody({ voterId: 'w1', firstName: 'Sam', lastName: 'Q', turfId: 'b1' }), {
    voterId: 'w1',
    firstName: 'Sam',
    lastName: 'Q',
    phone: null,
    email: null,
    turfId: 'b1',
  });
  assert.equal(addVoterBody({ voterId: 'w1', firstName: 'Sam', lastName: 'Q' }).turfId, null);

  // How the writers build them: the book read at the tap from the cache the door screen shows.
  assert.equal(doorResultBody({ turfId: doorTurfId(bootstrap, 'h1') }).turfId, 'b1');
  assert.equal(surveyBody({ surveyTemplateId: 't1', answers, note: null, turfId: doorTurfId(bootstrap, 'h9') }).turfId, null);
  for (const body of [doorResultBody(), surveyBody({ surveyTemplateId: 't1', answers: [] }), addVoterBody({ voterId: 'w2' })]) {
    assert.ok('turfId' in body, JSON.stringify(body));
  }
});

// The overlay's decisions, at the TTL recordAction.js uses.
const TTL = 5 * 60 * 1000;
const T0 = 1_700_000_000_000;
const entry = (extra = {}) => ({ status: 'not_home', at: T0, turfId: 'b1', ...extra });
const after = (ms) => ({ now: T0 + ms, ttlMs: TTL });

test('the overlay holds a recorded status until the server agrees, or until the TTL runs out', () => {
  assert.equal(pendingDoorVerdict(entry(), { turfId: 'b1', status: 'unknocked' }, after(1000)), 'hold', 'server behind');
  assert.equal(pendingDoorVerdict(entry(), { turfId: 'b1', status: 'not_home' }, after(1000)), 'confirmed');
  assert.equal(pendingDoorVerdict(entry(), { turfId: 'b1', status: 'unknocked' }, after(TTL)), 'hold', 'at the TTL');
  assert.equal(pendingDoorVerdict(entry(), { turfId: 'b1', status: 'unknocked' }, after(TTL + 1)), 'expired');
});

test('the overlay follows the book: a door a new pass has taken stops showing the old round’s status', () => {
  // The refetch after Pass 4 went live: the door is in the canvasser's Pass 4 book, unknocked there,
  // because the knock counted in Pass 3.
  assert.equal(pendingDoorVerdict(entry(), { turfId: 'b4', status: 'unknocked' }, after(1000)), 'moved');
  assert.equal(pendingDoorVerdict(entry({ status: 'surveyed' }), { turfId: 'b4', status: 'not_home' }, after(1000)), 'moved');
  // A /changes delta keeps the cached book (lib/deltaFold.js), so it reads as the same book.
  assert.equal(pendingDoorVerdict(entry(), { turfId: 'b1', status: 'unknocked' }, after(1000)), 'hold');
  // Either book unknown is no sign of a move: the overlay behaves as it did before books were tracked.
  assert.equal(pendingDoorVerdict(entry({ turfId: null }), { turfId: 'b4', status: 'unknocked' }, after(1000)), 'hold');
  assert.equal(pendingDoorVerdict(entry({ turfId: undefined }), { turfId: 'b4', status: 'unknocked' }, after(1000)), 'hold');
  assert.equal(pendingDoorVerdict(entry(), { turfId: null, status: 'unknocked' }, after(1000)), 'hold');
  assert.equal(pendingDoorVerdict(entry(), { status: 'unknocked' }, after(1000)), 'hold');
  // Ids compare as strings.
  assert.equal(pendingDoorVerdict(entry({ turfId: '42' }), { turfId: 42, status: 'unknocked' }, after(1000)), 'hold');
});

// The map's empty state. `data` is the bootstrap as the map holds it.
const fresh = (extra = {}) => ({ books: [], households: [], ...extra });
const sel = (...ids) => new Set(ids);

test('"No book right now": the selected book is gone from fresh data and no doors are left', () => {
  // Archived walk list, unassigned book: the only book is gone, and with it every door.
  assert.equal(bookClosed({ selectedBookIds: sel('b1'), data: fresh() }), true);
  // A two-book selection, both gone.
  assert.equal(bookClosed({ selectedBookIds: sel('b1', 'b2'), data: fresh() }), true);
  // The selection as an array works the same.
  assert.equal(bookClosed({ selectedBookIds: ['b1'], data: fresh() }), true);
  // Gone, while another book with no doors left is listed.
  assert.equal(bookClosed({ selectedBookIds: sel('b1'), data: fresh({ books: [{ id: 'b9' }] }) }), true);
});

test('"No turf assigned yet" stays for a canvasser who never had a book, a book emptied by voting, and the disk copy', () => {
  // Never had a book: nothing selected.
  assert.equal(bookClosed({ selectedBookIds: null, data: fresh() }), false);
  assert.equal(bookClosed({ selectedBookIds: sel(), data: fresh() }), false);
  assert.equal(bookClosed({ selectedBookIds: sel(''), data: fresh() }), false);
  // Everyone in the book voted: it is still listed, with no doors left.
  assert.equal(bookClosed({ selectedBookIds: sel('b1'), data: fresh({ books: [{ id: 'b1', doorCount: 0 }] }) }), false);
  // One of two selected books still listed.
  assert.equal(bookClosed({ selectedBookIds: sel('b1', 'b2'), data: fresh({ books: [{ id: 'b2' }] }) }), false);
  // The disk snapshot (an offline cold start): its books list can predate an assignment.
  assert.equal(bookClosed({ selectedBookIds: sel('b1'), data: fresh({ fromDiskCache: true }) }), false);
  // Doors left: the map, or the book picker, takes it from there.
  assert.equal(bookClosed({ selectedBookIds: sel('b1'), data: fresh({ households: [{ _id: 'h1', turfId: 'b2' }] }) }), false);
  // Nothing loaded yet.
  assert.equal(bookClosed({ selectedBookIds: sel('b1'), data: undefined }), false);
  // Ids compare as strings.
  assert.equal(bookClosed({ selectedBookIds: sel('42'), data: fresh({ books: [{ id: 42 }] }) }), false);
});
