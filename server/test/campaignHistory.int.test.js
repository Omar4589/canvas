import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Campaign change history — the audit trail behind GET /admin/campaigns/:id/history:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/camphistory_test node --test test/campaignHistory.int.test.js
// Proves: a PATCH writes one row per field that actually MOVED (and nothing for a no-op),
// unaudited fields are never logged, a lead's own edits are recorded with them as the actor,
// CoordinatorChange rows are folded into the same feed, the feed is gated exactly like the PATCH
// that writes it, and a deleted campaign takes its history with it.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-campaign-history';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { CoordinatorChange } = await import('../src/models/CoordinatorChange.js');
const { Subscription } = await import('../src/models/Subscription.js');
// Imported up here with the rest: no `await import` may sit between test() definitions.
const { deleteCampaignCascade } = await import('../src/services/campaigns/deleteCampaign.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, CampaignManager, Campaign, CampaignChange, CoordinatorChange, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Hist Org', slug: 'hist-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ha@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'hl@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cara', lastName: 'Canv', email: 'hc@t.co', passwordHash: 'x', isActive: true });
  const boss = await User.create({ firstName: 'Bo', lastName: 'Boss', email: 'hb@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Tracked', type: 'survey', state: 'TX',
    timeZone: 'America/Chicago', createdBy: admin._id,
  });
  await CampaignManager.create({ organizationId: org._id, campaignId: campaign._id, userId: lead._id, isActive: true });

  // An UNMANAGED campaign, for the lead-403 case.
  const other = await Campaign.create({
    organizationId: org._id, name: 'Not Theirs', type: 'lit_drop', state: 'TX', createdBy: admin._id,
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, lead, canv, boss, campaign, other,
    adminTok: signUserToken(admin),
    leadTok: signUserToken(lead),
  });
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
    /* empty */
  }
  return { status: res.status, json };
}

const auth = () => ({ token: ctx.adminTok, orgId: ctx.org._id });
const leadAuth = () => ({ token: ctx.leadTok, orgId: ctx.org._id });
const patch = (body, who = auth()) => call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, { ...who, body });
const history = async (who = auth(), id = ctx.campaign._id) => {
  const r = await call('GET', `/admin/campaigns/${id}/history`, who);
  return r;
};
const fieldRow = (items, field) => items.find((i) => i.kind === 'config' && i.field === field);

test('setting a door goal records one row per field that moved', { skip }, async () => {
  const r = await patch({ doorGoal: 10000, goalDate: '2026-10-28' });
  assert.strictEqual(r.status, 200);

  const h = await history();
  assert.strictEqual(h.status, 200);
  const goal = fieldRow(h.json.items, 'doorGoal');
  assert.ok(goal, 'the goal change is recorded');
  assert.strictEqual(goal.fromValue, null, 'from null — there was no goal');
  assert.strictEqual(goal.toValue, 10000);
  assert.strictEqual(goal.by.name, 'Ada Admin');
  assert.strictEqual(goal.by.status, 'active');
  assert.ok(fieldRow(h.json.items, 'goalDate'), 'and the date is its own row');
  assert.strictEqual(h.json.items.length, 2, 'exactly two fields moved, so exactly two rows');
});

test('the feed is anchored by the campaign\'s creation', { skip }, async () => {
  const h = await history();
  assert.strictEqual(h.json.createdBy.name, 'Ada Admin');
  assert.ok(h.json.createdAt, 'the creation instant anchors the bottom of the feed');
  assert.strictEqual(h.json.truncated, false);
});

test('a no-op PATCH writes nothing', { skip }, async () => {
  const before = await CampaignChange.countDocuments({ campaignId: ctx.campaign._id });
  // Same values it already holds, plus a field that is genuinely unchanged.
  const r = await patch({ doorGoal: 10000, goalDate: '2026-10-28', name: 'Tracked' });
  assert.strictEqual(r.status, 200);
  const after = await CampaignChange.countDocuments({ campaignId: ctx.campaign._id });
  assert.strictEqual(after, before, 'resubmitting identical values is not a change');
});

test('unaudited fields are never logged', { skip }, async () => {
  const before = await CampaignChange.countDocuments({ campaignId: ctx.campaign._id });
  const r = await patch({ timeZone: 'America/Denver' });
  assert.strictEqual(r.status, 200);
  const after = await CampaignChange.countDocuments({ campaignId: ctx.campaign._id });
  assert.strictEqual(after, before, 'timeZone is deliberately out of AUDITED_FIELDS');
});

