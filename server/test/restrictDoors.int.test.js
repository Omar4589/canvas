import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Single-home desk restrict (restrict-doors / unrestrict-doors) over the REAL Express app + a
// throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/restrictdoors_test node --test test/restrictDoors.int.test.js
// Proves: the row is the SAME class restrict-bulk writes (via:'bulk', the house's own pin, the
// admin's userId, no team, no lastActionBy) so every promise that class already carries holds —
// non-billable, invisible to the GPS audit and per-canvasser reports, never a phantom canvasser,
// slate for canvassers per-round (bootstrap + delta poll), exported as `bulk`; the pass-resolution
// rule (explicit → effort's active round → its single draft → PASS_REQUIRED; Intake never;
// archived round refused for MARK only); the skip ladder; unmark removes desk rows only, by exact
// round, with NO pass-existence check; the draft-pass delete sweep; the /activity and /map
// additive reads; and the Option B book-level count (passId × current membership).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-restrict-doors';

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
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { ExportJob } = await import('../src/models/ExportJob.js');
const { getPassStatusMap } = await import('../src/services/passes/passStatus.js');
const { computeCampaignStats } = await import('../src/services/reports/campaignCounters.js');
const { monthlyStatement, currentMonth } = await import('../src/services/billing/statement.js');
const { cutStatusExclusion } = await import('../src/services/turf/generateTurf.js');
const { processExportJob } = await import('../src/services/export/exportProcessor.js');
const { openArtifactDownloadStream } = await import('../src/services/export/exportArtifactStore.js');
const { DESK_RESTRICT_MATCH, buildDeskRestrictRow, removeDeskRestrict } = await import('../src/services/canvass/deskRestrict.js');

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
    addressLine1: `${n} Locked Gate Ln`,
    city: 'Town',
    state: 'FL',
    zipCode: '34741',
    normalizedAddress: `${n} LOCKED GATE LN|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.4 + n * 0.001, 28.3] },
    isActive: true,
    ...extra,
  };
}

function fieldRow(hh, userId, actionType, passId, turfId, ts) {
  const [lng, lat] = hh.location.coordinates;
  return {
    organizationId: hh.organizationId,
    campaignId: hh.campaignId,
    householdId: hh._id,
    userId,
    actionType,
    location: { lat: lat + 0.0001, lng, accuracy: 10 },
    distanceFromHouseMeters: 12,
    timestamp: ts,
    passId,
    turfId,
    effortId: hh.effortId,
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();

  const org = await Organization.create({ name: 'Desk Org', slug: 'desk-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'da@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Canvasser', email: 'dc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const camp = await Campaign.create({ organizationId: org._id, name: 'Desk C', type: 'survey', state: 'FL', isActive: true });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: canv._id });

  // Effort E1 — ACTIVE round P1, published books B1 (d1–d6 + building units u1–u4) and B2
  // (d12, d13), plus a loose door d9 (in the effort, in no book).
  const e1 = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const p1 = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: e1._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const [d1, d2, d3, d4, d5, d6] = await Household.insertMany([1, 2, 3, 4, 5, 6].map((n) => makeHousehold(org._id, camp._id, e1._id, n)));
  const units = await Household.insertMany([1, 2, 3, 4].map((k) =>
    makeHousehold(org._id, camp._id, e1._id, 7, {
      addressLine2: `Unit ${k}`,
      normalizedAddress: `7 LOCKED GATE LN UNIT ${k}|TOWN|FL|34741`,
      location: { type: 'Point', coordinates: [-81.4 + 7 * 0.001, 28.3] }, // one geocode
    })
  ));
  const [u1, u2, u3, u4] = units;
  const d9 = await Household.create(makeHousehold(org._id, camp._id, e1._id, 9));
  const [d12, d13] = await Household.insertMany([12, 13].map((n) => makeHousehold(org._id, camp._id, e1._id, n)));
  const b1Doors = [d1, d2, d3, d4, d5, d6, ...units];
  const b1 = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: p1._id, name: 'Book 1', mode: 'geometric',
    status: 'published', householdIds: b1Doors.map((h) => h._id), doorCount: b1Doors.length,
  });
  const b2 = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: p1._id, name: 'Book 2', mode: 'geometric',
    status: 'published', householdIds: [d12._id, d13._id], doorCount: 2,
  });
  await Household.updateMany({ _id: { $in: b1Doors.map((h) => h._id) } }, { $set: { turfId: b1._id } });
  await Household.updateMany({ _id: { $in: [d12._id, d13._id] } }, { $set: { turfId: b2._id } });
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: p1._id, turfId: b1._id, userId: canv._id });

  // Effort E2 — DRAFT round P2 with a draft book B3 (d7, d8): the pre-acceptance case.
  const e2 = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'South' });
  const p2 = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: e2._id, roundNumber: 1, name: 'Round 1', status: 'draft' });
  const [d7, d8] = await Household.insertMany([7.5, 8].map((n) => makeHousehold(org._id, camp._id, e2._id, n)));
  const b3 = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: p2._id, name: 'Book 3', mode: 'geometric',
    status: 'draft', householdIds: [d7._id, d8._id], doorCount: 2,
  });
  await Household.updateMany({ _id: { $in: [d7._id, d8._id] } }, { $set: { turfId: b3._id } });

  // Effort E3 — only an ARCHIVED round P3; door d11.
  const e3 = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'East' });
  const p3 = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: e3._id, roundNumber: 1, name: 'Round 1', status: 'archived', archivedAt: new Date() });
  const d11 = await Household.create(makeHousehold(org._id, camp._id, e3._id, 11));

  // Intake door — no walk list at all.
  const d10 = await Household.create(makeHousehold(org._id, camp._id, null, 10));

  // Field rows in P1, staggered ≥10 min apart (same-timestamp field rows would trip the audit's
  // `rapid` flag and muddy the zero-flag assert).
  const earlier = (min) => new Date(Date.now() - 3600_000 + min * 60_000);
  await CanvassActivity.insertMany([
    fieldRow(d1, canv._id, 'survey_submitted', p1._id, b1._id, earlier(0)),
    fieldRow(d2, canv._id, 'restricted', p1._id, b1._id, earlier(10)),
    fieldRow(d3, canv._id, 'not_home', p1._id, b1._id, earlier(20)),
  ]);
  await Household.updateOne({ _id: d1._id }, { status: 'surveyed' });
  await Household.updateOne({ _id: d2._id }, { status: 'restricted' });
  await Household.updateOne({ _id: d3._id }, { status: 'not_home' });

  // Second campaign C2 — its ONLY activity will be a single-home desk mark (billing clock case).
  const camp2 = await Campaign.create({ organizationId: org._id, name: 'Desk C2', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/Chicago' });
  const e4 = await Effort.create({ organizationId: org._id, campaignId: camp2._id, name: 'West' });
  const p4 = await Pass.create({ organizationId: org._id, campaignId: camp2._id, effortId: e4._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const d20 = await Household.create(makeHousehold(org._id, camp2._id, e4._id, 20));
  const b4 = await Turf.create({
    organizationId: org._id, campaignId: camp2._id, passId: p4._id, name: 'Book 4', mode: 'geometric',
    status: 'published', householdIds: [d20._id], doorCount: 1,
  });
  await Household.updateOne({ _id: d20._id }, { $set: { turfId: b4._id } });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, canv, camp, camp2,
    e1, e2, e3, e4, p1, p2, p3, p4, b1, b2, b3, b4,
    d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d20, u1, u2, u3, u4, units,
    adminTok: signUserToken(admin), canvTok: signUserToken(canv),
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
const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });
// `scope` is left OUT of the body unless one is named — omitting it is the back-compat case an
// already-released client exercises, and it must behave exactly like 'incomplete'.
const mark = (householdIds, passId, campaignId = ctx.camp._id, scope) =>
  call('POST', `/admin/campaigns/${campaignId}/turfs/restrict-doors`, {
    ...asAdmin(),
    body: {
      householdIds: householdIds.map((h) => String(h?._id ?? h)),
      ...(passId ? { passId: String(passId?._id ?? passId) } : {}),
      ...(scope === undefined ? {} : { scope }),
    },
  });
const unmark = (householdIds, passId, campaignId = ctx.camp._id) =>
  call('POST', `/admin/campaigns/${campaignId}/turfs/unrestrict-doors`, {
    ...asAdmin(),
    body: { householdIds: householdIds.map((h) => String(h?._id ?? h)), ...(passId ? { passId: String(passId?._id ?? passId) } : {}) },
  });
const deskRows = (filter = {}) => CanvassActivity.find({ ...DESK_RESTRICT_MATCH, ...filter }).lean();
const statusOf = async (hh) => (await Household.findById(hh._id).lean()).status;
const noSkips = { completed: 0, alreadyRestricted: 0, ineligible: 0, reached: 0 };

// Baselines every "unchanged" assert below compares against — taken BEFORE the first mark.
const baseline = {};

test('baselines: stats, knocks-by-pass totals, per-canvasser rows', { skip }, async () => {
  baseline.since = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 5)); // updatedAt must land after `since`
  baseline.stats = await computeCampaignStats(ctx.camp._id);
  const kbp = await call('GET', `/admin/reports/knocks-by-pass?campaignId=${ctx.camp._id}`, asAdmin());
  assert.strictEqual(kbp.status, 200);
  baseline.kbpTotals = kbp.json.totals;
  const cv = await call('GET', `/admin/reports/canvassers?campaignId=${ctx.camp._id}`, asAdmin());
  assert.strictEqual(cv.status, 200);
  baseline.canvassers = cv.json;
  assert.ok(baseline.stats.knockCount >= 1 && baseline.stats.canvasserIds.length === 1, 'fixture has field work to compare against');
});

test('1. mark one booked door with an explicit round: same row class as restrict-bulk, no attribution', { skip }, async () => {
  const r = await mark([ctx.d4], ctx.p1);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(r.json, { marked: 1, skipped: noSkips, passId: String(ctx.p1._id), passIds: [String(ctx.p1._id)] });

  const rows = await deskRows({ householdId: ctx.d4._id });
  assert.strictEqual(rows.length, 1);
  const row = rows[0];
  const [lng, lat] = ctx.d4.location.coordinates;
  assert.strictEqual(row.actionType, 'restricted');
  assert.strictEqual(row.via, 'bulk');
  assert.strictEqual(String(row.userId), String(ctx.admin._id));
  assert.strictEqual(String(row.passId), String(ctx.p1._id));
  assert.strictEqual(String(row.turfId), String(ctx.b1._id), 'provenance: the door’s book in this round');
  assert.strictEqual(String(row.effortId), String(ctx.e1._id));
  assert.strictEqual(String(row.campaignId), String(ctx.camp._id));
  assert.strictEqual(row.coordinatorId, null, 'no team — never a per-team total');
  assert.strictEqual(row.voterId, null);
  assert.strictEqual(row.note, null);
  assert.strictEqual(row.distanceFromHouseMeters, 0);
  assert.strictEqual(row.wasOfflineSubmission, false);
  assert.deepStrictEqual({ lat: row.location.lat, lng: row.location.lng, accuracy: row.location.accuracy }, { lat, lng, accuracy: null }, 'the house’s own pin');

  const hh = await Household.findById(ctx.d4._id).lean();
  assert.strictEqual(hh.status, 'restricted');
  assert.strictEqual(hh.lastActionBy ?? null, null, 'never attributed to the admin');
  assert.ok(hh.lastActionAt, 'the delta-poll touch');
});

test('2. draft book: explicit draft round stamps the draft book; omitted passId resolves to the effort’s single non-archived round', { skip }, async () => {
  const r = await mark([ctx.d7], ctx.p2);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.marked, 1);
  const [row] = await deskRows({ householdId: ctx.d7._id });
  assert.strictEqual(String(row.passId), String(ctx.p2._id));
  assert.strictEqual(String(row.turfId), String(ctx.b3._id), 'a DRAFT book’s id as provenance');
  assert.strictEqual(await statusOf(ctx.d7), 'restricted');

  // No passId: E2 has no active round and exactly one draft → P2 (idempotent on the same door).
  const again = await mark([ctx.d7]);
  assert.strictEqual(again.status, 200, JSON.stringify(again.json));
  assert.strictEqual(again.json.passId, String(ctx.p2._id), 'resolved to the single draft round');
  assert.strictEqual(again.json.marked, 0);
  assert.strictEqual(again.json.skipped.alreadyRestricted, 1);
});

test('3. loose door (no book), no passId → the effort’s active round; turfId null', { skip }, async () => {
  const r = await mark([ctx.d9]);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.marked, 1);
  assert.strictEqual(r.json.passId, String(ctx.p1._id));
  const [row] = await deskRows({ householdId: ctx.d9._id });
  assert.strictEqual(String(row.passId), String(ctx.p1._id));
  assert.strictEqual(row.turfId, null, 'loose door — no book to name');
  assert.strictEqual(await statusOf(ctx.d9), 'restricted');
});

test('4. refusals: Intake, no current round, unknown round, archived round, bad body', { skip }, async () => {
  // Intake door, no passId → PASS_REQUIRED reason 'intake' (short-circuited, nothing written).
  const intake = await mark([ctx.d10]);
  assert.strictEqual(intake.status, 400, JSON.stringify(intake.json));
  assert.strictEqual(intake.json.code, 'PASS_REQUIRED');
  assert.deepStrictEqual(intake.json.unresolved, [{ id: String(ctx.d10._id), reason: 'intake' }]);
  assert.match(intake.json.error, /not in a walk list yet/);
  assert.strictEqual((await deskRows({ householdId: ctx.d10._id })).length, 0);

  // Intake door WITH a passId → the effort guard: ineligible, never marked.
  const intakeExplicit = await mark([ctx.d10], ctx.p1);
  assert.strictEqual(intakeExplicit.status, 200, JSON.stringify(intakeExplicit.json));
  assert.deepStrictEqual(intakeExplicit.json.skipped, { ...noSkips, ineligible: 1 });
  assert.strictEqual(intakeExplicit.json.marked, 0);
  assert.strictEqual((await deskRows({ householdId: ctx.d10._id })).length, 0);

  // A door whose effort ≠ the named round's effort is ineligible too (d7 is E2, P1 is E1).
  const wrongEffort = await mark([ctx.d8], ctx.p1);
  assert.strictEqual(wrongEffort.status, 200);
  assert.strictEqual(wrongEffort.json.skipped.ineligible, 1);
  assert.strictEqual((await deskRows({ householdId: ctx.d8._id })).length, 0);

  // Effort with only an archived round, no passId → PASS_REQUIRED 'no-round'.
  const noRound = await mark([ctx.d11]);
  assert.strictEqual(noRound.status, 400, JSON.stringify(noRound.json));
  assert.strictEqual(noRound.json.code, 'PASS_REQUIRED');
  assert.deepStrictEqual(noRound.json.unresolved, [{ id: String(ctx.d11._id), reason: 'no-round' }]);
  assert.match(noRound.json.error, /Pick a round first/);

  // Mixed batch is all-or-nothing: a resolvable door rides along with an Intake one → 400, nothing written.
  const mixed = await mark([ctx.d5, ctx.d10]);
  assert.strictEqual(mixed.status, 400);
  assert.strictEqual((await deskRows({ householdId: ctx.d5._id })).length, 0);

  // Unknown explicit round → 404; another campaign's round is "unknown" too.
  assert.strictEqual((await mark([ctx.d4], new mongoose.Types.ObjectId())).status, 404);
  assert.strictEqual((await mark([ctx.d4], ctx.p4)).status, 404, 'C2’s round is not this campaign’s');

  // Archived round → 409 pass-archived (a mark there would never reach a canvasser).
  const archived = await mark([ctx.d11], ctx.p3);
  assert.strictEqual(archived.status, 409, JSON.stringify(archived.json));
  assert.strictEqual(archived.json.code, 'pass-archived');
  assert.strictEqual((await deskRows({ householdId: ctx.d11._id })).length, 0);

  // Body validation.
  assert.strictEqual((await mark([])).status, 400);
  assert.strictEqual((await mark(Array.from({ length: 1001 }, () => new mongoose.Types.ObjectId()))).status, 400);
  const badPass = await call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/restrict-doors`, { ...asAdmin(), body: { householdIds: [String(ctx.d4._id)], passId: 'nope' } });
  assert.strictEqual(badPass.status, 400);
  // A door from another campaign is simply not found here → ineligible, never written.
  const foreign = await mark([ctx.d20], ctx.p1);
  assert.strictEqual(foreign.status, 200);
  assert.deepStrictEqual(foreign.json.skipped, { ...noSkips, ineligible: 1 });
  assert.strictEqual((await deskRows({ householdId: ctx.d20._id })).length, 0);
});

