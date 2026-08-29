import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Three assignment-row contracts on the cut page, over the REAL Express app + throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/turfhygiene_test node --test test/turfAssignmentHygiene.int.test.js
//
//   · GET /turfs/assignments LABELS deactivated members (`user.inactive`) and changes no count.
//     Deactivating a member deliberately KEEPS their books (memberships.js skips
//     releaseAssignedWork), so a book held only by switched-off people reports as covered while
//     nobody on the roster can open it. The flag is what lets the page say so. It is set only on
//     POSITIVE evidence — an isActive:false membership or user — never on absence of a roster
//     row, or a superadmin doing cross-org oversight would render as "deactivated".
//   · DISCARD leaves no assignment row behind. The turfId-scoped sweep is built from the
//     draft/published ids, so an archived merge-stub's rows used to outlive every book — and
//     /turfs/assignments never joins Turf, so an orphan is served to the page forever, counting
//     a canvasser against a book that no longer exists.
//   · RESTORE re-gates the snapshot against the roster. releaseAssignedWork deletes a departed
//     user's live rows but never touches TurfSnapshot.assignments, so a verbatim restore would
//     undelete their books. Those books come back UNASSIGNED and the count is reported.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-turf-hygiene';

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
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass, Turf, TurfAssignment, TurfSnapshot, Household, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Hygiene Org', slug: 'hygiene-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'th-a@t.co', passwordHash: 'x', isActive: true });
  // Active, deactivated-membership, and disabled-account — the three roster states that matter.
  const active = await User.create({ firstName: 'Ann', lastName: 'Active', email: 'th-ac@t.co', passwordHash: 'x', isActive: true });
  const offMember = await User.create({ firstName: 'Moe', lastName: 'Offmember', email: 'th-om@t.co', passwordHash: 'x', isActive: true });
  const offUser = await User.create({ firstName: 'Uma', lastName: 'Offuser', email: 'th-ou@t.co', passwordHash: 'x', isActive: false });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: active._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: offMember._id, organizationId: org._id, role: 'canvasser', isActive: false });
  await Membership.create({ userId: offUser._id, organizationId: org._id, role: 'canvasser', isActive: true });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Main', type: 'survey', state: 'FL', isActive: true });
  // All three sit on the campaign roster — so what separates them in the assertions below is
  // ONLY their membership/user activation, never whether they were rostered.
  for (const u of [active, offMember, offUser]) {
    await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: u._id });
  }
  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Pass 1', status: 'active',
  });
  const door = await Household.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id,
    addressLine1: '1 Book St', city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: '1 BOOK ST|TOWN|FL|34741',
    location: { type: 'Point', coordinates: [-81.4, 28.3] },
    isActive: true,
  });

  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, camp, effort, pass, door, admin, active, offMember, offUser, adminTok: signUserToken(admin) });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { body } = {}) {
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
}

const mkTurf = (name, status = 'published') =>
  Turf.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, passId: ctx.pass._id,
    name, mode: 'geometric', status, householdIds: [ctx.door._id], doorCount: 1,
  });

const assign = (turfId, userId) =>
  TurfAssignment.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, passId: ctx.pass._id, turfId, userId,
  });

const reset = async () => {
  await Turf.deleteMany({});
  await TurfAssignment.deleteMany({});
  await TurfSnapshot.deleteMany({});
  await Household.updateMany({}, { $set: { turfId: null, walkOrder: null } });
};

test('assignments: a deactivated member is LABELLED, never dropped', { skip }, async () => {
  await reset();
  const t1 = await mkTurf('Book 1');
  const t2 = await mkTurf('Book 2');
  await assign(t1._id, ctx.active._id);
  await assign(t2._id, ctx.offMember._id);

  const res = await call('GET', `/admin/campaigns/${ctx.camp._id}/turfs/assignments?passId=${ctx.pass._id}`);
  assert.equal(res.status, 200);
  const rows = res.json.assignments;
  // The count does NOT move — the whole point of the ruling. Both books stay assigned.
  assert.equal(rows.length, 2);
  const byUser = new Map(rows.map((a) => [String(a.user.id), a.user]));
  assert.equal(byUser.get(String(ctx.active._id)).inactive, undefined, 'an active member carries no flag at all');
  assert.equal(byUser.get(String(ctx.offMember._id)).inactive, true, 'a switched-off membership is named');
});

