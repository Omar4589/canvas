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
  // makeDeleted writes a LEGACY-shaped snapshot (email+phone) on purpose: new snapshots are
  // name-only, and the purge $unsets both fields so even unmigrated legacy rows end up clean.
  assert.ok(!('email' in l), 'email stripped — not blanked, gone');
  assert.ok(!('phone' in l), 'phone stripped — not blanked, gone');
  assert.ok(l.purgedAt, 'purgedAt stamped');
  // The ROW survives on purpose — it is the evidence that a deletion happened and the window was
  // honoured. Deleting it would destroy the only proof we kept our word.
  assert.ok(l, 'the record itself is kept as evidence');

  const f = await DeletedUserRecord.findById(fresh._id).lean();
  assert.strictEqual(f.email, 'fresh@t.co', 'still inside its window — untouched');
  assert.strictEqual(f.purgedAt, null);
});

// privacy.html: after the window "we aim to remove your name". A Door Outcomes run's scope line froze
// the canvasser's name as text ("Gone User · Riverside · Pass 2"), so the purge has to rewrite it — on
// every run type, whichever way the wire scope stored the id, and for records purged before it did.
test('the purge takes a lapsed canvasser\'s name off every run\'s frozen scope line', { skip }, async () => {
  const { ReclassifyRun } = await import('../src/models/ReclassifyRun.js');
  const { SurveyConversionRun } = await import('../src/models/SurveyConversionRun.js');
  const { UnknockRun } = await import('../src/models/UnknockRun.js');
  const { AnswerEditRun } = await import('../src/models/AnswerEditRun.js');
  const models = [ReclassifyRun, SurveyConversionRun, UnknockRun, AnswerEditRun];
  for (const M of models) await M.collection.deleteMany({});

  const lapsed = await makeDeleted('lapsed@t.co', new Date(Date.now() - 1 * DAY));
  const earlier = await makeDeleted('earlier@t.co', new Date(Date.now() - 9 * DAY));
  await DeletedUserRecord.updateOne({ _id: earlier._id }, { $set: { firstName: '', lastName: '', purgedAt: new Date(Date.now() - 8 * DAY) } });
  const fresh = await makeDeleted('fresh@t.co', new Date(Date.now() + 30 * DAY));
  const someoneElse = new mongoose.Types.ObjectId();
  const stamp = new Date(Date.now() - 3 * DAY);
  const runOf = (userId, scopeSummary, asString) => ({
    _id: new mongoose.Types.ObjectId(),
    selection: { scope: userId ? { userId: asString ? String(userId) : userId, passId: String(new mongoose.Types.ObjectId()) } : {} },
    scopeSummary,
    createdAt: stamp,
    updatedAt: stamp,
  });
  const ids = {};
  for (const [i, M] of models.entries()) {
    const rows = {
      lapsed: runOf(lapsed.userId, 'Gone User · Riverside · Pass 2', i % 2 === 0),
      earlier: runOf(earlier.userId, 'Old Name · answered Opposed · Aug 1 – Aug 7', i % 2 === 1),
      fresh: runOf(fresh.userId, 'Fresh User · Pass 1', true),
      other: runOf(someoneElse, 'Cara Canvasser · Pass 1', true),
      unscoped: runOf(null, 'Riverside · Pass 2', true),
    };
    await M.collection.insertMany(Object.values(rows));
    ids[M.modelName] = Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, r._id]));
  }
  const lineOf = async (M, key) => (await M.collection.findOne({ _id: ids[M.modelName][key] })).scopeSummary;

  const dry = await purgeDeletedIdentities({ apply: false });
  assert.strictEqual(dry.namesScrubbed, 8, 'the dry run counts the lapsed and the earlier-purged canvasser on all four run types');
  assert.strictEqual(await lineOf(UnknockRun, 'lapsed'), 'Gone User · Riverside · Pass 2', 'and changes nothing');

  const res = await purgeDeletedIdentities({ apply: true });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.namesScrubbed, 8);
  for (const M of models) {
    assert.strictEqual(await lineOf(M, 'lapsed'), 'Deleted user · Riverside · Pass 2', `${M.modelName}: the lapsed name is off, the rest of the line stays`);
    assert.strictEqual(await lineOf(M, 'earlier'), 'Deleted user · answered Opposed · Aug 1 – Aug 7', `${M.modelName}: a record purged before this step is caught up`);
    assert.strictEqual(await lineOf(M, 'fresh'), 'Fresh User · Pass 1', `${M.modelName}: a name still inside its window stays`);
    assert.strictEqual(await lineOf(M, 'other'), 'Cara Canvasser · Pass 1', `${M.modelName}: another canvasser's run is untouched`);
    assert.strictEqual(await lineOf(M, 'unscoped'), 'Riverside · Pass 2', `${M.modelName}: a line naming no canvasser is untouched`);
    const touched = await M.collection.findOne({ _id: ids[M.modelName].lapsed });
    assert.strictEqual(touched.updatedAt.getTime(), stamp.getTime(), `${M.modelName}: the run's last sign of life is not moved`);
  }

  const again = await purgeDeletedIdentities({ apply: true });
  assert.strictEqual(again.namesScrubbed, 0, 'once caught up it rewrites nothing');
  for (const M of models) await M.collection.deleteMany({});
});

