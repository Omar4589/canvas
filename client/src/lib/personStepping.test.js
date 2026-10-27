import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSnapshot, neighbour, position, pageFor } from './personStepping.js';
import { filterRoster, sortRoster } from './rosterView.js';

const row = (id, over = {}) => ({
  userId: id,
  firstName: id,
  lastName: 'Lee',
  email: `${id}@t.co`,
  status: 'active',
  lastLoginAt: '2026-10-01T00:00:00Z',
  createdAt: '2026-06-01T00:00:00Z',
  role: 'canvasser',
  coordinatorId: null,
  coordinatorName: null,
  ...over,
});
// Sorted by crew: Dana's crew (Ann, Bo), then No crew (Cy, Di, Ed).
const ROSTER = [
  row('Ann', { coordinatorId: 'd', coordinatorName: 'Dana Cruz' }),
  row('Bo', { coordinatorId: 'd', coordinatorName: 'Dana Cruz' }),
  row('Cy'),
  row('Di'),
  row('Ed'),
];

test('the snapshot is the list as it was; someone opened from the address is placed where they sort', () => {
  const filtered = sortRoster(filterRoster(ROSTER, { crew: 'none' }));
  const ids = filtered.map((r) => r.userId);
  assert.deepEqual(openSnapshot(ids, 'Di', () => null), ['Cy', 'Di', 'Ed'], 'in the list: as it is');
  // Bo is on Dana's crew, so the No crew filter leaves them out: placed at their sort position.
  const place = (id) => {
    const r = ROSTER.find((x) => x.userId === id);
    return r ? sortRoster([...filtered, r]).map((x) => x.userId) : null;
  };
  assert.deepEqual(openSnapshot(ids, 'Bo', place), ['Bo', 'Cy', 'Di', 'Ed']);
  assert.deepEqual(openSnapshot(ids, 'Zed', place), ['Cy', 'Di', 'Ed'], 'not in the data: the list alone');
  assert.deepEqual(openSnapshot(ids, null, place), ['Cy', 'Di', 'Ed']);
});

test('the arrows go to the nearest people still in the data, skipping anyone who left', () => {
  const snap = ['Ann', 'Bo', 'Cy', 'Di', 'Ed'];
  const inData = (id) => id !== 'Cy' && id !== 'Di';
  assert.equal(neighbour(snap, 'Bo', 1, inData), 'Ed', 'Cy and Di were removed');
  assert.equal(neighbour(snap, 'Ed', -1, inData), 'Bo');
  assert.equal(neighbour(snap, 'Ann', -1, inData), null, 'nothing before the first');
  assert.equal(neighbour(snap, 'Ed', 1, inData), null, 'nothing after the last');
  // The person on screen was removed while open: the arrows still work from where they were.
  assert.equal(neighbour(snap, 'Cy', 1, inData), 'Ed');
  assert.equal(neighbour(snap, 'Cy', -1, inData), 'Bo');
  // Opened by a link to someone this list doesn't hold: › starts at the top.
  assert.equal(neighbour(snap, 'Zed', 1, inData), 'Ann');
  assert.equal(neighbour(snap, 'Zed', -1, inData), null);
});

test('"3 of 45" counts the people still in the data; none for someone no longer in it', () => {
  const snap = ['Ann', 'Bo', 'Cy', 'Di', 'Ed'];
  assert.deepEqual(position(snap, 'Di', () => true), { index: 4, total: 5 });
  assert.deepEqual(position(snap, 'Di', (id) => id !== 'Bo'), { index: 3, total: 4 });
  assert.equal(position(snap, 'Bo', (id) => id !== 'Bo'), null);
});

test('stepping turns the list’s page to the person, when the list as it is holds them', () => {
  const live = Array.from({ length: 60 }, (_, i) => `u${i}`);
  assert.equal(pageFor(live, 'u0', 25, 3), 1);
  assert.equal(pageFor(live, 'u24', 25, 1), 1);
  assert.equal(pageFor(live, 'u25', 25, 1), 2);
  assert.equal(pageFor(live, 'u59', 25, 1), 3);
  assert.equal(pageFor(live, 'gone', 25, 2), 2, 'filtered out now: the page stays');
});
