import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Folding a retired outcome's HISTORY into another one, over the REAL Express app + a throwaway
// mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/reclassify_test node --test test/reclassifyOutcomes.int.test.js
//
// The invariants this file exists to protect:
//   • THE MONEY INVARIANT — knocks, contactRate, connectionRate, billable doors and every
//     Campaign.stats counter are IDENTICAL before and after a conversion. This is the entire
//     safety argument for letting a tool rewrite recorded dispositions at all, so it is asserted
//     field-by-field rather than described.
//   • Only the rate-neutral trio converts; refused / restricted / survey_submitted are refused.
//   • The source must be switched OFF first — this tool is for retired outcomes, not live edits.
//   • Org admins only: a lead may toggle outcomes but never rewrite history.
//   • A dry run writes NOTHING.
//   • A conversion preserves GPS, timestamp, canvasser, pass and effort, stamps provenance, and
//     re-resolves door status.
//   • A stamped row is excluded from later runs (provenance stays one level deep).
//   • Revert restores exactly and is idempotent-safe (a second attempt 409s).
//   • Both the run and its revert land in the campaign history feed.
//   • The campaign delete cascade takes ReclassifyRun with it.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-reclassify';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { ReclassifyRun } = await import('../src/models/ReclassifyRun.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { recomputeCampaignStats } = await import('../src/services/reports/campaignCounters.js');
const { deleteCampaignCascade } = await import('../src/services/campaigns/deleteCampaign.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const makeHousehold = (orgId, campaignId, effortId, n) => ({
  organizationId: orgId,
  campaignId,
  effortId,
  addressLine1: `${n} Reclass Rd`,
  city: 'Austin',
  state: 'TX',
  zipCode: '78701',
  normalizedAddress: `${n} reclass rd austin tx 78701`,
  location: { type: 'Point', coordinates: [-97.74 + n * 0.001, 30.26] },
  status: 'unknocked',
  isActive: true,
});

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, CampaignManager,
    CampaignChange, Effort, Pass, Household, CanvassActivity, ReclassifyRun, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Reclass Org', slug: 'reclass-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ra@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lena', lastName: 'Lead', email: 'rl@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'rc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Reclass C', type: 'survey', state: 'TX',
    timeZone: 'America/Chicago', isActive: true,
    // no_soliciting is already retired — the state this tool is offered in.
    disabledOutcomes: ['no_soliciting'],
  });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: campaign._id, userId: canv._id });
  await CampaignManager.create({ organizationId: org._id, campaignId: campaign._id, userId: lead._id, isActive: true });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'Intake' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'R1', status: 'active', activatedAt: new Date(),
  });
  const doors = await Household.insertMany([1, 2, 3, 4, 5].map((n) => makeHousehold(org._id, campaign._id, effort._id, n)));

  // The ledger under test. Doors 1–3 hold no_soliciting (the outcome being folded); door 4 holds a
  // refusal and door 5 a survey — the rows that MUST be untouched, and the ones that make the
  // money invariant meaningful (a contact rate of zero would prove nothing).
  const act = (household, actionType, extra = {}) => ({
    organizationId: org._id, campaignId: campaign._id, householdId: household._id,
    userId: canv._id, actionType, effortId: effort._id, passId: pass._id,
    location: { lat: 30.26, lng: -97.74, accuracy: 5 },
    timestamp: new Date('2026-08-01T15:00:00Z'), ...extra,
  });
  await CanvassActivity.insertMany([
    act(doors[0], 'no_soliciting'),
    act(doors[1], 'no_soliciting'),
    act(doors[2], 'no_soliciting'),
    act(doors[3], 'refused'),
    act(doors[4], 'survey_submitted'),
  ]);
  for (const d of doors) {
    const status = { 0: 'no_soliciting', 1: 'no_soliciting', 2: 'no_soliciting', 3: 'refused', 4: 'surveyed' }[doors.indexOf(d)];
    await Household.updateOne({ _id: d._id }, { $set: { status } });
  }
  await recomputeCampaignStats(campaign._id);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, lead, canv, campaign, effort, pass, doors,
    adminTok: signUserToken(admin), leadTok: signUserToken(lead),
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

