import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// GET /admin/billing-renewals — which rules each campaign bills under, for the election-day archive
// reminder (docs/PROPOSAL_BILLING_CYCLES.md §F), over the REAL Express app + throwaway mongod:
//   npm run test:int -- test/billingRenewals.int.test.js
// The rule goes to every org admin; the renewal dates only to billing admins (owner decision 9);
// leads are refused. The date math itself is billingMonths.test.js's — this proves the plumbing.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-billing-renewals';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SupportAccessGrant } = await import('../src/models/SupportAccessGrant.js');
const { reminderDates, setCycleBillingFromForTests } = await import('../src/services/billing/billingMonths.js');
const { zonedDayStr } = await import('../src/utils/timezone.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const DAY = 86_400_000;
const TZ = 'America/New_York';
let server;
let base;
const ctx = {};

// Noon-ish UTC `n` days ago: the same civil day in New York, so no timezone edge.
const daysAgo = (n) => {
  const d = new Date(Date.now() - n * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 16, 0, 0));
};

const makeUser = (first, extra = {}) =>
  User.create({ firstName: first, lastName: 'X', email: `${first.toLowerCase()}@renew.t.co`, passwordHash: 'x', isActive: true, ...extra });

const makeCampaign = (org, name, extra = {}) =>
  Campaign.create({ organizationId: org._id, name, type: 'survey', state: 'KY', timeZone: TZ, ...extra });

const knock = (org, campaign, at) =>
  CanvassActivity.create({
    organizationId: org._id,
    campaignId: campaign._id,
    householdId: new mongoose.Types.ObjectId(),
    userId: ctx.billingUserId,
    actionType: 'not_home',
    timestamp: at,
    location: { lat: 38, lng: -84.5 },
  });

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, CanvassActivity, SupportAccessGrant]) {
    await M.deleteMany({});
  }
  // The switch day 60 days back: a campaign first out 90 days ago keeps calendar months, one first out
  // 40 days ago renews monthly — whatever today's date is.
  setCycleBillingFromForTests(zonedDayStr(daysAgo(60), TZ));

  const org = await Organization.create({ name: 'Renew Org', slug: 'renew-org', isActive: true });
  const other = await Organization.create({ name: 'Other Org', slug: 'renew-other', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  await Subscription.create({ organizationId: other._id, status: 'active' });

  const billingU = await makeUser('Billie');
  const plainU = await makeUser('Plain');
  const leadU = await makeUser('Leda');
  const staleLeadU = await makeUser('Stale'); // demoted to lead, billingAccess never cleared
  const staffU = await makeUser('Staff', { isSuperAdmin: true });
  await Membership.create({ userId: billingU._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: true });
  await Membership.create({ userId: plainU._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: false });
  await Membership.create({ userId: leadU._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: staleLeadU._id, organizationId: org._id, role: 'lead', isActive: true, billingAccess: true });
  await SupportAccessGrant.create({ actorUserId: staffU._id, organizationId: org._id, reason: 'renewals test', expiresAt: new Date(Date.now() + 3_600_000) });
  ctx.billingUserId = billingU._id;

  const cycle = await makeCampaign(org, 'Renews monthly');
  const firstVisit = daysAgo(40);
  await knock(org, cycle, firstVisit);
  await knock(org, cycle, daysAgo(10));
  const calendar = await makeCampaign(org, 'Calendar months');
  await knock(org, calendar, daysAgo(90));
  const archived = await makeCampaign(org, 'Archived renewer', { isActive: false, archivedAt: daysAgo(5) });
  await knock(org, archived, daysAgo(40));
  const neverOut = await makeCampaign(org, 'Never out');
  const deskOnly = await makeCampaign(org, 'Desk only');
  // A desk restrict isn't a field visit, so it starts nothing (aggregations.fieldVisitMatch).
  await CanvassActivity.create({
    organizationId: org._id, campaignId: deskOnly._id, householdId: new mongoose.Types.ObjectId(),
    userId: billingU._id, actionType: 'restricted', via: 'bulk', timestamp: daysAgo(30), location: { lat: 38, lng: -84.5 },
  });
  const foreign = await makeCampaign(other, 'Not yours');
  await knock(other, foreign, daysAgo(40));

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org,
    cycle,
    calendar,
    archived,
    neverOut,
    deskOnly,
    foreign,
    cycleFirstVisitDay: zonedDayStr(firstVisit, TZ),
    billing: { token: signUserToken(billingU), orgId: org._id },
    plain: { token: signUserToken(plainU), orgId: org._id },
    lead: { token: signUserToken(leadU), orgId: org._id },
    staleLead: { token: signUserToken(staleLeadU), orgId: org._id },
    staff: { token: signUserToken(staffU), orgId: org._id },
    staffNoOrg: { token: signUserToken(staffU) },
  });
});

