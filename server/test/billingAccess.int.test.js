import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Billing-access gating, current-month usage, and new-client provisioning, over the REAL
// Express app + throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/billacc node --test test/billingAccess.int.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-billing-access';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { currentUsage } = await import('../src/services/billing/statement.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

async function makeUser(first, { isSuperAdmin = false, mustChangePassword = false } = {}) {
  const u = await User.create({
    firstName: first, lastName: 'X', email: `${first.toLowerCase()}@t.co`,
    passwordHash: 'x', isActive: true, isSuperAdmin, mustChangePassword,
  });
  return u;
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, CanvassActivity]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Acme', slug: 'acme', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const superU = await makeUser('Sue', { isSuperAdmin: true });
  const billingU = await makeUser('Bill'); // bill-payer admin
  const plainU = await makeUser('Pat'); // plain admin, no billing access
  await Membership.create({ userId: billingU._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: true });
  await Membership.create({ userId: plainU._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: false });

  Object.assign(ctx, {
    org,
    sup: { token: signUserToken(superU) },
    billing: { token: signUserToken(billingU), orgId: org._id, userId: billingU._id },
    plain: { token: signUserToken(plainU), orgId: org._id, userId: plainU._id },
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

test('GET /admin/billing is gated to bill-payer admins', { skip }, async () => {
  const ok = await call('GET', '/admin/billing', ctx.billing);
  assert.strictEqual(ok.status, 200);
  assert.ok(ok.json.usage, 'billing admin gets the usage meter');
  assert.strictEqual(typeof ok.json.usage.billableCampaigns, 'number');

  const denied = await call('GET', '/admin/billing', ctx.plain);
  assert.strictEqual(denied.status, 403, 'a plain admin (no billing access) is blocked');
  assert.strictEqual(denied.json.code, 'billing-access-required');
});

test('usage meter counts only first-knock-started campaigns', { skip }, async () => {
  const before = await call('GET', '/admin/billing', ctx.billing);
  assert.strictEqual(before.json.usage.billableCampaigns, 0, 'no canvassed campaigns yet');

  const camp = await Campaign.create({ organizationId: ctx.org._id, name: 'Fall', type: 'lit_drop', state: 'FL' });
  // Creating the campaign alone does NOT bill — it's in free setup.
  const afterCreate = await call('GET', '/admin/billing', ctx.billing);
  assert.strictEqual(afterCreate.json.usage.billableCampaigns, 0, 'creating a campaign is free');
  assert.strictEqual(afterCreate.json.usage.billing.length, 0);
  assert.strictEqual(afterCreate.json.usage.setupCount, 1, 'the un-canvassed campaign shows as free setup');

  // …a real knock this month starts billing.
  //
  // Pinned to the 1st at noon UTC rather than `new Date()`: a first visit in the LAST 7 DAYS of a
  // month earns the start grace (services/billing/billingMonths.js), so a wall-clock fixture would
  // make this suite pass for three weeks and fail for the last one. Noon UTC on day 1 is still
  // day 1 in the campaign's America/New_York default, so no grace, no timezone edge.
  const now = new Date();
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12, 0, 0));
  await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: camp._id, householdId: new mongoose.Types.ObjectId(),
    userId: ctx.billing.userId, actionType: 'lit_dropped', timestamp: firstOfMonth,
    location: { lat: 30, lng: -81 },
  });
  // The SERVICE still computes money — every super-admin surface needs it.
  const usage = await currentUsage(ctx.org._id);
  assert.strictEqual(usage.billableCampaigns, 1, 'a canvassed campaign is billable this month');
  assert.strictEqual(usage.totalCents, 30000, 'billed at the $300 default rate');

  const afterKnock = await call('GET', '/admin/billing', ctx.billing);
  assert.strictEqual(afterKnock.json.usage.billableCampaigns, 1);

  // The breakdown names WHICH campaign is billing and since when.
  const u = afterKnock.json.usage;
  assert.strictEqual(u.billing.length, 1);
  assert.strictEqual(u.billableCampaigns, u.billing.length, 'count matches the breakdown');
  assert.strictEqual(u.billing[0].name, 'Fall');
  assert.ok(u.billing[0].firstKnockAt, 'the billing line carries its first-knock date');
  assert.strictEqual(u.setupCount, 0, 'Fall is now billing, not setup');

  // …but NO DOLLAR FIGURE may reach the CUSTOMER. Pricing is negotiated per client and per race,
  // so it belongs in a conversation with the account manager, never on their dashboard. Negative
  // assertions on purpose: a regression that re-adds money to this payload has to fail here rather
  // than ship quietly (services/billing/statement.js → publicUsage).
  assert.ok(!('totalCents' in u), 'the customer meter carries no running total');
  assert.ok(!('rateCents' in u), 'the customer meter carries no rate');
  assert.ok(!('amountCents' in u.billing[0]), 'no per-campaign amount');
  assert.ok(!('rateCents' in u.billing[0]), 'no per-campaign rate');
  assert.ok(!('pricePerCampaignCents' in afterKnock.json), 'the plan summary carries no price');
  assert.ok(
    !JSON.stringify(afterKnock.json).includes('30000'),
    'no dollar amount anywhere in the customer billing payload'
  );

  // A second un-canvassed campaign shows in setup, never on the bill.
  await Campaign.create({ organizationId: ctx.org._id, name: 'Winter', type: 'lit_drop', state: 'FL' });
  const withSetup = await call('GET', '/admin/billing', ctx.billing);
  assert.strictEqual(withSetup.json.usage.billing.length, 1, 'still just Fall billing');
  assert.strictEqual(withSetup.json.usage.setupCount, 1, 'Winter is in free setup');
});

