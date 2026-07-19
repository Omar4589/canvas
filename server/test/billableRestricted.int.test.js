import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Billable restricted doors — the per-campaign / per-org opt-in that lets an org invoice its
// client for doors a canvasser physically walked to and found inaccessible.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/billrestricted_test node --test test/billableRestricted.int.test.js
//
// The invariant this file exists to protect: with the flag OFF, every number is byte-identical
// to the pre-feature behavior; with it ON, ONLY billableDoors moves. Knocks, connection/contact
// rate, homesKnocked, and the coverage funnel are the same in both states, because nobody
// answered a restricted door and it must never enter a rate denominator.
//
// It also covers the separate, FLAG-INDEPENDENT change: a first non-bulk restricted mark starts
// a campaign's billing clock (a walk to a locked gate is still a trip), while a desk-authored
// bulk restrict never does.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-bill-restricted';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { monthlyStatement } = await import('../src/services/billing/statement.js');
const { resolveBillRestricted } = await import('../src/services/reports/billRestricted.js');
const { recomputeCampaignStats } = await import('../src/services/reports/campaignCounters.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// A fixed month so the statement window is deterministic regardless of when this runs.
const KNOCK_AT = new Date('2026-03-10T15:00:00Z');
const MONTH = '2026-03';

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Subscription, Household, CanvassActivity, Effort, Pass]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Bill Org', slug: 'bill-org', isActive: true });
  const admin = await User.create({
    firstName: 'Ada', lastName: 'Admin', email: 'ba@t.co', passwordHash: 'x', isActive: true,
  });
  const lead = await User.create({
    firstName: 'Lee', lastName: 'Lead', email: 'bl@t.co', passwordHash: 'x', isActive: true,
  });
  const c1 = await User.create({
    firstName: 'Cara', lastName: 'One', email: 'c1@t.co', passwordHash: 'x', isActive: true,
  });
  const c2 = await User.create({
    firstName: 'Cal', lastName: 'Two', email: 'c2@t.co', passwordHash: 'x', isActive: true,
  });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Ward 3', type: 'survey', state: 'TX', timeZone: 'America/Chicago',
  });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'Intake' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'R1', status: 'active', activatedAt: KNOCK_AT,
  });

  // Fixture, one round. Doors 1-3 knocked, doors 4-5 restricted in the field, door 6 restricted
  // in BULK (desk work), door 7 restricted by one canvasser AND knocked by another (the dedup
  // case), door 8 restricted then superseded by a real knock (the supersession case).
  const doors = [];
  for (let i = 1; i <= 8; i++) {
    doors.push(await Household.create({
      organizationId: org._id, campaignId: campaign._id,
      addressLine1: `${i} Main St`, city: 'Austin', state: 'TX', zipCode: '78701',
      normalizedAddress: `${i} main st austin tx 78701`,
      status: 'unknocked', isActive: true,
    }));
  }

  const act = (household, userId, actionType, extra = {}) =>
    CanvassActivity.create({
      organizationId: org._id, campaignId: campaign._id, householdId: household._id,
      userId, actionType, passId: pass._id, timestamp: KNOCK_AT,
      location: { lat: 30.26, lng: -97.74 }, ...extra,
    });

  await act(doors[0], c1._id, 'survey_submitted');
  await act(doors[1], c1._id, 'not_home');
  await act(doors[2], c1._id, 'refused');
  await act(doors[3], c1._id, 'restricted');
  await act(doors[4], c1._id, 'restricted');
  await act(doors[5], admin._id, 'restricted', { via: 'bulk' });
  await act(doors[6], c1._id, 'restricted');
  await act(doors[6], c2._id, 'not_home');
  await act(doors[7], c1._id, 'not_home'); // door 8: the restricted mark was superseded

  // Door statuses, so the coverage funnel is realistic.
  await Household.updateOne({ _id: doors[0]._id }, { status: 'surveyed' });
  await Household.updateOne({ _id: doors[1]._id }, { status: 'not_home' });
  await Household.updateOne({ _id: doors[2]._id }, { status: 'refused' });
  await Household.updateOne({ _id: doors[3]._id }, { status: 'restricted' });
  await Household.updateOne({ _id: doors[4]._id }, { status: 'restricted' });
  await Household.updateOne({ _id: doors[5]._id }, { status: 'restricted' });
  await Household.updateOne({ _id: doors[6]._id }, { status: 'not_home' });
  await Household.updateOne({ _id: doors[7]._id }, { status: 'not_home' });

  await recomputeCampaignStats(campaign._id);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, lead, c1, c2, campaign, effort, pass, doors,
    adminTok: signUserToken(admin), leadTok: signUserToken(lead),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { token, orgId, body, raw } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return { status: res.status, text: await res.text() };
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
}

