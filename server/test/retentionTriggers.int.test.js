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
const { processOrgDeleteJob } = await import('../src/services/platform/deleteOrgProcessor.js');
const { entitlementFor } = await import('../src/services/billing/entitlement.js');
const { windDownDeletionDate } = await import('../src/services/billing/windDown.js');

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
    organizationId: org._id, campaignId: camp._id, householdId: hh._id, stateVoterId: `SV-${org.slug}`,
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

// The purges now refuse to touch an UNWARNED org (see test/retentionWarnings.int.test.js for the
// warning machinery itself). These fixtures backdate the "customer was warned" markers so the purge
// logic under test here — the date boundaries — is what decides. deleteNotBefore mirrors the natural
// deletion date: past for the overdue orgs, future for the fresh ones.
const markWindDownWarned = (org, deleteNotBefore, warnedAt = new Date(Date.now() - 40 * DAY)) =>
  Subscription.updateOne(
    { organizationId: org._id },
    { $set: { windDownWarnedAt: warnedAt, windDownDeleteNotBefore: deleteNotBefore } }
  );
const markDormancyWarned = (org, deleteNotBefore, warnedAt = new Date(Date.now() - 40 * DAY)) =>
  Organization.updateOne(
    { _id: org._id },
    { $set: { dormancyWarnedAt: warnedAt, dormancyDeleteNotBefore: deleteNotBefore } }
  );

before(async () => { if (URI) await mongoose.connect(URI); });
after(async () => { if (URI) await mongoose.disconnect(); });
// The sweeps no longer delete: they stamp each due org and hand it to org-delete-queue. There is
// no Redis in this harness, so `stubEnqueue` does exactly what stampAndEnqueueOrgDelete does minus
// the enqueue — which makes the sweep's DECISION observable — and `runStamped()` then runs the real
// processor so every "org gone / voter file gone" assertion below stays exact. Together they are a
// strictly stronger test than the old inline call: they prove the decision AND the execution.
let stamped = [];
const stubEnqueue = async ({ orgId, source, requestedBy = null, requestId = null }) => {
  const org = await Organization.findById(orgId, 'deletion').lean();
  if (!org) return { gone: true };
  if (org.deletion?.requestedAt) return { alreadyDeleting: true };
  await Organization.updateOne(
    { _id: orgId },
    { $set: { deletion: { requestedAt: new Date(), requestedBy, source, requestId, status: 'pending', heartbeatAt: null, error: null } } }
  );
  stamped.push({ organizationId: String(orgId), source, requestId: requestId ? String(requestId) : null });
  return { queued: true, organization: { id: String(orgId) } };
};
const runStamped = async () => {
  const queue = stamped;
  stamped = [];
  for (const s of queue) await processOrgDeleteJob({ data: s, id: `t-${s.organizationId}` });
};

beforeEach(async () => {
  if (!URI) return;
  stamped = [];
  for (const M of [Organization, Subscription, Campaign, Household, Voter, CanvassActivity, User, OrgDeletionRequest, RetentionRun]) {
    await M.deleteMany({});
  }
});

test(`WIND-DOWN: a customer canceled >${WIND_DOWN_DAYS}d ago is purged; one canceled yesterday is NOT`, { skip }, async () => {
  const old = await makeOrg('Left Long Ago', 'gone', 'canceled', new Date(Date.now() - (WIND_DOWN_DAYS + 5) * DAY));
  const recent = await makeOrg('Just Left', 'recent', 'canceled', new Date(Date.now() - 1 * DAY));
  const active = await makeOrg('Still Paying', 'active', 'active');
  for (const o of [old, recent, active]) await seedData(o);
  // Both canceled orgs were duly warned — so the DATE, not a missing marker, is what protects
  // 'recent' below. 'active' is deliberately unmarked: a paying org never even gets that far.
  await markWindDownWarned(old, new Date(Date.now() - 5 * DAY));
  await markWindDownWarned(recent, windDownDeletionDate(new Date(Date.now() - 1 * DAY)));

  const res = await purgeWoundDownOrgs({ apply: true, enqueue: stubEnqueue });
  assert.strictEqual(res.enqueued, 1);
  assert.ok((await Organization.findById(old._id).lean()).deletion?.requestedAt, 'the due org is stamped');
  assert.strictEqual((await Organization.findById(old._id).lean()).deletion.source, 'wind_down');
  await runStamped();

  assert.strictEqual(await Organization.countDocuments({ _id: old._id }), 0, 'wind-down elapsed → gone');
  assert.strictEqual(await votersOf(old), 0, 'their voter file went with them');

  // The negative assertions matter more than the positive one.
  assert.ok(await Organization.findById(recent._id), 'still inside their export window — MUST survive');
  assert.strictEqual(await votersOf(recent), 1);
  assert.ok(await Organization.findById(active._id), 'a PAYING customer must never be touched');
  assert.strictEqual(await votersOf(active), 1);
});

