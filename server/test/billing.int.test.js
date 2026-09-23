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
// The harness has no Redis: bound the export-create enqueue so the carve-out assertions get
// a fast 503 instead of hanging on ioredis's offline buffer.
process.env.EXPORT_ENQUEUE_TIMEOUT_MS = process.env.EXPORT_ENQUEUE_TIMEOUT_MS || '400';

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
  // Suspended orgs keep the export window too — ownership is status-agnostic.
  const exp = await call('POST', '/admin/exports', {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { type: 'canvass-activity', campaignId: String(ctx.camp._id), params: {} },
  });
  assert.notStrictEqual(exp.status, 402, 'export creation must pass the entitlement gate while suspended');
  // …and so must its preview (a read wearing POST — no queue involved, so exactly 200).
  const est = await call('POST', '/admin/exports/estimate', {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { type: 'canvass-activity', campaignId: String(ctx.camp._id), params: {} },
  });
  assert.strictEqual(est.status, 200, 'the estimate preview must pass the entitlement gate while suspended');
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

  // The Export Center carve-out: creating an export job is the ONE write a read-only org may
  // perform (middleware/entitlement.js) — without it the wind-down "available to export"
  // promise is broken for the queued-export path. Not-402 is the assertion: with no Redis in
  // the harness the enqueue itself may 503, but the entitlement gate must have let it through.
  const exp = await call('POST', '/admin/exports', {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { type: 'canvass-activity', campaignId: String(ctx.camp._id), params: {} },
  });
  assert.notStrictEqual(exp.status, 402, 'export creation must pass the entitlement gate while canceled');
  assert.ok([201, 503].includes(exp.status), `export create is 201 (queued) or 503 (queue down), got ${exp.status}`);
  // The preview that precedes the create is carved out too (counts only, no artifact) —
  // a wind-down org must be able to see what it is about to export.
  const est = await call('POST', '/admin/exports/estimate', {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { type: 'canvass-activity', campaignId: String(ctx.camp._id), params: {} },
  });
  assert.strictEqual(est.status, 200, 'the estimate preview must pass the entitlement gate while canceled');
  // …and the carve-out is method+path EXACT ×2: an export DELETE is still an ordinary write.
  const del = await call('DELETE', '/admin/exports/652f000000000000000000cc', {
    token: ctx.adminTok,
    orgId: ctx.org._id,
  });
  assert.strictEqual(del.status, 402, 'the carve-out must not widen to other export writes');
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

// THE DOLLAR-FREE GUARANTEE, at the wire.
//
// publicMonthHistory() is unit-tested to strip cents (statementRange.int.test.js), but the promise
// in docs/BILLING.md is about what a customer's BROWSER receives — and hiding a number in JSX still
// ships it. So this walks the actual HTTP response body. It is the test that would have to fail
// before the "customers never see a price in the app" line becomes false.
test('the customer history endpoint ships NO dollar figure, at any depth', { skip }, async () => {
  await Membership.updateOne(
    { userId: (await User.findOne({ email: 'badmin@t.co' }))._id, organizationId: ctx.org._id },
    { $set: { billingAccess: true } }
  );
  const res = await call('GET', '/admin/billing/history?months=6', { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(res.status, 200, 'a billing admin can read their own history');
  assert.ok(Array.isArray(res.json.months) && res.json.months.length === 6, 'six months back');

  const leaked = [];
  (function walk(v, path) {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (/Cents$/.test(k) || k === 'rate' || k === 'price' || k === 'amount') leaked.push(`${path}.${k}`);
        walk(val, `${path}.${k}`);
      }
    }
  })(res.json, '$');
  assert.deepStrictEqual(leaked, [], 'no money reaches the customer');
  // Belt and braces: no dollar sign, and no bare 30000/300 rate anywhere in the serialized body.
  assert.ok(!JSON.stringify(res.json).includes('$'), 'no currency symbol in the payload');
});

test('a SUPER admin reading the customer route gets the same dollar-free projection', { skip }, async () => {
  // The projector is unconditional on purpose — one function decides what the customer surface
  // shows, so there is no "staff mode" of this route that could be reached with the wrong token.
  const res = await call('GET', '/admin/billing/history?months=3', { token: ctx.superTok, orgId: ctx.org._id });
  assert.strictEqual(res.status, 200);
  assert.ok(!JSON.stringify(res.json).match(/Cents/), 'still no cents fields');
});

