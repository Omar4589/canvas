import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Correction-snapshot harness, over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/corr_test node --test test/canvassCorrection.int.test.js
// "Latest wins" is a delete-then-create, so a status change made after walking away used to
// destroy the prior entry's GPS evidence and fire a med/high far flag on an honest correction.
// This drives the real routes to assert: (1) a first entry carries no snapshot, (2) a replace
// stamps `replaced` with the deleted entry (+ its location/distance), (3) a second replace
// carries the CHAIN's best door-presence evidence forward in `replaced.nearest`, (4) the survey
// path does the same, and (5) GET /admin/reports/flags returns the correction as a LOW-severity
// downgraded far flag — the end-to-end guard for the detector's scan projection (dropping
// `replaced` from that projection string would silently disable the downgrade).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-correction';

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

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// Two doors ~1 km apart. NEAR/FAR GPS stamps are offsets straight north of each pin:
// 0.000045° lat ≈ 5 m, 0.0027° lat ≈ 300 m.
const D1 = { lng: -81.4, lat: 28.3 };
const D2 = { lng: -81.39, lat: 28.3 };
const near = (pin) => ({ lat: pin.lat + 0.000045, lng: pin.lng, accuracy: 5 });
const far = (pin) => ({ lat: pin.lat + 0.0027, lng: pin.lng, accuracy: 5 });

function hh(orgId, campaignId, effortId, n, pin) {
  return {
    organizationId: orgId,
    campaignId,
    effortId,
    addressLine1: `${n} Correction Ct`,
    city: 'Town',
    state: 'FL',
    zipCode: '34741',
    normalizedAddress: `${n} CORRECTION CT|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [pin.lng, pin.lat] },
    isActive: true,
    status: 'unknocked',
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass, Turf, TurfAssignment, Household, Voter, CanvassActivity, SurveyResponse, SurveyTemplate, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Correction Org', slug: 'correction-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ca@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Walker', email: 'cc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'C Survey', questions: [], isActive: true });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'Correction C', type: 'survey', state: 'FL', isActive: true,
    surveyTemplateId: template._id,
  });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: canv._id });

  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const pass = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const homes = await Household.insertMany([hh(org._id, camp._id, effort._id, 1, D1), hh(org._id, camp._id, effort._id, 2, D2)]);
  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book C', mode: 'geometric',
    status: 'published', householdIds: homes.map((h) => h._id), doorCount: homes.length,
  });
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: canv._id });

  const voter = await Voter.create({
    organizationId: org._id, householdId: homes[1]._id, stateVoterId: 'FLC1',
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

// One-minute strides keep every consecutive pair well over the rapid threshold.
let minute = 0;
function nextTs() {
  minute += 1;
  return new Date(Date.now() - 3600_000 + minute * 60_000).toISOString();
}

function knock(doorId, kind, location) {
  return call('POST', `/mobile/households/${doorId}/${kind}`, {
    token: ctx.tok,
    orgId: ctx.org._id,
    body: { location, timestamp: nextTs() },
  });
}

async function myRows(doorId) {
  return CanvassActivity.find({ householdId: doorId, userId: ctx.canv._id }).sort({ timestamp: 1 }).lean();
}

const within = (v, lo, hi) => v != null && v >= lo && v <= hi;

test('first entry carries no snapshot; a replace stamps the deleted entry', { skip }, async () => {
  // Recorded AT the door.
  assert.strictEqual((await knock(ctx.d1._id, 'not-home', near(D1))).status, 201);
  let rows = await myRows(ctx.d1._id);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].actionType, 'not_home');
  assert.strictEqual(rows[0].replaced, null, 'a first entry replaced nothing');
  assert.ok(within(rows[0].distanceFromHouseMeters, 2, 10), `near stamp ≈5m (got ${rows[0].distanceFromHouseMeters})`);

  // Corrected from ~300m down the street: the not_home row is deleted, the restricted row
  // carries its snapshot — the only surviving record of the at-the-door visit.
  assert.strictEqual((await knock(ctx.d1._id, 'restricted', far(D1))).status, 201);
  rows = await myRows(ctx.d1._id);
  assert.strictEqual(rows.length, 1, 'replace = delete-then-create, one row');
  assert.strictEqual(rows[0].actionType, 'restricted');
  assert.ok(within(rows[0].distanceFromHouseMeters, 280, 320), 'the new row is the far stamp');
  assert.strictEqual(rows[0].replaced.actionType, 'not_home');
  assert.ok(within(rows[0].replaced.distanceFromHouseMeters, 2, 10), 'snapshot kept the near distance');
  assert.ok(rows[0].replaced.location?.lat, 'snapshot kept the near location');
  assert.ok(within(rows[0].replaced.nearest?.distanceFromHouseMeters, 2, 10), 'nearest = the near visit');
});

test('a second correction carries the chain’s best evidence forward', { skip }, async () => {
  assert.strictEqual((await knock(ctx.d1._id, 'refused', far(D1))).status, 201);
  const rows = await myRows(ctx.d1._id);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].actionType, 'refused');
  // Immediate prior (the UI context line) is the restricted correction — recorded far.
  assert.strictEqual(rows[0].replaced.actionType, 'restricted');
  assert.ok(within(rows[0].replaced.distanceFromHouseMeters, 280, 320), 'immediate prior was the far restricted');
  // But `nearest` still proves the ORIGINAL at-the-door visit (A → B → C carry-forward).
  assert.ok(
    within(rows[0].replaced.nearest?.distanceFromHouseMeters, 2, 10),
    `nearest survives the chain (got ${rows[0].replaced.nearest?.distanceFromHouseMeters})`
  );
});

test('the survey path stamps the same snapshot', { skip }, async () => {
  assert.strictEqual((await knock(ctx.d2._id, 'not-home', near(D2))).status, 201);
  const r = await call('POST', `/mobile/voters/${ctx.voter._id}/survey`, {
    token: ctx.tok,
    orgId: ctx.org._id,
    body: { surveyTemplateId: String(ctx.template._id), answers: [], location: far(D2), timestamp: nextTs() },
  });
  assert.strictEqual(r.status, 201);
  const rows = await myRows(ctx.d2._id);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].actionType, 'survey_submitted');
  assert.strictEqual(rows[0].replaced.actionType, 'not_home');
  assert.ok(within(rows[0].replaced.nearest?.distanceFromHouseMeters, 2, 10), 'survey correction kept the near evidence');
});

test('end-to-end: /flags returns the corrections as DOWNGRADED low-severity far flags', { skip }, async () => {
  const r = await call('GET', `/admin/reports/flags?campaignId=${ctx.camp._id}`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.truncated, false);

  const refused = r.json.entries.find((e) => e.actionType === 'refused');
  assert.ok(refused, 'the far correction is still flagged (downgraded, never suppressed)');
  const farReason = refused.reasons.find((x) => x.type === 'far');
  assert.strictEqual(farReason.severity, 'low', 'near prior within the window → low');
  assert.strictEqual(farReason.detail.downgraded, true);
  assert.strictEqual(farReason.detail.priorActionType, 'restricted', 'context = the immediate prior entry');
  assert.ok(within(farReason.detail.nearestMeters, 2, 10), 'downgrade evidence = the original visit');

  const survey = r.json.entries.find((e) => e.actionType === 'survey_submitted');
  assert.ok(survey, 'the survey correction is flagged too');
  const sFar = survey.reasons.find((x) => x.type === 'far');
  assert.strictEqual(sFar.severity, 'low');
  assert.strictEqual(sFar.detail.downgraded, true);
  assert.strictEqual(sFar.detail.priorActionType, 'not_home');
});
