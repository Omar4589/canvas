import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// The campaign home's crew filter — ?coordinatorId threaded through every endpoint the
// Dashboard calls, over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/homecrew node --test test/campaignHomeCrewFilter.int.test.js
//
// teamAttribution.int.test.js is the spec for team COUNTING (/team-breakdown, /canvasser-timeline);
// this file is the spec for team FILTERING on the campaign home surface: /campaign-rollup,
// /canvassers, /knocks-by-pass (+.csv), /survey-results, /voters-by-answer, /answer-canvassers,
// /canvassers/:userId/responses. The load-bearing assertions:
//
//   1. A crew-filtered /campaign-rollup agrees with /team-breakdown's row for the same crew —
//      teamMatch (query) and teamFoldStage (fold) must not drift, now on a second endpoint.
//   2. A crew filter BYPASSES the Campaign.stats fast path (a crew has no counter equivalent).
//   3. The `none` bucket excludes the leads' own folded doors — INCLUDING in aggregation $matches,
//      where nothing casts for you. leadIdsForScope returns strings; teamMatch must cast them or
//      the $nin over an ObjectId userId excludes nothing and every lead's doors double-count into
//      "No team". Existing fixtures never had a lead-authored null row to exclude, so this file
//      builds one on purpose.
//   4. "New homes reached" under a crew filter = doors whose campaign-first-EVER knock was this
//      crew's, in the pass it landed — the first-ever determination itself stays campaign-wide.
//   5. The counting contract (survey-results option count == Σ answer-canvassers rows ==
//      voters-by-answer total) holds under a crew filter, because all three take the identical
//      clause.
//   6. The `none` shape's userId key must INTERSECT a canvasser drill's userId, never replace it
//      (withTeam is $and-based) — the responses modal for one person, filtered to "No coordinator".
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-home-crew-filter';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { Voter } = await import('../src/models/Voter.js');
const { Household } = await import('../src/models/Household.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { recomputeCampaignStats } = await import('../src/services/reports/campaignCounters.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};
let doorSeq = 0;

const call = async (path, token = ctx.bossToken) => {
  const res = await fetch(`${base}/api${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': String(ctx.org._id) },
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, json: type.includes('json') ? await res.json() : null };
};

// One household + its knock, team frozen on the row exactly as the write path stamps it.
const door = async (effort) =>
  Household.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, effortId: effort._id,
    addressLine1: `${++doorSeq} Crew St`, city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: `${doorSeq} CREW ST|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.4, 28.3] },
  });

const knock = (hh, pass, user, coordinatorId, at, actionType = 'not_home') =>
  CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id,
    effortId: hh.effortId, passId: pass._id, householdId: hh._id,
    userId: user._id, actionType, coordinatorId: coordinatorId || null,
    timestamp: new Date(at), location: { lat: 28.3, lng: -81.4 },
  });

let voterSeq = 0;
const respond = async (hh, pass, user, coordinatorId, optionId, at) => {
  const voter = await Voter.collection.insertOne({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: hh._id,
    fullName: `Crew Voter ${++voterSeq}`, isActive: true,
  });
  const text = optionId === 'opt_yes' ? 'Yes' : 'No';
  await SurveyResponse.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id,
    effortId: hh.effortId, passId: pass._id, householdId: hh._id,
    voterId: voter.insertedId, userId: user._id,
    surveyTemplateId: ctx.template._id, surveyTemplateVersion: 1,
    answers: [{ questionKey: 'support', questionLabel: 'Support?', answer: text, optionIds: [optionId] }],
    coordinatorId: coordinatorId || null,
    submittedAt: new Date(at), location: { lat: 28.3, lng: -81.4 },
  });
};

const rollupRow = async (qs) => {
  const res = await call(`/admin/reports/campaign-rollup?campaignId=${ctx.campaign._id}${qs}`);
  assert.equal(res.status, 200, 'campaign-rollup responded');
  return res.json.campaigns[0];
};

