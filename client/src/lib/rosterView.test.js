import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  standing,
  noSignInRecorded,
  isAccountOn,
  filterRoster,
  quickCounts,
  sortRoster,
  crewHeadings,
  clampPage,
  pageOf,
  pageOfIndex,
} from './rosterView.js';

const row = (over = {}) => ({
  userId: `u-${over.firstName || 'x'}`,
  firstName: 'X',
  lastName: 'Y',
  email: 'x@t.co',
  status: 'active',
  isActive: true,
  lastLoginAt: '2026-10-01T00:00:00Z',
  createdAt: '2026-06-01T00:00:00Z',
  role: 'canvasser',
  coordinatorId: null,
  coordinatorName: null,
  ...over,
});

test('standing: first match wins, and only accounts made since sign-ins were recorded read "Never signed in"', () => {
  const paused = new Set(['u-Pia']);
  assert.equal(standing(row({ status: 'deleted' }), paused), 'deleted');
  assert.equal(standing(row({ status: 'removed' })), 'left');
  assert.equal(standing(row({ status: 'deactivated', firstName: 'Pia' }), paused), 'deactivated');
  assert.equal(standing(row({ firstName: 'Pia', lastLoginAt: null }), paused), 'paused');
  assert.equal(standing(row({ lastLoginAt: null, createdAt: '2026-05-15T00:00:00Z' })), 'never-signed-in');
  assert.equal(standing(row({ lastLoginAt: null, createdAt: '2026-05-14T23:59:59Z' })), 'no-sign-in-recorded');
  assert.equal(standing(row({ lastLoginAt: null, createdAt: null })), 'no-sign-in-recorded');
  assert.equal(standing(row()), 'active');
});

