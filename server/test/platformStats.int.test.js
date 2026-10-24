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
const { deleteCampaignCascade } = await import('../src/services/campaigns/deleteCampaign.js');
const { sweepIfDeleting } = await import('../src/services/platform/lateWriteSweep.js');
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
    await Voter.create({ organizationId: org._id, campaignId: camp._id, householdId: hh._id, firstName: 'V', lastName: String(i), fullName: `V ${i}`, stateVoterId: `${slug}-${i}` });
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

// A further never-walked (so deletable) campaign in `org`, one voter per state voter id given.
const seedCampaign = async (org, name, svids) => {
  const camp = await Campaign.create({ organizationId: org._id, name, type: 'survey', state: 'KY', isActive: true });
  const hh = await Household.create({
    organizationId: org._id, campaignId: camp._id, addressLine1: '2 B St', city: 'X', state: 'KY',
    zipCode: '40000', normalizedAddress: `${name}-addr`,
  });
  for (const svid of svids) {
    await Voter.create({ organizationId: org._id, campaignId: camp._id, householdId: hh._id, firstName: 'W', lastName: svid, fullName: `W ${svid}`, stateVoterId: svid });
  }
  return camp;
};

// Where a campaign delete job is left when its cascade stops right after the capture: stamped, banked,
// failed — its rows still on file until someone presses Retry.
const bankThenStop = async (camp) => {
  await Campaign.updateOne({ _id: camp._id }, { $set: { 'deletion.requestedAt': new Date(), 'deletion.status': 'running' } });
  const captured = await captureCampaignBeforeDelete(await Campaign.findById(camp._id));
  await Campaign.updateOne({ _id: camp._id }, { $set: { 'deletion.status': 'failed' } });
  return captured;
};

const totals = async () => (await getPlatformStats()).total;

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

// ── Deletes that stop partway, or overlap: every row and every person banked exactly once, never lost. ──

// Holds the first call of `Model.method` until `release()` — a capture parked mid-count while
// something else runs. `entered` resolves once it is parked.
const parkFirstCall = (t, Model, method) => {
  const real = Model[method].bind(Model);
  let entered;
  let release;
  const parked = new Promise((r) => { entered = r; });
  const gate = new Promise((r) => { release = r; });
  let held = false;
  t.mock.method(Model, method, (...args) => {
    if (held) return real(...args);
    held = true;
    entered();
    return gate.then(() => real(...args));
  });
  return { parked, release };
};

test('a capture that dies while counting banks nothing — the retry banks the org, it is never lost', { skip }, async (t) => {
  await seedOrg({ slug: 'keep', status: 'active', knocks: 7, voters: 2 });
  const { org } = await seedOrg({ slug: 'gone', status: 'active', knocks: 10, surveys: 3, voters: 5 });
  await recomputeLive();
  const before = await totals();

  // Attempt 1 dies inside the count — a database blip, or the worker killed on a deploy mid-aggregation.
  const boom = t.mock.method(CanvassActivity, 'countDocuments', () => { throw new Error('mongo hiccup'); });
  await assert.rejects(() => deleteOrganization(org._id), /mongo hiccup/);
  boom.mock.restore();
  assert.strictEqual((await Organization.findById(org._id).lean()).platformStatsCaptured, false, 'no mark without a bank');
  assert.deepStrictEqual((await PlatformStats.findOne({ key: 'singleton' }).lean()).bank.orgs, [], 'and nothing in the ledger');
  assert.deepStrictEqual(await totals(), before);

  // The queue's retry runs the whole cascade.
  await deleteOrganization(org._id);
  const s = await getPlatformStats();
  assert.strictEqual(s.deleted.organizations, 1, 'banked on the retry');
  assert.strictEqual(s.deleted.doorsKnocked, 10);
  assert.strictEqual(s.deleted.surveyResponses, 3);
  assert.strictEqual(s.deleted.votersProcessed, 5);
  assert.deepStrictEqual(s.total, before, 'the lifetime totals survive the failed attempt');
  await recomputeLive();
  assert.deepStrictEqual(await totals(), before, 'and the next reconcile agrees');
});

