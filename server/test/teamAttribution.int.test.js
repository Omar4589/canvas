import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// Team attribution — the coordinator stamped on each knock, over the REAL Express app.
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/team node --test test/teamAttribution.int.test.js
//
// This mirrors a REAL campaign (Florida HD54), because the bug was found there and the numbers are
// the acceptance criteria:
//   Asa Bryant's team — Chadwick 737, Ian 292, Colin 100, Julian 60, Nathan 47
//                       (Julian + Nathan QUIT: deactivated AND removed from the campaign roster)
//   No team          — Randy 19 (the candidate, knocking his own district)
//   3 houses were double-knocked by Chadwick + Nathan — BOTH on Asa's team.
//
//   Before: filtering to Asa gives 1,129 — it silently drops the two who left.
//   After:  1,233 distinct doors. And 1,233 + 19 == 1,252 == the campaign billable, exactly.
//
// The load-bearing assertions are the COUNTING ones. In order of how badly a regression would hurt:
//   1. Σ teams + no-team − crossTeamDoors == campaign billable. EXACTLY. With same-team AND
//      cross-team double-knocks in the same fixture.
//   2. The campaign's billable total does not move by a single door.
//   3. A same-team double-knock is absorbed INSIDE the team (contributes 0 to crossTeamDoors) — the
//      case a naive "subtract every overlap" formula gets wrong.
//   4. The CURRENT coordinator owns ALL of a canvasser's history: reassigning someone moves every
//      door they ever knocked onto the new team, org-wide, and setting it back moves them back.
//   5. DEPARTURE is the exception and never re-stamps — when a coordinator leaves the org their
//      crew's Membership.coordinatorId is cleared, but the LEDGER keeps their team, so the doors
//      they supervised stay counted. That asymmetry is the 104-door fix; #4 must not eat it.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-team-attribution';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { Voter } = await import('../src/models/Voter.js');
const { Household } = await import('../src/models/Household.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { CoordinatorChange } = await import('../src/models/CoordinatorChange.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { knocksPipeline } = await import('../src/services/reports/aggregations.js');
const { releaseAssignedWork } = await import('../src/services/users/deleteAccount.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const PW = 'Str0ng!Passw0rd';
let server;
let base;
const ctx = {};
let doorSeq = 0;

async function mkUser(first) {
  return User.create({
    firstName: first, lastName: 'X', email: `${first.toLowerCase()}@t.co`,
    passwordHash: await User.hashPassword(PW), isActive: true,
  });
}

async function call(path, token, orgId) {
  const res = await fetch(`${base}/api${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': String(orgId) },
  });
  return { status: res.status, json: await res.json() };
}

// Mutating variant. Reassignment MUST be driven through the real route: the ledger re-stamp lives
// in the service layer, so a test that pokes Membership directly exercises none of it.
async function write(path, token, orgId, body, method = 'PATCH') {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Org-Id': String(orgId),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

// A team's door count off /team-breakdown, by coordinator name (null → the "No team" bucket).
async function teamDoors(name) {
  const { org, campaign, token } = ctx;
  const res = await call(`/admin/reports/team-breakdown?campaignId=${campaign._id}`, token, org._id);
  const row = name === null
    ? res.json.teams.find((t) => !t.coordinatorId)
    : res.json.teams.find((t) => t.coordinatorName === name);
  return { doors: row?.doors || 0, body: res.json };
}

// One knock on a fresh house, stamped with the team frozen at knock time.
async function knock(user, coordinatorId, actionType = 'not_home', household = null) {
  const { org, campaign, effort, pass } = ctx;
  const hh = household || (await Household.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: `${++doorSeq} Elm St`, city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: `${doorSeq} ELM ST|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.4, 28.3] },
  }));
  await CanvassActivity.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: pass._id,
    householdId: hh._id, userId: user._id, actionType,
    coordinatorId: coordinatorId || null,
    timestamp: new Date('2026-07-08T14:00:00Z'), location: { lat: 28.3, lng: -81.4 },
  });
  return hh;
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, CanvassActivity, SurveyResponse, Voter, Household, Effort, Pass, CoordinatorChange])
    await M.deleteMany({});

  // teamAttributionReadyAt = the backfill has run. Without it the endpoint refuses to report.
  const org = await Organization.create({
    name: 'Fox Bryant', slug: 'fox-bryant', isActive: true, teamAttributionReadyAt: new Date(),
  });
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const boss = await mkUser('Boss');
  const asa = await mkUser('Asa');        // team lead — runs the paid crew
  const frank = await mkUser('Frank');    // team lead — runs the volunteers
  const chadwick = await mkUser('Chadwick');
  const ian = await mkUser('Ian');
  const colin = await mkUser('Colin');
  const julian = await mkUser('Julian');  // QUIT
  const nathan = await mkUser('Nathan');  // QUIT
  const randy = await mkUser('Randy');    // the candidate — no team, deliberately
  const vince = await mkUser('Vince');    // a volunteer, on Frank's team

  const M = (u, role, coordinatorId = null, isActive = true) =>
    Membership.create({ userId: u._id, organizationId: org._id, role, isActive, coordinatorId });

  await M(boss, 'admin', null);
  await M(asa, 'lead', null);
  await M(frank, 'lead', null);
  await M(chadwick, 'canvasser', asa._id);
  await M(ian, 'canvasser', asa._id);
  await M(colin, 'canvasser', asa._id);
  // The two who left: DEACTIVATED, and removed from the campaign roster. Their Membership (and so
  // their coordinator) survives — which is exactly why their doors are recoverable.
  await M(julian, 'canvasser', asa._id, false);
  await M(nathan, 'canvasser', asa._id, false);
  await M(randy, 'canvasser', null);
  await M(vince, 'canvasser', frank._id);

  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Florida HD54', type: 'survey', state: 'FL',
    isActive: true, timeZone: 'America/New_York',
  });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'Main' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'Round 1', status: 'active',
  });
  Object.assign(ctx, { org, boss, asa, frank, chadwick, ian, colin, julian, nathan, randy, vince, campaign, effort, pass });

  // ── Asa's team: 737 + 292 + 100 + 60 + 47 = 1,236 raw knock events ──
  // 3 of Chadwick's houses are ALSO knocked by Nathan (same team, same pass) — the real overlaps.
  const shared = [];
  for (let i = 0; i < 3; i++) shared.push(await knock(chadwick, asa._id));
  for (let i = 0; i < 737 - 3; i++) await knock(chadwick, asa._id);
  for (const hh of shared) await knock(nathan, asa._id, 'not_home', hh); // SAME-team double-knock

  for (let i = 0; i < 292; i++) await knock(ian, asa._id);
  for (let i = 0; i < 100; i++) await knock(colin, asa._id);
  for (let i = 0; i < 60; i++) await knock(julian, asa._id);
  for (let i = 0; i < 47 - 3; i++) await knock(nathan, asa._id);

  // ── Randy, the candidate: 19 doors, no team ──
  for (let i = 0; i < 19; i++) await knock(randy, null);

  ctx.token = signUserToken(boss);
  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('the campaign billable is 1,252 — 1,255 raw knocks, 3 doors knocked twice', { skip }, async () => {
  const { org, campaign } = ctx;
  const raw = await CanvassActivity.countDocuments({ campaignId: campaign._id });
  assert.equal(raw, 1255, 'raw knock EVENTS');
  const [k] = await CanvassActivity.aggregate(knocksPipeline({ organizationId: org._id, campaignId: campaign._id }));
  assert.equal(k.knocks, 1252, 'billable = distinct (household, pass) — the 3 shared houses count once');
});

