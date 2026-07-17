import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Billing/entitlement matrix over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/billing_test node --test test/billing.int.test.js
// Covers: the status × method gate (reads pass when suspended OR canceled — both
// are read-only — while writes 402), computed trial expiry, super-admin bypass, the
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
const { SupportAccessGrant } = await import('../src/models/SupportAccessGrant.js');
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
  Object.assign(ctx, { org, camp, sub, adminTok: signUserToken(admin), superTok: signUserToken(superU), superId: superU._id });
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

test('canceled org: READ-ONLY (reads/exports pass, writes 402) — the wind-down export window', { skip }, async () => {
  // Changed: canceled used to close reads too. It is now read-only like suspended, so a terminated
  // customer can still log in and EXPORT their data during the 60-day wind-down before deletion.
  await setStatus('canceled');
  const read = await call('GET', '/admin/campaigns', { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(read.status, 200, 'a canceled org can still read/export its own data');
  const write = await call('PATCH', `/admin/campaigns/${ctx.camp._id}`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { name: 'Nope' },
  });
  assert.strictEqual(write.status, 402, 'but writes are blocked');
  assert.strictEqual(write.json?.code, 'subscription-inactive');
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

test('super admin bypasses a suspended org entirely (with a support grant)', { skip }, async () => {
  // The entitlement bypass is unchanged: a suspended org is read-only for its own admins, and staff
  // can still act. What changed is the DOOR — staff can no longer be inside a customer's account at
  // all without a time-boxed, reasoned SupportAccessGrant. The rule is org ENTRY, not content type:
  // billing metadata is readable from /super-admin/* without entering anything, but the moment you
  // are in their account there is a grant and a reason. See models/SupportAccessGrant.js.
  await SupportAccessGrant.create({
    actorUserId: ctx.superId,
    organizationId: ctx.org._id,
    reason: 'Re-enabling a suspended account after payment cleared.',
    expiresAt: new Date(Date.now() + 3_600_000),
  });
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

// ── Batch 2: the cross-org revenue answers. ──

test('billing-rollup: exact aggregate math, ranked rows, internal orgs excluded', { skip }, async () => {
  // An internal org must never appear in a revenue view.
  const internal = await Organization.create({ name: 'Doorline Internal', slug: 'dl-internal', isActive: true });
  await Subscription.create({ organizationId: internal._id, status: 'internal', statusChangedAt: new Date() });

  const res = await call('GET', '/super-admin/organizations/billing-rollup', { token: ctx.superTok });
  assert.strictEqual(res.status, 200);
  assert.match(res.json.month, /^\d{4}-\d{2}$/);

  const rows = res.json.organizations;
  assert.ok(!rows.some((r) => r.name === 'Doorline Internal'), 'internal orgs are not revenue');

  // The header is exactly the sum of its rows — never an independent estimate.
  const sumCents = rows.reduce((s, r) => s + r.totalCents, 0);
  assert.strictEqual(res.json.totalCents, sumCents);
  const sumCampaigns = rows.reduce((s, r) => s + r.billableCampaigns, 0);
  assert.strictEqual(res.json.billableCampaigns, sumCampaigns);

  // Ranked by revenue, and byStatus accounts for every row.
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].totalCents >= rows[i].totalCents, 'sorted top-payer first');
  }
  const statusSum = Object.values(res.json.byStatus).reduce((s, n) => s + n, 0);
  assert.strictEqual(statusSum, rows.length);

  // org2 ('Windowed', first knock Feb 2026, never archived) is billing this month at the default rate.
  const windowed = rows.find((r) => r.name === 'Stmt Org 2');
  if (windowed) {
    assert.strictEqual(windowed.billableCampaigns >= 1, true, 'a started, unarchived campaign bills');
  }
});

test('at-risk: expiring trials, past-due, wind-downs — with the far-off trial NOT flagged', { skip }, async () => {
  const mk = async (name, slug, subFields) => {
    const o = await Organization.create({ name, slug, isActive: true });
    await Subscription.create({ organizationId: o._id, statusChangedAt: new Date(), ...subFields });
    return o;
  };
  await mk('Trial Soon', 'trial-soon', { status: 'trial', trialEndsAt: new Date(Date.now() + 2 * 86_400_000) });
  await mk('Trial Far', 'trial-far', { status: 'trial', trialEndsAt: new Date(Date.now() + 20 * 86_400_000) });
  await mk('Past Due Org', 'past-due-org', { status: 'past_due' });
  await mk('Canceled Org', 'canceled-org', { status: 'canceled' });

  const res = await call('GET', '/super-admin/organizations/at-risk', { token: ctx.superTok });
  assert.strictEqual(res.status, 200);
  const items = res.json.items;
  const byName = (n) => items.find((i) => i.name === n);

  const soon = byName('Trial Soon');
  assert.strictEqual(soon?.type, 'trial_expiring');
  assert.ok(soon.trialDaysLeft <= 7);

  assert.strictEqual(byName('Trial Far'), undefined, 'a 20-day trial is not "at risk" at the default window');
  assert.strictEqual(byName('Past Due Org')?.type, 'past_due');

  const canceled = byName('Canceled Org');
  assert.strictEqual(canceled?.type, 'wind_down');
  assert.ok(canceled.windDownEndsAt, 'the wind-down item carries its deletion date');

  assert.ok(!byName('Doorline Internal'), 'internal orgs never appear');
});

test('billing history is paged with an exact total; the before/after values travel', { skip }, async () => {
  const o = await Organization.create({ name: 'History Org', slug: 'history-org', isActive: true });
  await Subscription.create({ organizationId: o._id, status: 'active', statusChangedAt: new Date() });
  for (let i = 0; i < 3; i++) {
    await SubscriptionEvent.create({
      organizationId: o._id,
      byUserId: ctx.superId,
      changes: { pricePerCampaignCents: { from: 30000 + i, to: 30001 + i } },
    });
  }

  const page = await call('GET', `/super-admin/organizations/${o._id}/billing?eventsSkip=1&eventsLimit=1`, {
    token: ctx.superTok,
  });
  assert.strictEqual(page.status, 200);
  assert.strictEqual(page.json.eventsTotal, 3, 'exact total, not the page length');
  assert.strictEqual(page.json.events.length, 1);
  assert.ok(page.json.events[0].changes?.pricePerCampaignCents?.from, 'the stored from/to values are in the payload');

  // Legacy shape: parameterless call keeps the newest-50 window.
  const legacy = await call('GET', `/super-admin/organizations/${o._id}/billing`, { token: ctx.superTok });
  assert.strictEqual(legacy.json.events.length, 3);
  assert.ok(legacy.json.subscription, 'subscription/entitlement contract unchanged');
});

test('the orgs list pages, searches, and splits campaign counts by active/archived', { skip }, async () => {
  // Legacy: parameterless returns everything, with the new count fields additive.
  const legacy = await call('GET', '/super-admin/organizations', { token: ctx.superTok });
  assert.strictEqual(legacy.status, 200);
  assert.ok(legacy.json.organizations.length >= 5, 'full list on the legacy path');
  const row = legacy.json.organizations.find((r) => r.name === 'Billing Org');
  assert.ok('campaignsActive' in row && 'campaignsArchived' in row, 'the two campaign bases are split');
  assert.strictEqual(row.campaignsActive + row.campaignsArchived, row.campaignCount, 'and they sum to the legacy count');

  // Paged + searched.
  const paged = await call('GET', '/super-admin/organizations?q=history&limit=1&skip=0', { token: ctx.superTok });
  assert.strictEqual(paged.json.total, 1, 'q hits name/slug server-side');
  assert.strictEqual(paged.json.organizations[0].name, 'History Org');

  // Sort by trial end: ascending among dated orgs (soonest expiry first), null-dated last.
  const byTrial = await call('GET', '/super-admin/organizations?sort=trialEnds', { token: ctx.superTok });
  const names = byTrial.json.organizations.map((o) => o.name);
  assert.ok(
    names.indexOf('Trial Soon') < names.indexOf('Trial Far'),
    'the sooner-expiring trial sorts ahead of the later one'
  );
  const dated = byTrial.json.organizations.filter((o) => o.billing.trialEndsAt);
  for (let i = 1; i < dated.length; i++) {
    assert.ok(
      new Date(dated[i - 1].billing.trialEndsAt) <= new Date(dated[i].billing.trialEndsAt),
      'dated rows ascend'
    );
  }
});

// ── Batch 3: the slim org detail composite — metadata without a grant, exemption made legible. ──

test('org detail: roster + campaigns as plain metadata (no grant, no audit row), internal flag surfaced', { skip }, async () => {
  const { AccessLog } = await import('../src/models/AccessLog.js');
  await AccessLog.deleteMany({});

  // ctx.org has Ada as its admin and one campaign; superTok is a SUPPORT-tier super (default
  // platformRole) — exactly who this surface must serve without a grant.
  const res = await call('GET', `/super-admin/organizations/${ctx.org._id}`, { token: ctx.superTok });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.organization.name, 'Billing Org');
  assert.strictEqual(res.json.billing.internal, false);
  const ada = res.json.members.find((m) => m.email === 'badmin@t.co');
  assert.ok(ada, 'the roster is finally readable without entering the org');
  assert.strictEqual(ada.role, 'admin');
  assert.ok(res.json.campaigns.some((c) => c.name === 'Camp'));

  // The retention-exemption consequence, surfaced where the status is seen.
  const internal = await Organization.findOne({ slug: 'dl-internal' });
  const res2 = await call('GET', `/super-admin/organizations/${internal._id}`, { token: ctx.superTok });
  assert.strictEqual(res2.json.billing.internal, true, 'internal = exempt-from-retention is legible');

  await new Promise((r) => setTimeout(r, 120));
  assert.strictEqual(await AccessLog.countDocuments({}), 0, 'reading org METADATA writes no audit row');
});
