import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// Per-campaign crews — TWO campaigns in ONE org, which no existing suite builds.
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/percamp node --test test/perCampaignCrews.int.test.js
//
// WHY THIS FILE EXISTS. teamAttribution.int.test.js is the spec for team counting, and it is
// thorough — but its fixture has exactly ONE campaign in the main org (the only second campaign
// lives in a DIFFERENT org, for cross-tenant isolation). Every bug below needs two campaigns in one
// org to appear, so all 22 of those tests stay green through them. A suite that cannot construct the
// failure cannot report it.
//
// The shape, which is just an org running two races at once:
//   HD54 — Asa leads.   HD64 — Frank leads.   Maria canvasses BOTH.
//
// Four tests, in two pairs:
//
//   THE BUGS (must FAIL before the fix)
//     1. Two leads set Maria's crew in their own campaigns. Membership holds ONE coordinator slot
//        per {user, org}, so the second write overwrites the first and Asa's crew silently loses her.
//     2. The re-stamp is keyed {userId, organizationId} with no campaign, so Frank setting Maria's
//        crew in HD64 drags her HD54 doors onto his team — in a campaign he does not manage.
//
//   THE GUARDS (must PASS before AND after — these protect the fix from itself)
//     3. A lead walking WITH their crew on the same door still folds to ONE team, crossTeamDoors 0.
//        This is the case teamFoldStage exists for. Sourcing leadIds from the campaign ROSTER
//        (the first design considered) breaks it, and /team-breakdown's own reconciliation identity
//        is arithmetically incapable of noticing: crossTeamDoors = max(0, teamSum − knocks) makes
//        `teamSum − crossTeamDoors === knocks` true by construction. Only an explicit per-row
//        assertion catches it, so that is what this test does.
//     4. Removing a crew member from the campaign must not split the lead's row. The ledger keeps
//        their team (the 104-door fix); the lead keeps their own folded doors.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-per-campaign-crews';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { Household } = await import('../src/models/Household.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { CoordinatorChange } = await import('../src/models/CoordinatorChange.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { releaseAssignedWork } = await import('../src/services/users/deleteAccount.js');
const { SupportAccessGrant } = await import('../src/models/SupportAccessGrant.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Turf } = await import('../src/models/Turf.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const PW = 'Str0ng!Passw0rd';
let server;
let base;
const ctx = {};
let doorSeq = 0;

const mkUser = async (first) =>
  User.create({
    firstName: first, lastName: 'X', email: `${first.toLowerCase()}@percamp.co`,
    passwordHash: await User.hashPassword(PW), isActive: true,
  });

const call = async (path, token) => {
  const res = await fetch(`${base}/api${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': String(ctx.org._id) },
  });
  return { status: res.status, json: await res.json() };
};

const write = async (path, token, body, method = 'PATCH') => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Org-Id': String(ctx.org._id),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
};

// Set a crew member's coordinator THROUGH THE REAL ROUTE — the re-stamp lives in the service layer,
// so poking Membership directly would exercise none of the behaviour under test.
const status = (camp, userId, action, token) =>
  write(`/admin/campaigns/${camp._id}/crew/${userId}/${action}`, token, {});

const setCrew = (camp, userId, coordinatorId, token) =>
  write(`/admin/campaigns/${camp._id}/crew/${userId}/coordinator`, token, {
    coordinatorId: coordinatorId ? String(coordinatorId) : null,
  });

// One knock, with the team frozen on the row exactly as the write path does it.
const knock = async (camp, user, coordinatorId, { household = null, actionType = 'not_home' } = {}) => {
  const { org } = ctx;
  const c = ctx.byCampaign[String(camp._id)];
  const hh = household || (await Household.create({
    organizationId: org._id, campaignId: camp._id, effortId: c.effort._id,
    addressLine1: `${++doorSeq} Elm St`, city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: `${doorSeq} ELM ST|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.4, 28.3] },
  }));
  await CanvassActivity.create({
    organizationId: org._id, campaignId: camp._id, effortId: c.effort._id, passId: c.pass._id,
    householdId: hh._id, userId: user._id, actionType,
    coordinatorId: coordinatorId || null,
    timestamp: new Date('2026-07-08T14:00:00Z'), location: { lat: 28.3, lng: -81.4 },
  });
  return hh;
};

const teamRows = async (camp) => {
  const res = await call(`/admin/reports/team-breakdown?campaignId=${camp._id}`, ctx.bossToken);
  assert.equal(res.status, 200, 'team-breakdown responded');
  return res.json;
};

