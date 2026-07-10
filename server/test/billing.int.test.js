import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Billing/entitlement matrix over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/billing_test node --test test/billing.int.test.js
// Covers: the status × method gate (reads pass when suspended, writes 402;
// canceled closes reads too), computed trial expiry, super-admin bypass, the
// mobile sync-boundary grace, entitlementFor's pure rules, and the monthly
// statement's first-knock → archive-month billing window.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-billing';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { SubscriptionEvent } = await import('../src/models/SubscriptionEvent.js');
const { entitlementFor } = await import('../src/services/billing/entitlement.js');
const { monthlyStatement } = await import('../src/services/billing/statement.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Household, CanvassActivity, Subscription, SubscriptionEvent]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Billing Org', slug: 'billing-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'badmin@t.co', passwordHash: 'x', isActive: true });
  const superU = await User.create({ firstName: 'Sue', lastName: 'Super', email: 'super@t.co', passwordHash: 'x', isActive: true, isSuperAdmin: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Camp', type: 'survey', state: 'KY', isActive: true });
  const sub = await Subscription.create({ organizationId: org._id, status: 'active', statusChangedAt: new Date() });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, camp, sub, adminTok: signUserToken(admin), superTok: signUserToken(superU) });
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
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

async function setStatus(status, extra = {}) {
  await Subscription.updateOne(
    { _id: ctx.sub._id },
    { $set: { status, statusChangedAt: new Date(), ...extra } }
  );
}

// ---- pure rules -------------------------------------------------------------

test('entitlementFor: missing record fails open; trial expiry is computed', { skip }, () => {
  assert.strictEqual(entitlementFor(null).canWrite, true);
  const live = entitlementFor({ status: 'trial', trialEndsAt: new Date(Date.now() + 3 * 86400000) });
  assert.strictEqual(live.canWrite, true);
  assert.strictEqual(live.banner, 'trial');
  assert.ok(live.trialDaysLeft >= 2 && live.trialDaysLeft <= 3);
  const dead = entitlementFor({ status: 'trial', trialEndsAt: new Date(Date.now() - 1000) });
  assert.strictEqual(dead.effective, 'suspended');
  assert.strictEqual(dead.banner, 'trial_expired');
  assert.strictEqual(entitlementFor({ status: 'internal' }).canWrite, true);
  assert.strictEqual(entitlementFor({ status: 'past_due' }).canWrite, true);
  assert.strictEqual(entitlementFor({ status: 'suspended' }).canWrite, false);
  assert.strictEqual(entitlementFor({ status: 'canceled' }).canCanvass, false);
});

// ---- gate matrix ------------------------------------------------------------

test('active org: admin write passes', { skip }, async () => {
  await setStatus('active');
  const r = await call('PATCH', `/admin/campaigns/${ctx.camp._id}`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { name: 'Camp' },
  });
  assert.strictEqual(r.status, 200);
});

test('suspended org: reads pass, writes 402 with subscription-inactive', { skip }, async () => {
  await setStatus('suspended');
  const read = await call('GET', '/admin/campaigns', { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(read.status, 200);
  const write = await call('PATCH', `/admin/campaigns/${ctx.camp._id}`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { name: 'Camp2' },
  });
  assert.strictEqual(write.status, 402);
  assert.strictEqual(write.json.code, 'subscription-inactive');
});

test('expired trial acts suspended; live trial writes fine', { skip }, async () => {
  await setStatus('trial', { trialEndsAt: new Date(Date.now() - 1000) });
  const blocked = await call('PATCH', `/admin/campaigns/${ctx.camp._id}`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { name: 'Camp3' },
  });
  assert.strictEqual(blocked.status, 402);
  await setStatus('trial', { trialEndsAt: new Date(Date.now() + 86400000) });
  const ok = await call('PATCH', `/admin/campaigns/${ctx.camp._id}`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { name: 'Camp' },
  });
  assert.strictEqual(ok.status, 200);
});