const auth = () => ({ token: ctx.adminTok, orgId: ctx.org._id });

// Set the campaign override and refresh the denormalized counters the way a real flip would
// leave them (it wouldn't — the flag is read-time only, which is itself the point of case 2).
async function setCampaignFlag(value) {
  const r = await call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, {
    ...auth(), body: { billRestrictedDoors: value },
  });
  assert.equal(r.status, 200);
}
async function setOrgFlag(value) {
  const r = await call('PATCH', '/admin/billing/settings', { ...auth(), body: { billRestrictedDoors: value } });
  assert.equal(r.status, 200);
}

// The fixture in words: 5 knocked doors (1,2,3,7,8), 2 field-restricted-only doors (4,5),
// 1 bulk-restricted door (6, never billable).
const EXPECTED_KNOCKS = 5;
const EXPECTED_RESTRICTED_DOORS = 2;

test('flag OFF: billableDoors === knocks, and nothing else moves', { skip }, async () => {
  await setOrgFlag(false);
  await setCampaignFlag(null);

  const kbp = await call('GET', `/admin/reports/knocks-by-pass?campaignId=${ctx.campaign._id}`, auth());
  assert.equal(kbp.status, 200);
  assert.equal(kbp.json.billRestrictedDoors, false);
  assert.equal(kbp.json.totals.knocks, EXPECTED_KNOCKS);
  assert.equal(kbp.json.totals.billableDoors, EXPECTED_KNOCKS, 'billableDoors must equal knocks when off');
  // restrictedDoors reports what EXISTS, not what is billed — the same number in both states, so
  // the UI can offer the opt-in ("you have N restricted doors"). Only billableDoors follows the flag.
  assert.equal(kbp.json.totals.restrictedDoors, EXPECTED_RESTRICTED_DOORS);

  const ov = await call('GET', `/admin/reports/overview?campaignId=${ctx.campaign._id}`, auth());
  assert.equal(ov.json.totals.knocks, EXPECTED_KNOCKS);
  assert.equal(ov.json.totals.billableDoors, EXPECTED_KNOCKS);
  // The two field-restricted doors + the bulk one are all in the coverage funnel, and none of
  // them are "homes knocked".
  assert.equal(ov.json.canvass.restricted, 3);
  assert.equal(ov.json.totals.homesKnocked, EXPECTED_KNOCKS);

  ctx.baseline = {
    connectionRate: ov.json.totals.connectionRate,
    contactRate: ov.json.totals.contactRate,
    homesKnocked: ov.json.totals.homesKnocked,
    canvass: ov.json.canvass,
    knocks: ov.json.totals.knocks,
  };
});

test('flag ON: ONLY billableDoors moves — every rate and the coverage funnel are unchanged', { skip }, async () => {
  await setCampaignFlag(true);

  const ov = await call('GET', `/admin/reports/overview?campaignId=${ctx.campaign._id}`, auth());
  assert.equal(ov.status, 200);
  assert.equal(ov.json.totals.billableDoors, EXPECTED_KNOCKS + EXPECTED_RESTRICTED_DOORS);
  assert.equal(ov.json.totals.restrictedDoors, EXPECTED_RESTRICTED_DOORS);

  // The whole safety property, asserted against the flag-OFF baseline.
  assert.equal(ov.json.totals.knocks, ctx.baseline.knocks, 'knocks must not move');
  assert.equal(ov.json.totals.connectionRate, ctx.baseline.connectionRate, 'connection rate must not move');
  assert.equal(ov.json.totals.contactRate, ctx.baseline.contactRate, 'contact rate must not move');
  assert.equal(ov.json.totals.homesKnocked, ctx.baseline.homesKnocked, 'homesKnocked must not move');
  assert.deepEqual(ov.json.canvass, ctx.baseline.canvass, 'the coverage funnel must not move');
});