test('a bank write that fails banks nothing — the retry banks the org once', { skip }, async (t) => {
  await seedOrg({ slug: 'keep', status: 'active', knocks: 2, voters: 1 });
  const { org } = await seedOrg({ slug: 'gone', status: 'active', knocks: 4, voters: 2 });
  await recomputeLive();
  const before = await totals();

  // The write that moves the counts fails (a database blip) — it is the claim too, so nothing is claimed.
  const real = PlatformStats.updateOne.bind(PlatformStats);
  const blip = t.mock.method(PlatformStats, 'updateOne', (filter, update, ...rest) =>
    Array.isArray(update) ? Promise.reject(new Error('blip on the bank')) : real(filter, update, ...rest)
  );
  await assert.rejects(() => deleteOrganization(org._id), /blip on the bank/);
  blip.mock.restore();
  assert.strictEqual((await Organization.findById(org._id).lean()).platformStatsCaptured, false);

  await deleteOrganization(org._id); // the queue's retry
  const s = await getPlatformStats();
  assert.strictEqual(s.deleted.organizations, 1, 'banked once, on the retry');
  assert.deepStrictEqual(s.total, before);
  await recomputeLive();
  assert.deepStrictEqual(await totals(), before);
});

test('a crash between the bank and its mark never banks twice, and no reconcile counts it twice', { skip }, async (t) => {
  await seedOrg({ slug: 'keep', status: 'active', knocks: 2, voters: 1 });
  const { org } = await seedOrg({ slug: 'gone', status: 'active', knocks: 4, voters: 2 });
  await recomputeLive();
  const before = await totals();

  // The bank lands; the worker dies before the org's mark (platformStatsCaptured) goes on.
  const real = Organization.updateOne.bind(Organization);
  const boom = t.mock.method(Organization, 'updateOne', (filter, update, ...rest) =>
    update?.$set?.platformStatsCaptured ? Promise.reject(new Error('worker killed')) : real(filter, update, ...rest)
  );
  await assert.rejects(() => deleteOrganization(org._id), /worker killed/);
  boom.mock.restore();
  assert.strictEqual((await getPlatformStats()).deleted.organizations, 1, 'the bank landed');
  await recomputeLive();
  assert.deepStrictEqual(await totals(), before, 'the ledger keeps the banked org out of live without its mark');

  await deleteOrganization(org._id); // the retry reads the ledger: banked already
  const s = await getPlatformStats();
  assert.strictEqual(s.deleted.organizations, 1, 'still banked once');
  assert.deepStrictEqual(s.total, before);
});

test('a delete still in the queue, or stopped before its capture, keeps its org in the totals', { skip }, async () => {
  await seedOrg({ slug: 'keep', status: 'active', knocks: 7, voters: 2 });
  const { org } = await seedOrg({ slug: 'gone', status: 'active', knocks: 10, surveys: 3, voters: 5 });
  await recomputeLive();
  const before = await totals();

  // Stamped and queued (what every delete path does first), and the reconcile — nightly or Reconcile
  // now — lands before the worker picks it up.
  await Organization.updateOne({ _id: org._id }, { $set: { 'deletion.requestedAt': new Date(), 'deletion.status': 'pending' } });
  await recomputeLive();
  assert.deepStrictEqual(await totals(), before, 'a queued delete has banked nothing, so it still counts');

  // The job expired unclaimed (worker off): failed, nothing banked, every row intact.
  await Organization.updateOne({ _id: org._id }, { $set: { 'deletion.status': 'failed' } });
  await recomputeLive();
  assert.deepStrictEqual(await totals(), before, 'and so does a delete that failed before its capture');

  await deleteOrganization(org._id); // Retry runs the cascade
  assert.deepStrictEqual(await totals(), before, 'the delete moves the org into the bank, subtracting it once');
  await recomputeLive();
  assert.deepStrictEqual(await totals(), before, 'and the next reconcile agrees');
});

