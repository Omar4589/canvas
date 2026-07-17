import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// Platform lifetime marketing counters: capture-before-destroy, internal-org exclusion, and backfill
// idempotency — over a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/ps_test node --test test/platformStats.int.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-ps';

const { Organization } = await import('../src/models/Organization.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { PlatformStats, PLATFORM_METRICS } = await import('../src/models/PlatformStats.js');
const { PlatformDaily } = await import('../src/models/PlatformDaily.js');
const { recomputeLive, recomputeDaily, computeLiveCounts, captureOrgBeforeDelete, captureCampaignBeforeDelete, getPlatformStats, STATS_JOB } = await import('../src/services/platform/platformStats.js');
const { deleteOrganization } = await import('../src/services/platform/deleteOrganization.js');
const { idleZeroDollarOrgs } = await import('../src/services/billing/idleOrgs.js');
// Safe to import (bullmq never connects until registerMaintenanceJobs) — retentionTriggers.int
// does the same.
const { MAINTENANCE_JOBS, REPEATABLE_JOBS, processMaintenanceJob } = await import('../src/services/retention/scheduler.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const MONTH = 30 * 86_400_000;

// Seed an org with `status` and a campaign of `knocks` real knocks + `bulk` bulk-marks (excluded) +
// `surveys` survey responses + `voters` voters. Returns the org.
const LOC = { lat: 38.2, lng: -85.7 };
const oid = () => new mongoose.Types.ObjectId();

async function seedOrg({ slug, status, knocks = 0, bulk = 0, surveys = 0, voters = 0, createdAt = new Date() }) {
  const org = await Organization.create({ name: slug, slug, isActive: true });
  await Organization.collection.updateOne({ _id: org._id }, { $set: { createdAt } }); // timestamps ignore $set on create
  await Subscription.create({ organizationId: org._id, status, statusChangedAt: new Date() });
  const camp = await Campaign.create({ organizationId: org._id, name: `${slug}-camp`, type: 'survey', state: 'KY', isActive: true });
  const hh = await Household.create({
    organizationId: org._id, campaignId: camp._id, addressLine1: '1 A St', city: 'X', state: 'KY',
    zipCode: '40000', normalizedAddress: `${slug}-addr`,
  });
  for (let i = 0; i < voters; i++) {
    await Voter.create({ organizationId: org._id, householdId: hh._id, firstName: 'V', lastName: String(i), fullName: `V ${i}`, stateVoterId: `${slug}-${i}` });
  }
  for (let i = 0; i < knocks; i++) {
    await CanvassActivity.create({ organizationId: org._id, campaignId: camp._id, householdId: hh._id, userId: oid(), actionType: 'not_home', location: LOC, timestamp: new Date() });
  }
  for (let i = 0; i < bulk; i++) {
    await CanvassActivity.create({ organizationId: org._id, campaignId: camp._id, householdId: hh._id, userId: oid(), actionType: 'refused', via: 'bulk', location: LOC, timestamp: new Date() });
  }
  for (let i = 0; i < surveys; i++) {
    await SurveyResponse.create({
      organizationId: org._id, campaignId: camp._id, voterId: oid(), householdId: hh._id, userId: oid(),
      surveyTemplateId: oid(), surveyTemplateVersion: 1, location: LOC, answers: [], submittedAt: new Date(),
    });
  }
  return { org, camp };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
});
after(async () => {
  if (URI) await mongoose.disconnect();
});
beforeEach(async () => {
  if (!URI) return;
  for (const M of [Organization, Subscription, Campaign, Household, Voter, CanvassActivity, SurveyResponse, PlatformStats, PlatformDaily]) {
    await M.deleteMany({});
  }
});

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);
const dayStr = (n) => daysAgo(n).toISOString().slice(0, 10);

test('backfill recomputes LIVE from real rows, excluding bulk marks and internal orgs', { skip }, async () => {
  await seedOrg({ slug: 'real', status: 'active', knocks: 5, bulk: 3, surveys: 2, voters: 4 });
  await seedOrg({ slug: 'demo', status: 'internal', knocks: 9, surveys: 9, voters: 9 }); // must NOT count

  await recomputeLive({ stampBackfill: true });
  const s = await getPlatformStats();
  assert.strictEqual(s.live.organizations, 1, 'only the non-internal org');
  assert.strictEqual(s.live.campaigns, 1);
  assert.strictEqual(s.live.doorsKnocked, 5, 'bulk marks (via:bulk) are excluded from doors knocked');
  assert.strictEqual(s.live.surveyResponses, 2);
  assert.strictEqual(s.live.votersProcessed, 4);
  assert.deepStrictEqual(s.deleted, { organizations: 0, campaigns: 0, doorsKnocked: 0, surveyResponses: 0, votersProcessed: 0 });
});