test('dedup: a door one canvasser restricted and another knocked is ONE billable door', { skip }, async () => {
  await setCampaignFlag(true);
  const kbp = await call('GET', `/admin/reports/knocks-by-pass?campaignId=${ctx.campaign._id}`, auth());
  // Door 7 has both a restricted and a not_home row. It must be counted once, as a KNOCK —
  // if the dedup leaked it would show up as an extra restricted door.
  assert.equal(kbp.json.totals.restrictedDoors, EXPECTED_RESTRICTED_DOORS, 'door 7 must not be a restricted door');
  assert.equal(kbp.json.totals.billableDoors, EXPECTED_KNOCKS + EXPECTED_RESTRICTED_DOORS);
  assert.equal(
    kbp.json.totals.billableDoors,
    kbp.json.totals.knocks + kbp.json.totals.restrictedDoors,
    'billableDoors must be exactly knocks + restrictedDoors — no double counting'
  );
});

test('supersession: a restricted mark replaced by a real knock counts once, as a knock', { skip }, async () => {
  await setCampaignFlag(true);
  const door = ctx.doors[7];
  // Re-add the restricted row that the real knock replaced, as a DIFFERENT user, to prove the
  // pair-level fold (not row-level) is what decides.
  const extra = await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: door._id,
    userId: ctx.c2._id, actionType: 'restricted', passId: ctx.pass._id, timestamp: KNOCK_AT,
    location: { lat: 30.26, lng: -97.74 },
  });
  const kbp = await call('GET', `/admin/reports/knocks-by-pass?campaignId=${ctx.campaign._id}`, auth());
  assert.equal(kbp.json.totals.knocks, EXPECTED_KNOCKS, 'still a knock');
  assert.equal(kbp.json.totals.restrictedDoors, EXPECTED_RESTRICTED_DOORS, 'a knocked door is never a restricted door');
  assert.equal(kbp.json.totals.billableDoors, EXPECTED_KNOCKS + EXPECTED_RESTRICTED_DOORS);
  await CanvassActivity.deleteOne({ _id: extra._id });
});

test('bulk-restricted doors are never billable and never start billing', { skip }, async () => {
  await setCampaignFlag(true);
  const kbp = await call('GET', `/admin/reports/knocks-by-pass?campaignId=${ctx.campaign._id}`, auth());
  // Door 6 is via:'bulk'. If it leaked in, restrictedDoors would be 3.
  assert.equal(kbp.json.totals.restrictedDoors, EXPECTED_RESTRICTED_DOORS, 'desk-authored bulk marks are not field work');

  // And on the billing clock: a campaign whose ONLY activity is a bulk restrict never starts.
  const bulkOnly = await Campaign.create({
    organizationId: ctx.org._id, name: 'Bulk Only', type: 'survey', state: 'TX', timeZone: 'America/Chicago',
  });
  await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: bulkOnly._id, householdId: ctx.doors[0]._id,
    userId: ctx.admin._id, actionType: 'restricted', passId: null, timestamp: KNOCK_AT,
    location: { lat: 30.26, lng: -97.74 }, via: 'bulk',
  });
  const st = await monthlyStatement(ctx.org._id, MONTH);
  const line = st.lines.find((l) => l.campaignId === String(bulkOnly._id));
  assert.equal(line.billable, false, 'a desk bulk-restrict must not start the billing clock');
  assert.equal(line.firstKnockAt, null);
  assert.equal(line.amountCents, 0);
  await Campaign.deleteOne({ _id: bulkOnly._id });
  await CanvassActivity.deleteMany({ campaignId: bulkOnly._id });
});

