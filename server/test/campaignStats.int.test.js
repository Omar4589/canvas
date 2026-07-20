import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Parity harness for the denormalized Campaign.stats counters, over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/campstats_test node --test test/campaignStats.int.test.js
// Every step drives an actual route (mobile knock/survey/restricted, admin survey delete,
// bulk-restrict/unrestrict, re-cut clear-knocks + snapshot restore), asserts ABSOLUTE expected
// numbers, and then asserts the incrementally-maintained stats equal an independent recompute
// from the ledgers (computeCampaignStats — the migration's oracle). Finishes with the corrupt →
// reconcile repair and the unseeded-legacy fallback (no partial bumps; rollup stays exact live).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-campaign-stats';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const {
  computeCampaignStats,
  recomputeCampaignStats,
  bumpCampaignStats,
  reconcileAllCampaignStats,
  CAMPAIGN_STATS_JOB,
} = await import('../src/services/reports/campaignCounters.js');
const { MAINTENANCE_JOBS, REPEATABLE_JOBS } = await import('../src/services/retention/scheduler.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { TurfSnapshot } = await import('../src/models/TurfSnapshot.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

function hh(orgId, campaignId, effortId, n) {
  return {
    organizationId: orgId,
    campaignId,
    effortId,
    addressLine1: `${n} Parity Ln`,
    city: 'Town',
    state: 'FL',
    zipCode: '34741',
    normalizedAddress: `${n} PARITY LN|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.4 + n * 0.001, 28.3] },
    isActive: true,
    status: 'unknocked',
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass, Turf, TurfAssignment, Household, Voter, CanvassActivity, SurveyResponse, SurveyTemplate, TurfSnapshot, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Parity Org', slug: 'parity-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'pa@t.co', passwordHash: 'x', isActive: true });
  const canvA = await User.create({ firstName: 'Al', lastName: 'Walker', email: 'pca@t.co', passwordHash: 'x', isActive: true });
  const canvB = await User.create({ firstName: 'Bea', lastName: 'Walker', email: 'pcb@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canvA._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: canvB._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'P Survey', questions: [], isActive: true });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'Parity C', type: 'survey', state: 'FL', isActive: true,
    surveyTemplateId: template._id,
  });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: canvA._id });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: canvB._id });

  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const pass = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const homes = await Household.insertMany([1, 2, 3, 4].map((n) => hh(org._id, camp._id, effort._id, n)));
  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book P', mode: 'geometric',
    status: 'published', householdIds: homes.map((h) => h._id), doorCount: homes.length,
  });
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: canvA._id });
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: canvB._id });

  const voter = await Voter.create({
    organizationId: org._id, householdId: homes[0]._id, stateVoterId: 'FLP1',
    firstName: 'Vi', lastName: 'Voter', fullName: 'Vi Voter',
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, effort, pass, turf, admin, canvA, canvB, voter,
    d1: homes[0], d2: homes[1], d3: homes[2], d4: homes[3], template,
    adminTok: signUserToken(admin), tokA: signUserToken(canvA), tokB: signUserToken(canvB),
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

const loc = { lat: 28.3001, lng: -81.399, accuracy: 8 };
let minute = 0;
function nextTs() {
  minute += 1;
  return new Date(Date.now() - 3600_000 + minute * 60_000).toISOString();
}

async function storedStats() {
  const c = await Campaign.findById(ctx.camp._id, { stats: 1 }).lean();
  return c.stats;
}

// THE parity assert: the incrementally-maintained counters must equal an independent recompute
// from the ledgers, field for field (canvasserIds as a set).
async function assertParity(label) {
  const stored = await storedStats();
  const fresh = await computeCampaignStats(ctx.camp._id);
  for (const k of ['activityCount', 'knockCount', 'surveyedKnockCount', 'litKnockCount', 'refusedKnockCount', 'litDroppedCount', 'surveyCount']) {
    assert.strictEqual(stored[k] || 0, fresh[k] || 0, `${label}: stats.${k} matches ledger`);
  }
  assert.strictEqual(
    stored.lastActivityAt ? new Date(stored.lastActivityAt).getTime() : null,
    fresh.lastActivityAt ? new Date(fresh.lastActivityAt).getTime() : null,
    `${label}: stats.lastActivityAt matches ledger`
  );
  assert.deepStrictEqual(
    [...new Set((stored.canvasserIds || []).map(String))].sort(),
    [...new Set((fresh.canvasserIds || []).map(String))].sort(),
    `${label}: stats.canvasserIds matches ledger`
  );
  return stored;
}

function knock(token, doorId, kind) {
  return call('POST', `/mobile/households/${doorId}/${kind}`, {
    token,
    orgId: ctx.org._id,
    body: { location: loc, timestamp: nextTs() },
  });
}

function submitSurvey(token) {
  return call('POST', `/mobile/voters/${ctx.voter._id}/survey`, {
    token,
    orgId: ctx.org._id,
    body: { surveyTemplateId: String(ctx.template._id), answers: [], location: loc, timestamp: nextTs() },
  });
}

test('field writes keep stats exact: knock / survey / cross-user replace / restricted', { skip }, async () => {
  // A not-homes d1 → first knock.
  assert.strictEqual((await knock(ctx.tokA, ctx.d1._id, 'not-home')).status, 201);
  let s = await assertParity('A not_home d1');
  assert.deepStrictEqual(
    { a: s.activityCount, k: s.knockCount, sk: s.surveyedKnockCount, rk: s.refusedKnockCount, sv: s.surveyCount, cv: s.canvasserIds.length },
    { a: 1, k: 1, sk: 0, rk: 0, sv: 0, cv: 1 }
  );

  // A surveys the voter at d1 → REPLACES A's not_home (delete+create): activity stays 1,
  // the pair turns surveyed, surveyCount 1.
  assert.strictEqual((await submitSurvey(ctx.tokA)).status, 201);
  s = await assertParity('A survey d1');
  assert.deepStrictEqual(
    { a: s.activityCount, k: s.knockCount, sk: s.surveyedKnockCount, sv: s.surveyCount },
    { a: 1, k: 1, sk: 1, sv: 1 }
  );

  // B refuses d1 → second row on the SAME pair: knocks still 1 (distinct household×pass),
  // refused facet on, two canvassers.
  assert.strictEqual((await knock(ctx.tokB, ctx.d1._id, 'refused')).status, 201);
  s = await assertParity('B refused d1');
  assert.deepStrictEqual(
    { a: s.activityCount, k: s.knockCount, sk: s.surveyedKnockCount, rk: s.refusedKnockCount, cv: s.canvasserIds.length },
    { a: 2, k: 1, sk: 1, rk: 1, cv: 2 }
  );

  // A not-homes d2 → second pair.
  assert.strictEqual((await knock(ctx.tokA, ctx.d2._id, 'not-home')).status, 201);
  s = await assertParity('A not_home d2');
  assert.strictEqual(s.knockCount, 2);
  assert.strictEqual(s.activityCount, 3);

  // A flips d1 back to not_home → A's survey activity AND SurveyResponse deleted; B's refusal
  // keeps the pair knocked, but the surveyed facet drops with the survey row.
  assert.strictEqual((await knock(ctx.tokA, ctx.d1._id, 'not-home')).status, 201);
  s = await assertParity('A flips d1 to not_home');
  assert.deepStrictEqual(
    { a: s.activityCount, k: s.knockCount, sk: s.surveyedKnockCount, rk: s.refusedKnockCount, sv: s.surveyCount },
    { a: 3, k: 2, sk: 0, rk: 1, sv: 0 }
  );

  // Re-survey (for the admin-delete step) — resubmission inserts a fresh response.
  assert.strictEqual((await submitSurvey(ctx.tokA)).status, 201);
  s = await assertParity('A re-survey d1');
  assert.deepStrictEqual({ sk: s.surveyedKnockCount, sv: s.surveyCount }, { sk: 1, sv: 1 });

  // A restricts d2 → A's not_home (the pair's ONLY knock row) is replaced by a non-knock
  // restricted mark: knockCount falls back to 1, activity count is net-zero.
  assert.strictEqual((await knock(ctx.tokA, ctx.d2._id, 'restricted')).status, 201);
  s = await assertParity('A restricted d2');
  assert.deepStrictEqual({ a: s.activityCount, k: s.knockCount }, { a: 3, k: 1 });
});

test('admin survey delete decrements surveyCount only', { skip }, async () => {
  const sr = await SurveyResponse.findOne({ voterId: ctx.voter._id }).lean();
  assert.ok(sr, 'survey response exists from the field test');
  const r = await call('DELETE', `/admin/voters/${ctx.voter._id}/surveys/${sr._id}`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
  });
  assert.strictEqual(r.status, 200);
  const s = await assertParity('admin survey delete');
  // The survey_submitted ACTIVITY row survives, so the surveyed-knock facet stays on.
  assert.deepStrictEqual({ sv: s.surveyCount, sk: s.surveyedKnockCount }, { sv: 0, sk: 1 });
});

test('bulk-restrict + unrestrict recompute stats (activity only, never knocks)', { skip }, async () => {
  const beforeStats = await storedStats();
  const r = await call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/restrict-bulk`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { turfIds: [String(ctx.turf._id)] },
  });
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.marked > 0, 'bulk-restrict marked doors');
  let s = await assertParity('bulk-restrict');
  assert.strictEqual(s.activityCount, beforeStats.activityCount + r.json.marked, 'bulk rows count in activityCount');
  assert.strictEqual(s.knockCount, beforeStats.knockCount, 'bulk rows never move knocks');
  assert.strictEqual(s.canvasserIds.length, beforeStats.canvasserIds.length, 'no phantom admin canvasser');

  const u = await call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/unrestrict-bulk`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { turfIds: [String(ctx.turf._id)] },
  });
  assert.strictEqual(u.status, 200);
  s = await assertParity('unrestrict-bulk');
  assert.strictEqual(s.activityCount, beforeStats.activityCount, 'bulk marks fully unwound');
});

test('rollup all-time reads the stats and matches the ledger', { skip }, async () => {
  const r = await call('GET', '/admin/reports/campaign-rollup?scope=all', {
    token: ctx.adminTok,
    orgId: ctx.org._id,
  });
  assert.strictEqual(r.status, 200);
  const row = r.json.campaigns.find((c) => c.id === String(ctx.camp._id));
  const fresh = await computeCampaignStats(ctx.camp._id);
  assert.strictEqual(row.knocks, fresh.knockCount, 'rollup knocks == ledger');
  assert.strictEqual(row.refusedKnocks, fresh.refusedKnockCount);
  assert.strictEqual(row.activeCanvassers, fresh.canvasserIds.length);
  assert.strictEqual(r.json.cumulative.knocks, fresh.knockCount, 'cumulative sums the stats');
});

test('re-cut clear-knocks zeroes stats; snapshot restore brings them back', { skip }, async () => {
  const preDiscard = await assertParity('pre-discard');
  assert.ok(preDiscard.activityCount > 0, 'there is history to clear');

  const d = await call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/discard`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { passId: String(ctx.pass._id), confirmActive: true, clearKnocks: true },
  });
  assert.strictEqual(d.status, 200);
  let s = await assertParity('discard clear-knocks');
  assert.deepStrictEqual(
    { a: s.activityCount, k: s.knockCount, sv: s.surveyCount, cv: s.canvasserIds.length },
    { a: 0, k: 0, sv: 0, cv: 0 }
  );

  const snap = await TurfSnapshot.findOne({ passId: ctx.pass._id }).sort({ createdAt: -1 }).lean();
  assert.ok(snap?.clearedKnocks, 'discard snapshotted the cleared knocks');
  const rs = await call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/restore-snapshot`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { snapshotId: String(snap._id) },
  });
  assert.strictEqual(rs.status, 200);
  assert.strictEqual(rs.json.restoredKnocks, true);
  s = await assertParity('restore-snapshot');
  assert.strictEqual(s.activityCount, preDiscard.activityCount, 'restore returns the ledger and the stats');
  assert.strictEqual(s.knockCount, preDiscard.knockCount);
  assert.strictEqual(s.surveyCount, preDiscard.surveyCount);
});

test('corrupted stats are repaired by the reconcile (the migration path)', { skip }, async () => {
  await Campaign.updateOne(
    { _id: ctx.camp._id },
    { $set: { 'stats.knockCount': 999, 'stats.surveyCount': 999, 'stats.activityCount': 999, 'stats.canvasserIds': [] } }
  );
  await recomputeCampaignStats(ctx.camp._id);
  await assertParity('after reconcile repair');
});

test('unseeded legacy campaign: bumps no-op, dashboards fall back to exact live counts', { skip }, async () => {
  // Raw insert = a pre-feature campaign doc: no stats subdoc at all.
  const legacyId = new mongoose.Types.ObjectId();
  await Campaign.collection.insertOne({
    _id: legacyId, organizationId: ctx.org._id, name: 'Legacy C', type: 'survey', state: 'FL', isActive: true,
  });
  await CanvassActivity.collection.insertOne({
    organizationId: ctx.org._id, campaignId: legacyId, householdId: new mongoose.Types.ObjectId(),
    userId: ctx.canvA._id, actionType: 'not_home', passId: null, timestamp: new Date(),
  });

  // A delta bump against an unseeded campaign must NOT create a partial counter.
  await bumpCampaignStats(legacyId, { activity: 1, at: new Date(), userId: ctx.canvA._id });
  const raw = await Campaign.collection.findOne({ _id: legacyId });
  assert.ok(!raw.stats?.reconciledAt, 'unseeded campaign stays unseeded (no partial bump)');
  assert.ok(!raw.stats?.activityCount, 'no counter materialized by the bump');

  // The rollup now spans a trusted + an unseeded campaign → whole request falls back to the
  // LIVE pipelines and still reports the legacy campaign's knock.
  const r = await call('GET', '/admin/reports/campaign-rollup?scope=all', {
    token: ctx.adminTok,
    orgId: ctx.org._id,
  });
  assert.strictEqual(r.status, 200);
  const legacyRow = r.json.campaigns.find((c) => c.id === String(legacyId));
  assert.strictEqual(legacyRow.knocks, 1, 'live fallback counts the legacy knock');
  const mainRow = r.json.campaigns.find((c) => c.id === String(ctx.camp._id));
  const fresh = await computeCampaignStats(ctx.camp._id);
  assert.strictEqual(mainRow.knocks, fresh.knockCount, 'live fallback matches the ledger for the seeded campaign too');

  // Seeding it via the reconcile brings it into the stats path.
  await recomputeCampaignStats(legacyId);
  const seeded = await Campaign.collection.findOne({ _id: legacyId });
  assert.strictEqual(seeded.stats.activityCount, 1);
  assert.strictEqual(seeded.stats.knockCount, 1);
  assert.ok(seeded.stats.reconciledAt, 'reconcile stamps the trust marker');
});

// ─────────────────────────────────────────────────────────────────────────────
// The nightly sweep: silent drift is the whole reason it exists
// ─────────────────────────────────────────────────────────────────────────────

test('reconcileAllCampaignStats: detects drift, reports the diff, and repairs on apply', { skip }, async () => {
  // The production symptom this was written for: the campaign Home card read 4,138 knocks / 987
  // survey doors while the live per-round table beneath it read 4,136 / 986. The counter had been
  // double-bumped by the documented same-door write race. Reproduce it directly — corrupt the
  // stored counters and confirm nothing in the product notices until the sweep runs.
  const before = await computeCampaignStats(ctx.camp._id);
  await Campaign.updateOne(
    { _id: ctx.camp._id },
    { $inc: { 'stats.knockCount': 2, 'stats.surveyedKnockCount': 1 } }
  );

  // The drifted counter is served to the dashboard as fact — no error, no warning.
  const drifted = await call('GET', '/admin/reports/campaign-rollup?scope=all', {
    token: ctx.adminTok,
    orgId: ctx.org._id,
  });
  const badRow = drifted.json.campaigns.find((c) => c.id === String(ctx.camp._id));
  assert.strictEqual(badRow.knocks, before.knockCount + 2, 'drift is served silently');

  // Dry run reports it and changes nothing.
  const dry = await reconcileAllCampaignStats({ apply: false });
  const found = dry.details.find((d) => d.campaignId === String(ctx.camp._id));
  assert.ok(found, 'the drifted campaign is reported');
  assert.strictEqual(found.state, 'drifted');
  assert.ok(
    found.diffs.some((s) => s.startsWith('knockCount')),
    `knockCount drift named in the diff (got ${found.diffs.join(', ')})`
  );
  assert.ok(
    found.diffs.some((s) => s.startsWith('surveyedKnockCount')),
    'surveyedKnockCount drift named too'
  );
  const stillBad = await Campaign.findById(ctx.camp._id).lean();
  assert.strictEqual(stillBad.stats.knockCount, before.knockCount + 2, 'dry run wrote nothing');

  // Apply repairs it, and the dashboard agrees with the ledger again.
  const applied = await reconcileAllCampaignStats({ apply: true });
  assert.ok(applied.drifted >= 1, 'apply run counted the drift it repaired');
  const fixed = await Campaign.findById(ctx.camp._id).lean();
  assert.strictEqual(fixed.stats.knockCount, before.knockCount, 'knock counter repaired');
  assert.strictEqual(fixed.stats.surveyedKnockCount, before.surveyedKnockCount, 'survey counter repaired');

  const clean = await reconcileAllCampaignStats({ apply: false });
  assert.strictEqual(
    clean.details.filter((d) => d.campaignId === String(ctx.camp._id)).length,
    0,
    'a repaired campaign no longer reports as drifted'
  );
});

test('reconcileAllCampaignStats: restrictedDoorCount drift is caught too', { skip }, async () => {
  // restrictedDoorCount is a stored counter that the original drift check did NOT compare, so a
  // campaign could drift on it forever and every sweep would report "nothing to do".
  const before = await computeCampaignStats(ctx.camp._id);
  await Campaign.updateOne({ _id: ctx.camp._id }, { $inc: { 'stats.restrictedDoorCount': 3 } });

  const dry = await reconcileAllCampaignStats({ apply: false });
  const found = dry.details.find((d) => d.campaignId === String(ctx.camp._id));
  assert.ok(found, 'restricted-door drift is detected');
  assert.ok(
    found.diffs.some((s) => s.startsWith('restrictedDoorCount')),
    `restrictedDoorCount named in the diff (got ${found.diffs.join(', ')})`
  );

  await reconcileAllCampaignStats({ apply: true });
  const fixed = await Campaign.findById(ctx.camp._id).lean();
  assert.strictEqual(fixed.stats.restrictedDoorCount, before.restrictedDoorCount, 'repaired');
});

test('the campaign-counter reconcile is actually scheduled', { skip: false }, async () => {
  // Same guard as the platform-stats job: the repair is only worth anything if it RUNS. If someone
  // drops it from the schedule, this goes red instead of counters quietly drifting again.
  const job = MAINTENANCE_JOBS.find((j) => j.name === CAMPAIGN_STATS_JOB);
  assert.ok(job, 'the reconcile job is registered in MAINTENANCE_JOBS');
  assert.ok(job.cron && job.label, 'it carries a cron + an operator-readable label');

  // …and it must NOT be in REPEATABLE_JOBS: the /health/retention banner reports on every entry
  // there, so a counter reconcile going quiet must never read "Retention: NOT ENFORCED".
  assert.ok(
    !REPEATABLE_JOBS.some((j) => j.name === CAMPAIGN_STATS_JOB),
    'kept out of the retention list'
  );
});

test('the counter oracle is ORG-SCOPED, so drift it reports is drift a repair can fix', { skip }, async () => {
  // A row with the right campaignId but a FOREIGN organizationId. Every live reader matches on
  // organizationId + campaignId, so this row is invisible to them. The counter oracle used to match
  // on campaignId alone, so it counted the row — the cached Home card read one knock higher than the
  // live per-round table forever, AND the reconcile recomputed the same inflated number and
  // reported "nothing to do". Un-repairable drift, which is worse than drift.
  const before = await computeCampaignStats(ctx.camp._id);
  const orphanId = new mongoose.Types.ObjectId();
  await CanvassActivity.collection.insertOne({
    organizationId: new mongoose.Types.ObjectId(), // some other org
    campaignId: ctx.camp._id,
    householdId: orphanId,
    userId: ctx.canvA._id,
    actionType: 'not_home',
    passId: ctx.pass._id,
    timestamp: new Date(),
  });

  const after = await computeCampaignStats(ctx.camp._id);
  assert.strictEqual(after.knockCount, before.knockCount, 'a foreign-org row does not reach the counter');
  assert.strictEqual(after.activityCount, before.activityCount, 'nor the activity count');

  // And the live reader agrees — which is the whole point: cache and live now answer the SAME
  // question, so any difference between them is real drift the sweep can repair.
  await recomputeCampaignStats(ctx.camp._id);
  const r = await call('GET', '/admin/reports/campaign-rollup?scope=all', {
    token: ctx.adminTok,
    orgId: ctx.org._id,
  });
  const row = r.json.campaigns.find((c) => c.id === String(ctx.camp._id));
  assert.strictEqual(row.knocks, before.knockCount, 'cached card matches the org-scoped ledger');

  await CanvassActivity.deleteOne({ householdId: orphanId });
  await recomputeCampaignStats(ctx.camp._id);
});
