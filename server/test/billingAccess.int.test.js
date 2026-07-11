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

test('usage meter counts only first-knock-started campaigns at the org rate', { skip }, async () => {
  const before = await call('GET', '/admin/billing', ctx.billing);
  assert.strictEqual(before.json.usage.billableCampaigns, 0, 'no canvassed campaigns yet → $0');
  assert.strictEqual(before.json.usage.totalCents, 0);

  const camp = await Campaign.create({ organizationId: ctx.org._id, name: 'Fall', type: 'lit_drop', state: 'FL' });
  // Creating the campaign alone does NOT bill — it's in free setup.
  const afterCreate = await call('GET', '/admin/billing', ctx.billing);
  assert.strictEqual(afterCreate.json.usage.billableCampaigns, 0, 'creating a campaign is free');
  assert.strictEqual(afterCreate.json.usage.billing.length, 0);
  assert.strictEqual(afterCreate.json.usage.setupCount, 1, 'the un-canvassed campaign shows as free setup');

  // …a real knock this month starts billing.
  await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: camp._id, householdId: new mongoose.Types.ObjectId(),
    userId: ctx.billing.userId, actionType: 'lit_dropped', timestamp: new Date(),
    location: { lat: 30, lng: -81 },
  });
  const usage = await currentUsage(ctx.org._id);
  assert.strictEqual(usage.billableCampaigns, 1, 'a canvassed campaign is billable this month');
  assert.strictEqual(usage.totalCents, 30000, 'billed at the $300 default rate');

  const afterKnock = await call('GET', '/admin/billing', ctx.billing);
  assert.strictEqual(afterKnock.json.usage.billableCampaigns, 1);
  assert.strictEqual(afterKnock.json.usage.totalCents, 30000);

  // The breakdown names WHICH campaign is billing and since when.
  const u = afterKnock.json.usage;
  assert.strictEqual(u.billing.length, 1);
  assert.strictEqual(u.billableCampaigns, u.billing.length, 'count matches the breakdown');
  assert.strictEqual(u.billing[0].name, 'Fall');
  assert.ok(u.billing[0].firstKnockAt, 'the billing line carries its first-knock date');
  assert.strictEqual(u.billing[0].amountCents, 30000);
  assert.strictEqual(u.setupCount, 0, 'Fall is now billing, not setup');

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
  assert.ok(r.json.tempPassword && r.json.tempPassword.length >= 8, 'returns a temp password to hand over');
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