test('a bulk row on a KNOCK action is still a billable knock', { skip }, async () => {
  // The bulk exclusion must be scoped to `restricted`. A blanket NOT_BULK also swallows knock
  // rows stamped via:'bulk', which round totals are contractually required to include (only
  // per-canvasser surfaces exclude bulk) — that silently deletes a door from the invoice.
  // knocksByPass.int.test.js encodes the same contract; this asserts it under the new flag too.
  await setCampaignFlag(true);
  const fresh = await Household.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id,
    addressLine1: '99 Bulk Way', city: 'Austin', state: 'TX', zipCode: '78701',
    normalizedAddress: '99 bulk way austin tx 78701', status: 'not_home', isActive: true,
  });
  const bulkKnock = await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: fresh._id,
    userId: ctx.admin._id, actionType: 'not_home', passId: ctx.pass._id, timestamp: KNOCK_AT,
    location: { lat: 30.26, lng: -97.74 }, via: 'bulk',
  });
  const kbp = await call('GET', `/admin/reports/knocks-by-pass?campaignId=${ctx.campaign._id}`, auth());
  assert.equal(kbp.json.totals.knocks, EXPECTED_KNOCKS + 1, 'a bulk KNOCK row is a knock');
  assert.equal(kbp.json.totals.restrictedDoors, EXPECTED_RESTRICTED_DOORS, 'and is not a restricted door');
  assert.equal(kbp.json.totals.billableDoors, EXPECTED_KNOCKS + 1 + EXPECTED_RESTRICTED_DOORS);
  await CanvassActivity.deleteOne({ _id: bulkKnock._id });
  await Household.deleteOne({ _id: fresh._id });
  await setCampaignFlag(null);
});

test('per-round rows reconcile: Σ(rounds.billableDoors) === totals.billableDoors', { skip }, async () => {
  await setCampaignFlag(true);
  const kbp = await call('GET', `/admin/reports/knocks-by-pass?campaignId=${ctx.campaign._id}`, auth());
  const sum = kbp.json.rounds.reduce((s, r) => s + r.billableDoors, 0);
  assert.equal(sum, kbp.json.totals.billableDoors, 'rounds must sum to the headline they break down');
  const sumKnocks = kbp.json.rounds.reduce((s, r) => s + r.knocks, 0);
  assert.equal(sumKnocks, kbp.json.totals.knocks);
});

test('tri-state resolution: campaign override beats the org default in both directions', { skip }, () => {
  assert.equal(resolveBillRestricted({ billRestrictedDoors: null }, { billRestrictedDoors: true }), true, 'null inherits ON');
  assert.equal(resolveBillRestricted({ billRestrictedDoors: null }, { billRestrictedDoors: false }), false, 'null inherits OFF');
  assert.equal(resolveBillRestricted({ billRestrictedDoors: false }, { billRestrictedDoors: true }), false, 'false beats org ON');
  assert.equal(resolveBillRestricted({ billRestrictedDoors: true }, { billRestrictedDoors: false }), true, 'true beats org OFF');
  assert.equal(resolveBillRestricted({}, {}), false, 'absent everywhere = off');
  assert.equal(resolveBillRestricted(null, null), false, 'missing docs must not throw');
});

test('org default is inherited end-to-end when the campaign has no override', { skip }, async () => {
  await setCampaignFlag(null);
  await setOrgFlag(true);
  let kbp = await call('GET', `/admin/reports/knocks-by-pass?campaignId=${ctx.campaign._id}`, auth());
  assert.equal(kbp.json.billRestrictedDoors, true);
  assert.equal(kbp.json.totals.billableDoors, EXPECTED_KNOCKS + EXPECTED_RESTRICTED_DOORS);

  // An explicit campaign `false` must still win over an org default of true.
  await setCampaignFlag(false);
  kbp = await call('GET', `/admin/reports/knocks-by-pass?campaignId=${ctx.campaign._id}`, auth());
  assert.equal(kbp.json.billRestrictedDoors, false);
  assert.equal(kbp.json.totals.billableDoors, EXPECTED_KNOCKS);
  await setOrgFlag(false);
});

