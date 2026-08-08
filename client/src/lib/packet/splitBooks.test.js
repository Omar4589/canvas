import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBooks, MIN_DOORS_PER_PACKET } from './splitBooks.js';

// The invariant that matters most: parts exactly partition the book — same doors, same
// order, none duplicated, none dropped. Everything the audit trail and the totals promise
// hangs off that, so it is asserted against every fixture in here.

const door = (i, street) => ({
  id: `h${i}`,
  seq: i + 1,
  addressLine1: `${100 + i} ${street}`,
  addressLine2: null,
  city: 'Riverside',
  state: 'CA',
  zipCode: '92501',
  street,
  status: 'unknocked',
  lastActionAt: null,
  voters: [{ id: `v${i}a` }, { id: `v${i}b` }],
});

// `streets` = array of {name, count} runs, e.g. ['MAPLE ST', 12] pairs — doors are laid out
// street after street, the way a walk-ordered book usually is.
const makeBook = (streetRuns, overrides = {}) => {
  const doors = [];
  for (const [street, count] of streetRuns) {
    for (let i = 0; i < count; i++) doors.push(door(doors.length, street));
  }
  return {
    id: 'b1',
    name: 'Ward 5 — Book C',
    colorIndex: 3,
    passId: 'p1',
    passName: 'Round 2',
    roundNumber: 2,
    doorCount: doors.length,
    voterCount: doors.length * 2,
    streets: [],
    omitted: { total: 3, reasons: { doNotContact: 1, alreadyVoted: 2 } },
    orderProvenance: 'book',
    printOrder: 'street',
    survey: { id: 's1', questions: [] },
    doors,
    ...overrides,
  };
};

const makePayload = (books) => ({
  campaign: { id: 'c1', name: 'Riverside City Council 2026', type: 'survey' },
  organization: { name: 'Harbor Progress Alliance' },
  generatedAt: '2026-08-06T14:14:00.000Z',
  books,
  totals: {
    books: books.length,
    doors: books.reduce((n, b) => n + b.doors.length, 0),
    voters: books.reduce((n, b) => n + b.doors.length * 2, 0),
    omitted: books.reduce((n, b) => n + (b.omitted?.total || 0), 0),
  },
  warnings: ['3 selected item(s) no longer exist.'],
});

const assertPartition = (parent, parts) => {
  const flat = parts.flatMap((p) => p.doors.map((d) => d.id));
  assert.deepEqual(flat, parent.doors.map((d) => d.id), 'parts must be the book, in order, exactly once');
};

test('off, blank, and below the minimum are all identity — the same object back', () => {
  const payload = makePayload([makeBook([['MAPLE ST', 150]])]);
  assert.equal(splitBooks(payload, 0), payload);
  assert.equal(splitBooks(payload, undefined), payload);
  assert.equal(splitBooks(payload, ''), payload);
  assert.equal(splitBooks(payload, MIN_DOORS_PER_PACKET - 1), payload);
  assert.equal(splitBooks(null, 35), null);
});

test('a book at or under hardMax stays whole — no "1 of 1" suffix, same object back', () => {
  // hardMax for 35 is ceil(45.5) = 46.
  const payload = makePayload([makeBook([['MAPLE ST', 46]])]);
  const out = splitBooks(payload, 35);
  assert.equal(out, payload);
  assert.equal(out.books[0].name, 'Ward 5 — Book C');
});

test('one long street hard-cuts at the balanced ideals', () => {
  const book = makeBook([['MAPLE ST', 150]]);
  const out = splitBooks(makePayload([book]), 35);
  // 150/35 rounds to 4 parts; no street boundary anywhere, so cuts land on the ideals.
  assert.equal(out.books.length, 4);
  assert.deepEqual(out.books.map((b) => b.doorCount), [38, 37, 38, 37]);
  assertPartition(book, out.books);
});