test('a LEAD lowering the goal is recorded against them', { skip }, async () => {
  const r = await patch({ doorGoal: 6000 }, leadAuth());
  assert.strictEqual(r.status, 200, 'a lead may set their own campaign\'s goal');

  const h = await history();
  const goal = fieldRow(h.json.items, 'doorGoal');
  assert.strictEqual(goal.fromValue, 10000);
  assert.strictEqual(goal.toValue, 6000);
  assert.strictEqual(goal.by.name, 'Lee Lead', 'the actor is the lead, not the campaign owner');
  // This is the whole reason the feature exists: a contracted number moved and the record says who.
  assert.ok(new Date(goal.at) > new Date(h.json.createdAt));
});

test('clearing a value records null, and the billing policy is audited', { skip }, async () => {
  await patch({ billRestrictedDoors: true });
  await patch({ billRestrictedDoors: null });
  const h = await history();
  const rows = h.json.items.filter((i) => i.field === 'billRestrictedDoors');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].fromValue, true, 'newest first: the clear');
  assert.strictEqual(rows[0].toValue, null, 'null means "inherit the org default", a real value');
  assert.strictEqual(rows[1].toValue, true);
});

test('archiving is audited (it stops the billing clock)', { skip }, async () => {
  await patch({ isActive: false });
  await patch({ isActive: true });
  const h = await history();
  const rows = h.json.items.filter((i) => i.field === 'isActive');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].toValue, true, 'newest first: the reactivate');
  assert.strictEqual(rows[1].toValue, false);
});

test('CoordinatorChange rows are folded into the same feed', { skip }, async () => {
  await CoordinatorChange.create({
    organizationId: ctx.org._id,
    campaignId: ctx.campaign._id,
    userId: ctx.canv._id,
    fromCoordinatorId: null,
    toCoordinatorId: ctx.boss._id,
    byUserId: ctx.admin._id,
    source: 'admin_users',
    activitiesMoved: 3907,
    surveysMoved: 12,
  });

  const h = await history();
  const team = h.json.items.find((i) => i.kind === 'team');
  assert.ok(team, 'the team move appears in the campaign feed');
  assert.strictEqual(team.user.name, 'Cara Canv');
  assert.strictEqual(team.fromCoordinator, null, 'null coordinator stays null, not a fake name');
  assert.strictEqual(team.toCoordinator.name, 'Bo Boss');
  assert.strictEqual(team.activitiesMoved, 3907, 'the doors-moved count is what explains a team jump');
  assert.strictEqual(team.by.name, 'Ada Admin');
});

test('an org-wide legacy CoordinatorChange (no campaignId) is NOT swept in', { skip }, async () => {
  await CoordinatorChange.create({
    organizationId: ctx.org._id,
    campaignId: null, // predates per-campaign crews
    userId: ctx.canv._id,
    toCoordinatorId: ctx.boss._id,
    byUserId: ctx.admin._id,
    source: 'admin_users',
  });
  const h = await history();
  const teamRows = h.json.items.filter((i) => i.kind === 'team');
  assert.strictEqual(teamRows.length, 1, 'guessing which campaign a legacy row belonged to would invent history');
});

test('the feed sorts strictly newest-first across BOTH sources', { skip }, async () => {
  const h = await history();
  const times = h.json.items.map((i) => new Date(i.at).getTime());
  const sorted = [...times].sort((a, b) => b - a);
  assert.deepStrictEqual(times, sorted);
});

test('the feed is gated exactly like the PATCH that writes it', { skip }, async () => {
  const mine = await history(leadAuth());
  assert.strictEqual(mine.status, 200, 'a lead reads the history of a campaign they manage');
  assert.ok(mine.json.items.length > 0);

  const theirs = await history(leadAuth(), ctx.other._id);
  assert.strictEqual(theirs.status, 403, 'and of no other');

  const missing = await history(auth(), new mongoose.Types.ObjectId());
  assert.strictEqual(missing.status, 404);
});

test('deleting the campaign takes its history with it', { skip }, async () => {
  const doomed = await Campaign.create({
    organizationId: ctx.org._id, name: 'Doomed', type: 'lit_drop', state: 'TX', createdBy: ctx.admin._id,
  });
  await call('PATCH', `/admin/campaigns/${doomed._id}`, { ...auth(), body: { doorGoal: 500 } });
  assert.strictEqual(await CampaignChange.countDocuments({ campaignId: doomed._id }), 1);

  await deleteCampaignCascade(doomed);
  assert.strictEqual(
    await CampaignChange.countDocuments({ campaignId: doomed._id }),
    0,
    'CampaignChange must be in CAMPAIGN_SCOPED — an orphaned audit row outlives what it describes'
  );
});
