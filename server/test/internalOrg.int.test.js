import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The internal-org security boundary.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/internal node --test test/internalOrg.int.test.js
//
// Organization.isInternal is a born-immutable carve-out in the vendor-access gate: a super-admin may
// enter a Doorline-owned org WITHOUT a support grant and WITHOUT any AccessLog row (middleware/
// orgContext.js), because an internal org holds only Doorline's own synthetic data — there is no
// customer voter file inside it to protect. The whole safety of that free-entry branch rests on TWO
// properties this suite pins down:
//
//   1. Inside an internal org, staff get MEMBER-grade powers and produce ZERO audit rows — the same
//      as a real member, because they ARE treated as members there.
//   2. The flag can never open onto a CUSTOMER org. It is unforgeable (immutable + stripped by the
//      update schema), unreachable via billing ('internal' status is coupled to it both ways), and
//      creatable only by break-glass — so no support-tier staffer, and no API request, can turn a
//      customer org (which DOES hold voter data) into a free-entry one.
//
// The companion is test/supportAccess.int.test.js (the grant-and-audit path for CUSTOMER orgs) — this
// file is its mirror: the case where the gate deliberately stands aside, and the fences that keep that
// carve-out from ever widening.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-internal-org';

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

// recordAccess is fire-and-forget from res.on('finish') — an audit write must never block the request
// it audits — so a row is EVENTUALLY visible, not synchronously with the response. Poll, don't assert
// an instant read (see the same pattern in test/accessLogCoverage.int.test.js).
async function waitForLogs(filter = {}, { min = 1, ms = 3000 } = {}) {
  let logs = [];
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    logs = await AccessLog.find(filter).lean();
    if (logs.length >= min) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return logs;
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, SupportAccessGrant, AccessLog]) {
    await M.deleteMany({});
  }

  // The internal org: Doorline-owned, born with the immutable flag + an 'internal' subscription
  // (exactly what POST /super-admin/organizations produces for internal:true).
  const internalOrg = await Organization.create({
    name: 'Doorline Demo', slug: 'doorline-demo', isActive: true, isInternal: true,
  });
  await Subscription.create({ organizationId: internalOrg._id, status: 'internal', statusChangedAt: new Date() });

  // A real customer org — voter data lives here; the gate protects it.
  const custOrg = await Organization.create({ name: 'Acme Campaigns', slug: 'acme', isActive: true });
  await Subscription.create({ organizationId: custOrg._id, status: 'active' });

  // Support-tier super-admin (least privilege) — a member of nothing.
  const support = await User.create({
    firstName: 'Sam', lastName: 'Support', email: 'support@doorline.app',
    passwordHash: 'x', isActive: true, isSuperAdmin: true, platformRole: 'support',
  });
  // Break-glass super-admin — the only tier that may create an internal org.
  const owner = await User.create({
    firstName: 'Omar', lastName: 'Owner', email: 'owner@doorline.app',
    passwordHash: 'x', isActive: true, isSuperAdmin: true, platformRole: 'break_glass',
  });
  // The internal org's OWN org-admin (NOT a super-admin) — enters via the membership branch, the
  // ordering that must stay ahead of the isInternal branch (a member is a member).
  const internalAdmin = await User.create({
    firstName: 'Ida', lastName: 'Internal', email: 'ida@doorline.app',
    passwordHash: 'x', isActive: true,
  });
  await Membership.create({ userId: internalAdmin._id, organizationId: internalOrg._id, role: 'admin', isActive: true });

  Object.assign(ctx, {
    internalOrg,
    custOrg,
    support: { token: signUserToken(support), _id: support._id },
    owner: { token: signUserToken(owner), _id: owner._id },
    internalAdmin: { token: signUserToken(internalAdmin), _id: internalAdmin._id },
  });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

// ── 1. Free entry ─────────────────────────────────────────────────────────────────────────────────
test('a support-tier super-admin enters an internal org with NO grant', { skip }, async () => {
  // In a CUSTOMER org this same call is a 403 SUPPORT_ACCESS_REQUIRED (test 4). The isInternal branch
  // is what stands the gate aside — free entry, req.internalOrgAccess set, no supportGrant.
  const res = await call('GET', '/admin/memberships', {
    token: ctx.support.token, orgId: ctx.internalOrg._id,
  });
  assert.strictEqual(res.status, 200, 'a Doorline-owned org is member-grade for staff — no grant needed');
  assert.ok(Array.isArray(res.json.members), 'and the org data comes back');
});

