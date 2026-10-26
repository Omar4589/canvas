import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Client-report builds — docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F2/§F3/§O, against the REAL app
// and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/crbuild node --test test/clientReportBuild.int.test.js
//
// Redis points at a dead port, as in every suite here: a route that enqueues a build parks it as
// "Couldn't start", and the tests then drive the REAL processor (processClientReportJob) with a job
// id they claim themselves — the answerEdit.int.test.js pattern.
//
// The first block pins the new builder against TODAY's computeWindowStats and buildFrozenMapPoints,
// kept in computeReport.js as oracles (§F2 "Parity, pinned"), on a fixture with every awkward case
// the plan names, at the default batch and at CLIENT_REPORT_BATCH=2.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-client-report-build';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.CLIENT_REPORT_QUEUE_TIMEOUT_MS = '300';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ClientReportMapPoint } = await import('../src/models/ClientReportMapPoint.js');
const { ClientReportAreaCell } = await import('../src/models/ClientReportAreaCell.js');
const { ClientReportSeries } = await import('../src/models/ClientReportSeries.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { AnswerEditRun } = await import('../src/models/AnswerEditRun.js');
const { ReclassifyRun } = await import('../src/models/ReclassifyRun.js');
const { computeWindowStats, buildFrozenMapPoints } = await import('../src/services/reports/computeReport.js');
const { buildReportSnapshot } = await import('../src/services/reports/buildReportSnapshot.js');
const builds = await import('../src/services/reports/clientReportBuilds.js');
const { sweepClientReportRows } = await import('../src/services/reports/clientReportSweep.js');
const { deleteOrganization } = await import('../src/services/platform/deleteOrganization.js');
const { deleteCampaignCascade } = await import('../src/services/campaigns/deleteCampaign.js');
const { DelayedError } = await import('bullmq');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;

let server;
let base;
const ctx = {};

const call = async (method, path, { token, orgId, body, headers = {} } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};
const asAdmin = (body) => ({ ...ctx.admin, ...(body ? { body } : {}) });

// The period: Jul 6 – Jul 12, 2026 in Chicago.
const RANGE_START = new Date('2026-07-06T05:00:00Z');
const RANGE_END = new Date('2026-07-13T05:00:00Z');
const inPeriod = (h = 0) => new Date(RANGE_START.getTime() + (24 + h) * 3600 * 1000);
const beforePeriod = (h = 0) => new Date(RANGE_START.getTime() - (48 - h) * 3600 * 1000);

const QUESTIONS = [
  {
    key: 'support', label: 'Support Smith?', type: 'single_choice', order: 0, otherOption: true,
    options: [
      { id: 'y', text: 'Yes', tag: 'Supporter', order: 0 },
      { id: 'n', text: 'No', order: 1 },
      { id: 'u', text: 'Undecided', order: 2 },
    ],
  },
  {
    key: 'sign', label: 'Yard sign?', type: 'single_choice', order: 1,
    options: [{ id: 's1', text: 'Yes', order: 0 }, { id: 's2', text: 'No', order: 1 }],
    visibleIf: { logic: 'all', rules: [{ questionKey: 'support', op: 'is', optionIds: ['y'] }] },
  },
  {
    key: 'issues', label: 'Top issues', type: 'multiple_choice', order: 2,
    options: [{ id: 'a', text: 'Schools', order: 0 }, { id: 'b', text: 'Roads', order: 1 }, { id: 'c', text: 'Taxes', order: 2 }],
  },
  { key: 'notes', label: 'Anything else?', type: 'text', order: 3 },
];

let hhN = 0;
const makeHousehold = async ({ effortId = null, isActive = true } = {}) => {
  hhN += 1;
  return Household.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, isActive, effortId,
    addressLine1: `${hhN} Elm St`, city: 'Tampa', state: 'FL', zipCode: '33601',
    normalizedAddress: `${hhN} ELM ST|TAMPA|FL|33601`,
    location: { type: 'Point', coordinates: [-82.46 + hhN / 1e3, 27.95 + hhN / 1e3] },
  });
};
const act = (hh, actionType, timestamp, { user = ctx.a1, coordinatorId = ctx.leadA._id, passId = ctx.pass1, effortId = hh.effortId || null, via = null } = {}) =>
  CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: hh._id, userId: user._id,
    coordinatorId, actionType, timestamp, passId, effortId, via,
    location: { lat: 27.95, lng: -82.46 },
  });
let voterN = 0;
const survey = async (hh, answers, submittedAt, { user = ctx.a1, coordinatorId = ctx.leadA._id, passId = ctx.pass1, effortId = hh.effortId || null, extra = {} } = {}) => {
  voterN += 1;
  const voter = await Voter.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: hh._id,
    stateVoterId: `FL${9000 + voterN}`, firstName: 'V', lastName: `N${voterN}`, fullName: `V N${voterN}`,
  });
  return SurveyResponse.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: hh._id, voterId: voter._id,
    userId: user._id, coordinatorId, surveyTemplateId: ctx.template._id, surveyTemplateVersion: 1,
    passId, effortId, location: { lat: 27.95, lng: -82.46 }, submittedAt, answers, ...extra,
  });
};
const ans = (questionKey, optionIds, answer) => ({ questionKey, questionLabel: questionKey, optionIds, answer });

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await Promise.all([ClientReportSeries.syncIndexes(), ClientReportAreaCell.syncIndexes(), ClientReportMapPoint.syncIndexes()]);

  const org = await Organization.create({ name: 'Acme', slug: 'acme', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const mk = async (first, last, role) => {
    const u = await User.create({
      firstName: first, lastName: last, email: `${first.toLowerCase()}@t.co`,
      passwordHash: await User.hashPassword('Str0ng!Passw0rd'), isActive: true,
    });
    await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
    return u;
  };
  const admin = await mk('Ada', 'Admin', 'admin');
  const leadA = await mk('Lena', 'Alpha', 'lead');
  const leadB = await mk('Bo', 'Bravo', 'lead');
  const a1 = await mk('Ann', 'Crewone', 'canvasser');
  const a2 = await mk('Abe', 'Crewtwo', 'canvasser');
  const b1 = await mk('Bea', 'Crewthree', 'canvasser');
  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Doors', isActive: true, tags: ['Supporter'], questions: QUESTIONS });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'Fall', type: 'survey', state: 'FL', isActive: true,
    surveyTemplateId: template._id, timeZone: 'America/Chicago', doorGoal: 100,
  });
  const e1 = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const e2 = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'South' });
  for (const [u, c] of [[a1, leadA], [a2, leadB], [b1, leadB], [leadA, null], [leadB, null]]) {
    await CampaignAssignment.create({ campaignId: camp._id, userId: u._id, organizationId: org._id, coordinatorId: c ? c._id : null });
  }
  await CampaignManager.create({ campaignId: camp._id, userId: leadA._id, organizationId: org._id, grantedBy: admin._id });
  Object.assign(ctx, {
    org, camp, template, e1, e2, adminUser: admin, leadA, leadB, a1, a2, b1,
    pass1: new ObjectId(), pass2: new ObjectId(),
    admin: { token: signUserToken(admin), orgId: org._id },
    lead: { token: signUserToken(leadA), orgId: org._id },
  });

  // ── The parity fixture (§F2): every awkward case the plan names. ────────────────────────────
  // H1: surveyed in the period (crew A, walk list North), re-knocked in round 2.
  const h1 = await makeHousehold({ effortId: e1._id });
  await act(h1, 'survey_submitted', inPeriod(1));
  await survey(h1, [ans('support', ['y'], 'Yes'), ans('sign', ['s1'], 'Yes'), ans('issues', ['a', 'b'], ['Schools', 'Roads'])], inPeriod(1));
  await act(h1, 'not_home', inPeriod(30), { passId: ctx.pass2 });
  // H2: a two-voter door whose LATER answer skips a map question.
  const h2 = await makeHousehold({ effortId: e1._id });
  await act(h2, 'survey_submitted', inPeriod(2));
  await survey(h2, [ans('support', ['n'], 'No')], inPeriod(2));
  await survey(h2, [ans('issues', ['c'], ['Taxes'])], inPeriod(3));
  // H3: two responses with TIED submittedAt.
  const h3 = await makeHousehold();
  await act(h3, 'survey_submitted', inPeriod(4));
  await survey(h3, [ans('support', ['y'], 'Yes')], inPeriod(4));
  await survey(h3, [ans('support', ['u'], 'Undecided')], inPeriod(4));
  // H4: an Other write-in, a desk-entered survey and an edited one (provenance).
  const h4 = await makeHousehold();
  await act(h4, 'survey_submitted', beforePeriod(1));
  await survey(h4, [{ questionKey: 'support', questionLabel: 'Support Smith?', optionIds: ['__other__'], answer: 'Maria said call', otherText: 'Maria said call' }], beforePeriod(1), {
    extra: { deskEntry: { runId: new ObjectId(), byUserId: admin._id, at: new Date(), source: 'converted_outcome', fromOutcome: 'not_home' } },
  });
  await survey(h4, [ans('support', ['n'], 'No')], beforePeriod(2), { extra: { editedAt: new Date(), editedBy: admin._id } });
  // H5: a door MOVED between walk lists — knocked under North before the period, then South.
  const h5 = await makeHousehold({ effortId: e2._id });
  await act(h5, 'not_home', beforePeriod(3), { effortId: e1._id });
  await act(h5, 'refused', inPeriod(5), { effortId: e2._id, passId: ctx.pass2 });
  // H6: a desk restriction (via bulk) and nothing else; H7: a bulk-authored KNOCK (billable).
  const h6 = await makeHousehold();
  await act(h6, 'restricted', inPeriod(6), { user: admin, coordinatorId: null, via: 'bulk' });
  const h7 = await makeHousehold();
  await act(h7, 'not_home', inPeriod(7), { user: admin, coordinatorId: null, via: 'bulk' });
  // H8: a FIELD restriction, then a knock.
  const h8 = await makeHousehold();
  await act(h8, 'restricted', beforePeriod(4));
  await act(h8, 'not_home', inPeriod(8));
  // H9: not a target voter (crew B); H10: no soliciting (crew B), before the period.
  const h9 = await makeHousehold();
  await act(h9, 'not_target', inPeriod(9), { user: b1, coordinatorId: leadB._id });
  const h10 = await makeHousehold();
  await act(h10, 'no_soliciting', beforePeriod(5), { user: b1, coordinatorId: leadB._id });
  // H11: an INACTIVE household that was knocked — counted, never mapped.
  const h11 = await makeHousehold({ isActive: false });
  await act(h11, 'not_home', inPeriod(10));
  // H12: both teams knocked it in one round.
  const h12 = await makeHousehold();
  await act(h12, 'not_home', inPeriod(11), { passId: ctx.pass2 });
  await act(h12, 'refused', inPeriod(12), { user: b1, coordinatorId: leadB._id, passId: ctx.pass2 });
  // H13: a RE-STAMPED canvasser's door (a2 now runs under Bo); H14: a lead's own unstamped door.
  const h13 = await makeHousehold();
  await act(h13, 'not_home', inPeriod(13), { user: a2, coordinatorId: leadB._id });
  const h14 = await makeHousehold();
  await act(h14, 'not_home', inPeriod(14), { user: leadA, coordinatorId: null });
  // H15: a missing round and a null round stay apart (two doors-rounds, as $group keeps them).
  const h15 = await makeHousehold();
  await act(h15, 'not_home', inPeriod(15), { passId: null });
  const raw = (await act(h15, 'refused', inPeriod(16), { passId: null })).toObject();
  await CanvassActivity.deleteOne({ _id: raw._id });
  delete raw.passId;
  await CanvassActivity.collection.insertOne(raw);
  // H16: a note only — never a knock, never on the map.
  const h16 = await makeHousehold();
  await act(h16, 'note_added', inPeriod(17));
  // A knock after the period, which no window may count.
  await act(h1, 'not_home', new Date(RANGE_END.getTime() + 3600 * 1000), { passId: new ObjectId() });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

// ── Helpers shared by the blocks below ───────────────────────────────────────────────────────