test('cuts prefer the street boundary nearest each ideal', () => {
  // Ideal cut for 2 parts of 80 is at 40; the MAPLE/OAK boundary at 37 is inside the
  // window (±7 for target 35) and must win over a mid-street cut.
  const book = makeBook([['MAPLE ST', 37], ['OAK AVE', 43]]);
  const out = splitBooks(makePayload([book]), 35);
  assert.equal(out.books.length, 2);
  assert.deepEqual(out.books.map((b) => b.doorCount), [37, 43]);
  assert.deepEqual(out.books[0].streets, [{ name: 'MAPLE ST', count: 37 }]);
  assert.deepEqual(out.books[1].streets, [{ name: 'OAK AVE', count: 43 }]);
  assertPartition(book, out.books);
});

test('balancing prevents runt tails — 82 doors is 41+41, never 35+35+12', () => {
  const book = makeBook([['MAPLE ST', 82]]);
  const out = splitBooks(makePayload([book]), 35);
  assert.deepEqual(out.books.map((b) => b.doorCount), [41, 41]);
  assertPartition(book, out.books);
});

test('every part is a walkable size — no part exceeds hardMax across many shapes', () => {
  for (const total of [47, 60, 82, 99, 120, 150, 200, 350, 1200]) {
    const book = makeBook([['MAPLE ST', total]]);
    const out = splitBooks(makePayload([book]), 35);
    for (const b of out.books) {
      assert.ok(b.doorCount <= 46, `${total} doors: part of ${b.doorCount} exceeds hardMax`);
      assert.ok(b.doorCount >= 1, 'no empty parts');
    }
    assertPartition(book, out.books);
  }
});

test('a street boundary may not drag a part past hardMax — the 87-door two-street book', () => {
  // The regression the adversarial review caught: the A/B boundary at 37 sits inside the
  // window of the balanced ideal (44), and taking it left 50 doors for part 2 — BIGGER than
  // the 46-door book the same knob leaves whole. The feasibility clamp must reject it and
  // hard-cut at the ideal instead.
  const book = makeBook([['MAPLE ST', 37], ['OAK AVE', 50]]);
  const out = splitBooks(makePayload([book]), 35);
  assert.deepEqual(out.books.map((b) => b.doorCount), [44, 43]);
  assertPartition(book, out.books);
});

test('a street boundary may not carve sticky-note parts — 26 doors at target 10', () => {
  // Boundaries at 6 and 20 both sit inside their windows; taking them gave 6 + 14 + 6 —
  // two parts below the very threshold at which the knob refuses to run, and one over
  // hardMax (13). The clamp forces the balanced 9 + 8 + 9.
  const book = makeBook([['A ST', 6], ['B ST', 14], ['C ST', 6]]);
  const out = splitBooks(makePayload([book]), 10);
  assert.deepEqual(out.books.map((b) => b.doorCount), [9, 8, 9]);
  assertPartition(book, out.books);
});

test('opposite-direction slides cannot compound — streets of 31/51/24/44 at target 35', () => {
  // Unclamped, this layout split as exactly its street runs: 31, 51, 24, 44 — one part over
  // hardMax and one drifting far under target. Clamped, every part stays in [10, 46].
  const book = makeBook([['A ST', 31], ['B ST', 51], ['C ST', 24], ['D ST', 44]]);
  const out = splitBooks(makePayload([book]), 35);
  for (const b of out.books) {
    assert.ok(b.doorCount >= 10 && b.doorCount <= 46, `part of ${b.doorCount} escaped [10, 46]`);
  }
  assertPartition(book, out.books);
});

test('fuzz: partition + size bounds hold across seeded random street layouts', () => {
  // Deterministic LCG so a failure reproduces. Random books of random street runs at random
  // targets — the invariants the docs promise: exact partition, every part within
  // [min(10, balanced), ceil(1.3 × target)].
  let seed = 42;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let i = 0; i < 500; i++) {
    const target = 10 + rnd(90);
    const runs = [];
    const streets = 1 + rnd(12);
    for (let s = 0; s < streets; s++) runs.push([`STREET ${s} AVE`, 1 + rnd(60)]);
    const book = makeBook(runs);
    const out = splitBooks(makePayload([book]), target);
    if (out.books.length < 2) continue; // stayed whole — fine
    const hardMax = Math.ceil(target * 1.3);
    const minPart = Math.min(10, Math.floor(book.doors.length / out.books.length));
    for (const b of out.books) {
      assert.ok(
        b.doorCount >= minPart && b.doorCount <= hardMax,
        `seed run ${i}: ${book.doors.length} doors at target ${target} made a part of ${b.doorCount} (bounds [${minPart}, ${hardMax}])`
      );
    }
    assertPartition(book, out.books);
  }
});

