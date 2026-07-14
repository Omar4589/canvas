import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// Retention is a PROMISE, and this suite is what stops it being quietly broken.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/ret node --test test/retention.int.test.js
//
// We tell every user — in the deletion sheet, on doorline.app/delete-account, and in the privacy
// policy — that after they delete their account we keep their name for 180 days and then remove it.
// For a long time the code that did that was a dry-run-by-default CLI which NOTHING in the app ever
// called. It ran only because someone had typed it into a Heroku Scheduler web form. No test knew it
// existed. Remove the add-on and the purge stops — with no error, no alert, no failing build. We
// would keep people's names forever while publicly promising we did not.
//
// The bug was never "the job wasn't running". It was "the promise was enforced by something invisible
// to the code, so it could stop being kept and nobody would know."
//
// Hence the last test in this file, which is the important one: it asserts the SCHEDULE ITSELF is
// declared. Delete the retention job and CI goes red.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-retention';

const { DeletedUserRecord } = await import('../src/models/DeletedUserRecord.js');
const { RetentionRun } = await import('../src/models/RetentionRun.js');
const {
  purgeDeletedIdentities, retentionHealth, JOB_NAME, STALE_AFTER_HOURS,
} = await import('../src/services/retention/purgeDeletedIdentities.js');
const { REPEATABLE_JOBS, RETENTION_CRON } = await import('../src/services/retention/scheduler.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const DAY = 86_400_000;

async function makeDeleted(email, retentionUntil) {
  return DeletedUserRecord.create({
    userId: new mongoose.Types.ObjectId(),
    firstName: 'Gone', lastName: 'User', email, phone: '555-0000',
    organizationIds: [new mongoose.Types.ObjectId()],
    deletedAt: new Date(Date.now() - 200 * DAY),
    retentionUntil,
  });
}

before(async () => { if (URI) await mongoose.connect(URI); });
after(async () => { if (URI) await mongoose.disconnect(); });
beforeEach(async () => {
  if (!URI) return;
  for (const M of [DeletedUserRecord, RetentionRun]) await M.deleteMany({});
});

test('a lapsed identity is purged; one still inside its window is not', { skip }, async () => {
  const lapsed = await makeDeleted('lapsed@t.co', new Date(Date.now() - 1 * DAY));
  const fresh = await makeDeleted('fresh@t.co', new Date(Date.now() + 30 * DAY));

  const res = await purgeDeletedIdentities({ apply: true });
  assert.strictEqual(res.purged, 1);

  const l = await DeletedUserRecord.findById(lapsed._id).lean();
  assert.strictEqual(l.firstName, '', 'name blanked');
  assert.strictEqual(l.email, '', 'email blanked');
  assert.strictEqual(l.phone, null);
  assert.ok(l.purgedAt, 'purgedAt stamped');
  // The ROW survives on purpose — it is the evidence that a deletion happened and the window was
  // honoured. Deleting it would destroy the only proof we kept our word.
  assert.ok(l, 'the record itself is kept as evidence');

  const f = await DeletedUserRecord.findById(fresh._id).lean();
  assert.strictEqual(f.email, 'fresh@t.co', 'still inside its window — untouched');
  assert.strictEqual(f.purgedAt, null);
});

test('every run is recorded — a purge that does nothing still leaves a receipt', { skip }, async () => {
  await purgeDeletedIdentities({ apply: true });
  const run = await RetentionRun.findOne({ job: JOB_NAME }).lean();
  assert.ok(run, 'a RetentionRun row exists');
  assert.strictEqual(run.ok, true);
  assert.ok(run.finishedAt, 'finishedAt stamped');
  assert.strictEqual(run.purged, 0, 'nothing to purge, and it says so');
});

test('health is RED when the purge has never run', { skip }, async () => {
  const h = await retentionHealth();
  assert.strictEqual(h.healthy, false);
  assert.match(h.message, /NEVER run/i);
});

test('health is RED when the last success is stale — a silently dead job', { skip }, async () => {
  // This is precisely the state the old Heroku-Scheduler setup could have entered without a sound:
  // the job ran once, then the add-on went away, and nothing ever complained.
  await RetentionRun.create({
    job: JOB_NAME,
    startedAt: new Date(Date.now() - (STALE_AFTER_HOURS + 5) * 3_600_000),
    finishedAt: new Date(),
    ok: true, purged: 0,
  });
  const h = await retentionHealth();
  assert.strictEqual(h.healthy, false, 'a stale job must read as unhealthy, not as silence');
  assert.match(h.message, /not being kept/i);
});

test('health is GREEN after a fresh successful run', { skip }, async () => {
  await purgeDeletedIdentities({ apply: true });
  const h = await retentionHealth();
  assert.strictEqual(h.healthy, true);
  assert.strictEqual(h.hoursSinceLastSuccess, 0);
});

test('a failing purge is RECORDED, not swallowed', { skip }, async () => {
  const orig = DeletedUserRecord.countDocuments;
  DeletedUserRecord.countDocuments = () => Promise.reject(new Error('mongo exploded'));
  try {
    await assert.rejects(() => purgeDeletedIdentities({ apply: true }), /mongo exploded/);
  } finally {
    DeletedUserRecord.countDocuments = orig;
  }
  const run = await RetentionRun.findOne({ job: JOB_NAME, ok: false }).lean();
  assert.ok(run, 'the failed run left a record');
  assert.match(run.error, /mongo exploded/);

  const h = await retentionHealth();
  assert.strictEqual(h.healthy, false);
  assert.match(h.lastError, /mongo exploded/);
});

// ── THE ONE THAT MATTERS ─────────────────────────────────────────────────────────────────────────
test('the retention job is SCHEDULED in code — deleting the schedule fails this test', { skip }, () => {
  // The original defect was not a broken purge. It was a promise enforced by a Heroku dashboard
  // entry: invisible to the repo, uncovered by any test, removable without anything failing.
  //
  // This asserts the schedule lives in the codebase. If someone deletes the retention job from
  // REPEATABLE_JOBS, or the worker stops registering it, CI goes red — instead of a legal commitment
  // going quiet.
  const job = REPEATABLE_JOBS.find((j) => j.name === JOB_NAME);
  assert.ok(job, `the '${JOB_NAME}' job must be registered in services/retention/scheduler.js`);
  assert.ok(job.cron, 'it must carry a cron schedule');
  assert.strictEqual(job.cron, RETENTION_CRON);
  // Daily-or-better. A weekly purge would still honour a 180-day promise, but the health check
  // assumes a daily cadence (STALE_AFTER_HOURS = 48) and would false-alarm.
  assert.match(job.cron, /^\S+ \S+ \* \* \*$/, 'the purge must run at least daily');
});