const ALL_KEYS = ['support', 'sign', 'issues'];
const reportDoc = (extra = {}) => ({
  _id: new ObjectId(),
  organizationId: ctx.org._id,
  campaignId: ctx.camp._id,
  weekStart: '2026-07-06', weekEnd: '2026-07-12', timeZone: 'America/Chicago',
  rangeStartUtc: RANGE_START, rangeEndUtc: RANGE_END,
  ...extra,
});

const optionCounts = (b) => Object.fromEntries((b?.options || []).map((o) => [o.id ?? `label:${o.option}`, o.count]));
const assertWindowParity = (built, oracle, label) => {
  assert.deepStrictEqual(built.totals, oracle.totals, `${label}: totals`);
  assert.deepStrictEqual(built.contactBreakdown, oracle.contactBreakdown, `${label}: contact breakdown`);
  assert.deepStrictEqual(built.provenance, oracle.provenance, `${label}: provenance`);
  assert.deepStrictEqual(
    built.surveyBreakdowns.map((b) => b.questionKey).sort(),
    oracle.surveyBreakdowns.map((b) => b.questionKey).sort(),
    `${label}: breakdown questions`
  );
  for (const b of oracle.surveyBreakdowns) {
    const mine = built.surveyBreakdowns.find((x) => x.questionKey === b.questionKey);
    assert.deepStrictEqual(optionCounts(mine), optionCounts(b), `${label}: ${b.questionKey} options by id`);
  }
  const tags = (w) => Object.fromEntries((w.tagBreakdowns || []).map((t) => [t.tag, [t.identifiedVoters, t.currentVoters]]));
  assert.deepStrictEqual(tags(built), tags(oracle), `${label}: tags`);
};

const pointsOf = async (reportId, snapshotId) =>
  new Map(
    (await ClientReportMapPoint.find({ clientReportId: reportId, snapshotId }).lean()).map((p) => [
      String(p.householdId),
      { status: p.status, answers: JSON.stringify(p.answers) },
    ])
  );

for (const batch of [undefined, 2]) {
  for (const scope of ['campaign', 'North', 'South']) {
    test(`parity with today's oracles — ${scope}, batch ${batch ?? 'default'}`, { skip }, async () => {
      const effortId = scope === 'North' ? ctx.e1._id : scope === 'South' ? ctx.e2._id : null;
      const report = reportDoc({ effortId });
      const template = await SurveyTemplate.findById(ctx.template._id).lean();
      const campaign = await Campaign.findById(ctx.camp._id).lean();
      const snapshotId = new ObjectId();
      const built = await buildReportSnapshot({
        report, campaign, template, snapshotId, fenceAt: new Date(), batchSize: batch,
        inputs: { showMap: true, mapMode: 'pins', areaSize: 'small', mapKeys: ALL_KEYS, questionDeps: [], coordinatorIds: [] },
      });
      const base = { orgId: ctx.org._id, campaignId: ctx.camp._id, effortId, campaignType: 'survey', template };
      const [cum, period] = await Promise.all([
        computeWindowStats({ ...base, range: { $lt: RANGE_END } }),
        computeWindowStats({ ...base, range: { $gte: RANGE_START, $lt: RANGE_END } }),
      ]);
      assertWindowParity(built.stats.cumulative, cum, 'cumulative');
      assertWindowParity(built.stats.period, period, 'period');

      const { points } = await buildFrozenMapPoints({ report, campaign, template, mapAnswerKeys: ALL_KEYS });
      const oracle = new Map(points.map((p) => [String(p.householdId), { status: p.status, answers: JSON.stringify(p.answers) }]));
      const mine = await pointsOf(report._id, snapshotId);
      assert.deepStrictEqual([...mine.entries()].sort(), [...oracle.entries()].sort(), 'map points: same doors, statuses and answers');
      assert.strictEqual(built.mapPointCount, points.length);
      // Positions are 0..n-1, in household order.
      const seqs = (await ClientReportMapPoint.find({ clientReportId: report._id, snapshotId }, { seq: 1 }).lean()).map((p) => p.seq).sort((a, b) => a - b);
      assert.deepStrictEqual(seqs, [...Array(points.length).keys()]);
      assert.ok(built.extent && built.extent.minLng <= built.extent.maxLng, 'an extent from the pins');
      await ClientReportMapPoint.deleteMany({ clientReportId: report._id });
    });
  }
}

test('the fold keeps a missing round and a null round apart, and the breakdown adds up', { skip }, async () => {
  const report = reportDoc();
  const template = await SurveyTemplate.findById(ctx.template._id).lean();
  const campaign = await Campaign.findById(ctx.camp._id).lean();
  const built = await buildReportSnapshot({
    report, campaign, template, snapshotId: new ObjectId(), fenceAt: new Date(),
    inputs: { showMap: false, mapMode: 'pins', areaSize: 'small', mapKeys: [], questionDeps: [], coordinatorIds: [] },
  });
  for (const w of ['cumulative', 'period']) {
    const sum = Object.values(built.stats[w].contactBreakdown).reduce((s, n) => s + n, 0);
    assert.strictEqual(sum, built.stats[w].totals.doorsKnocked, `${w}: the breakdown adds up to doors knocked`);
  }
  assert.strictEqual(built.mapPointCount, 0, 'map off: no rows');
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: report._id }), 0);
});

test('the fixture is not trivial: 17 doors over all time, 14 in the period', { skip }, async () => {
  const report = reportDoc();
  const template = await SurveyTemplate.findById(ctx.template._id).lean();
  const campaign = await Campaign.findById(ctx.camp._id).lean();
  const built = await buildReportSnapshot({
    report, campaign, template, snapshotId: new ObjectId(), fenceAt: new Date(),
    inputs: { showMap: false, mapMode: 'pins', areaSize: 'small', mapKeys: [], questionDeps: [], coordinatorIds: [] },
  });
  assert.strictEqual(built.stats.cumulative.totals.doorsKnocked, 17);
  assert.strictEqual(built.stats.period.totals.doorsKnocked, 14);
});

// ── The build state machine, through the real routes and processor ────────────────────────────

// Drive the real processor. The queue is down in this suite, so a claim a route made parks as
// "Couldn't start"; a fresh job id stands in for a Retry that reached the queue.
const runBuild = async (reportId, extra = {}) => {
  const r = await ClientReport.findById(reportId).lean();
  let jobId = r.build?.jobId;
  if (!jobId || r.build.status === 'failed') {
    jobId = new ObjectId().toHexString();
    await ClientReport.updateOne(
      { _id: reportId },
      { $set: { 'build.status': 'queued', 'build.jobId': jobId, 'build.startedAt': new Date(), 'build.error': null } }
    );
  }
  return builds.processClientReportJob(
    { id: jobId, data: { reportId: String(reportId) }, moveToDelayed: async () => {}, updateProgress: async () => {}, ...extra },
    'token'
  );
};

const createReport = async (body = {}) => {
  // allowDuplicate: these suites make many reports for one tab and week on purpose; the duplicate guard
  // (PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §E) has its own suite, clientReportDuplicates.int.test.js.
  const res = await call('POST', '/admin/client-reports', asAdmin({
    campaignId: String(ctx.camp._id), weekStart: '2026-07-06', weekEnd: '2026-07-12', allowDuplicate: true, ...body,
  }));
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  return res.json.report;
};
const built = async (body = {}) => {
  const report = await createReport(body);
  const out = await runBuild(report._id);
  assert.ok(out?.committed, `the build committed: ${JSON.stringify(out)}`);
  return ClientReport.findById(report._id).lean();
};
const publishNow = async (id) => {
  const r = await ClientReport.findById(id).lean();
  return call('POST', `/admin/client-reports/${id}/publish`, asAdmin({ snapshotId: String(r.snapshotId), editVersion: r.editVersion ?? 0 }));
};

const SHARE_PASSWORD = 'correct-horse-battery';
const shareToken = async () => {
  if (ctx.shareToken) return ctx.shareToken;
  const bcrypt = (await import('bcryptjs')).default;
  await ReportShareLink.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, token: 'build-suite-token',
    passwordHash: await bcrypt.hash(SHARE_PASSWORD, 4), expiresAt: new Date(Date.now() + 86400000), isActive: true,
  });
  const unlock = await call('POST', '/share/build-suite-token/unlock', { body: { password: SHARE_PASSWORD } });
  assert.strictEqual(unlock.status, 200);
  ctx.shareToken = unlock.json.accessToken;
  return ctx.shareToken;
};
const shared = async (path) => call('GET', `/share/build-suite-token${path}`, { headers: { 'X-Share-Token': await shareToken() } });

test('create claims a recompute and answers 201 with the build; a dead queue parks it with a Retry', { skip }, async () => {
  const report = await createReport();
  assert.ok(report.seriesId, 'in the whole-campaign series');
  assert.deepStrictEqual(report.scope, { kind: 'campaign', label: 'Whole campaign' });
  assert.strictEqual(report.editVersion, 0);
  assert.strictEqual(report.build.kind, 'recompute');
  assert.strictEqual(report.build.status, 'failed', 'the queue is down in this suite');
  assert.strictEqual(report.build.error.code, 'ENQUEUE_FAILED');
  assert.ok(report.visibility.visibleQuestionKeys.includes('support'), 'explicit keys written');
  assert.ok(!report.snapshotId, 'no numbers yet');

  const out = await runBuild(report._id);
  assert.ok(out.committed);
  const after = await ClientReport.findById(report._id).lean();
  assert.ok(after.snapshotId && after.snapshotKey && after.statsComputedAt);
  assert.strictEqual(after.build.status, 'idle');
  assert.strictEqual(after.stats.cumulative.totals.doorsKnocked, 17);
  assert.deepStrictEqual(after.snapshotInputs.mapKeys.sort(), ['issues', 'sign', 'support']);
  assert.ok(after.mapPointCount > 0);
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: report._id, snapshotId: after.snapshotId }), after.mapPointCount);

  // A duplicate delivery of the same job exits without touching anything.
  const again = await builds.processClientReportJob({ id: report.build.jobId, data: { reportId: String(report._id) } }, 't');
  assert.ok(again.skipped);
});

test('publish freezes the previewed snapshot; refusals say why; a published report never publishes again', { skip }, async () => {
  const report = await built();
  // Settings that ADD to what the numbers were built with need a recompute first.
  await call('PATCH', `/admin/client-reports/${report._id}`, asAdmin({ visibility: { mapMode: 'area' } }));
  let res = await publishNow(report._id);
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.json.code, 'RECOMPUTE_NEEDED');
  assert.deepStrictEqual(res.json.reasons, ['map_mode']);
  await call('PATCH', `/admin/client-reports/${report._id}`, asAdmin({ visibility: { mapMode: 'pins' } }));

  // A stale preview: SNAPSHOT_CHANGED; a stale edit version: SAVING.
  const cur = await ClientReport.findById(report._id).lean();
  res = await call('POST', `/admin/client-reports/${report._id}/publish`, asAdmin({ snapshotId: String(new ObjectId()), editVersion: cur.editVersion }));
  assert.strictEqual(res.json.code, 'SNAPSHOT_CHANGED');
  res = await call('POST', `/admin/client-reports/${report._id}/publish`, asAdmin({ snapshotId: String(cur.snapshotId), editVersion: cur.editVersion - 1 }));
  assert.strictEqual(res.json.code, 'SAVING');

  // A recompute "running" when Publish lands is cancelled: what was previewed wins, and the
  // cancelled build's rows go.
  const ghost = new ObjectId();
  await ClientReport.updateOne({ _id: report._id }, { $set: { build: { kind: 'recompute', status: 'running', jobId: 'ghost-job', snapshotId: ghost, beatAt: new Date(), inputs: cur.snapshotInputs } } });
  await ClientReportMapPoint.create({ clientReportId: report._id, organizationId: ctx.org._id, campaignId: ctx.camp._id, snapshotId: ghost, seq: 0, lng: 1, lat: 1 });
  res = await publishNow(report._id);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  const pub = await ClientReport.findById(report._id).lean();
  assert.strictEqual(pub.status, 'published');
  assert.strictEqual(String(pub.snapshotId), String(cur.snapshotId), 'the previewed snapshot is the frozen one');
  assert.strictEqual(pub.build.status, 'idle');
  assert.ok(pub.build.cancelledAt, 'the running recompute was cancelled');
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ snapshotId: ghost }), 0, "the cancelled build's rows are gone");
  assert.strictEqual(pub.stats.cumulative.totals.doorsKnocked, cur.stats.cumulative.totals.doorsKnocked);

  res = await publishNow(report._id);
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.json.code, 'ALREADY_PUBLISHED', 'B6: a published report is never re-frozen with newer data');
  const rows = await CampaignChange.find({ clientReportId: report._id, source: 'client_report' }).lean();
  assert.ok(rows.some((r) => r.field === 'clientReport.published'));
  ctx.published = pub;
});

