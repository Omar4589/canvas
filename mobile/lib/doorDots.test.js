import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doorDotsRequest, doorDotFilterExpr } from './doorDots.js';

test('doorDotsRequest: path carries slim + geojson; filename carries the epoch', () => {
  const r = doorDotsRequest('c1', 'p1', 3);
  assert.equal(r.path, '/admin/campaigns/c1/turfs/doors?passId=p1&slim=1&format=geojson');
  assert.equal(r.fileName, 'door-dots-c1-p1-3.json');
  // epoch bump => different filename => the ShapeSource URL changes => native refetches
  assert.notEqual(doorDotsRequest('c1', 'p1', 4).fileName, r.fileName);
});

test('filter: all books visible uses the cheap truthiness test, no literal id list', () => {
  const f = doorDotFilterExpr(['a', 'b', 'c'], 3, null);
  assert.deepEqual(f, ['to-boolean', ['get', 'turfId']]);
});

test('filter: chip-narrowed uses the literal in on visible ids (uncut still excluded)', () => {
  const f = doorDotFilterExpr(['a'], 3, null);
  assert.deepEqual(f, [
    'all',
    ['to-boolean', ['get', 'turfId']],
    ['in', ['get', 'turfId'], ['literal', ['a']]],
  ]);
});

test('filter: promoted book is excluded in every mode', () => {
  const all = doorDotFilterExpr(['a', 'b'], 2, 'b');
  assert.deepEqual(all, ['all', ['to-boolean', ['get', 'turfId']], ['!=', ['get', 'turfId'], 'b']]);
  const narrowed = doorDotFilterExpr(['a'], 2, 'b');
  assert.equal(narrowed[0], 'all');
  assert.deepEqual(narrowed[2], ['!=', ['get', 'turfId'], 'b']);
});
