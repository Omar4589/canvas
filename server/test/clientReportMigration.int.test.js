import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import mongoose from 'mongoose';

// migrate:client-report-visibility — docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F1 "Migration" as
// amended by §O3, against the real app and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/crmig node --test test/clientReportMigration.int.test.js
//
// The deploy comes BEFORE the migration, so the reports here are RAW legacy documents — inserted
// straight into the collection with none of the new fields — and every route must work on them
// before anyone runs it. Then the dry run writes nothing, --apply does each step, and --apply again
// changes nothing, post-deploy documents included.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-client-report-migration';
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
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ClientReportMapPoint } = await import('../src/models/ClientReportMapPoint.js');
const { ClientReportSeries } = await import('../src/models/ClientReportSeries.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { runClientReportVisibility } = await import('../src/migrations/clientReportVisibility.js');
const { processClientReportJob } = await import('../src/services/reports/clientReportBuilds.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;

let server;
let base;
const ctx = {};
const quiet = () => {};

const call = async (method, p, { body, headers = {}, admin = true } = {}) => {
  const res = await fetch(`${base}/api${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(admin ? { Authorization: `Bearer ${ctx.token}`, 'X-Org-Id': String(ctx.org._id) } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};
const shared = (p) => call('GET', `/share/mig-token${p}`, { admin: false });

const RANGE_START = new Date('2026-07-06T05:00:00Z');
const RANGE_END = new Date('2026-07-13T05:00:00Z');

// A report exactly as today's code froze it: none of the new fields.
const legacyReport = (extra = {}) => ({
  _id: new ObjectId(),
  organizationId: ctx.org._id,
  campaignId: ctx.camp._id,
  title: 'Legacy',
  campaignType: 'survey',
  effortId: null,
  effortName: null,
  weekStart: '2026-07-06',
  weekEnd: '2026-07-12',
  timeZone: 'America/Chicago',
  rangeStartUtc: RANGE_START,
  rangeEndUtc: RANGE_END,
  status: 'published',
  observations: [],
  stats: {
    cumulative: {
      totals: { doorsKnocked: 3, surveysTaken: 2, surveyedVoters: 2, homesKnocked: 3 },
      contactBreakdown: { surveyed: 2, not_home: 1 },
      coverage: { surveyed: 2 },
      surveyBreakdowns: [
        { questionKey: 'support', questionLabel: 'Support?', type: 'single_choice', options: [{ option: 'Yes', count: 2, percent: 100 }] },
        { questionKey: 'sign', questionLabel: 'Yard sign?', type: 'single_choice', options: [{ option: 'Yes', count: 1, percent: 100 }] },
        { questionKey: 'bond', questionLabel: 'Bond?', type: 'single_choice', options: [{ option: 'For', count: 2, percent: 100 }] },
      ],
      tagBreakdowns: [],
    },
    period: { totals: { doorsKnocked: 1 }, contactBreakdown: { not_home: 1 }, surveyBreakdowns: [], tagBreakdowns: [] },
  },
  supportQuestionKey: null,
  visibility: { visibleQuestionKeys: ['support', 'sign'], mapAnswerKeys: ['support', 'sign', 'bond'], showMap: true, visibleTags: [], showGoal: false },
  mapPointCount: 3,
  viewCount: 4,
  publishedAt: new Date('2026-07-14T12:00:00Z'),
  createdAt: new Date('2026-07-13T12:00:00Z'),
  updatedAt: new Date('2026-07-14T12:00:00Z'),
  ...extra,
});
const legacyPoint = (reportId, i, answers) => ({
  _id: new ObjectId(),
  clientReportId: reportId,
  organizationId: ctx.org._id,
  campaignId: ctx.camp._id,
  householdId: new ObjectId(),
  lng: -82.4 + i / 1e3,
  lat: 27.9 + i / 1e3,
  addressLine1: `${i} Legacy Ln`,
  city: 'Tampa',
  state: 'FL',
  status: 'surveyed',
  answers,
});

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await ClientReportSeries.syncIndexes();
  const org = await Organization.create({ name: 'Mig', slug: 'mig', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ada@mig.co', passwordHash: await User.hashPassword('Str0ng!Passw0rd'), isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  // A survey from before depsEver existed (raw: no depsEver field).
  const tplId = new ObjectId();
  await SurveyTemplate.collection.insertOne({
    _id: tplId, organizationId: org._id, name: 'Old survey', isActive: true, version: 1, tags: [], flow: 'list',
    questions: [
      { key: 'support', label: 'Support?', type: 'single_choice', options: [{ id: 'y', text: 'Yes' }, { id: 'n', text: 'No' }], order: 0, retired: false },
      { key: 'sign', label: 'Yard sign?', type: 'single_choice', options: [{ id: 's', text: 'Yes' }], order: 1, retired: false, visibleIf: { logic: 'all', rules: [{ questionKey: 'support', op: 'is', optionIds: ['y'] }] } },
      { key: 'bond', label: 'Bond?', type: 'single_choice', options: [{ id: 'f', text: 'For' }], order: 2, retired: false },
    ],
  });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Mig', type: 'survey', state: 'FL', isActive: true, surveyTemplateId: tplId, timeZone: 'America/Chicago' });
  const north1 = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'Downtown' });
  const north2 = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'Downtown' });
  Object.assign(ctx, { org, camp, tplId, north1, north2, admin, token: signUserToken(admin) });

  const hh = await Household.create({ organizationId: org._id, campaignId: camp._id, isActive: true, addressLine1: '1 Real St', city: 'Tampa', state: 'FL', zipCode: '33601', normalizedAddress: 'MIG1', location: { type: 'Point', coordinates: [-82.4, 27.9] } });
  await CanvassActivity.create({ organizationId: org._id, campaignId: camp._id, householdId: hh._id, userId: admin._id, actionType: 'not_home', timestamp: new Date('2026-07-08T15:00:00Z'), location: { lat: 27.9, lng: -82.4 } });

  // L1: published, map on, a hidden question (bond) on the map list, points carrying its answers.
  const L1 = legacyReport();
  // L2: published, map OFF, points still stored (B1).
  const L2 = legacyReport({ visibility: { visibleQuestionKeys: ['support'], mapAnswerKeys: ['support'], showMap: false } });
  // L3: a draft whose operator unticked every question (empty used to mean all).
  const L3 = legacyReport({ status: 'draft', publishedAt: null, visibility: { visibleQuestionKeys: [], mapAnswerKeys: ['support'], showMap: true } });
  // L4, L5: two walk lists that share a name.
  const L4 = legacyReport({ effortId: north1._id, effortName: 'Downtown' });
  const L5 = legacyReport({ effortId: north2._id, effortName: 'Downtown' });
  await ClientReport.collection.insertMany([L1, L2, L3, L4, L5]);
  const answers = [{ questionKey: 'support', answer: 'Yes' }, { questionKey: 'sign', answer: 'Yes' }, { questionKey: 'bond', answer: 'For' }];
  // Inserted out of _id order on purpose: positions are the rank by _id, whatever the insert order.
  const p1 = [legacyPoint(L1._id, 1, answers), legacyPoint(L1._id, 2, answers), legacyPoint(L1._id, 3, [{ questionKey: 'support', answer: 'No' }])];
  await ClientReportMapPoint.collection.insertMany([p1[2], p1[0], p1[1]]);
  await ClientReportMapPoint.collection.insertMany([legacyPoint(L2._id, 1, answers)]);
  const bcrypt = (await import('bcryptjs')).default;
  await ReportShareLink.create({ organizationId: org._id, campaignId: camp._id, token: 'mig-token', passwordHash: null, expiresAt: null, isActive: true });
  void bcrypt;
  Object.assign(ctx, { L1, L2, L3, L4, L5, p1 });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('BEFORE the migration: every route works on raw legacy documents', { skip }, async () => {
  const hub = await shared('/reports');
  assert.strictEqual(hub.status, 200, JSON.stringify(hub.json));
  assert.ok(hub.json.reports.some((r) => r.id === String(ctx.L1._id)));
  assert.ok(!hub.json.reports.some((r) => r.id === String(ctx.L3._id)), 'never a draft');

  const one = await shared(`/reports/${ctx.L1._id}`);
  assert.strictEqual(one.status, 200);
  assert.deepStrictEqual(one.json.report.stats.cumulative.surveyBreakdowns.map((b) => b.questionKey), ['support', 'sign'], 'the hidden question is gone');
  assert.deepStrictEqual(one.json.survey.questions.map((q) => q.key), ['support', 'sign'], 'the follow-up rides with its parent; the hidden one never');

  // The map: positions are given lazily, by _id — and the hidden question's answers never ride.
  const map = await shared(`/reports/${ctx.L1._id}/map`);
  assert.strictEqual(map.status, 200, JSON.stringify(map.json));
  assert.strictEqual(map.json.snapshotKey, 'legacy');
  assert.strictEqual(map.json.count, 3);
  assert.ok(!('bond' in map.json.answers));
  const byId = [...ctx.p1].sort((a, b) => String(a._id).localeCompare(String(b._id)));
  ctx.positions = byId.map((p) => p.addressLine1);
  const doors = await shared(`/reports/${ctx.L1._id}/map/doors?snapshotKey=legacy&rows=0,1,2`);
  assert.deepStrictEqual(doors.json.doors.map((d) => d.addressLine1), ctx.positions, 'position = rank by _id');
  assert.ok(!JSON.stringify(doors.json).includes('For'), 'no bond answer on a door');
  assert.ok((await ClientReport.findById(ctx.L1._id).lean()).extent, 'the extent was backfilled with them');

  // B1 on an old report: map off → no map, before any migration.
  assert.strictEqual((await shared(`/reports/${ctx.L2._id}/map`)).json.code, 'MAP_NOT_SHARED');

  // A removal PATCH, Put back up and Next, on legacy documents.
  let res = await call('PATCH', `/admin/client-reports/${ctx.L4._id}`, { body: { visibility: { mapAnswerKeys: ['support'] } } });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  res = await call('POST', `/admin/client-reports/${ctx.L4._id}/take-down`);
  assert.strictEqual(res.status, 200);
  res = await call('POST', `/admin/client-reports/${ctx.L4._id}/put-back-up`);
  assert.strictEqual(res.status, 200);
  res = await call('POST', `/admin/client-reports/${ctx.L5._id}/next`);
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  ctx.postDeployNext = res.json.report;
  // The draft can't publish until it has a snapshot of its own.
  res = await call('POST', `/admin/client-reports/${ctx.L3._id}/publish`);
  assert.strictEqual(res.json.code, 'RECOMPUTE_NEEDED');
});

const snapshotState = async () => ({
  reports: await ClientReport.find({}).sort({ _id: 1 }).lean(),
  points: await ClientReportMapPoint.find({}).sort({ _id: 1 }).lean(),
  series: await ClientReportSeries.find({}).sort({ _id: 1 }).lean(),
  templates: await SurveyTemplate.find({}).sort({ _id: 1 }).lean(),
});
const strip = (state) => JSON.parse(JSON.stringify(state, (k, v) => (k === 'updatedAt' ? undefined : v)));

test('a post-deploy report, built by the new code, before the migration runs', { skip }, async () => {
  // allowDuplicate: the fixtures already hold reports for this week (the duplicate guard has its own suite).
  const created = await call('POST', '/admin/client-reports', { body: { campaignId: String(ctx.camp._id), weekStart: '2026-07-06', weekEnd: '2026-07-12', allowDuplicate: true } });
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  const jobId = new ObjectId().toHexString();
  await ClientReport.updateOne({ _id: created.json.report._id }, { $set: { 'build.status': 'queued', 'build.jobId': jobId, 'build.startedAt': new Date() } });
  assert.ok((await processClientReportJob({ id: jobId, data: { reportId: created.json.report._id } }, 't')).committed);
  ctx.postDeploy = created.json.report._id;
});

test('the dry run writes nothing', { skip }, async () => {
  const before = strip(await snapshotState());
  const out = await runClientReportVisibility({ apply: false, log: quiet });
  assert.ok(out.untickedAll.some((r) => r.id === String(ctx.L3._id)), 'lists the report whose operator unticked every question');
  assert.ok(out.openDrafts.some((d) => d.id === String(ctx.L3._id)), 'lists open drafts');
  assert.ok(out.templatesSeeded >= 1);
  assert.deepStrictEqual(strip(await snapshotState()), before);
});

test('--apply: every step, legacy documents only', { skip }, async () => {
  const postBefore = await ClientReport.findById(ctx.postDeploy).lean();
  await runClientReportVisibility({ apply: true, log: quiet });
  // 0. depsEver seeded from today's conditions.
  const tpl = await SurveyTemplate.findById(ctx.tplId).lean();
  assert.deepStrictEqual(tpl.depsEver, [{ q: 'sign', on: 'support' }]);
  // 1. Unticked-everything keeps NONE by default.
  const L3 = await ClientReport.findById(ctx.L3._id).lean();
  assert.deepStrictEqual(L3.visibility.visibleQuestionKeys, []);
  // 2. Series: one whole-campaign series, one per walk list, " (2)" for the shared name.
  const L1 = await ClientReport.findById(ctx.L1._id).lean();
  assert.ok(L1.seriesId);
  assert.deepStrictEqual(L1.scope, { kind: 'campaign', label: 'Whole campaign' });
  const walk = await ClientReportSeries.find({ campaignId: ctx.camp._id, kind: 'walk_list' }).lean();
  assert.deepStrictEqual(walk.map((s) => s.label).sort(), ['Downtown', 'Downtown (2)']);
  const L4 = await ClientReport.findById(ctx.L4._id).lean();
  assert.strictEqual(L4.scope.label, 'Downtown', "each keeps its own frozen walk-list name");
  assert.strictEqual(await ClientReportSeries.countDocuments({ campaignId: ctx.camp._id, kind: 'campaign' }), 1, 'the migration reused the series the route made');
  // 3. Backfill.
  assert.strictEqual(L1.editVersion, 0);
  assert.strictEqual(String(L1.statsComputedAt), String(L1.publishedAt));
  assert.deepStrictEqual(L1.snapshotInputs.mapKeys, ['support', 'sign']);
  assert.deepStrictEqual(L1.snapshotInputs.questionDeps, [['sign', ['support']]]);
  // 4. mapAnswerKeys narrowed (bond is hidden).
  assert.deepStrictEqual(L1.visibility.mapAnswerKeys, ['support', 'sign']);
  // 5. Map-off rows deleted; hidden answers pulled.
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: ctx.L2._id }), 0);
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: ctx.L1._id, 'answers.questionKey': 'bond' }), 0);
  // Positions identical before and after.
  const doors = await shared(`/reports/${ctx.L1._id}/map/doors?snapshotKey=legacy&rows=0,1,2`);
  assert.deepStrictEqual(doors.json.doors.map((d) => d.addressLine1), ctx.positions);
  // Post-deploy documents: untouched.
  const postAfter = await ClientReport.findById(ctx.postDeploy).lean();
  assert.deepStrictEqual(strip(postAfter), strip(postBefore));
});

test('--apply again changes nothing, post-deploy documents included', { skip }, async () => {
  const before = strip(await snapshotState());
  await runClientReportVisibility({ apply: true, log: quiet });
  assert.deepStrictEqual(strip(await snapshotState()), before);
  // And through the real script entry, as the Heroku console runs it.
  const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const out = execFileSync(process.execPath, ['src/migrations/clientReportVisibility.js', '--apply'], {
    cwd: serverRoot, env: { ...process.env, MONGODB_URI: URI }, encoding: 'utf8',
  });
  assert.match(out, /APPLY/);
  assert.deepStrictEqual(strip(await snapshotState()), before, 'the script, too, changes nothing the second time');
});

test('--keep-legacy-all writes the charts of a legacy report whose operator unticked every question', { skip }, async () => {
  await runClientReportVisibility({ apply: true, keepLegacyAll: true, log: quiet });
  const L3 = await ClientReport.findById(ctx.L3._id).lean();
  assert.deepStrictEqual(L3.visibility.visibleQuestionKeys, ['support', 'sign', 'bond']);
  // A report the operator has edited since the deploy is never second-guessed.
  const touched = legacyReport({ status: 'draft', publishedAt: null, editVersion: 3, visibility: { visibleQuestionKeys: [], mapAnswerKeys: [], showMap: true } });
  await ClientReport.collection.insertOne(touched);
  await runClientReportVisibility({ apply: true, keepLegacyAll: true, log: quiet });
  assert.deepStrictEqual((await ClientReport.findById(touched._id).lean()).visibility.visibleQuestionKeys, []);
});
