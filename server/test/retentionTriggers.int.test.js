import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// The three retention triggers — each a REAL, irreversible purge.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/rtrig node --test test/retentionTriggers.int.test.js
//
// Nothing in this codebase ever deleted voter data on a timer. A canceled customer's voter file sat
// in our database forever; a dormant account's did too. "We keep your data while you are a customer,
// and then we don't" was a sentence, not a behaviour.
//
// These tests are unusually load-bearing because the code under them DELETES PAYING CUSTOMERS. The
// most important assertions here are the negative ones: what must NOT be purged.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-retention-triggers';

const { Organization } = await import('../src/models/Organization.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { User } = await import('../src/models/User.js');
const { OrgDeletionRequest } = await import('../src/models/OrgDeletionRequest.js');
const { RetentionRun } = await import('../src/models/RetentionRun.js');
const {
  runRetentionTriggers, purgeWoundDownOrgs, purgeDormantOrgs, executeDueDeletionRequests,
  WIND_DOWN_DAYS, DORMANCY_MONTHS, DELETE_REQUEST_SLA_DAYS, TRIGGER_JOB,
} = await import('../src/services/retention/triggers.js');
const { REPEATABLE_JOBS } = await import('../src/services/retention/scheduler.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const DAY = 86_400_000;

async function makeOrg(name, slug, subStatus, statusChangedAt = new Date()) {
  const org = await Organization.create({ name, slug, isActive: true });
  await Subscription.create({ organizationId: org._id, status: subStatus, statusChangedAt });
  return org;
}

// Give an org a real voter file, so a purge has something to actually destroy.
async function seedData(org, lastKnockAt = null) {
  const camp = await Campaign.create({ organizationId: org._id, name: 'C', type: 'survey', state: 'FL', isActive: true });
  const hh = await Household.create({
    organizationId: org._id, campaignId: camp._id,
    addressLine1: '1 Elm', city: 'T', state: 'FL', zipCode: '1',
    normalizedAddress: `1 ELM|${org.slug}`,
    location: { type: 'Point', coordinates: [-81, 28] },
  });
  await Voter.create({
    organizationId: org._id, householdId: hh._id, stateVoterId: `SV-${org.slug}`,
    firstName: 'Vi', lastName: 'Voter', fullName: 'Vi Voter',
  });
  if (lastKnockAt) {
    const u = await User.create({
      firstName: 'C', lastName: 'V', email: `c-${org.slug}@t.co`, passwordHash: 'x', isActive: true,
    });
    await CanvassActivity.create({
      organizationId: org._id, campaignId: camp._id, householdId: hh._id, userId: u._id,
      actionType: 'not_home', timestamp: lastKnockAt, location: { lat: 28, lng: -81 },
    });
  }
}

const votersOf = (org) => Voter.countDocuments({ organizationId: org._id });

// Mongoose's `timestamps: true` SILENTLY IGNORES a $set of createdAt on an update — so ageing a
// fixture org through the model does nothing, and a dormancy test would pass or fail for reasons that
// have nothing to do with the code. Go through the raw driver.
const ageOrg = (org, at) =>
  Organization.collection.updateOne({ _id: org._id }, { $set: { createdAt: at } });

before(async () => { if (URI) await mongoose.connect(URI); });
after(async () => { if (URI) await mongoose.disconnect(); });
beforeEach(async () => {
  if (!URI) return;
  for (const M of [Organization, Subscription, Campaign, Household, Voter, CanvassActivity, User, OrgDeletionRequest, RetentionRun]) {
    await M.deleteMany({});
  }
});

test(`WIND-DOWN: a customer canceled >${WIND_DOWN_DAYS}d ago is purged; one canceled yesterday is NOT`, { skip }, async () => {
  const old = await makeOrg('Left Long Ago', 'gone', 'canceled', new Date(Date.now() - (WIND_DOWN_DAYS + 5) * DAY));
  const recent = await makeOrg('Just Left', 'recent', 'canceled', new Date(Date.now() - 1 * DAY));
  const active = await makeOrg('Still Paying', 'active', 'active');
  for (const o of [old, recent, active]) await seedData(o);

  const res = await purgeWoundDownOrgs({ apply: true });
  assert.strictEqual(res.purged, 1);

  assert.strictEqual(await Organization.countDocuments({ _id: old._id }), 0, 'wind-down elapsed → gone');
  assert.strictEqual(await votersOf(old), 0, 'their voter file went with them');

  // The negative assertions matter more than the positive one.
  assert.ok(await Organization.findById(recent._id), 'still inside their export window — MUST survive');
  assert.strictEqual(await votersOf(recent), 1);
  assert.ok(await Organization.findById(active._id), 'a PAYING customer must never be touched');
  assert.strictEqual(await votersOf(active), 1);
});

test(`DORMANCY: a NON-PAYING org with no activity for ${DORMANCY_MONTHS} months → purged; a recent knock saves it`, { skip }, async () => {
  const stale = new Date(Date.now() - (DORMANCY_MONTHS * 30 + 40) * DAY);

  // Dormancy only ever touches an org that has stopped being a customer. This one canceled long ago
  // (and somehow escaped the 60-day wind-down) and has been silent for two years.
  const dormant = await makeOrg('Ghost Town', 'ghost', 'canceled');
  await ageOrg(dormant, stale);
  await seedData(dormant, stale); // last knock: long ago

  const revived = await makeOrg('Came Back', 'revived', 'canceled');
  await ageOrg(revived, stale);
  await seedData(revived, new Date()); // knocked a door today

  const res = await purgeDormantOrgs({ apply: true });
  assert.strictEqual(res.purged, 1);
  assert.strictEqual(await Organization.countDocuments({ _id: dormant._id }), 0);

  // The clock IS the last knock. One door knocked today buys another two years, by construction.
  assert.ok(await Organization.findById(revived._id), 'a single recent knock resets the clock');
  assert.strictEqual(await votersOf(revived), 1);
});

test('DORMANCY: a PAYING customer is NEVER purged for inactivity, however long', { skip }, async () => {
  // The load-bearing guarantee. An active, paid-up organization that simply has not canvassed between
  // election cycles must not be auto-deleted — we have no way to warn them, and they are a customer.
  const stale = new Date(Date.now() - (DORMANCY_MONTHS * 30 + 400) * DAY);
  for (const status of ['active', 'trial', 'past_due']) {
    const org = await makeOrg(`Paying ${status}`, `paying-${status}`, status);
    await ageOrg(org, stale);
    await seedData(org, stale); // dormant for years
    const res = await purgeDormantOrgs({ apply: true });
    assert.strictEqual(res.purged, 0, `a '${status}' org must never be dormancy-purged`);
    assert.ok(await Organization.findById(org._id), `a '${status}' org survives dormancy`);
  }
});

test('DORMANCY: a brand-new (non-paying) org that has not canvassed yet is NOT dormant', { skip }, async () => {
  // The trap: an org with zero CanvassActivity looks infinitely dormant if you measure from "last
  // knock". Measure from createdAt so a just-signed-up account is not purged. (Use a non-paying status
  // so the createdAt logic — not the paying-customer shield — is what protects it here.)
  const fresh = await makeOrg('Signed Up Today', 'fresh', 'suspended');
  await seedData(fresh); // imported their file, hasn't knocked yet

  const res = await purgeDormantOrgs({ apply: true });
  assert.strictEqual(res.purged, 0);
  assert.ok(await Organization.findById(fresh._id), 'a new account measured from createdAt is not dormant');
});

test('INTERNAL orgs are exempt — the demo tenant does not evaporate', { skip }, async () => {
  const stale = new Date(Date.now() - (DORMANCY_MONTHS * 30 + 60) * DAY);
  const demo = await makeOrg('Meridian Field Strategies', 'meridian-field-demo', 'internal', stale);
  await ageOrg(demo, stale);
  await seedData(demo, stale);

  await runRetentionTriggers({ apply: true });
  assert.ok(await Organization.findById(demo._id), 'our own demo/platform orgs must never be auto-purged');
});

test(`DELETE-ON-REQUEST: executed on the SLA date (${DELETE_REQUEST_SLA_DAYS}d), not before`, { skip }, async () => {
  const asked = await makeOrg('Asked To Leave', 'asked', 'active');
  const asking = await makeOrg('Asking', 'asking', 'active');
  for (const o of [asked, asking]) await seedData(o);

  await OrgDeletionRequest.create({
    organizationId: asked._id, requestedByEmail: 'ada@asked.com',
    scheduledFor: new Date(Date.now() - 1 * DAY), status: 'scheduled', // SLA elapsed
  });
  await OrgDeletionRequest.create({
    organizationId: asking._id, requestedByEmail: 'bob@asking.com',
    scheduledFor: new Date(Date.now() + 10 * DAY), status: 'scheduled', // still in the window
  });

  const res = await executeDueDeletionRequests({ apply: true });
  assert.strictEqual(res.purged, 1);

  assert.strictEqual(await Organization.countDocuments({ _id: asked._id }), 0);
  assert.strictEqual(await votersOf(asked), 0);
  const done = await OrgDeletionRequest.findOne({ organizationId: asked._id }).lean();
  assert.strictEqual(done.status, 'completed');
  assert.ok(done.completedAt);

  // The waiting window is what lets a mistaken or coerced request be cancelled.
  assert.ok(await Organization.findById(asking._id), 'not yet due — must still be cancellable');
});

test('a cancelled request is never executed', { skip }, async () => {
  const saved = await makeOrg('Changed Mind', 'changed', 'active');
  await seedData(saved);
  await OrgDeletionRequest.create({
    organizationId: saved._id, scheduledFor: new Date(Date.now() - 5 * DAY),
    status: 'cancelled', cancelledAt: new Date(),
  });

  const res = await executeDueDeletionRequests({ apply: true });
  assert.strictEqual(res.purged, 0);
  assert.ok(await Organization.findById(saved._id), 'a cancelled request must not fire, ever');
});

test('every sweep leaves a RetentionRun receipt — silence is a failure state', { skip }, async () => {
  await runRetentionTriggers({ apply: true });
  const run = await RetentionRun.findOne({ job: TRIGGER_JOB }).lean();
  assert.ok(run, 'the sweep recorded that it ran');
  assert.strictEqual(run.ok, true);
  assert.ok(run.finishedAt);
});

test('the trigger sweep is SCHEDULED in code — deleting it fails this test', { skip }, () => {
  const job = REPEATABLE_JOBS.find((j) => j.name === TRIGGER_JOB);
  assert.ok(job, `'${TRIGGER_JOB}' must be registered in services/retention/scheduler.js`);
  assert.ok(job.cron, 'and carry a schedule');
});

test('the windows are CONFIGURABLE, not hardcoded', { skip }, () => {
  // These are business decisions. A business decision baked into a service file is one nobody can
  // change without a deploy — and a lawyer's answer arriving after a deploy window is a bad reason to
  // keep the wrong number.
  assert.strictEqual(WIND_DOWN_DAYS, Number(process.env.RETENTION_WIND_DOWN_DAYS || 60));
  assert.strictEqual(DORMANCY_MONTHS, Number(process.env.RETENTION_DORMANCY_MONTHS || 24));
  assert.strictEqual(DELETE_REQUEST_SLA_DAYS, Number(process.env.RETENTION_DELETE_SLA_DAYS || 30));
});