test('5. skip ladder: a completed door keeps its result; a field-restricted door is already restricted', { skip }, async () => {
  const done = await mark([ctx.d1], ctx.p1);
  assert.strictEqual(done.status, 200);
  assert.deepStrictEqual(done.json.skipped, { ...noSkips, completed: 1 });
  assert.strictEqual(done.json.marked, 0);
  assert.strictEqual(await statusOf(ctx.d1), 'surveyed');
  assert.strictEqual((await deskRows({ householdId: ctx.d1._id })).length, 0);

  const already = await mark([ctx.d2], ctx.p1);
  assert.strictEqual(already.status, 200);
  assert.deepStrictEqual(already.json.skipped, { ...noSkips, alreadyRestricted: 1 });
  assert.strictEqual((await deskRows({ householdId: ctx.d2._id })).length, 0, 'the field mark stands alone');
});

test('6. a reached door is marked; its not_home knock survives; nothing per-canvasser or billable moves', { skip }, async () => {
  const r = await mark([ctx.d3], ctx.p1);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.marked, 1);
  assert.strictEqual(await CanvassActivity.countDocuments({ householdId: ctx.d3._id, actionType: 'not_home' }), 1, 'field row never deleted');
  const m = await getPassStatusMap(ctx.p1._id, [ctx.d3._id], 'survey');
  assert.strictEqual(m.get(String(ctx.d3._id)).status, 'restricted', 'round status is latest-wins');
  assert.strictEqual(await statusOf(ctx.d3), 'restricted');

  const kbp = await call('GET', `/admin/reports/knocks-by-pass?campaignId=${ctx.camp._id}`, asAdmin());
  assert.deepStrictEqual(kbp.json.totals, baseline.kbpTotals, 'knocks-by-pass totals unchanged by desk marks');
  const cv = await call('GET', `/admin/reports/canvassers?campaignId=${ctx.camp._id}`, asAdmin());
  assert.deepStrictEqual(cv.json, baseline.canvassers, 'per-canvasser rows unchanged');
  assert.ok(!cv.json.some((row) => String(row.userId || row.id) === String(ctx.admin._id)), 'no phantom admin canvasser');
});

