import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The per-canvasser report drills answer only for people this request may see, over the REAL
// Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/userscope node --test test/reportsUserScope.int.test.js
//
// /canvassers/:userId/summary and /responses used to look the account up by id alone, so any admin
// or team lead who held another organization's user id got that person's name, email, phone and
// last sign-in back. The canvasser CSV's ?coordinatorId= stamp named any account the same way. Now
// every /canvassers/:userId drill checks, on the param:
//   - an org admin: orgCarriesUser (a membership here in any status, or this person's own non-desk
//     knocks or surveys on this org's ledger);
//   - a team lead, who can be the paying client: campaignsCarryUser (on a campaign the lead manages,
//     the same wall as the Users list).
// Anyone else gets the same 404 as an id that doesn't exist, and the crew stamp names only a
// coordinator the request may see or one stamped on the export's own scope.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-user-scope';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { Effort } = await import('../src/models/Effort.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const PIN = { lng: -84.5, lat: 38.0 };

const DRILLS = ['summary', 'responses', 'daily', 'activities', 'households', 'voters', 'notes', 'path', 'quality', 'export.csv'];

function person(first, last, email, extra = {}) {
  return { firstName: first, lastName: last, email, phone: '+15025550100', passwordHash: 'x', isActive: true, ...extra };
}

function hh(orgId, campaignId, effortId, n) {
  return {
    organizationId: orgId,
    campaignId,
    effortId,
    addressLine1: `${n} Scope St`,
    city: 'Town',
    state: 'KY',
    zipCode: '40202',
    normalizedAddress: `${n} SCOPE ST|TOWN|KY|40202`,
    location: { type: 'Point', coordinates: [PIN.lng, PIN.lat] },
    isActive: true,
    status: 'unknocked',
  };
}

