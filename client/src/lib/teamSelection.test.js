import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SELECT_MAX,
  toggleId,
  selectAllMatching,
  selectedInFilter,
  resendTargets,
  removeTargets,
  crewsDisbanded,
  disbandLine,
  orgDisbandLine,
} from './teamSelection.js';

const row = (id, over = {}) => ({
  userId: id,
  firstName: id,
  lastName: 'Lee',
  status: 'active',
  isSuperAdmin: false,
  lastLoginAt: '2026-10-01T00:00:00Z',
  createdAt: '2026-06-01T00:00:00Z',
  role: 'canvasser',
  coordinatorId: null,
  ...over,
});

test('ticking: on, off, and never past 500', () => {
  let sel = toggleId(new Set(), 'a');
  assert.deepEqual([...sel], ['a']);
  sel = toggleId(sel, 'a');
  assert.equal(sel.size, 0);
  const full = new Set(Array.from({ length: SELECT_MAX }, (_, i) => `u${i}`));
  assert.equal(toggleId(full, 'one-more'), full, 'refused at the cap');
  assert.equal(toggleId(full, 'u3').size, SELECT_MAX - 1, 'unticking still works');
});

test('Select all N that match takes the first 500 of the filtered list', () => {
  const rows = Array.from({ length: 620 }, (_, i) => row(`u${i}`));
  const sel = selectAllMatching(rows);
  assert.equal(sel.size, 500);
  assert.ok(sel.has('u0') && sel.has('u499') && !sel.has('u500'));
});

test('the bar acts only on the selected people still in the filter, in list order', () => {
  const rows = [row('a'), row('b'), row('c')];
  assert.deepEqual(selectedInFilter(new Set(['c', 'a', 'gone']), rows).map((r) => r.userId), ['a', 'c']);
});

test('Resend invites: only people who never signed in; canvassers only for a lead; never staff', () => {
  const rows = [
    row('new', { lastLoginAt: null }),
    row('old', { lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' }),
    row('in'),
    row('lead', { lastLoginAt: null, role: 'lead' }),
    row('off', { lastLoginAt: null, status: 'deactivated' }),
    row('staff', { lastLoginAt: null, isSuperAdmin: true }),
  ];
  assert.deepEqual(resendTargets(rows, { isOrgAdmin: true }).map((r) => r.userId), ['new', 'lead']);
  assert.deepEqual(resendTargets(rows, { isOrgAdmin: false }).map((r) => r.userId), ['new']);
});

test('Remove from campaign: anyone for an admin; for a lead, canvassers, people no longer in the org and themselves', () => {
  const rows = [row('c'), row('l', { role: 'lead' }), row('a', { role: 'admin' }), row('gone', { role: 'lead', status: 'removed' }), row('me', { role: 'lead' }), row('s', { isSuperAdmin: true })];
  assert.equal(removeTargets(rows, { isOrgAdmin: true, viewerId: 'me' }).length, 6);
  assert.deepEqual(removeTargets(rows, { isOrgAdmin: false, viewerId: 'me' }).map((r) => r.userId), ['c', 'gone', 'me']);
});

test('the crew-disband line counts the crew left behind, not crew members removed with them', () => {
  const roster = [row('dana', { role: 'lead' }), row('x', { coordinatorId: 'dana' }), row('y', { coordinatorId: 'dana' }), row('z', { coordinatorId: 'dana' })];
  const out = crewsDisbanded([roster[0], roster[3]], roster);
  assert.deepEqual(out, [{ userId: 'dana', firstName: 'dana', people: 2 }]);
  assert.equal(
    disbandLine({ firstName: 'Dana', people: 12 }),
    'Dana runs a crew here: 12 people will have no crew. Their past doors stay on Dana’s team.'
  );
  assert.deepEqual(crewsDisbanded([roster[1]], roster), [], 'not a coordinator');
});

test('Remove from org names who loses their crew, from the deletion check', () => {
  assert.equal(
    orgDisbandLine({ firstName: 'Dana', people: 6, campaigns: 2 }),
    'Dana runs a crew of 6 on 2 campaigns: those people will have no crew. Their past doors stay on Dana’s team.'
  );
  assert.equal(orgDisbandLine({ firstName: 'Dana', people: 1, campaigns: 1 }).startsWith('Dana runs a crew of 1 on 1 campaign: that person'), true);
  assert.equal(orgDisbandLine({ firstName: 'Dana', people: 0, campaigns: 0 }), null);
});
