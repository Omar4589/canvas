import { test } from 'node:test';
import assert from 'node:assert';
import {
  isConsoleRole,
  consoleMemberships,
  nonConsoleMemberships,
  autoSelectOrgId,
} from './roles.js';
import { homePathForRole, consoleHomePath, resolveHomePath } from './homePath.js';

// The web console is an admin + team-lead surface. These two files are the ONE place that
// rule lives, so this is where it gets locked down. The regression under test: a user who
// is an admin in Org A and a canvasser in Org B could pick Org B in the org picker, get
// routed to the admin-only /admin, and hit a Forbidden screen with no way back.

const M = (organizationId, role) => ({
  organizationId,
  role,
  organizationName: `Org ${organizationId}`,
});
const USER = { id: 'u1' };
const SUPER = { id: 'u1', isSuperAdmin: true };

test('isConsoleRole: only admin + lead reach the web console', () => {
  assert.equal(isConsoleRole('admin'), true);
  assert.equal(isConsoleRole('lead'), true);
  assert.equal(isConsoleRole('canvasser'), false);
  assert.equal(isConsoleRole(undefined), false);
  assert.equal(isConsoleRole(null), false);
  // Super admin is a User flag, never a membership role — callers pass it separately.
  assert.equal(isConsoleRole('super_admin'), false);
});

test('homePathForRole never maps a canvasser to /admin', () => {
  assert.equal(homePathForRole('admin'), '/admin');
  assert.equal(homePathForRole('lead'), '/campaigns');
  assert.equal(homePathForRole('canvasser'), null); // ← the bug
  assert.equal(homePathForRole(undefined), null);
  // The picker's synthetic super-admin row must go through consoleHomePath, not this.
  assert.equal(homePathForRole('super_admin'), null);
});

test('consoleHomePath: super admins are org-agnostic', () => {
  assert.equal(consoleHomePath({ isSuperAdmin: true, hasActiveOrg: true }), '/admin');
  assert.equal(consoleHomePath({ isSuperAdmin: true, hasActiveOrg: false }), '/super-admin');
  // The org lists pass role:'super_admin' — it must not fall through to null.
  assert.equal(
    consoleHomePath({ isSuperAdmin: true, role: 'super_admin', hasActiveOrg: true }),
    '/admin'
  );
  assert.equal(consoleHomePath({ isSuperAdmin: false, role: 'lead', hasActiveOrg: true }), '/campaigns');
  assert.equal(consoleHomePath({ isSuperAdmin: false, role: 'canvasser', hasActiveOrg: true }), null);
});

test('admin in A + canvasser in B: skip the picker, land in A', () => {
  assert.equal(
    resolveHomePath({ user: USER, memberships: [M('A', 'admin'), M('B', 'canvasser')] }),
    '/admin'
  );
});

test('lead in A + canvasser in B: land on /campaigns, never /admin', () => {
  assert.equal(
    resolveHomePath({ user: USER, memberships: [M('A', 'lead'), M('B', 'canvasser')] }),
    '/campaigns'
  );
});

test('a stale activeOrgId pointing at a canvasser org never resolves to /admin', () => {
  const memberships = [M('A', 'admin'), M('B', 'canvasser')];
  assert.equal(resolveHomePath({ user: USER, memberships, activeOrgId: 'B' }), '/admin');
});

test('two console orgs → the picker; an active one wins', () => {
  const memberships = [M('A', 'admin'), M('B', 'lead')];
  assert.equal(resolveHomePath({ user: USER, memberships }), '/select-org');
  assert.equal(resolveHomePath({ user: USER, memberships, activeOrgId: 'A' }), '/admin');
  assert.equal(resolveHomePath({ user: USER, memberships, activeOrgId: 'B' }), '/campaigns');
});

test('canvasser-only (any org count) → null = no console access', () => {
  assert.equal(resolveHomePath({ user: USER, memberships: [M('A', 'canvasser')] }), null);
  assert.equal(
    resolveHomePath({ user: USER, memberships: [M('A', 'canvasser'), M('B', 'canvasser')] }),
    null
  );
  assert.equal(resolveHomePath({ user: USER, memberships: [] }), null);
});

test('password change and super admin outrank everything', () => {
  assert.equal(
    resolveHomePath({
      user: { ...USER, mustChangePassword: true },
      memberships: [M('A', 'admin')],
    }),
    '/change-password'
  );
  assert.equal(resolveHomePath({ user: SUPER, memberships: [] }), '/super-admin');
  assert.equal(resolveHomePath({ user: SUPER, memberships: [], activeOrgId: 'A' }), '/admin');
});

test('autoSelectOrgId enters the ONE console org and never a canvasser org', () => {
  // The reported case: one console org → skip the picker entirely.
  assert.equal(autoSelectOrgId([M('A', 'admin'), M('B', 'canvasser')]), 'A');
  // Two console orgs → a real choice, so show the picker.
  assert.equal(autoSelectOrgId([M('A', 'admin'), M('B', 'lead')]), null);
  // The old rule (memberships.length === 1) set B here and dead-ended on /admin.
  assert.equal(autoSelectOrgId([M('B', 'canvasser')]), null);
  assert.equal(autoSelectOrgId([]), null);
});

test('the picker splits memberships into selectable and explain-only', () => {
  const memberships = [M('A', 'admin'), M('B', 'canvasser'), M('C', 'lead')];
  assert.deepEqual(
    consoleMemberships(memberships).map((m) => m.organizationId),
    ['A', 'C']
  );
  assert.deepEqual(
    nonConsoleMemberships(memberships).map((m) => m.organizationId),
    ['B']
  );
});
