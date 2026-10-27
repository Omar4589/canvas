import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standing, filterRoster, quickCounts, sortRoster } from './rosterView.js';

// Mirror of client/src/lib/rosterView.test.js's core rules, pinned on the phone copy too
// (client/src/lib/rosterView.parity.test.js compares the two copies on many rows).

const row = (over = {}) => ({
  userId: `u-${over.firstName || 'x'}`, firstName: 'X', lastName: 'Y', email: 'x@t.co', status: 'active', isActive: true,
  lastLoginAt: '2026-10-01T00:00:00Z', createdAt: '2026-06-01T00:00:00Z', role: 'canvasser', coordinatorId: null, coordinatorName: null,
  ...over,
});

test('standing: never signed in only for accounts made since sign-ins were recorded', () => {
  assert.equal(standing(row({ lastLoginAt: null, createdAt: '2026-05-15T00:00:00Z' })), 'never-signed-in');
  assert.equal(standing(row({ lastLoginAt: null, createdAt: '2026-05-01T00:00:00Z' })), 'no-sign-in-recorded');
  assert.equal(standing(row({ status: 'removed' })), 'left');
});

test('a quick filter count equals the rows it shows', () => {
  const team = [row({ firstName: 'Ann', coordinatorId: 'd', coordinatorName: 'Dana' }), row({ firstName: 'Bo', lastLoginAt: null }), row({ firstName: 'Cy', status: 'deactivated' })];
  const counts = quickCounts(team, {});
  for (const chip of Object.keys(counts)) assert.equal(counts[chip], filterRoster(team, { chip }).length, chip);
  assert.deepEqual(sortRoster(team).map((r) => r.firstName), ['Ann', 'Bo', 'Cy']);
});
