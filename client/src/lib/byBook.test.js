import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookPassOptions, defaultBookPass, knockedShare, sumBooks, sortBooks, foldBooks } from './byBook.js';

// The By book table's rules (lib/byBook.js): the pass it opens on, the picker's labels, the knocked share,
// sorting, folding and the folded line's sum. The table itself is drawn in byBookTableRender.smoke.test.js.

const round = (passId, fields = {}) => ({ passId, roundNumber: Number(passId), effortName: 'North', roundLabel: `Pass ${passId} · R`, status: 'archived', knocks: 0, ...fields });

test('the picker offers every pass that exists, named by walk list and pass; legacy and deleted-pass rows have no books', () => {
  const deleted = { passId: '9', roundNumber: null, roundLabel: 'Legacy / no pass', status: null, knocks: 40 };
  assert.deepEqual(bookPassOptions([round('1', { status: 'active' }), { passId: null, roundLabel: 'Legacy / no pass' }, deleted, round('2', { effortName: null })]), [
    { passId: '1', label: 'North · Pass 1 · R', status: 'active' },
    { passId: '2', label: 'Pass 2 · R', status: 'archived' },
  ]);
});

test('it opens on the active pass with the most knocks, else the busiest, else an active one, else the first', () => {
  assert.equal(defaultBookPass([round('1', { knocks: 50 }), round('2', { status: 'active', knocks: 5 }), round('3', { status: 'active', knocks: 9 })]), '3');
  assert.equal(defaultBookPass([round('1', { knocks: 50 }), round('2', { knocks: 70 }), round('3', { status: 'active' })]), '2', 'no active pass has knocks in the range');
  assert.equal(defaultBookPass([round('1'), round('2', { status: 'active' })]), '2');
  assert.equal(defaultBookPass([round('1'), round('2')]), '1');
  assert.equal(defaultBookPass([{ passId: null, knocks: 9 }]), null);
  assert.equal(defaultBookPass([round('1', { status: 'active' }), { passId: '9', roundNumber: null, knocks: 40 }]), '1', "a deleted pass's knocks are never the default");
  assert.equal(defaultBookPass([]), null);
});

test("the knocked share is of the book's doors, and nothing for a row without doors", () => {
  assert.equal(knockedShare({ doors: 70, knocks: 42 }), 60);
  assert.equal(knockedShare({ doors: 3, knocks: 1 }), 33);
  assert.equal(knockedShare({ doors: 0, knocks: 2 }), null);
  assert.equal(knockedShare({ knocks: 2 }), null);
  assert.equal(knockedShare({ doors: 8, knocks: 8, shareKnocks: 6 }), 75, "TOTAL: only the books' own knocks count against their doors");
  assert.equal(knockedShare({ doors: 70, knocks: 70 }), 100);
  assert.equal(knockedShare({ doors: 1, knocks: 4 }), null, 'a book that gave its knocked doors away: no share over 100%');
});

test("a folded line's sum: counts added, rates worked out from the sums — never averaged", () => {
  const sum = sumBooks([
    { doors: 10, knocks: 10, surveyedKnocks: 1, litKnocks: 0, contactKnocks: 5, surveysTaken: 2 },
    { doors: 90, knocks: 30, surveyedKnocks: 9, litKnocks: 0, contactKnocks: 6, surveysTaken: 11 },
  ]);
  assert.equal(sum.doors, 100);
  assert.equal(sum.knocks, 40);
  assert.equal(sum.surveysTaken, 13);
  assert.equal(sum.connectionRate, 25, '10 of 40 — the mean of 10% and 30% would say 20%');
  assert.equal(sum.contactRate, 28);
  assert.equal(sumBooks([]).connectionRate, 0);
});

test('sorting: book order is arrival order; numbers by value, ties in arrival order, a missing rate last', () => {
  const rows = [{ n: 'Book 2', k: 5, r: 10 }, { n: 'Book 3', k: 9, r: null }, { n: 'Book 10', k: 5, r: 40 }];
  assert.deepEqual(sortBooks(rows).map((r) => r.n), ['Book 2', 'Book 3', 'Book 10']);
  assert.deepEqual(sortBooks(rows, { key: 'book', dir: 'desc' }).map((r) => r.n), ['Book 10', 'Book 3', 'Book 2']);
  assert.deepEqual(sortBooks(rows, { key: 'k', dir: 'desc' }, (r) => r.k).map((r) => r.n), ['Book 3', 'Book 2', 'Book 10']);
  assert.deepEqual(sortBooks(rows, { key: 'r', dir: 'asc' }, (r) => r.r).map((r) => r.n), ['Book 2', 'Book 10', 'Book 3']);
  assert.deepEqual(sortBooks(rows, { key: 'r', dir: 'desc' }, (r) => r.r).map((r) => r.n), ['Book 10', 'Book 2', 'Book 3']);
});

test('folding: past the cap the rest becomes one summed line, and a fold never hides exactly one book', () => {
  const books = Array.from({ length: 14 }, (_, i) => ({ name: `Book ${i + 1}`, doors: 10, knocks: i }));
  const f = foldBooks(books, 10);
  assert.equal(f.open.length, 10);
  assert.equal(f.hidden.length, 4);
  assert.equal(f.hiddenSum.knocks, 10 + 11 + 12 + 13);
  assert.equal(f.hiddenSum.doors, 40);
  assert.equal(foldBooks(books.slice(0, 11), 10).hidden.length, 0, 'eleven books: all shown');
  assert.equal(foldBooks(books.slice(0, 12), 10).hidden.length, 2);
  assert.equal(foldBooks([], 10).hiddenSum, null);
});