test('7. idempotent: marking a desk-restricted door again writes nothing', { skip }, async () => {
  const r = await mark([ctx.d4], ctx.p1);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.skipped, { ...noSkips, alreadyRestricted: 1 });
  assert.strictEqual((await deskRows({ householdId: ctx.d4._id })).length, 1);
});

test('8. a building: every unit at the pin marked in one call; the GPS audit sees nothing', { skip }, async () => {
  const r = await mark(ctx.units.map((u) => u._id), ctx.p1);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.marked, 4);
  assert.deepStrictEqual(r.json.skipped, noSkips);
  for (const u of ctx.units) assert.strictEqual(await statusOf(u), 'restricted');
  const flags = await call('GET', `/admin/reports/flags?campaignId=${ctx.camp._id}`, asAdmin());
  assert.strictEqual(flags.status, 200);
  assert.strictEqual(flags.json.summary.totals.flaggedActions, 0, 'four same-second rows at one pin must be invisible to detection');
});

test('9. canvassers see slate doors per-round: bootstrap + the delta poll carry every touched door', { skip }, async () => {
  const boot = await call('GET', `/mobile/bootstrap?campaignId=${ctx.camp._id}`, { token: ctx.canvTok, orgId: ctx.org._id });
  assert.strictEqual(boot.status, 200);
  const byId = new Map(boot.json.households.map((h) => [String(h._id), h.status]));
  for (const hh of [ctx.d3, ctx.d4, ...ctx.units]) {
    assert.strictEqual(byId.get(String(hh._id)), 'restricted', `${hh.addressLine1} ${hh.addressLine2 || ''} reads slate`);
  }
  assert.strictEqual(byId.get(String(ctx.d1._id)), 'surveyed', 'this-round completion stays');

  const delta = await call('GET', `/mobile/changes?campaignId=${ctx.camp._id}&since=${encodeURIComponent(baseline.since)}`, { token: ctx.canvTok, orgId: ctx.org._id });
  assert.strictEqual(delta.status, 200);
  const ids = new Set(delta.json.households.map((h) => String(h._id)));
  for (const hh of [ctx.d3, ctx.d4, ...ctx.units]) {
    assert.ok(ids.has(String(hh._id)), `door ${hh.addressLine1} ${hh.addressLine2 || ''} must reach already-bootstrapped canvassers`);
  }
});