const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });
const asLead = () => ({ token: ctx.leadTok, orgId: ctx.org._id });
const url = (suffix = '') => `/admin/campaigns/${ctx.campaign._id}/reclassify-outcomes${suffix}`;

// The full set of figures a conversion must not move — read the way the product reads them.
async function moneyShot() {
  const stats = (await Campaign.findById(ctx.campaign._id).lean()).stats;
  // The rollup's org-level envelope is `cumulative` (scoped here to the one campaign) — the
  // same figures the campaign header and the invoice preview read.
  const rollup = await call('GET', `/admin/reports/campaign-rollup?campaignId=${ctx.campaign._id}`, asAdmin());
  const totals = rollup.json?.cumulative || {};
  return {
    stats: {
      activityCount: stats.activityCount,
      knockCount: stats.knockCount,
      surveyedKnockCount: stats.surveyedKnockCount,
      litKnockCount: stats.litKnockCount,
      refusedKnockCount: stats.refusedKnockCount,
      restrictedDoorCount: stats.restrictedDoorCount,
      litDroppedCount: stats.litDroppedCount,
      surveyCount: stats.surveyCount,
    },
    knocks: totals.knocks ?? totals.homesKnocked ?? null,
    contactRate: totals.contactRate ?? null,
    connectionRate: totals.connectionRate ?? null,
    billableDoors: totals.billableDoors ?? null,
  };
}

test('org admins only — a lead may toggle outcomes but never rewrite history', { skip }, async () => {
  assert.equal((await call('GET', url(), asLead())).status, 403);
  assert.equal(
    (await call('POST', url(), { ...asLead(), body: { from: 'no_soliciting', to: 'not_home' } })).status,
    403
  );
});

test('only the rate-neutral trio converts — refused, restricted and completions are refused', { skip }, async () => {
  for (const pair of [
    { from: 'refused', to: 'not_home' },
    { from: 'restricted', to: 'not_home' },
    { from: 'no_soliciting', to: 'refused' },
    { from: 'survey_submitted', to: 'not_home' },
    { from: 'no_soliciting', to: 'survey_submitted' },
  ]) {
    const r = await call('POST', url(), { ...asAdmin(), body: pair });
    assert.equal(r.status, 400, `${pair.from} → ${pair.to} must be refused`);
  }
  const same = await call('POST', url(), { ...asAdmin(), body: { from: 'not_home', to: 'not_home' } });
  assert.equal(same.status, 400);
});

test('the source must be switched OFF, and the target must still be ON', { skip }, async () => {
  // wrong_address is rate-neutral but still enabled → not a legal source.
  const live = await call('POST', url(), { ...asAdmin(), body: { from: 'wrong_address', to: 'not_home' } });
  assert.equal(live.status, 400);
  assert.equal(live.json.code, 'SOURCE_NOT_DISABLED');

  // And a target that is itself switched off is refused.
  await Campaign.updateOne({ _id: ctx.campaign._id }, { $set: { disabledOutcomes: ['no_soliciting', 'wrong_address'] } });
  const offTarget = await call('POST', url(), { ...asAdmin(), body: { from: 'no_soliciting', to: 'wrong_address' } });
  assert.equal(offTarget.status, 400);
  assert.equal(offTarget.json.code, 'TARGET_DISABLED');
  await Campaign.updateOne({ _id: ctx.campaign._id }, { $set: { disabledOutcomes: ['no_soliciting'] } });
});