test('a campaign delete that stops after banking is counted once — by the reconcile, the trend and a later org delete', { skip }, async () => {
  const { org } = await seedOrg({ slug: 'real', status: 'active', knocks: 3, voters: 2 });
  const doomed = await seedCampaign(org, 'doomed', ['only-1', 'only-2', 'only-3']);
  await recomputeLive();
  const before = await totals();
  assert.strictEqual(before.campaigns, 2);
  assert.strictEqual(before.votersProcessed, 5);

  const captured = await bankThenStop(doomed);
  assert.strictEqual(captured.votersProcessed, 3);
  assert.deepStrictEqual(await totals(), before, 'the capture moves the counts, it does not add them');

  // Every nightly reconcile until someone presses Retry: the banked rows are still on file, not live.
  await recomputeLive();
  assert.deepStrictEqual(await totals(), before, 'banked rows are never counted in live as well');

  // The trend reads the same filter, so its invariant holds with the banked rows still on file.
  const { undated } = await recomputeDaily();
  const live = await computeLiveCounts();
  const rows = await PlatformDaily.find({}).lean();
  for (const m of PLATFORM_METRICS) {
    const sum = rows.reduce((s, r) => s + (r[m] || 0), 0);
    assert.strictEqual(sum + undated[m], live[m], `Σ(series.${m}) + undated.${m} === live.${m}`);
  }

  // The whole org is deleted before anyone retries: its capture skips the campaign that banked itself.
  await deleteOrganization(org._id);
  const s = await getPlatformStats();
  assert.deepStrictEqual(s.total, before, 'the org delete does not bank the campaign a second time');
  assert.strictEqual(s.deleted.campaigns, 2);
  assert.strictEqual(s.deleted.votersProcessed, 5);
  await recomputeLive();
  assert.deepStrictEqual(await totals(), before);
});

test('a campaign capture still counting when its org is captured stands down — the org banks it once', { skip }, async (t) => {
  await seedOrg({ slug: 'other', status: 'active', knocks: 2, voters: 1 });
  const { org } = await seedOrg({ slug: 'real', status: 'active', knocks: 4, voters: 2 });
  const doomed = await seedCampaign(org, 'doomed', ['d-1', 'd-2', 'd-3']);
  await recomputeLive();
  const before = await totals();

  // The campaign's delete job passed its processor's org check before the org was stamped; its
  // capture is parked mid-count while the org's capture runs start to finish.
  const { parked, release } = parkFirstCall(t, SurveyResponse, 'countDocuments');
  const campaignCapture = bankThenStop(doomed);
  await parked;
  const o = await captureOrgBeforeDelete(org._id);
  assert.strictEqual(o.campaigns, 2, 'the org counts the still-unbanked campaign in');
  release();
  assert.strictEqual(await campaignCapture, null, 'the campaign finds its org banked and stands down');
  t.mock.restoreAll();

  await deleteOrganization(org._id);
  await recomputeLive();
  const s = await getPlatformStats();
  assert.deepStrictEqual(s.total, before, 'banked once — by the org');
  assert.strictEqual(s.deleted.campaigns, 2);
  assert.strictEqual(s.deleted.votersProcessed, 5);
});

test('a campaign that banks while its org is counted is left out of the org’s bank', { skip }, async (t) => {
  const { org } = await seedOrg({ slug: 'real', status: 'active', knocks: 3, voters: 2 });
  const doomed = await seedCampaign(org, 'doomed', ['d-1', 'd-2', 'd-3']);
  await recomputeLive();
  const before = await totals();

  // The org's capture is parked mid-count while the campaign's own delete banks it.
  const { parked, release } = parkFirstCall(t, SurveyResponse, 'countDocuments');
  const orgCapture = captureOrgBeforeDelete(org._id);
  await parked;
  assert.strictEqual((await bankThenStop(doomed)).votersProcessed, 3, 'the campaign banks its own people');
  release();
  const o = await orgCapture;
  t.mock.restoreAll();
  assert.strictEqual(o.campaigns, 1, 'the org counted again, without the campaign that banked meanwhile');
  assert.strictEqual(o.votersProcessed, 2);
  const s = await getPlatformStats();
  assert.deepStrictEqual(s.total, before);
  assert.strictEqual(s.deleted.campaigns, 2);
  assert.strictEqual(s.deleted.votersProcessed, 5);
});

