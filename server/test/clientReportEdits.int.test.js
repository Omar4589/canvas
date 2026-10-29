import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Editing client reports and reading old ones — code review round 1 (C4, C5, C6/NUM-5, STATE-2,
// LEGACY-1, LEGACY-2, LEGACY-3) and the lead's ruling on reports without snapshotInputs — against the
// real app and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/credits node --test test/clientReportEdits.int.test.js
//
// The campaign moved surveys: Round 1 asked "Yard sign?" only after Yes to "Support?"; Round 2 (its
// survey now) asks "Yard sign?" of everyone, plus "Voting plan?". A report PUBLISHED before snapshots
// takes its follow-up dependencies from EVERY survey its campaign's answers came from and fails closed;
// a draft (built or not) maps only its current survey's answers.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-client-report-edits';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.CLIENT_REPORT_QUEUE_TIMEOUT_MS = '300';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ClientReportMapPoint } = await import('../src/models/ClientReportMapPoint.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { processClientReportJob } = await import('../src/services/reports/clientReportBuilds.js');
const { runClientReportVisibility } = await import('../src/migrations/clientReportVisibility.js');
const bcrypt = (await import('bcryptjs')).default;

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
// Each report through its own link (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C2), made the first time a path
// names it: `/reports/<id>…`.
const shareLinks = new Map();
const shared = async (path) => {
  const id = path.match(/^\/reports\/([0-9a-f]{24})/)[1];
  if (!shareLinks.has(id)) {
    const token = `edits-link-${id}`;
    await ReportShareLink.create({
      organizationId: ctx.org._id, campaignId: ctx.camp._id, token, label: 'Client', reportId: id,
      passwordHash: await bcrypt.hash('edits-password-1', 4), expiresAt: new Date(Date.now() + 86400e3), isActive: true,
    });
    const unlock = await fetch(`${base}/api/share/${token}/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'edits-password-1' }) });
    shareLinks.set(id, { token, access: (await unlock.json()).accessToken });
  }
  const { token, access } = shareLinks.get(id);
  const res = await fetch(`${base}/api/share/${token}${path}`, { headers: { 'X-Share-Token': access } });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};
// The queue is down here: claim through the real route, then drive the real processor (a Retry).
const runBuild = async (reportId) => {
  const jobId = new ObjectId().toHexString();
  await ClientReport.updateOne({ _id: reportId }, { $set: { 'build.status': 'queued', 'build.jobId': jobId, 'build.startedAt': new Date(), 'build.error': null } });
  return processClientReportJob({ id: jobId, data: { reportId: String(reportId) }, moveToDelayed: async () => {}, updateProgress: async () => {} }, 'token');
};
const draft = async (extra = {}) => {
  // allowDuplicate: one week drafted many times on purpose (the duplicate guard has its own suite).
  const res = await call('POST', '/admin/client-reports', { campaignId: String(ctx.camp._id), weekStart: '2026-07-06', weekEnd: '2026-07-12', allowDuplicate: true, ...extra });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  return res.json.report;
};
const builtAndPublished = async (patch = null) => {
  const r = await draft();
  assert.ok((await runBuild(r._id)).committed);
  if (patch) assert.strictEqual((await call('PATCH', `/admin/client-reports/${r._id}`, patch)).status, 200);
  const doc = await ClientReport.findById(r._id).lean();
  const pub = await call('POST', `/admin/client-reports/${r._id}/publish`, { snapshotId: String(doc.snapshotId), editVersion: doc.editVersion });
  assert.strictEqual(pub.status, 200, JSON.stringify(pub.json));
  return ClientReport.findById(r._id).lean();
};
const answerKeysIn = async (reportId, snapshotId) =>
  [...new Set((await ClientReportMapPoint.find({ clientReportId: reportId, snapshotId }, { answers: 1 }).lean()).flatMap((p) => (p.answers || []).map((a) => a.questionKey)))].sort();

const RANGE_START = new Date('2026-07-06T05:00:00Z');
const RANGE_END = new Date('2026-07-13T05:00:00Z');
const at = (h) => new Date(RANGE_START.getTime() + (24 + h) * 3600e3);

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await ClientReportMapPoint.syncIndexes();
  const org = await Organization.create({ name: 'Edits Org', slug: 'edits-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ada@edits.t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  // Both surveys from before depsEver (raw: no depsEver, no depsEverFromVersion).
  const r1 = new ObjectId();
  const r2 = new ObjectId();
  await SurveyTemplate.collection.insertMany([
    {
      _id: r1, organizationId: org._id, name: 'Round 1', isActive: false, version: 1, tags: [], flow: 'list',
      questions: [
        { key: 'support', label: 'Support?', type: 'single_choice', order: 0, options: [{ id: 'y', text: 'Yes' }, { id: 'n', text: 'No' }] },
        { key: 'sign', label: 'Yard sign?', type: 'single_choice', order: 1, options: [{ id: 's', text: 'Yes' }, { id: 'x', text: 'No' }], visibleIf: { logic: 'all', rules: [{ questionKey: 'support', op: 'is', optionIds: ['y'] }] } },
      ],
    },
    {
      _id: r2, organizationId: org._id, name: 'Round 2', isActive: true, version: 1, tags: [], flow: 'list',
      questions: [
        { key: 'sign', label: 'Yard sign?', type: 'single_choice', order: 0, options: [{ id: 's', text: 'Yes' }, { id: 'x', text: 'No' }] },
        { key: 'plan', label: 'Voting plan?', type: 'single_choice', order: 1, options: [{ id: 'e', text: 'Early' }, { id: 'd', text: 'Election day' }] },
      ],
    },
  ]);
  const camp = await Campaign.create({ organizationId: org._id, name: 'Edits', type: 'survey', state: 'FL', isActive: true, surveyTemplateId: r2, timeZone: 'America/Chicago' });
  const north = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  Object.assign(ctx, { org, admin, r1, r2, camp, north, token: signUserToken(admin) });

  // Four doors: two answered Round 1, two answered Round 2; every one knocked in the period.
  const pass = new ObjectId();
  for (let n = 1; n <= 4; n += 1) {
    const hh = await Household.create({ organizationId: org._id, campaignId: camp._id, isActive: true, addressLine1: `${n} Edit St`, city: 'Tampa', state: 'FL', zipCode: '33601', normalizedAddress: `EDIT${n}`, location: { type: 'Point', coordinates: [-82.4 + n / 1e3, 27.9] } });
    const v = await Voter.create({ organizationId: org._id, campaignId: camp._id, householdId: hh._id, stateVoterId: `E${n}`, firstName: 'V', lastName: `E${n}`, fullName: `V E${n}` });
    await CanvassActivity.create({ organizationId: org._id, campaignId: camp._id, householdId: hh._id, voterId: v._id, userId: admin._id, actionType: 'survey_submitted', timestamp: at(n), passId: pass, location: { lat: 27.9, lng: -82.4 } });
    const round1 = n <= 2;
    await SurveyResponse.create({
      organizationId: org._id, campaignId: camp._id, householdId: hh._id, voterId: v._id, userId: admin._id, passId: pass,
      surveyTemplateId: round1 ? r1 : r2, surveyTemplateVersion: 1, location: { lat: 27.9, lng: -82.4 }, submittedAt: at(n),
      answers: round1
        ? [{ questionKey: 'support', questionLabel: 'Support?', optionIds: ['y'], answer: 'Yes' }, { questionKey: 'sign', questionLabel: 'Yard sign?', optionIds: [n === 1 ? 's' : 'x'], answer: n === 1 ? 'Yes' : 'No' }]
        : [{ questionKey: 'sign', questionLabel: 'Yard sign?', optionIds: ['s'], answer: 'Yes' }, { questionKey: 'plan', questionLabel: 'Voting plan?', optionIds: ['e'], answer: 'Early' }],
    });
  }

  // H: a report PUBLISHED before snapshots, frozen while the campaign was on Round 1: "Support?" hidden,
  // "Yard sign?" (its follow-up there) kept on the map list, plus a key no survey asks ("ghost").
  const breakdown = (questionKey, questionLabel, option) => ({ questionKey, questionLabel, type: 'single_choice', options: [{ option, count: 1, percent: 100 }] });
  const legacy = (extra) => ({
    _id: new ObjectId(), organizationId: org._id, campaignId: camp._id, title: 'Legacy', campaignType: 'survey', effortId: null, effortName: null,
    weekStart: '2026-06-29', weekEnd: '2026-07-05', timeZone: 'America/Chicago',
    rangeStartUtc: new Date('2026-06-29T05:00:00Z'), rangeEndUtc: new Date('2026-07-06T05:00:00Z'),
    status: 'published', publishedAt: new Date('2026-07-07T12:00:00Z'), observations: [], supportQuestionKey: null, mapPointCount: 3,
    stats: {
      cumulative: { totals: { doorsKnocked: 3 }, surveyBreakdowns: [breakdown('support', 'Support?', 'Yes'), breakdown('sign', 'Yard sign?', 'Yes'), breakdown('plan', 'Voting plan?', 'Early'), breakdown('ghost', 'Ghost?', 'Boo')] },
      period: { totals: { doorsKnocked: 3 }, surveyBreakdowns: [] },
    },
    visibility: { visibleQuestionKeys: ['sign', 'plan', 'ghost'], mapAnswerKeys: ['support', 'sign', 'plan', 'ghost'], showMap: true, visibleTags: [], showGoal: false },
    ...extra,
  });
  const H = legacy({});
  // U: a published report from before snapshots whose operator unticked every question.
  const U = legacy({ weekStart: '2026-06-22', weekEnd: '2026-06-28', rangeStartUtc: new Date('2026-06-22T05:00:00Z'), rangeEndUtc: new Date('2026-06-29T05:00:00Z'), visibility: { visibleQuestionKeys: [], mapAnswerKeys: ['plan'], showMap: true, visibleTags: [], showGoal: false } });
  await ClientReport.collection.insertMany([H, U]);
  const point = (reportId, i) => ({
    clientReportId: reportId, organizationId: org._id, campaignId: camp._id, householdId: new ObjectId(), lng: -82.4 + i / 1e3, lat: 27.9,
    addressLine1: `${i} Old St`, city: 'Tampa', state: 'FL', status: 'surveyed',
    answers: [{ questionKey: 'support', answer: 'Yes' }, { questionKey: 'sign', answer: i === 1 ? 'Yes' : 'No' }, { questionKey: 'plan', answer: 'Early' }, { questionKey: 'ghost', answer: 'Boo' }],
  });
  await ClientReportMapPoint.collection.insertMany([1, 2, 3].map((i) => point(H._id, i)));
  await ClientReportMapPoint.collection.insertMany([1, 2].map((i) => point(U._id, i)));
  Object.assign(ctx, { H, U });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const legacyView = async () => {
  const one = await shared(`/reports/${ctx.H._id}`);
  const map = await shared(`/reports/${ctx.H._id}/map`);
  return { status: one.status, filters: one.json.survey.questions.map((q) => q.key), answers: Object.keys(map.json.answers || {}), count: map.json.count, version: one.json.report.visibility.mapVersion };
};

test('a report published before snapshots serves its old map, fail closed — before and during a Refresh (LEGACY-1, the lead’s ruling)', { skip }, async () => {
  const seen = await legacyView();
  // Yard sign? was Round 1's follow-up of the hidden Support?: off. Ghost is no survey's question: off.
  assert.deepStrictEqual(seen, { status: 200, filters: ['plan'], answers: ['plan'], count: 3, version: seen.version });
  assert.ok(seen.version, 'its map is served');
  // C4: the builder reads the same live inputs from the server.
  const one = await call('GET', `/admin/client-reports/${ctx.H._id}`);
  assert.strictEqual(one.status, 200);
  assert.deepStrictEqual({ ...one.json.liveInputs, questionDeps: undefined }, { showMap: true, mapMode: 'pins', areaSize: 'small', mapKeys: ['plan'], questionDeps: undefined });
  assert.ok(one.json.liveInputs.questionDeps.some(([k, deps]) => k === 'sign' && deps.includes('support')), 'Round 1’s dependency is known');

  // A Refresh claimed (the queue is down here, so it parks as failed) — and then running: the build
  // object is no test, the old rows stay live until Apply.
  const claim = await call('POST', `/admin/client-reports/${ctx.H._id}/refresh`, {});
  assert.strictEqual(claim.status, 202, JSON.stringify(claim.json));
  assert.deepStrictEqual(await legacyView(), seen);
  const running = await ClientReport.findById(ctx.H._id).lean();
  await ClientReport.updateOne({ _id: ctx.H._id }, { $set: { 'build.status': 'running', 'build.beatAt': new Date(), 'build.error': null } });
  assert.ok(running.build?.inputs, 'a refresh build with its inputs');
  assert.deepStrictEqual(await legacyView(), seen, 'the same map while the Refresh runs');
  await ClientReport.updateOne({ _id: ctx.H._id }, { $set: { build: { status: 'idle' } } });
});

test('an unbuilt draft on a campaign that moved surveys keeps its map questions through a PATCH (the lead’s ruling)', { skip }, async () => {
  const d = await draft();
  // Round 2's own questions — "Yard sign?" is no follow-up there, whatever Round 1 said.
  assert.deepStrictEqual(d.visibility.mapAnswerKeys, ['sign', 'plan']);
  const claimed = await ClientReport.findById(d._id).lean();
  assert.deepStrictEqual(claimed.build.inputs.mapKeys, ['sign', 'plan']);
  await ClientReport.updateOne({ _id: d._id }, { $set: { 'build.status': 'queued', 'build.error': null } });
  const res = await call('PATCH', `/admin/client-reports/${d._id}`, { visibility: { mapMode: 'area' }, ifStatus: 'draft' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.deepStrictEqual(res.json.report.visibility.mapAnswerKeys, ['sign', 'plan'], 'nothing stripped');
  assert.deepStrictEqual(res.json.report.build.inputs.mapKeys, ['sign', 'plan'], 'nor from its claimed build');
  const one = await call('GET', `/admin/client-reports/${d._id}`);
  assert.deepStrictEqual(one.json.liveInputs, { showMap: false, mapMode: 'pins', areaSize: 'small', mapKeys: [], questionDeps: [] }, 'nothing is live yet');
  const pv = await call('GET', `/admin/client-reports/${d._id}/preview/map`);
  assert.strictEqual(pv.status, 404, 'a draft with nothing live serves no map');
  assert.strictEqual(pv.json.code, 'MAP_NOT_SHARED');
});

test('LEGACY-2: re-showing a chart hidden when an old report was frozen narrows its map silently — never NEEDS_REFRESH', { skip }, async () => {
  const res = await call('PATCH', `/admin/client-reports/${ctx.H._id}`, { visibility: { visibleQuestionKeys: ['support', 'sign', 'plan'] }, ifStatus: 'published' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.deepStrictEqual(res.json.report.visibility.mapAnswerKeys, ['plan'], 'what was never served is gone from the list');
  const view = await legacyView();
  assert.deepStrictEqual([view.filters, view.answers], [['plan'], ['plan']], 'the client’s map is unchanged');
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: ctx.H._id, 'answers.questionKey': { $in: ['support', 'sign', 'ghost'] } }), 0, 'and the rows lost those answers');
  // Yard sign? alone still can't go on (Round 1 asked it only after Support?): it just leaves the list.
  let res2 = await call('PATCH', `/admin/client-reports/${ctx.H._id}`, { visibility: { mapAnswerKeys: ['plan', 'sign'] } });
  assert.strictEqual(res2.status, 200, JSON.stringify(res2.json));
  assert.deepStrictEqual(res2.json.report.visibility.mapAnswerKeys, ['plan']);
  // And bringing its Round 1 parent back is no silent edit either: Support? is not a question of the
  // campaign's survey now, so it can't go on any map (an addition would need Refresh numbers anyway).
  res2 = await call('PATCH', `/admin/client-reports/${ctx.H._id}`, { visibility: { mapAnswerKeys: ['plan', 'support', 'sign'] } });
  assert.strictEqual(res2.status, 400, JSON.stringify(res2.json));
  assert.strictEqual(res2.json.code, 'MAP_ANSWER_KEYS_NOT_CHOICE');
  assert.deepStrictEqual(res2.json.rejected, ['support']);
  assert.deepStrictEqual((await ClientReport.findById(ctx.H._id).lean()).visibility.mapAnswerKeys, ['plan'], 'nothing changed');
});

test('C5: an edit made against one status never lands on another', { skip }, async () => {
  const p = await builtAndPublished();
  let res = await call('PATCH', `/admin/client-reports/${p._id}`, { title: 'half-typed', ifStatus: 'draft' });
  assert.strictEqual(res.status, 409, JSON.stringify(res.json));
  assert.deepStrictEqual({ code: res.json.code, status: res.json.status, takenDown: res.json.takenDown }, { code: 'STATUS_CHANGED', status: 'published', takenDown: false });
  assert.strictEqual((await ClientReport.findById(p._id).lean()).title, '', 'nothing written');
  res = await call('PATCH', `/admin/client-reports/${p._id}`, { title: 'Week 1', ifStatus: 'published' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.report.title, 'Week 1');
  assert.strictEqual((await call('POST', `/admin/client-reports/${p._id}/take-down`)).status, 200);
  res = await call('PATCH', `/admin/client-reports/${p._id}`, { title: 'x', ifStatus: 'draft' });
  assert.deepStrictEqual([res.status, res.json.takenDown], [409, true]);

  // The race the check exists for: read as a draft, published before the write lands.
  const d = await draft();
  assert.ok((await runBuild(d._id)).committed);
  const realUpdate = ClientReport.findOneAndUpdate.bind(ClientReport);
  ClientReport.findOneAndUpdate = (filter, ...rest) => {
    if (String(filter?._id) !== String(d._id) || filter?.status !== 'draft') return realUpdate(filter, ...rest);
    const raced = (async () => {
      await ClientReport.updateOne({ _id: d._id }, { $set: { status: 'published', publishedAt: new Date() } });
      return realUpdate(filter, ...rest).lean();
    })();
    return { lean: () => raced };
  };
  try {
    res = await call('PATCH', `/admin/client-reports/${d._id}`, { title: 'typed while it went live', ifStatus: 'draft' });
  } finally {
    ClientReport.findOneAndUpdate = realUpdate;
  }
  assert.strictEqual(res.status, 409, JSON.stringify(res.json));
  assert.strictEqual(res.json.code, 'STATUS_CHANGED');
  assert.strictEqual(res.json.status, 'published');
  assert.strictEqual((await ClientReport.findById(d._id).lean()).title, '', 'the draft-time edit never reached the published report');
});

// Run `between` after the PATCH read the report and just before its write lands (the race window).
const racePatch = async (reportId, between, body) => {
  const realUpdate = ClientReport.findOneAndUpdate.bind(ClientReport);
  let armed = true;
  ClientReport.findOneAndUpdate = (filter, ...rest) => {
    if (!armed || String(filter?._id) !== String(reportId) || filter?.status === undefined || filter?.['build.status'] !== undefined) return realUpdate(filter, ...rest);
    armed = false;
    const raced = (async () => {
      await between();
      return realUpdate(filter, ...rest).lean();
    })();
    return { lean: () => raced };
  };
  try {
    return await call('PATCH', `/admin/client-reports/${reportId}`, body);
  } finally {
    ClientReport.findOneAndUpdate = realUpdate;
  }
};

test('C8: a save is pinned to the version its screen was built on — a stale one is refused with the report as it stands, and nothing is written', { skip }, async () => {
  const d = await draft();
  assert.ok((await runBuild(d._id)).committed);
  const v0 = (await ClientReport.findById(d._id).lean()).editVersion ?? 0;
  let res = await call('PATCH', `/admin/client-reports/${d._id}`, { title: 'First', ifStatus: 'draft', ifEditVersion: v0 });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.report.editVersion, v0 + 1, 'written, one version on');
  // Another editor ticks a voter group; a save still pinned to the version before it is refused.
  res = await call('PATCH', `/admin/client-reports/${d._id}`, { visibility: { visibleTags: ['Supporter'] }, ifStatus: 'draft', ifEditVersion: v0 + 1 });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  res = await call('PATCH', `/admin/client-reports/${d._id}`, { title: 'Stale', observations: [{ heading: 'Mine', body: 'x' }], ifStatus: 'draft', ifEditVersion: v0 + 1 });
  assert.strictEqual(res.status, 409, JSON.stringify(res.json));
  assert.deepStrictEqual(
    { code: res.json.code, error: res.json.error, editVersion: res.json.editVersion },
    { code: 'CHANGED_ELSEWHERE', error: 'This report was changed somewhere else — this page now shows the latest version.', editVersion: v0 + 2 }
  );
  assert.strictEqual(String(res.json.report._id), String(d._id), 'the report as it stands rides along (GET /:id’s shape)');
  assert.deepStrictEqual(res.json.report.visibility.visibleTags, ['Supporter']);
  let doc = await ClientReport.findById(d._id).lean();
  assert.deepStrictEqual([doc.title, (doc.observations || []).length, doc.editVersion], ['First', 0, v0 + 2], 'nothing written');

  // Status is checked first.
  res = await call('PATCH', `/admin/client-reports/${d._id}`, { title: 'x', ifStatus: 'published', ifEditVersion: 0 });
  assert.deepStrictEqual([res.status, res.json.code], [409, 'STATUS_CHANGED']);
  // A report from before the field reads as version 0.
  await ClientReport.updateOne({ _id: d._id }, { $unset: { editVersion: 1 } });
  res = await call('PATCH', `/admin/client-reports/${d._id}`, { title: 'Old doc', ifStatus: 'draft', ifEditVersion: 0 });
  assert.deepStrictEqual([res.status, res.json.report.editVersion], [200, 1]);

  // The race the pin exists for: read at the right version, changed elsewhere before the write lands.
  res = await racePatch(
    d._id,
    () => ClientReport.updateOne({ _id: d._id }, [{ $set: { title: 'Theirs', editVersion: { $add: ['$editVersion', 1] } } }]),
    { title: 'Mine', ifStatus: 'draft', ifEditVersion: 1 }
  );
  assert.deepStrictEqual([res.status, res.json.code, res.json.editVersion, res.json.report.title], [409, 'CHANGED_ELSEWHERE', 2, 'Theirs']);
  doc = await ClientReport.findById(d._id).lean();
  assert.deepStrictEqual([doc.title, doc.editVersion], ['Theirs', 2], 'their write stands; mine was never written');
  // Callers that send no version write as before.
  res = await call('PATCH', `/admin/client-reports/${d._id}`, { title: 'Unpinned' });
  assert.deepStrictEqual([res.status, res.json.report.title, res.json.report.editVersion], [200, 'Unpinned', 3]);
});

test('C8: a stale switch to areas claims nothing that could start, and Apply moves the version', { skip }, async () => {
  const p = await builtAndPublished({ visibility: { mapAnswerKeys: ['plan'] } });
  const v = p.editVersion ?? 0;
  // Read at the right version; changed elsewhere before the write: the remap it claimed is parked.
  const res = await racePatch(
    p._id,
    () => ClientReport.updateOne({ _id: p._id }, [{ $set: { editVersion: { $add: [{ $ifNull: ['$editVersion', 0] }, 1] } } }]),
    { visibility: { mapMode: 'area' }, ifStatus: 'published', ifEditVersion: v }
  );
  assert.deepStrictEqual([res.status, res.json.code], [409, 'CHANGED_ELSEWHERE']);
  let doc = await ClientReport.findById(p._id).lean();
  assert.deepStrictEqual([doc.build.kind, doc.build.status, doc.build.error?.code], ['remap', 'failed', 'ENQUEUE_FAILED'], 'never left queued for a job nobody holds');
  assert.strictEqual(doc.visibility.mapMode, 'pins');

  // Apply swaps in map settings the builder edits: its version moves.
  await ClientReport.updateOne({ _id: p._id }, { $set: { build: { status: 'idle' } } });
  assert.strictEqual((await call('POST', `/admin/client-reports/${p._id}/refresh`, { map: { mapKeys: ['sign'] } })).status, 202);
  assert.ok((await runBuild(p._id)).committed);
  doc = await ClientReport.findById(p._id).lean();
  const before = doc.editVersion ?? 0;
  const applied = await call('POST', `/admin/client-reports/${p._id}/refresh/apply`, { snapshotId: String(doc.build.snapshotId) });
  assert.strictEqual(applied.status, 200, JSON.stringify(applied.json));
  assert.strictEqual(applied.json.report.editVersion, before + 1);
  // An Update pinned to the version before the Apply is refused, and the Apply's map question stays.
  const stale = await call('PATCH', `/admin/client-reports/${p._id}`, { visibility: { mapAnswerKeys: [] }, ifStatus: 'published', ifEditVersion: before });
  assert.deepStrictEqual([stale.status, stale.json.code], [409, 'CHANGED_ELSEWHERE']);
  assert.deepStrictEqual([...(await ClientReport.findById(p._id).lean()).visibility.mapAnswerKeys].sort(), ['plan', 'sign']);
});

test('CONCUR-3: a PATCH writes only the visibility keys it was sent — a write landing meanwhile stays', { skip }, async () => {
  // A map-off published report; an Apply turning the map on lands while a voter-group tick is out.
  const p = await builtAndPublished({ visibility: { showMap: false, mapAnswerKeys: ['plan'] } });
  assert.strictEqual((await call('POST', `/admin/client-reports/${p._id}/refresh`, { map: { showMap: true, mapKeys: ['plan'] } })).status, 202);
  assert.ok((await runBuild(p._id)).committed);
  const sid = String((await ClientReport.findById(p._id).lean()).build.snapshotId);
  let res = await racePatch(
    p._id,
    async () => assert.strictEqual((await call('POST', `/admin/client-reports/${p._id}/refresh/apply`, { snapshotId: sid })).status, 200),
    { visibility: { visibleTags: ['Supporter'] }, ifStatus: 'published' }
  );
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  let doc = await ClientReport.findById(p._id).lean();
  assert.deepStrictEqual(
    { showMap: doc.visibility.showMap, si: doc.snapshotInputs.showMap, keys: doc.visibility.mapAnswerKeys, tags: doc.visibility.visibleTags },
    { showMap: true, si: true, keys: ['plan'], tags: ['Supporter'] },
    'the Apply’s map and the tick both stand'
  );
  assert.deepStrictEqual((await shared(`/reports/${p._id}`)).json.survey.questions.map((q) => q.key), ['plan'], 'the client sees the map');

  // A hidden chart takes its map question off the list as it stands at the write: a question added
  // there meanwhile stays.
  const d = await draft();
  assert.ok((await runBuild(d._id)).committed);
  await call('PATCH', `/admin/client-reports/${d._id}`, { visibility: { visibleQuestionKeys: ['sign', 'plan'], mapAnswerKeys: ['plan'] } });
  res = await racePatch(
    d._id,
    () => ClientReport.updateOne({ _id: d._id }, { $set: { 'visibility.mapAnswerKeys': ['sign', 'plan'] } }),
    { visibility: { visibleQuestionKeys: ['sign'] }, ifStatus: 'draft' }
  );
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  doc = await ClientReport.findById(d._id).lean();
  assert.deepStrictEqual([doc.visibility.visibleQuestionKeys, doc.visibility.mapAnswerKeys], [['sign'], ['sign']]);
});

test('VERIFY-1 / VERIFY-2: a map-off report keeps its map picks; turning the map on maps exactly what the Refresh sends', { skip }, async () => {
  const p = await builtAndPublished({ visibility: { showMap: false } });
  assert.deepStrictEqual(p.visibility.mapAnswerKeys, ['sign', 'plan'], 'the draft’s default picks, kept while the map is off');
  let res = await call('PATCH', `/admin/client-reports/${p._id}`, { visibility: { visibleTags: ['Supporter'] }, ifStatus: 'published' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.deepStrictEqual(res.json.report.visibility.mapAnswerKeys, ['sign', 'plan'], 'an unrelated edit keeps them (VERIFY-1)');
  // Echoing them back is no addition either.
  res = await call('PATCH', `/admin/client-reports/${p._id}`, { visibility: { mapAnswerKeys: ['sign', 'plan'], visibleTags: [] }, ifStatus: 'published' });
  assert.deepStrictEqual([res.status, res.json.report.visibility.mapAnswerKeys], [200, ['sign', 'plan']]);
  // A numbers-only Refresh leaves the map off and the picks as they are.
  assert.strictEqual((await call('POST', `/admin/client-reports/${p._id}/refresh`, {})).status, 202);
  assert.ok((await runBuild(p._id)).committed);
  let doc = await ClientReport.findById(p._id).lean();
  res = await call('POST', `/admin/client-reports/${p._id}/refresh/apply`, { snapshotId: String(doc.build.snapshotId) });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.deepStrictEqual([res.json.report.visibility.showMap, res.json.report.visibility.mapAnswerKeys], [false, ['sign', 'plan']]);
  // Turning the map on: exactly the questions the Refresh sends — never every stored pick (VERIFY-2).
  assert.strictEqual((await call('POST', `/admin/client-reports/${p._id}/refresh`, { map: { showMap: true, mapKeys: ['plan'], mapMode: 'pins' } })).status, 202);
  assert.ok((await runBuild(p._id)).committed);
  doc = await ClientReport.findById(p._id).lean();
  assert.deepStrictEqual(doc.build.inputs.mapKeys, ['plan']);
  const view = await call('GET', `/admin/client-reports/${p._id}/build`);
  assert.deepStrictEqual([view.json.build.result.mapShown, view.json.build.result.mapKeys], [true, ['plan']], 'the review can name the map questions');
  res = await call('POST', `/admin/client-reports/${p._id}/refresh/apply`, { snapshotId: String(doc.build.snapshotId) });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.deepStrictEqual((await shared(`/reports/${p._id}`)).json.survey.questions.map((q) => q.key), ['plan']);
});

test('C6 / NUM-5: the goal refusal says what is true', { skip }, async () => {
  // Built while the campaign had no goal; then it gets one.
  const d = await draft();
  assert.ok((await runBuild(d._id)).committed);
  let res = await call('PATCH', `/admin/client-reports/${d._id}`, { visibility: { showGoal: true } });
  assert.deepStrictEqual([res.status, res.json.code, res.json.error], [400, 'NO_GOAL_SNAPSHOT', 'This campaign has no door goal set.']);
  await Campaign.updateOne({ _id: ctx.camp._id }, { $set: { doorGoal: 500 } });
  try {
    res = await call('PATCH', `/admin/client-reports/${d._id}`, { visibility: { showGoal: true } });
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.json, {
      error: 'Your door goal was set after these numbers were built. Recompute them — or Refresh numbers, on a published report — to show it.',
      code: 'GOAL_AFTER_BUILD',
    });
    // Before its first build a draft may tick it: the build freezes the goal.
    const fresh = await draft({ weekStart: '2026-07-13', weekEnd: '2026-07-19' });
    assert.strictEqual((await call('PATCH', `/admin/client-reports/${fresh._id}`, { visibility: { showGoal: true } })).status, 200);
    // A walk-list report never has one, goal or not.
    const walk = await draft({ effortId: String(ctx.north._id) });
    res = await call('PATCH', `/admin/client-reports/${walk._id}`, { visibility: { showGoal: true } });
    assert.deepStrictEqual([res.status, res.json.code], [400, 'NO_GOAL_SNAPSHOT']);
    assert.match(res.json.error, /walk-list/);
  } finally {
    await Campaign.updateOne({ _id: ctx.camp._id }, { $set: { doorGoal: 0 } });
  }
});

test('STATE-2: a pending Refresh’s map additions survive unrelated edits; hiding their chart removes them', { skip }, async () => {
  // Published with only Voting plan? on the map; a Refresh adds Yard sign?.
  const p = await builtAndPublished({ visibility: { mapAnswerKeys: ['plan'] } });
  const claim = await call('POST', `/admin/client-reports/${p._id}/refresh`, { map: { mapKeys: ['sign'] } });
  assert.strictEqual(claim.status, 202, JSON.stringify(claim.json));
  assert.ok((await runBuild(p._id)).committed);
  let doc = await ClientReport.findById(p._id).lean();
  assert.strictEqual(doc.build.status, 'ready');
  const sid = doc.build.snapshotId;
  assert.deepStrictEqual(await answerKeysIn(p._id, sid), ['plan', 'sign']);

  // A tag tick — nothing to do with the map.
  let res = await call('PATCH', `/admin/client-reports/${p._id}`, { visibility: { visibleTags: ['Supporter'] } });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  doc = await ClientReport.findById(p._id).lean();
  assert.deepStrictEqual(doc.build.inputs.mapKeys, ['plan', 'sign'], 'the addition stays on the Refresh');
  assert.deepStrictEqual(await answerKeysIn(p._id, sid), ['plan', 'sign'], 'and in its rows');
  assert.deepStrictEqual(await answerKeysIn(p._id, doc.snapshotId), ['plan'], 'the live map is untouched');

  // Hiding Yard sign?'s chart takes it off the Refresh too.
  res = await call('PATCH', `/admin/client-reports/${p._id}`, { visibility: { visibleQuestionKeys: doc.visibility.visibleQuestionKeys.filter((k) => k !== 'sign') } });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  doc = await ClientReport.findById(p._id).lean();
  assert.deepStrictEqual(doc.build.inputs.mapKeys, ['plan']);
  assert.deepStrictEqual(await answerKeysIn(p._id, sid), ['plan']);
  assert.strictEqual((await call('POST', `/admin/client-reports/${p._id}/refresh/discard`, { snapshotId: String(sid) })).status, 200);

  // A "turn the map on" Refresh keeps its map through an unrelated edit; Apply shows it.
  const off = await builtAndPublished({ visibility: { showMap: false, mapAnswerKeys: ['plan'] } });
  assert.strictEqual((await call('POST', `/admin/client-reports/${off._id}/refresh`, { map: { showMap: true, mapKeys: ['plan'] } })).status, 202);
  assert.ok((await runBuild(off._id)).committed);
  assert.strictEqual((await call('PATCH', `/admin/client-reports/${off._id}`, { visibility: { visibleTags: ['Supporter'] } })).status, 200);
  doc = await ClientReport.findById(off._id).lean();
  assert.strictEqual(doc.build.inputs.showMap, true, 'not a map-off: the Refresh keeps its map');
  assert.deepStrictEqual(doc.build.inputs.mapKeys, ['plan']);
  res = await call('POST', `/admin/client-reports/${off._id}/refresh/apply`, { snapshotId: String(doc.build.snapshotId) });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.report.visibility.showMap, true);
  assert.deepStrictEqual(res.json.report.snapshotInputs.mapKeys, ['plan']);
});

test('depsEverFromVersion: create, the first questions PATCH of an old survey, duplicate (LEGACY-1)', { skip }, async () => {
  const q = [{ key: 'a', label: 'A?', type: 'single_choice', options: [{ text: 'Yes' }, { text: 'No' }] }];
  const made = await call('POST', '/admin/surveys', { name: 'Fresh', questions: q });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  assert.strictEqual((await SurveyTemplate.findById(made.json.survey._id).lean()).depsEverFromVersion, 1);
  // A survey from before the record, at version 3.
  const old = new ObjectId();
  await SurveyTemplate.collection.insertOne({ _id: old, organizationId: ctx.org._id, name: 'Old', isActive: false, version: 3, tags: [], flow: 'list', questions: [{ key: 'a', label: 'A?', type: 'single_choice', order: 0, options: [{ id: 'y', text: 'Yes' }] }] });
  const body = (label) => ({ questions: [{ key: 'a', label, type: 'single_choice', options: [{ id: 'y', text: 'Yes' }] }] });
  assert.strictEqual((await call('PATCH', `/admin/surveys/${old}`, body('A, edited?'))).status, 200);
  let doc = await SurveyTemplate.findById(old).lean();
  assert.deepStrictEqual([doc.version, doc.depsEverFromVersion], [4, 3], 'complete from the version that PATCH replaced');
  assert.strictEqual((await call('PATCH', `/admin/surveys/${old}`, body('A, again?'))).status, 200);
  doc = await SurveyTemplate.findById(old).lean();
  assert.deepStrictEqual([doc.version, doc.depsEverFromVersion], [5, 3], 'set once');
  const copy = await call('POST', `/admin/surveys/${old}/duplicate`);
  assert.strictEqual(copy.status, 201, JSON.stringify(copy.json));
  assert.strictEqual((await SurveyTemplate.findById(copy.json.survey._id).lean()).depsEverFromVersion, 1);
});

test('the migration: every survey answered gives an old report its dependencies; older versions listed; --keep-legacy-all late says “charts only” (LEGACY-1, LEGACY-3)', { skip }, async () => {
  // Round 1 was edited before the deploy (now version 2); its answers are version 1.
  await SurveyTemplate.collection.updateOne({ _id: ctx.r1 }, { $set: { version: 2 } });
  const dry = await runClientReportVisibility({ apply: false, log: () => {} });
  assert.deepStrictEqual(dry.olderVersionTemplates, [{ templateId: String(ctx.r1), from: 2, versions: [1] }]);
  await runClientReportVisibility({ apply: true, log: () => {} });
  const r1 = await SurveyTemplate.findById(ctx.r1).lean();
  assert.deepStrictEqual([r1.depsEverFromVersion, r1.depsEver], [2, [{ q: 'sign', on: 'support' }]]);
  assert.strictEqual((await SurveyTemplate.findById(ctx.r2).lean()).depsEverFromVersion, 1);
  // H froze Round 1's dependency though the campaign is on Round 2 — so it survives a swap back.
  const H = await ClientReport.findById(ctx.H._id).lean();
  assert.deepStrictEqual(H.snapshotInputs.mapKeys, ['plan']);
  assert.ok(H.snapshotInputs.questionDeps.some(([k, deps]) => k === 'sign' && deps.includes('support')));
  await Campaign.updateOne({ _id: ctx.camp._id }, { $set: { surveyTemplateId: ctx.r1 } });
  try {
    const view = await legacyView();
    assert.deepStrictEqual([view.filters, view.answers], [['plan'], ['plan']]);
  } finally {
    await Campaign.updateOne({ _id: ctx.camp._id }, { $set: { surveyTemplateId: ctx.r2 } });
  }
  // U went through a plain --apply: --keep-legacy-all now brings back its charts only.
  const lines = [];
  await runClientReportVisibility({ apply: true, keepLegacyAll: true, log: (l) => lines.push(l) });
  const line = lines.find((l) => l.includes(String(ctx.U._id)));
  assert.match(line, /charts only: its map answers were already discarded/);
  assert.doesNotMatch(line, /KEPT/);
  const U = await ClientReport.findById(ctx.U._id).lean();
  assert.deepStrictEqual(U.visibility.visibleQuestionKeys, ['support', 'sign', 'plan', 'ghost']);
  assert.deepStrictEqual(U.visibility.mapAnswerKeys, []);
});