// ── 2. Full powers ──────────────────────────────────────────────────────────────────────────────
test('inside an internal org, staff have full member-grade powers (create + reset password)', { skip }, async () => {
  // No supportGrant is set on the internal branch, so the VENDOR_READ_ONLY write-block never fires:
  // staff are members here, not vendors, and may do the writes a vendor is forbidden (compare test 5).
  const created = await call('POST', '/admin/memberships', {
    token: ctx.support.token,
    orgId: ctx.internalOrg._id,
    body: {
      email: 'newcanvasser@doorline.app',
      firstName: 'Cara', lastName: 'Canvasser',
      password: 'TempCanv123', role: 'canvasser',
    },
  });
  assert.strictEqual(created.status, 201, 'creating an account in an internal org is allowed');
  const newUserId = created.json.membership.user.id;
  assert.ok(newUserId, 'the new member id comes back');

  const reset = await call('PATCH', `/admin/memberships/${newUserId}/password`, {
    token: ctx.support.token,
    orgId: ctx.internalOrg._id,
    body: { password: 'TempReset123' },
  });
  assert.strictEqual(reset.status, 200, 'and so is resetting their password');

  // The temp-password contract: forced change on next login + a stamp.
  const u = await User.findById(newUserId).lean();
  assert.strictEqual(u.mustChangePassword, true, 'the reset issues a TEMPORARY password (forced change)');
  assert.ok(u.tempPasswordSetAt, 'and stamps when it was set');
});

// ── 3. Zero audit ───────────────────────────────────────────────────────────────────────────────
test('internal-org traffic writes NO AccessLog rows — ever', { skip }, async () => {
  // Fresh internal traffic in-test, on top of everything tests 1–2 already did against the internal
  // org. None of it is vendor access (no supportGrant), so recordAccess is never even reached.
  const r = await call('GET', '/admin/memberships', {
    token: ctx.support.token, orgId: ctx.internalOrg._id,
  });
  assert.strictEqual(r.status, 200);

  // Give any pending res.on('finish') handlers room to have run (they early-return, but prove it).
  await new Promise((res) => setTimeout(res, 200));
  assert.strictEqual(
    await AccessLog.countDocuments({}), 0,
    'entering a Doorline-owned org is member-grade — never vendor access, so nothing is logged. A trail ' +
    'that records normal internal work as intrusion tells you nothing about actual intrusion.'
  );
});

// ── 4. Customer org unchanged — entry still walled ────────────────────────────────────────────────
test('the SAME staffer, no grant, is walled out of a CUSTOMER org', { skip }, async () => {
  const res = await call('GET', '/admin/memberships', {
    token: ctx.support.token, orgId: ctx.custOrg._id,
  });
  assert.strictEqual(res.status, 403, 'the carve-out is internal-only — a customer org still needs a grant');
  assert.strictEqual(res.json.code, 'SUPPORT_ACCESS_REQUIRED');
});

// ── 5. Customer org unchanged — vendor read-only, and the read IS logged ──────────────────────────
test('with a grant, a CUSTOMER org is READ-ONLY for the vendor — and the read is audited', { skip }, async () => {
  const grant = await call('POST', '/super-admin/access/grants', {
    token: ctx.support.token,
    body: {
      organizationId: String(ctx.custOrg._id),
      reason: 'Customer reported a missing member on their roster (ticket 77).',
    },
  });
  assert.strictEqual(grant.status, 201, 'a support-tier staffer can open a grant for a customer');

  // The GET works under the grant — and because supportGrant is set here (no membership, not internal),
  // it is written to AccessLog.
  const read = await call('GET', '/admin/memberships', {
    token: ctx.support.token, orgId: ctx.custOrg._id,
  });
  assert.strictEqual(read.status, 200, 'the grant opens the door');

  // A WRITE now works under the grant — owner decision 2026-07-29: support means being able to
  // help, on the record. What stays refused is a membership targeting a STAFF account (the write
  // that would END the logging) — pinned in supportAccess.int.test.js.
  const write = await call('POST', '/admin/memberships', {
    token: ctx.support.token,
    orgId: ctx.custOrg._id,
    body: { email: 'sneak@acme.com', firstName: 'S', lastName: 'Neak', password: 'TempSneak123', role: 'canvasser' },
  });
  assert.strictEqual(write.status, 201, 'a grant-holder may administer users in a customer org');

  const logs = await waitForLogs({ organizationId: ctx.custOrg._id });
  assert.ok(logs.length > 0, 'the granted read of a customer org IS logged — unlike the internal org (test 3)');
  assert.strictEqual(String(logs[0].actorUserId), String(ctx.support._id), 'attributed to the human');
});

// ── 6. Flag unforgeable ───────────────────────────────────────────────────────────────────────────
test('isInternal cannot be forged onto a customer org via PATCH', { skip }, async () => {
  const res = await call('PATCH', `/super-admin/organizations/${ctx.custOrg._id}`, {
    token: ctx.owner.token, // even break-glass cannot set it on an existing org
    body: { name: 'Acme Renamed', isInternal: true },
  });
  assert.strictEqual(res.status, 200, 'the name update applies');
  const org = await Organization.findById(ctx.custOrg._id).lean();
  assert.strictEqual(org.isInternal, false, 'isInternal stays false — the update schema strips it and Mongoose immutable refuses it');
});