test('a draft with no snapshot cannot publish', { skip }, async () => {
  const report = await createReport();
  const res = await call('POST', `/admin/client-reports/${report._id}/publish`, asAdmin({}));
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.json.code, 'RECOMPUTE_NEEDED');
});

test('the client sees it through the share routes, with civil dates and no instants', { skip }, async () => {
  const hub = await shared('/reports');
  assert.strictEqual(hub.status, 200, JSON.stringify(hub.json));
  assert.strictEqual(hub.json.campaignName, 'Fall');
  assert.strictEqual(hub.json.orgName, 'Acme');
  assert.strictEqual(hub.json.hasLogo, false);
  const row = hub.json.reports.find((r) => r.id === String(ctx.published._id));
  assert.ok(row, 'the published report is listed');
  assert.match(row.publishedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.strictEqual(row.campaignId, undefined, 'no campaignId on hub rows');
  assert.strictEqual(row.publishedAt, undefined, 'no instants');
  assert.ok(row.scope.seriesKey && !/[0-9a-f]{24}/.test(row.scope.seriesKey), 'an opaque series key');

  const one = await shared(`/reports/${ctx.published._id}`);
  assert.strictEqual(one.status, 200);
  const dump = JSON.stringify(one.json);
  assert.ok(!dump.includes('mapAnswerKeys'), 'never the raw map keys');
  assert.ok(!dump.includes('statsComputedAt') && !dump.includes('"publishedAt"'), 'no instants');
  assert.ok(!dump.includes('coverage'), 'no coverage');
  assert.strictEqual(one.json.report.numbersThrough, null, 'numbers taken after the period ended');

  const map = await shared(`/reports/${ctx.published._id}/map`);
  assert.strictEqual(map.status, 200, JSON.stringify(map.json));
  assert.strictEqual(map.json.mode, 'pins');
  assert.strictEqual(map.json.lng.length, map.json.count);
  assert.ok(!JSON.stringify(map.json).includes('Elm St'), 'no addresses in the compact payload');
  assert.ok(!/[0-9a-f]{24}/.test(JSON.stringify(map.json)), 'no ids of any kind');
  const doors = await shared(`/reports/${ctx.published._id}/map/doors?snapshotKey=${encodeURIComponent(map.json.snapshotKey)}&rows=0,1,999`);
  assert.strictEqual(doors.status, 200);
  assert.strictEqual(doors.json.doors.length, 2, 'out-of-range rows return nothing');
  assert.ok(doors.json.doors[0].addressLine1.includes('Elm St'));
  const stale = await shared(`/reports/${ctx.published._id}/map/doors?snapshotKey=not-it&rows=0`);
  assert.strictEqual(stale.status, 409);
  assert.strictEqual(stale.json.code, 'MAP_UPDATED');
  const wrongMode = await shared(`/reports/${ctx.published._id}/areas`);
  assert.strictEqual(wrongMode.json.code, 'MAP_UPDATED', 'a pins report has no areas');

  // Fetching a report is not opening it (stage 2's ping counts visits).
  const doc = await ClientReport.findById(ctx.published._id).lean();
  assert.strictEqual(doc.viewCount || 0, 0);
});

test('hub rows and admin list rows carry the campaign type the report froze — null on a report from before it', { skip }, async () => {
  const hub = await shared('/reports');
  const row = hub.json.reports.find((r) => r.id === String(ctx.published._id));
  assert.strictEqual(row.campaignType, 'survey', 'the hub reads it, never guesses it from the totals');
  const list = await call('GET', `/admin/client-reports?campaignId=${ctx.camp._id}`, asAdmin());
  assert.strictEqual(list.status, 200, JSON.stringify(list.json));
  assert.strictEqual(list.json.reports.find((r) => r.id === String(ctx.published._id)).campaignType, 'survey');
  await ClientReport.updateOne({ _id: ctx.published._id }, { $unset: { campaignType: 1 } });
  try {
    const old = (await shared('/reports')).json.reports.find((r) => r.id === String(ctx.published._id));
    assert.strictEqual(old.campaignType, null);
    const oldRow = (await call('GET', `/admin/client-reports?campaignId=${ctx.camp._id}`, asAdmin())).json.reports.find((r) => r.id === String(ctx.published._id));
    assert.strictEqual(oldRow.campaignType, null);
  } finally {
    await ClientReport.updateOne({ _id: ctx.published._id }, { $set: { campaignType: 'survey' } });
  }
});

test('take down hides it everywhere, keeps it exactly; put back up restores it; nothing returns it to draft', { skip }, async () => {
  const id = ctx.published._id;
  const before = await ClientReport.findById(id).lean();
  let res = await call('POST', `/admin/client-reports/${id}/take-down`, asAdmin());
  assert.strictEqual(res.status, 200);
  const hub = await shared('/reports');
  assert.ok(!hub.json.reports.some((r) => r.id === String(id)), 'off the hub');
  const one = await shared(`/reports/${id}`);
  assert.strictEqual(one.status, 404);
  assert.strictEqual(one.json.code, 'REPORT_NOT_FOUND');
  assert.strictEqual((await shared(`/reports/${id}/map`)).json.code, 'REPORT_NOT_FOUND');
  const down = await ClientReport.findById(id).lean();
  assert.strictEqual(down.status, 'published');
  assert.strictEqual(String(down.publishedAt), String(before.publishedAt));
  assert.deepStrictEqual(down.stats, before.stats);

  // The old Unpublish is an alias of Take down — never back to draft.
  res = await call('POST', `/admin/client-reports/${id}/unpublish`, asAdmin());
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await ClientReport.findById(id).lean()).status, 'published');
  res = await call('POST', `/admin/client-reports/${id}/recompute`, asAdmin());
  assert.strictEqual(res.json.code, 'NOT_DRAFT');

  res = await call('POST', `/admin/client-reports/${id}/put-back-up`, asAdmin());
  assert.strictEqual(res.status, 200);
  const up = await ClientReport.findById(id).lean();
  assert.strictEqual(up.takenDownAt, null);
  assert.strictEqual(String(up.publishedAt), String(before.publishedAt), 'its original publish date');
  assert.strictEqual((await shared(`/reports/${id}`)).status, 200);
  const fields = (await CampaignChange.find({ clientReportId: id }).lean()).map((r) => r.field);
  assert.ok(fields.includes('clientReport.takenDown') && fields.includes('clientReport.putBackUp'));
});

test('fence and arrivals: knocks inserted mid-build are not counted, and are reported', { skip }, async () => {
  const report = await createReport();
  let inserted = false;
  const prevBatch = process.env.CLIENT_REPORT_BATCH;
  process.env.CLIENT_REPORT_BATCH = '2';
  try {
    const out = await runBuild(report._id, {
      updateProgress: async () => {
        if (inserted) return;
        inserted = true;
        const hh = await Household.findOne({ campaignId: ctx.camp._id, isActive: true }).lean();
        await act(hh, 'not_home', inPeriod(40), { passId: new ObjectId() });
      },
    });
    assert.ok(out.committed, JSON.stringify(out));
  } finally {
    if (prevBatch === undefined) delete process.env.CLIENT_REPORT_BATCH;
    else process.env.CLIENT_REPORT_BATCH = prevBatch;
  }
  const after = await ClientReport.findById(report._id).lean();
  assert.strictEqual(after.stats.cumulative.totals.doorsKnocked, 17, 'the knock after the fence is not counted');
  assert.strictEqual(after.arrivedDuringBuild, 1, 'and is reported');
  const sum = Object.values(after.stats.cumulative.contactBreakdown).reduce((s, n) => s + n, 0);
  assert.strictEqual(sum, after.stats.cumulative.totals.doorsKnocked, 'the breakdown still adds up');
  ctx.arrivalKnocks = 1;
});

// ── Liveness and attempts ─────────────────────────────────────────────────────────────────────

test('a stall redelivery writes under a NEW snapshot and discards the dead attempt’s rows', { skip }, async () => {
  const report = await createReport();
  const jobId = new ObjectId().toHexString();
  const dead = new ObjectId();
  // A first attempt that died mid-build: running, its own snapshot, rows written.
  await ClientReport.updateOne({ _id: report._id }, {
    $set: { 'build.status': 'running', 'build.jobId': jobId, 'build.snapshotId': dead, 'build.beatAt': new Date(), 'build.startedAt': new Date() },
  });
  await ClientReportMapPoint.create({ clientReportId: report._id, organizationId: ctx.org._id, campaignId: ctx.camp._id, snapshotId: dead, seq: 0, lng: 1, lat: 1 });
  const out = await builds.processClientReportJob({ id: jobId, data: { reportId: String(report._id) }, updateProgress: async () => {} }, 't');
  assert.ok(out.committed, JSON.stringify(out));
  const after = await ClientReport.findById(report._id).lean();
  assert.notStrictEqual(String(after.snapshotId), String(dead), 'a new snapshot');
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ snapshotId: dead }), 0, "the dead attempt's rows are gone");
});

test('liveness: a lost queued job and a stale running build are not live; a dead build never blocks a claim', { skip }, async () => {
  const report = await createReport();
  const lost = { ...report, build: { status: 'queued', jobId: 'lost', startedAt: new Date() } };
  assert.strictEqual(await builds.buildIsLive(lost, { jobState: async () => 'unknown' }), false, 'a lost job reads not live');
  assert.strictEqual(await builds.buildIsLive(lost, { jobState: async () => 'delayed' }), true, 'a delayed one is live');
  assert.strictEqual(await builds.buildIsLive({ build: { status: 'queued', jobId: 'x', startedAt: new Date(Date.now() - 3 * 3600e3) } }, { jobState: async () => 'waiting' }), false, 'over two hours old');
  assert.strictEqual(await builds.buildIsLive({ build: { status: 'running', beatAt: new Date() } }), true);
  assert.strictEqual(await builds.buildIsLive({ build: { status: 'running', beatAt: new Date(Date.now() - 6 * 60e3) } }), false);

  // A running build whose heartbeat stopped: a Recompute claims over it, and its rows go.
  const dead = new ObjectId();
  await ClientReport.updateOne({ _id: report._id }, { $set: { build: { kind: 'recompute', status: 'running', jobId: 'dead-job', snapshotId: dead, beatAt: new Date(Date.now() - 10 * 60e3) } } });
  await ClientReportMapPoint.create({ clientReportId: report._id, organizationId: ctx.org._id, campaignId: ctx.camp._id, snapshotId: dead, seq: 0, lng: 1, lat: 1 });
  const res = await call('POST', `/admin/client-reports/${report._id}/recompute`, asAdmin());
  assert.strictEqual(res.status, 202, JSON.stringify(res.json));
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ snapshotId: dead }), 0);

  // A LIVE one refuses the claim, naming its state.
  await ClientReport.updateOne({ _id: report._id }, { $set: { build: { kind: 'recompute', status: 'running', jobId: 'live-job', snapshotId: new ObjectId(), beatAt: new Date() } } });
  const busy = await call('POST', `/admin/client-reports/${report._id}/recompute`, asAdmin());
  assert.strictEqual(busy.status, 409);
  assert.strictEqual(busy.json.code, 'REPORT_BUSY');
  assert.match(busy.json.error, /building right now/);
});

