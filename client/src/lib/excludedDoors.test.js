import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExcludedDoor, visibleMapDoors, countExcludedDoors } from './excludedDoors.js';

const door = (id, excluded) => ({ id, excludedFromTurf: excluded, location: { lng: -96.1, lat: 41.2 } });

test('isExcludedDoor is strict — only an explicit true counts', () => {
  assert.equal(isExcludedDoor({ excludedFromTurf: true }), true);
  assert.equal(isExcludedDoor({ excludedFromTurf: false }), false);
  // An older payload without the field must never read as excluded.
  assert.equal(isExcludedDoor({}), false);
  assert.equal(isExcludedDoor({ excludedFromTurf: 'true' }), false);
  assert.equal(isExcludedDoor(null), false);
  assert.equal(isExcludedDoor(undefined), false);
});

test('show and dim keep every door — dim is paint, not a filter', () => {
  const doors = [door('a', true), door('b', false), door('c', true)];
  assert.equal(visibleMapDoors(doors, 'show').length, 3);
  assert.equal(visibleMapDoors(doors, 'dim').length, 3);
  // Same array identity is fine, but the doors must be the same set either way.
  assert.deepEqual(visibleMapDoors(doors, 'dim').map((d) => d.id), ['a', 'b', 'c']);
});

test('hide drops only the excluded doors', () => {
  const doors = [door('a', true), door('b', false), door('c', true)];
  assert.deepEqual(visibleMapDoors(doors, 'hide').map((d) => d.id), ['b']);
});

test('an unknown mode is treated as show, never as hide', () => {
  const doors = [door('a', true), door('b', false)];
  assert.equal(visibleMapDoors(doors, undefined).length, 2);
  assert.equal(visibleMapDoors(doors, '').length, 2);
  assert.equal(visibleMapDoors(doors, 'HIDE').length, 2); // case-sensitive on purpose
});

test('countExcludedDoors counts the payload, not the campaign', () => {
  assert.equal(countExcludedDoors([door('a', true), door('b', false), door('c', true)]), 2);
  assert.equal(countExcludedDoors([]), 0);
  assert.equal(countExcludedDoors(null), 0);
  // A payload where the server never sent the field counts zero, not "unknown".
  assert.equal(countExcludedDoors([{ id: 'x' }, { id: 'y' }]), 0);
});

test('null/empty input never throws', () => {
  assert.deepEqual(visibleMapDoors(null, 'hide'), []);
  assert.deepEqual(visibleMapDoors(undefined, 'show'), []);
});