test('only a bill-payer admin can grant billing access', { skip }, async () => {
  // Plain admin cannot grant it (would be a self-grant loophole).
  const denied = await call('PATCH', `/admin/memberships/${ctx.plain.userId}`, {
    ...ctx.plain, body: { billingAccess: true },
  });
  assert.strictEqual(denied.status, 403);

  // Billing admin grants the plain admin access…
  const granted = await call('PATCH', `/admin/memberships/${ctx.plain.userId}`, {
    ...ctx.billing, body: { billingAccess: true },
  });
  assert.strictEqual(granted.status, 200);
  assert.strictEqual((await Membership.findOne({ userId: ctx.plain.userId, organizationId: ctx.org._id }).lean()).billingAccess, true);

  // …now the (formerly plain) admin can see billing.
  const nowOk = await call('GET', '/admin/billing', ctx.plain);
  assert.strictEqual(nowOk.status, 200);
});

test('provisioning creates org + custom trial + first admin (temp pw, billing access)', { skip }, async () => {
  const r = await call('POST', '/super-admin/organizations', {
    ...ctx.sup,
    body: { name: 'New Client Co', trialDays: 14, admin: { firstName: 'Ada', lastName: 'Owner', email: 'ada.owner@client.co' } },
  });
  assert.strictEqual(r.status, 201);
  // No typed temp password → NONE is echoed back: the throwaway generated internally is shown
  // to nobody, and the emailed set-password invite is the account's way in.
  assert.strictEqual(r.json.tempPassword, null, 'a blank temp password stays secret everywhere');
  assert.ok(r.json.admin?.email === 'ada.owner@client.co');

  const orgId = r.json.organization._id || r.json.organization.id;
  const sub = await Subscription.findOne({ organizationId: orgId }).lean();
  assert.strictEqual(sub.status, 'trial');
  const daysOut = Math.round((new Date(sub.trialEndsAt) - Date.now()) / 86400000);
  assert.ok(daysOut >= 13 && daysOut <= 14, `trial is ~14 days (got ${daysOut})`);

  const adminUser = await User.findOne({ email: 'ada.owner@client.co' }).lean();
  assert.strictEqual(adminUser.mustChangePassword, true, 'first admin must reset the temp password');
  const m = await Membership.findOne({ userId: adminUser._id, organizationId: orgId }).lean();
  assert.strictEqual(m.role, 'admin');
  assert.strictEqual(m.billingAccess, true, 'the seated first admin is a bill-payer');

  // A duplicate admin email fails BEFORE creating the org (no partial state).
  const dup = await call('POST', '/super-admin/organizations', {
    ...ctx.sup, body: { name: 'Dup Co', admin: { firstName: 'Ada', lastName: 'Owner', email: 'ada.owner@client.co' } },
  });
  assert.strictEqual(dup.status, 409);
  assert.strictEqual(await Organization.countDocuments({ name: 'Dup Co' }), 0, 'no org created on the conflict');
});