test('a waiting build frees its slot, remembers when it began waiting, and fails BLOCKED after 30 minutes', { skip }, async () => {
  const report = await createReport();
  const run = await AnswerEditRun.collection.insertOne({ organizationId: ctx.org._id, campaignId: ctx.camp._id, status: 'running', mode: 'bulk', updatedAt: new Date(), createdAt: new Date() });
  let delayed = 0;
  const job = { moveToDelayed: async () => { delayed += 1; } };
  await assert.rejects(runBuild(report._id, job), DelayedError, 'DelayedError frees the worker slot');
  let doc = await ClientReport.findById(report._id).lean();
  assert.strictEqual(doc.build.status, 'waiting');
  assert.match(doc.build.waitingFor, /answer edit/);
  const since = doc.build.waitingSince;
  assert.ok(since);
  assert.strictEqual(delayed, 1);
  // A redelivery after the delay: still blocked, the SAME waitingSince.
  await assert.rejects(builds.processClientReportJob({ id: doc.build.jobId, data: { reportId: String(report._id) }, ...job }, 't'), DelayedError);
  doc = await ClientReport.findById(report._id).lean();
  assert.strictEqual(String(doc.build.waitingSince), String(since));
  // Thirty minutes on: BLOCKED, naming what is running.
  await ClientReport.updateOne({ _id: report._id }, { $set: { 'build.waitingSince': new Date(Date.now() - 31 * 60e3) } });
  const out = await builds.processClientReportJob({ id: doc.build.jobId, data: { reportId: String(report._id) }, ...job }, 't');
  assert.deepStrictEqual(out, { stopped: 'blocked' });
  doc = await ClientReport.findById(report._id).lean();
  assert.strictEqual(doc.build.status, 'failed');
  assert.strictEqual(doc.build.error.code, 'BLOCKED');
  assert.match(doc.build.error.message, /press Stop on Door Outcomes/);
  await AnswerEditRun.collection.deleteOne({ _id: run.insertedId });
});

test('Cancel replaces the build, and every write the worker still makes misses', { skip }, async () => {
  const report = await createReport();
  const prevBatch = process.env.CLIENT_REPORT_BATCH;
  process.env.CLIENT_REPORT_BATCH = '2';
  let cancelled = false;
  try {
    const out = await runBuild(report._id, {
      updateProgress: async () => {
        if (cancelled) return;
        cancelled = true;
        const res = await call('POST', `/admin/client-reports/${report._id}/build/cancel`, asAdmin());
        assert.strictEqual(res.status, 200, JSON.stringify(res.json));
      },
    });
    assert.ok(out.stopped, JSON.stringify(out));
  } finally {
    if (prevBatch === undefined) delete process.env.CLIENT_REPORT_BATCH;
    else process.env.CLIENT_REPORT_BATCH = prevBatch;
  }
  const doc = await ClientReport.findById(report._id).lean();
  assert.strictEqual(doc.build.status, 'idle');
  assert.ok(doc.build.cancelledAt);
  assert.ok(!doc.snapshotId, 'nothing committed');
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: report._id }), 0, 'no rows of the cancelled build');
  const none = await call('POST', `/admin/client-reports/${report._id}/build/cancel`, asAdmin());
  assert.strictEqual(none.json.code, 'NOTHING_TO_CANCEL');
});

test('a commit that misses reads SUPERSEDED and leaves no rows', { skip }, async () => {
  const report = await createReport();
  // An impossible race made possible: the draft turns published under the build, so the commit's
  // CAS (status: draft) can never match while the build is still its own.
  const out = await runBuild(report._id, {
    updateProgress: async () => {
      await ClientReport.updateOne({ _id: report._id }, { $set: { status: 'published' } });
    },
  });
  assert.deepStrictEqual(out, { committed: false, code: 'SUPERSEDED' });
  const doc = await ClientReport.findById(report._id).lean();
  assert.strictEqual(doc.build.status, 'failed');
  assert.strictEqual(doc.build.error.code, 'SUPERSEDED');
  assert.strictEqual(doc.build.snapshotId, null);
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: report._id }), 0);
  await ClientReport.deleteOne({ _id: report._id });
});

test('the failed listener never touches a ready build, and marks a live one failed', { skip }, async () => {
  const ready = await ClientReport.create(reportDoc({ status: 'published', build: { kind: 'refresh', status: 'ready', jobId: 'r-job', snapshotId: new ObjectId() } }));
  await builds.reconcileFailedClientReportJob({ id: 'r-job', data: { reportId: String(ready._id) } }, new Error('boom'));
  assert.strictEqual((await ClientReport.findById(ready._id).lean()).build.status, 'ready');
  const running = await ClientReport.create(reportDoc({ status: 'draft', build: { kind: 'recompute', status: 'running', jobId: 'x-job', snapshotId: new ObjectId(), beatAt: new Date() } }));
  await builds.reconcileFailedClientReportJob({ id: 'x-job', data: { reportId: String(running._id) } }, new Error('boom'));
  const doc = await ClientReport.findById(running._id).lean();
  assert.strictEqual(doc.build.status, 'failed');
  assert.strictEqual(doc.build.snapshotId, null, "its rows are left to the sweep");
  assert.ok(!JSON.stringify(doc.build.error).includes('boom'), 'a generic message');
  await ClientReport.deleteMany({ _id: { $in: [ready._id, running._id] } });
});

// ── Deletion mid-build (§F2 step 5) — with the REAL cascades ──────────────────────────────────

// A tenant of its own (the cascades delete everything): an org, a campaign, a few knocked doors,
// and a draft with a claimed recompute.
const freshTenant = async (slug) => {
  const org = await Organization.create({ name: slug, slug, isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'T', isActive: true, questions: QUESTIONS });
  const camp = await Campaign.create({ organizationId: org._id, name: slug, type: 'survey', state: 'FL', isActive: true, surveyTemplateId: template._id, timeZone: 'America/Chicago' });
  for (let i = 0; i < 6; i += 1) {
    const hh = await Household.create({
      organizationId: org._id, campaignId: camp._id, isActive: true,
      addressLine1: `${i} Oak St`, city: 'Tampa', state: 'FL', zipCode: '33601', normalizedAddress: `${slug}${i}`,
      location: { type: 'Point', coordinates: [-82.4 + i / 1e3, 27.9] },
    });
    await CanvassActivity.create({
      organizationId: org._id, campaignId: camp._id, householdId: hh._id, userId: ctx.a1._id,
      actionType: 'not_home', timestamp: inPeriod(i), passId: ctx.pass1, location: { lat: 27.9, lng: -82.4 },
    });
  }
  const report = await ClientReport.create({
    organizationId: org._id, campaignId: camp._id, weekStart: '2026-07-06', weekEnd: '2026-07-12', timeZone: 'America/Chicago',
    rangeStartUtc: RANGE_START, rangeEndUtc: RANGE_END, status: 'draft', editVersion: 0,
    visibility: { visibleQuestionKeys: [], mapAnswerKeys: [], showMap: true },
    build: { kind: 'recompute', status: 'queued', jobId: new ObjectId().toHexString(), startedAt: new Date(), inputs: { showMap: true, mapMode: 'pins', areaSize: 'small', mapKeys: [], questionDeps: [], coordinatorIds: [] } },
  });
  return { org, camp, report };
};

for (const which of ['campaign', 'organization']) {
  // Two ways a deletion meets a build: requested between two batches (the next batch's check stops
  // it for good), or a cascade that runs to completion mid-build (the report itself is gone, so the
  // heartbeat misses). Either way, with the REAL cascade, no row of a deleted tenant survives.
  for (const mode of ['requested', 'cascaded']) {
    test(`deletion mid-build (${which}, ${mode}, the real cascade) leaves no rows`, { skip }, async () => {
      const t = await freshTenant(`del-${which}-${mode}`);
      const prevBatch = process.env.CLIENT_REPORT_BATCH;
      process.env.CLIENT_REPORT_BATCH = '2';
      const cascade = async () => {
        if (which === 'campaign') {
          await Campaign.updateOne({ _id: t.camp._id }, { $set: { 'deletion.requestedAt': new Date(), 'deletion.status': 'running', 'deletion.cascadeAt': new Date() } });
          await deleteCampaignCascade(await Campaign.findById(t.camp._id).lean());
        } else {
          await Organization.updateOne({ _id: t.org._id }, { $set: { 'deletion.requestedAt': new Date(), 'deletion.status': 'running', platformStatsCaptured: true } });
          await deleteOrganization(t.org._id);
        }
      };
      let hooked = false;
      let out = null;
      let err = null;
      try {
        out = await builds.processClientReportJob({
          id: t.report.build.jobId,
          data: { reportId: String(t.report._id) },
          updateProgress: async () => {
            if (hooked) return;
            hooked = true;
            assert.ok(await ClientReportMapPoint.exists({ clientReportId: t.report._id }), 'the first batch wrote rows');
            if (mode === 'cascaded') return cascade();
            if (which === 'campaign') await Campaign.updateOne({ _id: t.camp._id }, { $set: { 'deletion.requestedAt': new Date() } });
            else await Organization.updateOne({ _id: t.org._id }, { $set: { 'deletion.requestedAt': new Date() } });
          },
        }, 't');
      } catch (e) {
        err = e;
      } finally {
        if (prevBatch === undefined) delete process.env.CLIENT_REPORT_BATCH;
        else process.env.CLIENT_REPORT_BATCH = prevBatch;
      }
      assert.ok(hooked, 'the deletion met the build mid-way');
      if (mode === 'requested') {
        assert.ok(err && /being deleted/.test(err.message), `the build stopped for good: ${err?.message || JSON.stringify(out)}`);
        await cascade();
      } else {
        assert.ok(err || out?.stopped, `the build stopped: ${err?.message || JSON.stringify(out)}`);
      }
      assert.strictEqual(await ClientReportMapPoint.countDocuments({ campaignId: t.camp._id }), 0, 'no map rows outlive the deletion');
      assert.strictEqual(await ClientReportAreaCell.countDocuments({ campaignId: t.camp._id }), 0);
      assert.strictEqual(await ClientReport.countDocuments({ campaignId: t.camp._id }), 0);
    });
  }
}

// ── Changes during a build (§F2 step 7, §O9) ──────────────────────────────────────────────────

const countBatches = () => {
  const c = { n: 0 };
  c.job = { updateProgress: async () => { c.n += 1; if (c.hook) await c.hook(c.n); } };
  return c;
};

test('a change that finishes during the build rebuilds ONCE; a second fails CHANGED_DURING_BUILD', { skip }, async () => {
  const report = await createReport();
  const c = countBatches();
  c.hook = async (n) => {
    if (n === 1) await ReclassifyRun.collection.insertOne({ organizationId: ctx.org._id, campaignId: ctx.camp._id, updatedAt: new Date(), createdAt: new Date() });
  };
  const out = await runBuild(report._id, c.job);
  assert.ok(out.committed, JSON.stringify(out));
  assert.strictEqual(c.n, 2, 'the build ran twice: once, then one rebuild');

  const second = await createReport();
  const d = countBatches();
  d.hook = async () => {
    await ReclassifyRun.collection.insertOne({ organizationId: ctx.org._id, campaignId: ctx.camp._id, updatedAt: new Date(), createdAt: new Date() });
  };
  const out2 = await runBuild(second._id, d.job);
  assert.deepStrictEqual(out2, { stopped: 'changed-during-build' });
  const doc = await ClientReport.findById(second._id).lean();
  assert.strictEqual(doc.build.error.code, 'CHANGED_DURING_BUILD');
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: second._id }), 0);
});

test('a change the build already waited out is not counted again; a ledger row changed in place is', { skip }, async () => {
  // Finished just before the fence (inside the skew window): recorded in fenceSeen, never a rebuild.
  await ReclassifyRun.collection.insertOne({ organizationId: ctx.org._id, campaignId: ctx.camp._id, updatedAt: new Date(Date.now() - 10e3), createdAt: new Date() });
  const report = await createReport();
  const c = countBatches();
  assert.ok((await runBuild(report._id, c.job)).committed);
  assert.strictEqual(c.n, 1, 'no rebuild for a change finished before the fence');

  // A survey changed in place mid-build (an answer edit's write) is a change.
  const second = await createReport();
  const d = countBatches();
  d.hook = async (n) => {
    if (n === 1) await SurveyResponse.updateOne({ campaignId: ctx.camp._id }, { $set: { note: 'edited mid-build' } });
  };
  assert.ok((await runBuild(second._id, d.job)).committed);
  assert.strictEqual(d.n, 2, 'one rebuild');
});

