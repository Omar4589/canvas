import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The walk-list archive plan's BOOK guards (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §B.8, §C.4, §C.5)
// over the REAL Express app + a throwaway mongod:
//   npm run test:int -- test/walkListBookGuards.int.test.js
//
// What it pins:
//   • Every pass- or book-scoped WRITE on the Turf Cutting routes (and the per-book assignment
//     router) answers 409 with its code and writes NOTHING, in all three read-only states: an
//     archived pass (`pass-archived`), any pass of an archived walk list — its drafts included —
//     (`walk-list-archived`), and an archived campaign (`campaign-archived`). Never 403: the
//     already-released phone ejects to the org picker on a 403 it doesn't recognise.
//   • What stays open on purpose: deleting a snapshot (in all three states — it is the way out of
//     a Door Outcomes undo hold), unrestrict-bulk / unrestrict-doors on an archived pass or walk
//     list, and reads.
//   • move-door keeps both books in ONE pass (its `from` used to be unconstrained).
//   • Discard re-reads its pass under the recut lock, and reverts a live pass to draft only if it
//     is STILL live — round 2 of the plan's review reproduced a stale revert turning a just-archived
//     pass back into a draft.
//   • The TURF jobs re-check at start and right before their writes, and refuse with BullMQ's
//     UnrecoverableError carrying the guard's own sentence; generate also re-checks AFTER its
//     insert and takes back only its own still-draft books. A claim INTO an archived walk list is
//     refused; a claim OUT of one (a re-carve) still works.
// Job bodies are called directly — there is no Redis here (REDIS_URL points at a dead port, so a
// guard that failed to refuse would surface as a 503, never as a queued job).
// The desk-mark refusals (restrict-doors on an archived walk list) live in restrictDoors.int.test.js,
// and the print-packet exclusion in packet.int.test.js, beside the rest of their routes.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-walk-list-book-guards';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.TURF_ENQUEUE_TIMEOUT_MS = '300';

