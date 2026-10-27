import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as web from './rosterView.js';
// Cross-tree on purpose (same pattern as byPassFold.parity.test.js): the Team page and the phone's
// Users hub must agree on who is "Never signed in", what each quick filter counts, and the order.
import * as mobile from '../../../mobile/lib/rosterView.js';

const row = (i, over = {}) => ({
  userId: `u${i}`,
  firstName: ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'][i % 6],
  lastName: ['Able', 'Bell', 'Cole', 'Dunn'][i % 4],
  email: `p${i}@t.co`,
  status: ['active', 'active', 'deactivated', 'removed', 'deleted', 'active'][i % 6],
  isActive: i % 6 < 2,
  lastLoginAt: i % 3 ? '2026-10-01T00:00:00Z' : null,
  createdAt: i % 4 ? '2026-06-01T00:00:00Z' : '2026-01-01T00:00:00Z',
  role: ['canvasser', 'lead', 'admin'][i % 3],
  coordinatorId: i % 5 ? `c${i % 3}` : null,
  coordinatorName: i % 5 ? ['Dana', 'Yan', 'Zoe'][i % 3] : null,
  doors: (i * 7) % 11,
  lastDoorAt: i % 2 ? `2026-10-${String(1 + (i % 9)).padStart(2, '0')}T00:00:00Z` : null,
  ...over,
});
const ROWS = Array.from({ length: 30 }, (_, i) => row(i));
const PAUSED = new Set(['u1', 'u7', 'u12']);

test('the phone copy answers exactly like the web copy', () => {
  for (const r of ROWS) {
    assert.equal(mobile.standing(r, PAUSED), web.standing(r, PAUSED));
    assert.equal(mobile.isAccountOn(r), web.isAccountOn(r));
    assert.equal(mobile.noSignInRecorded(r), web.noSignInRecorded(r));
  }
  for (const chip of web.CHIPS) {
    for (const crew of ['all', 'none', 'c1']) {
      for (const role of ['all', 'lead']) {
        for (const q of ['', 'bo', 'able t.co']) {
          const opts = { chip, crew, role, q, pausedIds: PAUSED };
          assert.deepEqual(mobile.filterRoster(ROWS, opts), web.filterRoster(ROWS, opts));
          assert.deepEqual(mobile.quickCounts(ROWS, opts), web.quickCounts(ROWS, opts));
        }
      }
    }
  }
  for (const key of web.SORTS) {
    for (const dir of ['asc', 'desc']) {
      assert.deepEqual(mobile.sortRoster(ROWS, { key, dir }), web.sortRoster(ROWS, { key, dir }));
    }
  }
  assert.deepEqual(mobile.crewHeadings(web.sortRoster(ROWS)), web.crewHeadings(web.sortRoster(ROWS)));
  for (const [p, total] of [[0, 0], [3, 60], [9, 60]]) assert.equal(mobile.clampPage(p, total, 25), web.clampPage(p, total, 25));
});
