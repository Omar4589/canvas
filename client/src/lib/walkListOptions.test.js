import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isArchivedWalkList,
  walkListLabel,
  walkListOptions,
  openWalkLists,
  passShortLabel,
  passOptionLabel,
} from './walkListOptions.js';

const effort = (name, status = 'active') => ({ _id: `e-${name}`, name, status });

test('archived walk lists are listed last, in their own order, and marked', () => {
  const list = [effort('Main', 'archived'), effort('North'), effort('West', 'archived'), effort('South')];
  assert.deepEqual(walkListOptions(list).map((e) => e.name), ['North', 'South', 'Main', 'West']);
  assert.equal(walkListLabel(list[0]), 'Main (archived)');
  assert.equal(walkListLabel(list[1]), 'North');
  assert.equal(isArchivedWalkList(list[0]), true);
  assert.equal(isArchivedWalkList({ name: 'x' }), false, 'no status reads as open, the model default');
});

test('work pickers leave archived walk lists out', () => {
  const list = [effort('Main', 'archived'), effort('North')];
  assert.deepEqual(openWalkLists(list).map((e) => e.name), ['North']);
  assert.deepEqual(openWalkLists(null), []);
  assert.deepEqual(walkListOptions(undefined), []);
});

test('a pass name that only repeats its number is not printed twice', () => {
  assert.equal(passShortLabel({ roundNumber: 2, name: 'Pass 2' }), 'Pass 2');
  assert.equal(passShortLabel({ roundNumber: 3, name: 'GOTV' }), 'Pass 3 · GOTV');
  assert.equal(passShortLabel({ roundNumber: 1, name: '' }), 'Pass 1');
  assert.equal(passOptionLabel({ roundNumber: 3, name: 'GOTV' }, 'North'), 'North · Pass 3 · GOTV');
  assert.equal(passOptionLabel({ roundNumber: 1, name: 'Pass 1' }, ''), 'Walk list · Pass 1');
});