test('backfill is idempotent — running twice is identical and never touches the deleted bucket', { skip }, async () => {
  await seedOrg({ slug: 'real', status: 'active', knocks: 5, surveys: 2, voters: 4 });
  // Pre-load a deleted bucket to prove backfill leaves it alone.
  await PlatformStats.updateOne({ key: 'singleton' }, { $set: { 'deleted.doorsKnocked': 100 } }, { upsert: true });

  await recomputeLive();
  const first = await getPlatformStats();
  await recomputeLive();
  const second = await getPlatformStats();

  assert.deepStrictEqual(first.live, second.live, 'live is stable across runs');
  assert.strictEqual(second.deleted.doorsKnocked, 100, 'deleted bucket untouched by backfill');
});

test('org deletion CAPTURES counts into the deleted bucket BEFORE destroying rows; total is preserved', { skip }, async () => {
  const { org } = await seedOrg({ slug: 'real', status: 'active', knocks: 7, bulk: 2, surveys: 3, voters: 6 });
  await recomputeLive();
  const before = await getPlatformStats();
  assert.strictEqual(before.total.doorsKnocked, 7);

  await deleteOrganization(org._id);

  const after = await getPlatformStats();
  // The counts moved from live to deleted. Since the rows are now GONE, the deleted bucket could only
  // hold these numbers if capture ran BEFORE the destruction — that is the property under test.
  assert.strictEqual(after.deleted.organizations, 1);
  assert.strictEqual(after.deleted.doorsKnocked, 7, 'captured the real knocks before delete');
  assert.strictEqual(after.deleted.surveyResponses, 3);
  assert.strictEqual(after.deleted.votersProcessed, 6);
  // The lifetime TOTAL survives the deletion unchanged.
  assert.deepStrictEqual(after.total, before.total, 'marketing totals survive org deletion');
  assert.strictEqual(await Organization.countDocuments({ _id: org._id }), 0, 'org really is gone');
});

test('capture is idempotent across a retried deletion — an org is counted exactly once', { skip }, async () => {
  const { org } = await seedOrg({ slug: 'retry', status: 'active', knocks: 4, voters: 3 });
  await recomputeLive();
  const first = await captureOrgBeforeDelete(org._id);
  assert.strictEqual(first.doorsKnocked, 4);
  const s1 = await getPlatformStats();
  // Simulate the retention sweep retrying a partially-failed delete: capture again on the still-present org.
  const second = await captureOrgBeforeDelete(org._id);
  assert.strictEqual(second, null, 'the retry capture is a no-op');
  const s2 = await getPlatformStats();
  assert.deepStrictEqual(s2, s1, 'stats are unchanged on the retry');
  assert.strictEqual(s2.deleted.organizations, 1, 'the org is banked exactly once, not twice');
});

test('campaign capture is idempotent across a retried hard-delete — counted exactly once', { skip }, async () => {
  const { camp } = await seedOrg({ slug: 'cretry', status: 'active', voters: 3 });
  await recomputeLive();
  const first = await captureCampaignBeforeDelete(camp);
  assert.strictEqual(first.campaigns, 1);
  assert.strictEqual(first.votersProcessed, 3);
  const s1 = await getPlatformStats();
  const second = await captureCampaignBeforeDelete(camp);
  assert.strictEqual(second, null, 'the retry capture is a no-op');
  const s2 = await getPlatformStats();
  assert.deepStrictEqual(s2, s1, 'stats unchanged on the retry');
  assert.strictEqual(s2.deleted.campaigns, 1, 'campaign banked exactly once');
});

