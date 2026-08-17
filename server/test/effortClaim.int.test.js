import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The claim/move pipeline, end to end, over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/effort_claim_test node --test test/effortClaim.int.test.js
//
// First end-to-end coverage of POST /efforts/:id/claim — the 2026-08 incident route.
// The contract pinned here:
//   1. Without force, owned doors come back as a 409 with a PER-DONOR breakdown
//      (doors lost, books affected, books emptied) — the confirm modal's numbers.
//   2. The route only ENQUEUES; with Redis unreachable it answers 503
//      `queue-unavailable`, never hangs, never claims inline.
//   3. executeClaim (the job body) moves doors, rebuilds donor books in bulk,
//      snapshots every donor pass BEFORE mutating (reason 'move', keyed to the
//      job), releases its locks, and is idempotent under a stall-redelivery.
//   4. The full undo path works: claim back → discard gutted books → restore the
//      'move' snapshot → original books, memberships, and assignments return.
//   5. POST /efforts creates effort+pass even when the seed enqueue fails — the
//      list is unseeded, never half-created.
//
// Redis is pointed at a dead port ON PURPOSE (before any queue import): every
// enqueue in this file must take the queue-unavailable path deterministically,
// even on a machine that happens to run a local Redis.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-effort-claim';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.TURF_ENQUEUE_TIMEOUT_MS = '300';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { TurfSnapshot } = await import('../src/models/TurfSnapshot.js');
const { Household } = await import('../src/models/Household.js');
const { SavedSearch } = await import('../src/models/SavedSearch.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { executeClaim } = await import('../src/services/walklist/claimDoors.js');
const { processTurfJob } = await import('../src/services/turf/turfProcessor.js');
const { acquireRecutLock, releaseRecutLock } = await import('../src/services/turf/recutLock.js');
const { closeQueues } = await import('../src/queues/index.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const hh = (orgId, campaignId, effortId, n) => ({
  organizationId: orgId,
  campaignId,
  effortId,
  addressLine1: `${n} Claim St`,
  city: 'Naples',
  state: 'FL',
  zipCode: '34102',
  normalizedAddress: `${n} CLAIM ST|NAPLES|FL|34102`,
  location: { type: 'Point', coordinates: [-81.79 + n * 0.001, 26.14 + (n % 7) * 0.0008] },
  isActive: true,
  status: 'unknocked',
});

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Effort, Pass, Turf, TurfAssignment, TurfSnapshot, Household, SavedSearch, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Claim Org', slug: 'claim-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'eca@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Canvasser', email: 'ecc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const camp = await Campaign.create({
    organizationId: org._id, name: 'Claim C', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York',
  });

  // Donor list A ("Main"): 12 doors in two published books of its active round.
  // Target list B ("Second"): starts empty. Plus 4 Intake doors nobody owns.
  const effortA = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'Main' });
  const effortB = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'Second' });
  const passA1 = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effortA._id, roundNumber: 1, name: 'Round 1', status: 'active',
  });
  const passB1 = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effortB._id, roundNumber: 1, name: 'Round 1', status: 'draft',
  });

  const aDoors = await Household.insertMany([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => hh(org._id, camp._id, effortA._id, n)));
  const intake = await Household.insertMany([101, 102, 103, 104].map((n) => hh(org._id, camp._id, null, n)));

  const mkBook = async (name, doors) => {
    const t = await Turf.create({
      organizationId: org._id, campaignId: camp._id, passId: passA1._id, name, mode: 'geometric',
      householdIds: doors.map((d) => d._id), doorCount: doors.length, status: 'published',
    });
    await Household.updateMany({ _id: { $in: doors.map((d) => d._id) } }, { $set: { turfId: t._id } });
    return t;
  };
  const book1 = await mkBook('Book 1', aDoors.slice(0, 6));
  const book2 = await mkBook('Book 2', aDoors.slice(6, 12));
  // An assignment on book1 — the snapshot must capture it and restore must recreate it.
  await TurfAssignment.create({
    organizationId: org._id, campaignId: camp._id, passId: passA1._id, turfId: book1._id, userId: canv._id, assignedBy: admin._id,
  });

  // The saved search an admin would build: ALL of book1 (6), HALF of book2 (3), all Intake (4).
  const search = await SavedSearch.create({
    organizationId: org._id, campaignId: camp._id, name: 'Collier-ish', createdBy: admin._id,
    householdIds: [...aDoors.slice(0, 6), ...aDoors.slice(6, 9), ...intake].map((d) => d._id),
  });
  // Exactly the 9 doors that will move — for the undo test's claim-back.
  const searchBack = await SavedSearch.create({
    organizationId: org._id, campaignId: camp._id, name: 'The moved nine', createdBy: admin._id,
    householdIds: aDoors.slice(0, 9).map((d) => d._id),
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, admin, canv, effortA, effortB, passA1, passB1, book1, book2, aDoors, intake, search, searchBack,
    adminTok: signUserToken(admin),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await closeQueues().catch(() => {});
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { token, orgId, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['X-Org-Id'] = String(orgId);
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const effortsBase = () => `/api/admin/campaigns/${ctx.camp._id}/efforts`;
const turfsBase = () => `/api/admin/campaigns/${ctx.camp._id}/turfs`;
const auth = () => ({ token: ctx.adminTok, orgId: ctx.org._id });

test('without force: 409 doors-owned with the per-donor breakdown the modal renders', { skip }, async () => {
  const r = await call('POST', `${effortsBase()}/${ctx.effortB._id}/claim`, { ...auth(), body: { walkListId: String(ctx.search._id) } });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.code, 'doors-owned');
  assert.strictEqual(r.json.conflicts, 9); // 6 of book1 + 3 of book2
  assert.strictEqual(r.json.claimable, 4); // the Intake doors
  assert.strictEqual(r.json.totalBooksAffected, 2);
  assert.strictEqual(r.json.totalBooksEmptied, 1); // only book1 loses ALL its doors
  assert.strictEqual(r.json.breakdown.length, 1);
  const donor = r.json.breakdown[0];
  assert.strictEqual(donor.effortId, String(ctx.effortA._id));
  assert.strictEqual(donor.effortName, 'Main');
  assert.strictEqual(donor.doors, 9);
  assert.strictEqual(donor.booksAffected, 2);
  assert.strictEqual(donor.booksEmptied, 1);
});

test('with force: the route only enqueues — dead Redis answers 503 queue-unavailable, moves nothing', { skip }, async () => {
  const r = await call('POST', `${effortsBase()}/${ctx.effortB._id}/claim`, { ...auth(), body: { walkListId: String(ctx.search._id), force: true } });
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.json.code, 'queue-unavailable');
  // Nothing moved inline — that is the whole point of the queue.
  const stillA = await Household.countDocuments({ effortId: ctx.effortA._id });
  assert.strictEqual(stillA, 12);
});

test('POST /efforts creates effort + pass even when the seed enqueue fails (unseeded, never half-created)', { skip }, async () => {
  const r = await call('POST', effortsBase(), { ...auth(), body: { name: 'Seeded List', seedWalkListId: String(ctx.search._id) } });
  assert.strictEqual(r.status, 201);
  assert.ok(r.json.effort?._id, 'effort created');
  assert.ok(r.json.pass?._id, 'Pass 1 created');
  assert.strictEqual(r.json.claimJobId, null);
  assert.strictEqual(r.json.claimError, 'queue-unavailable');
  assert.ok(await Effort.exists({ _id: r.json.effort._id }), 'effort persisted despite dead queue');
  // No seed source at all → no claim job attempted, no claimError.
  const plain = await call('POST', effortsBase(), { ...auth(), body: { name: 'Plain List' } });
  assert.strictEqual(plain.status, 201);
  assert.strictEqual(plain.json.claimJobId, null);
  assert.strictEqual(plain.json.claimError, null);
});

test('executeClaim all:true claims Intake only — touches no books, takes no locks or snapshots', { skip }, async () => {
  const result = await executeClaim({
    campaignId: ctx.camp._id, effortId: ctx.effortB._id, all: true, force: false, userId: ctx.admin._id,
  });
  assert.strictEqual(result.claimedIntake, 4);
  assert.strictEqual(result.reassigned, 0);
  assert.strictEqual(result.donorPasses, 0);
  assert.strictEqual(await Household.countDocuments({ effortId: ctx.effortB._id }), 4);
  assert.strictEqual(await Household.countDocuments({ effortId: ctx.effortA._id }), 12, 'owned doors untouched');
  assert.strictEqual(await TurfSnapshot.countDocuments({}), 0);
});

test('executeClaim refuses while a donor pass is lock-held, and writes nothing', { skip }, async () => {
  assert.ok(await acquireRecutLock(ctx.passA1._id, ctx.admin._id), 'test could not take the lock');
  try {
    await assert.rejects(
      executeClaim({
        campaignId: ctx.camp._id, effortId: ctx.effortB._id, walkListId: ctx.search._id, force: true, userId: ctx.admin._id, jobId: 'j-lock',
      }),
      /re-cut or restore is in progress/
    );
    assert.strictEqual(await Household.countDocuments({ effortId: ctx.effortA._id }), 12, 'no doors moved');
    assert.strictEqual(await TurfSnapshot.countDocuments({}), 0, 'no snapshot taken');
  } finally {
    await releaseRecutLock(ctx.passA1._id);
  }
});

test('executeClaim force: snapshot before mutation, doors moved, donor books rebuilt in place', { skip }, async () => {
  const result = await executeClaim({
    campaignId: ctx.camp._id, effortId: ctx.effortB._id, walkListId: ctx.search._id, force: true, userId: ctx.admin._id, jobId: 'j-move',
  });
  assert.strictEqual(result.reassigned, 9);
  assert.strictEqual(result.claimedIntake, 0); // Intake was already claimed above
  assert.strictEqual(result.recutBooks, 2);
  assert.strictEqual(result.emptiedBooks, 1);
  assert.strictEqual(result.donorPasses, 1);

  // Doors: 9 moved to B (bookless), 3 remain in A's book2.
  assert.strictEqual(await Household.countDocuments({ effortId: ctx.effortB._id }), 13);
  assert.strictEqual(await Household.countDocuments({ effortId: ctx.effortB._id, turfId: null }), 13, 'moved doors are bookless ON PURPOSE');
  assert.strictEqual(await Household.countDocuments({ effortId: ctx.effortA._id }), 3);

  // Books rebuilt: book1 persists EMPTY (the 0-door badge case), book2 keeps its 3.
  const b1 = await Turf.findById(ctx.book1._id).lean();
  const b2 = await Turf.findById(ctx.book2._id).lean();
  assert.strictEqual(b1.doorCount, 0);
  assert.deepStrictEqual(b1.householdIds, []);
  assert.strictEqual(b1.status, 'published', 'emptied book persists — snapshot is the undo, not resurrection');
  assert.strictEqual(b2.doorCount, 3);
  const keep = new Set(ctx.aDoors.slice(9, 12).map((d) => String(d._id)));
  assert.deepStrictEqual(new Set(b2.householdIds.map(String)), keep);
  // Mirror agrees with the rebuilt book, in its stored walk order.
  for (const [idx, hid] of b2.householdIds.entries()) {
    const d = await Household.findById(hid, { turfId: 1, walkOrder: 1 }).lean();
    assert.strictEqual(String(d.turfId), String(b2._id));
    assert.strictEqual(d.walkOrder, idx);
  }

  // The 'move' snapshot: taken BEFORE mutation (pre-move memberships), keyed to the job.
  const snap = await TurfSnapshot.findOne({ passId: ctx.passA1._id, reason: 'move', jobId: 'j-move' }).lean();
  assert.ok(snap, "donor pass got a reason:'move' snapshot");
  assert.strictEqual(snap.bookCount, 2);
  assert.deepStrictEqual(snap.books.map((b) => b.householdIds.length).sort(), [6, 6], 'snapshot holds PRE-move memberships');
  assert.strictEqual(snap.assignments.length, 1, "book1's assignment captured");

  // Locks released.
  const passAfter = await Pass.findById(ctx.passA1._id, { recutLock: 1 }).lean();
  assert.ok(!passAfter.recutLock?.lockedAt, 'donor pass lock released');
});

test('a stall-redelivered re-run is a no-op: same jobId, no second snapshot, no new writes', { skip }, async () => {
  const result = await executeClaim({
    campaignId: ctx.camp._id, effortId: ctx.effortB._id, walkListId: ctx.search._id, force: true, userId: ctx.admin._id, jobId: 'j-move',
  });
  assert.strictEqual(result.reassigned, 0, 'ownership-keyed sweep finds nothing to move');
  assert.strictEqual(await TurfSnapshot.countDocuments({ reason: 'move', jobId: 'j-move' }), 1, 'snapshot deduped on jobId');
  const b2 = await Turf.findById(ctx.book2._id).lean();
  assert.strictEqual(b2.doorCount, 3, 'books unchanged');
});

test('the full undo path: claim back → discard gutted books → restore the move snapshot', { skip }, async () => {
  // 1. Claim the moved doors back into A. B has no books holding them → no donor
  //    passes, no locks, no new snapshot — move-back never silently rebuilds books.
  const back = await executeClaim({
    campaignId: ctx.camp._id, effortId: ctx.effortA._id, walkListId: ctx.searchBack._id, force: true, userId: ctx.admin._id, jobId: 'j-back',
  });
  assert.strictEqual(back.reassigned, 9);
  assert.strictEqual(back.donorPasses, 0, 'no donor books → nothing locked or snapshotted');
  assert.strictEqual(await TurfSnapshot.countDocuments({ jobId: 'j-back' }), 0);
  assert.strictEqual(await Household.countDocuments({ effortId: ctx.effortA._id }), 12);
  assert.strictEqual(await Household.countDocuments({ effortId: ctx.effortA._id, turfId: null }), 9, 'returned doors are NOT refilled into books');

  // 2. Discard the gutted books (route; active pass → confirmActive).
  const discard = await call('POST', `${turfsBase()}/discard`, { ...auth(), body: { passId: String(ctx.passA1._id), confirmActive: true } });
  assert.strictEqual(discard.status, 200);
  assert.strictEqual(discard.json.discarded, 2);

  // 3. Restore the 'move' snapshot — books, memberships, and the assignment return.
  const snap = await TurfSnapshot.findOne({ passId: ctx.passA1._id, reason: 'move', jobId: 'j-move' }).lean();
  const restore = await call('POST', `${turfsBase()}/restore-snapshot`, { ...auth(), body: { snapshotId: String(snap._id) } });
  assert.strictEqual(restore.status, 200);
  assert.strictEqual(restore.json.restored, 2);

  const books = await Turf.find({ passId: ctx.passA1._id, status: { $in: ['draft', 'published'] } }).lean();
  assert.strictEqual(books.length, 2);
  assert.deepStrictEqual(books.map((b) => b.doorCount).sort(), [6, 6], 'original memberships restored');
  const allRestored = new Set(books.flatMap((b) => b.householdIds.map(String)));
  assert.deepStrictEqual(allRestored, new Set(ctx.aDoors.map((d) => String(d._id))));
  assert.strictEqual(await TurfAssignment.countDocuments({ passId: ctx.passA1._id }), 1, 'assignment recreated');
  assert.strictEqual(await Household.countDocuments({ effortId: ctx.effortA._id, turfId: null }), 0, 'mirror re-pointed');
});

test('processTurfJob dispatches on job.name — claim, generate (default), supplemental', { skip }, async () => {
  const progress = [];
  const fakeJob = (name, data) => ({ id: `fake-${name}`, name, data, updateProgress: async (p) => progress.push(p) });

  // claim: nothing left to claim — clean no-op through the real service.
  const claimRes = await processTurfJob(fakeJob('claim', {
    campaignId: String(ctx.camp._id), effortId: String(ctx.effortB._id), all: true, force: false, requestedBy: String(ctx.admin._id),
  }));
  assert.strictEqual(claimRes.claimedIntake, 0);

  // generate (via an UNKNOWN name → default branch, the pre-deploy-job guarantee):
  // cuts B's 4 doors into books on its draft round.
  const genRes = await processTurfJob(fakeJob('generate-or-anything', {
    campaignId: String(ctx.camp._id), passId: String(ctx.passB1._id), mode: 'geometric', params: { maxDoors: 3 }, generatedBy: String(ctx.admin._id),
  }));
  assert.ok(genRes.bookCount >= 1, 'default branch ran generateTurf');

  // supplemental: every B door is now booked → added 0; and the job's lock is released after.
  const suppRes = await processTurfJob(fakeJob('supplemental', {
    campaignId: String(ctx.camp._id), passId: String(ctx.passB1._id), name: 'New voters', maxDoors: 65, requestedBy: String(ctx.admin._id),
  }));
  assert.strictEqual(suppRes.added, 0);
  const passB = await Pass.findById(ctx.passB1._id, { recutLock: 1 }).lean();
  assert.ok(!passB.recutLock?.lockedAt, 'supplemental job released its lock');
  assert.ok(progress.some((p) => p.phase === 'done'), 'jobs reported progress');
});