test('migration grandfathers existing admins but skips super admins', { skip }, async () => {
  const org2 = await Organization.create({ name: 'Legacy', slug: 'legacy', isActive: true });
  const legacyAdmin = await makeUser('Len');
  const superMember = await makeUser('Sam', { isSuperAdmin: true }); // super admin who also has an org membership
  await Membership.create({ userId: legacyAdmin._id, organizationId: org2._id, role: 'admin', isActive: true, billingAccess: false });
  await Membership.create({ userId: superMember._id, organizationId: org2._id, role: 'admin', isActive: true, billingAccess: false });

  // The migration's operation: grandfather non-super admins only.
  const superIds = (await User.find({ isSuperAdmin: true }, { _id: 1 }).lean()).map((u) => u._id);
  await Membership.updateMany(
    { role: 'admin', billingAccess: { $ne: true }, userId: { $nin: superIds } },
    { $set: { billingAccess: true } }
  );

  const legacy = await Membership.findOne({ userId: legacyAdmin._id, organizationId: org2._id }).lean();
  assert.strictEqual(legacy.billingAccess, true, 'a real admin keeps billing access after the migration');
  const sup = await Membership.findOne({ userId: superMember._id, organizationId: org2._id }).lean();
  assert.strictEqual(sup.billingAccess, false, 'a super admin is skipped — they bypass the billing gate anyway');
});

test('LAST_BILLING_ADMIN guard: no console door can strip an org of its only billing admin', { skip }, async () => {
  // Fresh, self-contained org so this test never depends on what earlier cases granted. The
  // stakes: billing-grade notices — support-access grants and the DELETION WARNINGS — go only
  // to billingAccess admins (services/mail/recipients.js), so losing the last one silently
  // leaves the org with nobody to warn before its data is purged.
  const gOrg = await Organization.create({ name: 'Guarded', slug: 'guarded', isActive: true });
  await Subscription.create({ organizationId: gOrg._id, status: 'active' });
  const gBillU = await makeUser('Gbill');
  const gPlainU = await makeUser('Gplain');
  await Membership.create({ userId: gBillU._id, organizationId: gOrg._id, role: 'admin', isActive: true, billingAccess: true });
  await Membership.create({ userId: gPlainU._id, organizationId: gOrg._id, role: 'admin', isActive: true, billingAccess: false });
  const gBill = { token: signUserToken(gBillU), orgId: gOrg._id, userId: gBillU._id };
  const gPlain = { token: signUserToken(gPlainU), orgId: gOrg._id, userId: gPlainU._id };

  // Door 1: toggling billing access off (even on yourself) — refused on the last one.
  const toggle = await call('PATCH', `/admin/memberships/${gBill.userId}`, { ...gBill, body: { billingAccess: false } });
  assert.strictEqual(toggle.status, 409);
  assert.strictEqual(toggle.json.code, 'LAST_BILLING_ADMIN');

  // Door 2: demoting the last billing admin's role (role changes are not billing-gated, so a
  // plain admin can attempt this) — refused.
  const demote = await call('PATCH', `/admin/memberships/${gBill.userId}`, { ...gPlain, body: { role: 'lead' } });
  assert.strictEqual(demote.status, 409);
  assert.strictEqual(demote.json.code, 'LAST_BILLING_ADMIN');

  // Door 3a: deactivating via the general PATCH — refused.
  const deact = await call('PATCH', `/admin/memberships/${gBill.userId}`, { ...gPlain, body: { isActive: false } });
  assert.strictEqual(deact.status, 409);
  assert.strictEqual(deact.json.code, 'LAST_BILLING_ADMIN');

  // Door 3b: the dedicated deactivate route — refused.
  const deact2 = await call('PATCH', `/admin/memberships/${gBill.userId}/deactivate`, gPlain);
  assert.strictEqual(deact2.status, 409);
  assert.strictEqual(deact2.json.code, 'LAST_BILLING_ADMIN');

  // Door 4: removing the membership from the org — refused.
  const removed = await call('DELETE', `/admin/memberships/${gBill.userId}`, gPlain);
  assert.strictEqual(removed.status, 409);
  assert.strictEqual(removed.json.code, 'LAST_BILLING_ADMIN');

  // Through all five attempts, the org still has its billing admin.
  const still = await Membership.findOne({ userId: gBill.userId, organizationId: gOrg._id }).lean();
  assert.strictEqual(still.billingAccess, true);
  assert.strictEqual(still.isActive, true);
  assert.strictEqual(still.role, 'admin');

  // The guard is about the LAST one, not billing admins generally: hand access to the plain
  // admin, and the same demotion that was refused above now succeeds…
  const grant = await call('PATCH', `/admin/memberships/${gPlain.userId}`, { ...gBill, body: { billingAccess: true } });
  assert.strictEqual(grant.status, 200);
  const demoteNow = await call('PATCH', `/admin/memberships/${gBill.userId}`, { ...gPlain, body: { role: 'lead' } });
  assert.strictEqual(demoteNow.status, 200, 'with a second billing admin, the first can be demoted');

  // …which makes the second one the last: the guard follows.
  const toggleNew = await call('PATCH', `/admin/memberships/${gPlain.userId}`, { ...gPlain, body: { billingAccess: false } });
  assert.strictEqual(toggleNew.status, 409);
  assert.strictEqual(toggleNew.json.code, 'LAST_BILLING_ADMIN');
});