test('a change still in flight sends the build back to waiting, not to a rebuild', { skip }, async () => {
  const report = await createReport();
  let runId = null;
  const job = {
    moveToDelayed: async () => {},
    updateProgress: async () => {
      if (runId) return;
      runId = (await AnswerEditRun.collection.insertOne({ organizationId: ctx.org._id, campaignId: ctx.camp._id, status: 'running', mode: 'bulk', updatedAt: new Date(), createdAt: new Date() })).insertedId;
    },
  };
  await assert.rejects(runBuild(report._id, job), DelayedError);
  const doc = await ClientReport.findById(report._id).lean();
  assert.strictEqual(doc.build.status, 'waiting');
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: report._id }), 0, "the attempt's rows are deleted while it waits");
  await AnswerEditRun.collection.deleteOne({ _id: runId });
  // Once the change is over, the next delivery builds under a fresh snapshot (the finished run is
  // new since the fence it waited at, so it costs one rebuild at most).
  const out = await builds.processClientReportJob({ id: doc.build.jobId, data: { reportId: String(report._id) }, ...job }, 't');
  assert.ok(out.committed, JSON.stringify(out));
});

// A tenant with `doors` knocked households, inserted in bulk, and a draft with a queued build.
const bulkTenant = async (slug, doors, { unknocked = 0 } = {}) => {
  const t = await freshTenant(slug);
  await CanvassActivity.deleteMany({ campaignId: t.camp._id });
  await Household.deleteMany({ campaignId: t.camp._id });
  const hhs = Array.from({ length: doors + unknocked }, (_, i) => ({
    _id: new ObjectId(), organizationId: t.org._id, campaignId: t.camp._id, isActive: true,
    addressLine1: `${i} Bulk St`, city: 'Tampa', state: 'FL', zipCode: '33601', normalizedAddress: `${slug}-${i}`,
    location: { type: 'Point', coordinates: [-82.4 + (i % 300) / 1e3, 27.9 + Math.floor(i / 300) / 1e3] },
  }));
  await Household.insertMany(hhs, { ordered: false });
  await CanvassActivity.insertMany(hhs.slice(0, doors).map((hh, i) => ({
    organizationId: t.org._id, campaignId: t.camp._id, householdId: hh._id, userId: ctx.a1._id,
    actionType: 'not_home', timestamp: inPeriod(i % 100), passId: ctx.pass1, location: { lat: 27.9, lng: -82.4 },
  })), { ordered: false });
  return t;
};

test('STATE-1: a beat landing while a rebuild swaps snapshots never stops the rebuild — it commits', { skip }, async () => {
  // A beat every 2 ms, so beats surely land while the first build's 3,000 rows are deleted (the
  // window the review measured): before the fix one latched `missed`, the rebuild stopped itself as
  // "superseded", the job completed, and the report read running for good.
  const t = await bulkTenant('rebuild-beat', 3000);
  const prevBeat = process.env.CLIENT_REPORT_BEAT_MS;
  process.env.CLIENT_REPORT_BEAT_MS = '2';
  let batches = 0;
  let out;
  try {
    out = await builds.processClientReportJob({
      id: t.report.build.jobId,
      data: { reportId: String(t.report._id) },
      moveToDelayed: async () => {},
      updateProgress: async () => {
        batches += 1;
        // A Door Outcomes change that finishes during the first build: step 7 rebuilds once.
        if (batches === 1) await ReclassifyRun.collection.insertOne({ organizationId: t.org._id, campaignId: t.camp._id, updatedAt: new Date(), createdAt: new Date() });
      },
    }, 't');
  } finally {
    if (prevBeat === undefined) delete process.env.CLIENT_REPORT_BEAT_MS;
    else process.env.CLIENT_REPORT_BEAT_MS = prevBeat;
  }
  assert.deepStrictEqual(out, { committed: true });
  assert.strictEqual(batches, 4, 'two batches, then the rebuild’s two');
  const doc = await ClientReport.findById(t.report._id).lean();
  assert.strictEqual(doc.build.status, 'idle');
  assert.ok(doc.snapshotId);
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: t.report._id, snapshotId: doc.snapshotId }), 3000);
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: t.report._id }), 3000, 'the first build’s rows are gone');
});

test('STATE-4: the progress bar counts the households the build walks, so it reaches the end', { skip }, async () => {
  // Six knocked households and four nobody knocked (the walk never visits those).
  const t = await bulkTenant('progress-bar', 6, { unknocked: 4 });
  const prevBatch = process.env.CLIENT_REPORT_BATCH;
  process.env.CLIENT_REPORT_BATCH = '2';
  const seen = [];
  let out;
  try {
    out = await builds.processClientReportJob({
      id: t.report.build.jobId,
      data: { reportId: String(t.report._id) },
      moveToDelayed: async () => {},
      updateProgress: async (p) => { seen.push(p); },
    }, 't');
  } finally {
    if (prevBatch === undefined) delete process.env.CLIENT_REPORT_BATCH;
    else process.env.CLIENT_REPORT_BATCH = prevBatch;
  }
  assert.ok(out.committed, JSON.stringify(out));
  // 2, 4 and 6 of 6 (held at 99 until the commit) — not 20, 40, 60 of all ten households.
  assert.deepStrictEqual(seen, [33, 67, 99]);
});

// ── The nightly sweep ─────────────────────────────────────────────────────────────────────────

test('the sweep spares live, live-build and ready rows and anything newer than its read; deletes the rest', { skip }, async () => {
  const mk = (clientReportId, snapshotId) =>
    ClientReportMapPoint.collection.insertOne({ clientReportId, organizationId: ctx.org._id, campaignId: ctx.camp._id, ...(snapshotId === undefined ? {} : { snapshotId }), seq: 0, lng: 1, lat: 1 });
  const old = (h) => ObjectId.createFromTime(Math.floor((Date.now() - h * 3600e3) / 1000));
  const live = old(48);
  const ready = old(48);
  const stale = old(30);
  const young = old(2);
  const report = await ClientReport.create(reportDoc({
    status: 'published', snapshotId: live, snapshotKey: 'k', snapshotInputs: { showMap: true, mapMode: 'pins', areaSize: 'small', mapKeys: [], questionDeps: [], coordinatorIds: [] },
    visibility: { showMap: true },
    build: { kind: 'refresh', status: 'ready', jobId: 'j', snapshotId: ready, inputs: { showMap: true } },
  }));
  for (const s of [live, ready, stale, young, undefined]) await mk(report._id, s);
  // Orphans, and the map-off report keeping only its ready "turn the map on" result.
  const orphanReport = new ObjectId();
  await mk(orphanReport, old(1));
  const off = await ClientReport.create(reportDoc({
    status: 'published', snapshotId: old(50), visibility: { showMap: false },
    snapshotInputs: { showMap: false, mapMode: 'pins', mapKeys: [], questionDeps: [], coordinatorIds: [] },
    build: { kind: 'refresh', status: 'ready', jobId: 'j2', snapshotId: old(40), inputs: { showMap: true } },
  }));
  await mk(off._id, off.snapshotId);
  await mk(off._id, off.build.snapshotId);
  // A row minted AFTER the sweep's read (a build that started after it) is never touched.
  const future = ObjectId.createFromTime(Math.floor(Date.now() / 1000) + 5);
  await mk(orphanReport, future);

  const res = await sweepClientReportRows();
  const left = async (id) => (await ClientReportMapPoint.find({ clientReportId: id }).lean()).map((p) => (p.snapshotId ? String(p.snapshotId) : 'legacy'));
  assert.deepStrictEqual((await left(report._id)).sort(), [String(live), String(ready), String(young)].sort(), 'live, ready and young kept; stale and superseded legacy gone');
  assert.deepStrictEqual(await left(orphanReport), [String(future)], 'orphans gone, but never a row newer than the read');
  assert.deepStrictEqual(await left(off._id), [String(off.build.snapshotId)], 'a map-off report keeps only its ready result');
  assert.ok(res.orphans >= 1 && res.mapOff >= 1 && res.legacy >= 1 && res.stale >= 1, JSON.stringify(res));
  await ClientReportMapPoint.deleteMany({ clientReportId: { $in: [report._id, orphanReport, off._id] } });
  await ClientReport.deleteMany({ _id: { $in: [report._id, off._id] } });
});

// ── Refresh numbers, Apply, Discard (§F3) ─────────────────────────────────────────────────────

const publishedReport = async (body = {}) => {
  const r = await built(body);
  const res = await publishNow(r._id);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  return ClientReport.findById(r._id).lean();
};
const refreshTo = async (id, map) => {
  const res = await call('POST', `/admin/client-reports/${id}/refresh`, asAdmin(map ? { map } : {}));
  assert.strictEqual(res.status, 202, JSON.stringify(res.json));
  const out = await runBuild(id);
  assert.ok(out.committed, JSON.stringify(out));
  const doc = await ClientReport.findById(id).lean();
  assert.strictEqual(doc.build.status, 'ready');
  return doc;
};
const apply = async (id) => {
  const res = await call('POST', `/admin/client-reports/${id}/refresh/apply`, asAdmin());
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  return res.json.report;
};

test('map off on a published report deletes the map; turning it back on is a Refresh, served only once applied', { skip }, async () => {
  const p = await publishedReport();
  let res = await call('PATCH', `/admin/client-reports/${p._id}`, asAdmin({ visibility: { showMap: false } }));
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: p._id }), 0, 'the frozen map is deleted');
  const after = await ClientReport.findById(p._id).lean();
  assert.strictEqual(after.snapshotInputs.showMap, false);
  assert.ok(after.contentEditedAt, 'the client sees Edited');
  assert.strictEqual((await shared(`/reports/${p._id}/map`)).json.code, 'MAP_NOT_SHARED');

  res = await call('PATCH', `/admin/client-reports/${p._id}`, asAdmin({ visibility: { showMap: true } }));
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.json.code, 'NEEDS_REFRESH');

  const ready = await refreshTo(p._id, { showMap: true });
  assert.strictEqual((await shared(`/reports/${p._id}/map`)).json.code, 'MAP_NOT_SHARED', 'an unapplied refresh serves nothing');
  const busy = await call('POST', `/admin/client-reports/${p._id}/refresh`, asAdmin());
  assert.strictEqual(busy.json.code, 'REVIEW_PENDING', 'never a silent discard of a ready review');
  const view = await call('GET', `/admin/client-reports/${p._id}/build`, asAdmin());
  assert.strictEqual(view.json.build.status, 'ready');
  assert.ok(view.json.build.result.mapShown);

  const applied = await apply(p._id);
  assert.strictEqual(String(applied.snapshotId), String(ready.build.snapshotId));
  assert.ok(applied.numbersRefreshedAt);
  assert.strictEqual(applied.visibility.showMap, true);
  const map = await shared(`/reports/${p._id}/map`);
  assert.strictEqual(map.status, 200);
  assert.ok(map.json.count > 0);
  const hist = await CampaignChange.findOne({ clientReportId: p._id, field: 'clientReport.numbersRefreshed' }).lean();
  assert.ok(hist?.fromValue && hist?.toValue, 'the refresh keeps its before-and-after totals');
  ctx.refreshed = applied;
});

test('Discard deletes only its own rows; Take down discards a ready result too', { skip }, async () => {
  const p = ctx.refreshed;
  const liveRows = await ClientReportMapPoint.countDocuments({ clientReportId: p._id, snapshotId: p.snapshotId });
  const ready = await refreshTo(p._id);
  let res = await call('POST', `/admin/client-reports/${p._id}/refresh/discard`, asAdmin());
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ snapshotId: ready.build.snapshotId }), 0);
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: p._id, snapshotId: p.snapshotId }), liveRows, 'the live map untouched');
  res = await call('POST', `/admin/client-reports/${p._id}/refresh/discard`, asAdmin());
  assert.strictEqual(res.json.code, 'NOTHING_TO_DISCARD');

  const again = await refreshTo(p._id);
  res = await call('POST', `/admin/client-reports/${p._id}/take-down`, asAdmin());
  assert.strictEqual(res.status, 200);
  const down = await ClientReport.findById(p._id).lean();
  assert.strictEqual(down.build.status, 'idle');
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ snapshotId: again.build.snapshotId }), 0);
  await call('POST', `/admin/client-reports/${p._id}/put-back-up`, asAdmin());
});