test('a person whose only rows are in two deleted campaigns is banked once, by the last capture', { skip }, async () => {
  const { org } = await seedOrg({ slug: 'real', status: 'active', voters: 1 });
  const first = await seedCampaign(org, 'first', ['shared', 'first-only']);
  const second = await seedCampaign(org, 'second', ['shared']);
  await recomputeLive();
  const before = await totals();
  assert.strictEqual(before.votersProcessed, 3, 'real-0, shared and first-only, each once');

  const a = await bankThenStop(first);
  assert.strictEqual(a.votersProcessed, 1, 'shared lives on in the second campaign; only first-only leaves');
  await recomputeLive();
  assert.deepStrictEqual(await totals(), before);

  const b = await bankThenStop(second);
  assert.strictEqual(b.votersProcessed, 1, 'shared is banked here: its other row is in a campaign already banked');
  await recomputeLive();
  assert.deepStrictEqual(await totals(), before, 'nobody is lost between the two deletes');
});

test('two campaign captures counting at once still bank a shared person once', { skip }, async (t) => {
  const { org } = await seedOrg({ slug: 'real', status: 'active', voters: 1 });
  const first = await seedCampaign(org, 'first', ['shared', 'first-only']);
  const second = await seedCampaign(org, 'second', ['shared']);
  await recomputeLive();
  const before = await totals();

  // The first capture is parked mid-count while the second banks start to finish.
  const { parked, release } = parkFirstCall(t, SurveyResponse, 'countDocuments');
  const firstCapture = bankThenStop(first);
  await parked;
  assert.strictEqual((await bankThenStop(second)).votersProcessed, 0, 'shared still lives on in the first, unbanked');
  release();
  const a = await firstCapture;
  t.mock.restoreAll();
  assert.strictEqual(a.votersProcessed, 2, 'counted again once the second banked: shared leaves with the first');
  await recomputeLive();
  assert.deepStrictEqual(await totals(), before, 'shared is banked exactly once');
});

test('a bank in another org landing mid-count leaves the count standing — banked without counting again', { skip }, async (t) => {
  const { org: other } = await seedOrg({ slug: 'other', status: 'active', voters: 1 });
  const elsewhere = await seedCampaign(other, 'elsewhere', ['e-1', 'e-2']);
  const { org } = await seedOrg({ slug: 'gone', status: 'active', knocks: 4, voters: 2 });
  await recomputeLive();
  const before = await totals();

  // Count this org's counts, and park the first while another org's campaign delete banks.
  const real = SurveyResponse.countDocuments.bind(SurveyResponse);
  let counts = 0;
  let entered;
  let release;
  const parked = new Promise((r) => { entered = r; });
  const gate = new Promise((r) => { release = r; });
  t.mock.method(SurveyResponse, 'countDocuments', (filter, ...rest) => {
    if (String(filter?.organizationId) !== String(org._id)) return real(filter, ...rest);
    counts += 1;
    if (counts > 1) return real(filter, ...rest);
    entered();
    return gate.then(() => real(filter, ...rest));
  });
  const orgCapture = captureOrgBeforeDelete(org._id);
  await parked;
  await bankThenStop(elsewhere);
  release();
  const o = await orgCapture;
  t.mock.restoreAll();
  assert.strictEqual(counts, 1, 'counted once: a bank in another org cannot touch these rows');
  assert.strictEqual(o.doorsKnocked, 4);
  assert.deepStrictEqual(await totals(), before);
});

test('a campaign whose org document is missing banks as usual — its rows were live', { skip }, async () => {
  const { org } = await seedOrg({ slug: 'drift', status: 'active', voters: 1 });
  const orphan = await seedCampaign(org, 'orphan', ['o-1', 'o-2', 'o-3']);
  await Organization.deleteOne({ _id: org._id }); // data drift: the org's document is gone, its rows are not
  await recomputeLive();
  const before = await totals();
  assert.strictEqual(before.votersProcessed, 4, 'the orphaned rows count in live');

  assert.strictEqual((await bankThenStop(orphan))?.votersProcessed, 3, 'banked, not stood down');
  await Voter.deleteMany({ campaignId: orphan._id }); // what its cascade then destroys
  await Campaign.deleteOne({ _id: orphan._id });
  await recomputeLive();
  assert.deepStrictEqual(await totals(), before);
});

