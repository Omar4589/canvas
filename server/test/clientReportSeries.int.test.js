import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Client-report SERIES and team reports — docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F4 as amended by
// §O4, against the real app and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/crseries node --test test/clientReportSeries.int.test.js
//
// The five partial-unique indexes (built here by syncIndexes, as the web and worker do at boot), every
// flow §O4 names (a crew in one team only, current or past; labels; the team-changed card's keep /
// remove / change crews / end; continuing an ended team; a team on a walk list following its
// parent), and team numbers (each team's own work, parity with /team-breakdown, the team map's own
// answers, no goal, scoped mock-GPS counts, a refresh with the crews it was built with).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-client-report-series';
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
const { ClientReportMapPoint } = await import('../src/models/ClientReportMapPoint.js');
const { ClientReportSeries } = await import('../src/models/ClientReportSeries.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { processClientReportJob } = await import('../src/services/reports/clientReportBuilds.js');
const { ensureSeries } = await import('../src/services/reports/clientReportSeries.js');

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

const RANGE_START = new Date('2026-07-06T05:00:00Z');
const RANGE_END = new Date('2026-07-13T05:00:00Z');
const at = (h) => new Date(RANGE_START.getTime() + (24 + h) * 3600e3);

let hhN = 0;
const door = async () => {
  hhN += 1;
  return Household.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, isActive: true,
    addressLine1: `${hhN} Team St`, city: 'Tampa', state: 'FL', zipCode: '33601', normalizedAddress: `TEAM${hhN}`,
    location: { type: 'Point', coordinates: [-82.46 + hhN / 1e3, 27.95] },
  });
};
const knock = (hh, user, coordinatorId, actionType, h, extra = {}) =>
  CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: hh._id, userId: user._id, coordinatorId,
    actionType, timestamp: at(h), passId: ctx.pass, location: { lat: 27.95, lng: -82.46 }, ...extra,
  });
let vN = 0;
const surveyAt = async (hh, user, coordinatorId, optionId, text, h) => {
  vN += 1;
  const v = await Voter.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: hh._id, stateVoterId: `TS${vN}`, firstName: 'T', lastName: `S${vN}`, fullName: `T S${vN}` });
  return SurveyResponse.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: hh._id, voterId: v._id, userId: user._id, coordinatorId,
    surveyTemplateId: ctx.template._id, surveyTemplateVersion: 1, passId: ctx.pass, location: { lat: 27.95, lng: -82.46 },
    submittedAt: at(h), answers: [{ questionKey: 'support', questionLabel: 'Support?', optionIds: [optionId], answer: text }],
  });
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await ClientReportSeries.syncIndexes();
  const org = await Organization.create({ name: 'Teams Org', slug: 'teams-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const mk = async (first, last, role = 'canvasser') => {
    const u = await User.create({ firstName: first, lastName: last, email: `${first.toLowerCase()}.${last.toLowerCase()}@t.co`, passwordHash: await User.hashPassword('Str0ng!Passw0rd'), isActive: true });
    await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
    return u;
  };
  const admin = await mk('Ada', 'Admin', 'admin');
  const dee = await mk('Dee', 'Lead', 'lead');
  const sam = await mk('Sam', 'Lead', 'lead');
  const maria = await mk('Maria', 'Lead', 'lead');
  const a1 = await mk('Ann', 'Crewone');
  const b1 = await mk('Bob', 'Crewtwo');
  const c1 = await mk('Cal', 'Crewthree');
  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'S', isActive: true,
    questions: [{ key: 'support', label: 'Support?', type: 'single_choice', options: [{ id: 'y', text: 'Yes' }, { id: 'n', text: 'No' }] }],
  });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Teams', type: 'survey', state: 'FL', isActive: true, surveyTemplateId: template._id, timeZone: 'America/Chicago', doorGoal: 50 });
  const north = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const marco = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'Marco Island' });
  for (const [u, c] of [[a1, dee], [b1, sam], [c1, maria], [dee, null], [sam, null], [maria, null]]) {
    await CampaignAssignment.create({ campaignId: camp._id, userId: u._id, organizationId: org._id, coordinatorId: c ? c._id : null });
  }
  Object.assign(ctx, { org, camp, template, north, marco, admin, dee, sam, maria, a1, b1, c1, pass: new ObjectId(), token: signUserToken(admin) });

  // Dee's crew: 3 doors (one surveyed Yes); Dee's own door; Sam's crew: 2 doors (one surveyed No);
  // one door BOTH crews knocked in the same round, each surveying it differently; Maria's crew: 1.
  const d1 = await door(); await knock(d1, a1, dee._id, 'survey_submitted', 1); await surveyAt(d1, a1, dee._id, 'y', 'Yes', 1);
  const d2 = await door(); await knock(d2, a1, dee._id, 'not_home', 2);
  const d3 = await door(); await knock(d3, a1, dee._id, 'refused', 3);
  const own = await door(); await knock(own, dee, null, 'not_home', 4);
  const s1 = await door(); await knock(s1, b1, sam._id, 'survey_submitted', 5); await surveyAt(s1, b1, sam._id, 'n', 'No', 5);
  const s2 = await door(); await knock(s2, b1, sam._id, 'not_home', 6);
  const both = await door();
  await knock(both, a1, dee._id, 'survey_submitted', 7); await surveyAt(both, a1, dee._id, 'y', 'Yes', 7);
  await knock(both, b1, sam._id, 'survey_submitted', 8); await surveyAt(both, b1, sam._id, 'n', 'No', 8);
  // A desk restriction after Dee's crew knocked d2: the team map shows it.
  await knock(d2, admin, null, 'restricted', 9, { via: 'bulk' });
  const m1 = await door(); await knock(m1, c1, maria._id, 'not_home', 10, { location: { lat: 27.95, lng: -82.46, mocked: true } });
  Object.assign(ctx, { d1, d2, d3, own, s1, s2, both, m1 });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const runBuild = async (reportId) => {
  const jobId = new ObjectId().toHexString();
  await ClientReport.updateOne({ _id: reportId }, { $set: { 'build.status': 'queued', 'build.jobId': jobId, 'build.startedAt': new Date() } });
  return processClientReportJob({ id: jobId, data: { reportId: String(reportId) } }, 'token');
};
// A later build of the same draft is claimed the way the builder claims it (its inputs, crews
// included, frozen from the settings at the claim), then run.
const rebuild = async (reportId) => {
  const res = await call('POST', `/admin/client-reports/${reportId}/recompute`);
  assert.strictEqual(res.status, 202, JSON.stringify(res.json));
  return runBuild(reportId);
};
const teamReport = async (seriesId, extra = {}) => {
  // allowDuplicate: one week built several times on purpose (the duplicate guard has its own suite).
  const res = await call('POST', '/admin/client-reports', { campaignId: String(ctx.camp._id), weekStart: '2026-07-06', weekEnd: '2026-07-12', seriesId: String(seriesId), allowDuplicate: true, ...extra });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  return res.json.report;
};
const builtTeam = async (seriesId) => {
  const r = await teamReport(seriesId);
  const out = await runBuild(r._id);
  return { out, report: await ClientReport.findById(r._id).lean() };
};

