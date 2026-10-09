import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mongoose from 'mongoose';

// Two older FbTime deletion gaps, closed (docs/PROPOSAL_FBTIME_DOOR_COUNTS.md §M, decision 10):
//   · a deleted account's email survived in its FbTime link and in link-created history —
//     deletion now nulls the link's email, and migrate:fbtime-deletion-gaps sweeps the rest;
//   · nothing un-paired a deleted account from its FbTime person — the 180-day purge now
//     de-pairs it, keyed on the ACCOUNT across every org and connection status, record by
//     record, keeping the account's hours measured (its shifts keep their userId).
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/fbtgaps node --test test/fbtimeDeletionGaps.int.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-fbtime-gaps';
process.env.CREDENTIAL_SEAL_KEY = process.env.CREDENTIAL_SEAL_KEY || Buffer.alloc(32, 4).toString('base64');

const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { DeletedUserRecord } = await import('../src/models/DeletedUserRecord.js');
const { RetentionRun } = await import('../src/models/RetentionRun.js');
const { FbTimeConnection } = await import('../src/models/FbTimeConnection.js');
const { FbTimePersonLink } = await import('../src/models/FbTimePersonLink.js');
const { FbTimeShift } = await import('../src/models/FbTimeShift.js');
const { IntegrationEvent } = await import('../src/models/IntegrationEvent.js');
const { deleteAccount } = await import('../src/services/users/deleteAccount.js');
const { purgeDeletedIdentities, JOB_NAME } = await import('../src/services/retention/purgeDeletedIdentities.js');
const { reassignPersonShifts } = await import('../src/services/fbtime/shiftOwner.js');
const { PURGED_PERSON } = await import('../src/services/fbtime/purgePairing.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86_400_000;

const P1 = 'eeeeeeeeeeeeeeeeeeeeee01';
const P2 = 'eeeeeeeeeeeeeeeeeeeeee02';
const P3 = 'eeeeeeeeeeeeeeeeeeeeee03';
const P4 = 'eeeeeeeeeeeeeeeeeeeeee04';

let orgs;
let seq = 0;

const mkUser = (extra = {}) =>
  User.create({ firstName: 'Gap', lastName: `U${++seq}`, email: `gap${seq}@gaps.co`, passwordHash: 'x', isActive: true, ...extra });
const mkConnection = (organizationId, status, extra = {}) =>
  FbTimeConnection.create({ organizationId, status, keyCiphertext: status === 'disconnected' ? null : 'v1:sealed', fbtimeOrgId: 'f1', ...extra });

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

beforeEach(async () => {
  if (!URI) return;
  for (const M of [Organization, User, Membership, DeletedUserRecord, RetentionRun, FbTimeConnection, FbTimePersonLink,
    FbTimeShift, IntegrationEvent]) {
    await M.deleteMany({});
  }
  orgs = {};
  for (const k of ['connected', 'disconnected', 'errored', 'left']) {
    orgs[k] = await Organization.create({ name: `Gaps ${k}`, slug: `gaps-${k}`, isActive: true });
  }
});

test('account deletion nulls the FbTime link’s email in every org; the link itself stays until the purge', { skip }, async () => {
  const x = await mkUser();
  for (const k of ['connected', 'disconnected']) {
    await Membership.create({ userId: x._id, organizationId: orgs[k]._id, role: 'canvasser', isActive: true });
    await FbTimePersonLink.create({
      organizationId: orgs[k]._id, userId: x._id, fbtimePersonId: P1, fbtimeEmail: x.email, fbtimeName: 'Gap U', source: 'auto-email',
    });
  }
  await deleteAccount(x._id);
  const links = await FbTimePersonLink.find({ userId: x._id }).lean();
  assert.strictEqual(links.length, 2, 'the link keeps the hours theirs until the purge');
  assert.ok(links.every((l) => l.fbtimeEmail === null), 'the email goes with the account’s own');
});

// A deleted account X, paired with FbTime in four orgs: connected (kept for P1, which
// Y now holds), disconnected, errored, and one X had already left.
const pairedEverywhere = async ({ due = true } = {}) => {
  const x = await mkUser({ isActive: false, deletedAt: new Date(Date.now() - 200 * DAY) });
  const y = await mkUser();
  const deletedAt = x.deletedAt;
  await DeletedUserRecord.create({
    userId: x._id, firstName: 'Xavier', lastName: 'X', organizationIds: [orgs.connected._id], deletedAt,
    retentionUntil: new Date(Date.now() - (due ? DAY : -DAY)),
  });
  await mkConnection(orgs.connected._id, 'connected', {
    keptAccounts: [{ fbtimePersonId: P1, userId: x._id, until: deletedAt }],
    doors: {
      reported: [P1], earliestDate: '2026-01-01',
      rejected: [{ fbtimePersonId: P2, userId: x._id }],
      clearPersons: [{ fbtimePersonId: P2, fromUserId: x._id }],
    },
  });
  await mkConnection(orgs.disconnected._id, 'disconnected');
  await mkConnection(orgs.errored._id, 'errored');
  await mkConnection(orgs.left._id, 'connected');
  await FbTimePersonLink.create({ organizationId: orgs.connected._id, userId: y._id, fbtimePersonId: P1, source: 'manual' });
  await FbTimePersonLink.create({ organizationId: orgs.disconnected._id, userId: x._id, fbtimePersonId: P2, source: 'manual' });
  await FbTimePersonLink.create({ organizationId: orgs.errored._id, userId: x._id, fbtimePersonId: P3, source: 'manual' });
  await FbTimePersonLink.create({ organizationId: orgs.left._id, userId: x._id, fbtimePersonId: P4, source: 'manual' });
  const s = (organizationId, shiftId, fbtimePersonId, clockIn, userId) =>
    FbTimeShift.create({ organizationId, shiftId, fbtimePersonId, clockIn, userId, grossHours: 5, adjustedHours: 5, workedHours: 5 });
  await s(orgs.connected._id, 'kept-old', P1, new Date(deletedAt.getTime() - 10 * DAY), x._id);
  await s(orgs.connected._id, 'y-new', P1, new Date(deletedAt.getTime() + 5 * DAY), y._id);
  await s(orgs.errored._id, 'err-old', P3, new Date(deletedAt.getTime() - 3 * DAY), x._id);
  await s(orgs.errored._id, 'err-after', P3, new Date(deletedAt.getTime() + 2 * DAY), x._id);
  // The link-type history, one with the id upper-cased the way older rows stored it.
  await IntegrationEvent.create({ organizationId: orgs.connected._id, type: 'link-created', detail: { userId: String(x._id).toUpperCase(), fbtimePersonId: P1, userEmail: 'x@old.co' } });
  await IntegrationEvent.create({ organizationId: orgs.connected._id, type: 'account-kept', detail: { userId: String(x._id), fbtimePersonId: P1 } });
  await IntegrationEvent.create({ organizationId: orgs.left._id, type: 'link-created', detail: { userId: String(x._id), fbtimePersonId: P4 } });
  await IntegrationEvent.create({ organizationId: orgs.left._id, type: 'link-created', detail: { userId: String(y._id), fbtimePersonId: P4 } });
  return { x, y, deletedAt };
};

const shiftOf = (shiftId) => FbTimeShift.findOne({ shiftId }).lean();

test('the purge de-pairs the account everywhere — and keeps its hours measured', { skip }, async () => {
  const { x, y } = await pairedEverywhere();
  const res = await purgeDeletedIdentities({ apply: true });
  assert.deepStrictEqual([res.ok, res.scanned, res.purged, res.failed], [true, 1, 1, 0]);

  assert.strictEqual(await FbTimePersonLink.countDocuments({ userId: x._id }), 0, 'no link in any org, any status');
  const a = await FbTimeConnection.findOne({ organizationId: orgs.connected._id }).lean();
  assert.deepStrictEqual(a.keptAccounts, []);
  assert.deepStrictEqual(a.doors.rejected, []);
  assert.deepStrictEqual(a.doors.clearPersons.map((c) => [c.fbtimePersonId, c.fromUserId]), [[P2, null]], 'the clear stays — about the person');

  const keptOld = await shiftOf('kept-old');
  assert.deepStrictEqual([String(keptOld.userId), keptOld.fbtimePersonId], [String(x._id), PURGED_PERSON], 'hours stay the account’s; the person goes');
  assert.strictEqual(String((await shiftOf('y-new')).userId), String(y._id));
  const errOld = await shiftOf('err-old');
  assert.deepStrictEqual([String(errOld.userId), errOld.fbtimePersonId], [String(x._id), PURGED_PERSON]);
  assert.strictEqual((await shiftOf('err-after')).userId, null, 'clocked after the deletion: whoever owns it now — nobody');

  const xEvents = await IntegrationEvent.find({ type: { $in: ['link-created', 'account-kept'] } }).lean();
  for (const e of xEvents) {
    if (String(e.detail.userId).toLowerCase() === String(x._id)) {
      assert.ok(!('fbtimePersonId' in e.detail) && !('userEmail' in e.detail), 'no person beside the purged account');
    } else {
      assert.strictEqual(e.detail.fbtimePersonId, P4, 'other people’s history untouched');
    }
  }
  const purgeRows = await IntegrationEvent.find({ type: 'link-removed', 'detail.reason': 'identity-purge' }).lean();
  assert.strictEqual(purgeRows.length, 4, 'one row per org touched');
  assert.ok(purgeRows.every((e) => !e.detail.userId && !e.detail.fbtimePersonId), 'with no ids');

  // A later link of the person claims none of the de-paired shifts.
  const z = await mkUser();
  await FbTimePersonLink.create({ organizationId: orgs.errored._id, userId: z._id, fbtimePersonId: P3, source: 'manual' });
  await reassignPersonShifts(orgs.errored._id, P3);
  assert.strictEqual(String((await shiftOf('err-old')).userId), String(x._id));
  assert.strictEqual(String((await shiftOf('err-after')).userId), String(z._id));

  const runs = await RetentionRun.find({ job: JOB_NAME }).lean();
  assert.deepStrictEqual(runs.map((r) => [r.ok, r.failed]), [[true, 0]]);
});

test('a record that throws stays due while the rest are purged, and the run reads not ok', { skip }, async () => {
  await pairedEverywhere();
  const bad = new mongoose.Types.ObjectId();
  await DeletedUserRecord.collection.insertOne({
    userId: bad, firstName: 'Broken', lastName: 'Row', organizationIds: [], deletedAt: 'not a date',
    retentionUntil: new Date(Date.now() - DAY), purgedAt: null,
  });
  const res = await purgeDeletedIdentities({ apply: true });
  assert.deepStrictEqual([res.ok, res.purged, res.failed], [false, 1, 1]);
  const broken = await DeletedUserRecord.collection.findOne({ userId: bad });
  assert.strictEqual(broken.purgedAt, null, 'left for the next night');
  assert.strictEqual(broken.firstName, 'Broken');
  const run = await RetentionRun.findOne({ job: JOB_NAME }).lean();
  assert.deepStrictEqual([run.ok, run.failed], [false, 1], 'recorded as a failed run, never a green receipt');
});

test('a dry run counts and writes nothing — not even a RetentionRun row', { skip }, async () => {
  const { x } = await pairedEverywhere();
  const res = await purgeDeletedIdentities({ apply: false });
  assert.strictEqual(res.scanned, 1);
  assert.strictEqual(res.purged, 0);
  assert.strictEqual(res.fbtime.links, 3);
  assert.strictEqual(await FbTimePersonLink.countDocuments({ userId: x._id }), 3);
  assert.strictEqual(await RetentionRun.countDocuments({}), 0, 'a counting pass never makes a dead job read green');
  assert.strictEqual((await DeletedUserRecord.findOne({ userId: x._id }).lean()).purgedAt, null);
});

test('migrate:fbtime-deletion-gaps — dry run counts, --apply writes, the re-run reads zero', { skip }, async () => {
  // Rows from before the fix: a deleted account's link still holding the email, link-created
  // events carrying userEmail (one upper-cased id), and an account purged before the
  // purge de-paired.
  const w = await mkUser({ isActive: false, deletedAt: new Date(Date.now() - 20 * DAY) });
  const live = await mkUser();
  await FbTimePersonLink.create({ organizationId: orgs.connected._id, userId: w._id, fbtimePersonId: P1, fbtimeEmail: 'w@old.co', source: 'auto-email' });
  await FbTimePersonLink.create({ organizationId: orgs.connected._id, userId: live._id, fbtimePersonId: P2, fbtimeEmail: 'live@ok.co', source: 'auto-email' });
  await IntegrationEvent.create({ organizationId: orgs.connected._id, type: 'link-created', detail: { userId: String(w._id).toUpperCase(), fbtimePersonId: P1, userEmail: 'w@old.co' } });
  await IntegrationEvent.create({ organizationId: orgs.connected._id, type: 'link-created', detail: { userId: String(live._id), fbtimePersonId: P2, userEmail: 'live@ok.co' } });
  const old = await mkUser({ isActive: false, deletedAt: new Date(Date.now() - 400 * DAY) });
  await DeletedUserRecord.create({
    userId: old._id, organizationIds: [], deletedAt: old.deletedAt, retentionUntil: new Date(Date.now() - 200 * DAY), purgedAt: new Date(Date.now() - 200 * DAY),
  });
  await FbTimePersonLink.create({ organizationId: orgs.errored._id, userId: old._id, fbtimePersonId: P3, source: 'manual' });

  const runCli = (...args) =>
    execFileSync('node', ['src/migrations/backfillFbtimeDeletionGaps.js', ...args], {
      cwd: SERVER_DIR,
      env: { ...process.env, MONGODB_URI: URI },
      encoding: 'utf8',
    });

  const dry = runCli();
  assert.match(dry, /1\. links of deleted accounts still holding an email: 1/);
  assert.match(dry, /2\. link-created events holding an email: 2/);
  assert.match(dry, /3\. purged accounts still paired with FbTime \(1 purged record\(s\) checked\): 1 link\(s\)/);
  assert.strictEqual((await FbTimePersonLink.findOne({ userId: w._id }).lean()).fbtimeEmail, 'w@old.co', 'a dry run writes nothing');

  runCli('--apply');
  assert.strictEqual((await FbTimePersonLink.findOne({ userId: w._id }).lean()).fbtimeEmail, null);
  assert.strictEqual((await FbTimePersonLink.findOne({ userId: live._id }).lean()).fbtimeEmail, 'live@ok.co', 'a live account keeps its label');
  assert.strictEqual(await IntegrationEvent.countDocuments({ 'detail.userEmail': { $exists: true } }), 0);
  assert.strictEqual(await FbTimePersonLink.countDocuments({ userId: old._id }), 0);

  const again = runCli();
  assert.match(again, /1\. links of deleted accounts still holding an email: 0/);
  assert.match(again, /2\. link-created events holding an email: 0/);
  assert.match(again, /: 0 link\(s\)/);
});