test("Asa's team reads 1,233 distinct doors — the two who QUIT are back on it", { skip }, async () => {
  const { org, campaign, asa, token } = ctx;
  const res = await call(
    `/admin/reports/canvasser-timeline?campaignId=${campaign._id}&totals=1&coordinatorId=${asa._id}`,
    token, org._id
  );
  assert.equal(res.status, 200);

  // 737+292+100+60+47 = 1,236 raw events, less the 3 houses his OWN people double-knocked.
  assert.equal(res.json.billableKnocks, 1233, "Asa's DISTINCT doors — the number you quote a client");
  assert.equal(res.json.grandKnocks, 1236, 'raw events across his crew');

  const names = res.json.canvassers.map((c) => c.firstName).sort();
  assert.deepEqual(names, ['Chadwick', 'Colin', 'Ian', 'Julian', 'Nathan'],
    'Julian and Nathan appear even though they are deactivated AND off the campaign roster');

  // The bug, stated as an assertion: dropping the departed two gives 1,129.
  assert.notEqual(res.json.billableKnocks, 1129, 'must NOT silently drop the two who left');
});

test('"No team" is Randy, and ONLY Randy — the bucket admins exclude stays clean', { skip }, async () => {
  const { org, campaign, token } = ctx;
  const res = await call(
    `/admin/reports/canvasser-timeline?campaignId=${campaign._id}&totals=1&coordinatorId=none`,
    token, org._id
  );
  assert.equal(res.json.billableKnocks, 19);
  assert.deepEqual(res.json.canvassers.map((c) => c.firstName), ['Randy']);
});

