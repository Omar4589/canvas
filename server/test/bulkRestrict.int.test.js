import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Bulk "mark whole book restricted" over the REAL Express app + throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/bulkrestrict_test node --test test/bulkRestrict.int.test.js
// Proves: skip rules (round-completed + already-restricted), row provenance
// (via:'bulk', admin userId, house coords, book pass/turf), canvassers SEE the
// slate doors per-round (bootstrap + the delta poll, incl. the unchanged-status
// edge), the GPS audit stays at ZERO flags (with a control proving detection
// still fires on field rows), no phantom admin canvasser, field override wins,
// and unrestrict removes only bulk marks.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-bulk-restrict';

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

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

function makeHousehold(orgId, campaignId, effortId, n) {
  return {
    organizationId: orgId,
    campaignId,
    effortId,
    addressLine1: `${n} Gated Ct`,
    city: 'Town',
    state: 'FL',
    zipCode: '34741',
    normalizedAddress: `${n} GATED CT|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.4 + n * 0.001, 28.3] },
    isActive: true,
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
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass, Turf, TurfAssignment, Household, CanvassActivity, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Bulk Org', slug: 'bulk-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ba@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Canvasser', email: 'bc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Bulk C', type: 'survey', state: 'FL', isActive: true });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: canv._id });
  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const priorPass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Pass 1', status: 'archived',
  });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 2, name: 'Pass 2', status: 'active',
  });

  const hhs = await Household.insertMany([1, 2, 3, 4, 5, 6].map((n) => makeHousehold(org._id, camp._id, effort._id, n)));
  const [hhSurveyed, hhFieldRestricted, hhNotHome, hhPriorSurveyed, hhFresh1, hhFresh2] = hhs;

  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book G', mode: 'geometric',
    status: 'published', householdIds: hhs.map((h) => h._id), doorCount: hhs.length,
  });
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: canv._id });

  // Field rows staggered 10 min apart — same-timestamp field rows would
  // legitimately trip the audit's `rapid` flag and muddy the zero-flag assert.
  const earlier = (min) => new Date(Date.now() - 3600_000 + min * 60_000);
  await CanvassActivity.insertMany([
    fieldRow(hhSurveyed, canv._id, 'survey_submitted', pass._id, turf._id, earlier(0)),
    fieldRow(hhFieldRestricted, canv._id, 'restricted', pass._id, turf._id, earlier(10)),
    fieldRow(hhNotHome, canv._id, 'not_home', pass._id, turf._id, earlier(20)),
    fieldRow(hhPriorSurveyed, canv._id, 'survey_submitted', priorPass._id, turf._id, new Date(Date.now() - 86400_000)),
  ]);
  // Seed global statuses to match (the app recomputes on write; do it directly).
  await Household.updateOne({ _id: hhSurveyed._id }, { status: 'surveyed' });
  await Household.updateOne({ _id: hhFieldRestricted._id }, { status: 'restricted' });
  await Household.updateOne({ _id: hhNotHome._id }, { status: 'not_home' });
  await Household.updateOne({ _id: hhPriorSurveyed._id }, { status: 'surveyed' });

  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, effort, pass, priorPass, turf, admin, canv,
    hhSurveyed, hhFieldRestricted, hhNotHome, hhPriorSurveyed, hhFresh1, hhFresh2,
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

let sincePreMark;

test('restrict-bulk: marks eligible doors, skips completed + already-restricted, keeps field rows', { skip }, async () => {
  sincePreMark = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 5)); // updatedAt must land after `since`
  const r = await call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/restrict-bulk`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { turfIds: [String(ctx.turf._id)] },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.marked, 4, 'not_home + prior-pass-surveyed + 2 fresh');
  assert.strictEqual(r.json.skipped.completed, 1);
  assert.strictEqual(r.json.skipped.alreadyRestricted, 1);

  const bulkRows = await CanvassActivity.find({ via: 'bulk' }).lean();
  assert.strictEqual(bulkRows.length, 4);
  for (const row of bulkRows) {
    assert.strictEqual(row.actionType, 'restricted');
    assert.strictEqual(String(row.userId), String(ctx.admin._id));
    assert.strictEqual(String(row.passId), String(ctx.pass._id));
    assert.strictEqual(String(row.turfId), String(ctx.turf._id));
    assert.strictEqual(row.distanceFromHouseMeters, 0);
    assert.ok(row.location?.lat && row.location?.lng, 'house coords required');
  }
  // The canvasser's field not_home row survives (never deleted by bulk).
  assert.strictEqual(
    await CanvassActivity.countDocuments({ householdId: ctx.hhNotHome._id, actionType: 'not_home' }),
    1
  );
  // Global statuses: fresh + not_home doors flip to restricted; completion-sticky
  // doors keep surveyed (incl. the PRIOR-pass completion — the documented edge).
  assert.strictEqual((await Household.findById(ctx.hhFresh1._id).lean()).status, 'restricted');
  assert.strictEqual((await Household.findById(ctx.hhNotHome._id).lean()).status, 'restricted');
  assert.strictEqual((await Household.findById(ctx.hhSurveyed._id).lean()).status, 'surveyed');
  assert.strictEqual((await Household.findById(ctx.hhPriorSurveyed._id).lean()).status, 'surveyed');
});

