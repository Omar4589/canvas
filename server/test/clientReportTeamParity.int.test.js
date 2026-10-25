import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Team reports against the dashboard's own team numbers — docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F4
// ("Numbers: each team's own work … Parity, pinned by test") — and the builder's reason for earlier
// totals that moved, chosen by cause. Against the real app and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/teamparity node --test test/clientReportTeamParity.int.test.js
//
// Surveys, voters and tags match the crew-filtered /campaign-rollup and /survey-results (both windows).
// Doors match /team-breakdown except in a window where only the lead knocked: that route folds a lead's
// own doors onto her team only when her crew also knocked in the window, while a team report always
// counts them. Then: "canvassers changed teams", "the team's crews changed", and the ledger reason;
// and the builder's team sums (each team's visits, visits two teams made, visits no team made).
// routes/admin/reports.js is read here, never changed (the phone calls it).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-team-parity';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.CLIENT_REPORT_QUEUE_TIMEOUT_MS = '300';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ClientReportSeries } = await import('../src/models/ClientReportSeries.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { CoordinatorChange } = await import('../src/models/CoordinatorChange.js');
const { processClientReportJob } = await import('../src/services/reports/clientReportBuilds.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;

let server;
let base;
const ctx = {};

const call = async (method, path, body) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.token}`, 'X-Org-Id': String(ctx.org._id) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};

// Civil days in the campaigns' zone (America/Chicago, UTC-5 in July): hour h of a day.
const at = (day, h = 12) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00-05:00`);

let n = 0;
const door = async (camp) => {
  n += 1;
  return Household.create({
    organizationId: ctx.org._id, campaignId: camp._id, isActive: true,
    addressLine1: `${n} Parity Ln`, city: 'Tampa', state: 'FL', zipCode: '33601', normalizedAddress: `PARITY${n}`,
    location: { type: 'Point', coordinates: [-82.46 + n / 1e3, 27.95] },
  });
};
const knock = (camp, hh, user, coordinatorId, actionType, when, passId = ctx.pass) =>
  CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, userId: user._id, coordinatorId,
    actionType, timestamp: when, passId, location: { lat: 27.95, lng: -82.46 },
  });
const voterAt = (camp, hh) => {
  n += 1;
  return Voter.create({ organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, stateVoterId: `PV${n}`, firstName: 'P', lastName: `V${n}`, fullName: `P V${n}` });
};
const answer = (support, issues = null) => [
  { questionKey: 'support', questionLabel: 'Support?', optionIds: [support === 'Yes' ? 'y' : 'n'], answer: support },
  ...(issues ? [{ questionKey: 'issues', questionLabel: 'Issues?', optionIds: issues.map((i) => (i === 'Schools' ? 'a' : 'b')), answer: issues }] : []),
];
const surveyOf = async (camp, hh, user, coordinatorId, when, answers, voter = null, passId = ctx.pass) => {
  const v = voter || (await voterAt(camp, hh));
  await SurveyResponse.create({
    organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, voterId: v._id, userId: user._id, coordinatorId,
    surveyTemplateId: ctx.template._id, surveyTemplateVersion: 1, passId, location: { lat: 27.95, lng: -82.46 },
    submittedAt: when, answers,
  });
  return v;
};
// A knocked, surveyed door in one go.
const surveyed = async (camp, user, coordinatorId, when, answers) => {
  const hh = await door(camp);
  await knock(camp, hh, user, coordinatorId, 'survey_submitted', when);
  await surveyOf(camp, hh, user, coordinatorId, when, answers);
  return hh;
};

