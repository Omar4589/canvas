import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';
import * as turf from '@turf/turf';

// The book-outline redraw after a pin move, over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/pinrehull node --test test/pinMoveRehull.int.test.js
//
// A pin correction is the one edit that changes a door's COORDINATE rather than its book, and the
// Turf Cutting page promises "every house sits inside its book's shape". So the ONE pin-move writer
// (services/households/updateHouseholdLocation.js) now asks services/turf/rehullAfterPinMove.js to
// redraw the moved door's own book plus every live book whose stored shape covers the new spot —
// membership, walk order and doorCount never change, archived rounds are left alone, a failure or
// an over-cap pass leaves the pin written and the outline stale, and every pin endpoint reports the
// books it redrew as `turfsRecomputed`.
//
// Fixture: one campaign in Kentucky (so inStateBounds passes), an ACTIVE round with two published
// books — A, a 3×3 cluster at PIN plus two co-located units inside it, and B, a 3×3 cluster
// ~1.75 km east — and an ARCHIVED round whose book A2 holds exactly A's doors. Both rounds are
// tessellated in `before` with the real recomputePassTerritories, so every test starts from the
// shapes production would have stored. Each mutating test moves its OWN door (a0…a6, u1/u2), and
// the order matters only in that (c) also checks A2 sat still through (a) and (b).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-pin-rehull';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { Household } = await import('../src/models/Household.js');
const { HouseholdLocationChange } = await import('../src/models/HouseholdLocationChange.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { computeCentroid } = await import('../src/services/turf/boundary.js');
const { recomputePassTerritories } = await import('../src/services/turf/generateTurf.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const PIN = { lng: -84.5, lat: 38.0 }; // Kentucky, so inStateBounds passes for state 'KY'
const STEP = 0.0008; // the turfBoundary.test.js cluster pitch (~70-90 m)
const B_ORIGIN = { lng: PIN.lng + 0.02, lat: PIN.lat }; // ~1.75 km east: its own cluster, Voronoi-adjacent to A
const UNIT_PIN = [PIN.lng + STEP / 2, PIN.lat + STEP / 2]; // inside A's grid, on no grid coordinate

// A tight 3×3 block at `origin`, [lng, lat] per door — the same grid turfBoundary.test.js uses.
const grid = (origin) =>
  Array.from({ length: 9 }, (_, i) => [origin.lng + (i % 3) * STEP, origin.lat + Math.floor(i / 3) * STEP]);

const hh = (orgId, campaignId, effortId, n, [lng, lat], state = 'KY') => ({
  organizationId: orgId,
  campaignId,
  effortId,
  addressLine1: `${n} Pin Way`,
  city: 'Town',
  state,
  zipCode: '40202',
  normalizedAddress: `${n} PIN WAY|TOWN|${state}|40202`,
  location: { type: 'Point', coordinates: [lng, lat] },
  isActive: true,
  status: 'unknocked',
});

// Stamp a book's doors the way a cut does: turfId + walkOrder = position in householdIds. Without
// these, "membership and walk order unchanged" would be vacuously true.
const bookDoors = (turfDoc, docs) =>
  Household.bulkWrite(
    docs.map((d, i) => ({ updateOne: { filter: { _id: d._id }, update: { $set: { turfId: turfDoc._id, walkOrder: i } } } })),
    { ordered: false }
  );

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Effort, Pass, Turf, Household, HouseholdLocationChange, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Rehull Org', slug: 'rehull-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ra@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });

  const C = await Campaign.create({ organizationId: org._id, name: 'Rehull Campaign', type: 'survey', state: 'KY', isActive: true });
  const effort = await Effort.create({ organizationId: org._id, campaignId: C._id, name: 'E' });
  // Round 1 finished (archived), round 2 live — the ordinary shape of a campaign mid-season.
  const passArchived = await Pass.create({
    organizationId: org._id, campaignId: C._id, effortId: effort._id, roundNumber: 1, name: 'R1',
    status: 'archived', activatedAt: new Date(Date.now() - 86400e3), archivedAt: new Date(),
  });
  const passLive = await Pass.create({
    organizationId: org._id, campaignId: C._id, effortId: effort._id, roundNumber: 2, name: 'R2',
    status: 'active', activatedAt: new Date(),
  });

  // A: nine grid doors (a0 = SW corner … a8 = NE corner) + two units sharing one pin inside the
  // grid (the building-scope case). B: nine grid doors east.
  const aDocs = await Household.insertMany([
    ...grid(PIN).map((pt, i) => hh(org._id, C._id, effort._id, i + 1, pt)),
    hh(org._id, C._id, effort._id, 10, UNIT_PIN),
    hh(org._id, C._id, effort._id, 11, UNIT_PIN),
  ]);
  const bDocs = await Household.insertMany(grid(B_ORIGIN).map((pt, i) => hh(org._id, C._id, effort._id, 21 + i, pt)));

  const mkBook = (pass, name, docs) => Turf.create({
    organizationId: org._id, campaignId: C._id, passId: pass._id, name, mode: 'geometric', status: 'published',
    householdIds: docs.map((d) => d._id), doorCount: docs.length, centroid: computeCentroid(docs),
  });
  const A = await mkBook(passLive, 'Book A', aDocs);
  const B = await mkBook(passLive, 'Book B', bDocs);
  // The finished round's book over the very same doors. Household.turfId belongs to the LIVE
  // round's book (a re-cut overwrites it); A2 keeps its own householdIds as history.
  const A2 = await mkBook(passArchived, 'Book A (round 1)', aDocs);
  await bookDoors(A, aDocs);
  await bookDoors(B, bDocs);

  // The shapes production would have stored: the real tessellation, both rounds.
  await recomputePassTerritories(passLive._id);
  await recomputePassTerritories(passArchived._id);
  const a2Seeded = await Turf.findById(A2._id).lean();
  for (const id of [A._id, B._id, A2._id]) {
    const t = await Turf.findById(id).lean();
    assert.ok(t.boundary && t.centroid, `fixture guard: book ${t.name} must start with a stored shape + centroid`);
  }

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, C, effort, passLive, passArchived, A, B, A2, a2Seeded,
    a: aDocs.slice(0, 9), u1: aDocs[9], u2: aDocs[10], b: bDocs,
    adminTok: signUserToken(admin),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const call = async (method, path, { token, orgId, body } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });

