import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// THE multi-pass counting contract, over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/multipass node --test test/multiPassUnits.int.test.js
//
// Surveys are stored one row per voter PER ROUND (the unique {voterId, passId} index). In a
// SINGLE-round campaign that makes a distinct-voter count and a raw row count numerically
// IDENTICAL — which is why every "voters surveyed" surface in the app agreed for months while
// computing different things. This file exists because only a TWO-round fixture can tell them
// apart, and it asserts all four units at once for the same voter:
//
//   knocks        -> 2   (household, pass)      — two visits, two billable doors
//   survey doors  -> 2   (household, pass)      — two surveys, taken at two different times
//   voters surveyed -> 1 (distinct voterId)     — we surveyed ONE person
//   option counts -> 2   (per response row)     — we handed out TWO yard signs
//
// Three different units, all deliberately correct. The bug class this guards is a surface whose
// LABEL claims one unit while its query computes another.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-multipass';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { recomputeCampaignStats } = await import('../src/services/reports/campaignCounters.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

async function call(path) {
  const res = await fetch(`${base}/api${path}`, {
    headers: { Authorization: `Bearer ${ctx.token}`, 'X-Org-Id': String(ctx.org._id) },
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, Effort, Pass,
    Household, Voter, CanvassActivity, SurveyResponse, SurveyTemplate]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({
    name: 'Two Round Org', slug: 'two-round', isActive: true,
    // /team-breakdown refuses to answer without this — an unstamped org would read as
    // "every team did nothing", so it returns ready:false rather than mislead.
    teamAttributionReadyAt: new Date(),
  });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({
    firstName: 'Ada', lastName: 'Admin', email: 'mp-admin@t.co', passwordHash: 'x', isActive: true,
  });
  const canv = await User.create({
    firstName: 'Cal', lastName: 'Canvasser', email: 'mp-canv@t.co', passwordHash: 'x', isActive: true,
  });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });

  const template = await SurveyTemplate.create({
    organizationId: org._id,
    name: 'Yard Sign Survey',
    version: 1,
    questions: [
      {
        key: 'yard_sign',
        label: 'Would you like a yard sign?',
        type: 'single_choice',
        order: 0,
        options: [
          { id: 'opt_yes', text: 'Yes', order: 0 },
          { id: 'opt_no', text: 'No', order: 1 },
        ],
      },
    ],
  });

  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Two Round Campaign', type: 'survey', state: 'FL',
    isActive: true, timeZone: 'America/New_York', surveyTemplateId: template._id,
  });
  const effort = await Effort.create({
    organizationId: org._id, campaignId: campaign._id, name: 'North',
  });
  // TWO rounds — the entire point of this fixture.
  const p1 = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'Round 1', status: 'archived',
  });
  const p2 = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 2, name: 'Round 2', status: 'active',
  });

  const homes = await Household.insertMany([1, 2].map((n) => ({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: `${n} Sign St`, city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: `${n} SIGN ST|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.4 + n * 0.001, 28.3] },
  })));
  const maria = await Voter.create({
    organizationId: org._id, campaignId: campaign._id, householdId: homes[0]._id,
    stateVoterId: 'MP1', firstName: 'Maria', lastName: 'Vega', fullName: 'Maria Vega',
  });
  const bob = await Voter.create({
    organizationId: org._id, campaignId: campaign._id, householdId: homes[1]._id,
    stateVoterId: 'MP2', firstName: 'Bob', lastName: 'Reyes', fullName: 'Bob Reyes',
  });

  const knock = (home, pass, at) => CanvassActivity.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: pass._id,
    householdId: home._id, userId: canv._id, actionType: 'survey_submitted',
    timestamp: new Date(at), location: { lat: 28.3, lng: -81.4 },
  });
  const respond = (voter, home, pass, optId, text, at) => SurveyResponse.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: pass._id,
    householdId: home._id, voterId: voter._id, userId: canv._id,
    surveyTemplateId: template._id, surveyTemplateVersion: 1,
    location: { lat: 28.3, lng: -81.4 }, submittedAt: new Date(at),
    answers: [{
      questionKey: 'yard_sign', questionLabel: 'Would you like a yard sign?',
      answer: text, optionIds: [optId],
    }],
  });

  // Maria: surveyed at her door in BOTH rounds, wants a sign BOTH times.
  await knock(homes[0], p1, '2026-06-01T14:00:00Z');
  await respond(maria, homes[0], p1, 'opt_yes', 'Yes', '2026-06-01T14:00:00Z');
  await knock(homes[0], p2, '2026-07-01T14:00:00Z');
  await respond(maria, homes[0], p2, 'opt_yes', 'Yes', '2026-07-01T14:00:00Z');
  // Bob: surveyed once, in round 1, and declines.
  await knock(homes[1], p1, '2026-06-01T15:00:00Z');
  await respond(bob, homes[1], p1, 'opt_no', 'No', '2026-06-01T15:00:00Z');

  // Campaigns are born with stats.reconciledAt stamped, so campaign-rollup's all-time fast path
  // trusts the counters — and these rows were inserted straight into the ledger without the write
  // hooks that maintain them. Recompute, exactly as every rare admin bulk op does.
  await recomputeCampaignStats(campaign._id);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, canv, campaign, effort, p1, p2, template, maria, bob,
    token: signUserToken(admin),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('the same voter across two rounds: 2 knocks, 2 survey doors, 1 voter, 2 signs', { skip }, async () => {
  const { campaign } = ctx;

  // DOOR units — (household, pass). Maria's house counts twice: two visits, two surveys.
  const rollup = await call(`/admin/reports/campaign-rollup?campaignId=${campaign._id}`);
  assert.equal(rollup.status, 200);
  const row = rollup.json.campaigns[0];
  assert.equal(row.knocks, 3, 'h1p1 + h1p2 + h2p1 — the revisit is its own billable door');
  assert.equal(row.surveyedKnocks, 3, 'and its own survey door');

  // VOTER unit — distinct people. Maria is ONE person however many rounds she was surveyed in.
  assert.equal(row.surveyedVoters, 2, 'Maria + Bob — the revisit does NOT add a person');

  // RESPONSE unit — forms filled out.
  assert.equal(row.surveysSubmitted, 3, 'three forms: Maria twice, Bob once');

  // The three units are genuinely different here, which is the whole reason this fixture exists.
  assert.notEqual(row.surveyedVoters, row.surveysSubmitted,
    'distinct-voter and row counts MUST diverge in a two-round campaign — if they match, the ' +
    'fixture stopped exercising the bug this file guards');
});

test('option counts are per RESPONSE — two rounds asking = two yard signs', { skip }, async () => {
  const { campaign } = ctx;
  const res = await call(`/admin/reports/survey-results?campaignId=${campaign._id}`);
  assert.equal(res.status, 200);

  const q = res.json.questions.find((x) => x.key === 'yard_sign');
  const yes = q.options.find((o) => o.option === 'Yes' || o.text === 'Yes');
  const no = q.options.find((o) => o.option === 'No' || o.text === 'No');

  // The owner's rule: "we technically gave out two signs."
  assert.equal(yes.count, 2, 'Maria asked in both rounds — two signs, counted twice');
  assert.equal(no.count, 1, 'Bob declined once');
  assert.equal(res.json.totalResponses, 3, 'three response rows');

  // Deliberately NOT the distinct-voter count: only ONE person wanted a sign.
  assert.notEqual(yes.count, 1, 'a per-voter count here would under-report signs handed out');
});

test('?passId= isolates a round, and the rounds sum to the all-round total', { skip }, async () => {
  const { campaign, p1, p2 } = ctx;

  const all = await call(`/admin/reports/survey-results?campaignId=${campaign._id}`);
  const r1 = await call(`/admin/reports/survey-results?campaignId=${campaign._id}&passId=${p1._id}`);
  const r2 = await call(`/admin/reports/survey-results?campaignId=${campaign._id}&passId=${p2._id}`);
  for (const r of [all, r1, r2]) assert.equal(r.status, 200);

  const yesOf = (r) => {
    const q = r.json.questions.find((x) => x.key === 'yard_sign');
    const o = q?.options.find((x) => x.option === 'Yes' || x.text === 'Yes');
    return o?.count || 0;
  };

  assert.equal(r1.json.totalResponses, 2, 'round 1: Maria + Bob');
  assert.equal(r2.json.totalResponses, 1, 'round 2: Maria again');
  assert.equal(yesOf(r1), 1, 'one sign in round 1');
  assert.equal(yesOf(r2), 1, 'one more in round 2');

  // THE contract: per-round numbers break down the headline they sit under.
  assert.equal(
    r1.json.totalResponses + r2.json.totalResponses, all.json.totalResponses,
    'Σ(rounds) === all rounds, responses'
  );
  assert.equal(yesOf(r1) + yesOf(r2), yesOf(all), 'Σ(rounds) === all rounds, yard signs');
});

test('?passId= narrows the answer drills too, and the drill sums to the option count', { skip }, async () => {
  const { campaign, p2 } = ctx;
  const qs = `campaignId=${campaign._id}&questionKey=yard_sign&optionId=opt_yes&option=Yes`;

  const voters = await call(`/admin/reports/voters-by-answer?${qs}&passId=${p2._id}`);
  assert.equal(voters.status, 200);
  assert.equal(voters.json.total, 1, 'only round 2 said yes in that round');
  assert.equal(voters.json.voters[0].voter.fullName, 'Maria Vega');

  // The audit drill must still reconcile to the option count under the SAME filters — the
  // invariant answerDrill.int.test.js pins, now with a round in the filter set.
  const canvassers = await call(`/admin/reports/answer-canvassers?${qs}&passId=${p2._id}`);
  assert.equal(canvassers.status, 200);
  const drillTotal = (canvassers.json.rows || []).reduce((n, r) => n + r.count, 0);
  assert.equal(drillTotal, 1, 'per-canvasser drill sums to the round-scoped option count');
});

test('team rows are RESPONSE-unit and therefore still partition the campaign total', { skip }, async () => {
  const { campaign } = ctx;
  const res = await call(`/admin/reports/team-breakdown?campaignId=${campaign._id}`);
  assert.equal(res.status, 200);

  const sum = res.json.teams.reduce((n, t) => n + (t.surveysTaken || 0), 0);
  // 3 responses, not 2 distinct voters. The row count is what makes this sum work: teamFoldStage
  // puts each response on exactly ONE team. A distinct-voter column could not — a voter surveyed
  // by two teams would belong to both rows and the sum would exceed the campaign.
  //
  // ONE sanctioned exception exists: /tag-teams splits a tag's DISTINCT voters by team and DOES
  // partition — but only because it uses FIRST-FINDER attribution (each voter credited to the
  // team on their earliest tagged response, one team per voter by construction), not this fold
  // alone. surveyTagUnits.int.test.js pins that contract; do not "unify" the two shapes.
  assert.equal(sum, 3, 'Σ(team surveysTaken) === the campaign response total');
  for (const t of res.json.teams) {
    assert.equal(t.votersSurveyed, undefined, 'the old field, which promised people and counted rows, is gone');
  }

  // Doors still reconcile on their own axis.
  assert.equal(res.json.campaign.doors, 3, 'three distinct (household, pass) doors');
  assert.equal(res.json.campaign.surveyDoors, 3);
});

test('per-round KNOCKS still sum to the campaign total (the door axis is unaffected)', { skip }, async () => {
  const { campaign } = ctx;
  const res = await call(`/admin/reports/knocks-by-pass?campaignId=${campaign._id}`);
  assert.equal(res.status, 200);

  const byRound = new Map(res.json.rounds.map((r) => [r.roundNumber, r]));
  assert.equal(byRound.get(1).knocks, 2, 'round 1: two doors');
  assert.equal(byRound.get(2).knocks, 1, 'round 2: Maria revisited');
  assert.equal(byRound.get(1).surveyedKnocks, 2);
  assert.equal(byRound.get(2).surveyedKnocks, 1);

  const sum = res.json.rounds.reduce((n, r) => n + r.knocks, 0);
  assert.equal(sum, res.json.totals.knocks, 'Σ(rounds) === totals, by construction');
  assert.equal(res.json.totals.knocks, 3);

  // Coverage is the OTHER axis and deliberately does not double: two households, ever reached.
  assert.equal(
    res.json.totals.coverageGained, 2,
    'new homes reached counts each home once — a revisit adds a knock, never coverage'
  );
});

test('?passId=legacy reaches the pre-turf bucket, so the rounds add up to the headline', { skip }, async () => {
  // Pre-turf responses carry passId:null and belong to no Pass document. Both round pickers are
  // built from Pass docs, so without a sentinel those rows would sit in "All rounds" and in NO
  // selectable round — Σ(rounds) would quietly fall short of the headline on any org with history.
  const { campaign, effort, org, canv, template, p1, p2 } = ctx;
  const legacyHome = await Household.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: '9 Legacy Rd', city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: '9 LEGACY RD|TOWN|FL|34741',
    location: { type: 'Point', coordinates: [-81.39, 28.31] },
  });
  const oldTimer = await Voter.create({
    organizationId: org._id, campaignId: campaign._id, householdId: legacyHome._id,
    stateVoterId: 'MP9', firstName: 'Opal', lastName: 'Prior', fullName: 'Opal Prior',
  });
  await SurveyResponse.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: null,
    householdId: legacyHome._id, voterId: oldTimer._id, userId: canv._id,
    surveyTemplateId: template._id, surveyTemplateVersion: 1,
    location: { lat: 28.31, lng: -81.39 }, submittedAt: new Date('2026-05-01T14:00:00Z'),
    answers: [{ questionKey: 'yard_sign', questionLabel: 'Would you like a yard sign?', answer: 'Yes', optionIds: ['opt_yes'] }],
  });

  const yesOf = (r) => {
    const q = r.json.questions.find((x) => x.key === 'yard_sign');
    return q?.options.find((o) => o.option === 'Yes' || o.text === 'Yes')?.count || 0;
  };
  const all = await call(`/admin/reports/survey-results?campaignId=${campaign._id}`);
  const r1 = await call(`/admin/reports/survey-results?campaignId=${campaign._id}&passId=${p1._id}`);
  const r2 = await call(`/admin/reports/survey-results?campaignId=${campaign._id}&passId=${p2._id}`);
  const leg = await call(`/admin/reports/survey-results?campaignId=${campaign._id}&passId=legacy`);

  assert.equal(leg.status, 200);
  assert.equal(leg.json.totalResponses, 1, 'the sentinel selects exactly the passId:null rows');
  assert.equal(yesOf(leg), 1);

  // THE point: without the legacy option the three real rounds would sum to 3 against a headline
  // of 4 — a report that silently does not add up.
  assert.equal(all.json.totalResponses, 4, 'headline includes the pre-turf response');
  assert.equal(
    r1.json.totalResponses + r2.json.totalResponses + leg.json.totalResponses,
    all.json.totalResponses,
    'Σ(rounds incl. legacy) === all rounds'
  );
  assert.equal(yesOf(r1) + yesOf(r2) + yesOf(leg), yesOf(all), 'and the same for yard signs');

  // The passes endpoint must TELL a client the bucket exists, or no picker can offer it.
  const passes = await call(`/admin/campaigns/${campaign._id}/passes`);
  assert.equal(passes.status, 200);
  assert.equal(passes.json.legacyResponseCount, 1, 'clients can discover the legacy bucket');
});