test('RECONCILIATION: teams + no-team − crossTeam == campaign billable, exactly', { skip }, async () => {
  const { org, campaign, token } = ctx;
  const res = await call(`/admin/reports/team-breakdown?campaignId=${campaign._id}`, token, org._id);
  assert.equal(res.status, 200);
  assert.equal(res.json.ready, true);

  const byName = new Map(res.json.teams.map((t) => [t.coordinatorName, t]));
  assert.equal(byName.get('Asa X').doors, 1233);
  assert.equal(byName.get(null)?.doors ?? res.json.teams.find((t) => !t.coordinatorId).doors, 19);

  // THE identity. A client number is only defensible if this holds.
  const sum = res.json.teamSum;
  assert.equal(
    sum - res.json.crossTeamDoors,
    res.json.campaign.doors,
    'Σ teams − crossTeamDoors must equal the campaign billable'
  );
  assert.equal(res.json.campaign.doors, 1252);

  // The 3 double-knocks are Chadwick + Nathan — BOTH Asa's. A same-team overlap is absorbed inside
  // Asa's own dedupe, so it must contribute NOTHING here. Subtracting all 3 (the tempting formula)
  // would land 3 under.
  assert.equal(res.json.crossTeamDoors, 0, 'same-team double-knocks are NOT cross-team');
  assert.equal(sum, 1252, '1,233 + 19');
});

test('a CROSS-team double-knock is claimed by both teams and reported, not hidden', { skip }, async () => {
  const { org, campaign, token, chadwick, vince, asa, frank } = ctx;
  // One house, one pass, worked by Asa's Chadwick AND Frank's Vince. Each team really did knock it.
  const hh = await knock(chadwick, asa._id, 'not_home');
  await knock(vince, frank._id, 'not_home', hh);

  const res = await call(`/admin/reports/team-breakdown?campaignId=${campaign._id}`, token, org._id);
  const byName = new Map(res.json.teams.map((t) => [t.coordinatorName, t]));

  assert.equal(byName.get('Asa X').doors, 1234, "Asa counts it (his man knocked it)");
  assert.equal(byName.get('Frank X').doors, 1, 'Frank counts it too (so did his)');
  assert.equal(res.json.campaign.doors, 1253, 'the campaign counts the house ONCE');
  assert.equal(res.json.crossTeamDoors, 1, 'and the double-claim is surfaced, not silently absorbed');

  // The identity still holds with a cross-team overlap present. This is the case that breaks a
  // "teams simply partition the campaign" assumption, and it must not break the arithmetic.
  assert.equal(res.json.teamSum - res.json.crossTeamDoors, res.json.campaign.doors);
});

