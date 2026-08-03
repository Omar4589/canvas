import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Two just-shipped changes, exercised over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/per_canvasser_test node --test test/perCanvasserAndOverlaps.int.test.js
//
//  1) PER-CANVASSER map color. GET /admin/households/map?userId=<canvasser> now colors each
//     door by THAT canvasser's own resolved status (surveyed if they surveyed it, else their
//     latest action) — not the global "ever-surveyed" status. The ?status= chip filter tests
//     that per-user status too. Without ?userId the map keeps the global stored status.
//  2) Household activity DEDUPE. GET /admin/households/:id/activity no longer double-lists a
//     survey (it's written to BOTH the CanvassActivity and SurveyResponse ledgers).
//  3) Pass-wide, DAY-AGNOSTIC overlap doors. GET /admin/reports/overlap-doors flags a
//     (household, pass) touched by 2+ distinct canvassers even when their knocks fall on
//     different DAYS of the same pass — the collision the date-scoped /overlaps cannot see.
//
// The fixture stages one household H surveyed by Chad on DAY1 and not-home'd by Chris on DAY5
// (>4 days apart, SAME pass): the overlap the windowed report misses. A control G is touched by
// only Chad; an F is knocked by Chad + Chris in DIFFERENT passes (never an overlap). Billing must
// still count H once for (H, Pass 1) despite two canvassers + a survey + a not-home on it.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-per-canvasser';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { knocksPipeline } = await import('../src/services/reports/aggregations.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyResponseArchive } = await import('../src/models/SurveyResponseArchive.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// Campaign days are America/Chicago. Every timestamp sits mid-day (15:00–16:30Z → 10:00–11:30
// Chicago), nowhere near a day boundary, so a from/to window keys cleanly. The whole point of the
// fixture: Chad's survey on H lands DAY1, Chris's not-home on H lands DAY5 — SAME pass, 4 days apart.
const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';
const DAY5 = '2026-06-14';

function hh(orgId, campaignId, effortId, n, status = 'unknocked') {
  return {
    organizationId: orgId,
    campaignId,
    effortId,
    addressLine1: `${n} Overlap Rd`,
    city: 'Town',
    state: 'TX',
    zipCode: '75701',
    normalizedAddress: `${n} OVERLAP RD|TOWN|TX|75701`,
    location: { type: 'Point', coordinates: [-95.3 + n * 0.001, 32.35] },
    isActive: true,
    status,
  };
}