test('TIE: the banner date IS the wind-down deletion boundary — one shared helper, no drift', { skip }, async () => {
  // The banner and the WARNING EMAIL are what a customer sees before deletion. If either said one
  // date while the job deleted on another, that is the words-vs-code drift this project exists to
  // kill. Both entitlementFor (the banner) and purgeWoundDownOrgs (the job) call
  // windDownDeletionDate, and this test asserts the banner's date equals the job's selection
  // boundary for the same org. (The email side of the tie lives in retentionWarnings.int.test.js.)
  const now = Date.now();
  const overdue = await makeOrg('Overdue', 'wd-due', 'canceled', new Date(now - (WIND_DOWN_DAYS + 1) * DAY));
  const fresh = await makeOrg('Fresh cancel', 'wd-fresh', 'canceled', new Date(now - (WIND_DOWN_DAYS - 5) * DAY));
  // Warned per the new never-delete-unwarned gate; each promised its natural (banner) date, so
  // the selection below is decided purely by the shared date helper.
  await markWindDownWarned(overdue, windDownDeletionDate(new Date(now - (WIND_DOWN_DAYS + 1) * DAY)));
  await markWindDownWarned(fresh, windDownDeletionDate(new Date(now - (WIND_DOWN_DAYS - 5) * DAY)));

  const dueSub = await Subscription.findOne({ organizationId: overdue._id }).lean();
  const freshSub = await Subscription.findOne({ organizationId: fresh._id }).lean();

  // 1. The banner's date is literally windDownDeletionDate(statusChangedAt) — the same function the job
  //    uses to decide. Not two copies asserted equal; one function, so they cannot diverge.
  assert.strictEqual(
    entitlementFor(dueSub).windDownEndsAt.getTime(),
    windDownDeletionDate(dueSub.statusChangedAt).getTime(),
    'banner date == the shared deletion-date helper'
  );

  // 2. The job selects an org EXACTLY when its banner date is at/behind now.
  const res = await purgeWoundDownOrgs({ apply: false });
  assert.ok(res.orgs.includes('wd-due'), 'overdue org (banner date in the past) IS due for deletion');
  assert.ok(!res.orgs.includes('wd-fresh'), 'fresh cancel (banner date in the future) is NOT yet due');

  // 3. Cross-check the boundary directly against the banner value the customer would see.
  assert.ok(entitlementFor(dueSub).windDownEndsAt.getTime() <= now, 'due: the date the customer sees is at/behind now');
  assert.ok(entitlementFor(freshSub).windDownEndsAt.getTime() > now, 'fresh: the date the customer sees is in the future');

  // 4. Non-canceled subscriptions have no wind-down date at all.
  assert.strictEqual(entitlementFor({ status: 'active' }).windDownEndsAt ?? null, null);
  assert.strictEqual(entitlementFor({ status: 'suspended' }).windDownEndsAt ?? null, null);
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

  // Both were duly warned (marker + elapsed promised date), so what separates them below is the
  // activity clock itself — and for 'revived', today's knock also VOIDS its warning.
  await markDormancyWarned(dormant, new Date(Date.now() - 5 * DAY));
  await markDormancyWarned(revived, new Date(Date.now() - 5 * DAY));

  const res = await purgeDormantOrgs({ apply: true, enqueue: stubEnqueue });
  assert.strictEqual(res.enqueued, 1);
  assert.strictEqual((await Organization.findById(dormant._id).lean()).deletion.source, 'dormancy');
  await runStamped();
  assert.strictEqual(await Organization.countDocuments({ _id: dormant._id }), 0);

  // The clock IS the last knock. One door knocked today buys another two years, by construction.
  assert.ok(await Organization.findById(revived._id), 'a single recent knock resets the clock');
  assert.strictEqual(await votersOf(revived), 1);
  // And the knock cleared the stale warning — a future dormancy stretch starts from a fresh warn.
  const revivedFresh = await Organization.findById(revived._id).lean();
  assert.strictEqual(revivedFresh.dormancyWarnedAt, null, 'activity after a warning voids it');
});