// ── 7. Billing coupling ───────────────────────────────────────────────────────────────────────────
test("'internal' billing status is coupled to the flag, both ways (+ drift-heal)", { skip }, async () => {
  const custBase = `/super-admin/organizations/${ctx.custOrg._id}/billing`;
  const intBase = `/super-admin/organizations/${ctx.internalOrg._id}/billing`;

  // A customer org (no flag) can never be moved TO 'internal' — the hole that would silently zero out
  // its billing and exempt it from the retention sweeps.
  const toInternal = await call('POST', `${custBase}/status`, {
    token: ctx.owner.token, body: { to: 'internal' },
  });
  assert.strictEqual(toInternal.status, 403);
  assert.strictEqual(toInternal.json.code, 'INTERNAL_FLAG_REQUIRED');

  // A flagged org can never LEAVE 'internal' — it is permanently non-billable.
  const awayFromInternal = await call('POST', `${intBase}/status`, {
    token: ctx.owner.token, body: { to: 'active' },
  });
  assert.strictEqual(awayFromInternal.status, 403);
  assert.strictEqual(awayFromInternal.json.code, 'INTERNAL_LOCKED');

  // Drift-heal: if a flagged org's sub somehow drifted off 'internal', to:'internal' must heal it —
  // the flag check runs BEFORE the same-status check precisely so this can't wedge on 'active'.
  await Subscription.updateOne({ organizationId: ctx.internalOrg._id }, { $set: { status: 'active' } });
  const heal = await call('POST', `${intBase}/status`, {
    token: ctx.owner.token, body: { to: 'internal' },
  });
  assert.strictEqual(heal.status, 200, 'a drifted flagged org can be healed back to internal');
  const sub = await Subscription.findOne({ organizationId: ctx.internalOrg._id }).lean();
  assert.strictEqual(sub.status, 'internal', 'and the sub is back to internal');
});

// ── 8. Creation gate ──────────────────────────────────────────────────────────────────────────────
test('creating an internal org is break-glass only, and has no trial', { skip }, async () => {
  // Support-tier cannot mint a free-entry org.
  const denied = await call('POST', '/super-admin/organizations', {
    token: ctx.support.token,
    body: { name: 'Sneaky Internal', slug: 'sneaky-internal', internal: true },
  });
  assert.strictEqual(denied.status, 403);
  assert.strictEqual(denied.json.code, 'BREAK_GLASS_REQUIRED');
  assert.strictEqual(
    await Organization.countDocuments({ slug: 'sneaky-internal' }), 0,
    'and nothing was created'
  );

  // trialDays + internal is a contradiction — an internal org has no clock.
  const withTrial = await call('POST', '/super-admin/organizations', {
    token: ctx.owner.token,
    body: { name: 'Internal With Trial', slug: 'internal-with-trial', internal: true, trialDays: 7 },
  });
  assert.strictEqual(withTrial.status, 400);
  assert.strictEqual(withTrial.json.code, 'INTERNAL_NO_TRIAL');

  // Break-glass, no trial → born internal, with an 'internal' subscription.
  const created = await call('POST', '/super-admin/organizations', {
    token: ctx.owner.token,
    body: { name: 'New Sandbox', slug: 'new-sandbox', internal: true },
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.json.organization.isInternal, true, 'the org is born with the flag set');
  const newSub = await Subscription.findOne({ organizationId: created.json.organization._id }).lean();
  assert.strictEqual(newSub.status, 'internal', 'and its subscription is born internal');
});

// ── 9. Slug lock ──────────────────────────────────────────────────────────────────────────────────
test("an internal org's slug is locked (identity for internal tooling), name stays editable", { skip }, async () => {
  const slugChange = await call('PATCH', `/super-admin/organizations/${ctx.internalOrg._id}`, {
    token: ctx.owner.token, body: { slug: 'renamed-demo' },
  });
  assert.strictEqual(slugChange.status, 403);
  assert.strictEqual(slugChange.json.code, 'INTERNAL_SLUG_LOCKED');
  const unchanged = await Organization.findById(ctx.internalOrg._id).lean();
  assert.strictEqual(unchanged.slug, 'doorline-demo', 'the slug never moved');

  const nameChange = await call('PATCH', `/super-admin/organizations/${ctx.internalOrg._id}`, {
    token: ctx.owner.token, body: { name: 'Doorline Demo (renamed)' },
  });
  assert.strictEqual(nameChange.status, 200, 'a name-only edit is fine — only the slug is the identity');
});

// ── 10. Ordering regression: membership branch beats the isInternal branch ────────────────────────
test('the internal org\'s own admin enters via MEMBERSHIP (not the flag branch), and is not logged', { skip }, async () => {
  // A genuine member — not a super-admin — must be handled by the membership branch, which sits AHEAD
  // of the isInternal branch in orgContext. If the order ever flipped, this ordinary admin would fall
  // through to a branch gated on isSuperAdmin and get a 403 on their own org.
  const res = await call('GET', '/admin/memberships', {
    token: ctx.internalAdmin.token, orgId: ctx.internalOrg._id,
  });
  assert.strictEqual(res.status, 200, 'the org admin reads their own roster with normal role behavior');

  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(
    await AccessLog.countDocuments({ organizationId: ctx.internalOrg._id }), 0,
    'a member doing their own work is never vendor access — no audit rows for the internal org'
  );
});