const runBuild = async (reportId) => {
  const jobId = new ObjectId().toHexString();
  await ClientReport.updateOne({ _id: reportId }, { $set: { 'build.status': 'queued', 'build.jobId': jobId, 'build.startedAt': new Date() } });
  const out = await processClientReportJob({ id: jobId, data: { reportId: String(reportId) }, moveToDelayed: async () => {}, updateProgress: async () => {} }, 'token');
  assert.ok(out?.committed, `the build committed: ${JSON.stringify(out)}`);
  return ClientReport.findById(reportId).lean();
};
const team = async (camp, label, coordinatorIds) => {
  const res = await call('POST', '/admin/client-reports/series', { campaignId: String(camp._id), label, coordinatorIds: coordinatorIds.map(String) });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  return res.json.series;
};
const reportFor = async (camp, { seriesId = null, weekStart, weekEnd }) => {
  const res = await call('POST', '/admin/client-reports', { campaignId: String(camp._id), weekStart, weekEnd, ...(seriesId ? { seriesId: String(seriesId) } : {}) });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  return runBuild(res.json.report._id);
};
const publish = async (r) => {
  const res = await call('POST', `/admin/client-reports/${r._id}/publish`, { snapshotId: String(r.snapshotId), editVersion: r.editVersion ?? 0 });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
};
const next = async (r) => {
  const res = await call('POST', `/admin/client-reports/${r._id}/next`);
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  return res.json.report;
};

const seedCrews = async (camp) => {
  for (const [u, c] of [[ctx.a1, ctx.dee], [ctx.b1, ctx.sam], [ctx.c1, ctx.maria], [ctx.dee, null], [ctx.sam, null], [ctx.maria, null]]) {
    await CampaignAssignment.create({ campaignId: camp._id, userId: u._id, organizationId: ctx.org._id, coordinatorId: c ? c._id : null });
  }
};

before(async () => {
  if (!URI) return;
  mongoose.set('strictQuery', true);
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await ClientReportSeries.syncIndexes();
  const org = await Organization.create({ name: 'Parity Org', slug: 'parity-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const mk = async (first, last, role = 'canvasser') => {
    const u = await User.create({ firstName: first, lastName: last, email: `${first.toLowerCase()}.${last.toLowerCase()}@parity.t.co`, passwordHash: 'x', isActive: true });
    await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
    return u;
  };
  const admin = await mk('Ada', 'Admin', 'admin');
  Object.assign(ctx, {
    org,
    token: signUserToken(admin),
    dee: await mk('Dee', 'Lead', 'lead'),
    sam: await mk('Sam', 'Lead', 'lead'),
    maria: await mk('Maria', 'Lead', 'lead'),
    a1: await mk('Ann', 'Crewone'),
    b1: await mk('Bob', 'Crewtwo'),
    c1: await mk('Cal', 'Crewthree'),
    pass: new ObjectId(),
    pass2: new ObjectId(),
  });
  ctx.template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Parity', isActive: true,
    questions: [
      { key: 'support', label: 'Support?', type: 'single_choice', options: [{ id: 'y', text: 'Yes', tag: 'Supporter' }, { id: 'n', text: 'No', tag: 'Opposed' }] },
      { key: 'issues', label: 'Issues?', type: 'multiple_choice', options: [{ id: 'a', text: 'Schools', tag: 'Supporter' }, { id: 'b', text: 'Roads' }] },
    ],
  });
  const campaign = (name) => Campaign.create({ organizationId: org._id, name, type: 'survey', state: 'FL', isActive: true, surveyTemplateId: ctx.template._id, timeZone: 'America/Chicago' });

  // ── Campaign A: the parity fixture ───────────────────────────────────────────────────────────
  const A = await campaign('Parity A');
  await seedCrews(A);
  const { a1, b1, c1, dee, sam } = ctx;
  // Before the reported week (cumulative only).
  await surveyed(A, a1, dee._id, at('2026-06-30'), answer('Yes'));
  await surveyed(A, b1, sam._id, at('2026-07-01'), answer('No'));
  await knock(A, await door(A), dee, null, 'not_home', at('2026-07-02'));
  // The week of Jul 6 – Jul 12.
  await surveyed(A, a1, dee._id, at('2026-07-07'), answer('Yes', ['Schools']));
  const two = await door(A); // one door, two voters surveyed in one visit
  await knock(A, two, a1, dee._id, 'survey_submitted', at('2026-07-08'));
  await surveyOf(A, two, a1, dee._id, at('2026-07-08'), answer('No', ['Roads']));
  await surveyOf(A, two, a1, dee._id, at('2026-07-08', 13), answer('Yes', ['Schools', 'Roads']));
  await knock(A, await door(A), a1, dee._id, 'not_home', at('2026-07-08', 14));
  await surveyed(A, dee, null, at('2026-07-09'), answer('Yes')); // Dee's own door
  await surveyed(A, b1, sam._id, at('2026-07-09', 15), answer('Yes'));
  // One voter both teams surveyed (in two rounds — one response per voter per round): counts in
  // each team's report.
  const shared = await door(A);
  await knock(A, shared, a1, dee._id, 'survey_submitted', at('2026-07-10'));
  const sharedVoter = await surveyOf(A, shared, a1, dee._id, at('2026-07-10'), answer('Yes'));
  await knock(A, shared, b1, sam._id, 'survey_submitted', at('2026-07-10', 16), ctx.pass2);
  await surveyOf(A, shared, b1, sam._id, at('2026-07-10', 16), answer('No'), sharedVoter, ctx.pass2);
  await knock(A, await door(A), c1, ctx.maria._id, 'not_home', at('2026-07-11'));
  // Jul 20 – Jul 26: only the LEADS knock — Dee and Maria themselves, no crew row anywhere in the
  // week. Dee's crew has surveyed (earlier weeks); Maria's crew never has.
  await surveyed(A, dee, null, at('2026-07-21'), answer('No'));
  await knock(A, await door(A), dee, null, 'not_home', at('2026-07-22'));
  await knock(A, await door(A), ctx.maria, null, 'not_home', at('2026-07-23'));
  await knock(A, await door(A), ctx.maria, null, 'not_home', at('2026-07-24'));
  ctx.A = A;

  // ── Campaign B: earlier totals that move (its own crews: a crew is per campaign) ─────────────
  const B = await campaign('Parity B');
  await seedCrews(B);
  await surveyed(B, a1, dee._id, at('2026-06-30'), answer('Yes'));
  await knock(B, await door(B), dee, null, 'not_home', at('2026-07-01'));
  await surveyed(B, b1, sam._id, at('2026-07-02'), answer('No'));
  await knock(B, await door(B), c1, ctx.maria._id, 'not_home', at('2026-07-03'));
  await knock(B, await door(B), c1, ctx.maria._id, 'not_home', at('2026-07-03', 15));
  await surveyed(B, a1, dee._id, at('2026-07-07'), answer('Yes'));
  ctx.B = B;

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const rollup = async (camp, coordinatorId, { from = null, to }) => {
  const q = new URLSearchParams({ campaignId: String(camp._id), coordinatorId: String(coordinatorId), to, ...(from ? { from } : {}) });
  const res = await call('GET', `/admin/reports/campaign-rollup?${q}`);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.campaigns.length, 1);
  return res.json.campaigns[0];
};
const results = async (camp, coordinatorId, { from = null, to }) => {
  const q = new URLSearchParams({ campaignId: String(camp._id), coordinatorId: String(coordinatorId), to, ...(from ? { from } : {}) });
  const res = await call('GET', `/admin/reports/survey-results?${q}`);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  return res.json;
};
const counted = (options) => Object.fromEntries((options || []).filter((o) => o.count > 0).map((o) => [o.option, o.count]));

