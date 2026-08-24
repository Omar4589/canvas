import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Bulk door moves (move-doors), the merge survivor param, and the empty-book delete carve-out,
// over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/movedoorsbulk_test node --test test/moveDoorsBulk.int.test.js
// Proves: multi-donor strip + append with both membership stores rewritten (Turf.householdIds
// AND the Household.turfId/walkOrder mirror); the additive `from[]` donor report incl.
// `emptied`; the newBook flavor (born draft on a draft-only pass, born PUBLISHED once the round
// has accepted books — the mid-round add goes straight to the crew); loose doors just join the
// target; the effort-disjointness 409; the 1–1000 whole-batch cap; the pass-archived 409 on
// both flavors; that a cross-campaign id can never reach the target or another campaign's
// mirror (recomputeTurf's Household.find is unscoped by design — the route must pre-verify);
// that desk marks FOLLOW a moved door in the book counts while the stamped turfId stays
// provenance (deskRestrict.js keys by passId + current membership); merge's `primaryTurfId`
// naming the survivor (assignments fold onto it) with omitted = old any-survivor behavior; and
// DELETE /:turfId now allowing an accepted book a move has emptied (live householdIds probe,
// assignments cleared) while published-with-doors keeps the Discard-only 409.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-move-doors-bulk';

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
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