test('DORMANCY: a PAYING customer is NEVER purged for inactivity, however long', { skip }, async () => {
  // The load-bearing guarantee. An active, paid-up organization that simply has not canvassed between
  // election cycles must not be auto-deleted — warning email or not, they are a customer.
  const stale = new Date(Date.now() - (DORMANCY_MONTHS * 30 + 400) * DAY);
  for (const status of ['active', 'trial', 'past_due']) {
    const org = await makeOrg(`Paying ${status}`, `paying-${status}`, status);
    await ageOrg(org, stale);
    await seedData(org, stale); // dormant for years
    const res = await purgeDormantOrgs({ apply: true, enqueue: stubEnqueue });
    assert.strictEqual(res.enqueued, 0, `a '${status}' org must never be dormancy-purged`);
    assert.ok(await Organization.findById(org._id), `a '${status}' org survives dormancy`);
  }
});

test('DORMANCY: a brand-new (non-paying) org that has not canvassed yet is NOT dormant', { skip }, async () => {
  // The trap: an org with zero CanvassActivity looks infinitely dormant if you measure from "last
  // knock". Measure from createdAt so a just-signed-up account is not purged. (Use a non-paying status
  // so the createdAt logic — not the paying-customer shield — is what protects it here.)
  const fresh = await makeOrg('Signed Up Today', 'fresh', 'suspended');
  await seedData(fresh); // imported their file, hasn't knocked yet

  const res = await purgeDormantOrgs({ apply: true, enqueue: stubEnqueue });
  assert.strictEqual(res.enqueued, 0);
  assert.ok(await Organization.findById(fresh._id), 'a new account measured from createdAt is not dormant');
});

test('INTERNAL orgs are exempt — the demo tenant does not evaporate', { skip }, async () => {
  const stale = new Date(Date.now() - (DORMANCY_MONTHS * 30 + 60) * DAY);
  const demo = await makeOrg('Meridian Field Strategies', 'meridian-field-demo', 'internal', stale);
  await ageOrg(demo, stale);
  await seedData(demo, stale);

  await runRetentionTriggers({ apply: true, enqueue: stubEnqueue });
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

  const res = await executeDueDeletionRequests({ apply: true, enqueue: stubEnqueue });
  assert.strictEqual(res.enqueued, 1);
  // The request row stays 'scheduled' until the JOB completes it — writing 'completed' at enqueue
  // time would claim a deletion that has not happened yet.
  const midFlight = await OrgDeletionRequest.findOne({ organizationId: asked._id }).lean();
  assert.strictEqual(midFlight.status, 'scheduled', 'the enqueue must not close the request');
  assert.ok(await Organization.findById(asked._id), 'not deleted until the job runs');

  await runStamped();

  assert.strictEqual(await Organization.countDocuments({ _id: asked._id }), 0);
  assert.strictEqual(await votersOf(asked), 0);
  const done = await OrgDeletionRequest.findOne({ organizationId: asked._id }).lean();
  assert.strictEqual(done.status, 'completed', 'the JOB closes the request');
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

  const res = await executeDueDeletionRequests({ apply: true, enqueue: stubEnqueue });
  assert.strictEqual(res.enqueued, 0);
  assert.ok(await Organization.findById(saved._id), 'a cancelled request must not fire, ever');
});