// Surveys, voters, every chart's option counts and both tag units, against the crew-filtered dashboard
// routes, for one window of a team report.
const assertSurveyParity = async (label, camp, report, lead, windowName, range) => {
  const w = report.stats[windowName];
  const r = await rollup(camp, lead._id, range);
  assert.strictEqual(w.totals.surveysTaken, r.surveysSubmitted, `${label} ${windowName}: surveys == /campaign-rollup`);
  assert.strictEqual(w.totals.surveyedVoters, r.surveyedVoters, `${label} ${windowName}: voters == /campaign-rollup`);
  const s = await results(camp, lead._id, range);
  assert.strictEqual(w.totals.surveysTaken, s.totalResponses, `${label} ${windowName}: surveys == /survey-results`);
  for (const key of ['support', 'issues']) {
    const ours = counted(w.surveyBreakdowns.find((b) => b.questionKey === key)?.options);
    const theirs = counted(s.questions.find((q) => q.key === key)?.options);
    assert.deepStrictEqual(ours, theirs, `${label} ${windowName}: "${key}" option counts == /survey-results`);
  }
  for (const tag of s.tags) {
    const mine = w.tagBreakdowns.find((t) => t.tag === tag.tag) || { identifiedVoters: 0, currentVoters: 0 };
    assert.strictEqual(mine.identifiedVoters, tag.voterCount, `${label} ${windowName}: ${tag.tag} identified == /survey-results`);
    assert.strictEqual(mine.currentVoters, tag.currentVoterCount, `${label} ${windowName}: ${tag.tag} still current == /survey-results`);
  }
  return { rollup: r, results: s };
};