const optionCount = (resultsJson, optId) => {
  const q = (resultsJson.questions || []).find((x) => x.key === 'support');
  const o = q?.options.find((x) => x.id === optId);
  return o ? o.count : 0;
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, CanvassActivity,
    SurveyResponse, SurveyTemplate, Voter, Household, Effort, Pass, CampaignAssignment])
    await M.deleteMany({});

  // teamAttributionReadyAt: the crew backfill has run — team surfaces report.
  const org = await Organization.create({
    name: 'Home Crew', slug: 'home-crew', isActive: true, teamAttributionReadyAt: new Date(),
  });
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const mk = (first, role) =>
    User.create({
      firstName: first, lastName: 'X', email: `${first.toLowerCase()}@homecrew.co`,
      passwordHash: 'x', isActive: true,
    }).then(async (u) => {
      await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
      return u;
    });
  const boss = await mk('Boss', 'admin');
  const asa = await mk('Asa', 'lead');      // runs crew A — and knocks himself (null stamp, folds)
  const frank = await mk('Frank', 'lead');  // runs crew B
  const chad = await mk('Chad', 'canvasser');   // crew A
  const dana = await mk('Dana', 'canvasser');   // crew B
  const randy = await mk('Randy', 'canvasser'); // no crew — the "none" bucket
  const sammy = await mk('Sammy', 'canvasser'); // knocked for BOTH crews in the window

  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Home Survey', version: 1,
    questions: [{
      key: 'support', label: 'Support?', type: 'single_choice', order: 0,
      options: [
        { id: 'opt_yes', text: 'Yes', order: 0 },
        { id: 'opt_no', text: 'No', order: 1 },
      ],
    }],
  });

  const campaign = await Campaign.create({
    organizationId: org._id, name: 'HD90', type: 'survey', state: 'FL', isActive: true,
    timeZone: 'America/New_York', surveyTemplateId: template._id,
  });
  const e1 = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'Main' });
  const e2 = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'Second' });
  const p1 = await Pass.create({ organizationId: org._id, campaignId: campaign._id, effortId: e1._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const p2 = await Pass.create({ organizationId: org._id, campaignId: campaign._id, effortId: e1._id, roundNumber: 2, name: 'Round 2', status: 'active' });
  const p3 = await Pass.create({ organizationId: org._id, campaignId: campaign._id, effortId: e2._id, roundNumber: 1, name: 'Second R1', status: 'active' });

  for (const u of [asa, frank, chad, dana, randy, sammy]) {
    await CampaignAssignment.create({ campaignId: campaign._id, userId: u._id, organizationId: org._id, assignedBy: boss._id });
  }

  Object.assign(ctx, {
    org, boss, asa, frank, chad, dana, randy, sammy, campaign, template, e1, e2, p1, p2, p3,
    bossToken: signUserToken(boss),
  });

  // ── The ledger. Team A (Asa): 6 doors, team B (Frank): 4, none: 1 — 11 campaign billable. ──
  const T1 = '2026-07-08T14:00:00Z'; // P1
  const T2 = '2026-07-15T14:00:00Z'; // P2
  const T3 = '2026-07-16T14:00:00Z'; // e2/P3

  const d1 = await door(e1); // Chad, crew A, surveys
  await knock(d1, p1, chad, asa._id, T1, 'survey_submitted');
  await respond(d1, p1, chad, asa._id, 'opt_yes', T1);

  const d2 = await door(e1); // Asa HIMSELF — null stamp; folds to his own crew, excluded from `none`
  await knock(d2, p1, asa, null, T1, 'survey_submitted');
  await respond(d2, p1, asa, null, 'opt_yes', T1);

  const d3 = await door(e1); // Randy — the genuine "No coordinator" bucket
  await knock(d3, p1, randy, null, T1, 'survey_submitted');
  await respond(d3, p1, randy, null, 'opt_no', T1);

  const d4 = await door(e1); // Dana, crew B, surveys
  await knock(d4, p1, dana, frank._id, T1, 'survey_submitted');
  await respond(d4, p1, dana, frank._id, 'opt_no', T1);

  const d5 = await door(e1); // FIRST knocked by crew A in P1, RE-knocked by crew B in P2
  await knock(d5, p1, chad, asa._id, T1);
  await knock(d5, p2, dana, frank._id, T2);

  const d6 = await door(e1); // first-ever knock lands in P2, crew A
  await knock(d6, p2, chad, asa._id, T2);

  const d7 = await door(e1); // Sammy knocking FOR CREW A
  await knock(d7, p1, sammy, asa._id, T1, 'survey_submitted');
  await respond(d7, p1, sammy, asa._id, 'opt_yes', T1);

  const d8 = await door(e1); // Sammy knocking FOR CREW B
  await knock(d8, p1, sammy, frank._id, T1, 'survey_submitted');
  await respond(d8, p1, sammy, frank._id, 'opt_yes', T1);

  const d9 = await door(e2); // Second walk list: one door per crew, for effort∩crew
  await knock(d9, p3, chad, asa._id, T3);
  const d10 = await door(e2);
  await knock(d10, p3, dana, frank._id, T3);

  // A null-stamped survey by a NON-lead (no paired knock — the drill only reads SurveyResponse):
  // makes the `none` responses drill able to over-count if the userId key gets clobbered.
  await respond(d3, p1, sammy, null, 'opt_yes', T1);

  Object.assign(ctx, { d5, d6 });

  // Rows were raw-inserted past the write hooks that maintain Campaign.stats — recompute, so the
  // unfiltered all-time fast path serves TRUSTED counters (the bypass test needs both paths live).
  await recomputeCampaignStats(campaign._id);

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

// ── /campaign-rollup ────────────────────────────────────────────────────────────────────────────

test('crew-filtered rollup agrees with team-breakdown row; coverage stays campaign-wide', { skip }, async () => {
  const { campaign, asa } = ctx;
  const breakdown = await call(`/admin/reports/team-breakdown?campaignId=${campaign._id}`);
  assert.equal(breakdown.status, 200);
  const asaRow = breakdown.json.teams.find((t) => t.coordinatorName === 'Asa X');
  assert.ok(asaRow, 'team-breakdown has Asa\'s crew');

  const all = await rollupRow('');
  const mine = await rollupRow(`&coordinatorId=${asa._id}`);

  // The filter (teamMatch) and the fold (teamFoldStage) must not drift — 6 doors: d1, d2 (the
  // lead's own, folded), d5, d6, d7 (Sammy-for-A), d9.
  assert.equal(mine.knocks, 6, 'crew A doors');
  assert.equal(mine.knocks, asaRow.doors, 'rollup filter == team-breakdown fold');
  assert.equal(mine.surveysSubmitted, 3, 'crew A surveys: Chad, Asa (folded), Sammy-for-A');
  assert.equal(mine.surveysSubmitted, asaRow.surveysTaken, 'survey ledger agrees too');

  // Doors don't belong to a crew: Coverage is identical, filtered or not.
  assert.ok(all.households > 0, 'the campaign has doors');
  assert.equal(mine.households, all.households, 'coverage denominator is campaign-wide');
  assert.equal(mine.homesKnocked, all.homesKnocked, 'coverage numerator is campaign-wide');
});

test('a crew filter bypasses the Campaign.stats fast path', { skip }, async () => {
  const { asa } = ctx;
  // Unfiltered all-time = the trusted-counters path; recompute made them truthful (11 billable).
  const all = await rollupRow('');
  assert.equal(all.knocks, 11, 'unfiltered all-time reads the counters');
  // Crew-scoped MUST take the live pipeline — a crew has no counter equivalent. If the fast path
  // swallowed the filter, this would read 11.
  const mine = await rollupRow(`&coordinatorId=${asa._id}`);
  assert.equal(mine.knocks, 6, 'crew request is live-aggregated, not served from counters');
});

test('`none` excludes the leads\' folded doors and Σ crews + none == campaign', { skip }, async () => {
  const { asa, frank } = ctx;
  const a = await rollupRow(`&coordinatorId=${asa._id}`);
  const b = await rollupRow(`&coordinatorId=${frank._id}`);
  const none = await rollupRow('&coordinatorId=none');
  const all = await rollupRow('');

  // Asa's own d2 is null-stamped: it belongs to HIS crew (the fold), so `none` must not count it.
  assert.equal(none.knocks, 1, 'only Randy\'s door is "No coordinator"');
  assert.equal(none.surveysSubmitted, 2, 'Randy\'s survey + Sammy\'s unstamped one');
  // No door in this fixture was walked by two crews in the same pass, so the crews partition the
  // campaign exactly (d5's two knocks are in different passes — two billable doors).
  assert.equal(a.knocks + b.knocks + none.knocks, all.knocks, 'crews + none == campaign billable');
});

// ── /knocks-by-pass (+ .csv) ────────────────────────────────────────────────────────────────────

test('crew-filtered by-pass rows sum to their own total; "new homes" credit the first-knocking crew', { skip }, async () => {
  const { campaign, asa, frank } = ctx;
  const res = await call(`/admin/reports/knocks-by-pass?campaignId=${campaign._id}&coordinatorId=${asa._id}`);
  assert.equal(res.status, 200);
  const { rounds, totals } = res.json;
  assert.equal(rounds.reduce((s, r) => s + r.knocks, 0), totals.knocks, 'Σ rounds == totals');
  assert.equal(totals.knocks, 6, 'crew A doors across all three rounds');

  const byRound = new Map(rounds.map((r) => [r.roundLabel, r]));
  // d1, d2, d5, d7 were first-ever knocked by crew A in P1; d6 in P2; d9 in P3.
  assert.equal(byRound.get('Pass 1 · Round 1').coverageGained, 4, 'crew A new homes, round 1');
  assert.equal(byRound.get('Pass 2 · Round 2').coverageGained, 1, 'crew A new homes, round 2');

  // Crew B re-knocked d5 in P2 — but its campaign-first knock was crew A's, so it is NOT a new
  // home for crew B. First-ever stays campaign-wide; only the credit is crew-scoped.
  const bRes = await call(`/admin/reports/knocks-by-pass?campaignId=${campaign._id}&coordinatorId=${frank._id}`);
  const bByRound = new Map(bRes.json.rounds.map((r) => [r.roundLabel, r]));
  assert.equal(bByRound.get('Pass 2 · Round 2').knocks, 1, 'crew B did knock d5 in round 2');
  assert.equal(bByRound.get('Pass 2 · Round 2').coverageGained, 0, 'but it was not a new home');
});

test('`none` new-homes excludes a lead\'s first knock — the $nin must bite in an AGGREGATION', { skip }, async () => {
  const { campaign } = ctx;
  // Two doors have a null-stamped campaign-first knock: d3 (Randy) and d2 (Asa — a LEAD). The
  // coverageGained pipeline matches AFTER a $group, where nothing casts query values; if teamMatch
  // ships string lead ids, the $nin excludes nobody and d2 double-credits into "No coordinator".
  const res = await call(`/admin/reports/knocks-by-pass?campaignId=${campaign._id}&coordinatorId=none`);
  assert.equal(res.status, 200);
  assert.equal(res.json.totals.knocks, 1, 'Randy\'s door only');
  const p1Row = res.json.rounds.find((r) => r.roundLabel === 'Pass 1 · Round 1');
  assert.equal(p1Row.coverageGained, 1, 'one new home for "none" — the lead\'s own door excluded');
});

test('the by-pass CSV takes the same crew filter', { skip }, async () => {
  const { campaign, asa } = ctx;
  const res = await fetch(
    `${base}/api/admin/reports/knocks-by-pass.csv?campaignId=${campaign._id}&coordinatorId=${asa._id}`,
    { headers: { Authorization: `Bearer ${ctx.bossToken}`, 'X-Org-Id': String(ctx.org._id) } }
  );
  assert.equal(res.status, 200);
  const text = await res.text();
  // The TOTAL row carries the crew-scoped billable figure, same as the JSON.
  assert.match(text, /TOTAL/, 'has a TOTAL row');
  assert.match(text.split('\n').find((l) => l.includes('TOTAL')) || '', /6/, 'crew A total, not the campaign\'s 11');
});

// ── /canvassers ─────────────────────────────────────────────────────────────────────────────────

test('the leaderboard filters to the crew — knocks AND surveys', { skip }, async () => {
  const { campaign, asa } = ctx;
  const res = await call(`/admin/reports/canvassers?campaignId=${campaign._id}&coordinatorId=${asa._id}`);
  assert.equal(res.status, 200);
  const names = res.json.map((r) => r.firstName).sort();
  assert.deepEqual(names, ['Asa', 'Chad', 'Sammy'], 'crew A: the lead (folded), his crew, and Sammy-for-A');

  // Sammy surveyed for BOTH crews plus one unstamped row; only the crew-A survey may count here.
  // Catches wiring the activity ledger but not the survey ledger (or vice versa).
  const sammy = res.json.find((r) => r.firstName === 'Sammy');
  assert.equal(sammy.surveysSubmitted, 1, 'only the crew-A survey');
});

// ── the survey drills: /survey-results, /answer-canvassers, /voters-by-answer ───────────────────

test('the counting contract holds under a crew filter', { skip }, async () => {
  const { campaign, template, asa } = ctx;
  const qs = `campaignId=${campaign._id}&surveyTemplateId=${template._id}&coordinatorId=${asa._id}`;

  const results = await call(`/admin/reports/survey-results?${qs}`);
  assert.equal(results.status, 200);
  // Crew A's Yes rows: Chad, Asa (his own null-stamped, folded), Sammy-for-A.
  assert.equal(optionCount(results.json, 'opt_yes'), 3, 'survey-results, crew-scoped');

  const drill = await call(`/admin/reports/answer-canvassers?${qs}&questionKey=support&optionId=opt_yes&option=Yes`);
  assert.equal(drill.status, 200);
  assert.equal(drill.json.total, 3, 'Σ answer-canvassers == the option count');

  const voters = await call(`/admin/reports/voters-by-answer?${qs}&questionKey=support&optionId=opt_yes&option=Yes`);
  assert.equal(voters.status, 200);
  assert.equal(voters.json.total, 3, 'voters-by-answer total == the option count');
});

// ── effort ∩ crew ───────────────────────────────────────────────────────────────────────────────

test('effortId and coordinatorId intersect — never clobber', { skip }, async () => {
  const { campaign, e2, asa } = ctx;
  const row = await rollupRow(`&effortId=${e2._id}&coordinatorId=${asa._id}`);
  assert.equal(row.knocks, 1, 'crew A on the Second walk list: one door');

  const byPass = await call(`/admin/reports/knocks-by-pass?campaignId=${campaign._id}&effortId=${e2._id}&coordinatorId=${asa._id}`);
  assert.equal(byPass.json.totals.knocks, 1);
  assert.ok(
    byPass.json.rounds.every((r) => r.effortName === 'Second' || r.knocks === 0),
    'row set is the effort\'s own passes'
  );
});

// ── /canvassers/:userId/responses ───────────────────────────────────────────────────────────────

test('the responses modal scopes a two-crew canvasser to the selected crew', { skip }, async () => {
  const { campaign, sammy, asa, frank } = ctx;
  const path = (extra) => `/admin/reports/canvassers/${sammy._id}/responses?campaignId=${campaign._id}${extra}`;
  assert.equal((await call(path(''))).json.total, 3, 'Sammy: crew A + crew B + unstamped');
  assert.equal((await call(path(`&coordinatorId=${asa._id}`))).json.total, 1, 'crew A only');
  assert.equal((await call(path(`&coordinatorId=${frank._id}`))).json.total, 1, 'crew B only');
});

test('`none` + a userId drill INTERSECTS — the team clause must not clobber the userId', { skip }, async () => {
  const { campaign, randy, asa } = ctx;
  // Two unstamped non-lead surveys exist (Randy's and Sammy's). If withTeam spread the `none`
  // shape over the filter, its userId:{$nin:leads} would REPLACE the drilled userId and this
  // would read 2. The $and keeps it Randy's alone.
  const res = await call(`/admin/reports/canvassers/${randy._id}/responses?campaignId=${campaign._id}&coordinatorId=none`);
  assert.equal(res.json.total, 1, 'Randy\'s own unstamped survey, nobody else\'s');

  // And a LEAD drilled under `none` reads zero — his unstamped work belongs to his crew.
  const lead = await call(`/admin/reports/canvassers/${asa._id}/responses?campaignId=${campaign._id}&coordinatorId=none`);
  assert.equal(lead.json.total, 0, 'the lead\'s folded work is not in "No coordinator"');
});