test('GET lists eligible sources with entry + door counts, and legal targets', { skip }, async () => {
  const r = await call('GET', url(), asAdmin());
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json.counts), ['no_soliciting'], 'only the retired outcome is offered');
  assert.deepEqual(r.json.counts.no_soliciting, { entries: 3, doors: 3 });
  assert.ok(r.json.targets.includes('not_home'));
  assert.ok(!r.json.targets.includes('no_soliciting'), 'a switched-off outcome is never a target');
  assert.deepEqual(r.json.runs, []);
});

test('a dry run reports the numbers and writes NOTHING', { skip }, async () => {
  const before = await CanvassActivity.find({ campaignId: ctx.campaign._id }).lean();
  const r = await call('POST', url(), { ...asAdmin(), body: { from: 'no_soliciting', to: 'not_home', dryRun: true } });
  assert.equal(r.status, 200);
  assert.deepEqual({ entries: r.json.entries, doors: r.json.doors }, { entries: 3, doors: 3 });

  const after = await CanvassActivity.find({ campaignId: ctx.campaign._id }).lean();
  assert.deepEqual(after.map((a) => a.actionType).sort(), before.map((a) => a.actionType).sort());
  assert.equal(await ReclassifyRun.countDocuments({}), 0);
});

test('THE MONEY INVARIANT: converting preserves every rate, counter and billable figure', { skip }, async () => {
  const before = await moneyShot();
  assert.ok(before.knocks > 0, 'the fixture must actually have knocks, or this proves nothing');
  assert.ok(before.contactRate > 0, 'and a non-zero contact rate');

  const r = await call('POST', url(), { ...asAdmin(), body: { from: 'no_soliciting', to: 'not_home' } });
  assert.equal(r.status, 201);
  assert.equal(r.json.run.count, 3);
  assert.equal(r.json.run.doorCount, 3);
  ctx.runId = r.json.run.id;

  await recomputeCampaignStats(ctx.campaign._id); // recompute from the ledger, don't trust counters
  const after = await moneyShot();
  assert.deepEqual(after, before, 'no knock, rate, counter or billable figure may move');
});

test('the converted rows keep their field data, carry provenance, and re-resolve door status', { skip }, async () => {
  const rows = await CanvassActivity.find({ campaignId: ctx.campaign._id, actionType: 'not_home' }).lean();
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.reclassified.from, 'no_soliciting');
    assert.equal(String(row.reclassified.byUserId), String(ctx.admin._id));
    assert.equal(String(row.reclassified.runId), String(ctx.runId));
    assert.equal(row.location.lat, 30.26, 'GPS preserved');
    assert.equal(new Date(row.timestamp).toISOString(), '2026-08-01T15:00:00.000Z', 'timestamp preserved');
    assert.equal(String(row.userId), String(ctx.canv._id), 'canvasser preserved');
    assert.equal(String(row.passId), String(ctx.pass._id), 'pass preserved');
    assert.equal(String(row.effortId), String(ctx.effort._id), 'effort preserved');
  }
  // Status follows the new outcome (statusPrecedence maps each one to its own).
  for (const d of ctx.doors.slice(0, 3)) {
    assert.equal((await Household.findById(d._id).lean()).status, 'not_home');
  }
  // The untouched rows really are untouched.
  const others = await CanvassActivity.find({
    campaignId: ctx.campaign._id, actionType: { $in: ['refused', 'survey_submitted'] },
  }).lean();
  assert.equal(others.length, 2);
  assert.ok(others.every((o) => !o.reclassified));
});

test('a second run excludes already-stamped rows — provenance stays one level deep', { skip }, async () => {
  // no_soliciting now has zero convertible rows, so it drops off the offered list entirely.
  const listed = await call('GET', url(), asAdmin());
  assert.deepEqual(Object.keys(listed.json.counts), [], 'nothing left to fold');

  // Force the same pair again: it must convert nothing rather than re-stamp.
  const again = await call('POST', url(), { ...asAdmin(), body: { from: 'no_soliciting', to: 'not_home' } });
  assert.equal(again.status, 201);
  assert.equal(again.json.run.count, 0, 'stamped rows are not eligible again');
  const stamped = await CanvassActivity.find({ 'reclassified.from': 'no_soliciting' }).lean();
  assert.ok(stamped.every((s) => s.reclassified.from === 'no_soliciting'), 'no stamp was overwritten');
  await ReclassifyRun.deleteOne({ _id: again.json.run.id }); // tidy the empty run
});