function act(hhDoc, userId, actionType, passId, ts) {
  const [lng, lat] = hhDoc.location.coordinates;
  return {
    organizationId: hhDoc.organizationId,
    campaignId: hhDoc.campaignId,
    householdId: hhDoc._id,
    effortId: hhDoc.effortId,
    userId,
    actionType,
    location: { lat, lng, accuracy: 10 },
    distanceFromHouseMeters: 8,
    timestamp: ts,
    passId,
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, User, Membership, Campaign, CampaignManager, Effort, Pass,
    Household, Voter, CanvassActivity, SurveyResponse, SurveyTemplate, Subscription,
  ]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Overlap Org', slug: 'overlap-org', isActive: true, timeZone: 'America/Chicago' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'oa@t.co', passwordHash: 'x', isActive: true });
  const chad = await User.create({ firstName: 'Chad', lastName: 'Canvasser', email: 'chad@t.co', passwordHash: 'x', isActive: true });
  const chris = await User.create({ firstName: 'Chris', lastName: 'Canvasser', email: 'chris@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'olead@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: chad._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: chris._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const camp = await Campaign.create({
    organizationId: org._id, name: 'Overlap C', type: 'survey', state: 'TX', isActive: true,
    timeZone: 'America/Chicago',
  });
  await CampaignManager.create({ campaignId: camp._id, userId: lead._id, organizationId: org._id, grantedBy: admin._id });

  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  // Pass 1 is the active pass for the H overlap; Pass 2 exists only to stage F's
  // different-passes-are-not-an-overlap case.
  const pass1 = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Round 1',
    status: 'active', activatedAt: new Date('2026-06-09T12:00:00Z'),
  });
  const pass2 = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 2, name: 'Round 2',
    status: 'active', activatedAt: new Date('2026-06-10T12:00:00Z'),
  });

  const survey = await SurveyTemplate.create({ organizationId: org._id, name: 'S', createdBy: admin._id, version: 1 });

  // H: the cross-day overlap door (its GLOBAL stored status is 'surveyed' — someone ever
  // surveyed it). G: control, only Chad. F: Chad + Chris in different passes.
  const [H, G, F, R] = await Household.insertMany([
    hh(org._id, camp._id, effort._id, 1, 'surveyed'),
    hh(org._id, camp._id, effort._id, 2, 'not_home'),
    hh(org._id, camp._id, effort._id, 3, 'not_home'),
    hh(org._id, camp._id, effort._id, 4, 'restricted'),
  ]);

  const voter = await Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: H._id, stateVoterId: 'SV-H-1',
    firstName: 'Vera', lastName: 'Voter', fullName: 'Vera Voter', surveyStatus: 'surveyed',
  });

  // The ledger. H: Chad survey (DAY1) + Chris not_home (DAY5) in Pass 1 — same pass, 4 days apart.
  //  G: Chad not_home (DAY1) Pass 1. F: Chad not_home Pass 1 (DAY1) + Chris not_home Pass 2 (DAY2).
  // A survey is written to BOTH ledgers (a survey_submitted CanvassActivity + a SurveyResponse).
  await CanvassActivity.insertMany([
    act(H, chad._id, 'survey_submitted', pass1._id, new Date(`${DAY1}T15:00:00Z`)),
    act(H, chris._id, 'not_home', pass1._id, new Date(`${DAY5}T15:00:00Z`)),
    act(G, chad._id, 'not_home', pass1._id, new Date(`${DAY1}T16:00:00Z`)),
    act(F, chad._id, 'not_home', pass1._id, new Date(`${DAY1}T16:30:00Z`)),
    act(F, chris._id, 'not_home', pass2._id, new Date(`${DAY2}T15:00:00Z`)),
    // R: Chad marks it 'restricted' (a marker, NOT a knock) + Chris 'not_home', same pass —
    // exactly ONE knock, so NOT an overlap. Locks the badge/ring definition (KNOCK_ACTIONS).
    act(R, chad._id, 'restricted', pass1._id, new Date(`${DAY1}T17:00:00Z`)),
    act(R, chris._id, 'not_home', pass1._id, new Date(`${DAY2}T17:00:00Z`)),
  ]);
  await SurveyResponse.create({
    organizationId: org._id, campaignId: camp._id, voterId: voter._id, householdId: H._id, userId: chad._id,
    surveyTemplateId: survey._id, surveyTemplateVersion: 1, answers: [],
    location: { lat: 32.35, lng: -95.299, accuracy: 10 }, distanceFromHouseMeters: 8,
    submittedAt: new Date(`${DAY1}T15:00:00Z`), passId: pass1._id,
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, effort, pass1, pass2, admin, chad, chris, lead, H, G, F, R,
    adminTok: signUserToken(admin), leadTok: signUserToken(lead),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { token, orgId, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['X-Org-Id'] = String(orgId);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const findHh = (json, doc) => json.households.find((h) => h.id === String(doc._id ?? doc));

test('per-canvasser map color: each canvasser sees THEIR own status on the shared door H', { skip }, async () => {
  const { adminTok, org, camp, H, G, chad, chris } = ctx;
  const opt = { token: adminTok, orgId: org._id };

  // Chris only not-home'd H → Chris's map colors it 'not_home'.
  const asChris = await call('GET', `/api/admin/households/map?campaignId=${camp._id}&userId=${chris._id}`, opt);
  assert.strictEqual(asChris.status, 200);
  assert.strictEqual(findHh(asChris.json, H).status, 'not_home', "Chris's own status on H is not_home");

  // Chad surveyed H → Chad's map colors it 'surveyed'.
  const asChad = await call('GET', `/api/admin/households/map?campaignId=${camp._id}&userId=${chad._id}`, opt);
  assert.strictEqual(asChad.status, 200);
  assert.strictEqual(findHh(asChad.json, H).status, 'surveyed', "Chad's own status on H is surveyed");

  // No userId → the global "ever-surveyed" stored status (unchanged behavior).
  const global = await call('GET', `/api/admin/households/map?campaignId=${camp._id}`, opt);
  assert.strictEqual(global.status, 200);
  assert.strictEqual(findHh(global.json, H).status, 'surveyed', 'global status on H is surveyed');

  // G was never touched by Chris → not returned under his per-user view (or, at most, unknocked).
  const g = findHh(asChris.json, G);
  assert.ok(!g || g.status === 'unknocked', 'G is absent (or unknocked) for Chris, who never touched it');
});

test('status chip is per-user: H is under not_home for Chris, not under surveyed', { skip }, async () => {
  const { adminTok, org, camp, H, chris } = ctx;
  const opt = { token: adminTok, orgId: org._id };

  const wantSurveyed = await call('GET', `/api/admin/households/map?campaignId=${camp._id}&userId=${chris._id}&status=surveyed`, opt);
  assert.strictEqual(wantSurveyed.status, 200);
  assert.ok(!findHh(wantSurveyed.json, H), 'H is NOT under status=surveyed for Chris (his status there is not_home)');

  const wantNotHome = await call('GET', `/api/admin/households/map?campaignId=${camp._id}&userId=${chris._id}&status=not_home`, opt);
  assert.strictEqual(wantNotHome.status, 200);
  assert.ok(findHh(wantNotHome.json, H), 'H IS under status=not_home for Chris');
});

test('household activity dedupe: the survey appears exactly ONCE, alongside the not_home', { skip }, async () => {
  const { adminTok, org, H } = ctx;
  const r = await call('GET', `/api/admin/households/${H._id}/activity`, { token: adminTok, orgId: org._id });
  assert.strictEqual(r.status, 200);
  const entries = r.json.rounds.flatMap((round) => round.entries);
  const surveys = entries.filter((e) => e.actionType === 'survey_submitted');
  assert.strictEqual(surveys.length, 1, 'survey_submitted listed once (not double-listed across ledgers)');
  assert.strictEqual(surveys[0].kind, 'survey', 'the surviving survey entry is the richer SurveyResponse-derived one');
  assert.ok(entries.some((e) => e.actionType === 'not_home'), "Chris's not_home is also present");
  // Every entry carries a stable canvasserId so the client overlap badge dedupes by id
  // (like /overlap-doors), not by display name.
  assert.ok(entries.every((e) => typeof e.canvasserId === 'string' && e.canvasserId.length), 'entries expose canvasserId');
});

test('overlap-doors is DAY-AGNOSTIC: H (same pass, 4 days apart) collides; F (diff passes) + G (one canvasser) + R (restricted not a knock) do not', { skip }, async () => {
  const { adminTok, org, camp, H, G, F, R } = ctx;
  const r = await call('GET', `/api/admin/reports/overlap-doors?campaignId=${camp._id}`, { token: adminTok, orgId: org._id });
  assert.strictEqual(r.status, 200);
  const ids = r.json.householdIds.map(String);
  assert.ok(ids.includes(String(H._id)), 'H collides: Chad + Chris in the SAME pass, 4 days apart');
  assert.ok(!ids.includes(String(F._id)), 'F does NOT collide: Chad + Chris in DIFFERENT passes');
  assert.ok(!ids.includes(String(G._id)), 'G does NOT collide: only Chad touched it');
  assert.ok(!ids.includes(String(R._id)), 'R does NOT collide: restricted is a marker, not a knock — one knock (Chris)');
  assert.strictEqual(r.json.total, 1, 'exactly one overlapping door');

  // The door card carries the colliding pass + both canvassers.
  const doorH = r.json.doors.find((d) => String(d.householdId) === String(H._id));
  assert.ok(doorH, 'H has a door card');
  const pass1Row = doorH.passes.find((p) => String(p.passId) === String(ctx.pass1._id));
  assert.ok(pass1Row, 'the collision is attributed to Pass 1');
  assert.strictEqual(pass1Row.canvassers.length, 2, 'both Chad and Chris are named on the pass');
});

// ── ANCHORED date scoping on /overlap-doors (owner scenario 2026-07-19) ──
// H is the case that matters: Chad DAY1, Chris DAY5, same pass. Viewing only DAY5, the admin must
// still be told this door was already worked — the windowed /overlaps below structurally cannot.

test('ANCHORED: a window covering only Chris\'s day still surfaces H, and names Chad\'s earlier knock', { skip }, async () => {
  const { adminTok, org, camp, H, chad, chris } = ctx;
  const r = await call(
    'GET',
    `/api/admin/reports/overlap-doors?campaignId=${camp._id}&from=${DAY5}&to=${DAY5}`,
    { token: adminTok, orgId: org._id }
  );
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.householdIds.map(String).includes(String(H._id)),
    'the DAY5 knock anchors the collision into view — a windowed rule would have found nothing');
  assert.strictEqual(r.json.total, 1);
  assert.strictEqual(r.json.outOfRangeTotal, 0, 'H is surfaced, so it is not also counted as hidden');

  const pass1Row = r.json.doors
    .find((d) => String(d.householdId) === String(H._id))
    .passes.find((p) => String(p.passId) === String(ctx.pass1._id));
  assert.strictEqual(pass1Row.canvassers.length, 2, 'BOTH canvassers are named, not just the in-window one');
  const byId = new Map(pass1Row.canvassers.map((c) => [c.userId, c]));
  const chrisRow = byId.get(String(chris._id));
  const chadRow = byId.get(String(chad._id));
  assert.strictEqual(chrisRow.inRange, true, "Chris's DAY5 knock is the one you're looking at");
  assert.strictEqual(chadRow.inRange, false, "Chad's DAY1 knock is the earlier one that made it a collision");
  assert.ok(chadRow.lastAt, 'the earlier knock carries its date so the UI can print it');
  assert.strictEqual(pass1Row.canvassers[0].userId, String(chris._id), 'newest knock sorts first');
});

test('ANCHORED: a window containing NEITHER knock hides H but counts it as outOfRangeTotal', { skip }, async () => {
  const { adminTok, org, camp, H } = ctx;
  const r = await call(
    'GET',
    `/api/admin/reports/overlap-doors?campaignId=${camp._id}&from=${DAY2}&to=${DAY2}`,
    { token: adminTok, orgId: org._id }
  );
  assert.strictEqual(r.status, 200);
  assert.ok(!r.json.householdIds.map(String).includes(String(H._id)), 'nothing to ring on a day with no knocks');
  assert.strictEqual(r.json.total, 0);
  assert.strictEqual(r.json.outOfRangeTotal, 1, 'the collision is still real — surfaced as the "outside your dates" hint');
});

test('ANCHORED: ?userId keeps collisions INVOLVING that canvasser and drops the rest', { skip }, async () => {
  const { adminTok, org, camp, H, chris, admin } = ctx;
  const mine = await call(
    'GET',
    `/api/admin/reports/overlap-doors?campaignId=${camp._id}&userId=${chris._id}`,
    { token: adminTok, orgId: org._id }
  );
  assert.strictEqual(mine.status, 200);
  assert.ok(mine.json.householdIds.map(String).includes(String(H._id)),
    'Chris is in the collision — filtering to him must NOT zero it out (the post-grouping trap)');

  const other = await call(
    'GET',
    `/api/admin/reports/overlap-doors?campaignId=${camp._id}&userId=${admin._id}`,
    { token: adminTok, orgId: org._id }
  );
  assert.strictEqual(other.status, 200);
  assert.strictEqual(other.json.total, 0, 'a canvasser who never knocked H sees no collision');
});

test('/overlap-doors payload is self-contained: address, per-canvasser action, and a canvasser count', { skip }, async () => {
  // The report renders from this alone — no second call, no client-side join. Field names mirror
  // /overlaps so one card component serves both surfaces.
  const { adminTok, org, camp, H, chad, chris } = ctx;
  const r = await call('GET', `/api/admin/reports/overlap-doors?campaignId=${camp._id}`, { token: adminTok, orgId: org._id });
  assert.strictEqual(r.status, 200);
  const doorH = r.json.doors.find((d) => String(d.householdId) === String(H._id));

  assert.ok(doorH.household, 'the door carries its address inline');
  assert.strictEqual(String(doorH.household.id), String(H._id));
  assert.strictEqual(doorH.household.addressLine1, H.addressLine1);
  assert.ok('location' in doorH.household, 'location travels too, so the report can link to the map');
  assert.strictEqual(doorH.totalCanvassers, 2, 'distinct canvassers across the door, counted server-side');

  // Each canvasser's LATEST knock action, correctly attributed — the wiring risk in the composite
  // $max accumulator is swapping actions between people, so pin both.
  const pass1Row = doorH.passes.find((p) => String(p.passId) === String(ctx.pass1._id));
  const byId = new Map(pass1Row.canvassers.map((c) => [c.userId, c]));
  assert.strictEqual(byId.get(String(chris._id)).actionType, 'not_home', "Chris's knock was a not_home");
  assert.strictEqual(byId.get(String(chad._id)).actionType, 'survey_submitted', "Chad's was the survey");
  for (const c of pass1Row.canvassers) {
    assert.ok(c.firstName && c.lastName, 'firstName/lastName present (the shared card reads these)');
    assert.strictEqual(c.name, `${c.firstName} ${c.lastName}`, 'name is the convenience join');
    assert.ok(c.lastAt, 'each carries the date of their knock');
  }
});

test('/overlap-doors requires campaignId (unscoped it would scan the org ledger)', { skip }, async () => {
  const { adminTok, org } = ctx;
  const bare = await call('GET', '/api/admin/reports/overlap-doors', { token: adminTok, orgId: org._id });
  assert.strictEqual(bare.status, 400, 'an ADMIN gets 400; a lead is stopped earlier by the router gate (see below)');
});

test('contrast: the date-scoped /overlaps over a window covering only Chris\'s day does NOT flag H', { skip }, async () => {
  const { adminTok, org, camp, H } = ctx;
  // DAY5 covers only Chris's not_home; Chad's survey was DAY1 — outside. So the windowed
  // report sees a single canvasser on (H, Pass 1) and finds NO overlap. This is exactly the
  // cross-day gap the day-agnostic /overlap-doors above closes.
  const r = await call('GET', `/api/admin/reports/overlaps?campaignId=${camp._id}&from=${DAY5}&to=${DAY5}`, { token: adminTok, orgId: org._id });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.total, 0, 'no overlaps inside the DAY5-only window');
  assert.ok(!r.json.overlaps.some((o) => o.household.id === String(H._id)), 'H is not flagged by the windowed report');
});

test('billing: H counts as ONE knock for (H, Pass 1) despite a survey + a not_home by two canvassers', { skip }, async () => {
  const { org, camp, H } = ctx;
  // Scoped to H: the (household, pass) grouping collapses the survey + the not_home into a
  // single billable knock — no double-bill from two canvassers on one door in one pass.
  const [hOnly] = await CanvassActivity.aggregate(
    knocksPipeline({ organizationId: org._id, campaignId: camp._id, householdId: H._id })
  );
  assert.strictEqual(hOnly.knocks, 1, 'H is one knock for its pass');

  // Campaign-wide sanity: (H,P1) + (G,P1) + (F,P1) + (F,P2) + (R,P1) = 5 distinct billable
  // knocks. R contributes ONE (Chris's not_home) — Chad's 'restricted' marker is not a knock,
  // so it neither adds a billable knock nor makes R an overlap.
  const [all] = await CanvassActivity.aggregate(
    knocksPipeline({ organizationId: org._id, campaignId: camp._id })
  );
  assert.strictEqual(all.knocks, 5, '5 distinct (household, pass) billable knocks campaign-wide');
});

test('lead gating on /overlap-doors: granted lead + campaignId 200; lead without campaignId 403', { skip }, async () => {
  const { leadTok, org, camp } = ctx;
  const ok = await call('GET', `/api/admin/reports/overlap-doors?campaignId=${camp._id}`, { token: leadTok, orgId: org._id });
  assert.strictEqual(ok.status, 200, 'granted lead scoped to their campaign');
  const bare = await call('GET', '/api/admin/reports/overlap-doors', { token: leadTok, orgId: org._id });
  assert.strictEqual(bare.status, 403, 'lead without campaignId hits the reports router gate');
});

test('overlap round labels name their walk list ONLY once the campaign has 2+ efforts', { skip }, async () => {
  const { adminTok, org, camp, H } = ctx;
  // Single-effort campaign: short label, but effortName is still populated for clients
  // that want the walk list structurally.
  const before = await call('GET', `/api/admin/reports/overlap-doors?campaignId=${camp._id}`, { token: adminTok, orgId: org._id });
  assert.strictEqual(before.status, 200);
  const shortRow = before.json.doors
    .find((d) => String(d.householdId) === String(H._id))
    .passes.find((p) => String(p.passId) === String(ctx.pass1._id));
  assert.strictEqual(shortRow.roundLabel, 'Pass 1 · Round 1', 'one walk list → no noisy prefix');
  assert.strictEqual(shortRow.effortName, 'North', 'effortName rides along regardless');

  // A second walk list makes "Pass 1" ambiguous (roundNumber restarts per effort), so the
  // label must now carry the walk-list name — on BOTH overlap builders.
  const south = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'South' });
  try {
    const doors = await call('GET', `/api/admin/reports/overlap-doors?campaignId=${camp._id}`, { token: adminTok, orgId: org._id });
    const prefixed = doors.json.doors
      .find((d) => String(d.householdId) === String(H._id))
      .passes.find((p) => String(p.passId) === String(ctx.pass1._id));
    assert.strictEqual(prefixed.roundLabel, 'North · Pass 1 · Round 1', '2+ walk lists → prefixed');
    assert.strictEqual(prefixed.effortName, 'North');

    // computeOverlaps (the /overlaps + timeline builder) must agree. Window = DAY1 so Chad's
    // survey and Chris's not_home... only Chad's day — use a window covering both so H surfaces.
    const windowed = await call(
      'GET',
      `/api/admin/reports/overlaps?campaignId=${camp._id}&from=${DAY1}&to=${DAY5}`,
      { token: adminTok, orgId: org._id }
    );
    assert.strictEqual(windowed.status, 200);
    const card = windowed.json.overlaps.find((o) => o.household.id === String(H._id));
    assert.ok(card, 'H surfaces in the windowed report over the full span');
    const cardPass = card.passes.find((p) => String(p.passId) === String(ctx.pass1._id));
    assert.strictEqual(cardPass.roundLabel, 'North · Pass 1 · Round 1', 'both builders label alike');
    assert.strictEqual(cardPass.effortName, 'North');
  } finally {
    // Leave the fixture as the earlier tests knew it, in case of future reordering.
    await Effort.deleteOne({ _id: south._id });
  }
});