test('Refresh adds a map question (with its parent), and goes back from areas to exact doors', { skip }, async () => {
  const p = await publishedReport();
  // Drop the parent: the follow-up goes with it (§F1) — from the settings, the snapshot's inputs and the rows.
  let res = await call('PATCH', `/admin/client-reports/${p._id}`, asAdmin({ visibility: { mapAnswerKeys: ['issues'] } }));
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  let doc = await ClientReport.findById(p._id).lean();
  assert.deepStrictEqual(doc.snapshotInputs.mapKeys, ['issues']);
  const leftover = await ClientReportMapPoint.find({ clientReportId: p._id, 'answers.questionKey': { $in: ['support', 'sign'] } }).lean();
  assert.strictEqual(leftover.length, 0, 'answers pulled from the stored rows');

  // A follow-up without its parent is refused; with it, it goes on.
  res = await call('POST', `/admin/client-reports/${p._id}/refresh`, asAdmin({ map: { mapKeys: ['sign'] } }));
  assert.strictEqual(res.json.code, 'MAP_KEYS_NEED_PARENTS');
  await refreshTo(p._id, { mapKeys: ['support', 'sign'] });
  doc = await apply(p._id);
  assert.deepStrictEqual([...doc.snapshotInputs.mapKeys].sort(), ['issues', 'sign', 'support']);
  const survey = await shared(`/reports/${p._id}`);
  assert.deepStrictEqual(survey.json.survey.questions.map((q) => q.key).sort(), ['issues', 'sign', 'support']);

  // To large areas, applied: the client's map becomes cells and no pin survives. The review names the
  // single-choice map questions that would show no answers by area (WALK-7) — what the checks say
  // once it is applied.
  await refreshTo(p._id, { mapMode: 'area', areaSize: 'large' });
  const review = (await call('GET', `/admin/client-reports/${p._id}/build`, asAdmin())).json.build;
  assert.ok(Array.isArray(review.areaWithoutAnswers));
  assert.deepStrictEqual([...review.result.mapKeys].sort(), ['issues', 'sign', 'support'], 'and its map questions');
  assert.deepStrictEqual([review.result.mapMode, review.result.areaSize], ['area', 'large'], 'and its view, so no advice to go large is given (VERIFY2-4)');
  doc = await apply(p._id);
  assert.deepStrictEqual((await call('GET', `/admin/client-reports/${p._id}`, asAdmin())).json.checks.areaWithoutAnswers, review.areaWithoutAnswers);
  assert.strictEqual(doc.visibility.mapMode, 'area');
  assert.strictEqual(doc.mapPointCount, 0);
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: p._id }), 0);
  assert.strictEqual((await shared(`/reports/${p._id}/map`)).json.code, 'MAP_UPDATED');
  const areas = await shared(`/reports/${p._id}/areas`);
  assert.strictEqual(areas.status, 200, JSON.stringify(areas.json));
  assert.strictEqual(areas.json.areaSize, 'large');
  assert.ok(areas.json.cells.length > 0 && areas.json.cells.every((c) => c.boundary.length >= 6));
  assert.ok(!JSON.stringify(areas.json).includes('Elm St'), 'never an address');

  // And back to exact doors.
  await refreshTo(p._id, { mapMode: 'pins' });
  doc = await apply(p._id);
  assert.strictEqual(doc.visibility.mapMode, 'pins');
  assert.ok(doc.mapPointCount > 0);
  assert.strictEqual(await ClientReportAreaCell.countDocuments({ clientReportId: p._id }), 0, 'the cells went with the old snapshot');
});

test('Switch to areas: the client keeps exact doors until the remap commits; a cancelled remap changes nothing', { skip }, async () => {
  const p = await publishedReport();
  const before = await ClientReport.findById(p._id).lean();
  let res = await call('PATCH', `/admin/client-reports/${p._id}`, asAdmin({ visibility: { mapMode: 'area' }, title: 'With areas' }));
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  let doc = await ClientReport.findById(p._id).lean();
  assert.strictEqual(doc.build.kind, 'remap');
  assert.strictEqual(doc.visibility.mapMode, 'pins', 'nothing on the report changes until the commit');
  assert.strictEqual((await shared(`/reports/${p._id}/map`)).status, 200, 'still exact doors');
  const out = await runBuild(p._id);
  assert.ok(out.committed, JSON.stringify(out));
  doc = await ClientReport.findById(p._id).lean();
  assert.strictEqual(doc.visibility.mapMode, 'area');
  assert.strictEqual(doc.mapPointCount, 0);
  assert.ok(doc.areaCellCount > 0);
  assert.deepStrictEqual(doc.stats, before.stats, 'the numbers do not change');
  assert.ok(doc.contentEditedAt, 'the client sees Edited');
  // The map view is a setting the builder edits: the PATCH moved the version, and so does the commit
  // (contract C8) — an edit opened before the switch merges onto it.
  assert.strictEqual(doc.editVersion, (before.editVersion ?? 0) + 2);
  // The finished switch names the single-choice map questions that show no answers by area — the
  // same list the builder's checks read from the live cells (WALK-7).
  const finished = await call('GET', `/admin/client-reports/${p._id}`, asAdmin());
  assert.ok(Array.isArray(finished.json.build.areaWithoutAnswers));
  assert.deepStrictEqual(finished.json.build.areaWithoutAnswers, finished.json.checks.areaWithoutAnswers);
  assert.ok(finished.json.build.areaWithoutAnswers.every((a) => a.key && a.label));
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: p._id }), 0, "a remap's leftover pins are gone");
  assert.strictEqual((await shared(`/reports/${p._id}/areas`)).status, 200);
  assert.ok(await CampaignChange.exists({ clientReportId: p._id, field: 'clientReport.remapped' }));
  // Back to pins is a Refresh, never an edit.
  res = await call('PATCH', `/admin/client-reports/${p._id}`, asAdmin({ visibility: { mapMode: 'pins' } }));
  assert.deepStrictEqual(res.json.reasons, ['back_to_exact_doors']);

  const q = await publishedReport();
  await call('PATCH', `/admin/client-reports/${q._id}`, asAdmin({ visibility: { mapMode: 'area' } }));
  // The queue is down here, so this remap failed to start: a failed remap changes nothing...
  doc = await ClientReport.findById(q._id).lean();
  assert.strictEqual(doc.build.status, 'failed');
  assert.strictEqual(doc.visibility.mapMode, 'pins');
  // ...and neither does a cancelled one (a queued remap, as if the queue had taken it).
  await ClientReport.updateOne({ _id: q._id }, { $set: { 'build.status': 'queued', 'build.error': null } });
  res = await call('POST', `/admin/client-reports/${q._id}/build/cancel`, asAdmin());
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  doc = await ClientReport.findById(q._id).lean();
  assert.strictEqual(doc.visibility.mapMode, 'pins');
  assert.strictEqual(String(doc.snapshotId), String(q.snapshotId));
  assert.strictEqual((await shared(`/reports/${q._id}/map`)).status, 200);
});

test('§O1: a removal that lands DURING a build sticks, and never comes back at the first Refresh', { skip }, async () => {
  const report = await createReport();
  let patched = false;
  const out = await runBuild(report._id, {
    updateProgress: async () => {
      if (patched) return;
      patched = true;
      const res = await call('PATCH', `/admin/client-reports/${report._id}`, asAdmin({ title: 'Edited mid-build', visibility: { mapAnswerKeys: ['issues'] } }));
      assert.strictEqual(res.status, 200, JSON.stringify(res.json));
      const mid = await ClientReport.findById(report._id).lean();
      assert.deepStrictEqual(mid.build.inputs.mapKeys, ['issues'], "the live build's target is pruned");
    },
  });
  assert.ok(out.committed, JSON.stringify(out));
  const doc = await ClientReport.findById(report._id).lean();
  assert.strictEqual(doc.title, 'Edited mid-build', 'no lost update against the commit');
  assert.deepStrictEqual(doc.snapshotInputs.mapKeys, ['issues'], 'the commit read the pruned inputs inside its write');
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: report._id, 'answers.questionKey': { $in: ['support', 'sign'] } }), 0);
  assert.strictEqual((await publishNow(report._id)).status, 200);
  const ready = await refreshTo(report._id);
  assert.deepStrictEqual(ready.build.inputs.mapKeys, ['issues'], "the Refresh's base is the pruned settings");
  const applied = await apply(report._id);
  assert.deepStrictEqual(applied.visibility.mapAnswerKeys, ['issues']);

  // The map turned off on a DRAFT stays off through publish and the first Refresh.
  const e = await built();
  await call('PATCH', `/admin/client-reports/${e._id}`, asAdmin({ visibility: { showMap: false } }));
  assert.strictEqual((await publishNow(e._id)).status, 200);
  await refreshTo(e._id);
  const off = await apply(e._id);
  assert.strictEqual(off.visibility.showMap, false);
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: e._id }), 0);
});

// ── Next report (§F10) ────────────────────────────────────────────────────────────────────────

test('Next: a double click returns ONE draft; the period follows on exactly; notes are copied and marked', { skip }, async () => {
  const src = await built({ title: 'Week 1' });
  await call('PATCH', `/admin/client-reports/${src._id}`, asAdmin({ observations: [{ heading: 'Doors', body: 'North first.' }] }));
  const [a, b] = await Promise.all([
    call('POST', `/admin/client-reports/${src._id}/next`, asAdmin()),
    call('POST', `/admin/client-reports/${src._id}/next`, asAdmin()),
  ]);
  assert.ok([200, 201].includes(a.status) && [200, 201].includes(b.status), JSON.stringify([a.json, b.json]));
  assert.strictEqual(a.json.report._id, b.json.report._id, 'one draft for two clicks');
  const next = await ClientReport.findById(a.json.report._id).lean();
  assert.strictEqual(next.weekStart, '2026-07-13');
  assert.strictEqual(next.weekEnd, '2026-07-19');
  assert.strictEqual(String(next.rangeStartUtc), String(src.rangeEndUtc), 'starts exactly where the source ended');
  assert.strictEqual(String(next.seriesId), String(src.seriesId));
  assert.strictEqual(next.title, '');
  assert.deepStrictEqual(next.observations.map((o) => o.heading), ['Doors']);
  assert.strictEqual(next.copiedNotesReviewed, false);
  assert.strictEqual(String(next.copiedFrom.reportId), String(src._id));
  assert.strictEqual(next.build.kind, 'recompute', 'inserted with a recompute already claimed');
  assert.strictEqual(await ClientReport.countDocuments({ seriesId: src.seriesId, weekStart: '2026-07-13' }), 1);

  // A deleted draft frees the source for a new Next.
  await call('DELETE', `/admin/client-reports/${next._id}`, asAdmin());
  assert.strictEqual((await ClientReport.findById(src._id).lean()).nextReportId, null, 'Delete clears the pointer');
  const again = await call('POST', `/admin/client-reports/${src._id}/next`, asAdmin());
  assert.strictEqual(again.status, 201);
  await call('DELETE', `/admin/client-reports/${again.json.report._id}`, asAdmin());
});