test('team surveys, voters and tags match the crew-filtered /campaign-rollup and /survey-results, both windows', { skip }, async () => {
  const volunteer = await team(ctx.A, 'Volunteer team', [ctx.dee._id]);
  const paid = await team(ctx.A, 'Paid team', [ctx.sam._id]);
  const week = { weekStart: '2026-07-06', weekEnd: '2026-07-12' };
  const vol = await reportFor(ctx.A, { seriesId: volunteer._id, ...week });
  const pd = await reportFor(ctx.A, { seriesId: paid._id, ...week });
  const cum = { to: week.weekEnd };
  const per = { from: week.weekStart, to: week.weekEnd };
  const v1 = await assertSurveyParity('Volunteer', ctx.A, vol, ctx.dee, 'cumulative', cum);
  await assertSurveyParity('Volunteer', ctx.A, vol, ctx.dee, 'period', per);
  await assertSurveyParity('Paid', ctx.A, pd, ctx.sam, 'cumulative', cum);
  await assertSurveyParity('Paid', ctx.A, pd, ctx.sam, 'period', per);
  // The fixture is not trivial: two voters at one door, the lead's own survey, a voter both teams
  // surveyed (in each team's numbers), and tags.
  assert.strictEqual(vol.stats.period.totals.surveysTaken, 5);
  assert.strictEqual(vol.stats.period.totals.surveyedVoters, 5);
  assert.strictEqual(pd.stats.period.totals.surveyedVoters, 2, 'the shared voter counts for Paid too');
  assert.ok(v1.results.tags.some((t) => t.tag === 'Supporter' && t.voterCount > 0));
  // Doors, outside a lead-only window, match /team-breakdown (stage 1 pins the whole-window case).
  const tb = await call('GET', `/admin/reports/team-breakdown?campaignId=${ctx.A._id}&to=${week.weekEnd}`);
  const doorsOf = (res, id) => res.json.teams.find((t) => t.coordinatorId === String(id))?.doors || 0;
  assert.strictEqual(vol.stats.cumulative.totals.doorsKnocked, doorsOf(tb, ctx.dee._id));
  assert.strictEqual(pd.stats.cumulative.totals.doorsKnocked, doorsOf(tb, ctx.sam._id));
  ctx.volunteer = volunteer;
});

// /team-breakdown folds a lead's own doors onto her team only when she is in its lead set, which it
// builds from the window's crew-stamped DOORS — and from crew-stamped SURVEYS, whose `timestamp` window
// strictQuery strips (SurveyResponse has submittedAt, no timestamp), so on a survey campaign any lead
// whose crew has EVER surveyed there is folded in every window. The exception the plan names is
// therefore a lead whose crew never surveyed: Maria's. (Production runs strictQuery, as this suite.)
test('the lead-only week: /team-breakdown leaves the lead’s own doors in No team; the team report counts them', { skip }, async () => {
  const week = { weekStart: '2026-07-20', weekEnd: '2026-07-26' };
  const field = await team(ctx.A, 'Field team', [ctx.maria._id]);
  const report = await reportFor(ctx.A, { seriesId: field._id, ...week });
  assert.strictEqual(report.stats.period.totals.doorsKnocked, 2, 'Maria’s own two doors are the Field team’s week');
  const inWeek = await call('GET', `/admin/reports/team-breakdown?campaignId=${ctx.A._id}&from=${week.weekStart}&to=${week.weekEnd}`);
  assert.strictEqual(inWeek.status, 200);
  assert.strictEqual(inWeek.json.teams.find((t) => t.coordinatorId === String(ctx.maria._id)), undefined, 'no Maria row: her crew never knocked that week');
  assert.strictEqual(inWeek.json.teams.find((t) => t.coordinatorId === null)?.doors, 2, 'her doors sit in No team there');
  // Over the whole history her crew did knock, so the route folds her doors and the two agree again.
  const allTime = await call('GET', `/admin/reports/team-breakdown?campaignId=${ctx.A._id}&to=${week.weekEnd}`);
  assert.strictEqual(report.stats.cumulative.totals.doorsKnocked, allTime.json.teams.find((t) => t.coordinatorId === String(ctx.maria._id)).doors);
  // Dee's crew has surveyed here, so the route keeps her in its lead set even in this week: parity.
  const vol = await reportFor(ctx.A, { seriesId: ctx.volunteer._id, ...week });
  assert.strictEqual(vol.stats.period.totals.doorsKnocked, inWeek.json.teams.find((t) => t.coordinatorId === String(ctx.dee._id))?.doors);
  // Surveys never had the exception: the crew filter always includes the lead's own.
  await assertSurveyParity('Volunteer (lead-only week)', ctx.A, vol, ctx.dee, 'period', { from: week.weekStart, to: week.weekEnd });
  await assertSurveyParity('Field (lead-only week)', ctx.A, report, ctx.maria, 'period', { from: week.weekStart, to: week.weekEnd });
});

