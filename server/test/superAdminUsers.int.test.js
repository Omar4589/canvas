import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The all-users surface, batch 2: server-side paging/search/filters (the endpoint used to ship the
// ENTIRE ever-growing user collection to the browser on every visit), the platform-role read/control
// (support vs break-glass was invisible and unsettable), the lockout READ (the clear button used to
// fire blind), and tombstone visibility.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/sausers node --test test/superAdminUsers.int.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-superadmin-users';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Household, CanvassActivity]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Acme Campaigns', slug: 'acme', isActive: true });

  // The break-glass owner and a support-tier super.
  const owner = await User.create({
    firstName: 'Omar', lastName: 'Owner', email: 'owner@doorline.app',
    passwordHash: 'x', isActive: true, isSuperAdmin: true, platformRole: 'break_glass',
  });
  const support = await User.create({
    firstName: 'Sam', lastName: 'Support', email: 'support@doorline.app',
    passwordHash: 'x', isActive: true, isSuperAdmin: true, platformRole: 'support',
  });
  // Twelve ordinary canvassers for paging, one with a searchable name.
  const canvassers = [];
  for (let i = 0; i < 12; i++) {
    canvassers.push(await User.create({
      firstName: i === 5 ? 'Zelda' : `Canvasser${i}`,
      lastName: 'Field',
      email: `c${i}@acme.com`,
      passwordHash: 'x',
      isActive: true,
      mustChangePassword: i === 3,
    }));
  }
  for (const c of canvassers.slice(0, 10)) {
    await Membership.create({ userId: c._id, organizationId: org._id, role: 'canvasser', isActive: true });
  }
  // c10, c11 are orphans (no active membership).

  // A deleted tombstone — must never inflate the headline count.
  const tomb = await User.create({
    firstName: 'Deleted', lastName: 'user', email: 'deleted+1@deleted.doorline.invalid',
    passwordHash: 'x', isActive: false, deletedAt: new Date(),
  });

  // One knock so lastActivityAt has something to find for Zelda.
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Fall', type: 'survey', state: 'IL', isActive: true,
  });
  const hh = await Household.create({
    organizationId: org._id, campaignId: campaign._id,
    addressLine1: '1 Elm St', city: 'Springfield', state: 'IL', zipCode: '62704',
    normalizedAddress: '1 elm st, springfield, il 62704',
  });
  await CanvassActivity.create({
    organizationId: org._id,
    campaignId: campaign._id,
    householdId: hh._id,
    userId: canvassers[5]._id,
    actionType: 'not_home',
    location: { lat: 39.78, lng: -89.65 },
    timestamp: new Date(Date.now() - 3600_000),
  });

  Object.assign(ctx, {
    org,
    owner: { token: signUserToken(owner), _id: owner._id },
    support: { token: signUserToken(support), _id: support._id },
    zelda: canvassers[5],
    tomb,
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('LEGACY SHAPE: a parameterless call still returns every user (shipped mobile builds)', { skip }, async () => {
  const res = await call('GET', '/super-admin/users', { token: ctx.owner.token });
  assert.strictEqual(res.status, 200);
  // 2 supers + 12 canvassers + 1 tombstone.
  assert.strictEqual(res.json.users.length, 15, 'no silent truncation on the legacy path');
  const u = res.json.users.find((x) => x.email === 'c0@acme.com');
  for (const field of ['id', 'firstName', 'lastName', 'email', 'isSuperAdmin', 'isActive', 'lastLoginAt', 'createdAt', 'memberships']) {
    assert.ok(field in u, `legacy field ${field} intact`);
  }
});

test('paged: skip/limit + exact total + deletedCount, tombstones countable apart', { skip }, async () => {
  const page = await call('GET', '/super-admin/users?limit=5&skip=0', { token: ctx.owner.token });
  assert.strictEqual(page.json.users.length, 5);
  assert.strictEqual(page.json.total, 15, 'exact countDocuments total');
  assert.strictEqual(page.json.deletedCount, 1, 'the tombstone is counted separately, not blended in');

  const page3 = await call('GET', '/super-admin/users?limit=5&skip=10', { token: ctx.owner.token });
  assert.strictEqual(page3.json.users.length, 5, 'history past the first page stays reachable');
});

test('server search + the operator filters (deleted / temp password / orphan / super)', { skip }, async () => {
  const byName = await call('GET', '/super-admin/users?q=zelda&limit=10&skip=0', { token: ctx.owner.token });
  assert.strictEqual(byName.json.total, 1, 'name search hits the DB, not a client filter');
  assert.strictEqual(byName.json.users[0].firstName, 'Zelda');

  const deleted = await call('GET', '/super-admin/users?deleted=1&limit=10&skip=0', { token: ctx.owner.token });
  assert.strictEqual(deleted.json.total, 1);
  assert.ok(deleted.json.users[0].deletedAt, 'tombstones carry their deletedAt');

  const temp = await call('GET', '/super-admin/users?tempPassword=1&limit=10&skip=0', { token: ctx.owner.token });
  assert.strictEqual(temp.json.total, 1, 'the never-onboarded segment is filterable');

  const orphans = await call('GET', '/super-admin/users?orphan=1&limit=10&skip=0', { token: ctx.owner.token });
  // c10, c11, the two supers, and the tombstone hold no active membership.
  assert.strictEqual(orphans.json.total, 5, 'zero-active-membership accounts are filterable');

  const supers = await call('GET', '/super-admin/users?super=1&limit=10&skip=0', { token: ctx.owner.token });
  assert.strictEqual(supers.json.total, 2);
  const roles = supers.json.users.map((u) => u.platformRole).sort();
  assert.deepStrictEqual(roles, ['break_glass', 'support'], 'the least-privilege split is finally visible');
});

test('last login and last field activity are different clocks — both returned when paged', { skip }, async () => {
  const res = await call('GET', '/super-admin/users?q=zelda&limit=5&skip=0', { token: ctx.owner.token });
  const zelda = res.json.users[0];
  assert.ok(zelda.lastActivityAt, 'her knock an hour ago is her last activity');
  assert.strictEqual(zelda.lastLoginAt ?? null, null, 'while she has never logged into THIS test session');
});

test('platform-role control: break-glass only, and the LAST break-glass account cannot be demoted', { skip }, async () => {
  // Support-tier callers are refused outright.
  const denied = await call('PATCH', `/super-admin/users/${ctx.support._id}/platform-role`, {
    token: ctx.support.token,
    body: { platformRole: 'break_glass' },
  });
  assert.strictEqual(denied.status, 403);
  assert.strictEqual(denied.json.code, 'BREAK_GLASS_REQUIRED');

  // The owner is the only break-glass account — demoting them would leave nobody able to escalate.
  const lastGuard = await call('PATCH', `/super-admin/users/${ctx.owner._id}/platform-role`, {
    token: ctx.owner.token,
    body: { platformRole: 'support' },
  });
  assert.strictEqual(lastGuard.status, 400);
  assert.strictEqual(lastGuard.json.code, 'LAST_BREAK_GLASS');

  // Promote Sam, then the owner CAN step down, then restore both.
  const promote = await call('PATCH', `/super-admin/users/${ctx.support._id}/platform-role`, {
    token: ctx.owner.token,
    body: { platformRole: 'break_glass' },
  });
  assert.strictEqual(promote.status, 200);
  assert.strictEqual(promote.json.user.platformRole, 'break_glass');

  const demote = await call('PATCH', `/super-admin/users/${ctx.owner._id}/platform-role`, {
    token: ctx.owner.token,
    body: { platformRole: 'support' },
  });
  assert.strictEqual(demote.status, 200, 'with another break-glass account alive, stepping down is allowed');

  // Restore the original arrangement for any later assertions.
  await User.updateOne({ _id: ctx.owner._id }, { platformRole: 'break_glass' });
  await User.updateOne({ _id: ctx.support._id }, { platformRole: 'support' });
});

test('the activity feed pages BACKWARD with `before` — history past the newest window is reachable', { skip }, async () => {
  // Zelda's knock from the seed is 1h old. Add a fresher one; `before` its timestamp must return
  // only the older row (the feed's `since` param could only ever look forward).
  const campaign = await Campaign.findOne({ name: 'Fall' });
  const hh = await Household.findOne({});
  await CanvassActivity.create({
    organizationId: ctx.org._id,
    campaignId: campaign._id,
    householdId: hh._id,
    userId: ctx.zelda._id,
    actionType: 'refused',
    location: { lat: 39.78, lng: -89.65 },
    timestamp: new Date(),
  });

  const all = await call('GET', '/super-admin/activity-feed?limit=50', { token: ctx.owner.token });
  assert.strictEqual(all.json.events.length, 2);
  const newest = all.json.events[0];
  assert.strictEqual(newest.actionType, 'refused');

  const older = await call(
    'GET',
    `/super-admin/activity-feed?limit=50&before=${encodeURIComponent(newest.timestamp)}`,
    { token: ctx.owner.token }
  );
  assert.strictEqual(older.json.events.length, 1, 'only rows strictly older than the cursor');
  assert.strictEqual(older.json.events[0].actionType, 'not_home');
});

test('the lockout state is READABLE (per-process, honestly labeled), not just blind-clearable', { skip }, async () => {
  const res = await call('GET', `/super-admin/users/${ctx.zelda._id}/lockout`, { token: ctx.owner.token });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.locked, false);
  assert.strictEqual(res.json.failedAttempts, 0);
  assert.strictEqual(res.json.scope, 'this-process', 'the response itself says it is one dyno’s view');
  assert.ok(res.json.maxFailures > 0, 'and how many failures it takes');

  // The clear endpoint still answers (the pre-existing recovery path).
  const cleared = await call('POST', `/super-admin/users/${ctx.zelda._id}/clear-lockout`, { token: ctx.owner.token });
  assert.strictEqual(cleared.status, 200);
  assert.strictEqual(cleared.json.ok, true);
});