test('Next rolls a whole month by month, and a DST week stays seven days', { skip }, async () => {
  // Each on a walk list of its own: Next refuses a report that isn't the latest of its series.
  const monthly = await Effort.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, name: 'Monthly' });
  const weekly = await Effort.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, name: 'Weekly' });
  const month = await ClientReport.create(reportDoc({
    effortId: monthly._id, effortName: 'Monthly',
    weekStart: '2026-02-01', weekEnd: '2026-02-28',
    rangeStartUtc: new Date('2026-02-01T06:00:00Z'), rangeEndUtc: new Date('2026-03-01T06:00:00Z'),
    status: 'published', visibility: { visibleQuestionKeys: [], mapAnswerKeys: [], showMap: false },
  }));
  let res = await call('POST', `/admin/client-reports/${month._id}/next`, asAdmin());
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  assert.deepStrictEqual([res.json.report.weekStart, res.json.report.weekEnd], ['2026-03-01', '2026-03-31']);
  const dst = await ClientReport.create(reportDoc({
    effortId: weekly._id, effortName: 'Weekly',
    weekStart: '2026-10-26', weekEnd: '2026-11-01',
    rangeStartUtc: new Date('2026-10-26T05:00:00Z'), rangeEndUtc: new Date('2026-11-02T06:00:00Z'),
    status: 'published', visibility: { visibleQuestionKeys: [], mapAnswerKeys: [], showMap: false },
  }));
  res = await call('POST', `/admin/client-reports/${dst._id}/next`, asAdmin());
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  assert.deepStrictEqual([res.json.report.weekStart, res.json.report.weekEnd], ['2026-11-02', '2026-11-08']);
  assert.ok(res.json.warnings.includes('STARTS_AFTER_TODAY') || res.json.report.weekStart <= new Date().toISOString().slice(0, 10));
});

// ── Earlier totals (owner ruling 10-24, §F4, §O9) ─────────────────────────────────────────────

test('earlier totals: a late knock in a sent period shows as one neutral line; the clause drops when that report is taken down', { skip }, async () => {
  const first = await publishedReport({ title: 'Earlier' });
  const n = await call('POST', `/admin/client-reports/${first._id}/next`, asAdmin());
  assert.strictEqual(n.status, 201, JSON.stringify(n.json));
  // A knock timed inside the first report's period, synced after it was built.
  const hh = await makeHousehold();
  await act(hh, 'not_home', inPeriod(50), { passId: new ObjectId() });
  assert.ok((await runBuild(n.json.report._id)).committed);
  const second = await ClientReport.findById(n.json.report._id).lean();
  assert.strictEqual(String(second.comparedReportId), String(first._id));
  assert.strictEqual(second.earlierTotals.doorsKnocked, first.stats.cumulative.totals.doorsKnocked + 1);
  assert.strictEqual((await publishNow(second._id)).status, 200);
  let one = await shared(`/reports/${second._id}`);
  assert.deepStrictEqual(one.json.report.earlierTotals, {
    changes: [{ card: 'doorsKnocked', delta: 1 }],
    since: { weekStart: first.weekStart, weekEnd: first.weekEnd },
  });
  await call('POST', `/admin/client-reports/${first._id}/take-down`, asAdmin());
  one = await shared(`/reports/${second._id}`);
  assert.deepStrictEqual(one.json.report.earlierTotals, { changes: [{ card: 'doorsKnocked', delta: 1 }], since: null });
  await call('DELETE', `/admin/client-reports/${first._id}`, asAdmin());
  one = await shared(`/reports/${second._id}`);
  assert.strictEqual(one.json.report.earlierTotals, null, 'gone with the report it compared against');
});

// Round-1 review fixes. Each test runs on a campaign of its own in the suite's org: the main series
// already has later reports, and Next is offered only on a series' latest.
let ownN = 0;
const ownCampaign = () => {
  ownN += 1;
  return Campaign.create({
    organizationId: ctx.org._id, name: `Own ${ownN}`, type: 'survey', state: 'FL', isActive: true,
    surveyTemplateId: ctx.template._id, timeZone: 'America/Chicago',
  });
};
const doorIn = (camp) => {
  hhN += 1;
  return Household.create({
    organizationId: ctx.org._id, campaignId: camp._id, isActive: true,
    addressLine1: `${hhN} Elm St`, city: 'Tampa', state: 'FL', zipCode: '33601', normalizedAddress: `${hhN} ELM ST|TAMPA|FL|33601`,
    location: { type: 'Point', coordinates: [-82.46 + hhN / 1e3, 27.95] },
  });
};
// When a row reached the server is its createdAt; the raw driver sets one in the past (the model
// stamps the insert's own time).
const receivedAt = async (Model, doc, createdAt) => {
  if (createdAt) await Model.collection.updateOne({ _id: doc._id }, { $set: { createdAt } });
  return doc;
};
const knockIn = async (camp, actionType, timestamp, { createdAt = null } = {}) =>
  receivedAt(CanvassActivity, await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: camp._id, householdId: (await doorIn(camp))._id, userId: ctx.a1._id,
    coordinatorId: ctx.leadA._id, actionType, timestamp, passId: ctx.pass1, location: { lat: 27.95, lng: -82.46 },
  }), createdAt);
const surveyIn = async (camp, submittedAt, { createdAt = null } = {}) => {
  const hh = await doorIn(camp);
  voterN += 1;
  const voter = await Voter.create({
    organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id,
    stateVoterId: `FL${9000 + voterN}`, firstName: 'V', lastName: `N${voterN}`, fullName: `V N${voterN}`,
  });
  return receivedAt(SurveyResponse, await SurveyResponse.create({
    organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, voterId: voter._id, userId: ctx.a1._id,
    coordinatorId: ctx.leadA._id, surveyTemplateId: ctx.template._id, surveyTemplateVersion: 1, passId: ctx.pass1,
    location: { lat: 27.95, lng: -82.46 }, submittedAt, answers: [ans('support', ['y'], 'Yes')],
  }), createdAt);
};
const builtIn = async (camp, body = {}) => built({ campaignId: String(camp._id), ...body });
const nextBuilt = async (r) => {
  const res = await call('POST', `/admin/client-reports/${r._id}/next`, asAdmin());
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  assert.ok((await runBuild(res.json.report._id)).committed);
  return ClientReport.findById(res.json.report._id).lean();
};
const previewOf = async (id) => (await call('GET', `/admin/client-reports/${id}/preview`, asAdmin())).json.report;
const checksFor = async (id) => (await call('GET', `/admin/client-reports/${id}`, asAdmin())).json.checks;

test('NUM-1: once the earlier report is refreshed, the later one hides its line — never "−30 doors" — and the builder names the report that moved', { skip }, async () => {
  const camp = await ownCampaign();
  for (let i = 0; i < 3; i += 1) await knockIn(camp, 'not_home', inPeriod(i));
  const first = await builtIn(camp);
  assert.strictEqual((await publishNow(first._id)).status, 200);
  // A knock timed in the first period that synced after it was built: the honest "+1 door".
  const nx = await call('POST', `/admin/client-reports/${first._id}/next`, asAdmin());
  assert.strictEqual(nx.status, 201, JSON.stringify(nx.json));
  await knockIn(camp, 'not_home', inPeriod(40));
  assert.ok((await runBuild(nx.json.report._id)).committed);
  const second = await ClientReport.findById(nx.json.report._id).lean();
  assert.strictEqual(String(second.comparedSnapshotId), String(first.snapshotId), 'the compared snapshot is frozen with the recount');
  assert.strictEqual((await publishNow(second._id)).status, 200);
  assert.deepStrictEqual((await previewOf(second._id)).earlierTotals.changes, [{ card: 'doorsKnocked', delta: 1 }]);

  // The rest of the first period comes in, and the operator refreshes it to include them.
  for (let i = 0; i < 30; i += 1) await knockIn(camp, 'not_home', inPeriod(50 + i));
  await refreshTo(first._id);
  await apply(first._id);
  const refreshed = await ClientReport.findById(first._id).lean();
  assert.strictEqual(refreshed.stats.cumulative.totals.doorsKnocked, 34);
  assert.strictEqual((await previewOf(second._id)).earlierTotals, null, 'its recount says nothing about what that report shows now');
  let c = await checksFor(second._id);
  assert.strictEqual(c.earlierTotals, null);
  assert.deepStrictEqual(c.earlierReportRefreshed, { weekStart: first.weekStart, weekEnd: first.weekEnd });
  assert.strictEqual(c.earlierReportsRefreshed, 0);

  // Refreshing the later report compares again, against the earlier report as it is now.
  await refreshTo(second._id);
  await apply(second._id);
  const again = await ClientReport.findById(second._id).lean();
  assert.strictEqual(String(again.comparedSnapshotId), String(refreshed.snapshotId));
  assert.strictEqual(again.earlierTotals.doorsKnocked, 34);
  assert.strictEqual((await previewOf(second._id)).earlierTotals, null, 'nothing moved since that refresh');
  c = await checksFor(second._id);
  assert.strictEqual(c.earlierReportRefreshed, null);
});

test('NUM-3: the recount takes what the earlier report had received by its cut-off — a fast phone clock is no door taken away', { skip }, async () => {
  const camp = await ownCampaign();
  // The earlier report's numbers stopped mid-period, at `cut`.
  const cut = inPeriod(48);
  const before = new Date(cut.getTime() - 3600e3);
  const fast = new Date(cut.getTime() + 4 * 60e3); // a phone clock four minutes ahead
  const after = new Date(cut.getTime() + 3600e3);
  // Received by the cut-off: one door and one survey timed before it, one of each timed after it.
  await knockIn(camp, 'not_home', before, { createdAt: before });
  await knockIn(camp, 'not_home', fast, { createdAt: before });
  await surveyIn(camp, before, { createdAt: before });
  await surveyIn(camp, fast, { createdAt: before });
  const first = await builtIn(camp);
  assert.deepStrictEqual([first.stats.cumulative.totals.doorsKnocked, first.stats.cumulative.totals.surveysTaken], [2, 2]);
  assert.strictEqual((await publishNow(first._id)).status, 200);
  await ClientReport.updateOne({ _id: first._id }, { $set: { statsComputedAt: cut } });
  // Received after it: a late sync timed before the cut-off (a real correction) and the rest of the
  // period (never part of the earlier report).
  await knockIn(camp, 'not_home', before, { createdAt: after });
  await knockIn(camp, 'not_home', after, { createdAt: after });
  await surveyIn(camp, before, { createdAt: after });
  await surveyIn(camp, after, { createdAt: after });

  const second = await nextBuilt(first);
  assert.deepStrictEqual(
    [second.earlierTotals.doorsKnocked, second.earlierTotals.surveysTaken, second.earlierTotals.surveyedVoters],
    [3, 3, 3],
    'the fast-clock rows count (the earlier report had them); only the late sync is new'
  );
  assert.deepStrictEqual((await previewOf(second._id)).earlierTotals.changes, [
    { card: 'doorsKnocked', delta: 1 },
    { card: 'surveysTaken', delta: 1 },
    { card: 'surveyedVoters', delta: 1 },
  ]);
});

test('PUBUX-6: two reports starting the same day each get an arrow to the other, in the hub’s order', { skip }, async () => {
  const camp = await ownCampaign();
  await knockIn(camp, 'not_home', inPeriod(1));
  const r0 = await builtIn(camp, { weekStart: '2026-06-29', weekEnd: '2026-07-05' });
  const r1 = await builtIn(camp);
  const r2 = await builtIn(camp);
  for (const r of [r0, r1, r2]) assert.strictEqual((await publishNow(r._id)).status, 200);
  const nav = async (r) => (await previewOf(r._id)).nav;
  assert.deepStrictEqual(await nav(r0), { olderId: null, newerId: String(r1._id) });
  assert.deepStrictEqual(await nav(r1), { olderId: String(r0._id), newerId: String(r2._id) }, 'same start: published first is older');
  assert.deepStrictEqual(await nav(r2), { olderId: String(r1._id), newerId: null });
  // A draft of the same week previews where it will sit once published: after both.
  const draft = await builtIn(camp);
  assert.deepStrictEqual(await nav(draft), { olderId: String(r2._id), newerId: null });
});

// ── Area view (§F5, §O5: all or nothing per question) ─────────────────────────────────────────