// The web pin PATCH — the Map page, the mobile admin map and the Turf Cutting pop-ups all land here.
const patchPin = (householdId, body) =>
  call('PATCH', `/admin/campaigns/${ctx.C._id}/households/${householdId}/location`, { ...asAdmin(), body });

const book = (id) => Turf.findById(id).lean();
const coordsOf = (doc) => doc.location.coordinates;
const inside = (geom, [lng, lat]) => {
  if (!geom) return false;
  try {
    return turf.booleanPointInPolygon(turf.point([lng, lat]), geom);
  } catch {
    return false;
  }
};
const overlapArea = (g1, g2) => {
  if (!g1 || !g2) return 0;
  try {
    const ov = turf.intersect(turf.featureCollection([turf.feature(g1), turf.feature(g2)]));
    return ov ? turf.area(ov) : 0;
  } catch {
    return 0;
  }
};
// [id, walkOrder] for every door stamped with this book — a turfId change shows up as a missing row.
const walkOrders = async (turfId) =>
  (await Household.find({ turfId }, { walkOrder: 1 }).sort({ _id: 1 }).lean()).map((h) => [String(h._id), h.walkOrder]);
const membersOf = (turfDoc) => Household.find({ _id: { $in: turfDoc.householdIds } }, { location: 1 }).lean();
const outsideCount = async (turfDoc) => (await membersOf(turfDoc)).filter((h) => !inside(turfDoc.boundary, coordsOf(h))).length;

