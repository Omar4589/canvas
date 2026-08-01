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
const { KNOCK_ACTIONS } = await import('../src/services/reports/aggregations.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// Two doors ~1 km apart. NEAR/FAR GPS stamps are offsets straight north of each pin:
// 0.000045° lat ≈ 5 m, 0.0027° lat ≈ 300 m.
const D1 = { lng: -81.4, lat: 28.3 };
const D2 = { lng: -81.39, lat: 28.3 };
// Three more doors so each stale-replay test owns its own door — these tests assert absolute row
// counts and door status, so sharing a door with another test would couple them through the ledger.
const D3 = { lng: -81.38, lat: 28.3 };
const D4 = { lng: -81.37, lat: 28.3 };
const D5 = { lng: -81.36, lat: 28.3 };
const D6 = { lng: -81.35, lat: 28.3 }; // its own door + voter for the survey-replay test
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
  const homes = await Household.insertMany([
    hh(org._id, camp._id, effort._id, 1, D1),
    hh(org._id, camp._id, effort._id, 2, D2),
    hh(org._id, camp._id, effort._id, 3, D3),
    hh(org._id, camp._id, effort._id, 4, D4),
    hh(org._id, camp._id, effort._id, 5, D5),
    hh(org._id, camp._id, effort._id, 6, D6),
  ]);
  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book C', mode: 'geometric',
    status: 'published', householdIds: homes.map((h) => h._id), doorCount: homes.length,
  });
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: canv._id });

  const voter = await Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: homes[1]._id, stateVoterId: 'FLC1',
    firstName: 'Vi', lastName: 'Voter', fullName: 'Vi Voter',
  });
  // A second voter on its own door, so the survey-replay test never shares a SurveyResponse with
  // the snapshot test above (these assert absolute row counts).
  const voter2 = await Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: homes[5]._id, stateVoterId: 'FLC2',
    firstName: 'Sam', lastName: 'Second', fullName: 'Sam Second',
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, pass, admin, canv, voter, template,
    d1: homes[0], d2: homes[1], d3: homes[2], d4: homes[3], d5: homes[4], d6: homes[5],
    voter2,
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

// ─────────────────────────────────────────────────────────────────────────────
// Stale REPLAY ordering. Every helper above hands out strictly increasing
// timestamps, which is exactly why none of the tests above catch this.
// ─────────────────────────────────────────────────────────────────────────────

// A queued replay: the ORIGINAL tap time (older than what is already stored) plus the flag
// offlineQueue.js stamps on every enqueued body. Both halves are what the server needs to
// recognise "this arrived late, and the world moved on".
function staleKnock(doorId, kind, location, tsIso) {
  return call('POST', `/mobile/households/${doorId}/${kind}`, {
    token: ctx.tok,
    orgId: ctx.org._id,
    body: { location, timestamp: tsIso, wasOfflineSubmission: true },
  });
}

test('a stale REPLAY does not destroy a newer disposition', { skip }, async () => {
  // The reproduced bug: not_home times out (but persists), the canvasser re-dispositions to
  // refused online, then the queue flushes the stale not_home milliseconds later.
  const door = ctx.d3._id;
  const t1 = new Date(Date.now() - 30 * 60_000).toISOString(); // the original tap
  assert.strictEqual((await staleKnock(door, 'not-home', near(D3), t1)).status, 201);

  const t2 = new Date(Date.now() - 5 * 60_000).toISOString(); // the correction, online, newer
  const live = await call('POST', `/mobile/households/${door}/refused`, {
    token: ctx.tok, orgId: ctx.org._id, body: { location: near(D3), timestamp: t2 },
  });
  assert.strictEqual(live.status, 201);

  const before = await Household.findById(door).lean();
  assert.strictEqual(before.status, 'refused');

  // THE REPLAY — same body as the first write, arriving after the correction.
  const replay = await staleKnock(door, 'not-home', near(D3), t1);

  // It must be accepted (so the queue drains) but must not have written anything.
  assert.ok(replay.status === 200 || replay.status === 201, `replay got ${replay.status}`);
  assert.strictEqual(replay.status, 200, 'a superseded replay is a 200 no-op, not a 201 write');
  assert.strictEqual(replay.json?.superseded, true, 'and says so explicitly');
  assert.strictEqual(
    replay.json?.household?.status, 'refused',
    'and carries the PER-ROUND household status (single-pass fixture, so it equals the global ' +
    'here — actionResponsePerRound.int.test.js pins the multi-round case where they differ)'
  );

  const rows = await myRows(door);
  assert.strictEqual(rows.length, 1, 'still exactly one row');
  assert.strictEqual(rows[0].actionType, 'refused', 'the NEWER disposition survives');

  const after = await Household.findById(door).lean();
  assert.strictEqual(after.status, 'refused', 'door status is untouched');
  assert.strictEqual(
    new Date(after.lastActionAt).getTime(), new Date(before.lastActionAt).getTime(),
    'lastActionAt does NOT regress'
  );
});

