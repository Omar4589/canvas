import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The TAG counting contract, over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/tag_units node --test test/surveyTagUnits.int.test.js
//
// Tags are the voter-unit answer to "how many supporters do we have", and they carry TWO units:
//
//   voterCount        ("identified")  distinct voters EVER giving a tagged answer — never falls
//   currentVoterCount ("current")     voters whose LATEST answer still carries the tag — can fall
//
// plus a per-team split (/tag-teams) under FIRST-FINDER attribution: each voter is credited to
// the team on their EARLIEST tag-carrying response, so — unlike the teamFoldStage-only shape,
// which multiPassUnits.int.test.js pins as non-partitioning for distinct voters — both units
// here add up exactly: Σ(teams) + noTeam === totals. This file also covers the previously
// untested tags[] rollup on /survey-results, and the frozen client-report tagBreakdowns.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-tagunits';

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
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ClientReportMapPoint } = await import('../src/models/ClientReportMapPoint.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      'X-Org-Id': String(ctx.org._id),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, Effort, Pass,
    Household, Voter, CanvassActivity, SurveyResponse, SurveyTemplate, ClientReport,
    ClientReportMapPoint]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({
    name: 'Tag Units Org', slug: 'tag-units', isActive: true,
    // /tag-teams shares /team-breakdown's refuse-rather-than-mislead gate on this stamp.
    teamAttributionReadyAt: new Date(),
  });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({
    firstName: 'Ada', lastName: 'Admin', email: 'tu-admin@t.co', passwordHash: 'x', isActive: true,
  });
  // Leads become leads purely via the LEDGER: leadIdsForScope reads distinct coordinatorId off
  // the response rows below — no CampaignAssignment rows are needed for the fold.
  const leadL = await User.create({
    firstName: 'Lee', lastName: 'Lead', email: 'tu-lee@t.co', passwordHash: 'x', isActive: true,
  });
  const leadM = await User.create({
    firstName: 'Mia', lastName: 'Boss', email: 'tu-mia@t.co', passwordHash: 'x', isActive: true,
  });
  const canvA = await User.create({
    firstName: 'Abe', lastName: 'Doors', email: 'tu-abe@t.co', passwordHash: 'x', isActive: true,
  });
  const canvB = await User.create({
    firstName: 'Bea', lastName: 'Knocks', email: 'tu-bea@t.co', passwordHash: 'x', isActive: true,
  });
  const canvN = await User.create({
    firstName: 'Ned', lastName: 'Solo', email: 'tu-ned@t.co', passwordHash: 'x', isActive: true,
  });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  for (const u of [leadL, leadM]) {
    await Membership.create({ userId: u._id, organizationId: org._id, role: 'lead', isActive: true });
  }
  for (const u of [canvA, canvB, canvN]) {
    await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  }

  // Three questions: TWO feed the 'Supporter' tag (the cross-question shape tags exist for),
  // opt_o carries a second tag so one aggregation pass provably serves several tags, and
  // 'followup' is untagged — the branch-skip vehicle.
  const template = await SurveyTemplate.create({
    organizationId: org._id,
    name: 'Support Survey',
    version: 1,
    tags: ['Supporter', 'Opposed'],
    questions: [
      {
        key: 'support', label: 'Can we count on your support?', type: 'single_choice', order: 0,
        options: [
          { id: 'opt_s', text: 'Support', tag: 'Supporter', order: 0 },
          { id: 'opt_u', text: 'Undecided', order: 1 },
          { id: 'opt_o', text: 'Opposed', tag: 'Opposed', order: 2 },
        ],
      },
      {
        key: 'yard', label: 'Want a yard sign?', type: 'single_choice', order: 1,
        options: [
          { id: 'opt_y', text: 'Yard sign', tag: 'Supporter', order: 0 },
          { id: 'opt_n', text: 'No sign', order: 1 },
        ],
      },
      {
        key: 'followup', label: 'How are the roads?', type: 'single_choice', order: 2,
        options: [
          { id: 'opt_f1', text: 'Fine', order: 0 },
          { id: 'opt_f2', text: 'Bad', order: 1 },
        ],
      },
    ],
  });

  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Tag Units Campaign', type: 'survey', state: 'FL',
    isActive: true, timeZone: 'America/New_York', surveyTemplateId: template._id,
  });
  const effort = await Effort.create({
    organizationId: org._id, campaignId: campaign._id, name: 'North',
  });
  const p1 = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'Round 1', status: 'archived',
  });
  const p2 = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 2, name: 'Round 2', status: 'active',
  });

  const names = ['Sally Stable', 'Frank Flip', 'Wanda One', 'Beto Branch', 'Lola Legacy',
    'Carlos Cross', 'Hana Half', 'Manny Moved'];
  const homes = await Household.insertMany(names.map((_, n) => ({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: `${n + 1} Tag St`, city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: `${n + 1} TAG ST|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.4 + n * 0.001, 28.3] },
  })));
  const voters = [];
  for (let n = 0; n < names.length; n++) {
    const [firstName, lastName] = names[n].split(' ');
    voters.push(await Voter.create({
      organizationId: org._id, campaignId: campaign._id, householdId: homes[n]._id,
      stateVoterId: `TU${n + 1}`, firstName, lastName, fullName: names[n],
    }));
  }
  const [sally, frank, wanda, beto, lola, carlos, hana, manny] = voters;

  // answers: array of [questionKey, questionLabel, optionId|null, text]. optionId null = the
  // legacy pre-option-id shape (text only), the dual-read fallback lane.
  const respond = (voter, pass, user, coordinatorId, at, answers) => SurveyResponse.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    passId: pass ? pass._id : null,
    householdId: voter.householdId, voterId: voter._id, userId: user._id,
    coordinatorId,
    surveyTemplateId: template._id, surveyTemplateVersion: 1,
    location: { lat: 28.3, lng: -81.4 }, submittedAt: new Date(at),
    answers: answers.map(([questionKey, questionLabel, optionId, text]) => ({
      questionKey, questionLabel, answer: text, optionIds: optionId ? [optionId] : [],
    })),
  });
  const sup = (optId, text) => ['support', 'Can we count on your support?', optId, text];
  const yard = (optId, text) => ['yard', 'Want a yard sign?', optId, text];
  const fup = (optId, text) => ['followup', 'How are the roads?', optId, text];

  // R1 ≈ June 1, R2 ≈ July 1 (the client-report week below is Jun 29 – Jul 5).
  //
  // Voter     R1                                R2                          identified current  team
  // Sally     A/L  support=Support              A/L  support=Support        ✓          ✓        L
  // Frank     B/M  support=Support              B/M  support=Opposed        ✓          ✗ (flip) M
  // Wanda     L(!) support=Support (coord null → lead fold)                 ✓          ✓        L
  // Beto      A/L  support=Support              A/L  followup only (skip)   ✓          ✓        L
  // Lola      N/–  support='Support' TEXT-ONLY, passId:null (legacy)        ✓          ✓        No team
  // Carlos    B/M  support=Undecided + yard=Yard sign                       ✓          ✓        M
  // Hana      A/L  support=Support + yard=Y.s.  A/L  support=Opposed (yard  ✓          ✓ (yard  L
  //                                                  skipped)                           stands)
  // Manny     B/M  support=Support              A/L  support=Support        ✓          ✓        M (FIRST finder)
  await respond(sally, p1, canvA, leadL._id, '2026-06-01T14:00:00Z', [sup('opt_s', 'Support')]);
  await respond(sally, p2, canvA, leadL._id, '2026-07-01T14:00:00Z', [sup('opt_s', 'Support')]);
  await respond(frank, p1, canvB, leadM._id, '2026-06-01T14:10:00Z', [sup('opt_s', 'Support')]);
  await respond(frank, p2, canvB, leadM._id, '2026-07-01T14:10:00Z', [sup('opt_o', 'Opposed')]);
  // Wanda: the LEAD's own row — coordinatorId null, so only teamFoldStage's lead fold can put
  // her on team L. If she lands in "No team", the fold broke.
  await respond(wanda, p1, leadL, null, '2026-06-01T14:20:00Z', [sup('opt_s', 'Support')]);
  await respond(beto, p1, canvA, leadL._id, '2026-06-01T14:30:00Z', [sup('opt_s', 'Support')]);
  // Beto R2 answers NO member question (branching skipped it) — must not un-current him.
  await respond(beto, p2, canvA, leadL._id, '2026-07-01T14:30:00Z', [fup('opt_f1', 'Fine')]);
  // Lola: legacy row — text answer, no optionIds, passId null, a canvasser with no crew.
  await respond(lola, null, canvN, null, '2026-05-01T14:00:00Z', [sup(null, 'Support')]);
  await respond(carlos, p1, canvB, leadM._id, '2026-06-01T14:40:00Z',
    [sup('opt_u', 'Undecided'), yard('opt_y', 'Yard sign')]);
  await respond(hana, p1, canvA, leadL._id, '2026-06-01T14:50:00Z',
    [sup('opt_s', 'Support'), yard('opt_y', 'Yard sign')]);
  await respond(hana, p2, canvA, leadL._id, '2026-07-01T14:50:00Z', [sup('opt_o', 'Opposed')]);
  // Manny: first tagged by TEAM M (R1), re-tagged by TEAM L (R2) — first finder keeps him on M.
  await respond(manny, p1, canvB, leadM._id, '2026-06-01T15:00:00Z', [sup('opt_s', 'Support')]);
  await respond(manny, p2, canvA, leadL._id, '2026-07-01T15:00:00Z', [sup('opt_s', 'Support')]);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, leadL, leadM, canvA, canvB, canvN, campaign, effort, p1, p2, template,
    sally, frank, wanda, beto, lola, carlos, hana, manny,
    token: signUserToken(admin),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const supporterOf = (r) => (r.json.tags || []).find((t) => t.tag === 'Supporter');
const opposedOf = (r) => (r.json.tags || []).find((t) => t.tag === 'Opposed');

test('tags[] rollup: identified is distinct-ever, current is latest-answer, option lines stay response-unit', { skip }, async () => {
  const { campaign } = ctx;
  const res = await call(`/admin/reports/survey-results?campaignId=${campaign._id}`);
  assert.equal(res.status, 200);

  const supporter = supporterOf(res);
  assert.ok(supporter, 'the Supporter tag row exists');
  // 8 distinct people ever gave a tagged answer — incl. Lola through the legacy TEXT lane and
  // Carlos through the second member question (yard). Sally's two rounds count her ONCE.
  assert.equal(supporter.voterCount, 8, 'identified: distinct voters, ever');
  // Frank's latest answer is Opposed — he alone drops out. Hana stays current: her latest
  // support answer flipped, but her yard answer was never re-asked and still carries the tag
  // (latest ANSWER wins per question, not latest response). Beto's R2 skipped the question
  // entirely and changes nothing.
  assert.equal(supporter.currentVoterCount, 7, 'current: latest answer still tagged');
  assert.ok(supporter.currentVoterCount <= supporter.voterCount, 'current ⊆ identified, always');

  const opposed = opposedOf(res);
  assert.equal(opposed.voterCount, 2, 'Frank + Hana ever said Opposed');
  assert.equal(opposed.currentVoterCount, 2, 'both flips are their latest support answer');
  // Hana is CURRENT in both tags at once — Supporter via yard, Opposed via support. Tags are
  // independent rollups, not exclusive buckets; nothing forces them to partition each other.
  assert.equal(res.json.tags[0].tag, 'Supporter', 'sorted by identified desc');

  // The nested option lines are a deliberately DIFFERENT unit (responses). Lola's text-keyed
  // row FOLDS into the Support option by the byText lane of mergeOptionRows — dual-read means
  // the option bar and the tag options line both include her row.
  const optS = supporter.options.find((o) => o.optionId === 'opt_s');
  assert.equal(optS.count, 9, '8 id-native Support rows + Lola\'s legacy text row');
  const optY = supporter.options.find((o) => o.optionId === 'opt_y');
  assert.equal(optY.count, 2, 'Carlos + Hana took signs — response-unit');
  assert.equal(res.json.totalResponses, 13, 'all response rows, for scale');
});

test('?passId= scopes both units — and "current" is scope-relative by design', { skip }, async () => {
  const { campaign, p1, p2 } = ctx;
  const r1 = await call(`/admin/reports/survey-results?campaignId=${campaign._id}&passId=${p1._id}`);
  const r2 = await call(`/admin/reports/survey-results?campaignId=${campaign._id}&passId=${p2._id}`);

  // Round 1: everyone who gave a tagged answer that round (Lola is passId:null → excluded).
  assert.equal(supporterOf(r1).voterCount, 7);
  // Frank IS current within a round-1-only scope: his flip lives in round 2, which this scope
  // cannot see. "Current" always means "as of the filters you are looking at".
  assert.equal(supporterOf(r1).currentVoterCount, 7, 'a later flip is invisible to an earlier scope');

  assert.equal(supporterOf(r2).voterCount, 2, 'round 2 tagged: Sally + Manny');
  assert.equal(supporterOf(r2).currentVoterCount, 2);

  // Voter-unit deliberately does NOT sum across rounds — a voter surveyed in both rounds is in
  // both scopes. (Response-unit sums; that contract lives in multiPassUnits.int.test.js.)
  const all = await call(`/admin/reports/survey-results?campaignId=${campaign._id}`);
  assert.ok(
    supporterOf(r1).voterCount + supporterOf(r2).voterCount > supporterOf(all).voterCount - 1,
    'Σ(rounds) exceeds the all-rounds distinct count when anyone spans rounds'
  );
});

test('?passId=legacy reaches the pre-turf bucket through the text lane', { skip }, async () => {
  const { campaign } = ctx;
  const leg = await call(`/admin/reports/survey-results?campaignId=${campaign._id}&passId=legacy`);
  assert.equal(leg.status, 200);
  assert.equal(supporterOf(leg).voterCount, 1, 'Lola alone — passId:null rows');
  assert.equal(supporterOf(leg).currentVoterCount, 1, 'her legacy TEXT answer carries the tag');
});

test('/tag-teams: first-finder attribution, and BOTH units partition exactly', { skip }, async () => {
  const { campaign } = ctx;
  const res = await call(`/admin/reports/tag-teams?campaignId=${campaign._id}&tag=Supporter`);
  assert.equal(res.status, 200);
  assert.equal(res.json.ready, true);
  assert.equal(res.json.tag, 'Supporter');

  const byName = new Map(res.json.teams.map((t) => [t.coordinatorName, t]));
  const L = byName.get('Lee Lead');
  const M = byName.get('Mia Boss');
  // Team L: Sally, Beto, Hana — and Wanda, whose row has coordinatorId null and folds onto her
  // lead's own team ONLY through teamFoldStage. All four still current.
  assert.deepEqual({ i: L.identifiedVoters, c: L.currentVoters }, { i: 4, c: 4 });
  // Team M: Frank, Carlos — and Manny, whose EARLIEST tagged response is team M's round-1 row
  // even though team L re-tagged him in round 2. First finder keeps him: a team never loses a
  // supporter because someone else re-knocked their turf. Frank flipped, so current is 2.
  assert.deepEqual({ i: M.identifiedVoters, c: M.currentVoters }, { i: 3, c: 2 });
  // Lola: a crewless canvasser's find — the No-team bucket, a real answer, never omitted.
  assert.deepEqual(res.json.noTeam, { identifiedVoters: 1, currentVoters: 1 });

  // THE partition — the property first-finder attribution exists to provide, and the property
  // multiPassUnits pins as impossible for a teamFoldStage-only distinct-voter column.
  const sumI = res.json.teams.reduce((n, t) => n + t.identifiedVoters, 0) + res.json.noTeam.identifiedVoters;
  const sumC = res.json.teams.reduce((n, t) => n + t.currentVoters, 0) + res.json.noTeam.currentVoters;
  assert.equal(sumI, res.json.totals.identifiedVoters, 'Σ teams + noTeam === totals (identified)');
  assert.equal(sumC, res.json.totals.currentVoters, 'Σ teams + noTeam === totals (current)');
  assert.equal(res.json.totals.identifiedVoters, 8);
  assert.equal(res.json.totals.currentVoters, 7);

  // And the table reconciles with the tag row that opened it, same filters.
  const sr = await call(`/admin/reports/survey-results?campaignId=${campaign._id}`);
  assert.equal(res.json.totals.identifiedVoters, supporterOf(sr).voterCount);
  assert.equal(res.json.totals.currentVoters, supporterOf(sr).currentVoterCount);
  assert.equal(res.json.teams[0].coordinatorId, String(ctx.leadL._id), 'sorted by identified desc');
});

test('/tag-teams serves a second tag from the same machinery', { skip }, async () => {
  const { campaign } = ctx;
  const res = await call(`/admin/reports/tag-teams?campaignId=${campaign._id}&tag=Opposed`);
  assert.equal(res.status, 200);
  // Frank first-opposed on team M (his own R2), Hana on team L — one each, both current.
  const byName = new Map(res.json.teams.map((t) => [t.coordinatorName, t]));
  assert.deepEqual({ i: byName.get('Lee Lead').identifiedVoters, c: byName.get('Lee Lead').currentVoters }, { i: 1, c: 1 });
  assert.deepEqual({ i: byName.get('Mia Boss').identifiedVoters, c: byName.get('Mia Boss').currentVoters }, { i: 1, c: 1 });
  assert.deepEqual(res.json.noTeam, { identifiedVoters: 0, currentVoters: 0 });
  assert.deepEqual(res.json.totals, { identifiedVoters: 2, currentVoters: 2 });
});

test('?coordinatorId narrows /tag-teams — first-finder is scope-relative like everything else', { skip }, async () => {
  const { campaign, leadL } = ctx;
  const res = await call(
    `/admin/reports/tag-teams?campaignId=${campaign._id}&tag=Supporter&coordinatorId=${leadL._id}`
  );
  assert.equal(res.status, 200);
  // Within team L's rows only, Manny's earliest IN-SCOPE tagged response is his round-2 (team L)
  // row — his round-1 team-M row is outside the filter. Scope-relative first finder: the crew
  // filter asks "of the work THIS team did", not "of the campaign, which team was first".
  assert.equal(res.json.teams.length, 1);
  assert.deepEqual(
    { i: res.json.teams[0].identifiedVoters, c: res.json.teams[0].currentVoters },
    { i: 5, c: 5 },
    'Sally, Wanda, Beto, Hana + Manny-in-scope'
  );
  assert.deepEqual(res.json.noTeam, { identifiedVoters: 0, currentVoters: 0 });

  // The none bucket excludes leads' own folded rows: Lola only — Wanda's row (userId = a lead,
  // coordinatorId null) belongs to team L, and counting her here would double her.
  const none = await call(
    `/admin/reports/tag-teams?campaignId=${campaign._id}&tag=Supporter&coordinatorId=none`
  );
  assert.equal(none.status, 200);
  assert.deepEqual(none.json.totals, { identifiedVoters: 1, currentVoters: 1 });
  assert.deepEqual(none.json.noTeam, { identifiedVoters: 1, currentVoters: 1 });
  assert.equal(none.json.teams.length, 0);
});

test('tag lookup is case-insensitive; missing and unknown tags are honest errors', { skip }, async () => {
  const { campaign } = ctx;
  const lower = await call(`/admin/reports/tag-teams?campaignId=${campaign._id}&tag=supporter`);
  assert.equal(lower.status, 200);
  assert.equal(lower.json.tag, 'Supporter', 'normalizeTag lookup, display casing back out');
  assert.equal(lower.json.totals.identifiedVoters, 8);

  const missing = await call(`/admin/reports/tag-teams?campaignId=${campaign._id}`);
  assert.equal(missing.status, 400, 'tag is required');
  const unknown = await call(`/admin/reports/tag-teams?campaignId=${campaign._id}&tag=Nope`);
  assert.equal(unknown.status, 404, 'a typo must not read as an honest zero');
});

test('the team-attribution gate refuses rather than misleads', { skip }, async () => {
  const { campaign, org } = ctx;
  await Organization.updateOne({ _id: org._id }, { $unset: { teamAttributionReadyAt: 1 } });
  try {
    const res = await call(`/admin/reports/tag-teams?campaignId=${campaign._id}&tag=Supporter`);
    assert.equal(res.status, 200);
    assert.equal(res.json.ready, false);
    assert.deepEqual(res.json.teams, []);
    assert.equal(res.json.totals, null);
  } finally {
    await Organization.updateOne({ _id: org._id }, { $set: { teamAttributionReadyAt: new Date() } });
  }
  const back = await call(`/admin/reports/tag-teams?campaignId=${campaign._id}&tag=Supporter`);
  assert.equal(back.json.ready, true);
});

test('/answer-canvassers still 400s tag mode — first-finder ruled on TEAMS, not canvassers', { skip }, async () => {
  const { campaign, template } = ctx;
  const res = await call(
    `/admin/reports/answer-canvassers?campaignId=${campaign._id}&tag=Supporter&surveyTemplateId=${template._id}`
  );
  assert.equal(res.status, 400, 'the per-canvasser refusal is deliberate and must survive this feature');
});

test('client report: tagBreakdowns computed for both windows with window-local semantics', { skip }, async () => {
  const { campaign } = ctx;
  // The week containing round 2 (America/New_York): Jun 29 – Jul 5.
  const created = await call('/admin/client-reports', {
    method: 'POST',
    body: { campaignId: String(campaign._id), weekStart: '2026-06-29', weekEnd: '2026-07-05' },
  });
  assert.equal(created.status, 201);
  ctx.reportId = created.json.report._id;

  const doc = await ClientReport.findById(ctx.reportId).lean();
  const cumSup = doc.stats.cumulative.tagBreakdowns.find((t) => t.tag === 'Supporter');
  // Cumulative = everything through the week's end: the full fixture.
  assert.deepEqual(
    { i: cumSup.identifiedVoters, c: cumSup.currentVoters },
    { i: 8, c: 7 },
    'cumulative window sees all rounds; Frank\'s flip un-currents him'
  );
  const cumOpp = doc.stats.cumulative.tagBreakdowns.find((t) => t.tag === 'Opposed');
  assert.deepEqual({ i: cumOpp.identifiedVoters, c: cumOpp.currentVoters }, { i: 2, c: 2 });
  assert.equal(doc.stats.cumulative.tagBreakdowns[0].tag, 'Supporter', 'sorted by identified desc');

  // Period = the week alone. Only round-2 rows are in-window: Sally + Manny carry the tag;
  // Frank/Hana/Beto's round-2 rows are in-window but not tag-carrying. A voter who flipped this
  // week against a tag earned LAST week shows in neither period column — the cumulative window
  // is where the flip lands.
  const perSup = doc.stats.period.tagBreakdowns.find((t) => t.tag === 'Supporter');
  assert.deepEqual({ i: perSup.identifiedVoters, c: perSup.currentVoters }, { i: 2, c: 2 });
  const perOpp = doc.stats.period.tagBreakdowns.find((t) => t.tag === 'Opposed');
  assert.deepEqual({ i: perOpp.identifiedVoters, c: perOpp.currentVoters }, { i: 2, c: 2 });
});

test('client report: tags are OPT-IN — the preview shows none until ticked', { skip }, async () => {
  const preview = await call(`/admin/client-reports/${ctx.reportId}/preview`);
  assert.equal(preview.status, 200);
  // The stats carry two computed tags; the shaped view carries ZERO — empty visibleTags means
  // show none, the OPPOSITE of visibleQuestionKeys' empty=all. Every pre-feature report gets
  // this default, which is exactly why no migration is needed.
  assert.deepEqual(preview.json.report.stats.cumulative.tagBreakdowns, []);
  assert.deepEqual(preview.json.report.stats.period.tagBreakdowns, []);
});

test('client report: ticking a tag reveals exactly that tag, both windows', { skip }, async () => {
  const patched = await call(`/admin/client-reports/${ctx.reportId}`, {
    method: 'PATCH',
    body: { visibility: { visibleTags: ['Supporter'] } },
  });
  assert.equal(patched.status, 200);

  const preview = await call(`/admin/client-reports/${ctx.reportId}/preview`);
  const cum = preview.json.report.stats.cumulative.tagBreakdowns;
  assert.equal(cum.length, 1, 'Opposed stays unticked and invisible');
  assert.equal(cum[0].tag, 'Supporter');
  assert.deepEqual({ i: cum[0].identifiedVoters, c: cum[0].currentVoters }, { i: 8, c: 7 });
  assert.equal(preview.json.report.stats.period.tagBreakdowns.length, 1);
  // The unticked tag's NAME must not ride the wire either — least exposure.
  assert.equal(preview.json.report.visibility.visibleTags, undefined);
});

test('client report: published = frozen; republish recomputes', { skip }, async () => {
  const { campaign, org, effort, template, canvA, leadL } = ctx;
  const published = await call(`/admin/client-reports/${ctx.reportId}/publish`, { method: 'POST' });
  assert.equal(published.status, 200);

  // The draft gate now refuses edits...
  const patched = await call(`/admin/client-reports/${ctx.reportId}`, {
    method: 'PATCH',
    body: { visibility: { visibleTags: [] } },
  });
  assert.equal(patched.status, 400, 'published reports are not editable');

  // ...and new in-window data does NOT move the stored numbers.
  const zedHome = await Household.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: '99 Late St', city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: '99 LATE ST|TOWN|FL|34741',
    location: { type: 'Point', coordinates: [-81.38, 28.32] },
  });
  const zed = await Voter.create({
    organizationId: org._id, campaignId: campaign._id, householdId: zedHome._id,
    stateVoterId: 'TU99', firstName: 'Zed', lastName: 'Late', fullName: 'Zed Late',
  });
  await SurveyResponse.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: ctx.p2._id,
    householdId: zedHome._id, voterId: zed._id, userId: canvA._id, coordinatorId: leadL._id,
    surveyTemplateId: template._id, surveyTemplateVersion: 1,
    location: { lat: 28.32, lng: -81.38 }, submittedAt: new Date('2026-07-02T14:00:00Z'),
    answers: [{
      questionKey: 'support', questionLabel: 'Can we count on your support?',
      answer: 'Support', optionIds: ['opt_s'],
    }],
  });

  let doc = await ClientReport.findById(ctx.reportId).lean();
  let sup = doc.stats.cumulative.tagBreakdowns.find((t) => t.tag === 'Supporter');
  assert.equal(sup.identifiedVoters, 8, 'frozen: Zed does not appear');

  // Unpublish + republish is the ONE sanctioned road back — a full re-freeze on current data.
  await call(`/admin/client-reports/${ctx.reportId}/unpublish`, { method: 'POST' });
  const re = await call(`/admin/client-reports/${ctx.reportId}/publish`, { method: 'POST' });
  assert.equal(re.status, 200);
  doc = await ClientReport.findById(ctx.reportId).lean();
  sup = doc.stats.cumulative.tagBreakdowns.find((t) => t.tag === 'Supporter');
  assert.deepEqual(
    { i: sup.identifiedVoters, c: sup.currentVoters },
    { i: 9, c: 8 },
    'republish re-freezes with Zed counted'
  );
});

test('a pre-feature report (no tagBreakdowns, no visibleTags) renders cleanly', { skip }, async () => {
  // Simulate a report frozen before this feature existed: strip the new fields entirely.
  await ClientReport.updateOne(
    { _id: ctx.reportId },
    {
      $unset: {
        'stats.cumulative.tagBreakdowns': 1,
        'stats.period.tagBreakdowns': 1,
        'visibility.visibleTags': 1,
      },
    }
  );
  const preview = await call(`/admin/client-reports/${ctx.reportId}/preview`);
  assert.equal(preview.status, 200, 'absent fields + defaults, no migration, no crash');
  assert.deepEqual(preview.json.report.stats.cumulative.tagBreakdowns, []);
  assert.deepEqual(preview.json.report.stats.period.tagBreakdowns, []);
});
