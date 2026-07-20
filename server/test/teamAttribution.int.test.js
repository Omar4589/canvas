import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// Team attribution — the coordinator frozen onto each knock, over the REAL Express app.
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
//   4. Frozen history: moving a canvasser to another team does NOT move the doors they already knocked.
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
const { knocksPipeline } = await import('../src/services/reports/aggregations.js');

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
  for (const M of [Organization, User, Membership, Subscription, Campaign, CanvassActivity, SurveyResponse, Voter, Household, Effort, Pass])
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

test('FROZEN: moving a canvasser to another team does NOT move the doors they already knocked', { skip }, async () => {
  const { org, campaign, token, colin, asa, frank } = ctx;
  const before = await call(
    `/admin/reports/canvasser-timeline?campaignId=${campaign._id}&totals=1&coordinatorId=${asa._id}`,
    token, org._id
  );

  // Colin transfers from Asa's paid crew to Frank's volunteers.
  await Membership.updateOne(
    { userId: colin._id, organizationId: org._id },
    { $set: { coordinatorId: frank._id } }
  );

  const after = await call(
    `/admin/reports/canvasser-timeline?campaignId=${campaign._id}&totals=1&coordinatorId=${asa._id}`,
    token, org._id
  );
  assert.equal(
    after.json.billableKnocks,
    before.json.billableKnocks,
    "Colin's 100 doors were knocked for Asa and stay Asa's — a number quoted last month still reconciles"
  );

  const frankRes = await call(
    `/admin/reports/canvasser-timeline?campaignId=${campaign._id}&totals=1&coordinatorId=${frank._id}`,
    token, org._id
  );
  assert.ok(
    frankRes.json.billableKnocks < 100,
    "Frank does NOT inherit 100 doors he never worked"
  );
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