test('a first non-bulk restricted mark starts billing — regardless of the flag', { skip }, async () => {
  const fieldOnly = await Campaign.create({
    organizationId: ctx.org._id, name: 'Gated Only', type: 'survey', state: 'TX', timeZone: 'America/Chicago',
  });
  await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: fieldOnly._id, householdId: ctx.doors[0]._id,
    userId: ctx.c1._id, actionType: 'restricted', passId: null, timestamp: KNOCK_AT,
    location: { lat: 30.26, lng: -97.74 },
  });

  // Flag explicitly OFF — the billing clock is deliberately independent of it.
  await Campaign.updateOne({ _id: fieldOnly._id }, { billRestrictedDoors: false });
  await Organization.updateOne({ _id: ctx.org._id }, { billRestrictedDoors: false });

  const st = await monthlyStatement(ctx.org._id, MONTH);
  const line = st.lines.find((l) => l.campaignId === String(fieldOnly._id));
  assert.equal(line.billable, true, 'a walk to a locked gate is still a trip');
  assert.equal(new Date(line.firstKnockAt).toISOString(), KNOCK_AT.toISOString());
  await Campaign.deleteOne({ _id: fieldOnly._id });
  await CanvassActivity.deleteMany({ campaignId: fieldOnly._id });
});

test('price is untouched: amountCents is always the flat rate or zero', { skip }, async () => {
  for (const flag of [true, false]) {
    await Campaign.updateOne({ _id: ctx.campaign._id }, { billRestrictedDoors: flag });
    const st = await monthlyStatement(ctx.org._id, MONTH);
    const line = st.lines.find((l) => l.campaignId === String(ctx.campaign._id));
    assert.equal(line.amountCents, 30000, 'door volume must never multiply the price');
    assert.equal(line.billRestrictedDoors, flag);
    assert.equal(line.knocksThisMonth, EXPECTED_KNOCKS, 'knocks never move');
    // The restricted COUNT is always reported; only the billable figure follows the flag.
    assert.equal(line.restrictedDoorsThisMonth, EXPECTED_RESTRICTED_DOORS);
    assert.equal(
      line.billableDoorsThisMonth,
      flag ? EXPECTED_KNOCKS + EXPECTED_RESTRICTED_DOORS : EXPECTED_KNOCKS
    );
  }
  await Campaign.updateOne({ _id: ctx.campaign._id }, { billRestrictedDoors: null });
});

test('Campaign.stats counters agree with the live pipeline', { skip }, async () => {
  await recomputeCampaignStats(ctx.campaign._id);
  const doc = await Campaign.findById(ctx.campaign._id, { stats: 1 }).lean();
  assert.equal(doc.stats.knockCount, EXPECTED_KNOCKS);
  assert.equal(doc.stats.restrictedDoorCount, EXPECTED_RESTRICTED_DOORS);

  // The counter fast path (/overview with no date window) must produce the same answer the
  // live pipeline does — a drift here is exactly the kind of silent lie the reconcile exists for.
  await setCampaignFlag(true);
  const ov = await call('GET', `/admin/reports/overview?campaignId=${ctx.campaign._id}`, auth());
  assert.equal(ov.json.totals.knocks, EXPECTED_KNOCKS);
  assert.equal(ov.json.totals.billableDoors, EXPECTED_KNOCKS + EXPECTED_RESTRICTED_DOORS);
  await setCampaignFlag(null);
});

test('a team lead cannot change the billable-door policy', { skip }, async () => {
  const r = await call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, {
    token: ctx.leadTok, orgId: ctx.org._id, body: { billRestrictedDoors: true },
  });
  assert.ok(r.status === 403, `expected 403, got ${r.status}`);
});

test('CSV: door columns appear only when the campaign opts in', { skip }, async () => {
  await setCampaignFlag(false);
  let csv = await call('GET', `/admin/reports/knocks-by-pass.csv?campaignId=${ctx.campaign._id}`, { ...auth(), raw: true });
  assert.equal(csv.status, 200);
  assert.ok(!csv.text.includes('Billable doors'), 'an opted-out export must keep its exact shape');

  await setCampaignFlag(true);
  csv = await call('GET', `/admin/reports/knocks-by-pass.csv?campaignId=${ctx.campaign._id}`, { ...auth(), raw: true });
  const header = csv.text.split('\n')[0];
  assert.ok(header.includes('Billable doors'), 'opted-in exports carry the invoice column');
  assert.ok(header.includes('Restricted doors'));
  // The TOTAL row must carry the widened number, not the knock count.
  const total = csv.text.split('\n').find((l) => l.startsWith('TOTAL'));
  assert.ok(
    total.includes(String(EXPECTED_KNOCKS + EXPECTED_RESTRICTED_DOORS)),
    `TOTAL row should carry billable doors: ${total}`
  );
  await setCampaignFlag(null);
});