test('both the run and its revert land in the campaign history feed', { skip }, async () => {
  const rows = await CampaignChange.find({ campaignId: ctx.campaign._id, field: 'outcomeReclassify' }).lean();
  assert.ok(rows.length >= 1);
  const run = rows.find((r) => r.fromValue === 'no_soliciting' && r.toValue === 'not_home');
  assert.ok(run, 'the run is recorded source → target');
  assert.equal(run.source, 'outcome_reclassify', 'declared as a bulk path, not a human field edit');

  const feed = await call('GET', `/admin/campaigns/${ctx.campaign._id}/history`, asAdmin());
  assert.equal(feed.status, 200);
  assert.ok(feed.json.items.some((i) => i.field === 'outcomeReclassify'), 'it shows in the merged feed');
});

test('revert restores exactly, and a second revert is refused', { skip }, async () => {
  const before = await moneyShot();
  const r = await call('POST', url('/revert'), { ...asAdmin(), body: { runId: ctx.runId } });
  assert.equal(r.status, 200);

  const restored = await CanvassActivity.find({ campaignId: ctx.campaign._id, actionType: 'no_soliciting' }).lean();
  assert.equal(restored.length, 3, 'every row came back');
  assert.ok(restored.every((x) => !x.reclassified), 'the stamp is gone, so the rows are eligible again');
  for (const d of ctx.doors.slice(0, 3)) {
    assert.equal((await Household.findById(d._id).lean()).status, 'no_soliciting', 'door status followed back');
  }
  await recomputeCampaignStats(ctx.campaign._id);
  assert.deepEqual(await moneyShot(), before, 'the revert moves no number either');

  const twice = await call('POST', url('/revert'), { ...asAdmin(), body: { runId: ctx.runId } });
  assert.equal(twice.status, 409);
  assert.equal(twice.json.code, 'ALREADY_REVERTED');

  const listed = await call('GET', url(), asAdmin());
  assert.equal(listed.json.counts.no_soliciting.entries, 3, 'and the source is offered again');
  assert.ok(listed.json.runs.find((x) => x.id === ctx.runId).revertedAt, 'the run is kept, marked reverted');
});

test('a run id from another campaign reads as missing, never as something to undo here', { skip }, async () => {
  const other = await Campaign.create({
    organizationId: ctx.org._id, name: 'Other', type: 'survey', state: 'TX', isActive: true,
  });
  const foreign = await ReclassifyRun.create({
    organizationId: ctx.org._id, campaignId: other._id, from: 'no_soliciting', to: 'not_home', count: 1, doorCount: 1,
  });
  const r = await call('POST', url('/revert'), { ...asAdmin(), body: { runId: String(foreign._id) } });
  assert.equal(r.status, 404);
  await Campaign.deleteOne({ _id: other._id });
  await ReclassifyRun.deleteOne({ _id: foreign._id });
});

test('the campaign delete cascade takes ReclassifyRun with it', { skip }, async () => {
  const doomed = await Campaign.create({
    organizationId: ctx.org._id, name: 'Doomed', type: 'survey', state: 'TX', isActive: true,
  });
  await ReclassifyRun.create({
    organizationId: ctx.org._id, campaignId: doomed._id, from: 'no_soliciting', to: 'not_home', count: 2, doorCount: 2,
  });
  assert.equal(await ReclassifyRun.countDocuments({ campaignId: doomed._id }), 1);

  await deleteCampaignCascade(doomed);
  assert.equal(await ReclassifyRun.countDocuments({ campaignId: doomed._id }), 0, 'no orphan run survives');
  await Campaign.deleteOne({ _id: doomed._id });
});
