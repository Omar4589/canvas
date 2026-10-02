import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The per-round CANVASSER VIEW contract, over the real app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/perround node --test test/perRoundVoterView.int.test.js
//
// A follow-up round presents previously-worked doors FRESH — and that must hold at the
// VOTER level too, not just the door pin. The wire (bootstrap + /changes) rewrites
// three things per-round, scoped to the round of the canvasser's assigned book:
//   household.status      — per-round (was already; pinned here)
//   household.lastActionAt — per-round (a round-fresh door shows NO "Last visit")
//   voter.surveyStatus    — per-round ('surveyed' = surveyed in THIS round), so a
//                           pass-1 supporter presents "Take survey", not "Re-survey",
//                           and the badge can't invite a knock-free "confirmation"
// while the STORED fields stay campaign-global for admin/reports.
//
// Also pinned: GET /mobile/voters/:voterId (the full profile with cross-round answers,
// raw DOB, phone) is MANAGEMENT-ONLY — the authorization gap PRIVACY_VERIFICATION.md
// recorded against this route is closed: canvasser 403, lead-with-grant 200,
// lead-on-wrong-campaign 403, admin 200. Since 2026-10-01 a lead's profile is NARROWED to
// the campaign (otherCampaigns empty, this campaign's surveys and notes only — the scope the
// web campaign profile applies too) while an admin's keeps the org-wide union; the
// wrong-campaign 403 carries code VOTER_NOT_IN_CAMPAIGN, never FORBIDDEN_ROLE; and the
// manager search list rides Voter.campaignId (no more $in of every household id of the
// campaign) — the same rows, pinned row for row.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-perround';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { VoterNote } = await import('../src/models/VoterNote.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