const { UnrecoverableError } = await import('bullmq');
const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { TurfSnapshot } = await import('../src/models/TurfSnapshot.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SavedSearch } = await import('../src/models/SavedSearch.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { passArchivedBody, walkListArchivedBody } = await import('../src/middleware/campaignWritable.js');
const { buildDeskRestrictRow, DESK_RESTRICT_MATCH } = await import('../src/services/canvass/deskRestrict.js');
const { generateTurf, addSupplementalBooks } = await import('../src/services/turf/generateTurf.js');
const { executeClaim } = await import('../src/services/walklist/claimDoors.js');
const { processTurfJob } = await import('../src/services/turf/turfProcessor.js');
const { closeQueues } = await import('../src/queues/index.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const CAMPAIGN_ARCHIVED_SENTENCE = 'This campaign is archived — reactivate it to make changes.';

let server;
let base;
const ctx = {};

let doorNo = 0;
const door = (org, campaign, effortId, extra = {}) => {
  doorNo += 1;
  return {
    organizationId: org._id,
    campaignId: campaign._id,
    effortId,
    addressLine1: `${doorNo} Guard Rail Rd`,
    city: 'Tampa',
    state: 'FL',
    zipCode: '33602',
    normalizedAddress: `${doorNo} GUARD RAIL RD|TAMPA|FL|33602`,
    location: { type: 'Point', coordinates: [-82.46 + doorNo * 0.0007, 27.95 + (doorNo % 5) * 0.0005] },
    isActive: true,
    status: 'unknocked',
    ...extra,
  };
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();

  const org = await Organization.create({ name: 'Guard Org', slug: 'guard-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ga@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Canvasser', email: 'gc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const t0 = new Date(Date.now() - 10 * 86400e3);
  const t1 = new Date(Date.now() - 5 * 86400e3);

  // ── Campaign C (live) ──
  const camp = await Campaign.create({ organizationId: org._id, name: 'Guard C', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York' });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: canv._id });
  const mkEffort = (name, extra = {}) => Effort.create({ organizationId: org._id, campaignId: camp._id, name, ...extra });
  const mkPass = (campaign, effort, roundNumber, name, status, extra = {}) =>
    Pass.create({ organizationId: org._id, campaignId: campaign._id, effortId: effort._id, roundNumber, name, status, ...extra });
  const mkBook = async (campaign, pass, name, status, doors, { mirror = true } = {}) => {
    const t = await Turf.create({
      organizationId: org._id, campaignId: campaign._id, passId: pass._id, name, mode: 'geometric', status,
      householdIds: doors.map((d) => d._id), doorCount: doors.length,
    });
    if (mirror) {
      for (const [i, d] of doors.entries()) await Household.updateOne({ _id: d._id }, { $set: { turfId: t._id, walkOrder: i } });
    }
    return t;
  };
  const mkSnapshot = (campaign, pass) =>
    TurfSnapshot.create({ organizationId: org._id, campaignId: campaign._id, passId: pass._id, reason: 'discard', books: [], bookCount: 0 });

  // W1 "North" (open): Pass 1 ARCHIVED (ended by hand), Pass 2 · GOTV live.
  const w1 = await mkEffort('North');
  const p1 = await mkPass(camp, w1, 1, 'Pass 1', 'archived', { activatedAt: t0, archivedAt: t1, archivedFrom: 'active', archivedVia: 'pass' });
  const p2 = await mkPass(camp, w1, 2, 'GOTV', 'active', { activatedAt: t1, lastActivatedAt: t1 });
  const [d1, d2, d3, d4, d5, d6] = await Household.insertMany([1, 2, 3, 4, 5, 6].map(() => door(org, camp, w1._id)));
  // A door the apartment rule set aside: a wrongly allowed include-apartments would flip it.
  const d10 = await Household.create(door(org, camp, w1._id, { excludedFromTurf: true }));
  const b11 = await mkBook(camp, p1, 'P1 Book 1', 'published', [d1, d2, d3], { mirror: false });
  const b12 = await mkBook(camp, p1, 'P1 Book 2', 'published', [d4, d5], { mirror: false });
  const b13 = await mkBook(camp, p1, 'P1 Draft', 'draft', [d6], { mirror: false });
  const b21 = await mkBook(camp, p2, 'GOTV Book 1', 'published', [d1, d2, d3]);
  const b22 = await mkBook(camp, p2, 'GOTV Book 2', 'published', [d4, d5]);
  await mkBook(camp, p2, 'GOTV Draft', 'draft', [d6]);
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: p1._id, turfId: b11._id, userId: canv._id });
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: p2._id, turfId: b21._id, userId: canv._id });
  const s1 = await mkSnapshot(camp, p1);

  // W2 "West" (ARCHIVED): its Pass 1 stayed a draft, with an accepted book and a draft book.
  const w2 = await mkEffort('West', { status: 'archived', archivedAt: t1, archivedBy: admin._id });
  const p3 = await mkPass(camp, w2, 1, 'Pass 1', 'draft');
  const [d7, d8, d9] = await Household.insertMany([7, 8, 9].map(() => door(org, camp, w2._id)));
  const d11 = await Household.create(door(org, camp, w2._id, { excludedFromTurf: true }));
  const b31 = await mkBook(camp, p3, 'West Book 1', 'published', [d7, d8]);
  const b32 = await mkBook(camp, p3, 'West Draft', 'draft', [d9]);
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: p3._id, turfId: b31._id, userId: canv._id });
  const s3 = await mkSnapshot(camp, p3);

  // Desk marks already on the frozen and archived passes: unmarking them must keep working.
  const now = new Date();
  await CanvassActivity.insertMany([
    buildDeskRestrictRow({ hh: d1, userId: admin._id, passId: p1._id, turfId: b11._id, now }),
    buildDeskRestrictRow({ hh: d7, userId: admin._id, passId: p3._id, turfId: b31._id, now }),
    buildDeskRestrictRow({ hh: d8, userId: admin._id, passId: p3._id, turfId: b31._id, now }),
  ]);

  // ── Campaign C2 (ARCHIVED) with an ordinary open walk list and a live pass ──
  const camp2 = await Campaign.create({
    organizationId: org._id, name: 'Guard C2', type: 'survey', state: 'FL', isActive: false, archivedAt: t1, timeZone: 'America/New_York',
  });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp2._id, userId: canv._id });
  const w3 = await Effort.create({ organizationId: org._id, campaignId: camp2._id, name: 'East' });
  const p4 = await mkPass(camp2, w3, 1, 'Pass 1', 'active', { activatedAt: t0, lastActivatedAt: t0 });
  const [d20, d21, d22, d23] = await Household.insertMany([20, 21, 22, 23].map(() => door(org, camp2, w3._id)));
  await Household.create(door(org, camp2, w3._id, { excludedFromTurf: true }));
  const b41 = await mkBook(camp2, p4, 'East Book 1', 'published', [d20, d21]);
  const b42 = await mkBook(camp2, p4, 'East Book 2', 'published', [d22]);
  const b43 = await mkBook(camp2, p4, 'East Draft', 'draft', [d23]);
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp2._id, passId: p4._id, turfId: b41._id, userId: canv._id });
  const s4 = await mkSnapshot(camp2, p4);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, canv, camp, camp2, mkEffort, mkPass, mkBook,
    w1, w2, w3, p1, p2, p3, p4,
    b11, b12, b13, b21, b22, b31, b32, b41, b42, b43, s1, s3, s4,
    d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d20, d21, d22, d23,
    adminTok: signUserToken(admin),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await closeQueues().catch(() => {});
  if (URI) await mongoose.disconnect();
});