after(async () => {
  setCycleBillingFromForTests(null);
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const call = async (path, { token, orgId } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};

const idsOf = (...campaigns) => campaigns.map((c) => String(c._id)).join(',');
const byId = (json) => new Map(json.campaigns.map((c) => [c.campaignId, c]));
const all = () => [ctx.cycle, ctx.calendar, ctx.archived, ctx.neverOut, ctx.deskOnly];

test('leads are refused, even one whose billing access outlived a demotion', { skip }, async () => {
  for (const who of [ctx.lead, ctx.staleLead]) {
    const r = await call(`/admin/billing-renewals?ids=${idsOf(ctx.cycle)}`, who);
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.json.code, 'FORBIDDEN_ROLE');
  }
});

test('an admin without billing access gets each rule and nothing else', { skip }, async () => {
  const r = await call(`/admin/billing-renewals?ids=${idsOf(...all())}`, ctx.plain);
  assert.strictEqual(r.status, 200);
  const rows = byId(r.json);
  assert.strictEqual(rows.size, 5);
  for (const row of rows.values()) {
    assert.deepStrictEqual(Object.keys(row).sort(), ['billingRule', 'campaignId'], 'exactly the rule — no dates');
  }
  assert.strictEqual(rows.get(String(ctx.cycle._id)).billingRule, 'cycle');
  assert.strictEqual(rows.get(String(ctx.calendar._id)).billingRule, 'calendar');
  assert.strictEqual(rows.get(String(ctx.archived._id)).billingRule, 'cycle');
  assert.strictEqual(rows.get(String(ctx.neverOut._id)).billingRule, null);
  assert.strictEqual(rows.get(String(ctx.deskOnly._id)).billingRule, null, 'desk work starts nothing');
});

test('a billing admin and staff under a grant get renewal dates for an active monthly campaign only', { skip }, async () => {
  for (const who of [ctx.billing, ctx.staff]) {
    const todayBefore = zonedDayStr(new Date(), TZ);
    const r = await call(`/admin/billing-renewals?ids=${idsOf(...all())}`, who);
    const todayAfter = zonedDayStr(new Date(), TZ);
    assert.strictEqual(r.status, 200);
    const rows = byId(r.json);
    const cycle = rows.get(String(ctx.cycle._id));
    const { campaignId, billingRule, ...dates } = cycle;
    assert.strictEqual(billingRule, 'cycle');
    const expected = [reminderDates(ctx.cycleFirstVisitDay, todayBefore), reminderDates(ctx.cycleFirstVisitDay, todayAfter)];
    assert.ok(
      expected.some((e) => JSON.stringify(e) === JSON.stringify(dates)),
      `dates follow reminderDates on the campaign's today: ${JSON.stringify(dates)}`
    );
    assert.ok(dates.nextRenewalDay > todayBefore, 'the next renewal is ahead');
    // Calendar, archived, never-out and desk-only campaigns carry no dates, for anyone.
    for (const c of [ctx.calendar, ctx.archived, ctx.neverOut, ctx.deskOnly]) {
      assert.deepStrictEqual(Object.keys(rows.get(String(c._id))).sort(), ['billingRule', 'campaignId']);
    }
  }
});

test('another organization\'s campaign is left out, not refused', { skip }, async () => {
  const r = await call(`/admin/billing-renewals?ids=${idsOf(ctx.cycle, ctx.foreign)}`, ctx.billing);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.campaigns.map((c) => c.campaignId), [String(ctx.cycle._id)]);
});

test('guards: a malformed id or 51 ids is a 400, no ids is an empty list, no active org is a 400', { skip }, async () => {
  const bad = await call('/admin/billing-renewals?ids=not-an-id', ctx.billing);
  assert.strictEqual(bad.status, 400);
  const many = Array.from({ length: 51 }, () => String(new mongoose.Types.ObjectId())).join(',');
  const tooMany = await call(`/admin/billing-renewals?ids=${many}`, ctx.billing);
  assert.strictEqual(tooMany.status, 400);
  const fifty = Array.from({ length: 50 }, () => String(new mongoose.Types.ObjectId())).join(',');
  const okFifty = await call(`/admin/billing-renewals?ids=${fifty}`, ctx.billing);
  assert.strictEqual(okFifty.status, 200, 'fifty is allowed');
  const none = await call('/admin/billing-renewals', ctx.plain);
  assert.strictEqual(none.status, 200);
  assert.deepStrictEqual(none.json.campaigns, []);
  const repeated = await call(`/admin/billing-renewals?ids=${idsOf(ctx.cycle, ctx.cycle)}`, ctx.plain);
  assert.strictEqual(repeated.json.campaigns.length, 1, 'a repeated id answers once');
  const noOrg = await call(`/admin/billing-renewals?ids=${idsOf(ctx.cycle)}`, ctx.staffNoOrg);
  assert.strictEqual(noOrg.status, 400);
});

test('the billing router itself stays billing-gated beside its sibling', { skip }, async () => {
  const plain = await call('/admin/billing', ctx.plain);
  assert.strictEqual(plain.status, 403);
  assert.strictEqual(plain.json.code, 'billing-access-required');
  const billing = await call('/admin/billing', ctx.billing);
  assert.strictEqual(billing.status, 200);
});