test('assignments: a disabled USER account is flagged too', { skip }, async () => {
  await reset();
  const t1 = await mkTurf('Book 1');
  await assign(t1._id, ctx.offUser._id);
  const res = await call('GET', `/admin/campaigns/${ctx.camp._id}/turfs/assignments?passId=${ctx.pass._id}`);
  assert.equal(res.json.assignments.length, 1, 'still assigned — the book is not reclassified');
  assert.equal(res.json.assignments[0].user.inactive, true);
});

test('discard leaves NO assignment row behind — archived stubs included', { skip }, async () => {
  await reset();
  const live = await mkTurf('Book 1');
  const stub = await mkTurf('Absorbed', 'archived'); // legacy merge stub
  await assign(live._id, ctx.active._id);
  await assign(stub._id, ctx.active._id); // the row the turfId-scoped sweep cannot see
  // An already-orphaned row: its Turf is gone entirely, so no id-scoped sweep can ever collect it.
  const ghostTurfId = new mongoose.Types.ObjectId();
  await assign(ghostTurfId, ctx.offMember._id);
  assert.equal(await TurfAssignment.countDocuments({ passId: ctx.pass._id }), 3);

  // The pass is live, so the route demands the same explicit confirm the UI collects.
  const res = await call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/discard`, {
    body: { passId: String(ctx.pass._id), confirmActive: true },
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(await Turf.countDocuments({ passId: ctx.pass._id }), 0, 'every book, stub included, is gone');
  assert.equal(
    await TurfAssignment.countDocuments({ passId: ctx.pass._id }),
    0,
    'and so is every assignment row — a survivor is served by /assignments forever'
  );
});

test('restore re-gates the snapshot: a deactivated holder comes back UNASSIGNED', { skip }, async () => {
  await reset();
  const t1 = await mkTurf('Book 1');
  const t2 = await mkTurf('Book 2');
  await assign(t1._id, ctx.active._id);
  await assign(t2._id, ctx.offMember._id);

  // Snapshot the pass exactly as the discard flow does, then wipe it.
  const { snapshotPass, restoreSnapshot } = await import('../src/services/turf/snapshot.js');
  const campaign = await Campaign.findById(ctx.camp._id);
  const snap = await snapshotPass({ campaign, passId: ctx.pass._id, reason: 'discard', includeKnocks: false, userId: ctx.admin._id });
  assert.equal((snap.assignments || []).length, 2, 'the snapshot captured BOTH rows verbatim');
  await Turf.deleteMany({ passId: ctx.pass._id });
  await TurfAssignment.deleteMany({ passId: ctx.pass._id });

  const result = await restoreSnapshot({ campaign, snapshot: snap, userId: ctx.admin._id });
  assert.equal(result.bookCount, 2, 'both books return');
  assert.equal(result.assignmentsDropped, 1, 'and the refusal is reported, not swallowed');

  const back = await TurfAssignment.find({ passId: ctx.pass._id }).lean();
  assert.equal(back.length, 1);
  assert.equal(String(back[0].userId), String(ctx.active._id), 'only the still-assignable person');
  const names = await Turf.find({ passId: ctx.pass._id }).lean();
  const restoredIds = new Set(back.map((a) => String(a.turfId)));
  const unassigned = names.filter((t) => !restoredIds.has(String(t._id)));
  assert.equal(unassigned.length, 1, "the deactivated holder's book restores unassigned, not missing");
});

test('restore keeps every assignment when the whole crew is still assignable', { skip }, async () => {
  await reset();
  const t1 = await mkTurf('Book 1');
  await assign(t1._id, ctx.active._id);
  const { snapshotPass, restoreSnapshot } = await import('../src/services/turf/snapshot.js');
  const campaign = await Campaign.findById(ctx.camp._id);
  const snap = await snapshotPass({ campaign, passId: ctx.pass._id, reason: 'discard', includeKnocks: false, userId: ctx.admin._id });
  await Turf.deleteMany({ passId: ctx.pass._id });
  await TurfAssignment.deleteMany({ passId: ctx.pass._id });

  const result = await restoreSnapshot({ campaign, snapshot: snap, userId: ctx.admin._id });
  assert.equal(result.assignmentsDropped, 0, 'the re-gate must not cost an ordinary undo anything');
  assert.equal(await TurfAssignment.countDocuments({ passId: ctx.pass._id }), 1);
});