test('(a) a nudge redraws the door\'s own book around the new spot — members, walk order, doorCount untouched', { skip }, async () => {
  const before = await book(ctx.A._id);
  const ordersBefore = await walkOrders(ctx.A._id);
  assert.strictEqual(ordersBefore.length, before.doorCount, 'fixture guard: every A door is stamped with its walk order');
  // a0 is the SW corner: push it just OUTSIDE the stored outline, so containment afterwards is earned.
  const to = { lng: PIN.lng - 0.0003, lat: PIN.lat - 0.0003 };
  assert.strictEqual(inside(before.boundary, [to.lng, to.lat]), false, 'fixture guard: the old outline must not already cover the new spot');

  const res = await patchPin(ctx.a[0]._id, to);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.ok(Array.isArray(res.json.turfsRecomputed), 'the PATCH reports which books it redrew');
  assert.ok(res.json.turfsRecomputed.includes(String(ctx.A._id)), `A is listed: ${JSON.stringify(res.json.turfsRecomputed)}`);

  const after = await book(ctx.A._id);
  assert.strictEqual(inside(after.boundary, [to.lng, to.lat]), true, 'the redrawn outline contains the moved door');
  assert.strictEqual(await outsideCount(after), 0, 'every other A door is still inside A');
  assert.notDeepStrictEqual(after.centroid, before.centroid, 'the centroid follows the pins');
  assert.deepStrictEqual(after.centroid, computeCentroid(await membersOf(after)), 'centroid = center of the CURRENT pins');
  // What a pin move must never do: re-cut, re-order, or re-count.
  assert.deepStrictEqual(after.householdIds.map(String), before.householdIds.map(String), 'membership never changes');
  assert.strictEqual(after.doorCount, before.doorCount, 'doorCount never changes');
  assert.deepStrictEqual(await walkOrders(ctx.A._id), ordersBefore, 'walk order never changes');
  const moved = await Household.findById(ctx.a[0]._id).lean();
  assert.strictEqual(String(moved.turfId), String(ctx.A._id), 'the door keeps its book');
  assert.strictEqual(moved.coordSource, 'corrected');
});

test('(b) a door moved INTO a neighbouring book: own book grows a pocket there, the neighbour yields it, shapes stay disjoint', { skip }, async () => {
  const aBefore = await book(ctx.A._id);
  const bBefore = await book(ctx.B._id);
  const aOrders = await walkOrders(ctx.A._id);
  const bOrders = await walkOrders(ctx.B._id);
  // Inside B's grid, near its centre door — deliberately NOT on any B coordinate (an exact-coordinate
  // collision is the separate, documented first-book-wins dedupe rule, not what this test pins).
  const to = { lng: B_ORIGIN.lng + 0.0011, lat: B_ORIGIN.lat + 0.0010 };
  assert.ok(!ctx.b.some((d) => coordsOf(d)[0] === to.lng && coordsOf(d)[1] === to.lat), 'fixture guard: not exactly on a B door');
  assert.strictEqual(inside(bBefore.boundary, [to.lng, to.lat]), true, "fixture guard: B's stored shape covers the spot — that is what makes B a neighbour to redraw");
  assert.strictEqual(inside(aBefore.boundary, [to.lng, to.lat]), false, 'fixture guard: A does not reach there yet');

  const res = await patchPin(ctx.a[8]._id, to);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  const listed = new Set(res.json.turfsRecomputed);
  assert.ok(listed.has(String(ctx.A._id)) && listed.has(String(ctx.B._id)), `both A (own) and B (containing) are redrawn: ${JSON.stringify(res.json.turfsRecomputed)}`);
  assert.ok(!listed.has(String(ctx.A2._id)), 'the archived round is not in the list');

  const aAfter = await book(ctx.A._id);
  const bAfter = await book(ctx.B._id);
  assert.strictEqual(inside(aAfter.boundary, [to.lng, to.lat]), true, 'A now contains its moved door');
  assert.strictEqual(inside(bAfter.boundary, [to.lng, to.lat]), false, 'B no longer covers the spot');
  assert.ok(overlapArea(aAfter.boundary, bAfter.boundary) < 1, 'A and B must not overlap (m²)');
  assert.strictEqual(aAfter.boundary.type, 'MultiPolygon', "the surrounded door's book grows a pocket island");
  assert.strictEqual(await outsideCount(aAfter), 0, 'every A door inside A');
  assert.strictEqual(await outsideCount(bAfter), 0, "every B door inside B — the neighbour's redraw loses nobody");
  // Membership and walk order untouched on BOTH sides of the seam.
  assert.deepStrictEqual(aAfter.householdIds.map(String), aBefore.householdIds.map(String));
  assert.deepStrictEqual(bAfter.householdIds.map(String), bBefore.householdIds.map(String));
  assert.deepStrictEqual(await walkOrders(ctx.A._id), aOrders);
  assert.deepStrictEqual(await walkOrders(ctx.B._id), bOrders);
  assert.strictEqual(bAfter.doorCount, bBefore.doorCount);
});