// An organization's deletion drops a deletion record once no organization is left on it — but the person
// may have worked for another organization that had removed them before they deleted, whose run lines
// still name them. The account row itself is never deleted, so its own deletion date carries the window.
test('the purge takes the name off for an account deleted past the window whose record is gone — never sooner', { skip }, async () => {
  const { User } = await import('../src/models/User.js');
  const { UnknockRun } = await import('../src/models/UnknockRun.js');
  await UnknockRun.collection.deleteMany({});
  const account = async (daysAgo) => {
    const _id = new mongoose.Types.ObjectId();
    await User.collection.insertOne({ _id, firstName: 'Deleted', lastName: 'user', email: `deleted-${_id}@t.co`, passwordHash: 'x', isActive: false, deletedAt: new Date(Date.now() - daysAgo * DAY) });
    return _id;
  };
  const lapsedNoRecord = await account(200);
  const recentNoRecord = await account(10);
  const lapsedButHeld = await account(200);
  await DeletedUserRecord.create({
    userId: lapsedButHeld, firstName: 'Held', lastName: 'Longer', organizationIds: [new mongoose.Types.ObjectId()],
    deletedAt: new Date(Date.now() - 200 * DAY), retentionUntil: new Date(Date.now() + 30 * DAY),
  });
  const lineFor = async (userId, name) => {
    const _id = new mongoose.Types.ObjectId();
    await UnknockRun.collection.insertOne({ _id, selection: { scope: { userId: String(userId) } }, scopeSummary: `${name} · Pass 1`, createdAt: new Date(), updatedAt: new Date() });
    return _id;
  };
  const a = await lineFor(lapsedNoRecord, 'Xavier Gone');
  const b = await lineFor(recentNoRecord, 'Recent Gone');
  const c = await lineFor(lapsedButHeld, 'Held Longer');
  const res = await purgeDeletedIdentities({ apply: true });
  assert.strictEqual(res.ok, true);
  const line = async (id) => (await UnknockRun.collection.findOne({ _id: id })).scopeSummary;
  assert.strictEqual(await line(a), 'Deleted user · Pass 1', 'past the window with no record: off');
  assert.strictEqual(await line(b), 'Recent Gone · Pass 1', 'still inside its window: kept');
  assert.strictEqual(await line(c), 'Held Longer · Pass 1', 'a record not yet purged governs its own window');
  await UnknockRun.collection.deleteMany({});
  await User.collection.deleteMany({ _id: { $in: [lapsedNoRecord, recentNoRecord, lapsedButHeld] } });
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
  // The purge reads the due records with find() (record by record — the FbTime step can fail
  // per record); the query itself failing is the whole run failing.
  const orig = DeletedUserRecord.find;
  DeletedUserRecord.find = () => ({ select: () => ({ lean: () => Promise.reject(new Error('mongo exploded')) }) });
  try {
    await assert.rejects(() => purgeDeletedIdentities({ apply: true }), /mongo exploded/);
  } finally {
    DeletedUserRecord.find = orig;
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