test('overlap doors carry passes[].overwrites when a survey response was preserved there — both engines', { skip }, async () => {
  const { adminTok, org, camp, H, G, chad, chris, pass1 } = ctx;
  // A preserved same-round overwrite at H: Chris's submit replaced Chad's response for H's voter.
  // (The knock rows for both already exist in the fixture — an overwrite implies the collision.)
  const voter = await Voter.findOne({ householdId: H._id }).lean();
  const survey = await SurveyTemplate.findOne({ organizationId: org._id }).lean();
  const archived = await SurveyResponseArchive.create({
    organizationId: org._id, campaignId: camp._id, voterId: voter._id, householdId: H._id,
    userId: chad._id, surveyTemplateId: survey._id, surveyTemplateVersion: 1, answers: [],
    location: { lat: 32.35, lng: -95.299, accuracy: 10 }, distanceFromHouseMeters: 8,
    submittedAt: new Date(`${DAY1}T15:00:00Z`), passId: pass1._id,
    overwrittenBy: chris._id, overwrittenVia: 'submit', overwrittenAt: new Date(`${DAY5}T15:00:00Z`),
  });
  try {
    // Engine 1: /overlap-doors (the map + Overlaps page).
    const doors = await call('GET', `/api/admin/reports/overlap-doors?campaignId=${camp._id}`, { token: adminTok, orgId: org._id });
    assert.strictEqual(doors.status, 200);
    const hDoor = doors.json.doors.find((d) => String(d.householdId) === String(H._id));
    const hPass = hDoor.passes.find((p) => String(p.passId) === String(pass1._id));
    assert.ok(Array.isArray(hPass.overwrites), 'the annotated pass carries overwrites[]');
    assert.strictEqual(hPass.overwrites.length, 1);
    assert.strictEqual(hPass.overwrites[0].voterName, voter.fullName);
    assert.strictEqual(hPass.overwrites[0].by.name, 'Chad Canvasser');
    assert.strictEqual(hPass.overwrites[0].overwrittenBy.name, 'Chris Canvasser');
    // The superset contract: a door with no overwrite carries NO key at all.
    for (const d of doors.json.doors) {
      if (String(d.householdId) === String(H._id)) continue;
      for (const p of d.passes) assert.ok(!('overwrites' in p), 'absent when none');
    }

    // Engine 2: /overlaps (the timeline builder) must agree.
    const windowed = await call(
      'GET',
      `/api/admin/reports/overlaps?campaignId=${camp._id}&from=${DAY1}&to=${DAY5}`,
      { token: adminTok, orgId: org._id }
    );
    assert.strictEqual(windowed.status, 200);
    const card = windowed.json.overlaps.find((o) => o.household.id === String(H._id));
    const cardPass = card.passes.find((p) => String(p.passId) === String(pass1._id));
    assert.ok(Array.isArray(cardPass.overwrites), 'both engines annotate alike');
    assert.strictEqual(cardPass.overwrites[0].overwrittenBy.name, 'Chris Canvasser');
  } finally {
    await SurveyResponseArchive.deleteOne({ _id: archived._id });
  }
});