test('REASSIGNMENT: moving a canvasser moves ALL the doors they already knocked', { skip }, async () => {
  const { org, campaign, token, colin, asa, frank } = ctx;
  // THE contract: the current coordinator owns all of that canvasser's history. Driven through the
  // real PATCH, because the re-stamp lives in setMemberCoordinator — poking Membership directly
  // would leave this test GREEN while asserting nothing, which is worse than a failure.
  const asaBefore = (await teamDoors('Asa X')).doors;
  const frankBefore = (await teamDoors('Frank X')).doors;
  const campaignBefore = (await teamDoors(null)).body.campaign.doors;

  // The preview must promise exactly what the write delivers — they share restampFilter.
  const preview = await call(
    `/admin/memberships/${colin._id}/coordinator-preview?coordinatorId=${frank._id}`,
    token, org._id
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.json.doors, 100, 'preview counts DOORS (deduped), not raw activity rows');
  assert.equal(preview.json.from.name, 'Asa X');
  assert.equal(preview.json.to.name, 'Frank X');

  // Colin transfers from Asa's paid crew to Frank's volunteers.
  const res = await write(`/admin/memberships/${colin._id}`, token, org._id, {
    coordinatorId: String(frank._id),
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.restamp.changed, true);
  assert.equal(res.json.restamp.error, null);
  assert.equal(res.json.restamp.activities, 100, 'the write moved the rows the preview promised');

  assert.equal((await teamDoors('Asa X')).doors, asaBefore - 100, "Colin's history leaves Asa");
  assert.equal((await teamDoors('Frank X')).doors, frankBefore + 100, 'and lands whole on Frank');

  const after = await teamDoors(null);
  assert.equal(after.body.campaign.doors, campaignBefore, 'the campaign billable does not move');
  assert.equal(
    after.body.teamSum - after.body.crossTeamDoors,
    after.body.campaign.doors,
    'and the identity still holds exactly'
  );

  // REVERSIBILITY — the reason no undo record is needed: the rule is idempotent w.r.t. current
  // state, so setting the coordinator back restores the numbers byte-for-byte. Doubles as cleanup,
  // since later tests in this file read live team totals.
  const back = await write(`/admin/memberships/${colin._id}`, token, org._id, {
    coordinatorId: String(asa._id),
  });
  assert.equal(back.json.restamp.activities, 100);
  assert.equal((await teamDoors('Asa X')).doors, asaBefore, 'Asa is exactly whole again');
  assert.equal((await teamDoors('Frank X')).doors, frankBefore, 'and so is Frank');
});

test('a NO-OP re-pick writes nothing and logs nothing', { skip }, async () => {
  const { org, token, colin, asa } = ctx;
  const before = await CoordinatorChange.countDocuments({ organizationId: org._id });
  const res = await write(`/admin/memberships/${colin._id}`, token, org._id, {
    coordinatorId: String(asa._id), // already his coordinator
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.restamp.changed, false);
  assert.equal(
    await CoordinatorChange.countDocuments({ organizationId: org._id }),
    before,
    'an audit log full of no-ops cannot answer "why did this team move?"'
  );
});

test('the change is AUDITED — who moved whom, from which team to which, and how much', { skip }, async () => {
  const { org, token, ian, asa, frank, boss } = ctx;
  await write(`/admin/memberships/${ian._id}`, token, org._id, { coordinatorId: String(frank._id) });

  const row = await CoordinatorChange.findOne({ organizationId: org._id, userId: ian._id }).lean();
  assert.ok(row, 'a reassignment leaves a record');
  assert.equal(String(row.fromCoordinatorId), String(asa._id));
  assert.equal(String(row.toCoordinatorId), String(frank._id));
  assert.equal(String(row.byUserId), String(boss._id), 'the actor, not the subject');
  assert.equal(row.source, 'admin_users');
  assert.equal(row.activitiesMoved, 292);
  assert.equal(row.restampError, null);

  await write(`/admin/memberships/${ian._id}`, token, org._id, { coordinatorId: String(asa._id) });
});

test('BULK-restrict rows are never re-stamped onto a team', { skip }, async () => {
  const { org, campaign, token, effort, pass, asa } = ctx;
  // An admin who bulk-restricts a gated community is doing DESK work: those rows stamp
  // coordinatorId:null with via:'bulk' and sit outside every per-team total. If that admin is
  // later given a coordinator, their office marks must NOT be swept onto a team.
  const clerk = await mkUser('Clerk');
  await Membership.create({ userId: clerk._id, organizationId: org._id, role: 'admin', isActive: true, coordinatorId: null });
  const hh = await Household.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: '9200 Gate Way', city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: '9200 GATE WAY|TOWN|FL|34741',
    location: { type: 'Point', coordinates: [-81.4, 28.3] },
  });
  await CanvassActivity.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: pass._id,
    householdId: hh._id, userId: clerk._id, actionType: 'restricted', via: 'bulk',
    coordinatorId: null, timestamp: new Date('2026-07-08T14:00:00Z'),
    location: { lat: 28.3, lng: -81.4 },
  });

  await write(`/admin/memberships/${clerk._id}`, token, org._id, { coordinatorId: String(asa._id) });

  const bulkRow = await CanvassActivity.findOne({ userId: clerk._id, via: 'bulk' }).lean();
  assert.equal(bulkRow.coordinatorId, null, 'desk work stays off every team');
});

test('the SURVEY ledger moves in lockstep with the door ledger', { skip }, async () => {
  const { org, campaign, token, effort, pass, asa, frank } = ctx;
  // The two ledgers drifting apart is the exact failure teamFoldStage's header warns about: one
  // row showing a team's DOORS on one team and their SURVEYS on another.
  const sammy = await mkUser('Sammy');
  await Membership.create({ userId: sammy._id, organizationId: org._id, role: 'canvasser', isActive: true, coordinatorId: asa._id });
  const hh = await Household.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: '9300 Survey St', city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: '9300 SURVEY ST|TOWN|FL|34741',
    location: { type: 'Point', coordinates: [-81.4, 28.3] },
  });
  const voter = await Voter.create({
    organizationId: org._id, householdId: hh._id, stateVoterId: 'LOCK-1',
    firstName: 'Lock', lastName: 'Step', fullName: 'Lock Step',
  });
  await CanvassActivity.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: pass._id,
    householdId: hh._id, userId: sammy._id, actionType: 'survey_submitted',
    coordinatorId: asa._id, timestamp: new Date('2026-07-08T14:00:00Z'),
    location: { lat: 28.3, lng: -81.4 },
  });
  await SurveyResponse.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: pass._id,
    householdId: hh._id, voterId: voter._id, userId: sammy._id,
    surveyTemplateId: new mongoose.Types.ObjectId(), surveyTemplateVersion: 1,
    answers: [], coordinatorId: asa._id, submittedAt: new Date('2026-07-08T14:00:00Z'),
    location: { lat: 28.3, lng: -81.4 },
  });

  const res = await write(`/admin/memberships/${sammy._id}`, token, org._id, {
    coordinatorId: String(frank._id),
  });
  assert.equal(res.json.restamp.activities, 1);
  assert.equal(res.json.restamp.surveys, 1, 'the survey ledger must not be left behind');

  const sr = await SurveyResponse.findOne({ userId: sammy._id }).lean();
  assert.equal(String(sr.coordinatorId), String(frank._id));

  const breakdown = await teamDoors('Frank X');
  const frankRow = breakdown.body.teams.find((t) => t.coordinatorName === 'Frank X');
  assert.equal(frankRow.surveyDoors, 1, 'door-unit follows');
  assert.equal(frankRow.surveysTaken, 1, 'and voter-unit follows identically');
});