test('every sweep leaves a RetentionRun receipt — silence is a failure state', { skip }, async () => {
  await runRetentionTriggers({ apply: true, enqueue: stubEnqueue });
  const run = await RetentionRun.findOne({ job: TRIGGER_JOB }).lean();
  assert.ok(run, 'the sweep recorded that it ran');
  assert.strictEqual(run.ok, true);
  assert.ok(run.finishedAt);
});

// REGRESSION: purgeWoundDownOrgs and purgeDormantOrgs used to call deleteOrganization inline and
// BARE. One org that threw took down runRetentionTriggers — so the stages after it, including
// delete-on-request (the 30-day promise with actual legal teeth), silently never ran that night,
// and the only trace was an ok:false receipt. Each org is now its own job with its own failure.
test('a single org that cannot be enqueued does NOT abort the sweep or the SLA stage', { skip }, async () => {
  const bad = await makeOrg('Explodes', 'boom', 'canceled', new Date(Date.now() - (WIND_DOWN_DAYS + 5) * DAY));
  const good = await makeOrg('Also Due', 'alsodue', 'canceled', new Date(Date.now() - (WIND_DOWN_DAYS + 5) * DAY));
  const asked = await makeOrg('Asked To Go', 'askedtogo', 'active');
  for (const o of [bad, good, asked]) await seedData(o);
  await markWindDownWarned(bad, new Date(Date.now() - 5 * DAY));
  await markWindDownWarned(good, new Date(Date.now() - 5 * DAY));
  await OrgDeletionRequest.create({
    organizationId: asked._id, requestedByEmail: 'ada@asked.com',
    scheduledFor: new Date(Date.now() - 1 * DAY), status: 'scheduled',
  });

  const flaky = async (args) => {
    if (String(args.orgId) === String(bad._id)) throw new Error('redis is on fire');
    return stubEnqueue(args);
  };
  const res = await runRetentionTriggers({ apply: true, enqueue: flaky });

  assert.strictEqual(res.ok, true, 'the sweep completes despite one org failing');
  assert.strictEqual(res.windDown.failedToEnqueue, 1);
  assert.strictEqual(res.windDown.enqueued, 1, 'the OTHER due org still went out');
  assert.strictEqual(res.requested.enqueued, 1, 'the delete-on-request stage still ran');
  assert.ok((await Organization.findById(good._id).lean()).deletion?.requestedAt);
  assert.strictEqual((await Organization.findById(bad._id).lean()).deletion?.requestedAt ?? null, null);

  await runStamped();
  assert.strictEqual(await Organization.countDocuments({ _id: good._id }), 0);
  assert.strictEqual(await Organization.countDocuments({ _id: asked._id }), 0);
  assert.ok(await Organization.findById(bad._id), 'the failed one survives for the next sweep');
});

test('the receipt reports what the sweep DID: enqueued, not purged', { skip }, async () => {
  const due = await makeOrg('Due Org', 'dueorg', 'canceled', new Date(Date.now() - (WIND_DOWN_DAYS + 5) * DAY));
  await seedData(due);
  await markWindDownWarned(due, new Date(Date.now() - 5 * DAY));

  const res = await runRetentionTriggers({ apply: true, enqueue: stubEnqueue });
  const run = await RetentionRun.findOne({ job: TRIGGER_JOB }).lean();
  // `purged` keeps its meaning — organizations THIS RUN destroyed — and is 0 by construction now.
  // It must never be repurposed to mean "condemned": the deletion is confirmed by the org row
  // being gone, never by a number this sweep wrote before the worker had run.
  assert.strictEqual(run.purged, 0, 'the sweep itself destroys nothing');
  assert.strictEqual(run.enqueued, 1);
  assert.strictEqual(run.scanned, res.scanned);
  assert.ok(await Organization.findById(due._id), 'still present — the job has not run yet');
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
  assert.strictEqual(DORMANCY_MONTHS, Number(process.env.RETENTION_DORMANCY_MONTHS || 30));
  assert.strictEqual(DELETE_REQUEST_SLA_DAYS, Number(process.env.RETENTION_DELETE_SLA_DAYS || 30));
});
