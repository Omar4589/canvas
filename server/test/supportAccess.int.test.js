import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Vendor access to customer data: bounded, reasoned, recorded.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/support node --test test/supportAccess.int.test.js
//
// Before this, `isSuperAdmin` + an `X-Org-Id` header was the whole of it: orgContext set the active
// org with NO membership check, auth waved the caller past every role gate, and the web client's org
// switcher listed every organization on the platform. Any staff member could read any customer's
// entire voter file — names, addresses, DOB, party, survey answers, notes, GPS trails — and leave no
// trace whatsoever. There was no audit model in the codebase, and morgan cannot record the actor (its
// `remote-user` field is HTTP-Basic-only; we use a bearer JWT), so nothing could ever answer "did
// anyone at Doorline read this customer's data?"
//
// The first test is the one that matters: without a grant, staff get a 403.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-support-access';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { SupportAccessGrant } = await import('../src/models/SupportAccessGrant.js');
const { AccessLog } = await import('../src/models/AccessLog.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

async function call(method, path, { token, orgId, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
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
  for (const M of [Organization, User, Membership, Subscription, SupportAccessGrant, AccessLog]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Acme Campaigns', slug: 'acme', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const owner = await User.create({
    firstName: 'Omar', lastName: 'Owner', email: 'owner@doorline.app',
    passwordHash: 'x', isActive: true, isSuperAdmin: true, platformRole: 'break_glass',
  });
  const support = await User.create({
    firstName: 'Sam', lastName: 'Support', email: 'support@doorline.app',
    passwordHash: 'x', isActive: true, isSuperAdmin: true, platformRole: 'support',
  });
  // The customer's OWN admin. Their access must be untouched — and NOT logged, because it isn't
  // vendor access and logging it would bury the signal.
  const custAdmin = await User.create({
    firstName: 'Ada', lastName: 'Admin', email: 'ada@acme.com',
    passwordHash: 'x', isActive: true,
  });
  await Membership.create({ userId: custAdmin._id, organizationId: org._id, role: 'admin', isActive: true });

  Object.assign(ctx, {
    org,
    owner: { token: signUserToken(owner), orgId: org._id, _id: owner._id },
    support: { token: signUserToken(support), orgId: org._id, _id: support._id },
    customer: { token: signUserToken(custAdmin), orgId: org._id },
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

beforeEach(async () => {
  if (!URI) return;
  for (const M of [SupportAccessGrant, AccessLog]) await M.deleteMany({});
});

test('THE GATE: staff cannot enter a customer org without a grant', { skip }, async () => {
  // This request returned 200 and the customer's whole voter list before. It is the god-mode bypass.
  const res = await call('GET', '/admin/voters', ctx.owner);
  assert.strictEqual(res.status, 403, 'even break-glass needs a grant — no unlogged mode');
  assert.strictEqual(res.json.code, 'SUPPORT_ACCESS_REQUIRED');
  assert.strictEqual(res.json.organizationName, 'Acme Campaigns');
});

test('a grant needs a real reason — "asdf" is refused', { skip }, async () => {
  const bad = await call('POST', '/super-admin/access/grants', {
    token: ctx.owner.token,
    body: { organizationId: String(ctx.org._id), reason: 'asdf' },
  });
  assert.strictEqual(bad.status, 400, 'the reason is the record of why you looked; it must say something');
});

test('with a grant: access works, and EVERY read is logged against the actor', { skip }, async () => {
  const grant = await call('POST', '/super-admin/access/grants', {
    token: ctx.support.token,
    body: {
      organizationId: String(ctx.org._id),
      reason: 'Customer reported missing doors on the Fall campaign map (ticket 412).',
    },
  });
  assert.strictEqual(grant.status, 201);
  assert.ok(grant.json.grant.expiresAt, 'time-boxed');
  assert.match(grant.json.notice, /logged against your name/i, 'the operator is told, up front');

  const read = await call('GET', '/admin/voters', ctx.support);
  assert.strictEqual(read.status, 200, 'the grant opens the door');

  // The whole point.
  await new Promise((r) => setTimeout(r, 120)); // res.on('finish') writes async
  const logs = await AccessLog.find({ organizationId: ctx.org._id }).lean();
  assert.strictEqual(logs.length, 1, 'exactly one access recorded');
  assert.strictEqual(String(logs[0].actorUserId), String(ctx.support._id), 'attributed to the human');
  assert.strictEqual(logs[0].resource, 'voters');
  assert.ok(logs[0].grantId, 'tied to the grant that authorized it — so the reason is recoverable');
});

test('an EXPIRED grant is not a grant', { skip }, async () => {
  await SupportAccessGrant.create({
    actorUserId: ctx.owner._id,
    organizationId: ctx.org._id,
    reason: 'expired session from yesterday',
    expiresAt: new Date(Date.now() - 1000),
  });
  const res = await call('GET', '/admin/voters', ctx.owner);
  assert.strictEqual(res.status, 403, 'a grant that has run out must not keep the door open');
});

test('a REVOKED grant is not a grant', { skip }, async () => {
  await SupportAccessGrant.create({
    actorUserId: ctx.owner._id,
    organizationId: ctx.org._id,
    reason: 'revoked mid-session',
    expiresAt: new Date(Date.now() + 3_600_000),
    revokedAt: new Date(),
  });
  const res = await call('GET', '/admin/voters', ctx.owner);
  assert.strictEqual(res.status, 403);
});

test('the customer\'s own admin is unaffected — and is NOT logged', { skip }, async () => {
  const res = await call('GET', '/admin/voters', ctx.customer);
  assert.strictEqual(res.status, 200, 'a customer reading their own data needs no grant');

  await new Promise((r) => setTimeout(r, 120));
  const logs = await AccessLog.countDocuments({});
  assert.strictEqual(logs, 0, 'their own access is not vendor access — logging it would bury the signal');
});

test('support cannot delete an organization; break-glass can', { skip }, async () => {
  const denied = await call('DELETE', `/super-admin/organizations/${ctx.org._id}`, {
    token: ctx.support.token,
    body: { confirmSlug: 'acme' },
  });
  assert.strictEqual(denied.status, 403, 'hiring someone must not mean handing them a god account');
  assert.strictEqual(denied.json.code, 'BREAK_GLASS_REQUIRED');
  assert.ok(await Organization.findById(ctx.org._id), 'the org survives');
});

test('the audit log answers "did anyone at Doorline read my data?"', { skip }, async () => {
  await call('POST', '/super-admin/access/grants', {
    token: ctx.owner.token,
    body: { organizationId: String(ctx.org._id), reason: 'Investigating a duplicate-import report.' },
  });
  await call('GET', '/admin/voters', ctx.owner);
  await new Promise((r) => setTimeout(r, 120));

  const log = await call('GET', `/super-admin/access/log?organizationId=${ctx.org._id}`, { token: ctx.owner.token });
  assert.strictEqual(log.status, 200);
  assert.ok(log.json.entries.length >= 1);
  const e = log.json.entries[0];
  assert.match(e.actor, /Omar Owner/);
  assert.strictEqual(e.organization, 'Acme Campaigns');
  assert.match(e.reason, /duplicate-import/, 'the WHY travels with the WHAT');
});