test('10. Campaign.stats: desk rows count in activityCount and NOWHERE else', { skip }, async () => {
  const desk = await CanvassActivity.countDocuments({ campaignId: ctx.camp._id, ...DESK_RESTRICT_MATCH });
  assert.ok(desk >= 7, `fixture has desk rows (${desk})`);
  const s = await computeCampaignStats(ctx.camp._id);
  assert.strictEqual(s.activityCount, baseline.stats.activityCount + desk, 'activityCount includes desk rows');
  assert.strictEqual(s.knockCount, baseline.stats.knockCount, 'never a knock');
  assert.strictEqual(s.surveyedKnockCount, baseline.stats.surveyedKnockCount);
  assert.strictEqual(s.restrictedDoorCount, baseline.stats.restrictedDoorCount, 'never a billable restricted door');
  assert.deepStrictEqual(s.canvasserIds.map(String), baseline.stats.canvasserIds.map(String), 'no phantom admin canvasser');
  assert.strictEqual(String(s.lastActivityAt), String(baseline.stats.lastActivityAt), 'desk rows are not activity for the clock');
  // And the stored counters were recomputed to the same answer by the route.
  const stored = (await Campaign.findById(ctx.camp._id).lean()).stats;
  assert.strictEqual(stored.activityCount, s.activityCount);
});