test('part objects: ids, names, seq restamp, streets, counts, inheritance', () => {
  const book = makeBook([['MAPLE ST', 40], ['OAK AVE', 40], ['ELM ST', 40]]);
  const out = splitBooks(makePayload([book]), 35);
  assert.equal(out.books.length, 3);

  const ids = out.books.map((b) => b.id);
  assert.deepEqual(ids, ['b1#1of3', 'b1#2of3', 'b1#3of3']);
  assert.equal(new Set(ids).size, 3, 'ids must be distinct — cover-map cache, page ranges, numbering all key on id');
  assert.deepEqual(out.books.map((b) => b.name), [
    'Ward 5 — Book C · 1 of 3',
    'Ward 5 — Book C · 2 of 3',
    'Ward 5 — Book C · 3 of 3',
  ]);

  for (const part of out.books) {
    // seq restamps 1..n so the badge agrees with the street bands' local numbering.
    assert.deepEqual(part.doors.map((d) => d.seq), part.doors.map((_, i) => i + 1));
    assert.equal(part.doorCount, part.doors.length);
    assert.equal(part.voterCount, part.doors.length * 2);
    // Inherited, not invented.
    assert.equal(part.colorIndex, 3);
    assert.equal(part.roundNumber, 2);
    assert.equal(part.printOrder, 'street');
    assert.equal(part.survey, book.survey, 'survey is a shared reference');
    assert.equal(part.sourceBookId, 'b1');
    assert.equal(part.sourceName, 'Ward 5 — Book C');
    assert.equal(part.partCount, 3);
    // Each part's street list covers exactly its own doors.
    assert.equal(part.streets.reduce((n, s) => n + s.count, 0), part.doorCount);
  }
  assert.deepEqual(out.books.map((b) => b.partIndex), [1, 2, 3]);
  assertPartition(book, out.books);
});

test('omitted rides on part 1 only, and totals count it exactly once', () => {
  const book = makeBook([['MAPLE ST', 150]]);
  const out = splitBooks(makePayload([book]), 35);
  assert.deepEqual(out.books[0].omitted, { total: 3, reasons: { doNotContact: 1, alreadyVoted: 2 } });
  for (const part of out.books.slice(1)) assert.deepEqual(part.omitted, { total: 0, reasons: {} });
  assert.equal(out.totals.omitted, 3);
});

test('totals: books counts parts; doors and voters are invariant; warnings pass through', () => {
  const big = makeBook([['MAPLE ST', 150]]);
  const small = makeBook([['PINE RD', 20]], { id: 'b2', name: 'Book D', omitted: { total: 0, reasons: {} } });
  const payload = makePayload([big, small]);
  const out = splitBooks(payload, 35);
  assert.equal(out.books.length, 5); // 4 parts + 1 whole
  assert.equal(out.totals.books, 5);
  assert.equal(out.totals.doors, 170);
  assert.equal(out.totals.voters, 340);
  assert.equal(out.warnings, payload.warnings);
  // The small book is passed through untouched — the very same object.
  assert.equal(out.books[4], small);
});

test('the cached payload is never mutated', () => {
  const book = makeBook([['MAPLE ST', 150]]);
  const payload = makePayload([book]);
  const doorsBefore = book.doors.map((d) => d.seq).join(',');
  const out = splitBooks(payload, 35);
  assert.notEqual(out, payload);
  assert.equal(payload.books.length, 1);
  assert.equal(payload.books[0].name, 'Ward 5 — Book C');
  assert.equal(book.doors.map((d) => d.seq).join(','), doorsBefore, 'parent door seq untouched');
  assert.equal(payload.totals.books, 1);
});