test('LEGACY rows with coordinatorId ABSENT are swept by a reassignment', { skip }, async () => {
  const { org, campaign, token, effort, pass, asa } = ctx;
  // Pre-backfill history has NO coordinatorId key at all. In QUERY context {$ne: <id>} matches an
  // absent field, so the re-stamp sweeps these for free — the inverse of the {$exists:false} rule
  // migrateActivityCoordinator.js keys on. Seeded through the RAW driver: Mongoose's default:null
  // would write an explicit null and mask the case entirely.
  const ghost = await mkUser('Ghost');
  await Membership.create({ userId: ghost._id, organizationId: org._id, role: 'canvasser', isActive: true, coordinatorId: null });
  const hh = await Household.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: '9400 Ghost Rd', city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: '9400 GHOST RD|TOWN|FL|34741',
    location: { type: 'Point', coordinates: [-81.4, 28.3] },
  });
  await CanvassActivity.collection.insertOne({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: pass._id,
    householdId: hh._id, userId: ghost._id, actionType: 'not_home',
    // NO coordinatorId key — a genuine legacy row.
    timestamp: new Date('2026-07-08T14:00:00Z'),
  });

  const res = await write(`/admin/memberships/${ghost._id}`, token, org._id, {
    coordinatorId: String(asa._id),
  });
  assert.equal(res.json.restamp.activities, 1, 'an absent field is stale, not sacred');
  const row = await CanvassActivity.findOne({ userId: ghost._id }).lean();
  assert.equal(String(row.coordinatorId), String(asa._id));
});

test('CROSS-ORG: a reassignment in one org never touches the same person\'s work in another', { skip }, async () => {
  const { org, colin, asa } = ctx;
  // Membership is unique on {userId, organizationId} precisely because a person can canvass for
  // two customers. restampFilter requires organizationId for this reason.
  const other = await Organization.create({
    name: 'Other Org', slug: 'other-org', isActive: true, teamAttributionReadyAt: new Date(),
  });
  const otherBoss = await mkUser('Otherboss');
  const otherLead = await mkUser('Otherlead');
  await Membership.create({ userId: otherBoss._id, organizationId: other._id, role: 'admin', isActive: true });
  await Membership.create({ userId: otherLead._id, organizationId: other._id, role: 'lead', isActive: true });
  await Membership.create({ userId: colin._id, organizationId: other._id, role: 'canvasser', isActive: true, coordinatorId: otherLead._id });

  const otherCampaign = await Campaign.create({
    organizationId: other._id, name: 'Other Race', type: 'survey', state: 'FL',
    isActive: true, timeZone: 'America/New_York',
  });
  const otherHh = await Household.create({
    organizationId: other._id, campaignId: otherCampaign._id,
    addressLine1: '1 Other St', city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: '1 OTHER ST|TOWN|FL|34741',
    location: { type: 'Point', coordinates: [-81.4, 28.3] },
  });
  await CanvassActivity.create({
    organizationId: other._id, campaignId: otherCampaign._id, householdId: otherHh._id,
    userId: colin._id, actionType: 'not_home', coordinatorId: otherLead._id,
    timestamp: new Date('2026-07-08T14:00:00Z'), location: { lat: 28.3, lng: -81.4 },
  });

  // Move Colin in the FIRST org.
  await write(`/admin/memberships/${colin._id}`, ctx.token, org._id, { coordinatorId: null });

  const otherRow = await CanvassActivity.findOne({ organizationId: other._id, userId: colin._id }).lean();
  assert.equal(String(otherRow.coordinatorId), String(otherLead._id), "the other org's ledger is untouched");

  await write(`/admin/memberships/${colin._id}`, ctx.token, org._id, { coordinatorId: String(asa._id) });
});