test('(c) an ARCHIVED round is history: its book over the same doors is never redrawn or listed', { skip }, async () => {
  const liveA = await book(ctx.A._id);
  assert.deepStrictEqual(ctx.a2Seeded.householdIds.map(String), liveA.householdIds.map(String), 'fixture guard: A2 holds exactly A\'s doors, so only the round status keeps it out');
  // (a) and (b) already moved two of these doors; A2 must have sat still through both.
  const mid = await book(ctx.A2._id);
  assert.deepStrictEqual(mid.boundary, ctx.a2Seeded.boundary, 'A2.boundary byte-identical after earlier moves');
  assert.deepStrictEqual(mid.centroid, ctx.a2Seeded.centroid);

  const door = ctx.a[1];
  const [lng, lat] = coordsOf(door);
  const res = await patchPin(door._id, { lng: lng + 0.0001, lat: lat - 0.0002 });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.ok(res.json.turfsRecomputed.includes(String(ctx.A._id)), 'the live book is redrawn');
  assert.ok(!res.json.turfsRecomputed.includes(String(ctx.A2._id)), 'the archived round\'s book is not listed');

  const after = await book(ctx.A2._id);
  assert.deepStrictEqual(after.boundary, ctx.a2Seeded.boundary, 'A2.boundary still byte-identical');
  assert.deepStrictEqual(after.centroid, ctx.a2Seeded.centroid, 'A2.centroid untouched');
  assert.strictEqual(String(after.passId), String(ctx.passArchived._id));
});

test('(d) a re-hull fault never blocks the pin: 200, provenance + audit row written, turfsRecomputed []', { skip }, async (t) => {
  // The pin write path itself never touches Turf — so a Turf.find that throws is hit ONLY by the
  // re-hull, and the write must come through untouched. Quiet console.error so the expected
  // '[pin-move] re-hull failed' line doesn't read as a test failure in the run log.
  const boom = t.mock.method(Turf, 'find', () => { throw new Error('boom'); });
  const quiet = t.mock.method(console, 'error', () => {});
  try {
    const door = ctx.a[2];
    const [lng, lat] = coordsOf(door);
    const to = { lng: lng + 0.0001, lat: lat + 0.0001 };
    const res = await patchPin(door._id, to);
    assert.strictEqual(res.status, 200, JSON.stringify(res.json));
    assert.deepStrictEqual(res.json.turfsRecomputed, [], 'nothing redrawn — and the response says so');
    assert.ok(boom.mock.callCount() >= 1, 'the re-hull really ran into the fault');
    assert.ok(
      quiet.mock.calls.some((c) => String(c.arguments[0]).includes('[pin-move] re-hull failed')),
      'the failure is logged, not swallowed silently'
    );

    const after = await Household.findById(door._id).lean();
    assert.strictEqual(after.coordSource, 'corrected');
    assert.deepStrictEqual(coordsOf(after), [to.lng, to.lat]);
    assert.strictEqual(String(after.correctedBy), String(ctx.admin._id));
    assert.strictEqual(await HouseholdLocationChange.countDocuments({ householdId: door._id }), 1, 'exactly one audit row per move');
  } finally {
    boom.mock.restore();
    quiet.mock.restore();
  }
});