test('an internal org stays out of the numbers through its whole delete, after its Subscription is swept too', { skip }, async () => {
  await seedOrg({ slug: 'real', status: 'active', knocks: 5, voters: 1 });
  const { org: demo } = await seedOrg({ slug: 'demo', status: 'internal', knocks: 9, surveys: 9, voters: 9 });
  await recomputeLive();
  const before = await totals();

  await Organization.updateOne({ _id: demo._id }, { $set: { 'deletion.requestedAt': new Date(), 'deletion.status': 'running' } });
  assert.strictEqual(await captureOrgBeforeDelete(demo._id), null, 'nothing banked');
  // The cascade sweeps the org's Subscription long before its voters (ORG_SCOPED order), so for most
  // of the delete nothing says 'internal' any more except the mark the capture left.
  await Subscription.deleteMany({ organizationId: demo._id });
  await recomputeLive();
  assert.deepStrictEqual(await totals(), before, 'demo data never leaks into live mid-delete');
  assert.strictEqual(await captureOrgBeforeDelete(demo._id), null, 'a retry after the sweep still banks nothing');
  assert.strictEqual((await getPlatformStats()).deleted.doorsKnocked, 0);
});

test('an org created internal stays out of the numbers even when its billing status drifted', { skip }, async () => {
  await seedOrg({ slug: 'real', status: 'active', knocks: 5, voters: 1 });
  const { org: sandbox } = await seedOrg({ slug: 'sandbox', status: 'active', knocks: 9, voters: 9 });
  // The born-immutable flag, set the way the migrations set it (a raw write), with billing left 'active'.
  await Organization.collection.updateOne({ _id: sandbox._id }, { $set: { isInternal: true } });
  await recomputeLive();
  const before = await totals();
  assert.strictEqual(before.organizations, 1, 'the flag alone excludes it, as billing reads it');
  assert.strictEqual(before.doorsKnocked, 5);
  assert.strictEqual(await captureOrgBeforeDelete(sandbox._id), null, 'and its capture banks nothing');
  assert.deepStrictEqual(await totals(), before);
});

test('the bank is one write that clamps live at zero, even on a brand-new singleton', { skip }, async () => {
  // No PlatformStats document yet (beforeEach wiped it): the move must create it, not fail.
  const { org: first } = await seedOrg({ slug: 'first', status: 'active', knocks: 4, surveys: 1, voters: 2 });
  const captured = await captureOrgBeforeDelete(first._id);
  assert.deepStrictEqual(captured, { organizations: 1, campaigns: 1, doorsKnocked: 4, surveyResponses: 1, votersProcessed: 2 });
  let s = await getPlatformStats();
  assert.deepStrictEqual(s.deleted, captured, 'banked from rows on the document the move itself created');
  assert.deepStrictEqual(s.live, { organizations: 0, campaigns: 0, doorsKnocked: 0, surveyResponses: 0, votersProcessed: 0 }, 'live clamped at 0, never negative');

  // A live tally that lags the rows (a missed bump) is clamped the same way, never driven negative.
  const { org: second } = await seedOrg({ slug: 'second', status: 'active', knocks: 10 });
  await PlatformStats.updateOne({ key: 'singleton' }, { $set: { 'live.doorsKnocked': 3 } });
  await captureOrgBeforeDelete(second._id);
  s = await getPlatformStats();
  assert.strictEqual(s.live.doorsKnocked, 0);
  assert.strictEqual(s.deleted.doorsKnocked, 14);
});

test('a reconcile that counts while a capture banks counts again instead of writing over the bank', { skip }, async (t) => {
  await seedOrg({ slug: 'keep', status: 'active', knocks: 7, voters: 2 });
  const { org } = await seedOrg({ slug: 'gone', status: 'active', knocks: 10, surveys: 3, voters: 5 });
  await recomputeLive();
  const before = await totals();

  // The delete job banks the org while the reconcile is mid-count, after it read the org as live.
  const real = SurveyResponse.countDocuments.bind(SurveyResponse);
  let fired = false;
  t.mock.method(SurveyResponse, 'countDocuments', async (...args) => {
    if (!fired) {
      fired = true;
      await captureOrgBeforeDelete(org._id);
    }
    return real(...args);
  });
  await recomputeLive();
  t.mock.restoreAll();
  assert.strictEqual((await getPlatformStats()).deleted.organizations, 1, 'the org banked mid-reconcile');
  assert.deepStrictEqual(await totals(), before, 'and is never counted in live as well');
});

