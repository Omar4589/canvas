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

  // A SUPER-ADMIN WHO IS ALSO A REAL MEMBER of an org. This is Omar's own shape in production (the
  // multi-tenant migration and the promote toggle both produce it), and the first cut of this gate
  // locked him out of his own account — see the ordering comment in middleware/orgContext.js.
  const ownOrg = await Organization.create({ name: 'Doorline Ops', slug: 'doorline-ops', isActive: true });
  await Subscription.create({ organizationId: ownOrg._id, status: 'active' });
  const staffMember = await User.create({
    firstName: 'Owen', lastName: 'Both', email: 'owen@doorline.app',
    passwordHash: 'x', isActive: true, isSuperAdmin: true, platformRole: 'break_glass',
  });
  await Membership.create({ userId: staffMember._id, organizationId: ownOrg._id, role: 'admin', isActive: true });

  Object.assign(ctx, {
    org,
    ownOrg,
    owner: { token: signUserToken(owner), orgId: org._id, _id: owner._id },
    support: { token: signUserToken(support), orgId: org._id, _id: support._id },
    customer: { token: signUserToken(custAdmin), orgId: org._id },
    staffMember: { token: signUserToken(staffMember), orgId: ownOrg._id, _id: staffMember._id },
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

test('A SUPER-ADMIN WHO IS A REAL MEMBER of an org needs NO grant — and is NOT logged', { skip }, async () => {
  // The lockout bug. The first cut of this gate tested `isSuperAdmin` BEFORE looking for a membership
  // and returned unconditionally, so a platform super-admin who was also the admin of their own
  // organization got 403 on their OWN account and would have had to grant themselves "support access",
  // with a typed reason, to use it.
  //
  // Vendor access means reaching into an org you are NOT a member of. A member is a member.
  const res = await call('GET', '/admin/voters', ctx.staffMember);
  assert.strictEqual(res.status, 200, 'a super-admin who is a genuine member of this org walks straight in');

  await new Promise((r) => setTimeout(r, 120));
  const logs = await AccessLog.countDocuments({ organizationId: ctx.ownOrg._id });
  assert.strictEqual(
    logs, 0,
    'and their ordinary work is NOT recorded as vendor intrusion — an audit trail that logs normal ' +
    'work as snooping tells you nothing about actual snooping'
  );
});

test('the SAME super-admin still needs a grant for an org they are NOT a member of', { skip }, async () => {
  // The other half. Being staff-and-a-member somewhere does not buy you free entry everywhere.
  const res = await call('GET', '/admin/voters', {
    token: ctx.staffMember.token,
    orgId: ctx.org._id, // the CUSTOMER's org, where they hold no membership
  });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.json.code, 'SUPPORT_ACCESS_REQUIRED');
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

test('THE UI PATH, end to end: grant → read → it shows up in the log and the sessions list', { skip }, async () => {
  // This is the exact sequence the web console performs, in order, through the same endpoints:
  //   1. a query 403s with SUPPORT_ACCESS_REQUIRED  → api/client.js broadcasts the event
  //   2. SupportAccessGate posts the grant           → POST /super-admin/access/grants
  //   3. queries refetch                             → GET /admin/voters (now 200)
  //   4. SupportAccessPage renders                   → GET /grants?all=1  and  GET /log
  //
  // Worth testing as a sequence rather than as parts, because the audit trail in this subsystem has
  // ALREADY silently recorded nothing once: the first accessLog mount matched req.path ('/voters')
  // against '/admin/voters' and logged not one row, while the app worked perfectly.

  // 1. The wall.
  const blocked = await call('GET', '/admin/voters', ctx.support);
  assert.strictEqual(blocked.status, 403);
  assert.strictEqual(blocked.json.code, 'SUPPORT_ACCESS_REQUIRED');
  assert.ok(blocked.json.organizationName, 'the modal needs the org name to render');
  assert.ok(blocked.json.organizationId, 'and the id to POST the grant');

  // 2. The modal.
  const grant = await call('POST', '/super-admin/access/grants', {
    token: ctx.support.token,
    body: {
      organizationId: blocked.json.organizationId,
      reason: 'Customer says the Fall map is missing doors — checking their import (ticket 412).',
      hours: 4,
    },
  });
  assert.strictEqual(grant.status, 201);

  // 3. The refetch.
  const read = await call('GET', '/admin/voters', ctx.support);
  assert.strictEqual(read.status, 200);

  await new Promise((r) => setTimeout(r, 120));

  // 4a. The sessions list the page renders (and the "End now" button reads from).
  const sessions = await call('GET', '/super-admin/access/grants?all=1', { token: ctx.owner.token });
  assert.strictEqual(sessions.status, 200);
  const live = sessions.json.grants.find((g) => g.reason.includes('ticket 412'));
  assert.ok(live, 'the open session is listed');
  assert.strictEqual(live.actor, 'Sam Support');
  assert.strictEqual(live.accessCount, 1, 'and it counts what was actually opened');

  // 4b. The log the page renders.
  const log = await call('GET', '/super-admin/access/log', { token: ctx.owner.token });
  const entry = log.json.entries.find((e) => e.reason?.includes('ticket 412'));
  assert.ok(entry, 'the read is in the log');
  assert.match(entry.actor, /Sam Support/);
  assert.strictEqual(entry.resource, 'voters');

  // 5. "End now" — and the door shuts immediately.
  const revoked = await call('DELETE', `/super-admin/access/grants/${live.id}`, { token: ctx.owner.token });
  assert.strictEqual(revoked.status, 200);
  const after = await call('GET', '/admin/voters', ctx.support);
  assert.strictEqual(after.status, 403, 'revoking a session closes the door at once, not at expiry');
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

// The retention banner must go RED when the job that DELETES ORGANIZATIONS dies — even while the
// identity purge beside it keeps succeeding.
//
// This is the bug that shipped: retentionHealth() hardcoded job:'purge-deleted-identities', so the
// `retention-triggers` sweep — wind-down, dormancy, and the contractual delete-on-request SLA —
// could throw every single night and the banner stayed green off the purge next to it. Its receipts
// were written and read by nothing. On the old code this test returns healthy:true.
test('the retention banner goes RED when the org-deletion triggers die, even if the purge is alive', async () => {
  const { RetentionRun } = await import('../src/models/RetentionRun.js');
  await RetentionRun.deleteMany({});

  // The identity purge ran an hour ago and succeeded. On its own, that is a green banner.
  await RetentionRun.create({
    job: 'purge-deleted-identities',
    startedAt: new Date(Date.now() - 60 * 60 * 1000),
    ok: true,
    purged: 0,
    scanned: 0,
  });
  // The triggers job has never once succeeded. Nobody is enforcing wind-down or delete-on-request.

  const res = await call('GET', '/super-admin/access/health/retention', { token: ctx.owner.token });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(
    res.json.healthy,
    false,
    'a green banner while the org-deletion job is dead is the exact silent failure this release exists to end'
  );
  assert.match(res.json.message, /retention triggers/i, 'the banner must name WHICH promise stopped being kept');
  assert.strictEqual(res.json.jobs.length, 2, 'health must report on every repeatable retention job');

  // And it goes green only once BOTH are alive.
  await RetentionRun.create({
    job: 'retention-triggers',
    startedAt: new Date(Date.now() - 60 * 60 * 1000),
    ok: true,
  });
  const ok = await call('GET', '/super-admin/access/health/retention', { token: ctx.owner.token });
  assert.strictEqual(ok.json.healthy, true, 'both jobs alive → green');
});