test('INTERNAL orgs are excluded from capture — deleting Meridian never moves the numbers', { skip }, async () => {
  const { org } = await seedOrg({ slug: 'demo', status: 'internal', knocks: 50, surveys: 50, voters: 50 });
  await recomputeLive();
  const before = await getPlatformStats();

  const captured = await captureOrgBeforeDelete(org._id);
  assert.strictEqual(captured, null, 'internal org capture is a no-op');

  await deleteOrganization(org._id);
  const after = await getPlatformStats();
  assert.deepStrictEqual(after.total, before.total, 'internal activity never enters the marketing numbers');
  assert.strictEqual(after.total.doorsKnocked, 0);
});

test('the nightly reconcile is scheduled OUTSIDE the retention list, and its handler re-syncs live only', { skip }, async () => {
  // Schedule pin (mirrors the retention jobs' own pin): deleting the registration fails a test
  // instead of the drift-corrector going quiet.
  const job = MAINTENANCE_JOBS.find((j) => j.name === STATS_JOB);
  assert.ok(job, 'the reconcile job is registered in MAINTENANCE_JOBS');
  assert.ok(job.cron, 'with a cron');
  // …and it must NOT be in REPEATABLE_JOBS: the retention health banner reports on every entry
  // there (supportAccess.int pins the count) — a stats hiccup must never read "NOT ENFORCED".
  assert.ok(!REPEATABLE_JOBS.some((j) => j.name === STATS_JOB), 'kept out of the retention list');

  // Handler through the real dispatcher: drifted live gets re-synced from rows; the deleted bank
  // is never recomputed; backfilledAt (the "last reconciled" line) is stamped.
  await seedOrg({ slug: 'real', status: 'active', knocks: 5, bulk: 3, surveys: 2, voters: 4 });
  await PlatformStats.updateOne(
    { key: 'singleton' },
    { $set: { 'live.doorsKnocked': 999, 'deleted.doorsKnocked': 100 } },
    { upsert: true }
  );

  await processMaintenanceJob({ name: STATS_JOB });

  const s = await getPlatformStats();
  assert.strictEqual(s.live.doorsKnocked, 5, 'live re-synced from real rows (bulk excluded)');
  assert.strictEqual(s.deleted.doorsKnocked, 100, 'deleted bank untouched');
  assert.ok(s.backfilledAt, 'backfilledAt stamped — the Control Room "last reconciled" line');
  // Batch 3: the same job now also rebuilds the daily trend series from the same rows.
  assert.ok(await PlatformDaily.countDocuments({}) > 0, 'the nightly job rebuilds the daily series too');
});

// ── Batch 3: the per-day trend series and its reconciliation invariant. ──

test('THE TREND INVARIANT: Σ(daily series) + undated === live, per metric, exactly', { skip }, async () => {
  // Knocks spread over three known UTC days, plus the two exclusions that must not leak into the
  // series any more than they leak into the live bucket: bulk marks and internal-org activity.
  const { org, camp } = await seedOrg({ slug: 'real', status: 'active', surveys: 0, voters: 3 });
  const hh = await Household.findOne({ organizationId: org._id });
  for (const [n, count] of [[3, 2], [2, 1], [1, 4]]) {
    for (let i = 0; i < count; i++) {
      await CanvassActivity.create({
        organizationId: org._id, campaignId: camp._id, householdId: hh._id, userId: oid(),
        actionType: 'not_home', location: LOC, timestamp: daysAgo(n),
      });
    }
  }
  await CanvassActivity.create({
    organizationId: org._id, campaignId: camp._id, householdId: hh._id, userId: oid(),
    actionType: 'refused', via: 'bulk', location: LOC, timestamp: daysAgo(2),
  });
  await SurveyResponse.create({
    organizationId: org._id, campaignId: camp._id, voterId: oid(), householdId: hh._id, userId: oid(),
    surveyTemplateId: oid(), surveyTemplateVersion: 1, location: LOC, answers: [], submittedAt: daysAgo(2),
  });
  await seedOrg({ slug: 'demo', status: 'internal', knocks: 9, surveys: 9, voters: 9 }); // must NOT appear

  await recomputeLive();
  const { undated } = await recomputeDaily();

  // Exact day buckets, exclusions applied.
  const rows = await PlatformDaily.find({}).lean();
  const byDay = new Map(rows.map((r) => [r.day, r]));
  assert.strictEqual(byDay.get(dayStr(3))?.doorsKnocked, 2);
  assert.strictEqual(byDay.get(dayStr(2))?.doorsKnocked, 1, 'the bulk mark on day-2 is NOT in the series');
  assert.strictEqual(byDay.get(dayStr(1))?.doorsKnocked, 4);
  assert.strictEqual(byDay.get(dayStr(2))?.surveyResponses, 1);

  // The invariant itself — the chart is PROVABLE against the number it sits under.
  const live = await computeLiveCounts();
  for (const m of PLATFORM_METRICS) {
    const sum = rows.reduce((s, r) => s + (r[m] || 0), 0);
    assert.strictEqual(sum + undated[m], live[m], `Σ(series.${m}) + undated.${m} === live.${m}`);
  }

  // Idempotent: run again, identical rows.
  const before = JSON.stringify(rows.map((r) => ({ day: r.day, d: r.doorsKnocked })).sort((a, b) => (a.day < b.day ? -1 : 1)));
  await recomputeDaily();
  const again = await PlatformDaily.find({}).lean();
  const after = JSON.stringify(again.map((r) => ({ day: r.day, d: r.doorsKnocked })).sort((a, b) => (a.day < b.day ? -1 : 1)));
  assert.strictEqual(after, before, 'recomputeDaily is idempotent');
});