test('(e) scope:building moves both co-located units and lists their book once', { skip }, async () => {
  const before = await book(ctx.A._id);
  const to = { lng: PIN.lng + 0.0012, lat: PIN.lat + 0.0004 }; // still inside A's grid, on no grid coordinate
  const res = await patchPin(ctx.u1._id, { ...to, scope: 'building' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.moved, 2, 'both units sharing the pin moved');
  assert.strictEqual(
    res.json.turfsRecomputed.filter((id) => id === String(ctx.A._id)).length,
    1,
    `A listed exactly once: ${JSON.stringify(res.json.turfsRecomputed)}`
  );

  for (const u of [ctx.u1, ctx.u2]) {
    const doc = await Household.findById(u._id).lean();
    assert.strictEqual(doc.coordSource, 'corrected', `${doc.addressLine1} moved`);
    assert.deepStrictEqual(coordsOf(doc), [to.lng, to.lat]);
    assert.strictEqual(await HouseholdLocationChange.countDocuments({ householdId: u._id }), 1);
  }
  const after = await book(ctx.A._id);
  assert.strictEqual(inside(after.boundary, [to.lng, to.lat]), true, 'A still contains the stack');
  assert.strictEqual(await outsideCount(after), 0);
  assert.deepStrictEqual(after.householdIds.map(String), before.householdIds.map(String));
});

test('(f) GET /turfs/household/:id carries the pin + provenance — before and after a correction', { skip }, async () => {
  const door = ctx.a[3];
  const path = `/admin/campaigns/${ctx.C._id}/turfs/household/${door._id}`;
  const before = await call('GET', path, asAdmin());
  assert.strictEqual(before.status, 200, JSON.stringify(before.json));
  const [lng, lat] = coordsOf(door);
  assert.deepStrictEqual(before.json.household.location, { lng, lat }, 'the seeded point');
  assert.strictEqual(before.json.household.coordSource, null);
  assert.strictEqual(before.json.household.coordConfidence, null);
  assert.strictEqual(before.json.household.correctedAt, null);

  const to = { lng: lng + 0.0002, lat: lat + 0.0001 };
  const moved = await patchPin(door._id, to);
  assert.strictEqual(moved.status, 200, JSON.stringify(moved.json));

  const after = await call('GET', path, asAdmin());
  assert.strictEqual(after.status, 200);
  assert.deepStrictEqual(after.json.household.location, to, 'the new point');
  assert.strictEqual(after.json.household.coordSource, 'corrected');
  assert.strictEqual(after.json.household.coordConfidence, null);
  assert.ok(
    after.json.household.correctedAt && !Number.isNaN(Date.parse(after.json.household.correctedAt)),
    `correctedAt is a date: ${after.json.household.correctedAt}`
  );
});

test('(g) the mobile pin endpoint reports the same turfsRecomputed', { skip }, async () => {
  const door = ctx.a[5];
  const [lng, lat] = coordsOf(door);
  const res = await call('POST', `/mobile/households/${door._id}/location`, {
    ...asAdmin(),
    body: { lng: lng + 0.0001, lat: lat + 0.0002, source: 'drag', accuracy: 5 },
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  assert.strictEqual(res.json.moved, 1);
  assert.ok(Array.isArray(res.json.turfsRecomputed), 'turfsRecomputed is on the mobile wire too');
  assert.ok(res.json.turfsRecomputed.includes(String(ctx.A._id)), `A is listed: ${JSON.stringify(res.json.turfsRecomputed)}`);
  assert.strictEqual(res.json.household.coordSource, 'corrected');
});

test('(h) over the inline cap the pin still moves but no outline is redrawn — logged, not silent', { skip }, async (t) => {
  const door = ctx.a[6];
  const before = await book(ctx.A._id);
  // The live round books 20 doors; a cap of 5 puts it over. Read at call time, so no restart.
  process.env.TURF_REHULL_INLINE_MAX_DOORS = '5';
  const warn = t.mock.method(console, 'warn', () => {});
  const [lng, lat] = coordsOf(door);
  try {
    const res = await patchPin(door._id, { lng: lng + 0.0001, lat: lat - 0.0001 });
    assert.strictEqual(res.status, 200, JSON.stringify(res.json));
    assert.deepStrictEqual(res.json.turfsRecomputed, [], 'skipped pass → nothing listed');
    const after = await book(ctx.A._id);
    assert.deepStrictEqual(after.boundary, before.boundary, 'outline unchanged');
    assert.deepStrictEqual(after.centroid, before.centroid, 'centroid unchanged');
    const moved = await Household.findById(door._id).lean();
    assert.strictEqual(moved.coordSource, 'corrected', 'the pin itself is still corrected');
    assert.ok(
      warn.mock.calls.some((c) => {
        const line = String(c.arguments[0]);
        return /\[pin-move\] skipped re-hull/.test(line) && line.includes(String(ctx.passLive._id));
      }),
      `the skip is logged with the pass id: ${JSON.stringify(warn.mock.calls.map((c) => c.arguments))}`
    );
  } finally {
    delete process.env.TURF_REHULL_INLINE_MAX_DOORS;
    warn.mock.restore();
  }
  // With the cap back at its default the very next move redraws again — the env really is read
  // per call, not frozen at import.
  const again = await patchPin(door._id, { lng, lat });
  assert.strictEqual(again.status, 200, JSON.stringify(again.json));
  assert.ok(again.json.turfsRecomputed.includes(String(ctx.A._id)), 'redraw resumes once the cap is lifted');
});