test('LAST_BILLING_ADMIN guard: every door ALLOWS the strip when a second billing admin exists', { skip }, async () => {
  // The mirror of the refusal test: with two billing admins (A + B), each door may strip A because
  // B remains. Proves the guard blocks only the LAST one — its early-return never over-refuses. A is
  // re-granted / reactivated between doors so it's a genuine billing admin at each door's turn.
  const org = await Organization.create({ name: 'TwoBill', slug: 'twobill', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const aU = await makeUser('Atwo');
  const bU = await makeUser('Btwo');
  await Membership.create({ userId: aU._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: true });
  await Membership.create({ userId: bU._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: true });
  const A = { orgId: org._id, userId: aU._id };
  const B = { token: signUserToken(bU), orgId: org._id, userId: bU._id }; // caller: a billing admin, so allowed on every door

  // Door 1 — billingAccess:false on A.
  const d1 = await call('PATCH', `/admin/memberships/${A.userId}`, { ...B, body: { billingAccess: false } });
  assert.strictEqual(d1.status, 200, 'billingAccess:false allowed while B remains');
  // Re-grant so A is a billing admin again for the next door.
  assert.strictEqual((await call('PATCH', `/admin/memberships/${A.userId}`, { ...B, body: { billingAccess: true } })).status, 200);

  // Door 3a — isActive:false via the general PATCH.
  const d3a = await call('PATCH', `/admin/memberships/${A.userId}`, { ...B, body: { isActive: false } });
  assert.strictEqual(d3a.status, 200, 'isActive:false allowed while B remains');
  assert.strictEqual((await call('PATCH', `/admin/memberships/${A.userId}/reactivate`, B)).status, 200);

  // Door 3b — the dedicated deactivate route.
  const d3b = await call('PATCH', `/admin/memberships/${A.userId}/deactivate`, B);
  assert.strictEqual(d3b.status, 200, '/deactivate allowed while B remains');
  assert.strictEqual((await call('PATCH', `/admin/memberships/${A.userId}/reactivate`, B)).status, 200);

  // Door 4 — DELETE the membership.
  const d4 = await call('DELETE', `/admin/memberships/${A.userId}`, B);
  assert.strictEqual(d4.status, 200, 'DELETE allowed while B remains');
  assert.strictEqual(await Membership.findOne({ userId: A.userId, organizationId: org._id }), null);

  // B was the survivor the whole way through and is untouched.
  const b = await Membership.findOne({ userId: B.userId, organizationId: org._id }).lean();
  assert.strictEqual(b.billingAccess, true);
  assert.strictEqual(b.isActive, true);
  assert.strictEqual(b.role, 'admin');
});

test('LAST_BILLING_ADMIN guard: ordinary non-billing members are never blocked', { skip }, async () => {
  // The guard keys on being an ACTIVE billing ADMIN. A canvasser, or a non-billing admin, can be
  // freely deactivated/removed/demoted even when they're the org's only such member — so the
  // early-return in isLastBillingAdmin (billingAccess && role==='admin' && isActive) can't misfire
  // and wall off routine roster management.
  const org = await Organization.create({ name: 'Routine', slug: 'routine', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const baU = await makeUser('Ba');       // the org's one billing admin (arms the guard)
  const naU = await makeUser('Na');       // a NON-billing admin
  const cU = await makeUser('Ca');        // a canvasser
  await Membership.create({ userId: baU._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: true });
  await Membership.create({ userId: naU._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: false });
  await Membership.create({ userId: cU._id, organizationId: org._id, role: 'canvasser', isActive: true, billingAccess: false });
  const BA = { token: signUserToken(baU), orgId: org._id, userId: baU._id };

  // Demote the non-billing admin — not billing-relevant, allowed.
  assert.strictEqual((await call('PATCH', `/admin/memberships/${naU._id}`, { ...BA, body: { role: 'canvasser' } })).status, 200);
  // Deactivate the canvasser — allowed.
  assert.strictEqual((await call('PATCH', `/admin/memberships/${cU._id}/deactivate`, BA)).status, 200);
  // Remove the (now-canvasser) former non-billing admin — allowed.
  assert.strictEqual((await call('DELETE', `/admin/memberships/${naU._id}`, BA)).status, 200);

  // The billing admin who armed the guard is untouched throughout.
  const ba = await Membership.findOne({ userId: baU._id, organizationId: org._id }).lean();
  assert.strictEqual(ba.billingAccess, true);
  assert.strictEqual(ba.isActive, true);
});