test('the five partial-unique indexes, exactly as §O4 states them', { skip }, async () => {
  const idx = await ClientReportSeries.collection.indexes();
  const byName = Object.fromEntries(idx.map((i) => [i.name, i]));
  assert.deepStrictEqual(byName.series_label_unique.key, { campaignId: 1, labelKey: 1 });
  assert.deepStrictEqual(byName.series_label_unique.partialFilterExpression, { endedAt: null, kind: { $in: ['campaign', 'walk_list', 'team'] } });
  assert.deepStrictEqual(byName.series_campaign_unique.partialFilterExpression, { endedAt: null, kind: 'campaign' });
  assert.deepStrictEqual(byName.series_walk_list_unique.key, { campaignId: 1, effortId: 1 });
  assert.deepStrictEqual(byName.series_crew_unique.key, { campaignId: 1, crewKeys: 1 });
  assert.deepStrictEqual(byName.series_crew_unique.partialFilterExpression, { endedAt: null, kind: 'team', 'crewKeys.0': { $exists: true } });
  assert.deepStrictEqual(byName.series_team_walk_list_unique.key, { campaignId: 1, teamSeriesId: 1, effortId: 1 });
  for (const n of ['series_label_unique', 'series_campaign_unique', 'series_walk_list_unique', 'series_crew_unique', 'series_team_walk_list_unique']) {
    assert.strictEqual(byName[n].unique, true, `${n} is unique`);
  }
});

test('ensureSeries under concurrency: one campaign series, one per walk list, both kinds side by side', { skip }, async () => {
  const args = { organizationId: ctx.org._id, campaignId: ctx.camp._id };
  const many = await Promise.all([1, 2, 3, 4].map(() => ensureSeries({ ...args, kind: 'campaign' })));
  assert.strictEqual(new Set(many.map((s) => String(s._id))).size, 1, 'four concurrent finds-or-creates, one series');
  const walk = await Promise.all([1, 2, 3].map(() => ensureSeries({ ...args, kind: 'walk_list', effortId: ctx.north._id, effortName: 'North' })));
  assert.strictEqual(new Set(walk.map((s) => String(s._id))).size, 1);
  assert.strictEqual(await ClientReportSeries.countDocuments({ campaignId: ctx.camp._id, endedAt: null }), 2, 'two non-team series coexist');
  ctx.campaignSeries = many[0];
  // A second walk list with the same name gets " (2)" against the active labels.
  const dup = await Effort.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, name: 'North' });
  const second = await ensureSeries({ ...args, kind: 'walk_list', effortId: dup._id, effortName: 'North' });
  assert.strictEqual(second.label, 'North (2)');
});