test('canceled org: even reads are closed', { skip }, async () => {
  await setStatus('canceled');
  const read = await call('GET', '/admin/campaigns', { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(read.status, 402);
});

test('internal org: never gated', { skip }, async () => {
  await setStatus('internal');
  const ok = await call('PATCH', `/admin/campaigns/${ctx.camp._id}`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { name: 'Camp' },
  });
  assert.strictEqual(ok.status, 200);
});

test('super admin bypasses a suspended org entirely', { skip }, async () => {
  await setStatus('suspended');
  const ok = await call('PATCH', `/admin/campaigns/${ctx.camp._id}`, {
    token: ctx.superTok,
    orgId: ctx.org._id,
    body: { name: 'Camp' },
  });
  assert.strictEqual(ok.status, 200);
});

test('mobile sync-boundary grace: pre-suspension timestamp is not 402, fresh one is', { skip }, async () => {
  await setStatus('suspended'); // statusChangedAt = now
  const hh = await Household.create({
    organizationId: ctx.org._id,
    campaignId: ctx.camp._id,
    addressLine1: '1 Test St',
    city: 'Town',
    state: 'KY',
    zipCode: '40001',
    normalizedAddress: '1 TEST ST|TOWN|KY|40001',
    location: { type: 'Point', coordinates: [-84.5, 38.0] },
  });
  const body = { location: { lat: 38.0, lng: -84.5 }, wasOfflineSubmission: true };
  // Recorded yesterday, while entitled → must clear the entitlement gate (any
  // later failure is a different, deeper check — just never the 402).
  const grace = await call('POST', `/mobile/households/${hh._id}/not-home`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { ...body, timestamp: new Date(Date.now() - 86400000).toISOString() },
  });
  assert.notStrictEqual(grace.status, 402);
  // Fresh (or unstamped) submission while suspended → blocked at the gate.
  const fresh = await call('POST', `/mobile/households/${hh._id}/not-home`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body,
  });
  assert.strictEqual(fresh.status, 402);
});

// ---- super-admin billing routes ----------------------------------------------

test('status route requires a reason to suspend and logs an event', { skip }, async () => {
  await setStatus('active');
  const noReason = await call('POST', `/super-admin/organizations/${ctx.org._id}/billing/status`, {
    token: ctx.superTok,
    body: { to: 'suspended' },
  });
  assert.strictEqual(noReason.status, 400);
  const withReason = await call('POST', `/super-admin/organizations/${ctx.org._id}/billing/status`, {
    token: ctx.superTok,
    body: { to: 'suspended', reason: 'invoice 90d overdue' },
  });
  assert.strictEqual(withReason.status, 200);
  assert.strictEqual(withReason.json.subscription.status, 'suspended');
  const ev = await SubscriptionEvent.findOne({ organizationId: ctx.org._id, toStatus: 'suspended' }).lean();
  assert.ok(ev && ev.reason.includes('overdue'));
  await setStatus('active');
});

test('org admins cannot reach the super-admin billing surface', { skip }, async () => {
  const r = await call('GET', `/super-admin/organizations/${ctx.org._id}/billing`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
  });
  assert.strictEqual(r.status, 403);
});

// ---- statement math ----------------------------------------------------------

test('statement: bills from first-knock month through archive month', { skip }, async () => {
  await setStatus('active');
  const org2 = await Organization.create({ name: 'Stmt Org', slug: 'stmt-org', isActive: true });
  await Subscription.create({ organizationId: org2._id, status: 'active', pricePerCampaignCents: 30000 });
  // First knock Feb 10; archived Mar 20 → bills Feb + Mar, not Jan, not Apr.
  const c = await Campaign.create({
    organizationId: org2._id,
    name: 'Windowed',
    type: 'survey',
    state: 'KY',
    isActive: false,
    archivedAt: new Date('2026-03-20T12:00:00Z'),
  });
  // Setup-only campaign: exists all along, no knocks → never bills.
  await Campaign.create({ organizationId: org2._id, name: 'Setup only', type: 'survey', state: 'KY', isActive: true });
  const hh = await Household.create({
    organizationId: org2._id,
    campaignId: c._id,
    addressLine1: '2 Stmt St',
    city: 'Town',
    state: 'KY',
    zipCode: '40002',
    normalizedAddress: '2 STMT ST|TOWN|KY|40002',
    location: { type: 'Point', coordinates: [-84.5, 38.0] },
  });
  const user = await User.create({ firstName: 'K', lastName: 'C', email: 'kc@t.co', passwordHash: 'x', isActive: true });
  await CanvassActivity.create({
    organizationId: org2._id,
    campaignId: c._id,
    householdId: hh._id,
    userId: user._id,
    actionType: 'not_home',
    timestamp: new Date('2026-02-10T15:00:00Z'),
    location: { lat: 38.0, lng: -84.5 },
  });

  const byMonth = async (m) => {
    const s = await monthlyStatement(org2._id, m);
    const line = s.lines.find((l) => l.name === 'Windowed');
    return { billable: line.billable, total: s.totalCents };
  };
  assert.deepStrictEqual(await byMonth('2026-01'), { billable: false, total: 0 });
  assert.deepStrictEqual(await byMonth('2026-02'), { billable: true, total: 30000 });
  assert.deepStrictEqual(await byMonth('2026-03'), { billable: true, total: 30000 });
  assert.deepStrictEqual(await byMonth('2026-04'), { billable: false, total: 0 });
  await assert.rejects(() => monthlyStatement(org2._id, 'not-a-month'), /YYYY-MM/);
});