test('a dateless row lands in `undated` — measured independently, never silently dropped', { skip }, async () => {
  await seedOrg({ slug: 'real', status: 'active', voters: 1 });
  // A pre-`timestamps: true` row: raw insert bypasses Mongoose, so NO createdAt exists. It counts
  // toward live (countDocuments) but no day bucket can hold it.
  await Organization.collection.insertOne({ name: 'Ancient Org', slug: 'ancient', isActive: true });

  await recomputeLive();
  const { undated } = await recomputeDaily();
  assert.strictEqual(undated.organizations, 1, 'the dateless org is counted, not lost');

  const live = await computeLiveCounts();
  const rows = await PlatformDaily.find({}).lean();
  const sum = rows.reduce((s, r) => s + (r.organizations || 0), 0);
  assert.strictEqual(sum + undated.organizations, live.organizations, 'the three-way identity still holds');
  const stats = await getPlatformStats();
  assert.strictEqual(stats.undated.organizations, 1, 'and it is stamped on the singleton for the UI');
});

test('history shrinks retroactively when rows vanish — full-replacement semantics', { skip }, async () => {
  const { org } = await seedOrg({ slug: 'doomed', status: 'active', knocks: 3, voters: 2 });
  await recomputeDaily();
  assert.ok((await PlatformDaily.find({}).lean()).some((r) => r.doorsKnocked > 0), 'series has the knocks');

  // Hard-delete destroys the rows; the next recompute must drop their bars (the deleted bank —
  // tested elsewhere — preserves the lifetime total).
  await deleteOrganization(org._id);
  await recomputeDaily();
  const rows = await PlatformDaily.find({}).lean();
  assert.ok(!rows.some((r) => r.doorsKnocked > 0), 'the deleted org’s bars are gone from the series');
});

test('idle-org watch surfaces an abandoned $0 active org, and only that one', { skip }, async () => {
  const old = new Date(Date.now() - 10 * MONTH);
  // Zombie: active, aged, and its only campaign is archived (→ zero non-archived campaigns), no activity.
  const { org: zombie, camp } = await seedOrg({ slug: 'zombie', status: 'active', createdAt: old });
  await Campaign.updateOne({ _id: camp._id }, { $set: { isActive: false, archivedAt: new Date() } });
  // Not a zombie: active WITH a live campaign.
  await seedOrg({ slug: 'busy', status: 'active', createdAt: old, knocks: 1 });
  // Not a zombie: internal, even though $0/idle.
  const { camp: dCamp } = await seedOrg({ slug: 'demo', status: 'internal', createdAt: old });
  await Campaign.updateOne({ _id: dCamp._id }, { $set: { isActive: false, archivedAt: new Date() } });
  // Not a zombie: brand new active org with no campaigns yet (still in setup).
  await seedOrg({ slug: 'newbie', status: 'active', createdAt: new Date() });
  await Campaign.deleteMany({ organizationId: (await Organization.findOne({ slug: 'newbie' }))._id });

  const { orgs } = await idleZeroDollarOrgs({ months: 6 });
  const slugs = orgs.map((o) => o.slug);
  assert.deepStrictEqual(slugs, ['zombie'], 'only the abandoned $0 active org is surfaced');
  assert.strictEqual(String(orgs[0].organizationId), String(zombie._id));
});