test('teams: names never carry a canvasser’s name, a crew is in one team only, the campaign’s own name is taken', { skip }, async () => {
  let res = await call('POST', '/admin/client-reports/series', { campaignId: String(ctx.camp._id), label: "Dee's crew", coordinatorIds: [String(ctx.dee._id)] });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.json.code, 'TEAM_LABEL_HAS_NAME');
  assert.deepStrictEqual(res.json.names, ['Dee'], 'the name as written on the record, never lower-cased');
  // Matched case- and accent-blind, named as written: "DEE TEAM" still finds Dee.
  res = await call('POST', '/admin/client-reports/series', { campaignId: String(ctx.camp._id), label: 'DEE TEAM', coordinatorIds: [String(ctx.dee._id)] });
  assert.strictEqual(res.json.code, 'TEAM_LABEL_HAS_NAME');
  assert.deepStrictEqual(res.json.names, ['Dee']);
  res = await call('POST', '/admin/client-reports/series', { campaignId: String(ctx.camp._id), label: 'Volunteer team', coordinatorIds: [String(ctx.dee._id)] });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  ctx.volunteer = res.json.series;
  // Several crews in one team (owner ruling 10-24).
  res = await call('POST', '/admin/client-reports/series', { campaignId: String(ctx.camp._id), label: 'Paid team', coordinatorIds: [String(ctx.sam._id), String(ctx.maria._id), String(ctx.sam._id)] });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  ctx.paid = res.json.series;
  assert.strictEqual(ctx.paid.coordinatorIds.length, 2, 'the crews are de-duplicated');
  res = await call('POST', '/admin/client-reports/series', { campaignId: String(ctx.camp._id), label: 'Third team', coordinatorIds: [String(ctx.maria._id)] });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.json.code, 'CREW_IN_OTHER_TEAM');
  assert.strictEqual(res.json.otherLabel, 'Paid team');
  res = await call('POST', '/admin/client-reports/series', { campaignId: String(ctx.camp._id), label: 'paid team ', coordinatorIds: [String(ctx.dee._id)] });
  assert.ok([409].includes(res.status));
  res = await call('POST', '/admin/client-reports/series', { campaignId: String(ctx.camp._id), label: 'Whole Campaign', coordinatorIds: [] });
  assert.strictEqual(res.status, 400, 'a team needs a crew');
  const picker = await call('GET', `/admin/client-reports/series?campaignId=${ctx.camp._id}`);
  assert.strictEqual(picker.status, 200);
  assert.strictEqual(picker.json.teamsReady, true);
  const crewOfMaria = picker.json.crews.find((c) => c.coordinatorId === String(ctx.maria._id));
  assert.strictEqual(crewOfMaria.inSeries.label, 'Paid team', 'a crew in another team shows that team');
});

test('a walk-list label that names a canvasser gets a warning the operator can confirm', { skip }, async () => {
  // "Marco Island" — a place — matches nobody here; give the campaign a canvasser named Marco.
  const marco = await User.create({ firstName: 'Marco', lastName: 'Polo', email: 'marco@t.co', passwordHash: 'x', isActive: true });
  await CampaignAssignment.create({ campaignId: ctx.camp._id, userId: marco._id, organizationId: ctx.org._id, coordinatorId: ctx.sam._id });
  let res = await call('POST', '/admin/client-reports', { campaignId: String(ctx.camp._id), weekStart: '2026-07-06', weekEnd: '2026-07-12', effortId: String(ctx.marco._id) });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.json.code, 'WALK_LIST_LABEL_HAS_NAME');
  assert.strictEqual(res.json.confirmable, true);
  res = await call('POST', '/admin/client-reports', { campaignId: String(ctx.camp._id), weekStart: '2026-07-06', weekEnd: '2026-07-12', effortId: String(ctx.marco._id), confirmLabel: true });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  assert.strictEqual(res.json.report.scope.label, 'Marco Island');
});

