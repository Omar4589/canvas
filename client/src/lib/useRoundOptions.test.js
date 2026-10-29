import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundOptionRows, narrowRoundOptions } from './useRoundOptions.js';

// The web round pickers' rows (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §D.4): every round names its walk
// list, an archived walk list's rounds come after the open ones' and say so, and a walk-list filter
// narrows the list to that walk list's rounds.

const efforts = [
  { _id: 'e-west', name: 'West', status: 'archived' },
  { _id: 'e-north', name: 'North', status: 'active' },
  { _id: 'e-main', name: 'Main', status: 'active' },
];
const pass = (id, effortId, roundNumber, name) => ({ _id: id, effortId, roundNumber, name });
const passes = [
  pass('p1', 'e-north', 2, 'Pass 2'),
  pass('p2', 'e-west', 1, 'GOTV'),
  pass('p3', 'e-north', 1, 'Pass 1'),
  pass('p4', 'e-main', 3, 'GOTV'),
];

test('rounds name their walk list; archived walk lists come last and are marked', () => {
  const rows = roundOptionRows({ passes, efforts });
  assert.deepEqual(
    rows.map((r) => r.label),
    ['Main · Pass 3 · GOTV', 'North · Pass 1', 'North · Pass 2', 'West (archived) · Pass 1 · GOTV']
  );
  assert.deepEqual(rows.map((r) => r.archived), [false, false, false, true]);
  assert.equal(rows[0].id, 'p4');
  assert.equal(rows[0].effortId, 'e-main');
});

test('the legacy bucket is offered only when null-pass responses exist, and always last', () => {
  assert.ok(!roundOptionRows({ passes, efforts }).some((r) => r.id === 'legacy'));
  const rows = roundOptionRows({ passes, efforts, legacyResponseCount: 4 });
  assert.deepEqual(rows.at(-1), {
    id: 'legacy',
    effortId: '',
    effortName: '￿',
    archived: false,
    roundNumber: Infinity,
    label: 'Legacy / no pass',
  });
});

test('a walk-list filter keeps only that walk list’s rounds, never the legacy bucket', () => {
  const rows = roundOptionRows({ passes, efforts, legacyResponseCount: 4 });
  assert.deepEqual(narrowRoundOptions(rows, 'e-north').map((r) => r.id), ['p3', 'p1']);
  assert.deepEqual(narrowRoundOptions(rows, 'e-west').map((r) => r.label), ['West (archived) · Pass 1 · GOTV']);
  assert.equal(narrowRoundOptions(rows, ''), rows, 'no filter: the same list');
  assert.deepEqual(narrowRoundOptions(rows, 'e-gone'), []);
});

test('a pass whose walk list is unknown still gets a label, and empty answers give no rows', () => {
  assert.deepEqual(roundOptionRows({ passes: [pass('p9', 'e-gone', 2, '')], efforts }).map((r) => r.label), ['Walk list · Pass 2']);
  assert.deepEqual(roundOptionRows({ passes: undefined, efforts: undefined }), []);
  assert.deepEqual(roundOptionRows(), []);
});