test('noSignInRecorded: an older account with no sign-in on record, whatever else holds', () => {
  assert.equal(noSignInRecorded(row({ lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z', status: 'deactivated' })), true, 'switched off: still not recorded, never "Never"');
  assert.equal(noSignInRecorded(row({ lastLoginAt: null, createdAt: '2026-05-15T00:00:00Z', status: 'deactivated' })), false);
  assert.equal(noSignInRecorded(row({ lastLoginAt: null, createdAt: null })), true);
  assert.equal(noSignInRecorded(row()), false, 'signed in');
});

test('crew sort keeps two coordinators with the same name apart, each with its own heading', () => {
  const twins = [
    row({ firstName: 'Ann', lastName: 'A', coordinatorId: 'p1', coordinatorName: 'Pat Lee' }),
    row({ firstName: 'Bo', lastName: 'B', coordinatorId: 'p2', coordinatorName: 'Pat Lee' }),
    row({ firstName: 'Cy', lastName: 'C', coordinatorId: 'p1', coordinatorName: 'Pat Lee' }),
    row({ firstName: 'Di', lastName: 'D', coordinatorId: 'p2', coordinatorName: 'Pat Lee' }),
  ];
  assert.deepEqual(crewHeadings(sortRoster(twins)).map((h) => [h.coordinatorId, h.count]), [['p1', 2], ['p2', 2]]);
});

test('isAccountOn: the account is on, whatever else is true', () => {
  assert.equal(isAccountOn(row()), true);
  assert.equal(isAccountOn(row({ lastLoginAt: null })), true);
  assert.equal(isAccountOn(row({ status: 'deactivated' })), false);
  assert.equal(isAccountOn(row({ status: 'deleted' })), false);
});

const team = [
  row({ firstName: 'Ann', lastName: 'Able', coordinatorId: 'd', coordinatorName: 'Dana Cruz' }),
  row({ firstName: 'Bo', lastName: 'Bell', coordinatorId: 'd', coordinatorName: 'Dana Cruz', lastLoginAt: null }),
  row({ firstName: 'Cy', lastName: 'Cole', status: 'deactivated', role: 'lead' }),
  row({ firstName: 'Di', lastName: 'Dunn', email: 'di@corp.t.co', coordinatorId: 'y', coordinatorName: 'Yan Ito' }),
  row({ firstName: 'Ed', lastName: 'Eve', status: 'deleted' }),
];

test('filters: quick filter, search on every word, crew (including No crew) and role', () => {
  const paused = new Set(['u-Di']);
  assert.deepEqual(filterRoster(team).map((r) => r.firstName), ['Ann', 'Bo', 'Cy', 'Di']);
  assert.deepEqual(filterRoster(team, { chip: 'never-signed-in' }).map((r) => r.firstName), ['Bo']);
  assert.deepEqual(filterRoster(team, { chip: 'deactivated' }).map((r) => r.firstName), ['Cy']);
  assert.deepEqual(filterRoster(team, { chip: 'paused', pausedIds: paused }).map((r) => r.firstName), ['Di']);
  assert.deepEqual(filterRoster(team, { q: 'corp di' }).map((r) => r.firstName), ['Di']);
  assert.deepEqual(filterRoster(team, { crew: 'none' }).map((r) => r.firstName), ['Cy']);
  assert.deepEqual(filterRoster(team, { crew: 'd' }).map((r) => r.firstName), ['Ann', 'Bo']);
  assert.deepEqual(filterRoster(team, { role: 'lead' }).map((r) => r.firstName), ['Cy']);
});

test('quick counts follow the search and the other filters, so each count equals the rows its chip shows', () => {
  const paused = new Set(['u-Ann']);
  const opts = { crew: 'd', pausedIds: paused };
  const counts = quickCounts(team, opts);
  for (const chip of Object.keys(counts)) {
    assert.equal(counts[chip], filterRoster(team, { ...opts, chip }).length, chip);
  }
  assert.deepEqual(counts, { current: 2, 'never-signed-in': 1, deactivated: 0, paused: 1 });
});

test('sort: crew A-Z with No crew last, then names; missing values last either way', () => {
  assert.deepEqual(sortRoster(team.slice(0, 4)).map((r) => r.firstName), ['Ann', 'Bo', 'Di', 'Cy']);
  assert.deepEqual(sortRoster(team.slice(0, 4), { key: 'crew', dir: 'desc' }).map((r) => r.firstName), ['Di', 'Ann', 'Bo', 'Cy']);
  assert.deepEqual(sortRoster(team.slice(0, 4), { key: 'name', dir: 'desc' }).map((r) => r.firstName), ['Di', 'Cy', 'Bo', 'Ann']);
  assert.deepEqual(sortRoster(team.slice(0, 4), { key: 'lastLogin', dir: 'desc' }).map((r) => r.firstName).at(-1), 'Bo');
  const withDoors = team.slice(0, 3).map((r, i) => ({ ...r, doors: [5, 50, 0][i] }));
  assert.deepEqual(sortRoster(withDoors, { key: 'doors', dir: 'desc' }).map((r) => r.firstName), ['Bo', 'Ann', 'Cy']);
  assert.notEqual(sortRoster(team), team, 'sorts a copy');
});

test('crew headings group a crew-sorted list in order, with counts', () => {
  const heads = crewHeadings(sortRoster(team.slice(0, 4)));
  assert.deepEqual(heads.map((h) => [h.coordinatorId, h.name, h.count]), [['d', 'Dana Cruz', 2], ['y', 'Yan Ito', 1], [null, null, 1]]);
});

test('paging: a page that exists, its rows, and the page a row sits on', () => {
  const rows = Array.from({ length: 60 }, (_, i) => i);
  assert.equal(clampPage(0, 60, 25), 1);
  assert.equal(clampPage(9, 60, 25), 3);
  assert.equal(clampPage('2', 60, 25), 2);
  assert.equal(clampPage(5, 0, 25), 1);
  assert.deepEqual(pageOf(rows, 3, 25), rows.slice(50));
  assert.equal(pageOfIndex(24, 25), 1);
  assert.equal(pageOfIndex(25, 25), 2);
});