test("team numbers: each team's own work — a door both teams reached counts in both; parity with /team-breakdown", { skip }, async () => {
  const vol = await builtTeam(ctx.volunteer._id);
  assert.ok(vol.out.committed, JSON.stringify(vol.out));
  const paid = await builtTeam(ctx.paid._id);
  assert.ok(paid.out.committed);
  // Volunteer (Dee): d1, d2, d3, her own door, the shared door = 5. Paid (Sam + Maria): s1, s2, the shared door, m1 = 4.
  assert.strictEqual(vol.report.stats.cumulative.totals.doorsKnocked, 5);
  assert.strictEqual(paid.report.stats.cumulative.totals.doorsKnocked, 4);
  assert.strictEqual(vol.report.scope.kind, 'team');
  assert.strictEqual(vol.report.scope.label, 'Volunteer team');
  const tb = await call('GET', `/admin/reports/team-breakdown?campaignId=${ctx.camp._id}&to=2026-07-12`);
  assert.strictEqual(tb.status, 200, JSON.stringify(tb.json));
  const doorsOf = (id) => tb.json.teams.find((t) => t.coordinatorId === String(id))?.doors || 0;
  assert.strictEqual(vol.report.stats.cumulative.totals.doorsKnocked, doorsOf(ctx.dee._id), 'Volunteer team == Dee’s row');
  assert.strictEqual(paid.report.stats.cumulative.totals.doorsKnocked, doorsOf(ctx.sam._id) + doorsOf(ctx.maria._id), 'Paid team == Sam’s + Maria’s rows');
  // Surveys: each team's own.
  assert.strictEqual(vol.report.stats.cumulative.totals.surveysTaken, 2);
  assert.strictEqual(paid.report.stats.cumulative.totals.surveysTaken, 2);
  // No door goal on a team report.
  assert.strictEqual(vol.report.goalSnapshot.target, null);
  const goal = await call('PATCH', `/admin/client-reports/${vol.report._id}`, { visibility: { showGoal: true } });
  assert.strictEqual(goal.json.code, 'NO_GOAL_SNAPSHOT');
  assert.match(goal.json.error, /team report/);
  ctx.volReport = vol.report;
  ctx.paidReport = paid.report;
});