test('earlier totals name their cause: canvassers changed teams; the team’s crews changed; the ledgers changed', { skip }, async () => {
  const B = ctx.B;
  const volunteer = await team(B, 'Volunteer team', [ctx.dee._id]);
  const paid = await team(B, 'Paid team', [ctx.sam._id]);
  const week1 = { weekStart: '2026-06-29', weekEnd: '2026-07-05' };
  const vol1 = await reportFor(B, { seriesId: volunteer._id, ...week1 });
  const paid1 = await reportFor(B, { seriesId: paid._id, ...week1 });
  const whole1 = await reportFor(B, week1);
  for (const r of [vol1, paid1, whole1]) await publish(r);
  const vol2 = await next(vol1);
  const paid2 = await next(paid1);
  const whole2 = await next(whole1);

  // Bob moves from Sam's crew to Dee's: the re-stamp moves his past doors with him (owner ruling —
  // the current coordinator owns all history), and the move is recorded.
  await CanvassActivity.updateMany({ campaignId: B._id, userId: ctx.b1._id }, { $set: { coordinatorId: ctx.dee._id } });
  await SurveyResponse.updateMany({ campaignId: B._id, userId: ctx.b1._id }, { $set: { coordinatorId: ctx.dee._id } });
  await CoordinatorChange.create({ organizationId: ctx.org._id, campaignId: B._id, userId: ctx.b1._id, fromCoordinatorId: ctx.sam._id, toCoordinatorId: ctx.dee._id, source: 'admin_users' });
  // Paid team takes on Maria's crew as well.
  const crews = await call('PATCH', `/admin/client-reports/series/${paid._id}`, { coordinatorIds: [String(ctx.sam._id), String(ctx.maria._id)] });
  assert.strictEqual(crews.status, 200, JSON.stringify(crews.json));
  // A knock timed inside week 1 that synced late moves the whole campaign's earlier total.
  await knock(B, await door(B), ctx.a1, ctx.dee._id, 'not_home', at('2026-07-04'));

  // Recompute claims the build with the series' crews as they are NOW (Next froze them at the click).
  const reasonOf = async (draft) => {
    const claimed = await call('POST', `/admin/client-reports/${draft._id}/recompute`);
    assert.strictEqual(claimed.status, 202, JSON.stringify(claimed.json));
    const built = await runBuild(draft._id);
    const res = await call('GET', `/admin/client-reports/${built._id}`);
    assert.strictEqual(res.status, 200, JSON.stringify(res.json));
    return res.json.checks;
  };
  let c = await reasonOf(vol2);
  assert.strictEqual(c.earlierTotals.reason.code, 'canvassers_changed_teams');
  assert.strictEqual(c.earlierTotals.reason.text, 'canvassers changed teams');
  const doors = c.earlierTotals.changes.find((x) => x.card === 'doorsKnocked');
  assert.deepStrictEqual([doors.sent, doors.now, doors.delta], [vol1.stats.cumulative.totals.doorsKnocked, vol1.stats.cumulative.totals.doorsKnocked + 2, 2], 'Bob’s door and the late knock');
  assert.strictEqual(c.earlierTotals.compared.id, String(vol1._id));
  assert.strictEqual(c.earlierReportsRefreshed, 1, 'the real check: an earlier report whose totals changed since it was sent');

  c = await reasonOf(paid2);
  assert.strictEqual(c.earlierTotals.reason.code, 'crews_changed');
  assert.strictEqual(c.earlierTotals.reason.text, "the team's crews changed");

  c = await reasonOf(whole2);
  assert.strictEqual(c.earlierTotals.reason.code, 'records_changed');
  assert.deepStrictEqual(c.earlierTotals.changes.map((x) => [x.card, x.delta]), [['doorsKnocked', 1]], 'team-blind: only the late knock');

  // The client's line never carries a reason.
  const preview = await call('GET', `/admin/client-reports/${vol2._id}/preview`);
  assert.strictEqual(preview.json.report.earlierTotals.reason, undefined);
  assert.strictEqual(preview.json.report.earlierTotals.changes[0].sent, undefined);
});