async function call(path, token, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Org-Id': String(ctx.org._id),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const P1_AT = new Date('2026-06-10T15:00:00Z');
const P2_AT = new Date('2026-07-20T16:00:00Z');

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, CampaignAssignment,
    CampaignManager, Effort, Pass, Turf, TurfAssignment, Household, Voter, CanvassActivity,
    SurveyResponse, SurveyTemplate, VoterNote]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Round View Org', slug: 'round-view', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({
    firstName: 'Ada', lastName: 'Admin', email: 'rv-admin@t.co', passwordHash: 'x', isActive: true,
  });
  const canv = await User.create({
    firstName: 'Cal', lastName: 'Canvasser', email: 'rv-canv@t.co', passwordHash: 'x', isActive: true,
  });
  const lead = await User.create({
    firstName: 'Lea', lastName: 'Lead', email: 'rv-lead@t.co', passwordHash: 'x', isActive: true,
  });
  // Granted the campaign but NEVER rostered as a walker — the common real-world lead.
  const lead2 = await User.create({
    firstName: 'Uma', lastName: 'Unrostered', email: 'rv-lead2@t.co', passwordHash: 'x', isActive: true,
  });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: lead2._id, organizationId: org._id, role: 'lead', isActive: true });

  const template = await SurveyTemplate.create({
    organizationId: org._id,
    name: 'Support ask',
    version: 1,
    questions: [
      {
        key: 'support',
        label: 'Can we count on your support?',
        type: 'single_choice',
        order: 0,
        options: [
          { id: 'opt_yes', text: 'Support', order: 0 },
          { id: 'opt_no', text: 'Opposed', order: 1 },
        ],
      },
    ],
  });

  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Round View', type: 'survey', state: 'FL',
    isActive: true, timeZone: 'America/New_York', surveyTemplateId: template._id,
  });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'North' });
  const p1 = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'Round 1', status: 'archived',
  });
  const p2 = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 2, name: 'Round 2', status: 'active',
  });

  // Three doors, one per contract edge. Stored statuses are the GLOBAL values an
  // admin sees; the wire must override them per-round.
  //   H1: surveyed in ROUND 1 only → wire: unknocked, no last visit, voter fresh
  //   H2: surveyed in ROUND 2 (the active round) → wire: surveyed + last visit,
  //       voter 'surveyed' (the legitimate same-round Re-survey case)
  //   H3: never touched → fresh either way
  const mk = (n, extra = {}) => ({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: `${n} Round St`, city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: `${n} ROUND ST|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.4 + n * 0.001, 28.3] },
    ...extra,
  });
  const [h1, h2, h3] = await Household.insertMany([
    mk(1, { status: 'surveyed', lastActionAt: P1_AT }),
    mk(2, { status: 'surveyed', lastActionAt: P2_AT }),
    mk(3),
  ]);

  const voter = (home, n, extra = {}) => Voter.create({
    organizationId: org._id, campaignId: campaign._id, householdId: home._id,
    stateVoterId: `RV${n}`, firstName: `V${n}`, lastName: 'Test', fullName: `V${n} Test`,
    ...extra,
  });
  const vA = await voter(h1, 1, { surveyStatus: 'surveyed' }); // surveyed in p1 → stored global stays 'surveyed'
  const vB = await voter(h2, 2, { surveyStatus: 'surveyed' }); // surveyed in p2 (this round)
  const vC = await voter(h3, 3); // never surveyed
  // A fourth door of the campaign that sits in NO book: the manager search lists its voter
  // (campaign scope) and the canvasser search does not (book scope) — tests 4 and 5.
  const [h4] = await Household.insertMany([mk(4)]);
  const vD = await voter(h4, 4);

  const knock = (home, pass, at) => CanvassActivity.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: pass._id,
    householdId: home._id, userId: canv._id, actionType: 'survey_submitted',
    timestamp: at, location: { lat: 28.3, lng: -81.4 },
  });
  const respond = (v, home, pass, at) => SurveyResponse.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: pass._id,
    householdId: home._id, voterId: v._id, userId: canv._id,
    surveyTemplateId: template._id, surveyTemplateVersion: 1,
    location: { lat: 28.3, lng: -81.4 }, submittedAt: at,
    answers: [{ questionKey: 'support', questionLabel: 'Can we count on your support?', answer: 'Support', optionIds: ['opt_yes'] }],
  });
  await knock(h1, p1, P1_AT);
  await respond(vA, h1, p1, P1_AT);
  await knock(h2, p2, P2_AT);
  await respond(vB, h2, p2, P2_AT);

  // The canvasser's assigned book on the ACTIVE round covers all three doors.
  const book = await Turf.create({
    organizationId: org._id, campaignId: campaign._id, passId: p2._id,
    name: 'Book 1', mode: 'geometric', status: 'published',
    householdIds: [h1._id, h2._id, h3._id], doorCount: 3,
  });
  await TurfAssignment.create({
    turfId: book._id, userId: canv._id, organizationId: org._id,
    campaignId: campaign._id, passId: p2._id,
  });
  for (const u of [canv, lead]) {
    await CampaignAssignment.create({ campaignId: campaign._id, userId: u._id, organizationId: org._id });
  }
  // The lead's management grant covers THIS campaign. lead2 holds the same grant but
  // NO CampaignAssignment — the roster gate must fall through to the grant for them.
  await CampaignManager.create({ campaignId: campaign._id, userId: lead._id, organizationId: org._id });
  await CampaignManager.create({ campaignId: campaign._id, userId: lead2._id, organizationId: org._id });

  // A SECOND campaign the lead has NO grant for — its voter must stay unreachable
  // through the first campaign's grant (the no-widening rule).
  const campaign2 = await Campaign.create({
    organizationId: org._id, name: 'Other Race', type: 'survey', state: 'FL',
    isActive: true, timeZone: 'America/New_York', surveyTemplateId: template._id,
  });
  const h9 = await Household.create({
    organizationId: org._id, campaignId: campaign2._id,
    addressLine1: '9 Other St', city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: '9 OTHER ST|TOWN|FL|34741',
    location: { type: 'Point', coordinates: [-81.5, 28.35] },
  });
  const v9 = await Voter.create({
    organizationId: org._id, campaignId: campaign2._id, householdId: h9._id,
    stateVoterId: 'RV9', firstName: 'V9', lastName: 'Test', fullName: 'V9 Test',
  });
  // vA's SIBLING: the same person (svid RV1) as campaign2's row, with a survey and an admin
  // note of its own there — the cross-campaign history an admin's profile unions and a lead's
  // must not (test 3). Its door is campaign2's, so no canvasser wire of `campaign` sees it.
  const vA2 = await Voter.create({
    organizationId: org._id, campaignId: campaign2._id, householdId: h9._id,
    stateVoterId: 'RV1', firstName: 'V1', lastName: 'Test', fullName: 'V1 Test', surveyStatus: 'surveyed',
  });
  await SurveyResponse.create({
    organizationId: org._id, campaignId: campaign2._id, householdId: h9._id, voterId: vA2._id, userId: canv._id,
    surveyTemplateId: template._id, surveyTemplateVersion: 1,
    location: { lat: 28.35, lng: -81.5 }, submittedAt: P2_AT,
    answers: [{ questionKey: 'support', questionLabel: 'Can we count on your support?', answer: 'Opposed', optionIds: ['opt_no'] }],
  });
  await VoterNote.create([
    { organizationId: org._id, voterId: vA._id, authorId: admin._id, body: 'Note in Round View' },
    { organizationId: org._id, voterId: vA2._id, authorId: admin._id, body: 'Note in Other Race' },
  ]);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, canv, lead, lead2, campaign, campaign2, effort, p1, p2,
    h1, h2, h3, h4, vA, vB, vC, vD, vA2, v9,
    adminToken: signUserToken(admin), canvToken: signUserToken(canv), leadToken: signUserToken(lead),
    lead2Token: signUserToken(lead2),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('1. bootstrap: doors AND voters present per-round fresh; stored globals untouched', { skip }, async () => {
  const { campaign, h1, h2, h3, vA, vB, vC, canvToken } = ctx;
  const r = await call(`/mobile/bootstrap?campaignId=${campaign._id}`, canvToken);
  assert.equal(r.status, 200);

  const hh = new Map(r.json.households.map((h) => [String(h._id), h]));
  // H1 was surveyed in ROUND 1 — this round it is fresh, with NO last-visit tell.
  assert.equal(hh.get(String(h1._id)).status, 'unknocked', 'pass-1 surveyed door reads fresh');
  assert.equal(hh.get(String(h1._id)).lastActionAt, null, 'no "Last visit 3 weeks ago" on a round-fresh door');
  // H2 was surveyed THIS round — done, with its real last visit.
  assert.equal(hh.get(String(h2._id)).status, 'surveyed');
  assert.equal(new Date(hh.get(String(h2._id)).lastActionAt).getTime(), P2_AT.getTime());
  assert.equal(hh.get(String(h3._id)).status, 'unknocked');

  const vv = new Map(r.json.voters.map((v) => [String(v._id), v]));
  // THE voter-level contract: pass-1-surveyed voter presents fresh ("Take survey",
  // no badge); this-round-surveyed voter reads surveyed (the legit Re-survey case).
  assert.equal(vv.get(String(vA._id)).surveyStatus, 'not_surveyed', 'pass-1 voter is fresh in pass 2');
  assert.equal(vv.get(String(vB._id)).surveyStatus, 'surveyed', 'same-round voter keeps Re-survey');
  assert.equal(vv.get(String(vC._id)).surveyStatus, 'not_surveyed');

  // The smart-confirm flag: present ONLY on per-round-surveyed voters; true = my own survey.
  assert.equal(vv.get(String(vB._id)).surveyedByMe, true, 'own survey this round → surveyedByMe true');
  assert.ok(!('surveyedByMe' in vv.get(String(vA._id))), 'round-fresh voter carries no flag');
  assert.ok(!('surveyedByMe' in vv.get(String(vC._id))), 'never-surveyed voter carries no flag');

  // The wire rewrite must never touch the stored campaign-global fields.
  const storedA = await Voter.findById(vA._id, { surveyStatus: 1 }).lean();
  assert.equal(storedA.surveyStatus, 'surveyed', 'stored Voter.surveyStatus stays global (admin/reports)');
  const storedH1 = await Household.findById(h1._id, { status: 1, lastActionAt: 1 }).lean();
  assert.equal(storedH1.status, 'surveyed', 'stored Household.status stays global');
  assert.equal(new Date(storedH1.lastActionAt).getTime(), P1_AT.getTime());
});

test('2. /changes delta applies the identical per-round rewrite (no global leak-back)', { skip }, async () => {
  const { campaign, h1, h2, vA, vB, canvToken } = ctx;
  const r = await call(
    `/mobile/changes?campaignId=${campaign._id}&since=${encodeURIComponent('1970-01-01T00:00:00Z')}`,
    canvToken
  );
  assert.equal(r.status, 200);

  const hh = new Map(r.json.households.map((h) => [String(h._id), h]));
  assert.equal(hh.get(String(h1._id)).status, 'unknocked', 'delta cannot re-introduce the global status');
  assert.equal(hh.get(String(h1._id)).lastActionAt, null, 'nor the prior round\'s last visit');
  assert.equal(hh.get(String(h2._id)).status, 'surveyed');

  const vv = new Map(r.json.voters.map((v) => [String(v._id), v]));
  assert.equal(vv.get(String(vA._id)).surveyStatus, 'not_surveyed', 'delta voter rewrite matches bootstrap');
  assert.equal(vv.get(String(vB._id)).surveyStatus, 'surveyed');
  // The delta ALWAYS carries the flag for surveyed voters — the client spread-merges delta
  // voters whole, so an omitted flag would leave a stale value behind on the phone.
  assert.equal(vv.get(String(vB._id)).surveyedByMe, true, 'delta carries surveyedByMe');
  assert.ok(!('surveyedByMe' in vv.get(String(vA._id))), 'delta: no flag on a round-fresh voter');
});

test("2b. a TEAMMATE's bootstrap reads the same voter as surveyed + surveyedByMe:false", { skip }, async () => {
  const { org, campaign, effort, p2, vB, vA } = ctx;
  // A second canvasser on the SAME book: vB was surveyed this round by Cal, so for this
  // teammate the door must say 'surveyed' AND surveyedByMe:false — the exact pair the
  // smart re-survey confirm keys on (true or absent must never fire it).
  const mate = await User.create({
    firstName: 'May', lastName: 'Mate', email: 'rv-mate@t.co', passwordHash: 'x', isActive: true,
  });
  await Membership.create({ userId: mate._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: campaign._id, userId: mate._id });
  const book = await Turf.findOne({ campaignId: campaign._id, passId: p2._id }).lean();
  await TurfAssignment.create({
    organizationId: org._id, campaignId: campaign._id, passId: p2._id, turfId: book._id, userId: mate._id,
  });

  const r = await call(`/mobile/bootstrap?campaignId=${campaign._id}`, signUserToken(mate));
  assert.equal(r.status, 200);
  const vv = new Map(r.json.voters.map((v) => [String(v._id), v]));
  assert.equal(vv.get(String(vB._id)).surveyStatus, 'surveyed');
  assert.equal(vv.get(String(vB._id)).surveyedByMe, false, "a teammate's survey → surveyedByMe false");
  assert.ok(!('surveyedByMe' in vv.get(String(vA._id))), 'round-fresh voter still carries no flag');
});

test('3. voter profile is management-only: canvasser 403, lead 200 (campaign-scoped), wrong-campaign 403 VOTER_NOT_IN_CAMPAIGN, admin 200 (org-wide)', { skip }, async () => {
  const { campaign, campaign2, vA, vA2, v9, canvToken, leadToken, adminToken } = ctx;

  // The canvasser at the door gets NO cross-round history (answers, DOB, phone).
  const asCanv = await call(`/mobile/voters/${vA._id}?campaignId=${campaign._id}`, canvToken);
  assert.equal(asCanv.status, 403, 'the PRIVACY_VERIFICATION authorization gap is closed');
  assert.equal(asCanv.json.code, 'FORBIDDEN_ROLE');

  // A lead WITH a grant for this campaign sees the full profile, prior answers included —
  // narrowed to THIS campaign (owner ruling 4, 2026-09-30, the scope the web campaign profile
  // applies too): the person's campaign2 row holds a survey and an admin note of its own, and
  // the lead is told about neither; otherCampaigns is empty.
  const asLead = await call(`/mobile/voters/${vA._id}?campaignId=${campaign._id}`, leadToken);
  assert.equal(asLead.status, 200);
  assert.ok(Array.isArray(asLead.json.surveys) && asLead.json.surveys.length >= 1, 'lead sees survey history');
  assert.deepStrictEqual(asLead.json.otherCampaigns, [], 'a lead is never told which other campaigns hold the person');
  assert.strictEqual(asLead.json.surveys.length, 1, 'this campaign\'s survey only');
  assert.ok(asLead.json.surveys.every((s) => s.campaignId === String(campaign._id)), 'every survey is this campaign\'s');
  assert.deepStrictEqual(asLead.json.notes.admin.map((n) => n.body), ['Note in Round View'], 'this campaign\'s admin notes only');

  // The grant is per-campaign: it cannot be used as a skeleton key into another
  // campaign's voters (the lead holds no grant for campaign2).
  const crossGrant = await call(`/mobile/voters/${v9._id}?campaignId=${campaign2._id}`, leadToken);
  assert.equal(crossGrant.status, 403, 'no grant for campaign2 → no profile');
  // And even THROUGH the granted campaign, a foreign-campaign voter is refused — a DOMAIN
  // refusal with its own code, never FORBIDDEN_ROLE (the role is fine; the app answers that
  // code by refetching the role). Still a 403 here: the shipped app inspects 403 codes.
  const crossVoter = await call(`/mobile/voters/${v9._id}?campaignId=${campaign._id}`, leadToken);
  assert.equal(crossVoter.status, 403, 'granted campaign cannot fetch another campaign\'s voter');
  assert.strictEqual(crossVoter.json.code, 'VOTER_NOT_IN_CAMPAIGN');
  assert.notStrictEqual(crossVoter.json.code, 'FORBIDDEN_ROLE');
  // The person's own campaign2 row is no exception: the sibling of a voter the lead CAN read
  // is still another campaign's row.
  const sibling = await call(`/mobile/voters/${vA2._id}?campaignId=${campaign._id}`, leadToken);
  assert.equal(sibling.status, 403, 'the sibling row is out of scope through the granted campaign');
  assert.strictEqual(sibling.json.code, 'VOTER_NOT_IN_CAMPAIGN');

  // Admins stay org-wide, as before (ruling 5): the campaign2 sibling is linked, and its survey
  // and note are unioned into the profile.
  const asAdmin = await call(`/mobile/voters/${vA._id}?campaignId=${campaign._id}`, adminToken);
  assert.equal(asAdmin.status, 200);
  assert.ok(Array.isArray(asAdmin.json.surveys) && asAdmin.json.surveys.length >= 1);
  assert.deepStrictEqual(
    asAdmin.json.otherCampaigns.map((c) => [c.campaignId, c.voterId]),
    [[String(campaign2._id), String(vA2._id)]],
    'admin: the sibling campaign is linked'
  );
  assert.strictEqual(asAdmin.json.surveys.length, 2, 'admin: the union across the person\'s rows');
  assert.deepStrictEqual(asAdmin.json.notes.admin.map((n) => n.body).sort(), ['Note in Other Race', 'Note in Round View'], 'admin: both notes');

  // A manager's note goes through the campaign they resolved, the same way: this campaign's
  // row lands, another campaign's is the same domain refusal and writes nothing.
  const ownNote = await call(`/mobile/voters/${vA._id}/notes?campaignId=${campaign._id}`, leadToken, { method: 'POST', body: { body: 'Lead note' } });
  assert.equal(ownNote.status, 201, 'a note on this campaign\'s row lands');
  const crossNote = await call(`/mobile/voters/${v9._id}/notes?campaignId=${campaign._id}`, leadToken, { method: 'POST', body: { body: 'nope' } });
  assert.equal(crossNote.status, 403);
  assert.strictEqual(crossNote.json.code, 'VOTER_NOT_IN_CAMPAIGN');
  assert.ok(!(await VoterNote.exists({ voterId: v9._id })), 'and nothing was written');
  // An org admin is org-wide on mobile as on the web (ruling 5): the same cross-campaign note lands.
  const adminCross = await call(`/mobile/voters/${v9._id}/notes?campaignId=${campaign._id}`, adminToken, { method: 'POST', body: { body: 'Admin note across campaigns' } });
  assert.equal(adminCross.status, 201, 'an org admin may annotate any voter in the org');
  assert.ok(await VoterNote.exists({ voterId: v9._id, body: 'Admin note across campaigns' }), 'and it was written');
});

test('4. the canvasser search list still works (scoped, unchanged)', { skip }, async () => {
  const { campaign, vA, vB, vC, canvToken } = ctx;
  // The list endpoint keeps its book-scope behavior — it ships identity + status
  // booleans only (no answers), so it is not part of the profile gate.
  const r = await call(`/mobile/voters?campaignId=${campaign._id}&search=Test`, canvToken);
  assert.equal(r.status, 200);
  assert.ok(r.json.voters.length >= 3, 'canvasser still finds their book\'s voters');
  assert.ok(r.json.voters.every((v) => v.fullName && !('answers' in v)), 'no answer content in the list');
  // Exactly the book's voters, in name order: the campaign's fourth door (h4 / vD) is in no
  // book, so it is not theirs — book scope, not campaign scope. The address search narrows the
  // same way ('Round St' is every door of the campaign; the canvasser gets their three).
  const bookIds = [String(vA._id), String(vB._id), String(vC._id)];
  assert.deepStrictEqual(r.json.voters.map((v) => v.id), bookIds, 'the book\'s three voters and nobody else');
  const byAddress = await call(`/mobile/voters?campaignId=${campaign._id}&search=Round`, canvToken);
  assert.equal(byAddress.status, 200);
  assert.deepStrictEqual(byAddress.json.voters.map((v) => v.id), bookIds, 'the address search stays book-scoped');
});

test('5. a granted lead needs NO roster row, and searches campaign-wide (manager scope)', { skip }, async () => {
  const { campaign, campaign2, vA, vB, vC, vD, lead2Token, leadToken } = ctx;
  // Unrostered-but-granted: both routes pass on the grant alone. This is the common
  // real-world lead — they manage the campaign, nobody rostered them as a walker.
  const search = await call(`/mobile/voters?campaignId=${campaign._id}&search=Test`, lead2Token);
  assert.equal(search.status, 200, 'unrostered lead passes the campaign gate');
  assert.ok(search.json.voters.length >= 3, 'and sees the whole campaign, not empty books');
  // The whole campaign, exactly: every row of it — the unbooked fourth door included — and NOT
  // the person's campaign2 row (vA2 is a 'V1 Test' too). The filter rides Voter.campaignId now
  // instead of a $in of every household id of the campaign; the rows are the same ones.
  const campaignIds = [String(vA._id), String(vB._id), String(vC._id), String(vD._id)];
  assert.deepStrictEqual(search.json.voters.map((v) => v.id), campaignIds, 'manager scope is the campaign, row for row');
  const byAddress = await call(`/mobile/voters?campaignId=${campaign._id}&search=Round`, lead2Token);
  assert.deepStrictEqual(byAddress.json.voters.map((v) => v.id), campaignIds, 'the address match covers every door of the campaign');
  const foreignDoor = await call(`/mobile/voters?campaignId=${campaign._id}&search=Other`, lead2Token);
  assert.deepStrictEqual(foreignDoor.json.voters, [], 'and never another campaign\'s door (9 Other St is campaign2\'s)');
  const profile = await call(`/mobile/voters/${vA._id}?campaignId=${campaign._id}`, lead2Token);
  assert.equal(profile.status, 200, 'unrostered lead reads the profile (management-only route)');

  // Rostered lead: same campaign-wide search — manager scope, never book-scope. They
  // hold no TurfAssignment, so book-scoping would have returned an empty list.
  const rostered = await call(`/mobile/voters?campaignId=${campaign._id}&search=Test`, leadToken);
  assert.equal(rostered.status, 200);
  assert.ok(rostered.json.voters.length >= 3, 'rostered lead is not book-scoped into "no voters"');

  // The grant does not widen: the ungranted campaign still refuses both routes.
  const foreign = await call(`/mobile/voters?campaignId=${campaign2._id}&search=Test`, lead2Token);
  assert.equal(foreign.status, 403, 'no grant, no roster → no search');
});