test('11. billing: a campaign whose only activity is a single-home desk mark never starts the clock', { skip }, async () => {
  const r = await mark([ctx.d20], null, ctx.camp2._id);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.marked, 1);
  assert.strictEqual(r.json.passId, String(ctx.p4._id));
  const st = await monthlyStatement(ctx.org._id, currentMonth());
  const line = st.lines.find((l) => l.campaignId === String(ctx.camp2._id));
  assert.ok(line, 'C2 has a statement line');
  assert.strictEqual(line.billable, false, 'a desk mark must not start the billing clock');
  assert.strictEqual(line.firstKnockAt, null);
  assert.strictEqual(line.amountCents, 0);
});

test('12. /activity: entries carry via, rounds carry status, currentPassId follows the resolution rule', { skip }, async () => {
  const activity = (hh) => call('GET', `/admin/households/${hh._id}/activity`, asAdmin());

  const a4 = await activity(ctx.d4);
  assert.strictEqual(a4.status, 200);
  assert.strictEqual(a4.json.currentPassId, String(ctx.p1._id), 'booked door on an active round');
  const r4 = a4.json.rounds.find((r) => r.passId === String(ctx.p1._id));
  assert.ok(r4, 'P1 listed');
  assert.strictEqual(r4.status, 'active');
  assert.strictEqual(r4.entries[0].actionType, 'restricted');
  assert.strictEqual(r4.entries[0].via, 'bulk', 'a desk mark');
  assert.strictEqual(r4.entries[0].canvasser, 'Ada Admin');

  const a3 = await activity(ctx.d3);
  const r3 = a3.json.rounds.find((r) => r.passId === String(ctx.p1._id));
  assert.deepStrictEqual(r3.entries.map((e) => [e.actionType, e.via]), [['restricted', 'bulk'], ['not_home', null]], 'field entries carry via:null');

  const a7 = await activity(ctx.d7);
  assert.strictEqual(a7.json.currentPassId, String(ctx.p2._id), 'draft-only effort → its single draft');
  assert.strictEqual(a7.json.rounds.find((r) => r.passId === String(ctx.p2._id)).status, 'draft');

  const a10 = await activity(ctx.d10);
  assert.strictEqual(a10.status, 200);
  assert.strictEqual(a10.json.currentPassId, null, 'Intake → null');
  assert.deepStrictEqual(a10.json.rounds, []);

  const a11 = await activity(ctx.d11);
  assert.strictEqual(a11.json.currentPassId, null, 'archived-only effort → null');
});