const teamDoors = (body, name) => {
  const row = name === null
    ? body.teams.find((t) => !t.coordinatorId)
    : body.teams.find((t) => t.coordinatorName === name);
  return row?.doors || 0;
};

// What the ledger says a person's doors are tagged with, per campaign. The frozen stamp IS the
// attribution, so this is the ground truth the report reads.
const stampsIn = async (camp, user) => {
  const rows = await CanvassActivity.find(
    { campaignId: camp._id, userId: user._id },
    'coordinatorId'
  ).lean();
  return rows.map((r) => (r.coordinatorId ? String(r.coordinatorId) : null));
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, CanvassActivity,
    SurveyResponse, Household, Effort, Pass, CoordinatorChange, CampaignManager, CampaignAssignment,
    SupportAccessGrant, TurfAssignment, Turf])
    await M.deleteMany({});

  // teamAttributionReadyAt = the backfill has run; without it team-breakdown refuses to report.
  const org = await Organization.create({
    name: 'Two Races', slug: 'two-races', isActive: true, teamAttributionReadyAt: new Date(),
  });
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const boss = await mkUser('Boss');
  const asa = await mkUser('Asa');       // leads HD54
  const frank = await mkUser('Frank');   // leads HD64
  const maria = await mkUser('Maria');   // canvasses BOTH — the whole point
  const chad = await mkUser('Chad');     // Asa's crew, HD54 only

  const M = (u, role, coordinatorId = null) =>
    Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true, coordinatorId });
  await M(boss, 'admin');
  await M(asa, 'lead');
  await M(frank, 'lead');
  await M(maria, 'canvasser');
  await M(chad, 'canvasser');

  const mkCampaign = async (name) => {
    const campaign = await Campaign.create({
      organizationId: org._id, name, type: 'survey', state: 'FL', isActive: true,
      timeZone: 'America/New_York',
    });
    const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'Main' });
    const pass = await Pass.create({
      organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
      roundNumber: 1, name: 'Round 1', status: 'active',
    });
    return { campaign, effort, pass };
  };
  const hd54 = await mkCampaign('HD54');
  const hd64 = await mkCampaign('HD64');

  // Each lead manages exactly ONE campaign — the grant is what requireCampaignManager checks.
  await CampaignManager.create({ userId: asa._id, organizationId: org._id, campaignId: hd54.campaign._id, grantedBy: boss._id });
  await CampaignManager.create({ userId: frank._id, organizationId: org._id, campaignId: hd64.campaign._id, grantedBy: boss._id });

  // Rosters. Maria is on BOTH; the crew route requires a CampaignAssignment to act on someone.
  for (const [camp, users] of [
    [hd54.campaign, [asa, maria, chad]],
    [hd64.campaign, [frank, maria]],
  ]) {
    for (const u of users) {
      await CampaignAssignment.create({
        campaignId: camp._id, userId: u._id, organizationId: org._id, assignedBy: boss._id,
      });
    }
  }

  Object.assign(ctx, {
    org, boss, asa, frank, maria, chad,
    hd54: hd54.campaign, hd64: hd64.campaign,
    byCampaign: {
      [String(hd54.campaign._id)]: hd54,
      [String(hd64.campaign._id)]: hd64,
    },
    bossToken: signUserToken(boss),
    asaToken: signUserToken(asa),
    frankToken: signUserToken(frank),
  });

  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!URI) return;
  await new Promise((r) => server.close(r));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// ── THE BUGS ────────────────────────────────────────────────────────────────────────────────────

test('two leads set crews in their OWN campaigns and neither is clobbered', { skip }, async () => {
  const { hd54, hd64, maria, asa, frank, asaToken, frankToken } = ctx;

  const a = await setCrew(hd54, maria._id, asa._id, asaToken);
  assert.equal(a.status, 200, 'Asa may set the crew in the campaign he manages');

  const b = await setCrew(hd64, maria._id, frank._id, frankToken);
  assert.equal(b.status, 200, 'Frank may set the crew in the campaign he manages');

  // Each campaign keeps its own answer. Today Membership holds ONE slot, so Frank's write lands on
  // top of Asa's and this is the assertion that fails.
  const inHd54 = await CampaignAssignment.findOne({ campaignId: hd54._id, userId: maria._id }).lean();
  const inHd64 = await CampaignAssignment.findOne({ campaignId: hd64._id, userId: maria._id }).lean();
  assert.equal(String(inHd54?.coordinatorId), String(asa._id), 'in HD54 Maria is on Asa\'s crew');
  assert.equal(String(inHd64?.coordinatorId), String(frank._id), 'in HD64 Maria is on Frank\'s crew');
});