function makeHousehold(orgId, campaignId, effortId, n, extra = {}) {
  return {
    organizationId: orgId,
    campaignId,
    effortId,
    addressLine1: `${n} Mover Way`,
    city: 'Town',
    state: 'FL',
    zipCode: '34741',
    normalizedAddress: `${n} MOVER WAY|TOWN|FL|34741`,
    // Lat varies too — collinear pins would make the hull assertions vacuous.
    location: { type: 'Point', coordinates: [-81.4 + n * 0.001, 28.3 + (n % 3) * 0.0007] },
    isActive: true,
    ...extra,
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();

  const org = await Organization.create({ name: 'Move Org', slug: 'move-org', isActive: true });
  const admin = await User.create({ firstName: 'Mia', lastName: 'Admin', email: 'ma@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Canvasser', email: 'mc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const camp = await Campaign.create({ organizationId: org._id, name: 'Move C', type: 'survey', state: 'FL', isActive: true });

  // Effort E1 — ACTIVE round P1 with published books A (a1–a4), B (bb1–bb3), C (c1, c2),
  // plus a loose door dL (in the effort, in no book). A carries an assignment so the
  // empty-book delete can prove it clears.
  const e1 = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const p1 = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: e1._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const [a1, a2, a3, a4] = await Household.insertMany([1, 2, 3, 4].map((n) => makeHousehold(org._id, camp._id, e1._id, n)));
  const [bb1, bb2, bb3] = await Household.insertMany([5, 6, 7].map((n) => makeHousehold(org._id, camp._id, e1._id, n)));
  const [c1, c2] = await Household.insertMany([8, 9].map((n) => makeHousehold(org._id, camp._id, e1._id, n)));
  const dL = await Household.create(makeHousehold(org._id, camp._id, e1._id, 10));
  const bkA = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: p1._id, name: 'Book A', mode: 'geometric',
    status: 'published', householdIds: [a1._id, a2._id, a3._id, a4._id], doorCount: 4,
  });
  const bkB = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: p1._id, name: 'Book B', mode: 'geometric',
    status: 'published', householdIds: [bb1._id, bb2._id, bb3._id], doorCount: 3,
  });
  const bkC = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: p1._id, name: 'Book C', mode: 'geometric',
    status: 'published', householdIds: [c1._id, c2._id], doorCount: 2,
  });
  await Household.updateMany({ _id: { $in: [a1._id, a2._id, a3._id, a4._id] } }, { $set: { turfId: bkA._id } });
  await Household.updateMany({ _id: { $in: [bb1._id, bb2._id, bb3._id] } }, { $set: { turfId: bkB._id } });
  await Household.updateMany({ _id: { $in: [c1._id, c2._id] } }, { $set: { turfId: bkC._id } });
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: p1._id, turfId: bkA._id, userId: canv._id });
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: p1._id, turfId: bkB._id, userId: canv._id });

  // Effort E2 — a door outside P1's effort, for the disjointness 409.
  const e2 = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'South' });
  const dX = await Household.create(makeHousehold(org._id, camp._id, e2._id, 20));

  // Effort E3 — DRAFT-only round P3 with draft books D1 (g1, g2) and D2 (g3, g4).
  const e3 = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'East' });
  const p3 = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: e3._id, roundNumber: 1, name: 'Round 1', status: 'draft' });
  const [g1, g2, g3, g4] = await Household.insertMany([30, 31, 32, 33].map((n) => makeHousehold(org._id, camp._id, e3._id, n)));
  const bkD1 = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: p3._id, name: 'Draft 1', mode: 'geometric',
    status: 'draft', householdIds: [g1._id, g2._id], doorCount: 2,
  });
  const bkD2 = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: p3._id, name: 'Draft 2', mode: 'geometric',
    status: 'draft', householdIds: [g3._id, g4._id], doorCount: 2,
  });
  await Household.updateMany({ _id: { $in: [g1._id, g2._id] } }, { $set: { turfId: bkD1._id } });
  await Household.updateMany({ _id: { $in: [g3._id, g4._id] } }, { $set: { turfId: bkD2._id } });

  // Effort E4 — ARCHIVED round P4 whose book AR is still published (the round ended).
  const e4 = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'West' });
  const p4 = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: e4._id, roundNumber: 1, name: 'Round 1', status: 'archived', archivedAt: new Date() });
  const f1 = await Household.create(makeHousehold(org._id, camp._id, e4._id, 40));
  const bkAR = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: p4._id, name: 'Archived-round book', mode: 'geometric',
    status: 'published', householdIds: [f1._id], doorCount: 1,
  });
  await Household.updateOne({ _id: f1._id }, { $set: { turfId: bkAR._id } });

  // Second campaign C2 — its door must be untouchable from C1's move routes.
  const camp2 = await Campaign.create({ organizationId: org._id, name: 'Move C2', type: 'survey', state: 'FL', isActive: true });
  const e5 = await Effort.create({ organizationId: org._id, campaignId: camp2._id, name: 'Far' });
  const dFor = await Household.create(makeHousehold(org._id, camp2._id, e5._id, 50));

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, canv, camp, camp2,
    e1, e2, e3, e4, e5, p1, p3, p4,
    bkA, bkB, bkC, bkD1, bkD2, bkAR,
    a1, a2, a3, a4, bb1, bb2, bb3, c1, c2, dL, dX, g1, g2, g3, g4, f1, dFor,
    adminTok: signUserToken(admin),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { token, orgId, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
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

const moveDoors = (body) =>
  call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/move-doors`, { token: ctx.adminTok, orgId: ctx.org._id, body });

const turfList = async (passId) => {
  const r = await call('GET', `/admin/campaigns/${ctx.camp._id}/turfs?passId=${passId}`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(r.status, 200);
  return r.json.turfs;
};

test('multi-donor move to an existing book: counts, from[] report, both membership stores', { skip }, async () => {
  const r = await moveDoors({
    householdIds: [ctx.a1._id, ctx.a2._id, ctx.bb1._id].map(String),
    toTurfId: String(ctx.bkC._id),
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(r.json.to, { id: String(ctx.bkC._id), doorCount: 5, name: 'Book C', status: 'published', created: false });
  const from = Object.fromEntries(r.json.from.map((f) => [f.id, f]));
  assert.deepStrictEqual(from[String(ctx.bkA._id)], { id: String(ctx.bkA._id), name: 'Book A', doorCount: 2, emptied: false });
  assert.deepStrictEqual(from[String(ctx.bkB._id)], { id: String(ctx.bkB._id), name: 'Book B', doorCount: 2, emptied: false });

  const cDoc = await Turf.findById(ctx.bkC._id).lean();
  assert.strictEqual(cDoc.doorCount, 5);
  assert.ok(cDoc.boundary, 'target re-hulled');
  assert.ok(cDoc.centroid, 'target centroid recomputed');
  const moved = await Household.findById(ctx.a1._id).lean();
  assert.strictEqual(String(moved.turfId), String(ctx.bkC._id), 'mirror follows the move');
  assert.strictEqual(typeof moved.walkOrder, 'number');
  const stayed = await Household.findById(ctx.a3._id).lean();
  assert.strictEqual(String(stayed.turfId), String(ctx.bkA._id), 'unmoved door keeps its book');
});

test('desk marks follow the moved doors; emptied donor reported, never auto-deleted', { skip }, async () => {
  // Mark A's remaining two doors, then move them out — emptying A.
  const mark = await call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/restrict-doors`, {
    token: ctx.adminTok, orgId: ctx.org._id,
    body: { householdIds: [String(ctx.a3._id), String(ctx.a4._id)], passId: String(ctx.p1._id) },
  });
  assert.strictEqual(mark.status, 200, JSON.stringify(mark.json));
  assert.strictEqual(mark.json.marked, 2);
  const rowsBefore = await CanvassActivity.find({ via: 'bulk' }).sort({ _id: 1 }).lean();
  assert.strictEqual(rowsBefore.length, 2);

  const r = await moveDoors({
    householdIds: [String(ctx.a3._id), String(ctx.a4._id)],
    toTurfId: String(ctx.bkC._id),
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(r.json.from, [{ id: String(ctx.bkA._id), name: 'Book A', doorCount: 0, emptied: true }]);
  assert.strictEqual(r.json.to.doorCount, 7);
  assert.ok(await Turf.findById(ctx.bkA._id), 'emptied donor still exists — deletion is the client asking');

  // Rows untouched: same ids, stamped turfId still names Book A (provenance only)…
  const rowsAfter = await CanvassActivity.find({ via: 'bulk' }).sort({ _id: 1 }).lean();
  assert.deepStrictEqual(rowsAfter.map((x) => String(x._id)), rowsBefore.map((x) => String(x._id)));
  assert.ok(rowsAfter.every((x) => String(x.turfId) === String(ctx.bkA._id)), 'stamp untouched');
  // …while the book counts re-key on current membership: A 0, C 2.
  const list = Object.fromEntries((await turfList(ctx.p1._id)).map((t) => [String(t._id), t]));
  assert.strictEqual(list[String(ctx.bkA._id)].bulkRestrictedCount, 0);
  assert.strictEqual(list[String(ctx.bkC._id)].bulkRestrictedCount, 2);
});