test('canvasser sees slate doors per-round in the bootstrap', { skip }, async () => {
  const r = await call('GET', `/mobile/bootstrap?campaignId=${ctx.camp._id}`, {
    token: ctx.canvTok,
    orgId: ctx.org._id,
  });
  assert.strictEqual(r.status, 200);
  const byId = new Map(r.json.households.map((h) => [String(h._id), h.status]));
  assert.strictEqual(byId.get(String(ctx.hhFresh1._id)), 'restricted');
  assert.strictEqual(byId.get(String(ctx.hhFresh2._id)), 'restricted');
  assert.strictEqual(byId.get(String(ctx.hhNotHome._id)), 'restricted');
  assert.strictEqual(byId.get(String(ctx.hhPriorSurveyed._id)), 'restricted', 'prior-pass completion is a NEW round here');
  assert.strictEqual(byId.get(String(ctx.hhSurveyed._id)), 'surveyed', 'this-round completion stays');
});

test('delta poll carries every touched door — including the unchanged-status edge', { skip }, async () => {
  const r = await call('GET', `/mobile/changes?campaignId=${ctx.camp._id}&since=${encodeURIComponent(sincePreMark)}`, {
    token: ctx.canvTok,
    orgId: ctx.org._id,
  });
  assert.strictEqual(r.status, 200);
  const ids = new Set(r.json.households.map((h) => String(h._id)));
  for (const hh of [ctx.hhFresh1, ctx.hhFresh2, ctx.hhNotHome, ctx.hhPriorSurveyed]) {
    assert.ok(ids.has(String(hh._id)), `door ${hh.addressLine1} must reach already-bootstrapped canvassers`);
  }
});

test('GPS audit: zero flags from the bulk; control field rows still flag', { skip }, async () => {
  const zero = await call('GET', `/admin/reports/flags?campaignId=${ctx.camp._id}`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
  });
  assert.strictEqual(zero.status, 200);
  assert.strictEqual(zero.json.summary.totals.flaggedActions, 0, 'bulk marks must be invisible to detection');

  // Control: two RAPID field rows (4s apart, distinct doors) prove the exclusion
  // isn't over-broad — detection still fires on real canvasser rows.
  const t0 = new Date();
  await CanvassActivity.insertMany([
    fieldRow(ctx.hhFresh1, ctx.canv._id, 'not_home', ctx.pass._id, ctx.turf._id, t0),
    fieldRow(ctx.hhFresh2, ctx.canv._id, 'not_home', ctx.pass._id, ctx.turf._id, new Date(t0.getTime() + 4000)),
  ]);
  const flagged = await call('GET', `/admin/reports/flags?campaignId=${ctx.camp._id}`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
  });
  assert.ok(flagged.json.summary.totals.flaggedActions > 0, 'control rows must still flag');
  await CanvassActivity.deleteMany({ _id: { $in: (await CanvassActivity.find({ timestamp: { $gte: t0 } }).lean()).map((r) => r._id) } });
});

test('no phantom admin canvasser in per-person reports', { skip }, async () => {
  const r = await call('GET', `/admin/reports/canvassers?campaignId=${ctx.camp._id}`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
  });
  assert.strictEqual(r.status, 200);
  const rows = Array.isArray(r.json) ? r.json : r.json.canvassers || r.json.rows || [];
  assert.ok(!rows.some((row) => String(row.userId || row.id) === String(ctx.admin._id)), 'admin must not appear');
  assert.ok(rows.some((row) => String(row.userId || row.id) === String(ctx.canv._id)), 'real canvasser still appears');
});

test('field re-disposition overrides a bulk mark', { skip }, async () => {
  const r = await call('POST', `/mobile/households/${ctx.hhFresh1._id}/not-home`, {
    token: ctx.canvTok,
    orgId: ctx.org._id,
    body: { location: { lat: 28.3, lng: -81.399 } },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual((await Household.findById(ctx.hhFresh1._id).lean()).status, 'not_home');
  // The bulk row remains (different user — history preserved); status is latest-wins.
  assert.strictEqual(
    await CanvassActivity.countDocuments({ householdId: ctx.hhFresh1._id, via: 'bulk' }),
    1
  );
});

test('unrestrict-bulk removes ONLY bulk marks; field restricted mark survives', { skip }, async () => {
  const r = await call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/unrestrict-bulk`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { turfIds: [String(ctx.turf._id)] },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.unmarked, 4);
  assert.strictEqual(await CanvassActivity.countDocuments({ via: 'bulk' }), 0);
  // Field restricted mark survives; statuses recompute back.
  assert.strictEqual(
    await CanvassActivity.countDocuments({ householdId: ctx.hhFieldRestricted._id, actionType: 'restricted' }),
    1
  );
  assert.strictEqual((await Household.findById(ctx.hhFieldRestricted._id).lean()).status, 'restricted');
  assert.strictEqual((await Household.findById(ctx.hhFresh2._id).lean()).status, 'unknocked');
  assert.strictEqual((await Household.findById(ctx.hhFresh1._id).lean()).status, 'not_home', 'field override kept');
  assert.strictEqual((await Household.findById(ctx.hhPriorSurveyed._id).lean()).status, 'surveyed');
});