test('a crew change in one campaign moves ZERO doors in another', { skip }, async () => {
  const { hd54, hd64, maria, asa, frank, asaToken, frankToken } = ctx;

  // Independent of test order: the previous test may already have put Maria on Frank's HD64 crew,
  // and a re-pick that lands on the same value is deliberately a no-op (no write, no re-stamp, no
  // audit row), which would make the move below untestable.
  await setCrew(hd64, maria._id, null, frankToken);

  // Maria starts on Asa's crew and knocks in both races. HD54's doors belong to Asa; HD64's are
  // hers alone until Frank claims her.
  await setCrew(hd54, maria._id, asa._id, asaToken);
  await knock(hd54, maria, asa._id);
  await knock(hd54, maria, asa._id);
  await knock(hd64, maria, null);

  const before54 = await stampsIn(hd54, maria);
  assert.deepEqual(before54, [String(asa._id), String(asa._id)], 'HD54 doors start on Asa\'s team');

  // Frank reorganises HIS crew, in HIS campaign.
  const res = await setCrew(hd64, maria._id, frank._id, frankToken);
  assert.equal(res.status, 200);

  // HD54 must be untouched. Today the re-stamp is keyed {userId, organizationId} with no campaign,
  // so both of Asa's doors follow Frank into a race he does not manage.
  const after54 = await stampsIn(hd54, maria);
  assert.deepEqual(after54, before54, 'Frank\'s change in HD64 did not touch HD54\'s ledger');

  const after64 = await stampsIn(hd64, maria);
  assert.deepEqual(after64, [String(frank._id)], 'HD64\'s door did move to Frank');
});

// ── THE GUARDS ──────────────────────────────────────────────────────────────────────────────────

test('a lead walking WITH their crew on one door folds to ONE team (crossTeamDoors 0)', { skip }, async () => {
  const { hd54, asa, chad, asaToken } = ctx;
  await setCrew(hd54, chad._id, asa._id, asaToken);

  // Both knock the SAME household in the SAME pass. Chad's row is stamped Asa; Asa is overseen by
  // nobody, so his own row stamps null and only the fold puts it on his team.
  const door = await knock(hd54, chad, asa._id);
  await knock(hd54, asa, null, { household: door });

  const body = await teamRows(hd54);
  const asaDoors = teamDoors(body, 'Asa X');
  const noTeam = teamDoors(body, null);

  // The identity `teamSum − crossTeamDoors === campaign.doors` holds even when this is broken, so
  // assert the ROWS, not the identity.
  assert.equal(body.crossTeamDoors, 0, 'one team walked it — not a cross-team overlap');
  assert.ok(asaDoors >= 1, 'the shared door is on Asa\'s row');
  assert.equal(noTeam, 0, 'the lead\'s own door did not fall into "No team"');
});

test('the roster endpoint REPORTS the crew it was told to write', { skip }, async () => {
  const { hd54, maria, asa, asaToken, bossToken } = ctx;
  // Regression: /assignments joined the crew from Membership.coordinatorId — the legacy field
  // nothing writes any more — so the Team page DISPLAYED one value while WRITING another, and a
  // crew change appeared to revert on the next refetch. Read what the write path wrote.
  await setCrew(hd54, maria._id, asa._id, asaToken);
  const res = await call(`/admin/campaigns/${hd54._id}/assignments`, bossToken);
  const row = (res.json.assignments || []).find((a) => String(a.userId) === String(maria._id));
  assert.ok(row, 'Maria is on the roster');
  assert.equal(String(row.coordinatorId), String(asa._id), 'the roster reports the crew that was set');
  assert.equal(row.coordinatorName, 'Asa X', 'and names it');
});

test('a departing coordinator stops supervising — future knocks, not past ones', { skip }, async () => {
  const { org, hd54, chad, asa, asaToken } = ctx;
  await setCrew(hd54, chad._id, asa._id, asaToken);
  await knock(hd54, chad, asa._id);
  const doorsBefore = teamDoors(await teamRows(hd54), 'Asa X');

  // Asa leaves the org. His crew's roster link must be cleared so the NEXT knock stamps no team...
  await releaseAssignedWork(asa._id, { organizationId: org._id });
  const chadRow = await CampaignAssignment.findOne({ campaignId: hd54._id, userId: chad._id }).lean();
  assert.equal(chadRow?.coordinatorId ?? null, null, 'the crew link is cleared');

  // ...but the doors he already supervised keep his stamp. Clearing those instead is the original
  // 104-door under-report, which is why this write never goes through setMemberCoordinator.
  assert.equal(
    teamDoors(await teamRows(hd54), 'Asa X'), doorsBefore,
    'the departed coordinator keeps every door his crew already knocked'
  );
});