test('a door from another effort refuses the whole batch', { skip }, async () => {
  const r = await moveDoors({ householdIds: [String(ctx.dX._id)], toTurfId: String(ctx.bkC._id) });
  assert.strictEqual(r.status, 409);
  assert.match(r.json.error, /different effort/);
  assert.strictEqual((await Turf.findById(ctx.bkC._id).lean()).doorCount, 7, 'nothing written');
});

test('a cross-campaign id can never reach the target or the other campaign mirror', { skip }, async () => {
  const r = await moveDoors({
    householdIds: [String(ctx.dFor._id), String(ctx.bb2._id)],
    toTurfId: String(ctx.bkC._id),
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const cDoc = await Turf.findById(ctx.bkC._id).lean();
  assert.strictEqual(cDoc.doorCount, 8, 'only the verified door moved');
  assert.ok(!cDoc.householdIds.map(String).includes(String(ctx.dFor._id)), 'foreign id never appended');
  const dFor = await Household.findById(ctx.dFor._id).lean();
  assert.ok(dFor.turfId == null, 'other campaign mirror untouched');

  const all = await moveDoors({ householdIds: [String(ctx.dFor._id)], toTurfId: String(ctx.bkC._id) });
  assert.strictEqual(all.status, 404, 'all-foreign batch has no doors to move');
});

test('a loose door just joins the target — no donor, empty from[]', { skip }, async () => {
  const r = await moveDoors({ householdIds: [String(ctx.dL._id)], toTurfId: String(ctx.bkC._id) });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(r.json.from, []);
  assert.strictEqual(r.json.to.doorCount, 9);
  const dl = await Household.findById(ctx.dL._id).lean();
  assert.strictEqual(String(dl.turfId), String(ctx.bkC._id));
  assert.strictEqual(typeof dl.walkOrder, 'number');
});

test('newBook on a round with accepted books is born PUBLISHED', { skip }, async () => {
  const r = await moveDoors({
    householdIds: [String(ctx.c1._id), String(ctx.c2._id)],
    newBook: { passId: String(ctx.p1._id), name: '  North Hill  ' },
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.to.created, true);
  assert.strictEqual(r.json.to.name, 'North Hill');
  assert.strictEqual(r.json.to.status, 'published');
  assert.strictEqual(r.json.to.doorCount, 2);
  assert.deepStrictEqual(r.json.from, [{ id: String(ctx.bkC._id), name: 'Book C', doorCount: 7, emptied: false }]);
  const nb = await Turf.findById(r.json.to.id).lean();
  assert.strictEqual(nb.mode, 'manual');
  assert.strictEqual(nb.status, 'published');
  assert.strictEqual(String(nb.generatedBy), String(ctx.admin._id));
  assert.ok(nb.boundary && nb.centroid);
  const c1 = await Household.findById(ctx.c1._id).lean();
  assert.strictEqual(String(c1.turfId), String(nb._id));
  ctx.bkNH = nb;
});

test('newBook on a draft-only pass is born DRAFT, name defaulted', { skip }, async () => {
  const r = await moveDoors({ householdIds: [String(ctx.g1._id)], newBook: { passId: String(ctx.p3._id) } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.to.created, true);
  assert.strictEqual(r.json.to.name, 'New book');
  assert.strictEqual(r.json.to.status, 'draft');
  assert.deepStrictEqual(r.json.from, [{ id: String(ctx.bkD1._id), name: 'Draft 1', doorCount: 1, emptied: false }]);
  ctx.bkNBDraft = await Turf.findById(r.json.to.id).lean();
});

test('archived round refuses both flavors with pass-archived', { skip }, async () => {
  const toBook = await moveDoors({ householdIds: [String(ctx.f1._id)], toTurfId: String(ctx.bkAR._id) });
  assert.strictEqual(toBook.status, 409);
  assert.strictEqual(toBook.json.code, 'pass-archived');
  const toNew = await moveDoors({ householdIds: [String(ctx.f1._id)], newBook: { passId: String(ctx.p4._id) } });
  assert.strictEqual(toNew.status, 409);
  assert.strictEqual(toNew.json.code, 'pass-archived');
});

test('body validation: exactly one target; the 1–1000 cap refuses whole', { skip }, async () => {
  const both = await moveDoors({
    householdIds: [String(ctx.bb3._id)],
    toTurfId: String(ctx.bkC._id),
    newBook: { passId: String(ctx.p1._id) },
  });
  assert.strictEqual(both.status, 400);
  const neither = await moveDoors({ householdIds: [String(ctx.bb3._id)] });
  assert.strictEqual(neither.status, 400);

  const mint = () => String(new mongoose.Types.ObjectId());
  const over = await moveDoors({ householdIds: Array.from({ length: 1001 }, mint), toTurfId: String(ctx.bkC._id) });
  assert.strictEqual(over.status, 400);
  assert.match(over.json.error, /1–1000/);
  // 1000 clears the cap (and then 404s — none of the minted ids exist in this campaign).
  const atCap = await moveDoors({ householdIds: Array.from({ length: 1000 }, mint), toTurfId: String(ctx.bkC._id) });
  assert.strictEqual(atCap.status, 404);
});

test('merge primaryTurfId names the survivor; assignments fold onto it; omitted = old behavior', { skip }, async () => {
  // Book B was created BEFORE North Hill, so DB order would pick B — the param must win.
  const r = await call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/merge`, {
    token: ctx.adminTok, orgId: ctx.org._id,
    body: { turfIds: [String(ctx.bkB._id), String(ctx.bkNH._id)], primaryTurfId: String(ctx.bkNH._id) },
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.turf.id, String(ctx.bkNH._id), 'named survivor wins over DB order');
  assert.strictEqual(r.json.turf.doorCount, 3); // bb3 + c1 + c2
  assert.strictEqual(await Turf.findById(ctx.bkB._id), null, 'absorbed book hard-deleted');
  assert.ok(
    await TurfAssignment.findOne({ turfId: ctx.bkNH._id, userId: ctx.canv._id }),
    'crew followed the doors onto the survivor'
  );
  assert.strictEqual(await TurfAssignment.countDocuments({ turfId: ctx.bkB._id }), 0);

  const bad = await call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/merge`, {
    token: ctx.adminTok, orgId: ctx.org._id,
    body: { turfIds: [String(ctx.bkC._id), String(ctx.bkNH._id)], primaryTurfId: String(ctx.bkA._id) },
  });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.json.error, /primaryTurfId/);

  // Omitted → any survivor holding every door (the old contract; order is the DB's business).
  const plain = await call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/merge`, {
    token: ctx.adminTok, orgId: ctx.org._id,
    body: { turfIds: [String(ctx.bkD1._id), String(ctx.bkD2._id)] },
  });
  assert.strictEqual(plain.status, 200, JSON.stringify(plain.json));
  assert.strictEqual(plain.json.turf.doorCount, 3); // g2 + g3 + g4
  const survivors = await Turf.find({ _id: { $in: [ctx.bkD1._id, ctx.bkD2._id] } }).lean();
  assert.strictEqual(survivors.length, 1);
  assert.strictEqual(String(survivors[0]._id), plain.json.turf.id);
  ctx.bkDraftMerged = survivors[0];
});

test('DELETE: emptied published book deletes (assignments cleared); with doors it still 409s; drafts unchanged', { skip }, async () => {
  // Book A: published, emptied by the move, still assigned — the carve-out case.
  assert.ok(await TurfAssignment.findOne({ turfId: ctx.bkA._id }), 'fixture: emptied book still carries its assignment');
  const del = await call('DELETE', `/admin/campaigns/${ctx.camp._id}/turfs/${ctx.bkA._id}`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(del.status, 200, JSON.stringify(del.json));
  assert.strictEqual(await Turf.findById(ctx.bkA._id), null);
  assert.strictEqual(await TurfAssignment.countDocuments({ turfId: ctx.bkA._id }), 0, 'dead-weight assignment cleared');

  // Book C: published with doors — Discard stays the only path.
  const live = await call('DELETE', `/admin/campaigns/${ctx.camp._id}/turfs/${ctx.bkC._id}`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(live.status, 409);
  assert.strictEqual(live.json.code, 'not-draft');

  // Draft with doors: deletable as always, mirror cleared.
  const draft = await call('DELETE', `/admin/campaigns/${ctx.camp._id}/turfs/${ctx.bkDraftMerged._id}`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(draft.status, 200, JSON.stringify(draft.json));
  const g3 = await Household.findById(ctx.g3._id).lean();
  assert.ok(g3.turfId == null && g3.walkOrder == null, 'draft delete clears the mirror');
});