test('area view: no pins, single choice only, all-or-nothing per question, follow-ups only with their parents', { skip }, async () => {
  const t = await freshTenant('areas');
  const tpl = await SurveyTemplate.findOne({ organizationId: t.org._id }).lean();
  // Ten surveyed homes packed into one small hexagon: support Yes x6 / No x4, sign on the Yes ones.
  const near = async (i, answers) => {
    const hh = await Household.create({
      organizationId: t.org._id, campaignId: t.camp._id, isActive: true, addressLine1: `${i} Pine`, city: 'Tampa', state: 'FL',
      zipCode: '33601', normalizedAddress: `area${i}`, location: { type: 'Point', coordinates: [-82.5 + i * 1e-5, 28.0] },
    });
    await CanvassActivity.create({ organizationId: t.org._id, campaignId: t.camp._id, householdId: hh._id, userId: ctx.a1._id, actionType: 'survey_submitted', timestamp: inPeriod(i), passId: ctx.pass1, location: { lat: 28, lng: -82.5 } });
    const v = await Voter.create({ organizationId: t.org._id, campaignId: t.camp._id, householdId: hh._id, stateVoterId: `AR${i}`, firstName: 'A', lastName: `R${i}`, fullName: `A R${i}` });
    await SurveyResponse.create({ organizationId: t.org._id, campaignId: t.camp._id, householdId: hh._id, voterId: v._id, userId: ctx.a1._id, surveyTemplateId: tpl._id, surveyTemplateVersion: 1, passId: ctx.pass1, location: { lat: 28, lng: -82.5 }, submittedAt: inPeriod(i), answers });
    return hh;
  };
  for (let i = 0; i < 10; i += 1) {
    await near(i, i < 6
      ? [ans('support', ['y'], 'Yes'), ans('sign', ['s1'], 'Yes'), ans('issues', ['a'], ['Schools'])]
      : [ans('support', ['n'], 'No'), ans('issues', ['b'], ['Roads'])]);
  }
  const campaign = await Campaign.findById(t.camp._id).lean();
  const deps = [['sign', ['support']]];
  const build = async () => {
    const snapshotId = new ObjectId();
    const out = await buildReportSnapshot({
      report: { ...reportDoc(), organizationId: t.org._id, campaignId: t.camp._id },
      campaign, template: tpl, snapshotId, fenceAt: new Date(),
      inputs: { showMap: true, mapMode: 'area', areaSize: 'small', mapKeys: ['support', 'sign', 'issues'], questionDeps: deps, coordinatorIds: [] },
    });
    return { out, cells: await ClientReportAreaCell.find({ snapshotId }).lean(), snapshotId };
  };
  let { out, cells, snapshotId } = await build();
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ snapshotId }), 0, 'an area report stores no pins');
  assert.strictEqual(out.mapPointCount, 0);
  const packed = cells.find((c) => c.doors >= 10);
  assert.ok(packed, 'the ten homes share one area');
  assert.deepStrictEqual(packed.answers.map((a) => a.questionKey).sort(), ['sign', 'support'], 'single choice only (issues is multiple choice)');
  const support = packed.answers.find((a) => a.questionKey === 'support');
  assert.strictEqual(support.n, 10);
  assert.ok(out.extent && out.extent.maxLat > out.extent.minLat, 'an extent from the cells');

  // One surveyed home far away: its area has one answer, so NO area shows support answers — and
  // the follow-up, whose parent no longer shows, goes too. Doors and statuses stay everywhere.
  const far = await Household.create({
    organizationId: t.org._id, campaignId: t.camp._id, isActive: true, addressLine1: '1 Far', city: 'Tampa', state: 'FL',
    zipCode: '33601', normalizedAddress: 'area-far', location: { type: 'Point', coordinates: [-81.0, 29.0] },
  });
  await CanvassActivity.create({ organizationId: t.org._id, campaignId: t.camp._id, householdId: far._id, userId: ctx.a1._id, actionType: 'survey_submitted', timestamp: inPeriod(20), passId: ctx.pass1, location: { lat: 29, lng: -81 } });
  const fv = await Voter.create({ organizationId: t.org._id, campaignId: t.camp._id, householdId: far._id, stateVoterId: 'ARFAR', firstName: 'F', lastName: 'Ar', fullName: 'F Ar' });
  await SurveyResponse.create({ organizationId: t.org._id, campaignId: t.camp._id, householdId: far._id, voterId: fv._id, userId: ctx.a1._id, surveyTemplateId: tpl._id, surveyTemplateVersion: 1, passId: ctx.pass1, location: { lat: 29, lng: -81 }, submittedAt: inPeriod(20), answers: [ans('support', ['y'], 'Yes'), ans('sign', ['s2'], 'No')] });
  ({ out, cells } = await build());
  assert.ok(cells.length >= 2);
  assert.ok(cells.every((c) => c.answers.length === 0), 'all or nothing: no area shows support or its follow-up');
  assert.ok(cells.every((c) => c.doors >= 1 && Object.keys(c.byStatus).length), 'doors and statuses for every area, even a one-home one');
  assert.deepStrictEqual(out.areaQuestions, []);
});

// ── History (§F9, §O8) ────────────────────────────────────────────────────────────────────────

test('History: client-report rows stay out of the general feed; edits keep one copy of each version; Restore and Erase', { skip }, async () => {
  const p = await publishedReport({ title: 'Original title' });
  await call('PATCH', `/admin/client-reports/${p._id}`, asAdmin({ title: 'Second title' }));
  await call('PATCH', `/admin/client-reports/${p._id}`, asAdmin({ title: 'Third title' }));
  const general = await call('GET', `/admin/campaigns/${ctx.camp._id}/history`, asAdmin());
  assert.strictEqual(general.status, 200);
  assert.ok(!general.json.items.some((i) => String(i.field || '').startsWith('clientReport')), 'never in the general feed');
  const tab = await call('GET', `/admin/campaigns/${ctx.camp._id}/history?include=client_reports`, asAdmin());
  assert.ok(tab.json.items.length > 0 && tab.json.items.every((i) => i.kind === 'client_report'), 'only client-report rows');
  const edits = tab.json.items.filter((i) => i.clientReportId === String(p._id) && i.field === 'clientReport.edited');
  assert.deepStrictEqual(edits.map((e) => e.fromValue.title).sort(), ['Original title', 'Second title'], 'each earlier version once');
  assert.ok(edits.every((e) => e.toValue === null && e.periodLabel), 'the current text lives on the report');

  const original = edits.find((e) => e.fromValue.title === 'Original title');
  let res = await call('POST', `/admin/campaigns/${ctx.camp._id}/history/${original.id}/restore`, asAdmin());
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.report.title, 'Original title');

  // A lead can restore but never erase.
  res = await call('POST', `/admin/campaigns/${ctx.camp._id}/history/${original.id}/erase`, { ...ctx.lead });
  assert.strictEqual(res.status, 403);
  res = await call('POST', `/admin/campaigns/${ctx.camp._id}/history/${original.id}/erase`, asAdmin({}));
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.currentTextMatches, true, 'warns: the erased text is the current text');
  res = await call('POST', `/admin/campaigns/${ctx.camp._id}/history/${original.id}/restore`, asAdmin());
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.json.code, 'HISTORY_ERASED', 'a stale Restore of an erased row is refused');

  res = await call('POST', `/admin/campaigns/${ctx.camp._id}/history/erase`, asAdmin({ clientReportId: String(p._id) }));
  assert.strictEqual(res.status, 200);
  const left = await CampaignChange.find({ clientReportId: p._id, field: 'clientReport.edited', fromValue: { $ne: null } }).lean();
  assert.strictEqual(left.length, 0, 'erase-all reaches every earlier text of the report');
  const epoch = (await ClientReport.findById(p._id).lean()).eraseEpoch;
  assert.ok(epoch >= 2, 'each Erase bumps the report-level epoch');
});

// ── The builder's reads: overlay preview, the "Before you publish" checks, preview maps ───────

test('preview: POST overlays the on-screen state through the public shapers; the map follows the snapshot', { skip }, async () => {
  const r = await built();
  const res = await call('POST', `/admin/client-reports/${r._id}/preview`, asAdmin({
    title: 'Unsaved title',
    visibility: { visibleQuestionKeys: ['support'] },
  }));
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.report.title, 'Unsaved title', 'the draft on screen, not the last save');
  assert.deepStrictEqual(res.json.report.stats.cumulative.surveyBreakdowns.map((b) => b.questionKey), ['support']);
  assert.deepStrictEqual(res.json.survey.questions.map((q) => q.key), ['support'], 'a question hidden on screen is not served on the map either');
  assert.ok(res.json.provenance.cumulative, 'the internal counts ride beside it');
  assert.strictEqual((await ClientReport.findById(r._id).lean()).title, '', 'nothing saved');

  const map = await call('GET', `/admin/client-reports/${r._id}/preview/map`, asAdmin());
  assert.strictEqual(map.status, 200, JSON.stringify(map.json));
  assert.strictEqual(map.json.snapshotKey, r.snapshotKey);
  const doors = await call('GET', `/admin/client-reports/${r._id}/preview/map/doors?snapshotKey=${encodeURIComponent(r.snapshotKey)}&rows=0`, asAdmin());
  assert.strictEqual(doors.status, 200);
  assert.strictEqual(doors.json.doors.length, 1);
  const tooMany = await call('GET', `/admin/client-reports/${r._id}/preview/map/doors?snapshotKey=${encodeURIComponent(r.snapshotKey)}&rows=${[...Array(201).keys()].join(',')}`, asAdmin());
  assert.strictEqual(tooMany.json.code, 'TOO_MANY_ROWS');
});

test('GET /:id carries the build and what is worth a look before publishing', { skip }, async () => {
  const r = await built();
  const res = await call('GET', `/admin/client-reports/${r._id}`, asAdmin());
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  const c = res.json.checks;
  assert.strictEqual(c.periodNotOver, false);
  assert.ok(c.numbersAsOf);
  assert.strictEqual(typeof c.openMockFlags, 'number');
  assert.ok(c.links.usable >= 1, 'the suite has a usable link');
  assert.strictEqual(res.json.build.status, 'idle');
  assert.ok(res.json.seriesLabel);
  // A visible follow-up chart whose parent is hidden is flagged (its total shows the parent's Yes).
  await call('PATCH', `/admin/client-reports/${r._id}`, asAdmin({ visibility: { visibleQuestionKeys: ['sign'] } }));
  const fresh = await ClientReport.findById(r._id).lean();
  await ClientReport.updateOne({ _id: r._id }, { $set: { 'snapshotInputs.questionDeps': [['sign', ['support']]] } });
  const again = await call('GET', `/admin/client-reports/${r._id}`, asAdmin());
  assert.deepStrictEqual(again.json.checks.hiddenParentCharts.map((x) => x.key), ['sign']);
  assert.ok(fresh.editVersion >= 1);
});

test('a hidden parent is named by its label and type — a written one too, never by its internal key', { skip }, async () => {
  const r = await built();
  await call('PATCH', `/admin/client-reports/${r._id}`, asAdmin({ visibility: { visibleQuestionKeys: ['sign', 'issues'] } }));
  // "Top issues" asked only after "Anything else?" (a written question, which has no chart of its own).
  await ClientReport.updateOne({ _id: r._id }, { $set: { 'snapshotInputs.questionDeps': [['sign', ['support']], ['issues', ['notes']]] } });
  const res = await call('GET', `/admin/client-reports/${r._id}`, asAdmin());
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  const byKey = Object.fromEntries(res.json.checks.hiddenParentCharts.map((h) => [h.key, h]));
  assert.deepStrictEqual(byKey.sign.parents, [{ key: 'support', label: 'Support Smith?', type: 'single_choice' }]);
  assert.deepStrictEqual(byKey.issues.parents, [{ key: 'notes', label: 'Anything else?', type: 'text' }], 'the written parent by its own words');
  assert.strictEqual(byKey.issues.label, 'Top issues');
  // A parent the survey no longer has: type null, so the builder never names it by its key.
  await ClientReport.updateOne({ _id: r._id }, { $set: { 'snapshotInputs.questionDeps': [['issues', ['gone_question']]] } });
  const gone = await call('GET', `/admin/client-reports/${r._id}`, asAdmin());
  assert.deepStrictEqual(gone.json.checks.hiddenParentCharts.find((h) => h.key === 'issues').parents, [{ key: 'gone_question', label: 'gone_question', type: null }]);
});