test('13. Campaign.disabledOutcomes restricted → the desk path is deliberately unaffected', { skip }, async () => {
  await Campaign.updateOne({ _id: ctx.camp._id }, { $set: { disabledOutcomes: ['restricted'] } });
  try {
    const r = await mark([ctx.d5], ctx.p1);
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.marked, 1);
  } finally {
    await Campaign.updateOne({ _id: ctx.camp._id }, { $set: { disabledOutcomes: [] } });
  }
});

test('14. unmark: field marks never touched; desk rows removed by exact round; no pass-existence check', { skip }, async () => {
  // A field-restricted door has no desk row: 200, nothing removed, still restricted.
  const field = await unmark([ctx.d2]);
  assert.strictEqual(field.status, 200, JSON.stringify(field.json));
  assert.deepStrictEqual(field.json, { unmarked: 0, households: 0, passId: String(ctx.p1._id), passIds: [String(ctx.p1._id)] });
  assert.strictEqual(await statusOf(ctx.d2), 'restricted');
  assert.strictEqual(await CanvassActivity.countDocuments({ householdId: ctx.d2._id, actionType: 'restricted' }), 1);

  const before4 = (await Household.findById(ctx.d4._id).lean()).updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  const r = await unmark([ctx.d3, ctx.d4], ctx.p1);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.unmarked, 2);
  assert.strictEqual(r.json.households, 2);
  assert.strictEqual(await statusOf(ctx.d3), 'not_home', 'the field knock is the latest again');
  assert.strictEqual(await statusOf(ctx.d4), 'unknocked');
  assert.ok((await Household.findById(ctx.d4._id).lean()).updatedAt > before4, 'updatedAt moved so the delta poll delivers it');
  assert.strictEqual((await deskRows({ householdId: { $in: [ctx.d3._id, ctx.d4._id] } })).length, 0);

  // Unmark deletes by the passId the client NAMES, even when no such round exists any more (an
  // old draft deleted before the sweep existed): seed the orphan row directly.
  const ghostPass = new mongoose.Types.ObjectId();
  await CanvassActivity.create(buildDeskRestrictRow({ hh: ctx.d7, userId: ctx.admin._id, passId: ghostPass, turfId: null, now: new Date() }));
  const ghost = await unmark([ctx.d7], ghostPass);
  assert.strictEqual(ghost.status, 200, JSON.stringify(ghost.json));
  assert.strictEqual(ghost.json.unmarked, 1);
  assert.strictEqual(await statusOf(ctx.d7), 'restricted', 'the P2 mark is a different round and stays');
  assert.strictEqual((await deskRows({ householdId: ctx.d7._id })).length, 1);

  // Unmark without a passId on an Intake door resolves like mark does → PASS_REQUIRED.
  const intake = await unmark([ctx.d10]);
  assert.strictEqual(intake.status, 400);
  assert.strictEqual(intake.json.code, 'PASS_REQUIRED');
});

