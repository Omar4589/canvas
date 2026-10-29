import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as web from './walkListOptions.js';
// Cross-tree on purpose (the byPassFold.parity.test.js pattern): a walk list marked "(archived)" and
// listed last on the web console must read the same in every phone picker.
import * as mobile from '../../../mobile/lib/walkListOptions.js';

const effort = (name, status = 'active') => ({ _id: `e-${name}`, name, status });

const EFFORT_LISTS = [
  [],
  null,
  [effort('North')],
  [effort('North'), effort('West', 'archived'), effort('South')],
  [effort('Main', 'archived'), effort('Old', 'archived')],
  [{ _id: 'x', name: '', status: 'archived' }, { _id: 'y' }],
];

const PASSES = [
  { roundNumber: 1, name: 'Pass 1' },
  { roundNumber: 3, name: 'GOTV' },
  { roundNumber: 2, name: '  Pass 2  ' },
  { roundNumber: null, name: 'Loose' },
  {},
  null,
];

test('both trees export the same functions', () => {
  assert.deepEqual(Object.keys(web).sort(), Object.keys(mobile).sort());
});

test('walkListOptions, openWalkLists and walkListLabel agree on every list', () => {
  for (const list of EFFORT_LISTS) {
    assert.deepEqual(mobile.walkListOptions(list), web.walkListOptions(list));
    assert.deepEqual(mobile.openWalkLists(list), web.openWalkLists(list));
    for (const e of list || []) assert.equal(mobile.walkListLabel(e), web.walkListLabel(e));
  }
});

test('pass labels agree', () => {
  for (const p of PASSES) {
    assert.equal(mobile.passShortLabel(p), web.passShortLabel(p));
    assert.equal(mobile.passOptionLabel(p, 'North'), web.passOptionLabel(p, 'North'));
    assert.equal(mobile.passOptionLabel(p, ''), web.passOptionLabel(p, ''));
  }
});