test('DEPARTURE does not re-stamp — a departed coordinator keeps the doors they supervised', { skip }, async () => {
  const { org, campaign, token, effort, pass } = ctx;
  // THE most important assertion in this file. deleteAccount clears the crew's
  // Membership.coordinatorId when a coordinator leaves the org; the LEDGER must keep their team,
  // or their crew's history falls into the "No team" bucket admins exclude. That is the original
  // 104-door bug, and the current-coordinator-owns-history rule must not resurrect it.
  const quitter = await mkUser('Quitter');   // a coordinator who will leave
  const rookie = await mkUser('Rookie');     // their crew member, who stays
  await Membership.create({ userId: quitter._id, organizationId: org._id, role: 'lead', isActive: true, coordinatorId: null });
  await Membership.create({ userId: rookie._id, organizationId: org._id, role: 'canvasser', isActive: true, coordinatorId: quitter._id });
  for (let i = 0; i < 12; i++) await knock(rookie, quitter._id);

  assert.equal((await teamDoors('Quitter X')).doors, 12, 'Quitter\'s team is on the board');

  const noTeamBefore = (await teamDoors(null)).doors;
  await releaseAssignedWork(quitter._id, { organizationId: org._id });

  // The membership side IS cleared — nobody keeps supervising from outside the org.
  const rookieMembership = await Membership.findOne({ userId: rookie._id, organizationId: org._id }).lean();
  assert.equal(rookieMembership.coordinatorId, null, 'a departed coordinator supervises nobody');

  // But the ledger did NOT move.
  assert.equal((await teamDoors('Quitter X')).doors, 12, "the doors Quitter's crew worked stay his");
  assert.equal((await teamDoors(null)).doors, noTeamBefore, 'and "No team" is NOT inflated by them');
});

test('a TEAM LEAD can move history too, from their own campaign crew panel', { skip }, async () => {
  const { org, campaign, colin, asa, frank } = ctx;
  // Permission tier 2. The lead's endpoint lives on a campaign-scoped URL but its write filter is
  // {userId, organizationId} — as it always was, since Membership has no campaignId. So the move
  // is ORG-WIDE, and the re-stamp makes that pre-existing scope visible rather than adding it.
  await CampaignManager.create({ userId: frank._id, organizationId: org._id, campaignId: campaign._id, grantedBy: ctx.boss._id });
  await CampaignAssignment.create({ campaignId: campaign._id, userId: colin._id, organizationId: org._id, assignedBy: ctx.boss._id });
  const frankToken = signUserToken(frank);

  const asaBefore = (await teamDoors('Asa X')).doors;
  const frankBefore = (await teamDoors('Frank X')).doors;

  const preview = await call(
    `/admin/campaigns/${campaign._id}/crew/${colin._id}/coordinator-preview?coordinatorId=${frank._id}`,
    frankToken, org._id
  );
  assert.equal(preview.status, 200, 'a lead may preview their own crew move');
  assert.equal(preview.json.doors, 100);

  const res = await write(
    `/admin/campaigns/${campaign._id}/crew/${colin._id}/coordinator`,
    frankToken, org._id, { coordinatorId: String(frank._id) }
  );
  assert.equal(res.status, 200);
  assert.equal(res.json.restamp.activities, 100);
  assert.equal((await teamDoors('Frank X')).doors, frankBefore + 100);
  assert.equal((await teamDoors('Asa X')).doors, asaBefore - 100);

  const row = await CoordinatorChange.findOne({ userId: colin._id }).sort({ createdAt: -1 }).lean();
  assert.equal(row.source, 'lead_crew', 'the audit distinguishes the lead panel from the Users page');

  // Put Colin back so the later fixtures read their baseline.
  await write(`/admin/memberships/${colin._id}`, ctx.token, org._id, { coordinatorId: String(asa._id) });
  assert.equal((await teamDoors('Asa X')).doors, asaBefore);
});

test('LEAD-FOLD: giving a lead their own coordinator moves their OWN doors, and both surfaces agree', { skip }, async () => {
  const { org, campaign, token, frank, boss } = ctx;
  // A lead's own knocks stamp coordinatorId:null and teamFoldStage rescues them onto the lead's own
  // team. Once the lead is themselves assigned a coordinator, those rows stamp a real id, so the
  // fold's `$in ['$userId', leadIds]` fallback is never reached — one team, no double-count.
  //
  // The subtle part: the aggregation fold (/team-breakdown) and the query filter (teamMatch, used
  // by /canvasser-timeline) are SEPARATE implementations of the same idea. If they ever disagree,
  // the same person reads one number on one page and another elsewhere. Assert they agree.
  await knock(frank, null); // Frank knocks for himself — nobody coordinates him
  const frankOwn = (await teamDoors('Frank X')).doors;
  const bossBefore = (await teamDoors('Boss X')).doors;

  const res = await write(`/admin/memberships/${frank._id}`, token, org._id, {
    coordinatorId: String(boss._id),
  });
  assert.equal(res.json.restamp.changed, true);

  const after = await teamDoors('Frank X');
  assert.equal(after.doors, frankOwn - res.json.restamp.activities, "the lead's own doors leave his row");
  assert.equal((await teamDoors('Boss X')).doors, bossBefore + res.json.restamp.activities,
    'and land on the team he now reports to');

  // The two implementations must agree on Frank's row.
  const viaFilter = await call(
    `/admin/reports/canvasser-timeline?campaignId=${campaign._id}&totals=1&coordinatorId=${frank._id}`,
    token, org._id
  );
  const viaFold = after.body.teams.find((t) => t.coordinatorName === 'Frank X');
  assert.equal(viaFilter.json.billableKnocks, viaFold.doors,
    'teamMatch (query) and teamFoldStage (aggregation) must not drift');

  assert.equal(after.body.teamSum - after.body.crossTeamDoors, after.body.campaign.doors, 'identity holds');

  // Reversible: clearing it folds his own doors back onto his own team.
  await write(`/admin/memberships/${frank._id}`, token, org._id, { coordinatorId: null });
  assert.equal((await teamDoors('Frank X')).doors, frankOwn, 'exactly back where it started');
});

