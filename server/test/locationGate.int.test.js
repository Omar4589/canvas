import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Location-required + GPS-provenance harness, over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/locgate_test node --test test/locationGate.int.test.js
// Locks the LOCATION_REQUIRED contract (no location = no knock, machine-readable code, zero
// rows written), the storage of the new location provenance fields (mocked / fixTimestamp) on
// BOTH ledgers, their free carry through the `replaced` correction snapshot, and — end to end
// through GET /admin/reports/flags — that a mocked row surfaces as a high `mock_gps` flag.
// That last assert is the guard for the detector's scan projection: `location` must keep
// covering the nested provenance fields, or mock detection silently dies.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-location-gate';

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
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { FlagReview } = await import('../src/models/FlagReview.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { HouseholdLocationChange } = await import('../src/models/HouseholdLocationChange.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const D1 = { lng: -81.4, lat: 28.3 };
const D2 = { lng: -81.39, lat: 28.3 };
// Doors for the stamp-validation cases (docs/PROPOSAL_GPS_UPGRADES.md §I.1), each its own so the
// replace chains don't cross.
const D3 = { lng: -81.38, lat: 28.3 };
const D4 = { lng: -81.37, lat: 28.3 };
const D5 = { lng: -81.36, lat: 28.3 };
const D6 = { lng: -81.35, lat: 28.3 };
const D7 = { lng: -81.34, lat: 28.3 };
const D8 = { lng: -81.33, lat: 28.3 };
// ~5 m north of a pin — near enough that no far flag can muddy the mock_gps asserts.
const near = (pin) => ({ lat: pin.lat + 0.000045, lng: pin.lng, accuracy: 5 });

function hh(orgId, campaignId, effortId, n, pin) {
  return {
    organizationId: orgId,
    campaignId,
    effortId,
    addressLine1: `${n} Gate St`,
    city: 'Town',
    state: 'FL',
    zipCode: '34741',
    normalizedAddress: `${n} GATE ST|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [pin.lng, pin.lat] },
    isActive: true,
    status: 'unknocked',
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass, Turf, TurfAssignment, Household, Voter, CanvassActivity, SurveyResponse, SurveyTemplate, Subscription, FlagReview, CampaignManager, HouseholdLocationChange]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Gate Org', slug: 'gate-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ga@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Gil', lastName: 'Walker', email: 'gc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'G Survey', questions: [], isActive: true });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'Gate C', type: 'survey', state: 'FL', isActive: true,
    surveyTemplateId: template._id,
  });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: canv._id });

  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const pass = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const homes = await Household.insertMany([D1, D2, D3, D4, D5, D6, D7, D8].map((pin, i) => hh(org._id, camp._id, effort._id, i + 1, pin)));
  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book G', mode: 'geometric',
    status: 'published', householdIds: homes.map((h) => h._id), doorCount: homes.length,
  });
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: canv._id });

  const voter = await Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: homes[1]._id, stateVoterId: 'FLG1',
    firstName: 'Vi', lastName: 'Voter', fullName: 'Vi Voter',
  });
  const voter2 = await Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: homes[5]._id, stateVoterId: 'FLG2',
    firstName: 'Ola', lastName: 'Voter', fullName: 'Ola Voter',
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, pass, effort, admin, canv, voter, voter2, template,
    d1: homes[0], d2: homes[1], d3: homes[2], d4: homes[3], d5: homes[4], d6: homes[5], d7: homes[6], d8: homes[7],
    adminTok: signUserToken(admin), tok: signUserToken(canv),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

// `raw` sends the body text as is: JSON.stringify can't write 1e400, which is the point of some cases.
async function call(method, path, { token, orgId, body, raw } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
}

let minute = 0;
function nextTs() {
  minute += 1;
  return new Date(Date.now() - 3600_000 + minute * 60_000).toISOString();
}

function knock(doorId, kind, body) {
  return call('POST', `/mobile/households/${doorId}/${kind}`, {
    token: ctx.tok,
    orgId: ctx.org._id,
    body: { timestamp: nextTs(), ...body },
  });
}

test('no location = no knock: 400 LOCATION_REQUIRED, nothing written', { skip }, async () => {
  for (const body of [{}, { location: null }]) {
    const r = await knock(ctx.d1._id, 'not-home', body);
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.code, 'LOCATION_REQUIRED', 'machine-readable code for the client alert');
    assert.match(r.json.error, /GPS location is required/i, 'human message for old clients');
  }
  assert.strictEqual(await CanvassActivity.countDocuments({}), 0, 'zero rows written');
  const door = await Household.findById(ctx.d1._id, 'status').lean();
  assert.strictEqual(door.status, 'unknocked', 'door untouched');
});

test('survey path: same LOCATION_REQUIRED contract', { skip }, async () => {
  const r = await call('POST', `/mobile/voters/${ctx.voter._id}/survey`, {
    token: ctx.tok,
    orgId: ctx.org._id,
    body: { surveyTemplateId: String(ctx.template._id), answers: [], location: null, timestamp: nextTs() },
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.code, 'LOCATION_REQUIRED');
  assert.strictEqual(await SurveyResponse.countDocuments({}), 0, 'no survey stored');
  assert.strictEqual(await CanvassActivity.countDocuments({}), 0, 'no activity row either');
});

test('provenance stored: mocked + fixTimestamp land on the activity row', { skip }, async () => {
  const fixTs = new Date(Date.now() - 30_000).toISOString();
  const r = await knock(ctx.d1._id, 'not-home', {
    location: { ...near(D1), mocked: true, fixTimestamp: fixTs },
  });
  assert.strictEqual(r.status, 201);
  const row = await CanvassActivity.findOne({ householdId: ctx.d1._id }).lean();
  assert.strictEqual(row.location.mocked, true, 'mocked stored');
  assert.strictEqual(new Date(row.location.fixTimestamp).toISOString(), fixTs, 'fixTimestamp stored as a Date');
});

test('a replace carries provenance through the `replaced` snapshot', { skip }, async () => {
  const r = await knock(ctx.d1._id, 'refused', {
    location: { ...near(D1), mocked: false, fixTimestamp: new Date().toISOString() },
  });
  assert.strictEqual(r.status, 201);
  const row = await CanvassActivity.findOne({ householdId: ctx.d1._id }).lean();
  assert.strictEqual(row.actionType, 'refused');
  assert.strictEqual(row.replaced.actionType, 'not_home');
  assert.strictEqual(row.replaced.location.mocked, true, 'the deleted mocked stamp survives in the snapshot');
  assert.ok(row.replaced.location.fixTimestamp, 'and so does its fixTimestamp');
});

test('survey stores provenance on BOTH ledgers', { skip }, async () => {
  const fixTs = new Date(Date.now() - 10_000).toISOString();
  const r = await call('POST', `/mobile/voters/${ctx.voter._id}/survey`, {
    token: ctx.tok,
    orgId: ctx.org._id,
    body: {
      surveyTemplateId: String(ctx.template._id),
      answers: [],
      location: { ...near(D2), mocked: true, fixTimestamp: fixTs },
      timestamp: nextTs(),
    },
  });
  assert.strictEqual(r.status, 201);
  const sr = await SurveyResponse.findOne({ voterId: ctx.voter._id }).lean();
  assert.strictEqual(sr.location.mocked, true, 'SurveyResponse ledger has it');
  const act = await CanvassActivity.findOne({ householdId: ctx.d2._id, actionType: 'survey_submitted' }).lean();
  assert.strictEqual(act.location.mocked, true, 'CanvassActivity ledger has it');
  assert.ok(act.location.fixTimestamp, 'fixTimestamp on the activity row');
});

test('end-to-end: /flags surfaces mocked rows as high mock_gps (projection guard)', { skip }, async () => {
  const r = await call('GET', `/admin/reports/flags?campaignId=${ctx.camp._id}`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
  });
  assert.strictEqual(r.status, 200);
  // Surviving rows: the refused on d1 (mocked:false — its mocked history lives only in the
  // snapshot, and detection reads the row's OWN stamp) and the survey on d2 (mocked:true).
  assert.strictEqual(r.json.summary.totals.mockGps, 1, 'exactly the mocked survey row');
  const mocked = r.json.entries.filter((e) => e.reasons.some((x) => x.type === 'mock_gps'));
  assert.strictEqual(mocked.length, 1, 'one mocked entry surfaced');
  assert.strictEqual(mocked[0].actionType, 'survey_submitted');
  assert.strictEqual(mocked[0].reasons.find((x) => x.type === 'mock_gps').severity, 'high');
});

test('end-to-end: a flag entry carries its pin precision, never who confirmed or corrected the pin', { skip }, async () => {
  const stamp = { coordSource: 'geocodio', coordConfidence: 'interpolated', locationConfirmedAt: new Date('2026-09-12T15:00:00Z'), locationConfirmedBy: ctx.admin._id, correctedBy: ctx.admin._id };
  await Household.updateOne({ _id: ctx.d2._id }, { $set: stamp });
  try {
    const r = await call('GET', `/admin/reports/flags?campaignId=${ctx.camp._id}`, { token: ctx.adminTok, orgId: ctx.org._id });
    assert.strictEqual(r.status, 200);
    const entry = r.json.entries.find((e) => e.reasons.some((x) => x.type === 'mock_gps'));
    assert.strictEqual(entry.household.coordConfidence, 'interpolated');
    assert.strictEqual(entry.household.locationConfirmedAt, '2026-09-12T15:00:00.000Z');
    assert.deepStrictEqual(Object.keys(entry.household), ['id', 'addressLine1', 'addressLine2', 'city', 'state', 'zipCode', 'location', 'coordConfidence', 'locationConfirmedAt']);
    assert.strictEqual(entry.reasons.find((x) => x.type === 'mock_gps').severity, 'high', 'the stamp changes no detection');
  } finally {
    await Household.updateOne({ _id: ctx.d2._id }, { $unset: { coordSource: 1, coordConfidence: 1, locationConfirmedAt: 1, locationConfirmedBy: 1, correctedBy: 1 } });
  }
});

test('mock-GPS nudge: openMockFlags rides both endpoints and tracks reviews', { skip }, async () => {
  // One surviving mocked row (the survey on d2) → the badge count is 1.
  // Lead scoping needs no assert here: both callers restrict the campaign list to
  // managedCampaignIds BEFORE calling campaignSummaries (campaigns.js / reports.js).
  const listRow = async () => {
    const r = await call('GET', '/admin/campaigns', { token: ctx.adminTok, orgId: ctx.org._id });
    assert.strictEqual(r.status, 200);
    return r.json.campaigns.find((c) => String(c._id) === String(ctx.camp._id));
  };
  assert.strictEqual((await listRow()).openMockFlags, 1, 'GET /admin/campaigns carries the count');

  const rollup = await call('GET', `/admin/reports/campaign-rollup?campaignId=${ctx.camp._id}`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
  });
  assert.strictEqual(rollup.status, 200);
  assert.strictEqual(rollup.json.campaigns[0].openMockFlags, 1, 'campaign-rollup carries the count');

  // Reviewing the mocked entry clears the badge (open = no FlagReview row)...
  const act = await CanvassActivity.findOne({ 'location.mocked': true }).lean();
  const review = (status) =>
    call('POST', '/admin/reports/flags/review', {
      token: ctx.adminTok,
      orgId: ctx.org._id,
      body: { actionModel: 'CanvassActivity', actionId: String(act._id), status },
    });
  assert.strictEqual((await review('confirmed')).status, 200);
  assert.strictEqual((await listRow()).openMockFlags, 0, 'a decision clears the badge');

  // ...and reopening (deletes the FlagReview row) brings it back.
  assert.strictEqual((await review('open')).status, 200);
  assert.strictEqual((await listRow()).openMockFlags, 1, 'reopen restores the badge');
});

// ── The campaign-scope guard must not swallow the flag-review WRITE ────────────────────
// reports.js mounts a bare `router.use` campaign-scope guard: no method filter, and it reads
// req.query only. It exists to stop READS from silently blending two campaigns' numbers.
// POST /flags/review is the router's ONLY write and it scopes itself — it loads the flagged
// action and re-derives campaignId from the record — so neither client sends ?campaignId.
// Before the exemption that meant an admin got 400 the moment the org ran a second campaign,
// and a LEAD got 403 in EVERY org (the lead branch has no single-campaign escape hatch).
// Both were live in the field. These run LAST because the second campaign they create flips
// the guard's `campaigns > 1` branch on for the whole org.
// ── Stamp validation (docs/PROPOSAL_GPS_UPGRADES.md §I.1) ───────────────────────────────────────
const rawPost = (path, text) => call('POST', path, { token: ctx.tok, orgId: ctx.org._id, raw: text });
const rawLoc = (lat, lng, accuracy = 5) => `{"lat":${lat},"lng":${lng},"accuracy":${accuracy}}`;

test('a non-finite coordinate is no location: 400 LOCATION_REQUIRED on all three write paths, nothing written', { skip }, async () => {
  const counts = async () => [await CanvassActivity.countDocuments({}), await SurveyResponse.countDocuments({}), await Voter.countDocuments({})];
  const before = await counts();
  for (const loc of [rawLoc('1e400', D3.lng), rawLoc(D3.lat, '-1e400'), `{"lat":"28.3","lng":${D3.lng},"accuracy":5}`]) {
    const r = await rawPost(`/mobile/households/${ctx.d3._id}/not-home`, `{"timestamp":"${nextTs()}","location":${loc}}`);
    assert.strictEqual(r.status, 400, loc);
    assert.strictEqual(r.json.code, 'LOCATION_REQUIRED', loc);
  }
  const s = await rawPost(`/mobile/voters/${ctx.voter2._id}/survey`, `{"surveyTemplateId":"${ctx.template._id}","answers":[],"timestamp":"${nextTs()}","location":${rawLoc(D6.lat, '-1e400')}}`);
  assert.strictEqual(s.json?.code, 'LOCATION_REQUIRED');
  const a = await rawPost(`/mobile/households/${ctx.d8._id}/voters`, `{"voterId":"${new mongoose.Types.ObjectId()}","firstName":"Nu","lastName":"Person","timestamp":"${nextTs()}","location":${rawLoc('1e400', D8.lng)}}`);
  assert.strictEqual(a.json?.code, 'LOCATION_REQUIRED');
  assert.deepStrictEqual(await counts(), before, 'nothing written on any ledger');
  assert.strictEqual((await Household.findById(ctx.d3._id, 'status').lean()).status, 'unknocked');
});

test('Infinity over JSON (1e400) is refused before the replace runs: the earlier entry survives', { skip }, async () => {
  assert.strictEqual((await knock(ctx.d3._id, 'not-home', { location: near(D3) })).status, 201);
  const r = await rawPost(`/mobile/households/${ctx.d3._id}/refused`, `{"timestamp":"${nextTs()}","location":${rawLoc('1e400', D3.lng)}}`);
  assert.strictEqual(r.status, 400, 'used to be a 500 after the replace had deleted the earlier entry');
  assert.strictEqual(r.json.code, 'LOCATION_REQUIRED');
  const rows = await CanvassActivity.find({ householdId: ctx.d3._id }).lean();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].actionType, 'not_home');
});

test('an accuracy that is not a usable radius is stored as null; a real one verbatim (knock path + snapshot)', { skip }, async () => {
  const latest = () => CanvassActivity.findOne({ householdId: ctx.d4._id }).lean();
  assert.strictEqual((await knock(ctx.d4._id, 'not-home', { location: { ...near(D4), accuracy: -1 } })).status, 201);
  assert.strictEqual((await latest()).location.accuracy, null, 'an iPhone invalid-fix sentinel is unknown');
  assert.strictEqual((await knock(ctx.d4._id, 'refused', { location: { ...near(D4), accuracy: 0 } })).status, 201);
  let row = await latest();
  assert.strictEqual(row.location.accuracy, null, 'an Android no-estimate zero is unknown');
  assert.strictEqual(row.replaced.location.accuracy, null);
  assert.strictEqual(row.replaced.nearest.accuracy, null);
  const inf = await rawPost(`/mobile/households/${ctx.d4._id}/not-home`, `{"timestamp":"${nextTs()}","location":${rawLoc(near(D4).lat, D4.lng, '1e400')}}`);
  assert.strictEqual(inf.status, 201, 'an absurd accuracy is stored as unknown, never refused');
  assert.strictEqual((await latest()).location.accuracy, null);
  assert.strictEqual((await knock(ctx.d4._id, 'refused', { location: { ...near(D4), accuracy: 12.5 } })).status, 201);
  assert.strictEqual((await latest()).location.accuracy, 12.5, 'a real radius passes verbatim');
  assert.strictEqual((await knock(ctx.d4._id, 'not-home', { location: { lat: near(D4).lat, lng: D4.lng } })).status, 201);
  row = await latest();
  assert.strictEqual(row.location.accuracy, null, 'omitted is unknown');
  assert.strictEqual(row.replaced.location.accuracy, 12.5, 'the snapshot keeps the real radius');
});

test('survey: the accuracy rule holds on BOTH ledgers', { skip }, async () => {
  const r = await call('POST', `/mobile/voters/${ctx.voter2._id}/survey`, {
    token: ctx.tok,
    orgId: ctx.org._id,
    body: { surveyTemplateId: String(ctx.template._id), answers: [], location: { ...near(D6), accuracy: -1 }, timestamp: nextTs() },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual((await SurveyResponse.findOne({ voterId: ctx.voter2._id }).lean()).location.accuracy, null);
  assert.strictEqual((await CanvassActivity.findOne({ householdId: ctx.d6._id, actionType: 'survey_submitted' }).lean()).location.accuracy, null);
});

test('a legacy row with a negative accuracy is snapshotted through the same rule; the nearest pick ignores the sentinel', { skip }, async () => {
  // Older than every timestamp nextTs() hands out, so the replay guard sees a normal correction.
  const ts = new Date(Date.now() - 2 * 3600_000);
  const earlier = new Date(ts.getTime() - 60_000);
  const legacyLat = D5.lat + 0.0006;
  await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, effortId: ctx.effort._id, passId: ctx.pass._id,
    householdId: ctx.d5._id, userId: ctx.canv._id, actionType: 'not_home', timestamp: ts,
    location: { lat: legacyLat, lng: D5.lng, accuracy: -20 }, distanceFromHouseMeters: 70,
    replaced: { actionType: 'not_home', timestamp: earlier, location: { lat: legacyLat, lng: D5.lng, accuracy: 10 }, distanceFromHouseMeters: 95, nearest: { distanceFromHouseMeters: 95, accuracy: 10, timestamp: earlier } },
  });
  assert.strictEqual((await knock(ctx.d5._id, 'refused', { location: near(D5) })).status, 201);
  const row = await CanvassActivity.findOne({ householdId: ctx.d5._id, actionType: 'refused' }).lean();
  assert.strictEqual(row.replaced.location.accuracy, null, 'the legacy sentinel is copied through usableAccuracy');
  assert.strictEqual(row.replaced.location.lat, legacyLat, 'the coordinate itself is copied verbatim');
  assert.strictEqual(row.replaced.nearest.distanceFromHouseMeters, 70, 'read as 70 m, not 90 m, it is the nearer stamp (the old pick was 95 m)');
  assert.strictEqual(row.replaced.nearest.accuracy, null);
});

test('pin correction: a non-positive accuracy lands on the audit row as null', { skip }, async () => {
  const r = await call('POST', `/mobile/households/${ctx.d7._id}/location`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { lat: D7.lat + 0.0001, lng: D7.lng, source: 'gps', accuracy: -1 },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual((await HouseholdLocationChange.findOne({ householdId: ctx.d7._id }).lean()).accuracy, null);
});

test('pin correction: an impossible coordinate is still a typed 400 invalid_coords (shared predicate)', { skip }, async () => {
  for (const [lat, lng] of [[200, D8.lng], [D8.lat, -181]]) {
    const r = await call('POST', `/mobile/households/${ctx.d8._id}/location`, { token: ctx.adminTok, orgId: ctx.org._id, body: { lat, lng, source: 'drag' } });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.code, 'invalid_coords');
  }
  assert.strictEqual(await HouseholdLocationChange.countDocuments({ householdId: ctx.d8._id }), 0, 'no audit row');
});

const mockedAction = () => CanvassActivity.findOne({ 'location.mocked': true }).lean();
const reviewAs = (token, actionId, status) =>
  call('POST', '/admin/reports/flags/review', {
    token,
    orgId: ctx.org._id,
    body: { actionModel: 'CanvassActivity', actionId: String(actionId), status },
  });

test('multi-campaign org: an ADMIN can still review a flag with no campaignId', { skip }, async () => {
  // A SECOND campaign is what arms the guard — with one campaign it never fires.
  ctx.camp2 = await Campaign.create({
    organizationId: ctx.org._id, name: 'Gate C2', type: 'survey', state: 'FL', isActive: true,
  });
  assert.strictEqual(await Campaign.countDocuments({ organizationId: ctx.org._id }), 2, 'guard is armed');

  const act = await mockedAction();
  const r = await reviewAs(ctx.adminTok, act._id, 'confirmed');
  assert.strictEqual(r.status, 200, `expected 200, got ${r.status}: ${r.json?.error}`);
  assert.strictEqual(r.json.review.status, 'confirmed');

  const saved = await FlagReview.findOne({ actionId: act._id }).lean();
  assert.strictEqual(saved.status, 'confirmed', 'the decision is persisted, not just echoed');
  assert.strictEqual(String(saved.campaignId), String(ctx.camp._id), 'campaign re-derived from the ACTION, not the query');
});

test('multi-campaign org: a LEAD who manages the campaign can review', { skip }, async () => {
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'gl@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: ctx.org._id, role: 'lead', isActive: true });
  await CampaignManager.create({ userId: lead._id, organizationId: ctx.org._id, campaignId: ctx.camp._id });
  ctx.leadTok = signUserToken(lead);

  const act = await mockedAction();
  const r = await reviewAs(ctx.leadTok, act._id, 'dismissed');
  assert.strictEqual(r.status, 200, `expected 200, got ${r.status}: ${r.json?.error}`);
  assert.strictEqual(r.json.review.status, 'dismissed');
  assert.strictEqual((await FlagReview.findOne({ actionId: act._id }).lean()).status, 'dismissed');
});

test('a LEAD who does NOT manage the campaign is still refused', { skip }, async () => {
  // A real lead — just granted on the OTHER campaign. The exemption removed the scope
  // check; authorization must still come from the handler's canManageCampaign re-derivation.
  const other = await User.create({ firstName: 'Otto', lastName: 'Other', email: 'go@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: other._id, organizationId: ctx.org._id, role: 'lead', isActive: true });
  await CampaignManager.create({ userId: other._id, organizationId: ctx.org._id, campaignId: ctx.camp2._id });

  const act = await mockedAction();
  const before = await FlagReview.findOne({ actionId: act._id }).lean();
  const r = await reviewAs(signUserToken(other), act._id, 'confirmed');
  assert.strictEqual(r.status, 403, 'no hole opened by the exemption');
  const after = await FlagReview.findOne({ actionId: act._id }).lean();
  assert.strictEqual(after.status, before.status, 'and nothing was written');
});

test('the READ-scoping guard is untouched: an unscoped report still 400s', { skip }, async () => {
  const r = await call('GET', '/admin/reports/overview', { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(r.status, 400, 'admins must still scope reads in a multi-campaign org');
  assert.match(r.json.error, /multiple campaigns/i);

  const scoped = await call('GET', `/admin/reports/overview?campaignId=${ctx.camp._id}`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
  });
  assert.strictEqual(scoped.status, 200, 'and a scoped read still works');
});