const call = async (method, path, body) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ctx.adminTok}`,
      'X-Org-Id': String(ctx.org._id),
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
};

const id = (x) => String(x?._id ?? x);
const turfsBase = (campaign) => `/admin/campaigns/${id(campaign)}/turfs`;

// Everything a book write could touch, as one comparable string.
const world = async () => {
  const [turfs, assignments, passes, households, activities, snapshots] = await Promise.all([
    Turf.find({}, { name: 1, status: 1, passId: 1, householdIds: 1, doorCount: 1 }).sort({ _id: 1 }).lean(),
    TurfAssignment.find({}, { turfId: 1, userId: 1 }).sort({ _id: 1 }).lean(),
    Pass.find({}, { status: 1, archivedAt: 1, targetFilter: 1 }).sort({ _id: 1 }).lean(),
    Household.find({}, { turfId: 1, walkOrder: 1, excludedFromTurf: 1, effortId: 1, status: 1 }).sort({ _id: 1 }).lean(),
    CanvassActivity.find({}, { _id: 1 }).sort({ _id: 1 }).lean(),
    TurfSnapshot.find({}, { restoredAt: 1 }).sort({ _id: 1 }).lean(),
  ]);
  return JSON.stringify({ turfs, assignments, passes, households, activities, snapshots });
};

// Every pass- or book-scoped write B.8 refuses, aimed at one read-only pass and its books:
// `bookA`/`bookB` two of its books, `bookDraft` a draft one, `doorA` in bookA, `doorB` in bookB.
const guardedWrites = (s) => {
  const b = turfsBase(s.campaign);
  return [
    ['generate', 'POST', `${b}/generate`, { passId: id(s.pass), mode: 'geometric', params: { maxDoors: 65 } }],
    ['accept', 'POST', `${b}/accept`, { passId: id(s.pass) }],
    ['add-supplemental', 'POST', `${b}/add-supplemental`, { passId: id(s.pass) }],
    ['discard (all)', 'POST', `${b}/discard`, { passId: id(s.pass), confirmActive: true }],
    ['discard (drafts)', 'POST', `${b}/discard`, { passId: id(s.pass), scope: 'drafts' }],
    ['restore-snapshot', 'POST', `${b}/restore-snapshot`, { snapshotId: id(s.snapshot) }],
    ['exclude-apartments', 'POST', `${b}/exclude-apartments`, { passId: id(s.pass), threshold: 2 }],
    ['include-apartments', 'POST', `${b}/include-apartments`, { passId: id(s.pass) }],
    ['rename book', 'PATCH', `${b}/${id(s.bookA)}`, { name: 'Renamed' }],
    ['delete book', 'DELETE', `${b}/${id(s.bookDraft)}`],
    ['merge', 'POST', `${b}/merge`, { turfIds: [id(s.bookA), id(s.bookB)] }],
    ['split', 'POST', `${b}/${id(s.bookA)}/split`, { householdIds: [id(s.doorA)] }],
    ['move-door', 'POST', `${b}/move-door`, { householdId: id(s.doorB), toTurfId: id(s.bookA) }],
    ['move-doors (to a book)', 'POST', `${b}/move-doors`, { householdIds: [id(s.doorB)], toTurfId: id(s.bookA) }],
    ['move-doors (new book)', 'POST', `${b}/move-doors`, { householdIds: [id(s.doorB)], newBook: { passId: id(s.pass) } }],
    ['restrict-bulk', 'POST', `${b}/restrict-bulk`, { turfIds: [id(s.bookA)] }],
    ['restrict-doors', 'POST', `${b}/restrict-doors`, { householdIds: [id(s.doorA)], passId: id(s.pass) }],
    ['assign-bulk', 'POST', `${b}/assign-bulk`, { turfIds: [id(s.bookA)], userIds: [id(ctx.canv)], mode: 'everyone', replace: true }],
    ['unassign-bulk', 'POST', `${b}/unassign-bulk`, { turfIds: [id(s.bookA)], userIds: [id(ctx.canv)] }],
    ['assign', 'POST', `${b}/${id(s.bookA)}/assignments`, { userIds: [id(ctx.canv)] }],
    ['unassign', 'DELETE', `${b}/${id(s.bookA)}/assignments/${id(ctx.canv)}`],
  ];
};

const expectEveryWriteRefused = async (s, code, sentence) => {
  for (const [label, method, path, body] of guardedWrites(s)) {
    const before = await world();
    const r = await call(method, path, body);
    assert.strictEqual(r.status, 409, `${label}: ${JSON.stringify(r.json)}`);
    assert.strictEqual(r.json?.code, code, `${label}: ${JSON.stringify(r.json)}`);
    if (sentence) assert.strictEqual(r.json.error, sentence(label), `${label}: the sentence names the thing and the way out`);
    assert.strictEqual(await world(), before, `${label}: a refusal writes nothing`);
  }
};

const nameOf = (pass) => ({ roundNumber: pass.roundNumber, name: pass.name });

// Lands `inject` once, right before the first `Model[method]` query whose (filter, update) `when`
// matches — the app runs in this process, so a test can put a concurrent write at an exact point
// inside a request. Returns the restore, which reports whether it fired.
const injectBefore = (Model, method, when, inject) => {
  const own = Object.prototype.hasOwnProperty.call(Model, method);
  const real = Model[method];
  let fired = false;
  Model[method] = (...args) => {
    const q = real.apply(Model, args);
    if (!fired && when(args[0], args[1])) {
      fired = true;
      const exec = q.exec.bind(q);
      q.exec = async (...a) => {
        await inject();
        return exec(...a);
      };
    }
    return q;
  };
  return () => {
    if (own) Model[method] = real;
    else delete Model[method];
    return fired;
  };
};

test('an archived pass is view-only: every book write answers 409 pass-archived and writes nothing', { skip }, async () => {
  const s = { campaign: ctx.camp, pass: ctx.p1, snapshot: ctx.s1, bookA: ctx.b11, bookB: ctx.b12, bookDraft: ctx.b13, doorA: ctx.d1, doorB: ctx.d4 };
  const standard = passArchivedBody(nameOf(ctx.p1)).error;
  assert.strictEqual(standard, 'Pass 1 is archived — bring it back to change it.');
  // restrict-doors with an explicit archived round keeps its own desk-mark sentence (same code).
  await expectEveryWriteRefused(s, 'pass-archived', (label) =>
    label === 'restrict-doors' ? 'That round is archived — a desk mark there would never reach a canvasser.' : standard
  );
});

test('a draft of an archived walk list is frozen: every book write answers 409 walk-list-archived', { skip }, async () => {
  const s = { campaign: ctx.camp, pass: ctx.p3, snapshot: ctx.s3, bookA: ctx.b31, bookB: ctx.b32, bookDraft: ctx.b32, doorA: ctx.d7, doorB: ctx.d9 };
  const standard = walkListArchivedBody({ name: 'West' }).error;
  assert.strictEqual(standard, 'Walk list "West" is archived — unarchive it to change it.');
  // The two desk-mark routes speak C.8's wording.
  const desk = 'Walk list "West" is archived — unarchive it to mark its doors.';
  await expectEveryWriteRefused(s, 'walk-list-archived', (label) => (label.startsWith('restrict-') ? desk : standard));
});

test('an archived campaign refuses the same writes with campaign-archived', { skip }, async () => {
  const s = { campaign: ctx.camp2, pass: ctx.p4, snapshot: ctx.s4, bookA: ctx.b41, bookB: ctx.b42, bookDraft: ctx.b43, doorA: ctx.d20, doorB: ctx.d22 };
  await expectEveryWriteRefused(s, 'campaign-archived', () => CAMPAIGN_ARCHIVED_SENTENCE);
});

test('the same writes still work on the live pass next door (the 409s above are the guard, not the fixture)', { skip }, async () => {
  const rename = await call('PATCH', `${turfsBase(ctx.camp)}/${id(ctx.b21)}`, { name: 'GOTV Book 1 (north end)' });
  assert.strictEqual(rename.status, 200, JSON.stringify(rename.json));
  const accept = await call('POST', `${turfsBase(ctx.camp)}/accept`, { passId: id(ctx.p2) });
  assert.strictEqual(accept.status, 200, JSON.stringify(accept.json));
  assert.strictEqual(accept.json.published, 1, 'the GOTV draft book');
  // generate passes the guard; its next answer is the route's own 409 has-published-books (the
  // pass has accepted books), never a guard's.
  const gen = await call('POST', `${turfsBase(ctx.camp)}/generate`, { passId: id(ctx.p2), mode: 'geometric', params: {} });
  assert.strictEqual(gen.json?.code, 'has-published-books', JSON.stringify(gen.json));
});

test('deleting a snapshot stays open on an archived pass, an archived walk list and an archived campaign', { skip }, async () => {
  for (const [label, campaign, snap] of [['archived pass', ctx.camp, ctx.s1], ['archived walk list', ctx.camp, ctx.s3], ['archived campaign', ctx.camp2, ctx.s4]]) {
    const r = await call('DELETE', `${turfsBase(campaign)}/snapshots/${id(snap)}`);
    assert.strictEqual(r.status, 200, `${label}: ${JSON.stringify(r.json)}`);
    assert.deepStrictEqual(r.json, { deleted: 1 });
    assert.strictEqual(await TurfSnapshot.countDocuments({ _id: snap._id }), 0, `${label}: gone`);
    // Under the lock the delete is its own re-read: a second delete says the snapshot is gone.
    const again = await call('DELETE', `${turfsBase(campaign)}/snapshots/${id(snap)}`);
    assert.strictEqual(again.status, 404, `${label}: ${JSON.stringify(again.json)}`);
  }
  // The carve-out is that one route only: another DELETE on the archived campaign is still refused.
  const other = await call('DELETE', `${turfsBase(ctx.camp2)}/${id(ctx.b43)}`);
  assert.strictEqual(other.status, 409);
  assert.strictEqual(other.json.code, 'campaign-archived');
});

test('a snapshot removed while the delete waited for its lock answers 404, not a delete that didn’t happen', { skip }, async () => {
  const snap = await TurfSnapshot.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, passId: ctx.p1._id, reason: 'discard', books: [], bookCount: 0 });
  const restore = injectBefore(
    TurfSnapshot,
    'deleteOne',
    (filter) => String(filter?._id) === id(snap),
    () => TurfSnapshot.collection.deleteOne({ _id: snap._id })
  );
  let r;
  try {
    r = await call('DELETE', `${turfsBase(ctx.camp)}/snapshots/${id(snap)}`);
  } finally {
    assert.ok(restore(), 'the race was injected');
  }
  assert.strictEqual(r.status, 404, JSON.stringify(r.json));
  assert.ok(!(await Pass.findById(ctx.p1._id, { recutLock: 1 }).lean()).recutLock?.lockedAt, 'the lock is released');
});

test('unrestrict stays open on an archived pass and an archived walk list (a correction of the office’s own marks)', { skip }, async () => {
  const bulk = await call('POST', `${turfsBase(ctx.camp)}/unrestrict-bulk`, { turfIds: [id(ctx.b11)] });
  assert.strictEqual(bulk.status, 200, JSON.stringify(bulk.json));
  assert.deepStrictEqual(bulk.json, { unmarked: 1, households: 1 }, 'the desk mark on the archived pass is gone');

  const doors = await call('POST', `${turfsBase(ctx.camp)}/unrestrict-doors`, { householdIds: [id(ctx.d7)], passId: id(ctx.p3) });
  assert.strictEqual(doors.status, 200, JSON.stringify(doors.json));
  assert.strictEqual(doors.json.unmarked, 1, 'the frozen draft’s mark is gone');

  // With no passId, a door of an archived walk list still resolves (its single draft) for an UNMARK.
  const resolved = await call('POST', `${turfsBase(ctx.camp)}/unrestrict-doors`, { householdIds: [id(ctx.d8)] });
  assert.strictEqual(resolved.status, 200, JSON.stringify(resolved.json));
  assert.strictEqual(resolved.json.passId, id(ctx.p3));
  assert.strictEqual(resolved.json.unmarked, 1);
  assert.strictEqual(await CanvassActivity.countDocuments({ ...DESK_RESTRICT_MATCH, campaignId: ctx.camp._id }), 0);
});

test('move-door keeps both books in one pass: a `from` in another pass is refused, and moves nothing', { skip }, async () => {
  const before = await world();
  // to = GOTV Book 1 (live Pass 2), from = Pass 1's book (archived) holding the same door.
  const cross = await call('POST', `${turfsBase(ctx.camp)}/move-door`, { householdId: id(ctx.d4), fromTurfId: id(ctx.b12), toTurfId: id(ctx.b21) });
  assert.strictEqual(cross.status, 400, JSON.stringify(cross.json));
  assert.strictEqual(cross.json.code, 'different-pass');
  assert.strictEqual(await world(), before, 'neither book changed');

  // Inside one pass it still works — and the `from` is found by membership when omitted.
  const ok = await call('POST', `${turfsBase(ctx.camp)}/move-door`, { householdId: id(ctx.d4), toTurfId: id(ctx.b21) });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.strictEqual(ok.json.from?.id, id(ctx.b22));
  assert.ok((await Turf.findById(ctx.b21._id).lean()).householdIds.map(String).includes(id(ctx.d4)));
  assert.deepStrictEqual((await Turf.findById(ctx.b12._id).lean()).householdIds.map(String), [id(ctx.d4), id(ctx.d5)], 'the archived pass’s book untouched');
});

const raceFixture = async (name) => {
  const effort = await ctx.mkEffort(name);
  const live = await ctx.mkPass(ctx.camp, effort, 1, 'Pass 1', 'active', { activatedAt: new Date(), lastActivatedAt: new Date() });
  const next = await ctx.mkPass(ctx.camp, effort, 2, 'Pass 2', 'draft');
  const doors = await Household.insertMany([1, 2].map(() => door(ctx.org, ctx.camp, effort._id)));
  const book = await ctx.mkBook(ctx.camp, live, `${name} Book`, 'published', doors);
  await ctx.mkBook(ctx.camp, next, `${name} Next Book`, 'published', doors, { mirror: false });
  return { effort, live, next, book };
};

test('discard race 1: an archive between the discard’s read and its lock wins — 409, books kept, still archived', { skip }, async () => {
  const { live, book } = await raceFixture('Race One');
  const restore = injectBefore(
    Pass,
    'findOneAndUpdate',
    (filter, update) => String(filter?._id) === id(live) && update?.$set?.recutLock,
    // What archivePass writes (it takes the recut lock, ends the pass, releases): the discard read
    // the pass live, and its own lock lands just after.
    () => Pass.collection.updateOne(
      { _id: live._id },
      { $set: { status: 'archived', archivedAt: new Date(), archivedFrom: 'active', archivedVia: 'pass', archivedBy: ctx.admin._id } }
    )
  );
  let r;
  try {
    r = await call('POST', `${turfsBase(ctx.camp)}/discard`, { passId: id(live), confirmActive: true });
  } finally {
    assert.ok(restore(), 'the race was injected');
  }
  assert.strictEqual(r.status, 409, JSON.stringify(r.json));
  assert.strictEqual(r.json.code, 'pass-archived');
  const after = await Pass.findById(live._id).lean();
  assert.strictEqual(after.status, 'archived', 'never turned back into a draft');
  assert.ok(!after.recutLock?.lockedAt, 'the lock is released');
  assert.strictEqual(await Turf.countDocuments({ _id: book._id }), 1, 'nothing discarded into an archived pass');
  assert.strictEqual(await TurfSnapshot.countDocuments({ passId: live._id }), 0, 'no snapshot either');
});

test('discard race 2: the next pass going live mid-discard (no lock) is not undone — the revert is conditional', { skip }, async () => {
  const { live, next, book } = await raceFixture('Race Two');
  // Activation never waits for the ended pass's recut lock (§B.6), so it can land after the
  // discard's re-check — here, as the discard deletes the books.
  const restore = injectBefore(
    Turf,
    'deleteMany',
    (filter) => Array.isArray(filter?._id?.$in) && filter._id.$in.map(String).includes(id(book)),
    async () => {
      const now = new Date();
      await Pass.collection.updateOne(
        { _id: live._id },
        { $set: { status: 'archived', archivedAt: now, archivedFrom: 'active', archivedVia: 'next-pass', endedByPassId: next._id } }
      );
      await Pass.collection.updateOne({ _id: next._id }, { $set: { status: 'active', activatedAt: now, lastActivatedAt: now } });
    }
  );
  let r;
  try {
    r = await call('POST', `${turfsBase(ctx.camp)}/discard`, { passId: id(live), confirmActive: true });
  } finally {
    assert.ok(restore(), 'the race was injected');
  }
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.reverted, false, 'nothing reverted');
  assert.strictEqual((await Pass.findById(live._id).lean()).status, 'archived', 'the ended pass stays ended');
  assert.strictEqual((await Pass.findById(next._id).lean()).status, 'active', 'and the next pass stays live');
  assert.strictEqual(await Turf.countDocuments({ _id: book._id }), 0, 'the discard that started first finished');
});

test('discard of a live pass still reverts it to draft when nothing raced it', { skip }, async () => {
  const { live } = await raceFixture('Plain Discard');
  const r = await call('POST', `${turfsBase(ctx.camp)}/discard`, { passId: id(live), confirmActive: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.reverted, true);
  assert.strictEqual((await Pass.findById(live._id).lean()).status, 'draft');
});

// ── The TURF jobs (§C.5) ──

const assertUnrecoverable = async (promise, message) => {
  let caught = null;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'the job must refuse');
  assert.ok(caught instanceof UnrecoverableError, `an UnrecoverableError, so BullMQ never retries it (got ${caught?.name}: ${caught?.message})`);
  assert.strictEqual(caught.name, 'UnrecoverableError');
  if (message) assert.strictEqual(caught.message, message);
  return caught;
};

test('generate refuses at its start check — archived pass, frozen draft, archived campaign — and writes no book', { skip }, async () => {
  const before = await world();
  const cut = (campaign, pass) =>
    generateTurf({ campaignId: campaign._id, passId: pass._id, mode: 'geometric', params: { maxDoors: 2 }, generationJobId: 'job-start' });
  await assertUnrecoverable(cut(ctx.camp, ctx.p1), passArchivedBody(nameOf(ctx.p1)).error);
  await assertUnrecoverable(cut(ctx.camp, ctx.p3), walkListArchivedBody({ name: 'West' }).error);
  await assertUnrecoverable(cut(ctx.camp2, ctx.p4), CAMPAIGN_ARCHIVED_SENTENCE);
  assert.strictEqual(await Turf.countDocuments({ generationJobId: 'job-start' }), 0);
  assert.strictEqual(await world(), before, 'not even the old drafts were wiped');
});

const cutFixture = async () => {
  const effort = await ctx.mkEffort('Cutting');
  const pass = await ctx.mkPass(ctx.camp, effort, 1, 'Pass 1', 'draft');
  const doors = await Household.insertMany([1, 2, 3, 4, 5, 6].map(() => door(ctx.org, ctx.camp, effort._id)));
  ctx.cut = { effort, pass, doors };
  return ctx.cut;
};

test('generate re-checks right before its first write: an archive during the cut keeps even the old drafts', { skip }, async () => {
  const { effort, pass, doors } = await cutFixture();
  const prior = await ctx.mkBook(ctx.camp, pass, 'Earlier draft', 'draft', [doors[0]]);
  let fired = false;
  await assertUnrecoverable(
    generateTurf({
      campaignId: ctx.camp._id, passId: pass._id, mode: 'geometric', params: { maxDoors: 2 }, generationJobId: 'job-pre',
      onProgress: async (p) => {
        if (p.phase === 'clustering' && !fired) {
          fired = true;
          await Effort.updateOne({ _id: effort._id }, { $set: { status: 'archived', archivedAt: new Date() } });
        }
      },
    }),
    walkListArchivedBody({ name: 'Cutting' }).error
  );
  assert.ok(fired);
  assert.strictEqual(await Turf.countDocuments({ passId: pass._id, generationJobId: 'job-pre' }), 0, 'no book inserted');
  assert.strictEqual(await Turf.countDocuments({ _id: prior._id }), 1, 'the earlier draft was not wiped either');
  await Effort.updateOne({ _id: effort._id }, { $set: { status: 'active', archivedAt: null } });
});

test('generate re-checks AFTER its insert: its own drafts go, a book accepted meanwhile stays, and it fails unrecoverably', { skip }, async () => {
  const { pass, doors } = ctx.cut;
  const own = Object.prototype.hasOwnProperty.call(Household, 'bulkWrite');
  const realBulkWrite = Household.bulkWrite;
  let accepted = null;
  // The first household bulkWrite is generate's mirror loop — just after the insert. An Accept and
  // then an Archive land there (generate holds no lock).
  Household.bulkWrite = async (...args) => {
    if (!accepted) {
      const mine = await Turf.find({ passId: pass._id, generationJobId: 'job-post' }).sort({ _id: 1 }).lean();
      accepted = mine[0]._id;
      assert.ok(mine.length >= 2, `the cut made several books (${mine.length})`);
      await Turf.collection.updateOne({ _id: accepted }, { $set: { status: 'published' } });
      await Pass.collection.updateOne({ _id: pass._id }, { $set: { status: 'archived', archivedAt: new Date(), archivedFrom: 'draft', archivedVia: 'pass' } });
    }
    return realBulkWrite.apply(Household, args);
  };
  try {
    await assertUnrecoverable(
      generateTurf({ campaignId: ctx.camp._id, passId: pass._id, mode: 'geometric', params: { maxDoors: 2 }, generationJobId: 'job-post' }),
      passArchivedBody(nameOf(pass)).error
    );
  } finally {
    if (own) Household.bulkWrite = realBulkWrite;
    else delete Household.bulkWrite;
  }
  const left = await Turf.find({ passId: pass._id }).lean();
  assert.deepStrictEqual(left.map((t) => id(t)), [id(accepted)], 'only the accepted book is left');
  assert.strictEqual(left[0].status, 'published');
  const keptDoors = new Set(left[0].householdIds.map(String));
  for (const d of await Household.find({ _id: { $in: doors.map((x) => x._id) } }, { turfId: 1, walkOrder: 1 }).lean()) {
    if (keptDoors.has(id(d))) assert.strictEqual(String(d.turfId), id(accepted), 'the accepted book keeps its mirror');
    else assert.strictEqual(d.turfId, null, 'a taken-back draft’s door loses its mirror');
  }
});

test('the supplemental job re-checks: at its start (under its lock) and right before its insert', { skip }, async () => {
  // Start: the frozen draft of an archived walk list.
  await assertUnrecoverable(addSupplementalBooks({ campaignId: ctx.camp._id, passId: ctx.p3._id }), walkListArchivedBody({ name: 'West' }).error);

  // Before the insert: the cut pass is a draft again, with bookless doors to add, and its walk list
  // is archived while the job clusters — a walk-list archive locks only a LIVE pass.
  const { effort, pass } = ctx.cut;
  await Pass.updateOne({ _id: pass._id }, { $set: { status: 'draft', archivedAt: null, archivedFrom: null, archivedVia: null } });
  let fired = false;
  await assertUnrecoverable(
    addSupplementalBooks({
      campaignId: ctx.camp._id, passId: pass._id, name: 'Late doors',
      onProgress: async (p) => {
        if (p.phase === 'clustering' && !fired) {
          fired = true;
          await Effort.updateOne({ _id: effort._id }, { $set: { status: 'archived', archivedAt: new Date() } });
        }
      },
    }),
    walkListArchivedBody({ name: 'Cutting' }).error
  );
  assert.ok(fired, 'there were bookless doors to cluster');
  assert.strictEqual(await Turf.countDocuments({ passId: pass._id, 'params.supplemental': true }), 0, 'no supplemental book inserted');
});

test('processTurfJob lets the refusal reach BullMQ as thrown — generate and supplemental — and releases the lock', { skip }, async () => {
  const fakeJob = (name, data) => ({ id: `guard-${name}`, name, data, updateProgress: async () => {} });
  await assertUnrecoverable(
    processTurfJob(fakeJob('generate', { campaignId: id(ctx.camp), passId: id(ctx.p1), mode: 'geometric', params: {}, generatedBy: id(ctx.admin) })),
    passArchivedBody(nameOf(ctx.p1)).error
  );
  await assertUnrecoverable(
    processTurfJob(fakeJob('supplemental', { campaignId: id(ctx.camp), passId: id(ctx.p1), name: 'New voters', maxDoors: 65, requestedBy: id(ctx.admin) })),
    passArchivedBody(nameOf(ctx.p1)).error
  );
  assert.ok(!(await Pass.findById(ctx.p1._id, { recutLock: 1 }).lean()).recutLock?.lockedAt, 'the supplemental released its lock');
  await assertUnrecoverable(
    processTurfJob(fakeJob('claim', { campaignId: id(ctx.camp), effortId: id(ctx.w2), all: true, force: false, requestedBy: id(ctx.admin) })),
    walkListArchivedBody({ name: 'West' }).error
  );
});

// ── Claims (§C.5, F3) ──

test('a claim INTO an archived walk list is refused — at the start, and right before the first move', { skip }, async () => {
  const intake = await Household.create(door(ctx.org, ctx.camp, null));
  await assertUnrecoverable(
    executeClaim({ campaignId: ctx.camp._id, effortId: ctx.w2._id, all: true, userId: ctx.admin._id }),
    walkListArchivedBody({ name: 'West' }).error
  );
  assert.strictEqual((await Household.findById(intake._id).lean()).effortId, null, 'the Intake door stayed put');

  // Archived while the job snapshots its donor: refused before any move; the snapshot is kept.
  const donor = await ctx.mkEffort('Donor');
  const donorPass = await ctx.mkPass(ctx.camp, donor, 1, 'Pass 1', 'active', { activatedAt: new Date(), lastActivatedAt: new Date() });
  const donorDoors = await Household.insertMany([1, 2].map(() => door(ctx.org, ctx.camp, donor._id)));
  const donorBook = await ctx.mkBook(ctx.camp, donorPass, 'Donor Book', 'published', donorDoors);
  const target = await ctx.mkEffort('Target');
  const search = await SavedSearch.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, name: 'One donor door', createdBy: ctx.admin._id,
    householdIds: [donorDoors[0]._id],
  });
  let fired = false;
  await assertUnrecoverable(
    executeClaim({
      campaignId: ctx.camp._id, effortId: target._id, walkListId: search._id, force: true, userId: ctx.admin._id, jobId: 'j-target',
      onProgress: async (p) => {
        if (p.phase === 'snapshotting' && !fired) {
          fired = true;
          await Effort.updateOne({ _id: target._id }, { $set: { status: 'archived', archivedAt: new Date() } });
        }
      },
    }),
    walkListArchivedBody({ name: 'Target' }).error
  );
  assert.ok(fired);
  assert.strictEqual(String((await Household.findById(donorDoors[0]._id).lean()).effortId), id(donor), 'no door moved');
  assert.strictEqual((await Turf.findById(donorBook._id).lean()).householdIds.length, 2, 'the donor book is whole');
  assert.strictEqual(await TurfSnapshot.countDocuments({ passId: donorPass._id, reason: 'move', jobId: 'j-target' }), 1, 'the snapshot it took is kept');
  assert.ok(!(await Pass.findById(donorPass._id, { recutLock: 1 }).lean()).recutLock?.lockedAt, 'the donor lock is released');

  // And on an archived campaign.
  await assertUnrecoverable(
    executeClaim({ campaignId: ctx.camp2._id, effortId: ctx.w3._id, all: true, userId: ctx.admin._id }),
    CAMPAIGN_ARCHIVED_SENTENCE
  );
});

test('a claim OUT of an archived walk list still works: the re-carve moves the door and shrinks the frozen book', { skip }, async () => {
  const recarve = await ctx.mkEffort('Recarve');
  const search = await SavedSearch.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, name: 'West door', createdBy: ctx.admin._id,
    householdIds: [ctx.d7._id],
  });
  const result = await executeClaim({
    campaignId: ctx.camp._id, effortId: recarve._id, walkListId: search._id, force: true, userId: ctx.admin._id, jobId: 'j-out',
  });
  assert.strictEqual(result.reassigned, 1);
  assert.strictEqual(result.donorPasses, 1, 'the frozen draft was locked and snapshotted as a donor');
  assert.strictEqual(String((await Household.findById(ctx.d7._id).lean()).effortId), id(recarve));
  assert.deepStrictEqual((await Turf.findById(ctx.b31._id).lean()).householdIds.map(String), [id(ctx.d8)], 'the archived walk list’s book shrank');
  assert.strictEqual(await TurfSnapshot.countDocuments({ passId: ctx.p3._id, reason: 'move', jobId: 'j-out' }), 1);
  assert.strictEqual((await Effort.findById(ctx.w2._id).lean()).status, 'archived', 'the donor stays archived');
});