function knock(orgId, campaignId, home, userId, extra = {}) {
  return {
    organizationId: orgId,
    campaignId,
    householdId: home._id,
    userId,
    actionType: 'not_home',
    timestamp: new Date(Date.now() - 2 * 3600e3),
    location: { lat: PIN.lat, lng: PIN.lng, accuracy: 5 },
    distanceFromHouseMeters: 5,
    ...extra,
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignManager, CampaignAssignment, Effort, Household, CanvassActivity, SurveyResponse, Subscription]) {
    await M.deleteMany({});
  }

  const orgA = await Organization.create({ name: 'Acme Field', slug: 'acme-field', isActive: true });
  const orgB = await Organization.create({ name: 'Rival Org', slug: 'rival-org', isActive: true });
  await Subscription.create({ organizationId: orgA._id, status: 'internal' });
  await Subscription.create({ organizationId: orgB._id, status: 'internal' });

  const admin = await User.create(person('Ada', 'Admin', 'scope-admin@t.co'));
  const lead = await User.create(person('Lee', 'Lead', 'scope-lead@t.co'));
  const canv = await User.create(person('Cal', 'Walker', 'scope-cal@t.co')); // member of A, rostered on A1, knocks there
  const former = await User.create(person('Fay', 'Former', 'scope-fay@t.co', { lastLoginAt: new Date() })); // removed from A, knocks in A1
  const surveyOnly = await User.create(person('Sue', 'Surveys', 'scope-sue@t.co')); // removed from A, only a survey in A1
  const dormant = await User.create(person('Dee', 'Dormant', 'scope-dee@t.co')); // deactivated member of A
  const coord = await User.create(person('Kim', 'Crewlead', 'scope-kim@t.co')); // member of A, runs Cal's crew
  const departed = await User.create(person('Dana', 'Gone', 'scope-dana@t.co')); // not a member now, stamped on A1's doors
  const zed = await User.create(person('Zed', 'Othercampaign', 'scope-zed@t.co')); // member of A, only on A2 (not the lead's)
  const pia = await User.create(person('Pia', 'Secondcampaign', 'scope-pia@t.co')); // member of A, only on A3 (the lead's other campaign)
  const staff = await User.create(person('Sam', 'Staffer', 'scope-staff@doorline.test', { isSuperAdmin: true })); // desk marks in A, no membership
  const rival = await User.create(person('Xena', 'Elsewhere', 'scope-xena@t.co')); // member of B only
  const rivalGone = await User.create(
    person('Deleted', 'user', `deleted+${new mongoose.Types.ObjectId()}@deleted.doorline.invalid`, {
      isActive: false,
      deletedAt: new Date(),
    })
  ); // a deleted account that belonged to B

  await Membership.create({ userId: admin._id, organizationId: orgA._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: orgA._id, role: 'lead', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: orgA._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: dormant._id, organizationId: orgA._id, role: 'canvasser', isActive: false });
  await Membership.create({ userId: coord._id, organizationId: orgA._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: zed._id, organizationId: orgA._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: pia._id, organizationId: orgA._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: rival._id, organizationId: orgB._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: rivalGone._id, organizationId: orgB._id, role: 'canvasser', isActive: false });

  const campaign = (org, name) => Campaign.create({ organizationId: org._id, name, type: 'survey', state: 'KY', isActive: true });
  const campA = await campaign(orgA, 'Scope A1');
  const campA2 = await campaign(orgA, 'Scope A2');
  const campA3 = await campaign(orgA, 'Scope A3');
  const campB = await campaign(orgB, 'Scope B');
  const effA = await Effort.create({ organizationId: orgA._id, campaignId: campA._id, name: 'EA' });
  const effA2 = await Effort.create({ organizationId: orgA._id, campaignId: campA2._id, name: 'EA2' });
  const effB = await Effort.create({ organizationId: orgB._id, campaignId: campB._id, name: 'EB' });

  // The lead manages A1 and A3, not A2.
  await CampaignManager.create({ organizationId: orgA._id, campaignId: campA._id, userId: lead._id });
  await CampaignManager.create({ organizationId: orgA._id, campaignId: campA3._id, userId: lead._id });
  await CampaignAssignment.create({ organizationId: orgA._id, campaignId: campA._id, userId: canv._id });
  await CampaignAssignment.create({ organizationId: orgA._id, campaignId: campA2._id, userId: zed._id });
  await CampaignAssignment.create({ organizationId: orgA._id, campaignId: campA3._id, userId: pia._id });

  const [h1, h2, h3, h4] = await Household.insertMany([
    hh(orgA._id, campA._id, effA._id, 1),
    hh(orgA._id, campA._id, effA._id, 2),
    hh(orgB._id, campB._id, effB._id, 3),
    hh(orgA._id, campA2._id, effA2._id, 4),
  ]);
  const hoursAgo = (h) => new Date(Date.now() - h * 3600e3);
  await CanvassActivity.insertMany([
    knock(orgA._id, campA._id, h1, canv._id, { coordinatorId: coord._id }),
    knock(orgA._id, campA._id, h2, canv._id, { coordinatorId: departed._id, timestamp: hoursAgo(3) }),
    knock(orgA._id, campA._id, h1, former._id, { timestamp: hoursAgo(4) }),
    knock(orgA._id, campA2._id, h4, zed._id, { timestamp: hoursAgo(4.5) }),
    knock(orgA._id, campA._id, h2, staff._id, { actionType: 'restricted', via: 'bulk', timestamp: hoursAgo(4.8) }),
    knock(orgB._id, campB._id, h3, rival._id),
    knock(orgB._id, campB._id, h3, rivalGone._id, { timestamp: hoursAgo(5) }),
  ]);
  await SurveyResponse.create({
    organizationId: orgA._id,
    campaignId: campA._id,
    voterId: new mongoose.Types.ObjectId(),
    householdId: h1._id,
    userId: surveyOnly._id,
    surveyTemplateId: new mongoose.Types.ObjectId(),
    surveyTemplateVersion: 1,
    answers: [],
    location: { lat: PIN.lat, lng: PIN.lng },
    submittedAt: hoursAgo(6),
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    orgA,
    campA,
    admin,
    canv,
    former,
    surveyOnly,
    dormant,
    coord,
    departed,
    zed,
    pia,
    staff,
    rival,
    rivalGone,
    adminTok: signUserToken(admin),
    leadTok: signUserToken(lead),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(tok, path) {
  const res = await fetch(`${base}/api${path}`, {
    headers: { Authorization: `Bearer ${tok}`, 'X-Org-Id': String(ctx.orgA._id) },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // CSV routes answer text
  }
  return { status: res.status, json, text };
}

const drill = (userId, which) => `/admin/reports/canvassers/${userId}/${which}?campaignId=${ctx.campA._id}`;

// Every drill answers this person with the same 404 as an id that has no account at all.
async function assertHiddenEverywhere(tok, userId, who, mustNotContain) {
  const ghost = await call(tok, drill(new mongoose.Types.ObjectId(), 'summary'));
  assert.strictEqual(ghost.status, 404, 'an id with no account is a 404');
  for (const which of DRILLS) {
    const res = await call(tok, drill(userId, which));
    assert.strictEqual(res.status, 404, `${who}, ${which}: a 404`);
    assert.deepStrictEqual(res.json, ghost.json, `${who}, ${which}: indistinguishable from an id that doesn't exist`);
    for (const s of mustNotContain) assert.ok(!res.text.includes(s), `${who}, ${which}: nothing of theirs in the body`);
  }
}

test('another organization\'s people: every drill answers 404, exactly like an id that does not exist', { skip }, async () => {
  await assertHiddenEverywhere(ctx.adminTok, ctx.rival._id, 'admin → another org\'s member', ['Xena', 'scope-xena']);
  await assertHiddenEverywhere(ctx.adminTok, ctx.rivalGone._id, 'admin → another org\'s deleted account', ['deleted.doorline.invalid']);
});

test('a team lead, who can be the paying client, sees only people on campaigns they manage', { skip }, async () => {
  await assertHiddenEverywhere(ctx.leadTok, ctx.rival._id, 'lead → another org\'s member', ['Xena', 'scope-xena']);
  await assertHiddenEverywhere(ctx.leadTok, ctx.zed._id, 'lead → a member on a campaign they don\'t manage', ['Zed', 'scope-zed']);
  await assertHiddenEverywhere(ctx.leadTok, ctx.admin._id, 'lead → an org admin on none of their campaigns', ['Ada', 'scope-admin']);

  const own = await call(ctx.leadTok, drill(ctx.canv._id, 'summary'));
  assert.strictEqual(own.status, 200, 'their own walker resolves');
  assert.strictEqual(own.json.user.firstName, 'Cal');

  // The phone's Users hub opens people from the lead's OTHER campaigns with the selected campaign's
  // id, so "on a managed campaign" has to mean any of them, not just ?campaignId.
  const otherManaged = await call(ctx.leadTok, drill(ctx.pia._id, 'summary'));
  assert.strictEqual(otherManaged.status, 200, 'someone on the lead\'s other campaign still resolves');
  assert.strictEqual(otherManaged.json.user.firstName, 'Pia');

  // An admin is not walled the same way: Zed is in the org.
  const adminSeesZed = await call(ctx.adminTok, drill(ctx.zed._id, 'summary'));
  assert.strictEqual(adminSeesZed.status, 200);
});

test('this org\'s people still resolve: members in any status, and people carried only by their own work here', { skip }, async () => {
  const member = await call(ctx.adminTok, drill(ctx.canv._id, 'summary'));
  assert.strictEqual(member.status, 200);
  assert.strictEqual(member.json.user.email, 'scope-cal@t.co');

  const responses = await call(ctx.adminTok, drill(ctx.canv._id, 'responses'));
  assert.strictEqual(responses.status, 200);
  assert.strictEqual(responses.json.user.lastName, 'Walker');

  const deactivated = await call(ctx.adminTok, drill(ctx.dormant._id, 'summary'));
  assert.strictEqual(deactivated.status, 200, 'a deactivated membership still counts');

  const formerMember = await call(ctx.adminTok, drill(ctx.former._id, 'summary'));
  assert.strictEqual(formerMember.status, 200, 'removal hard-deletes the membership; the ledger still carries her');
  assert.strictEqual(formerMember.json.user.firstName, 'Fay');
  assert.strictEqual(formerMember.json.user.lastLoginAt, null, 'but her sign-in clock is no longer this org\'s to read');

  const surveysOnly = await call(ctx.adminTok, drill(ctx.surveyOnly._id, 'summary'));
  assert.strictEqual(surveysOnly.status, 200, 'a survey alone carries someone too');
  const surveysOnlyResponses = await call(ctx.adminTok, drill(ctx.surveyOnly._id, 'responses'));
  assert.strictEqual(surveysOnlyResponses.status, 200);
  assert.strictEqual(surveysOnlyResponses.json.total, 1);
});

test('desk marks never carry anyone: a staffer who marked doors under a grant stays hidden', { skip }, async () => {
  await assertHiddenEverywhere(ctx.adminTok, ctx.staff._id, 'admin → a staffer with only desk marks here', ['Staffer', 'scope-staff']);
});

test('the canvasser CSV\'s crew stamp names only a coordinator the request may see', { skip }, async () => {
  const csv = (tok, coordinatorId) =>
    call(tok, `/admin/reports/canvassers.csv?campaignId=${ctx.campA._id}&coordinatorId=${coordinatorId}`);

  const foreign = await csv(ctx.adminTok, ctx.rival._id);
  assert.strictEqual(foreign.status, 200);
  assert.ok(foreign.text.includes('Crew: unknown coordinator'), 'another org\'s id prints as unknown');
  assert.ok(!foreign.text.includes('Xena'), 'and never as her name');

  const member = await csv(ctx.adminTok, ctx.coord._id);
  assert.ok(member.text.includes('Crew: Kim Crewlead'), 'a member coordinator is named');

  const departed = await csv(ctx.adminTok, ctx.departed._id);
  assert.ok(departed.text.includes('Crew: Dana Gone'), 'a departed coordinator stamped on this org\'s doors is still named');

  const leadAdmin = await csv(ctx.leadTok, ctx.admin._id);
  assert.ok(leadAdmin.text.includes('Crew: unknown coordinator'), 'for a lead, someone off their campaigns prints as unknown');
  assert.ok(!leadAdmin.text.includes('Ada'), 'and never as their name');

  const leadCoord = await csv(ctx.leadTok, ctx.coord._id);
  assert.ok(leadCoord.text.includes('Crew: Kim Crewlead'), 'a coordinator stamped on the lead\'s own campaign is named');
});

test('a malformed id is still the route\'s own 400', { skip }, async () => {
  const res = await call(ctx.adminTok, drill('not-an-id', 'summary'));
  assert.strictEqual(res.status, 400);
});