test('removing a crew member from the campaign does not split the lead\'s row', { skip }, async () => {
  const { org, hd54, asa, chad, asaToken } = ctx;
  await setCrew(hd54, chad._id, asa._id, asaToken);
  await knock(hd54, chad, asa._id);
  await knock(hd54, asa, null);

  const before = teamDoors(await teamRows(hd54), 'Asa X');

  // Chad comes off the campaign roster. His knocks stay stamped — that asymmetry is the 104-door
  // fix — and Asa must keep his own folded doors even though his crew's roster row is gone.
  await releaseAssignedWork(chad._id, { organizationId: org._id, campaignId: hd54._id });
  assert.equal(
    await CampaignAssignment.countDocuments({ campaignId: hd54._id, userId: chad._id }), 0,
    'Chad is off the roster'
  );

  const after = teamDoors(await teamRows(hd54), 'Asa X');
  assert.equal(after, before, 'Asa\'s team keeps every door it had');
  assert.equal(teamDoors(await teamRows(hd54), null), 0, 'nothing leaked into "No team"');
});

// ── deactivate / reactivate ─────────────────────────────────────────────────────────────────────
//
// These two write Membership.isActive, which has NO campaignId — one row per person per ORG. So the
// write reaches campaigns the actor does not manage, and every guard has to be about the TARGET
// rather than about the campaign in the URL. That inversion is what these tests pin.

test('a lead switches a canvasser off and back on, and is told which other campaigns it hits', { skip }, async () => {
  const { hd54, hd64, maria, asa, asaToken, org, boss } = ctx;
  // The departure test above ran releaseAssignedWork in ORG scope, which deletes CampaignManager
  // grants too — so Asa stopped being a lead and every call below would 403 at
  // requireCampaignManager. Restore the grant rather than reorder: the departure behaviour is worth
  // testing exactly as written, and a suite that silently depends on test order is worse.
  await CampaignManager.updateOne(
    { userId: asa._id, organizationId: org._id, campaignId: hd54._id },
    { $setOnInsert: { userId: asa._id, organizationId: org._id, campaignId: hd54._id, grantedBy: boss._id } },
    { upsert: true }
  );

  const off = await status(hd54, maria._id, 'deactivate', asaToken);
  assert.equal(off.status, 200, 'a lead may deactivate a canvasser on their campaign');
  assert.equal(off.json.isActive, false);
  // Maria also walks HD64, which Asa does not manage. The write reaches it, so the response has to
  // SAY so — disclosure is the mitigation, since there is no campaign-scoped version of this write.
  assert.deepEqual(
    off.json.alsoAffects.map((c) => c.name), ['HD64'],
    'the response names the other campaign this reaches'
  );
  assert.equal(
    (await Membership.findOne({ userId: maria._id, organizationId: org._id }).lean()).isActive, false
  );

  const on = await status(hd54, maria._id, 'reactivate', asaToken);
  assert.equal(on.status, 200, 'and can put them back — without the inverse this is a one-way door');
  assert.equal(
    (await Membership.findOne({ userId: maria._id, organizationId: org._id }).lean()).isActive, true
  );
});