test('a NEW org can show team surfaces immediately — the gate is not stuck off', { skip }, async () => {
  // Regression for a latent bug: teamAttributionReadyAt was written ONLY by
  // migrate:activity-coordinator, at a point below two `continue` guards, and no creation path set
  // it. A new org has nothing to backfill, so the migration always skipped it — leaving every org
  // created after that release permanently gated OFF, with team surfaces silently absent. The
  // default now lives on the schema, because there are two creation paths (the super-admin route
  // and seedDemoOrg) and a third would have inherited the bug.
  const fresh = await Organization.create({ name: 'Brand New', slug: 'brand-new', isActive: true });
  assert.ok(fresh.teamAttributionReadyAt instanceof Date, 'a new org is ready by default — it has no history to backfill');
});

test('a LEAD who knocks: their doors AND their surveyed voters both land on their own team', { skip }, async () => {
  const { org, campaign, token, asa, effort, pass } = ctx;
  // Asa RUNS a crew, so nobody coordinates HIM — his own knocks stamp coordinatorId: null and would
  // fall into the "No team" bucket admins deliberately exclude. The fold rescues them onto his team.
  //
  // This test exists because the fold was once applied to the DOORS aggregate but NOT the
  // SURVEYS one, so a lead's doors landed on their team while their surveyed voters stayed in
  // "No team" — one row, two different ideas of who is on the team. A sum-based reconciliation
  // check cannot see that; the row just quietly lies.
  const hh = await Household.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: '9001 Lead Ln', city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: '9001 LEAD LN|TOWN|FL|34741',
    location: { type: 'Point', coordinates: [-81.4, 28.3] },
  });
  const voter = await Voter.create({
    organizationId: org._id, householdId: hh._id, stateVoterId: 'LEAD-1',
    firstName: 'Vera', lastName: 'Voter', fullName: 'Vera Voter',
  });
  await CanvassActivity.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: pass._id,
    householdId: hh._id, userId: asa._id, actionType: 'survey_submitted',
    coordinatorId: null, // ← a lead has no coordinator; this is what the fold has to handle
    timestamp: new Date('2026-07-08T14:00:00Z'), location: { lat: 28.3, lng: -81.4 },
  });
  await SurveyResponse.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: pass._id,
    householdId: hh._id, voterId: voter._id, userId: asa._id,
    surveyTemplateId: new mongoose.Types.ObjectId(), surveyTemplateVersion: 1,
    answers: [], coordinatorId: null,
    submittedAt: new Date('2026-07-08T14:00:00Z'), location: { lat: 28.3, lng: -81.4 },
  });

  const res = await call(`/admin/reports/team-breakdown?campaignId=${campaign._id}`, token, org._id);
  const asaRow = res.json.teams.find((t) => t.coordinatorName === 'Asa X');
  const noTeam = res.json.teams.find((t) => !t.coordinatorId);

  assert.equal(asaRow.surveyDoors, 1, "the lead's survey DOOR is on his own team");
  // `surveysTaken` was `votersSurveyed` — renamed because it counts RESPONSE ROWS, not distinct
  // people. Same fold, same number here; the name now matches the unit.
  assert.equal(asaRow.surveysTaken, 1, "and so is his survey — the two must not disagree");
  assert.equal(noTeam.surveysTaken, 0, 'and "No team" is NOT inflated by the lead\'s survey');
  assert.equal(asaRow.votersSurveyed, undefined, 'the misleading old field name is gone');
});