test('the coordinator-change confirm names the client-report teams whose numbers move (§O4)', { skip }, async () => {
  const affected = (ids, token = ctx.token) =>
    fetch(`${base}/api/admin/client-reports/series/affected?campaignId=${ctx.camp._id}&coordinatorIds=${ids.map(String).join(',')}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': String(ctx.org._id) },
    }).then(async (r) => ({ status: r.status, json: await r.json() }));
  let res = await affected([ctx.dee._id]);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.deepStrictEqual(res.json.teams, [{ seriesId: String(ctx.volunteer._id), label: 'Volunteer team' }]);
  // Moving a canvasser from Dee's crew to Maria's moves numbers in both teams, named once each.
  res = await affected([ctx.maria._id, ctx.dee._id, ctx.sam._id]);
  assert.deepStrictEqual(res.json.teams.map((t) => t.label), ['Paid team', 'Volunteer team']);
  // Nobody's crew is in a team: nothing to name. A team with no report yet has no numbers to move.
  assert.deepStrictEqual((await affected([ctx.a1._id])).json.teams, []);
  const lonely = new ObjectId();
  const empty = await ClientReportSeries.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, kind: 'team', label: 'Empty team', labelKey: 'empty team', coordinatorIds: [lonely], crewKeys: [lonely] });
  try {
    assert.deepStrictEqual((await affected([lonely])).json.teams, []);
  } finally {
    await ClientReportSeries.deleteOne({ _id: empty._id });
  }
  assert.deepStrictEqual((await affected([])).json.teams, []);
  assert.strictEqual((await affected(['not-an-id'])).status, 400);
  // Campaign-scoped like every series route: a lead without a grant on this campaign is refused.
  assert.strictEqual((await affected([ctx.dee._id], signUserToken(ctx.dee))).status, 403);
});

test("the team map: the team's own doors, with the team's own latest result and answers", { skip }, async () => {
  const pts = async (r) => new Map((await ClientReportMapPoint.find({ clientReportId: r._id, snapshotId: r.snapshotId }).lean()).map((p) => [String(p.householdId), p]));
  const vol = await pts(ctx.volReport);
  const paid = await pts(ctx.paidReport);
  assert.ok(vol.has(String(ctx.d1._id)) && !vol.has(String(ctx.s1._id)), 'only the team’s doors');
  assert.strictEqual(vol.get(String(ctx.both._id)).answers[0].answer, 'Yes', "Volunteer's own answer at the shared door");
  assert.strictEqual(paid.get(String(ctx.both._id)).answers[0].answer, 'No', "Paid's own answer at the shared door");
  assert.strictEqual(vol.get(String(ctx.d2._id)).status, 'restricted', 'a restriction on a door the team knocked shows');
});

test('mock-GPS flags follow the report’s scope', { skip }, async () => {
  const vol = await call('GET', `/admin/client-reports/${ctx.volReport._id}`);
  const paid = await call('GET', `/admin/client-reports/${ctx.paidReport._id}`);
  assert.strictEqual(vol.json.openMockFlags, 0, "Maria's crew's mocked knock is not the Volunteer team's");
  assert.strictEqual(paid.json.openMockFlags, 1);
});

test('TEAM_CHANGED: a crew lead who leaves stops the next recompute; keep (default), remove, end, continue', { skip }, async () => {
  // Dee stops running a crew: her canvasser leaves her crew.
  await CampaignAssignment.updateOne({ campaignId: ctx.camp._id, userId: ctx.a1._id }, { $set: { coordinatorId: null } });
  const r = await teamReport(ctx.volunteer._id);
  const out = await runBuild(r._id);
  assert.deepStrictEqual(out, { stopped: 'team-changed' });
  let doc = await ClientReport.findById(r._id).lean();
  assert.strictEqual(doc.build.error.code, 'TEAM_CHANGED');
  assert.deepStrictEqual(doc.build.error.departed, [String(ctx.dee._id)]);
  const card = await call('GET', `/admin/client-reports/series/${ctx.volunteer._id}/team-changed`);
  assert.strictEqual(card.status, 200, JSON.stringify(card.json));
  assert.strictEqual(card.json.departed[0].name, 'Dee Lead');
  assert.strictEqual(card.json.departed[0].noCrew, 1, 'her canvasser now has no crew');
  assert.strictEqual(card.json.departed[0].removeDoors, 5, 'what removing her past doors takes out: the 5 doors that leave below');

  // Keep her past doors (the default): she moves to past, still counted, exempt from the check.
  let res = await call('PATCH', `/admin/client-reports/series/${ctx.volunteer._id}`, { keepPast: [String(ctx.dee._id)] });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.deepStrictEqual(res.json.series.pastCoordinatorIds.map(String), [String(ctx.dee._id)]);
  assert.ok((await rebuild(r._id)).committed);
  doc = await ClientReport.findById(r._id).lean();
  assert.strictEqual(doc.stats.cumulative.totals.doorsKnocked, 5, 'her past doors still count');

  // A crew in a team's PAST is still in that team: another team can't take it.
  res = await call('POST', '/admin/client-reports/series', { campaignId: String(ctx.camp._id), label: 'New volunteers', coordinatorIds: [String(ctx.dee._id)] });
  assert.ok([400, 409].includes(res.status), JSON.stringify(res.json));

  // Remove them: her doors leave the team's numbers.
  res = await call('PATCH', `/admin/client-reports/series/${ctx.volunteer._id}`, { removePast: [String(ctx.dee._id)] });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.json.series.crewKeys, []);
  assert.ok((await rebuild(r._id)).committed);
  doc = await ClientReport.findById(r._id).lean();
  assert.strictEqual(doc.stats.cumulative.totals.doorsKnocked, 0, 'a team with no crews counts nothing, never everything');

  // A past coordinator who runs a crew again stops the recompute too, until made current.
  await CampaignAssignment.updateOne({ campaignId: ctx.camp._id, userId: ctx.a1._id }, { $set: { coordinatorId: ctx.dee._id } });
  res = await call('PATCH', `/admin/client-reports/series/${ctx.volunteer._id}`, { coordinatorIds: [String(ctx.dee._id)] });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));

  // End this team (and its open draft): no new report in it; reusing its name offers Continue.
  const published = await teamReport(ctx.volunteer._id);
  assert.ok((await runBuild(published._id)).committed);
  const pdoc = await ClientReport.findById(published._id).lean();
  assert.strictEqual((await call('POST', `/admin/client-reports/${published._id}/publish`, { snapshotId: String(pdoc.snapshotId), editVersion: pdoc.editVersion })).status, 200);
  res = await call('PATCH', `/admin/client-reports/series/${ctx.volunteer._id}`, { end: true, deleteOpenDrafts: true });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await ClientReport.countDocuments({ _id: r._id }), 0, 'its open draft deleted');
  res = await call('POST', '/admin/client-reports', { campaignId: String(ctx.camp._id), weekStart: '2026-07-13', weekEnd: '2026-07-19', seriesId: String(ctx.volunteer._id) });
  assert.strictEqual(res.json.code, 'SERIES_ENDED');
  res = await call('POST', `/admin/client-reports/${published._id}/next`);
  assert.strictEqual(res.json.code, 'SERIES_ENDED');
  res = await call('POST', '/admin/client-reports/series', { campaignId: String(ctx.camp._id), label: 'Volunteer Team', coordinatorIds: [String(ctx.dee._id)] });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.json.code, 'SERIES_NAME_ENDED');
  assert.strictEqual(res.json.seriesId, String(ctx.volunteer._id));
  res = await call('PATCH', `/admin/client-reports/series/${ctx.volunteer._id}`, { continue: true, coordinatorIds: [String(ctx.dee._id)] });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.series.endedAt, null);
  res = await call('POST', `/admin/client-reports/${published._id}/next`);
  assert.strictEqual(res.status, 201, 'continued: Next works again');
});

test('WALK-3: History names the team on crews-changed, ended and continued rows — and Continue leaves a row', { skip }, async () => {
  // The flow above changed the Volunteer team's crews, ended it and continued it.
  const hist = await call('GET', `/admin/campaigns/${ctx.camp._id}/history?include=client_reports`);
  assert.strictEqual(hist.status, 200, JSON.stringify(hist.json));
  const rows = hist.json.items.filter((i) => i.seriesId === String(ctx.volunteer._id));
  const of = (field) => rows.filter((i) => i.field === `clientReportSeries.${field}`);
  assert.ok(of('crewsChanged').length >= 3, 'keep, remove and change crews each wrote a row');
  assert.ok(of('crewsChanged').every((i) => i.toValue.label === 'Volunteer team'), 'each names the team');
  assert.deepStrictEqual(of('ended').map((i) => i.toValue), [{ label: 'Volunteer team' }]);
  assert.strictEqual(of('continued').length, 1, 'Continue writes its own row');
  assert.deepStrictEqual(of('continued')[0].toValue, { label: 'Volunteer team', coordinatorIds: [String(ctx.dee._id)] });
  assert.ok(new Date(of('continued')[0].at) >= new Date(of('ended')[0].at), 'after the end');
  // A name the client reads, never a canvasser's: the rows carry the team's label and crew ids only.
  assert.ok(!JSON.stringify(rows).includes('Dee Lead'));
});

test('a team on a walk list follows its parent: its name, and its end', { skip }, async () => {
  const res = await call('POST', '/admin/client-reports', { campaignId: String(ctx.camp._id), weekStart: '2026-07-06', weekEnd: '2026-07-12', teamSeriesId: String(ctx.paid._id), effortId: String(ctx.north._id) });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  assert.strictEqual(res.json.report.scope.kind, 'team_walk_list');
  assert.strictEqual(res.json.report.scope.label, 'Paid team · North');
  const child = await ClientReportSeries.findById(res.json.report.seriesId).lean();
  assert.strictEqual(String(child.teamSeriesId), String(ctx.paid._id));
  // Two teams on one walk list, and one team on two walk lists, both fine (§O4).
  const other = await call('POST', '/admin/client-reports', { campaignId: String(ctx.camp._id), weekStart: '2026-07-06', weekEnd: '2026-07-12', teamSeriesId: String(ctx.volunteer._id), effortId: String(ctx.north._id) });
  assert.strictEqual(other.status, 201, JSON.stringify(other.json));
  await call('PATCH', `/admin/client-reports/series/${ctx.paid._id}`, { label: 'Staff team' });
  const picker = await call('GET', `/admin/client-reports/series?campaignId=${ctx.camp._id}`);
  assert.strictEqual(picker.json.series.find((s) => s.id === String(child._id)).label, 'Staff team · North', 'the derived name follows the rename');
  await call('PATCH', `/admin/client-reports/series/${ctx.paid._id}`, { end: true });
  const ended = await call('POST', '/admin/client-reports', { campaignId: String(ctx.camp._id), weekStart: '2026-07-13', weekEnd: '2026-07-19', seriesId: String(child._id) });
  assert.strictEqual(ended.json.code, 'SERIES_ENDED', 'it reads as ended when its parent is');
});

test('a refresh of a sent team report rebuilds with the crews it was built with', { skip }, async () => {
  const res = await call('POST', '/admin/client-reports/series', { campaignId: String(ctx.camp._id), label: 'Canvass team', coordinatorIds: [String(ctx.sam._id)] });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  const { report } = await builtTeam(res.json.series._id);
  assert.strictEqual((await call('POST', `/admin/client-reports/${report._id}/publish`, { snapshotId: String(report.snapshotId), editVersion: report.editVersion })).status, 200);
  await call('PATCH', `/admin/client-reports/series/${res.json.series._id}`, { coordinatorIds: [String(ctx.sam._id), String(ctx.maria._id)] });
  const refresh = await call('POST', `/admin/client-reports/${report._id}/refresh`, {});
  assert.strictEqual(refresh.status, 202, JSON.stringify(refresh.json));
  const doc = await ClientReport.findById(report._id).lean();
  assert.deepStrictEqual(doc.build.inputs.coordinatorIds.map(String), [String(ctx.sam._id)], 'the frozen crews, never the current ones');
});

test('an organization without team attribution gets TEAM_ATTRIBUTION_NOT_READY', { skip }, async () => {
  await Organization.updateOne({ _id: ctx.org._id }, { $unset: { teamAttributionReadyAt: 1 } });
  try {
    const res = await call('POST', '/admin/client-reports/series', { campaignId: String(ctx.camp._id), label: 'Late team', coordinatorIds: [String(ctx.maria._id)] });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.json.code, 'TEAM_ATTRIBUTION_NOT_READY');
    const picker = await call('GET', `/admin/client-reports/series?campaignId=${ctx.camp._id}`);
    assert.strictEqual(picker.json.teamsReady, false);
  } finally {
    await Organization.updateOne({ _id: ctx.org._id }, { $set: { teamAttributionReadyAt: new Date() } });
  }
});

// NUM-4 (code review round 1): "Remove them — the team's totals drop by N doors" counted every door
// round her crew ever knocked — including a door another crew of the same team knocked that round
// (which stays in the team) and knocks after the report's period. It is now the team's door count
// WITH her crew minus WITHOUT it, both up to the report's end, counted as the build counts.
test("NUM-4: Remove them's door count is exactly what the team's totals lose", { skip }, async () => {
  const mk = async (first) => {
    const u = await User.create({ firstName: first, lastName: 'Quill', email: `${first.toLowerCase()}.quill@t.co`, passwordHash: 'x', isActive: true });
    await Membership.create({ userId: u._id, organizationId: ctx.org._id, role: 'lead', isActive: true });
    return u;
  };
  const camp = await Campaign.create({ organizationId: ctx.org._id, name: 'Num four', type: 'survey', state: 'FL', isActive: true, surveyTemplateId: ctx.template._id, timeZone: 'America/Chicago' });
  const [lia, rae, m1, m2] = [await mk('Lia'), await mk('Rae'), await mk('Mo'), await mk('Ned')];
  for (const [u, c] of [[m1, lia], [m2, rae], [lia, null], [rae, null]]) {
    await CampaignAssignment.create({ campaignId: camp._id, userId: u._id, organizationId: ctx.org._id, coordinatorId: c ? c._id : null });
  }
  const pass = new ObjectId();
  let n = 0;
  const home = async () => {
    n += 1;
    return Household.create({
      organizationId: ctx.org._id, campaignId: camp._id, isActive: true, addressLine1: `${n} Four St`, city: 'Tampa', state: 'FL', zipCode: '33601',
      normalizedAddress: `NUMFOUR${n}`, location: { type: 'Point', coordinates: [-82.4 + n / 1e3, 27.9] },
    });
  };
  const hit = (hh, user, coordinatorId, when) =>
    CanvassActivity.create({ organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, userId: user._id, coordinatorId, actionType: 'not_home', timestamp: when, passId: pass, location: { lat: 27.9, lng: -82.4 } });
  // X: both crews, the same round. Y: only Rae's crew. Z: Rae's crew, AFTER the report's period.
  const [x, y, z] = [await home(), await home(), await home()];
  await hit(x, m1, lia._id, at(1));
  await hit(x, m2, rae._id, at(2));
  await hit(y, m2, rae._id, at(3));
  await hit(z, m2, rae._id, new Date(RANGE_END.getTime() + 2 * 86400e3));

  let res = await call('POST', '/admin/client-reports/series', { campaignId: String(camp._id), label: 'Overlap team', coordinatorIds: [String(lia._id), String(rae._id)] });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  const team = res.json.series;
  res = await call('POST', '/admin/client-reports', { campaignId: String(camp._id), weekStart: '2026-07-06', weekEnd: '2026-07-12', seriesId: String(team._id) });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  const reportId = res.json.report._id;
  assert.ok((await runBuild(reportId)).committed);
  const before = (await ClientReport.findById(reportId).lean()).stats.cumulative.totals.doorsKnocked;
  assert.strictEqual(before, 2, 'X and Y; Z is after the period');

  // Rae stops running a crew: the next recompute stops on the change.
  await CampaignAssignment.updateOne({ campaignId: camp._id, userId: m2._id }, { $set: { coordinatorId: null } });
  assert.deepStrictEqual(await rebuild(reportId), { stopped: 'team-changed' });
  const byReport = await call('GET', `/admin/client-reports/series/${team._id}/team-changed?reportId=${reportId}`);
  assert.strictEqual(byReport.status, 200, JSON.stringify(byReport.json));
  const rae1 = byReport.json.departed.find((d) => d.coordinatorId === String(rae._id));
  assert.strictEqual(rae1.removeDoors, 1, 'only Y: X stays (Lia’s crew knocked it that round), Z was never in the report');
  // Without ?reportId the card reads the team's draft whose build stopped on the change.
  const fallback = await call('GET', `/admin/client-reports/series/${team._id}/team-changed`);
  assert.strictEqual(fallback.json.departed.find((d) => d.coordinatorId === String(rae._id)).removeDoors, 1);
  // A report of another team is no handle for this card.
  assert.strictEqual((await call('GET', `/admin/client-reports/series/${team._id}/team-changed?reportId=${ctx.volReport._id}`)).status, 404);

  // And it is exactly what Remove them does.
  res = await call('PATCH', `/admin/client-reports/series/${team._id}`, { removePast: [String(rae._id)] });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.ok((await rebuild(reportId)).committed);
  const after = (await ClientReport.findById(reportId).lean()).stats.cumulative.totals.doorsKnocked;
  assert.strictEqual(before - after, rae1.removeDoors);
});

// STATE-3 (code review round 1): End this team + delete its open drafts deleted every map row of a
// listed draft even when the draft had been published in between (deleteOne matched nothing), and
// left a nextReportId pointing at a deleted draft. Only a report STILL a draft is deleted now; only a
// deleted report's rows go; pointers at it are cleared; History records the delete.
test('STATE-3: ending a team deletes only what is still a draft — a report published meanwhile keeps its map', { skip }, async () => {
  // Its own campaign and crew: one lead, one canvasser, one door knocked in the period.
  const camp = await Campaign.create({ organizationId: ctx.org._id, name: 'State three', type: 'survey', state: 'FL', isActive: true, surveyTemplateId: ctx.template._id, timeZone: 'America/Chicago' });
  const mkUser = async (first) => {
    const u = await User.create({ firstName: first, lastName: 'Lorne', email: `${first.toLowerCase()}.lorne@t.co`, passwordHash: 'x', isActive: true });
    await Membership.create({ userId: u._id, organizationId: ctx.org._id, role: 'lead', isActive: true });
    return u;
  };
  const [tess, uma] = [await mkUser('Tess'), await mkUser('Uma')];
  await CampaignAssignment.create({ campaignId: camp._id, userId: uma._id, organizationId: ctx.org._id, coordinatorId: tess._id });
  await CampaignAssignment.create({ campaignId: camp._id, userId: tess._id, organizationId: ctx.org._id, coordinatorId: null });
  const hh = await Household.create({
    organizationId: ctx.org._id, campaignId: camp._id, isActive: true, addressLine1: '1 Ended St', city: 'Tampa', state: 'FL', zipCode: '33601',
    normalizedAddress: 'STATETHREE1', location: { type: 'Point', coordinates: [-82.41, 27.91] },
  });
  await CanvassActivity.create({ organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, userId: uma._id, coordinatorId: tess._id, actionType: 'not_home', timestamp: at(1), passId: new ObjectId(), location: { lat: 27.91, lng: -82.41 } });
  const made = await call('POST', '/admin/client-reports/series', { campaignId: String(camp._id), label: 'Ended team', coordinatorIds: [String(tess._id)] });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  const team = made.json.series;
  const create = async (weekStart, weekEnd) => {
    const res = await call('POST', '/admin/client-reports', { campaignId: String(camp._id), weekStart, weekEnd, seriesId: String(team._id) });
    assert.strictEqual(res.status, 201, JSON.stringify(res.json));
    return res.json.report;
  };
  // P: built and PUBLISHED; D: its open draft, which P's nextReportId points at.
  const p0 = await create('2026-07-06', '2026-07-12');
  assert.ok((await runBuild(p0._id)).committed);
  const built = await ClientReport.findById(p0._id).lean();
  assert.strictEqual((await call('POST', `/admin/client-reports/${built._id}/publish`, { snapshotId: String(built.snapshotId), editVersion: built.editVersion })).status, 200);
  const draft = await create('2026-07-13', '2026-07-19');
  await ClientReport.updateOne({ _id: built._id }, { $set: { nextReportId: draft._id } });
  const rowsOf = (id) => ClientReportMapPoint.countDocuments({ clientReportId: id });
  const publishedRows = await rowsOf(built._id);
  assert.ok(publishedRows > 0, 'the published report has map rows');
  // The race, made deterministic: the route's listing of open drafts still sees P, as a listing made
  // just before P's publish landed would.
  const realFind = ClientReport.find.bind(ClientReport);
  ClientReport.find = (filter, ...rest) => {
    const q = realFind(filter, ...rest);
    if (filter?.status === 'draft' && filter?.seriesId) q.transform((docs) => [...docs, { _id: built._id }]);
    return q;
  };
  let res;
  try {
    res = await call('PATCH', `/admin/client-reports/series/${team._id}`, { end: true, deleteOpenDrafts: true });
  } finally {
    ClientReport.find = realFind;
  }
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(await ClientReport.countDocuments({ _id: draft._id }), 0, 'the real draft is deleted');
  assert.strictEqual(await rowsOf(draft._id), 0, 'with its rows');
  const kept = await ClientReport.findById(built._id).lean();
  assert.strictEqual(kept?.status, 'published', 'the report published meanwhile is still there');
  assert.strictEqual(await rowsOf(built._id), publishedRows, 'and keeps every map row');
  assert.strictEqual(kept.nextReportId, null, 'no pointer left at the deleted draft');
});
