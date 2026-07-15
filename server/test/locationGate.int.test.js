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

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const D1 = { lng: -81.4, lat: 28.3 };
const D2 = { lng: -81.39, lat: 28.3 };
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
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass, Turf, TurfAssignment, Household, Voter, CanvassActivity, SurveyResponse, SurveyTemplate, Subscription, FlagReview]) {
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
  const homes = await Household.insertMany([hh(org._id, camp._id, effort._id, 1, D1), hh(org._id, camp._id, effort._id, 2, D2)]);
  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book G', mode: 'geometric',
    status: 'published', householdIds: homes.map((h) => h._id), doorCount: homes.length,
  });
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: canv._id });

  const voter = await Voter.create({
    organizationId: org._id, householdId: homes[1]._id, stateVoterId: 'FLG1',
    firstName: 'Vi', lastName: 'Voter', fullName: 'Vi Voter',
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, pass, admin, canv, voter, template,
    d1: homes[0], d2: homes[1],
    adminTok: signUserToken(admin), tok: signUserToken(canv),
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