test('ADMINS and SUPER-ADMINS who knock land in "No team" — and everything still reconciles', { skip }, async () => {
  const { org, campaign, token, effort, pass } = ctx;
  // An org admin (or a super-admin) who isn't anybody's coordinator has no team — the same as the
  // candidate knocking his own district. "No team" is a real answer, not a dumping ground. What
  // matters is that they are counted SOMEWHERE and the arithmetic still closes.
  const omar = await mkUser('Omar');   // org admin, coordinates nobody
  const sup = await mkUser('Sue');     // super-admin
  sup.isSuperAdmin = true;
  await sup.save();
  await Membership.create({ userId: omar._id, organizationId: org._id, role: 'admin', isActive: true, coordinatorId: null });
  await Membership.create({ userId: sup._id, organizationId: org._id, role: 'admin', isActive: true, coordinatorId: null });

  const before = await call(`/admin/reports/team-breakdown?campaignId=${campaign._id}`, token, org._id);
  const noTeamBefore = before.json.teams.find((t) => !t.coordinatorId).doors;

  await knock(omar, null); // an admin's knock stamps null — nobody oversees them
  await knock(sup, null);  // ditto a super-admin (orgContext leaves them without an activeMembership)

  const res = await call(`/admin/reports/team-breakdown?campaignId=${campaign._id}`, token, org._id);
  const noTeam = res.json.teams.find((t) => !t.coordinatorId);
  assert.equal(noTeam.doors, noTeamBefore + 2, 'both land in "No team" — correct: they run no crew');

  // THE point: however odd the knocker, the identity must still hold.
  assert.equal(
    res.json.teamSum - res.json.crossTeamDoors,
    res.json.campaign.doors,
    'Σ teams − cross-team still equals the campaign billable'
  );
});

test("a lead's PRE-BACKFILL rows (coordinatorId ABSENT, not null) still fold onto their own team", { skip }, async () => {
  const { org, campaign, token, frank, effort, pass } = ctx;
  // The backfill only stamps members who HAVE a coordinator — a lead's own history keeps the field
  // ABSENT. In aggregation expressions missing ≠ null ({$ne:[missing,null]} → true, verified on
  // Mongo 7), so an unguarded fold routes these rows through the "has a team" branch, emits a
  // MISSING team, and $group parks them in the No-team bucket. The reconciliation still balances
  // (the doors are counted, in the wrong row), which is why only a bucket-level assertion can
  // catch it. Mongoose's default:null would write an explicit null and hide the bug — so this
  // seeds through the RAW driver, exactly like real pre-migration rows.
  const before = await call(`/admin/reports/team-breakdown?campaignId=${campaign._id}`, token, org._id);
  const frankBefore = before.json.teams.find((t) => t.coordinatorName === 'Frank X')?.doors || 0;
  const noneBefore = before.json.teams.find((t) => !t.coordinatorId)?.doors || 0;

  const hh = await Household.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: '9100 Legacy Ln', city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: '9100 LEGACY LN|TOWN|FL|34741',
    location: { type: 'Point', coordinates: [-81.4, 28.3] },
  });
  await CanvassActivity.collection.insertOne({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: pass._id,
    householdId: hh._id, userId: frank._id, actionType: 'not_home',
    // NO coordinatorId key at all — a genuine legacy row.
    timestamp: new Date('2026-07-08T14:00:00Z'), location: { lat: 28.3, lng: -81.4 },
  });

  const res = await call(`/admin/reports/team-breakdown?campaignId=${campaign._id}`, token, org._id);
  const frankRow = res.json.teams.find((t) => t.coordinatorName === 'Frank X');
  const noneRow = res.json.teams.find((t) => !t.coordinatorId);

  assert.equal(frankRow.doors, frankBefore + 1, "the lead's legacy door folds onto HIS team");
  assert.equal(noneRow.doors, noneBefore, 'and the No-team bucket does NOT quietly absorb it');
  assert.equal(res.json.teamSum - res.json.crossTeamDoors, res.json.campaign.doors, 'identity holds');
});

test('the Home LEADERBOARD names a departed canvasser\'s team from the ledger, matching the Timeline', { skip }, async () => {
  const { org, campaign, token } = ctx;
  // /canvassers used to leave the Coordinator column to a client-side roster join — so the same
  // person read 'Asa Bryant' on the Timeline and '—' on the Home tab, purely by which page you had
  // open. Both now resolve from the teams stamped on the knocks themselves.
  const res = await call(`/admin/reports/canvassers?campaignId=${campaign._id}`, token, org._id);
  assert.equal(res.status, 200);
  const byName = new Map(res.json.map((r) => [r.firstName, r]));

  assert.equal(byName.get('Julian').coordinatorName, 'Asa X',
    'deactivated AND off the roster — the ledger still knows his team');
  assert.equal(byName.get('Nathan').coordinatorName, 'Asa X');
  assert.equal(byName.get('Randy').coordinatorName, null, 'the candidate stays teamless');
});

test('an org with no backfill yet REFUSES to report team numbers rather than mislead', { skip }, async () => {
  const { org, campaign, token } = ctx;
  await Organization.updateOne({ _id: org._id }, { $set: { teamAttributionReadyAt: null } });
  const res = await call(`/admin/reports/team-breakdown?campaignId=${campaign._id}`, token, org._id);
  // Unstamped rows are invisible to a team AND swallowed by the No-team bucket, so a half-migrated
  // org would show every team at zero and "no team" enormous — which looks like data, not an error.
  assert.equal(res.json.ready, false);
  assert.deepEqual(res.json.teams, []);
  await Organization.updateOne({ _id: org._id }, { $set: { teamAttributionReadyAt: new Date() } });
});