test('a reconcile that keeps missing gives up after counting twice, and says to run it again', { skip }, async (t) => {
  await seedOrg({ slug: 'keep', status: 'active', knocks: 2, voters: 1 });
  const { org: a } = await seedOrg({ slug: 'a', status: 'active', knocks: 3, voters: 1 });
  const { org: b } = await seedOrg({ slug: 'b', status: 'active', knocks: 4, voters: 1 });
  await recomputeLive();
  const before = await totals();

  // A delete banks during each of the reconcile's counts.
  const real = SurveyResponse.countDocuments.bind(SurveyResponse);
  const doomed = [a._id, b._id];
  let capturing = false;
  t.mock.method(SurveyResponse, 'countDocuments', async (...args) => {
    if (!capturing && doomed.length) {
      capturing = true;
      await captureOrgBeforeDelete(doomed.shift());
      capturing = false;
    }
    return real(...args);
  });
  await assert.rejects(() => recomputeLive(), /run the reconcile again/);
  t.mock.restoreAll();
  assert.strictEqual((await getPlatformStats()).deleted.organizations, 2);
  assert.deepStrictEqual(await totals(), before, 'and it wrote nothing over either bank');
});

test('a Door Outcomes writer finishing during the capture sweeps nothing — the late sweep waits for the mark', { skip }, async () => {
  const { org, camp } = await seedOrg({ slug: 'real', status: 'active', knocks: 4, surveys: 2, voters: 2 });
  await Organization.updateOne({ _id: org._id }, { $set: { 'deletion.requestedAt': new Date(), 'deletion.status': 'running' } });
  const tenant = { organizationId: org._id, campaignId: camp._id };
  assert.strictEqual(await sweepIfDeleting(tenant), false, 'running, but its capture has not banked yet');
  assert.strictEqual(await CanvassActivity.countDocuments({ organizationId: org._id }), 4);

  await captureOrgBeforeDelete(org._id);
  assert.strictEqual((await getPlatformStats()).deleted.doorsKnocked, 4, 'the capture counted every knock');
  assert.strictEqual(await sweepIfDeleting(tenant), true, 'once it has, a late write is swept');
  assert.strictEqual(await CanvassActivity.countDocuments({ organizationId: org._id }), 0);
});

test('the bank ledger lets go of an org or a campaign once it is gone, and never reaches the page', { skip }, async () => {
  const { org } = await seedOrg({ slug: 'gone', status: 'active', knocks: 2, voters: 1 });
  const { org: kept } = await seedOrg({ slug: 'kept', status: 'active', voters: 1 });
  const doomed = await seedCampaign(kept, 'doomed', ['d-1']);
  await recomputeLive();

  await deleteOrganization(org._id);
  await Campaign.updateOne({ _id: doomed._id }, { $set: { 'deletion.requestedAt': new Date(), 'deletion.status': 'running' } });
  await deleteCampaignCascade(await Campaign.findById(doomed._id));
  let { bank } = await PlatformStats.findOne({ key: 'singleton' }).lean();
  assert.strictEqual(bank.seq, 2, 'two banks');
  assert.deepStrictEqual([bank.orgs, bank.campaigns], [[], []], 'each id left with its org or campaign');

  // A crash between a cascade's last delete and its prune leaves an id behind: the reconcile drops it.
  await PlatformStats.updateOne({ key: 'singleton' }, { $push: { 'bank.orgs': oid() } });
  await recomputeLive();
  ({ bank } = await PlatformStats.findOne({ key: 'singleton' }).lean());
  assert.deepStrictEqual(bank.orgs, []);
  assert.ok(!('bank' in (await getPlatformStats())), 'the ledger is never served');
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