test('an out-of-order body WITHOUT the replay flag still replaces (online semantics unchanged)', { skip }, async () => {
  // The guard is scoped to queued replays on purpose. A live write keeps last-arrival-wins, so
  // nothing about the ordinary correction path changes.
  const door = ctx.d4._id;
  const t2 = new Date(Date.now() - 5 * 60_000).toISOString();
  assert.strictEqual((await call('POST', `/mobile/households/${door}/refused`, {
    token: ctx.tok, orgId: ctx.org._id, body: { location: near(D4), timestamp: t2 },
  })).status, 201);

  const t1 = new Date(Date.now() - 30 * 60_000).toISOString(); // older, but NOT flagged
  const res = await call('POST', `/mobile/households/${door}/not-home`, {
    token: ctx.tok, orgId: ctx.org._id, body: { location: near(D4), timestamp: t1 },
  });
  assert.strictEqual(res.status, 201, 'a live write is never rejected as stale');

  const rows = await myRows(door);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].actionType, 'not_home', 'last arrival still wins when online');
});

test('a genuine offline write still lands when it is NEWER than what is stored', { skip }, async () => {
  // The real-outage case: the phone was offline, the queue drains later, and the queued action is
  // the newest thing that happened at that door. Rejecting this would break offline canvassing.
  const door = ctx.d5._id;
  const t1 = new Date(Date.now() - 30 * 60_000).toISOString();
  assert.strictEqual((await call('POST', `/mobile/households/${door}/not-home`, {
    token: ctx.tok, orgId: ctx.org._id, body: { location: near(D5), timestamp: t1 },
  })).status, 201);

  const t2 = new Date(Date.now() - 5 * 60_000).toISOString(); // queued, but NEWER
  const res = await staleKnock(door, 'refused', near(D5), t2);
  assert.strictEqual(res.status, 201, 'a newer queued write is a real write');

  const rows = await myRows(door);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].actionType, 'refused', 'the queued action replaced the older one');
  assert.strictEqual(rows[0].wasOfflineSubmission, true, 'and is still marked as an offline write');
});

test('a stale REPLAY does not destroy a newer SURVEY — answers survive', { skip }, async () => {
  // The severe half: canvass.js also deletes this canvasser's SurveyResponses for the pair, so a
  // replayed disposition wipes a newer survey's ANSWERS and regresses the voter to not_surveyed.
  const door = ctx.d6._id;
  const t1 = new Date(Date.now() - 30 * 60_000).toISOString();
  assert.strictEqual((await staleKnock(door, 'not-home', near(D6), t1)).status, 201);

  const t2 = new Date(Date.now() - 5 * 60_000).toISOString();
  const survey = await call('POST', `/mobile/voters/${ctx.voter2._id}/survey`, {
    token: ctx.tok,
    orgId: ctx.org._id,
    // The fixture template carries no questions, so an empty answer set is the valid submission.
    body: {
      location: near(D6),
      timestamp: t2,
      surveyTemplateId: String(ctx.template._id),
      answers: [],
    },
  });
  assert.strictEqual(survey.status, 201, 'the survey landed');
  const storedBefore = await SurveyResponse.findOne({ voterId: ctx.voter2._id }).lean();
  assert.ok(storedBefore, 'a response exists');

  // The stale disposition replays AFTER the survey.
  const replay = await staleKnock(door, 'not-home', near(D2), t1);
  assert.strictEqual(replay.status, 200, 'superseded');

  const storedAfter = await SurveyResponse.findOne({ voterId: ctx.voter2._id }).lean();
  assert.ok(storedAfter, 'the survey response SURVIVES the replay');
  assert.strictEqual(
    String(storedAfter._id), String(storedBefore._id),
    'and it is the same row, not a re-created one'
  );
  const voterAfter = await Voter.findById(ctx.voter2._id).lean();
  assert.strictEqual(voterAfter.surveyStatus, 'surveyed', 'the voter is not regressed to not_surveyed');

  const rows = await myRows(door);
  assert.strictEqual(rows[0].actionType, 'survey_submitted', 'the survey activity row survives too');
});

test('an ignored replay cannot move the billing clock', { skip }, async () => {
  // "First field visit" is a MIN over KNOCK_ACTIONS timestamps (services/billing/statement.js) and
  // it decides WHICH MONTHS a campaign bills. Because replacement rewrites timestamps that MIN is
  // not stable, so a stale replay reinstating an older row could in principle pull the first-visit
  // date earlier and add a billable month. The guard has to leave it alone.
  const firstVisit = async () => {
    const r = await CanvassActivity.find({
      campaignId: ctx.camp._id,
      actionType: { $in: KNOCK_ACTIONS },
    }).sort({ timestamp: 1 }).limit(1).lean();
    return r[0] ? new Date(r[0].timestamp).getTime() : null;
  };

  const door = ctx.d3._id; // already ends on `refused` from the stale-replay test above
  const before = await firstVisit();
  assert.ok(before, 'the campaign has a first field visit');

  // Replay something far older than anything in the campaign.
  const ancient = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();
  const res = await staleKnock(door, 'not-home', near(D3), ancient);
  assert.strictEqual(res.status, 200, 'superseded');

  assert.strictEqual(await firstVisit(), before, 'the first-visit timestamp did not move');
});