// "Before you publish" on a team report (§F4, contract C1; NUM-2): the period's door visits team by
// team against the whole campaign — or the walk list — counted the way the build counts doors.
test('team sums: each team’s visits, visits two teams made, visits no team made — and they add up to the campaign', { skip }, async () => {
  const C = await Campaign.create({ organizationId: ctx.org._id, name: 'Parity C', type: 'survey', state: 'FL', isActive: true, surveyTemplateId: ctx.template._id, timeZone: 'America/Chicago' });
  await seedCrews(C);
  const n1 = await User.create({ firstName: 'Nia', lastName: 'Nocrew', email: 'nia.nocrew@parity.t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: n1._id, organizationId: ctx.org._id, role: 'canvasser', isActive: true });
  await CampaignAssignment.create({ campaignId: C._id, userId: n1._id, organizationId: ctx.org._id, coordinatorId: null });
  const north = await Effort.create({ organizationId: ctx.org._id, campaignId: C._id, name: 'North' });
  const { a1, b1, c1, dee, sam, maria } = ctx;
  const visit = async (hh, user, coordinatorId, actionType, when, { passId = ctx.pass, via = null } = {}) =>
    CanvassActivity.create({
      organizationId: ctx.org._id, campaignId: C._id, householdId: hh._id, userId: user._id, coordinatorId,
      actionType, timestamp: when, passId, effortId: hh.effortId || null, via, location: { lat: 27.95, lng: -82.46 },
    });
  const home = async (effortId = null) => {
    n += 1;
    return Household.create({
      organizationId: ctx.org._id, campaignId: C._id, isActive: true, effortId,
      addressLine1: `${n} Sums Rd`, city: 'Tampa', state: 'FL', zipCode: '33601', normalizedAddress: `SUMS${n}`,
      location: { type: 'Point', coordinates: [-82.46 + n / 1e3, 27.95] },
    });
  };
  // The week of Aug 3 – Aug 9.
  const h1 = await home(north._id);
  await visit(h1, a1, dee._id, 'not_home', at('2026-08-04'));
  const h2 = await home(north._id); // two crews of ONE team (Paid) in one round: one visit, one team
  await visit(h2, b1, sam._id, 'not_home', at('2026-08-04'));
  await visit(h2, c1, maria._id, 'refused', at('2026-08-04', 15));
  const h3 = await home(north._id); // both teams in one round
  await visit(h3, a1, dee._id, 'not_home', at('2026-08-05'));
  await visit(h3, b1, sam._id, 'not_home', at('2026-08-05', 15));
  await visit(await home(), dee, null, 'not_home', at('2026-08-05', 16)); // Dee's own door: Volunteer
  await visit(await home(), n1, null, 'not_home', at('2026-08-06')); // a canvasser in no crew: no team
  await visit(await home(), dee, null, 'not_home', at('2026-08-06', 15), { via: 'bulk' }); // entered in bulk: no team
  const h7 = await home(); // two rounds, one team each: two visits
  await visit(h7, a1, dee._id, 'not_home', at('2026-08-07'));
  await visit(h7, b1, sam._id, 'not_home', at('2026-08-07', 15), { passId: ctx.pass2 });
  await visit(await home(), a1, dee._id, 'not_home', at('2026-07-30')); // before the period
  await visit(await home(), a1, dee._id, 'restricted', at('2026-08-08')); // never a knock

  const volunteer = await team(C, 'Volunteer team', [dee._id]);
  const paid = await team(C, 'Paid team', [sam._id, maria._id]);
  const week = { weekStart: '2026-08-03', weekEnd: '2026-08-09' };
  const vol = await reportFor(C, { seriesId: volunteer._id, ...week });
  const pd = await reportFor(C, { seriesId: paid._id, ...week });
  const whole = await reportFor(C, week);
  const made = await call('POST', '/admin/client-reports', { campaignId: String(C._id), teamSeriesId: String(volunteer._id), effortId: String(north._id), ...week });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  const volNorth = await runBuild(made.json.report._id);
  assert.deepStrictEqual(
    [vol, pd, whole, volNorth].map((r) => r.stats.period.totals.doorsKnocked),
    [4, 3, 8, 2],
    'Volunteer: h1, h3, Dee’s own, h7 · Paid: h2, h3, h7 again · whole campaign: all eight visits · Volunteer on North: h1, h3'
  );
  // A knock that reached the server after these numbers were built is outside every figure, as it is
  // outside the reports (the live snapshot's cut-off).
  await visit(await home(), a1, dee._id, 'not_home', at('2026-08-08'));

  const sumsOf = async (r) => {
    const res = await call('GET', `/admin/client-reports/${r._id}`);
    assert.strictEqual(res.status, 200, JSON.stringify(res.json));
    const t = res.json.checks.team;
    assert.strictEqual(t.teams[0].isThis, true, 'this report’s team first');
    assert.strictEqual(t.teams[0].doorVisits, r.stats.period.totals.doorsKnocked, 'this team’s visits are the report’s own period doors');
    assert.strictEqual(t.teamsTotal, t.teams.reduce((s, x) => s + x.doorVisits, 0));
    assert.strictEqual(t.teamsTotal - t.multiTeamDoorVisits + t.noTeamDoorVisits, t.scopeDoorVisits, 'the sums reconcile with the base scope');
    return { ...t, byLabel: Object.fromEntries(t.teams.map((x) => [x.label, x.doorVisits])) };
  };
  let s = await sumsOf(vol);
  assert.deepStrictEqual(s.teams.map((x) => [x.label, x.seriesId]), [['Volunteer team', String(volunteer._id)], ['Paid team', String(paid._id)]]);
  assert.deepStrictEqual(s.byLabel, { 'Volunteer team': 4, 'Paid team': 3 });
  assert.deepStrictEqual(
    [s.multiTeamDoorVisits, s.noTeamDoorVisits, s.scopeDoorVisits, s.scopeLabel, s.canvassers],
    [1, 2, 8, 'the whole campaign', 2],
    'only h3 was two TEAMS (h2 is two crews of one); no crew and bulk are no team; the scope is the whole-campaign report’s doors'
  );
  assert.strictEqual(s.scopeDoorVisits, whole.stats.period.totals.doorsKnocked);
  s = await sumsOf(volNorth);
  assert.deepStrictEqual(s.byLabel, { 'Volunteer team': 2, 'Paid team': 2 });
  assert.deepStrictEqual([s.multiTeamDoorVisits, s.noTeamDoorVisits, s.scopeDoorVisits, s.scopeLabel], [1, 0, 3, 'North']);

  // Maria's crew moves to a new team. The Paid report keeps the crews it froze (so its own visits
  // still match its numbers); Night team counts her crew now, so h2 is in two teams' reports.
  const moved = await call('PATCH', `/admin/client-reports/series/${paid._id}`, { coordinatorIds: [String(sam._id)] });
  assert.strictEqual(moved.status, 200, JSON.stringify(moved.json));
  await team(C, 'Night team', [maria._id]);
  s = await sumsOf(pd);
  assert.deepStrictEqual(s.teams.map((x) => x.label), ['Paid team', 'Night team', 'Volunteer team'], 'this team first, then by name');
  assert.deepStrictEqual(s.byLabel, { 'Paid team': 3, 'Night team': 1, 'Volunteer team': 4 });
  assert.deepStrictEqual([s.multiTeamDoorVisits, s.noTeamDoorVisits, s.scopeDoorVisits], [2, 2, 8], 'h2 (Paid + Night) and h3 (Paid + Volunteer)');
});
