import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUND_KEY, LIST_KEY, printableRounds, roundForKey, listForKey, defaultSourceKey, groupByWalkList,
} from './packetSource.js';

const book = (id, extra = {}) => ({ id, name: id, doorCount: 10, colorIndex: 0, ...extra });

const SOURCES = {
  rounds: [
    { id: 'r1', name: 'Doors', roundNumber: 1, status: 'active', effortId: 'e1', effortName: 'Main', books: [book('b1'), book('b2')] },
    { id: 'r2', name: 'Paper loops', roundNumber: 2, status: 'draft', effortId: 'e1', effortName: 'Main', books: [book('b3')] },
    { id: 'r3', name: 'Doors', roundNumber: 1, status: 'draft', effortId: 'e2', effortName: 'Volunteers', books: [] },
  ],
  walkLists: [{ id: 'w1', name: 'Supporters', doorCount: 40, voterCount: 61 }],
};

test('a round with no accepted books is never offered', () => {
  // It cannot be printed, so an option leading to an empty list would just look broken.
  assert.deepEqual(printableRounds(SOURCES).map((r) => r.id), ['r1', 'r2']);
  assert.equal(roundForKey(SOURCES, ROUND_KEY('r3')), null);
});

test('keys resolve to their own kind and never across kinds', () => {
  assert.equal(roundForKey(SOURCES, ROUND_KEY('r2')).name, 'Paper loops');
  assert.equal(listForKey(SOURCES, LIST_KEY('w1')).name, 'Supporters');
  assert.equal(roundForKey(SOURCES, LIST_KEY('w1')), null);
  assert.equal(listForKey(SOURCES, ROUND_KEY('r1')), null);
  assert.equal(roundForKey(SOURCES, ''), null);
  assert.equal(listForKey(SOURCES, undefined), null);
});

test('lands on the live round when nothing is selected', () => {
  assert.equal(defaultSourceKey(SOURCES, { kind: 'books', turfIds: [] }), ROUND_KEY('r1'));
});

test('a deep-linked book opens ITS round, not the live one', () => {
  // ?turfIds=b3 points at a draft round's book. Landing on the live round instead would show
  // a list that does not contain the book the link asked for.
  assert.equal(defaultSourceKey(SOURCES, { kind: 'books', turfIds: ['b3'] }), ROUND_KEY('r2'));
});

test('a saved-search selection opens that saved search', () => {
  assert.equal(defaultSourceKey(SOURCES, { kind: 'walklist', walkListId: 'w1' }), LIST_KEY('w1'));
});

test('falls through to the first round, then a saved search, then nothing', () => {
  const noLive = { rounds: [{ ...SOURCES.rounds[1] }], walkLists: [] };
  assert.equal(defaultSourceKey(noLive, { kind: 'books', turfIds: [] }), ROUND_KEY('r2'));
  const listsOnly = { rounds: [], walkLists: SOURCES.walkLists };
  assert.equal(defaultSourceKey(listsOnly, { kind: 'books', turfIds: [] }), LIST_KEY('w1'));
  assert.equal(defaultSourceKey({ rounds: [], walkLists: [] }, null), '');
  assert.equal(defaultSourceKey(undefined, null), '');
});

test('rounds group under their walk list, in server order', () => {
  const groups = groupByWalkList(printableRounds(SOURCES));
  assert.deepEqual(groups.map((g) => g.effortName), ['Main']);
  assert.deepEqual(groups[0].rounds.map((r) => r.roundNumber), [1, 2]);
});