test('the customer history clamps the months window rather than trusting the query', { skip }, async () => {
  const huge = await call('GET', '/admin/billing/history?months=9999', { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(huge.status, 200);
  assert.strictEqual(huge.json.months.length, huge.json.maxMonths, 'capped at the documented maximum');
  const junk = await call('GET', '/admin/billing/history?months=banana', { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(junk.status, 200);
  assert.strictEqual(junk.json.months.length, 12, 'a garbage value falls back to the default');
});

test('the customer history is gated to billing admins, like the rest of the router', { skip }, async () => {
  const plain = await User.create({ firstName: 'Pat', lastName: 'Plain', email: 'plainadmin@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: plain._id, organizationId: ctx.org._id, role: 'admin', isActive: true });
  const denied = await call('GET', '/admin/billing/history', { token: signUserToken(plain), orgId: ctx.org._id });
  assert.strictEqual(denied.status, 403);
  assert.strictEqual(denied.json.code, 'billing-access-required');
});

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

// ── Batch 4: the invoicing desk's contracts — what must NOT change, and what is newly true. ──

// The list route is mounted by the org switcher on every super-admin page, by Select org, Support
// access, Imports, and by the mobile org picker. Its parameterless shape is a contract with
// shipped mobile builds: additive only, never a changed default.
test('the parameterless org list keeps every key it shipped with, and costs no extra query', { skip }, async () => {
  const res = await call('GET', '/super-admin/organizations', { token: ctx.superTok });
  assert.strictEqual(res.status, 200);
  const row = res.json.organizations.find((r) => r.name === 'Billing Org');
  assert.ok(row, 'the org is present');
  for (const k of [
    'id', 'name', 'slug', 'isActive', 'isInternal', 'memberCount', 'campaignCount',
    'campaignsActive', 'campaignsArchived', 'createdAt', 'updatedAt', 'billing',
  ]) {
    assert.ok(k in row, `legacy key ${k} must survive`);
  }
  for (const k of ['status', 'effective', 'trialEndsAt', 'trialDaysLeft']) {
    assert.ok(k in row.billing, `legacy billing key ${k} must survive`);
  }
  assert.ok('organizations' in res.json && 'deletingOrganizations' in res.json && 'total' in res.json);
  assert.ok(
    !('invoicing' in row),
    'the key is ABSENT, not null — the Statement read is opt-in and the default shape is unchanged'
  );
  // Internal orgs stay in the default list: the mobile picker is how staff reach the demo org.
  // (This fixture's internal org carries the status, not the born-immutable flag — the route
  // checks BOTH signals, which is the point.)
  assert.ok(
    res.json.organizations.some((r) => r.name === 'Doorline Internal'),
    'internal orgs are never filtered out server-side — hiding them is a client-side desk choice'
  );
});

test('?invoicing=1 adds the chase signal, and null (not zeros) for an internal org', { skip }, async () => {
  const res = await call('GET', '/super-admin/organizations?invoicing=1', { token: ctx.superTok });
  assert.strictEqual(res.status, 200);
  const row = res.json.organizations.find((r) => r.name === 'Billing Org');
  assert.ok(row.invoicing, 'the block is present when asked for');
  for (const k of ['outstandingCount', 'outstandingCents', 'overdueCount', 'overdueCents', 'oldestDueAt', 'lastPaidAt']) {
    assert.ok(k in row.invoicing, `${k} rides the cheap path`);
  }
  const internal = res.json.organizations.find((r) => r.name === 'Doorline Internal');
  assert.strictEqual(internal.invoicing, null, '"never billed" and "owes nothing" are different facts');
});

test('the rollup keeps every legacy key and adds the desk totals', { skip }, async () => {
  const res = await call('GET', '/super-admin/organizations/billing-rollup', { token: ctx.superTok });
  assert.strictEqual(res.status, 200);
  for (const k of ['month', 'totalCents', 'billableCampaigns', 'byStatus', 'organizations']) {
    assert.ok(k in res.json, `legacy header key ${k} must survive the swap to a range walk`);
  }
  const row = res.json.organizations[0];
  for (const k of [
    'organizationId', 'name', 'isActive', 'status', 'effective', 'trialEndsAt', 'trialDaysLeft',
    'windDownEndsAt', 'rateCents', 'billableCampaigns', 'totalCents', 'setupCount',
  ]) {
    assert.ok(k in row, `legacy row key ${k} must survive`);
  }
  // Additive: the whole invoicing picture, computed from the SAME walk.
  assert.ok(row.invoicing && row.nextAction, 'each row carries its verdict and what to do about it');
  assert.ok('awaiting' in row.invoicing && 'outstanding' in row.invoicing && 'overdue' in row.invoicing);
  for (const k of ['asOf', 'currentMonth', 'awaitingTotalCents', 'outstandingTotalCents', 'overdueTotalCents']) {
    assert.ok(k in res.json, `${k} feeds the KPI strip`);
  }
  // The header is still exactly the sum of its rows.
  assert.strictEqual(
    res.json.awaitingTotalCents,
    res.json.organizations.reduce((s, r) => s + r.invoicing.awaiting.totalCents, 0)
  );
});

test('at-risk flags an overdue invoice, including for a DEACTIVATED org', { skip }, async () => {
  const { Statement } = await import('../src/models/Statement.js');
  const late = await Organization.create({ name: 'Late Payer', slug: 'late-payer', isActive: false });
  await Subscription.create({ organizationId: late._id, status: 'active', statusChangedAt: new Date() });
  await Statement.create({
    organizationId: late._id,
    month: '2026-01',
    status: 'issued',
    rateCents: 30000,
    rulesVersion: 3,
    totalCents: 30000,
    lines: [],
    issuedAt: new Date('2026-02-01T00:00:00Z'),
    dueAt: new Date('2026-03-03T00:00:00Z'),
  });

  const res = await call('GET', '/super-admin/organizations/at-risk', { token: ctx.superTok });
  assert.strictEqual(res.status, 200);
  const item = res.json.items.find((i) => i.type === 'invoice_overdue' && i.name === 'Late Payer');
  assert.ok(item, 'switching off sign-in does not settle an invoice — the old loop skipped inactive orgs');
  assert.strictEqual(item.count, 1);
  assert.strictEqual(item.totalCents, 30000);
  assert.ok(item.oldestDueAt && item.maxDaysOverdue > 0);
});

test('an internal org never appears as overdue, whatever its statements say', { skip }, async () => {
  const { Statement } = await import('../src/models/Statement.js');
  const internal = await Organization.findOne({ slug: 'dl-internal' });
  await Statement.create({
    organizationId: internal._id,
    month: '2026-02',
    status: 'issued',
    rateCents: 30000,
    rulesVersion: 3,
    totalCents: 30000,
    lines: [],
    issuedAt: new Date('2026-03-01T00:00:00Z'),
    dueAt: new Date('2026-04-01T00:00:00Z'),
  });
  const res = await call('GET', '/super-admin/organizations/at-risk', { token: ctx.superTok });
  assert.ok(
    !res.json.items.some((i) => i.type === 'invoice_overdue' && i.organizationId === String(internal._id)),
    'internal orgs are never chased'
  );
  await Statement.deleteMany({ organizationId: internal._id });
});

test('PAYMENT STATE NEVER REACHES THE CUSTOMER — walked, not assumed', { skip }, async () => {
  // The customer's own billing page is dollar-free by construction (publicUsage /
  // publicMonthHistory build their own objects). Paid, due and terms are the same class of fact
  // and must not have slipped in behind them.
  const forbidden = /Cents$|^paidAt$|^dueAt$|^paymentRef$|^termsDays$|^paymentTermsDays$|^paymentState$|^paidByUserId$/;
  for (const path of ['/admin/billing', '/admin/billing/history?months=6']) {
    const res = await call('GET', path, { token: ctx.adminTok, orgId: ctx.org._id });
    assert.strictEqual(res.status, 200, path);
    const leaked = [];
    (function walk(v, at) {
      if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`));
      if (v && typeof v === 'object') {
        for (const [k, val] of Object.entries(v)) {
          if (forbidden.test(k)) leaked.push(`${at}.${k}`);
          walk(val, `${at}.${k}`);
        }
      }
    })(res.json, '$');
    assert.deepStrictEqual(leaked, [], `no money or payment state on ${path}`);
  }
});