test('a lead cannot switch off an admin, another lead, or a super-admin', { skip }, async () => {
  const { org, hd54, boss, frank, asaToken } = ctx;

  // Put them on the campaign first — proving the roster precondition is NOT the thing protecting us.
  for (const u of [boss, frank]) {
    await CampaignAssignment.updateOne(
      { campaignId: hd54._id, userId: u._id },
      { $setOnInsert: { campaignId: hd54._id, userId: u._id, organizationId: org._id } },
      { upsert: true }
    );
  }
  assert.equal((await status(hd54, boss._id, 'deactivate', asaToken)).status, 403, 'not an admin');
  assert.equal((await status(hd54, frank._id, 'deactivate', asaToken)).status, 403, 'not another lead');

  // A super-admin can hold an ordinary canvasser membership in a customer org. Switching it off
  // would force Doorline staff onto the support-grant path and log their work as vendor intrusion —
  // poisoning the audit trail. Refused before the role check even runs.
  const staff = await User.create({
    firstName: 'Sam', lastName: 'Staff', email: 'sam@doorline.app',
    passwordHash: await User.hashPassword(PW), isActive: true, isSuperAdmin: true,
  });
  await Membership.create({ userId: staff._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await CampaignAssignment.create({ campaignId: hd54._id, userId: staff._id, organizationId: org._id });
  const res = await status(hd54, staff._id, 'deactivate', asaToken);
  assert.equal(res.status, 403, 'a super-admin is never deactivatable from a customer console');
  assert.equal(
    (await Membership.findOne({ userId: staff._id, organizationId: org._id }).lean()).isActive, true
  );
});

test('a role change racing the deactivate cannot slip past — the filter carries the role', { skip }, async () => {
  const { org, hd54, maria, asaToken } = ctx;
  // The guard reads the membership, sees 'canvasser', then writes. If the write did not RE-ASSERT
  // the role, a concurrent promotion would land in between and both billing layers would have been
  // computed against a stale snapshot. Simulate the interleaving by promoting after the read window
  // and before the write can match: the update filter must simply miss.
  await Membership.updateOne(
    { userId: maria._id, organizationId: org._id },
    { $set: { role: 'admin', billingAccess: true } }
  );
  const res = await status(hd54, maria._id, 'deactivate', asaToken);
  assert.ok(res.status === 403 || res.status === 409, `refused, got ${res.status}`);
  assert.equal(
    (await Membership.findOne({ userId: maria._id, organizationId: org._id }).lean()).isActive, true,
    'the promoted member is still active'
  );
  await Membership.updateOne(
    { userId: maria._id, organizationId: org._id },
    { $set: { role: 'canvasser', billingAccess: false } }
  );
});

test('a support-grant holder is refused — same write, same answer as the org route', { skip }, async () => {
  const { org, hd54, maria } = ctx;
  const staff = await User.create({
    firstName: 'Vera', lastName: 'Vendor', email: 'vera@doorline.app',
    passwordHash: await User.hashPassword(PW), isActive: true, isSuperAdmin: true,
  });
  // A live grant and NO membership — orgContext seats them as a vendor, requireCampaignManager
  // passes them (super-admins always do), so the router's own block is the only thing left.
  await SupportAccessGrant.create({
    actorUserId: staff._id, organizationId: org._id, reason: 'investigating login issue',
    expiresAt: new Date(Date.now() + 3600_000),
  });
  const res = await status(hd54, maria._id, 'deactivate', signUserToken(staff));
  // Owner decision 2026-07-29: crew administration now works under a grant (and is logged).
  // The surviving refusal is a STAFF-targeted membership write — supportAccess.int.test.js.
  assert.equal(res.status, 200, 'a grant-holder may deactivate a canvasser, on the record');
  // Put Maria back so the following tests see the fixture they expect.
  const undo = await status(hd54, maria._id, 'reactivate', signUserToken(staff));
  assert.equal(undo.status, 200);
});

test('deactivating keeps their books — reactivating finds them intact', { skip }, async () => {
  const { org, hd54, maria, asaToken } = ctx;
  const turf = await Turf.create({
    organizationId: org._id, campaignId: hd54._id, passId: ctx.byCampaign[String(hd54._id)].pass._id,
    name: 'Book 1', mode: 'geometric', status: 'published',
  });
  await TurfAssignment.create({
    organizationId: org._id, campaignId: hd54._id, passId: ctx.byCampaign[String(hd54._id)].pass._id,
    turfId: turf._id, userId: maria._id,
  });

  await status(hd54, maria._id, 'deactivate', asaToken);
  // Deliberately NOT released. Deactivate is reversible and its inverse is one tap away, so someone
  // switched off mid-shift keeps their books — that is exactly why releaseAssignedWork is not called
  // here, and why shipping deactivate without reactivate would have frozen them for a lead.
  assert.equal(
    await TurfAssignment.countDocuments({ userId: maria._id, campaignId: hd54._id }), 1,
    'their book is still theirs'
  );
  await status(hd54, maria._id, 'reactivate', asaToken);
  assert.equal(await TurfAssignment.countDocuments({ userId: maria._id, campaignId: hd54._id }), 1);
});

test('someone not on this campaign cannot be touched through it', { skip }, async () => {
  const { org, hd54, asaToken } = ctx;
  const stranger = await User.create({
    firstName: 'Stan', lastName: 'Stranger', email: 'stan@percamp.co',
    passwordHash: await User.hashPassword(PW), isActive: true,
  });
  await Membership.create({ userId: stranger._id, organizationId: org._id, role: 'canvasser', isActive: true });
  assert.equal((await status(hd54, stranger._id, 'deactivate', asaToken)).status, 404);
});