test('15. the cut: Exclude restricted drops a single-home mark; supplemental and book counts include it (Option B)', { skip }, async () => {
  assert.strictEqual(
    await Household.countDocuments({ _id: ctx.d9._id, ...cutStatusExclusion({ excludeRestricted: true }) }),
    0,
    'd9 is out of the next cut once excluded'
  );
  const g = await call('GET', `/admin/campaigns/${ctx.camp._id}/turfs?passId=${ctx.p1._id}`, asAdmin());
  assert.strictEqual(g.status, 200);
  assert.strictEqual(g.json.supplementalDoorCount, 1, 'd9 is the only bookless knockable door');
  assert.strictEqual(g.json.supplementalRestrictedCount, 1, 'and it is the restricted slice');
  // Book-level count = desk ROWS on the doors currently in the book, for its round.
  const b1 = g.json.turfs.find((t) => String(t._id) === String(ctx.b1._id));
  const expected = await CanvassActivity.countDocuments({ passId: ctx.p1._id, householdId: { $in: ctx.b1.householdIds }, ...DESK_RESTRICT_MATCH });
  assert.ok(expected > 0);
  assert.strictEqual(b1.bulkRestrictedCount, expected, 'single-home marks count under the book');
  assert.strictEqual(g.json.turfs.find((t) => String(t._id) === String(ctx.b2._id)).bulkRestrictedCount, 0);
  // The book-detail count agrees.
  const detail = await call('GET', `/admin/campaigns/${ctx.camp._id}/turfs/${ctx.b1._id}/households`, asAdmin());
  assert.strictEqual(detail.status, 200);
  assert.strictEqual(detail.json.turf.bulkRestrictedCount, expected);
  // The book-level undo takes every desk mark on the book's current doors — including the
  // single-home ones — and leaves the loose door's mark alone.
  const undo = await call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/unrestrict-bulk`, { ...asAdmin(), body: { turfIds: [String(ctx.b1._id)] } });
  assert.strictEqual(undo.status, 200);
  assert.strictEqual(undo.json.unmarked, expected);
  assert.strictEqual((await deskRows({ householdId: ctx.d9._id })).length, 1, 'loose-door mark is door-level only');
  // Re-mark the building so the later reads (exports, /map) still have desk rows to look at.
  const again = await mark(ctx.units.map((u) => u._id), ctx.p1);
  assert.strictEqual(again.json.marked, 4);
});

test('16. exports print `bulk`; the module refuses any other actionType and a null round', { skip }, async () => {
  const job = await ExportJob.create({
    organizationId: ctx.org._id,
    campaignId: ctx.camp._id,
    type: 'canvass-activity',
    params: { anchorTz: 'America/New_York' },
    requestedBy: ctx.admin._id,
  });
  await processExportJob({ data: { exportJobId: String(job._id) }, id: `t-${job._id}`, attemptsMade: 1, opts: { attempts: 3 } });
  const doc = await ExportJob.findById(job._id).lean();
  assert.strictEqual(doc.status, 'completed', `export completed (error: ${doc.error})`);
  const text = await new Promise((resolve, reject) => {
    const chunks = [];
    const s = openArtifactDownloadStream(job._id);
    s.on('data', (c) => chunks.push(c));
    s.on('error', reject);
    s.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
  const lines = text.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
  const unitRows = lines.filter((l) => l.includes('restricted') && l.includes('Unit '));
  assert.strictEqual(unitRows.length, 4, 'the four unit desk marks are in the ledger export');
  for (const l of unitRows) assert.match(l, /,bulk,/, 'desk-authored rows carry Via=bulk');
  const fieldRestricted = lines.find((l) => l.includes('restricted') && l.includes(ctx.d2.addressLine1));
  assert.match(fieldRestricted, /,field,/, 'the canvasser’s own mark stays field');

  const hh = await Household.findById(ctx.d4._id).lean();
  assert.throws(() => buildDeskRestrictRow({ hh, userId: ctx.admin._id, passId: ctx.p1._id, now: new Date(), actionType: 'not_home' }), /always 'restricted'/);
  assert.throws(() => buildDeskRestrictRow({ hh, userId: ctx.admin._id, passId: null, now: new Date() }), /passId/);
  await assert.rejects(removeDeskRestrict({ campaign: ctx.camp, filter: { actionType: 'not_home' } }), /only actionType:'restricted'/);
  await assert.rejects(removeDeskRestrict({ campaign: ctx.camp, filter: { via: null } }), /only via:'bulk'/);
});

test('17. deleting a draft round sweeps its desk marks; unmark afterwards is still a 200', { skip }, async () => {
  const r = await mark([ctx.d8], ctx.p2);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.marked, 1);
  assert.strictEqual(await statusOf(ctx.d8), 'restricted');
  assert.strictEqual((await deskRows({ passId: ctx.p2._id })).length, 2, 'd7 + d8');

  const del = await call('DELETE', `/admin/campaigns/${ctx.camp._id}/passes/${ctx.p2._id}`, asAdmin());
  assert.strictEqual(del.status, 200, JSON.stringify(del.json));
  assert.strictEqual((await deskRows({ passId: ctx.p2._id })).length, 0, 'swept with the round');
  assert.strictEqual(await statusOf(ctx.d8), 'unknocked', 'status recomputed');
  assert.strictEqual(await statusOf(ctx.d7), 'unknocked');
  assert.strictEqual(await Turf.countDocuments({ _id: ctx.b3._id }), 0);

  // No pass-existence check on unmark: the round is gone, the call still answers 200.
  const after = await unmark([ctx.d7], ctx.p2);
  assert.strictEqual(after.status, 200, JSON.stringify(after.json));
  assert.strictEqual(after.json.unmarked, 0);
});

test('18. /map rows carry effortId and lastAction.via', { skip }, async () => {
  const r = await call('GET', `/admin/households/map?campaignId=${ctx.camp._id}`, asAdmin());
  assert.strictEqual(r.status, 200);
  const byId = new Map(r.json.households.map((h) => [h.id, h]));
  const u1 = byId.get(String(ctx.u1._id));
  assert.ok(u1, 'u1 on the map');
  assert.strictEqual(u1.effortId, String(ctx.e1._id));
  assert.strictEqual(u1.lastAction.actionType, 'restricted');
  assert.strictEqual(u1.lastAction.via, 'bulk', 'a desk mark, not the admin’s field work');
  const d2 = byId.get(String(ctx.d2._id));
  assert.strictEqual(d2.lastAction.actionType, 'restricted');
  assert.strictEqual(d2.lastAction.via, null, 'field-recorded');
  const d10 = byId.get(String(ctx.d10._id));
  assert.ok(d10, 'Intake door on the map');
  assert.strictEqual(d10.effortId, null);
  assert.strictEqual(d10.lastAction, null);
});

// ── scope: the reached-door ladder, mirroring restrict-bulk's (bulkRestrictScope.int.test.js) ──
// The map lasso hands this route a street the crew worked in part, so the same choice the
// whole-book flow offers has to exist here: 'unknocked' must never relabel a not-home or a
// refusal as inaccessible. d12/d13 (Book 2, round P1) become the reached pair below; they were
// untouched until now, so no earlier baseline moves.

test("19. scope 'unknocked': reached doors are left exactly as they are and counted in skipped.reached", { skip }, async () => {
  const ago = (min) => new Date(Date.now() - 1800_000 + min * 60_000);
  await CanvassActivity.insertMany([
    fieldRow(ctx.d12, ctx.canv._id, 'not_home', ctx.p1._id, ctx.b2._id, ago(0)),
    fieldRow(ctx.d13, ctx.canv._id, 'refused', ctx.p1._id, ctx.b2._id, ago(10)),
  ]);
  await Household.updateOne({ _id: ctx.d12._id }, { status: 'not_home' });
  await Household.updateOne({ _id: ctx.d13._id }, { status: 'refused' });

  const r = await mark([ctx.d12, ctx.d13, ctx.d6, ctx.d1], ctx.p1, ctx.camp._id, 'unknocked');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.marked, 1, 'only the untouched door');
  assert.deepStrictEqual(r.json.skipped, { ...noSkips, reached: 2, completed: 1 });

  // The reached pair keeps its per-round status, its knock and its clean desk ledger.
  const m = await getPassStatusMap(ctx.p1._id, [ctx.d12._id, ctx.d13._id], ctx.camp.type);
  assert.strictEqual(m.get(String(ctx.d12._id)).status, 'not_home');
  assert.strictEqual(m.get(String(ctx.d13._id)).status, 'refused');
  assert.strictEqual((await deskRows({ householdId: { $in: [ctx.d12._id, ctx.d13._id] } })).length, 0);
  assert.strictEqual(await statusOf(ctx.d6), 'restricted');
  assert.strictEqual(await statusOf(ctx.d1), 'surveyed', 'a completed door is still completed, not reached');
});

test("20. scope 'incomplete' on the same selection marks the reached doors; their knocks survive", { skip }, async () => {
  const r = await mark([ctx.d12, ctx.d13, ctx.d6, ctx.d1], ctx.p1, ctx.camp._id, 'incomplete');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.marked, 2, 'the two reached doors');
  assert.deepStrictEqual(r.json.skipped, { ...noSkips, alreadyRestricted: 1, completed: 1 }, 'reached is never populated here');
  assert.strictEqual(await statusOf(ctx.d12), 'restricted');
  assert.strictEqual(await statusOf(ctx.d13), 'restricted');
  assert.strictEqual(await CanvassActivity.countDocuments({ householdId: ctx.d12._id, actionType: 'not_home' }), 1, 'field row never deleted');

  const undo = await unmark([ctx.d12, ctx.d13], ctx.p1); // reset for the back-compat case
  assert.strictEqual(undo.json.unmarked, 2);
  assert.strictEqual(await statusOf(ctx.d12), 'not_home', 'the field knock is the latest again');
});

test("21. an omitted scope is still 'incomplete' — and so is anything that is not 'unknocked'", { skip }, async () => {
  const omitted = await mark([ctx.d12, ctx.d13], ctx.p1);
  assert.strictEqual(omitted.status, 200, JSON.stringify(omitted.json));
  assert.strictEqual(omitted.json.marked, 2, 'an older client sending no scope marks the reached doors, as it always did');
  assert.strictEqual(omitted.json.skipped.reached, 0);
  assert.strictEqual((await unmark([ctx.d12, ctx.d13], ctx.p1)).json.unmarked, 2);

  const bogus = await mark([ctx.d12, ctx.d13], ctx.p1, ctx.camp._id, 'sideways');
  assert.strictEqual(bogus.status, 200, JSON.stringify(bogus.json));
  assert.strictEqual(bogus.json.marked, 2, 'an unknown scope falls back to the default, never to unknocked');
  assert.strictEqual(bogus.json.skipped.reached, 0);
  assert.strictEqual((await unmark([ctx.d12, ctx.d13], ctx.p1)).json.unmarked, 2);
});

test('22. the 1000-id cap: a full batch is accepted, 1001 is refused WHOLE', { skip }, async () => {
  const pad = (n) => Array.from({ length: n }, () => new mongoose.Types.ObjectId());
  const atCap = await mark([ctx.d12, ...pad(999)], ctx.p1);
  assert.strictEqual(atCap.status, 200, JSON.stringify(atCap.json));
  assert.strictEqual(atCap.json.marked, 1);
  assert.strictEqual(atCap.json.skipped.ineligible, 999, 'ids that name no door in this campaign');
  assert.strictEqual(await statusOf(ctx.d12), 'restricted');

  // One over the cap: nothing is truncated and nothing is written — the client must trim first.
  const over = await mark([ctx.d13, ...pad(1000)], ctx.p1);
  assert.strictEqual(over.status, 400, JSON.stringify(over.json));
  assert.strictEqual((await deskRows({ householdId: ctx.d13._id })).length, 0, 'the whole batch is refused');
  assert.strictEqual(await statusOf(ctx.d13), 'refused');
});
