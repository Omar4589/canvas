import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Links to one report — docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D, contracts K6–K8 — against the real
// app and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/singlelinks node --test test/clientReportSingleLinks.int.test.js
//
//   · a link to one report is made only for a report the client sees now (published, not taken down);
//     every link row says what it opens (reportId, report);
//   · with a one-report link, every public route given ANOTHER report's id answers 404 — the report,
//     its map, doors, areas and opens — checked before the query, never by an _id in reportScope;
//   · its hub lists that report alone (single, reportId), and says gone when it's taken down, unpublished
//     or deleted; put back up, it is there again;
//   · its report names no other report: nav null, and the earlier-totals line with `before` instead of
//     `since` — the same counts as on a link to all the reports;
//   · deleting a report deletes its one-report links, a History row each ("deleted with its report");
//   · a link to all the reports, a link from before the field included, is unchanged: single false.
//
// Since one link per report (docs/PROPOSAL_CLIENT_REPORT_LINKS.md): no route makes a link to all the
// reports any more (REPORT_REQUIRED) — the one here is inserted as one from before looks; a report gets
// one link (a second Share answers with it), so a report's second and third links are inserted as ones
// from before; and the publish-time link check (checks.links) is gone — a draft never has a link.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-single-links';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.CLIENT_REPORT_QUEUE_TIMEOUT_MS = '300';
delete process.env.RETIRE_ALL_REPORTS_LINKS;

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ClientReportSeries } = await import('../src/models/ClientReportSeries.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { processClientReportJob } = await import('../src/services/reports/clientReportBuilds.js');
const { getQueue, QUEUE_NAMES } = await import('../src/queues/index.js');
const bcrypt = (await import('bcryptjs')).default;

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;
const PASSWORD = 'single-link-password';

let server;
let base;
const ctx = {};

const call = async (method, path, { body, as = ctx.admin, headers = {} } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(as ? { Authorization: `Bearer ${as.token}`, 'X-Org-Id': String(as.orgId) } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, json, text };
};
const at = (day, h = 12) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00-05:00`);

let n = 0;
const surveyedDoor = async (camp, when, support, { effortId = null } = {}) => {
  n += 1;
  const hh = await Household.create({
    organizationId: ctx.org._id, campaignId: camp._id, isActive: true, effortId,
    addressLine1: `${n} Single St`, city: 'Tampa', state: 'FL', zipCode: '33601', normalizedAddress: `SINGLE${n}`,
    location: { type: 'Point', coordinates: [-82.46 + n / 1e4, 27.95] },
  });
  await CanvassActivity.create({ organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, effortId, userId: ctx.adminUser._id, actionType: 'survey_submitted', timestamp: when, passId: ctx.pass, location: { lat: 27.95, lng: -82.46 } });
  const v = await Voter.create({ organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, stateVoterId: `SL${n}`, firstName: 'S', lastName: `L${n}`, fullName: `S L${n}` });
  await SurveyResponse.create({
    organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, effortId, voterId: v._id, userId: ctx.adminUser._id,
    surveyTemplateId: ctx.template._id, surveyTemplateVersion: 1, passId: ctx.pass, location: { lat: 27.95, lng: -82.46 }, submittedAt: when,
    answers: [{ questionKey: 'support', questionLabel: 'Support?', optionIds: [support === 'Yes' ? 'y' : 'n'], answer: support }],
  });
};

const runBuild = async (reportId) => {
  const jobId = new ObjectId().toHexString();
  await ClientReport.updateOne({ _id: reportId }, { $set: { 'build.status': 'queued', 'build.jobId': jobId, 'build.startedAt': new Date() } });
  const out = await processClientReportJob({ id: jobId, data: { reportId: String(reportId) }, moveToDelayed: async () => {}, updateProgress: async () => {} }, 'token');
  assert.ok(out?.committed, `the build committed: ${JSON.stringify(out)}`);
  return ClientReport.findById(reportId).lean();
};
const create = async (camp, body) => {
  const res = await call('POST', '/admin/client-reports', { body: { campaignId: String(camp._id), ...body } });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  return res.json.report;
};
const publish = async (r) => {
  const res = await call('POST', `/admin/client-reports/${r._id}/publish`, { body: { snapshotId: String(r.snapshotId), editVersion: r.editVersion ?? 0 } });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  return ClientReport.findById(r._id).lean();
};
const made = async (camp, body) => publish(await runBuild((await create(camp, body))._id));

// A link through the real route, and a share token for it.
const makeLink = async (camp, { label, reportId, as } = {}) => {
  const res = await call('POST', '/admin/client-reports/shares', {
    as,
    body: { campaignId: String(camp._id), label, password: PASSWORD, ...(reportId !== undefined ? { reportId: reportId && String(reportId) } : {}) },
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  return res.json.share;
};
let ipN = 0;
const accessFor = async (token) => {
  ipN += 1;
  const res = await call('POST', `/share/${token}/unlock`, { as: null, body: { password: PASSWORD }, headers: { 'X-Forwarded-For': `10.7.${ipN >> 8}.${ipN & 255}` } });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  return res.json.accessToken;
};
const pub = (link, path, { method = 'GET' } = {}) => call(method, `/share/${link.token}${path}`, { as: null, headers: { 'X-Share-Token': link.access } });
const linkFor = async (camp, opts) => {
  const share = await makeLink(camp, opts);
  return { ...share, access: await accessFor(share.token) };
};
// A link as one made before one link per report looks — to all the reports (no reportId), or a report's
// second link — inserted directly, since no route makes either any more.
const oldLink = async (camp, { label, reportId, token = `old-${new ObjectId()}` } = {}) => {
  const doc = await ReportShareLink.create({
    organizationId: ctx.org._id, campaignId: camp._id, token, label, passwordHash: await bcrypt.hash(PASSWORD, 4),
    expiresAt: new Date(Date.now() + 30 * 86400e3), isActive: true, ...(reportId ? { reportId } : {}),
  });
  return { id: String(doc._id), token, label, reportId: reportId ? String(reportId) : null, access: await accessFor(token) };
};

before(async () => {
  if (!URI) return;
  mongoose.set('strictQuery', true); // as production's connectDb: an undeclared filter key is stripped
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await ClientReportSeries.syncIndexes();
  // Builds are driven by hand (runBuild): the queue answers at once instead of timing out on Redis.
  getQueue(QUEUE_NAMES.CLIENT_REPORT).add = async (name, data, opts) => ({ id: opts?.jobId });

  const org = await Organization.create({ name: 'Single Org', slug: 'single-org', isActive: true });
  const elsewhere = await Organization.create({ name: 'Elsewhere', slug: 'single-elsewhere', isActive: true });
  for (const o of [org, elsewhere]) await Subscription.create({ organizationId: o._id, status: 'active' });
  const mk = async (first, o, role) => {
    const u = await User.create({ firstName: first, lastName: 'Single', email: `${first.toLowerCase()}@single.t.co`, passwordHash: 'x', isActive: true });
    await Membership.create({ userId: u._id, organizationId: o._id, role, isActive: true });
    return u;
  };
  const adminUser = await mk('Ada', org, 'admin');
  const leadUser = await mk('Lea', org, 'lead');
  const otherAdmin = await mk('Oz', elsewhere, 'admin');
  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Single', isActive: true,
    questions: [{ key: 'support', label: 'Support?', type: 'single_choice', options: [{ id: 'y', text: 'Yes' }, { id: 'n', text: 'No' }] }],
  });
  const otherTemplate = await SurveyTemplate.create({
    organizationId: elsewhere._id, name: 'Elsewhere', isActive: true,
    questions: [{ key: 'support', label: 'Support?', type: 'single_choice', options: [{ id: 'y', text: 'Yes' }, { id: 'n', text: 'No' }] }],
  });
  Object.assign(ctx, {
    org, elsewhere, adminUser, template, pass: new ObjectId(),
    admin: { token: signUserToken(adminUser), orgId: org._id },
    lead: { token: signUserToken(leadUser), orgId: org._id },
    otherAdmin: { token: signUserToken(otherAdmin), orgId: elsewhere._id },
  });
  const campaign = (name, o = org, t = template) =>
    Campaign.create({ organizationId: o._id, name, type: 'survey', state: 'FL', isActive: true, surveyTemplateId: t._id, timeZone: 'America/Chicago' });
  ctx.camp = await campaign('Fall');
  ctx.other = await campaign('Not this one');
  ctx.checks = await campaign('Checks');
  ctx.foreign = await campaign('Foreign', elsewhere, otherTemplate);
  await CampaignManager.create({ campaignId: ctx.camp._id, userId: leadUser._id, organizationId: org._id, grantedBy: adminUser._id });
  ctx.north = await Effort.create({ organizationId: org._id, campaignId: ctx.camp._id, name: 'North' });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // The campaign: week 1 published; a door that arrives late in week 1; week 2 published — its build
  // recounts week 1, so its earlier-totals line has something to say — a walk-list report, and a draft.
  await surveyedDoor(ctx.camp, at('2026-07-01'), 'Yes');
  await surveyedDoor(ctx.camp, at('2026-07-08'), 'No');
  await surveyedDoor(ctx.camp, at('2026-07-09'), 'Yes', { effortId: ctx.north._id });
  ctx.r1 = await made(ctx.camp, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
  await surveyedDoor(ctx.camp, at('2026-07-10'), 'Yes');
  await surveyedDoor(ctx.camp, at('2026-07-15'), 'No');
  ctx.r2 = await made(ctx.camp, { weekStart: '2026-07-13', weekEnd: '2026-07-19' });
  ctx.walk = await made(ctx.camp, { weekStart: '2026-07-06', weekEnd: '2026-07-12', effortId: String(ctx.north._id) });
  ctx.draft = await runBuild((await create(ctx.camp, { weekStart: '2026-07-20', weekEnd: '2026-07-26' }))._id);
  // Another campaign's report, and another organization's.
  for (const camp of [ctx.other, ctx.checks]) {
    await surveyedDoor(camp, at('2026-07-08'), 'Yes');
  }
  ctx.otherReport = await made(ctx.other, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
  ctx.foreignReport = await ClientReport.create({
    organizationId: elsewhere._id, campaignId: ctx.foreign._id, status: 'published', publishedAt: new Date(),
    weekStart: '2026-07-06', weekEnd: '2026-07-12', timeZone: 'America/Chicago',
    rangeStartUtc: new Date('2026-07-06T05:00:00Z'), rangeEndUtc: new Date('2026-07-13T05:00:00Z'),
  });

  ctx.all = await oldLink(ctx.camp, { label: 'Candidate' });
  ctx.one = await linkFor(ctx.camp, { label: 'Board', reportId: ctx.r2._id });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('a link to one report is made only for a report the client sees now; every row says what it opens', { skip }, async () => {
  const post = (body, as) => call('POST', '/admin/client-reports/shares', { as, body: { campaignId: String(ctx.camp._id), label: 'X', password: PASSWORD, ...body } });
  // A draft has nothing to show yet.
  let res = await post({ reportId: String(ctx.draft._id) });
  assert.strictEqual(res.status, 409);
  assert.deepStrictEqual([res.json.code, res.json.status, res.json.takenDown], ['REPORT_NOT_SHOWN', 'draft', false]);
  // Nor a taken-down one (still status 'published'): its link would only ever say "taken down".
  const down = await made(ctx.camp, { weekStart: '2026-06-29', weekEnd: '2026-07-05' });
  assert.strictEqual((await call('POST', `/admin/client-reports/${down._id}/take-down`)).status, 200);
  res = await post({ reportId: String(down._id) });
  assert.strictEqual(res.status, 409);
  assert.deepStrictEqual([res.json.code, res.json.status, res.json.takenDown], ['REPORT_NOT_SHOWN', 'published', true]);
  assert.match(res.json.error, /Put it back up/);
  // Another campaign's report, another organization's, one that doesn't exist, and no id at all.
  for (const id of [ctx.otherReport._id, ctx.foreignReport._id, new ObjectId()]) {
    res = await post({ reportId: String(id) });
    assert.deepStrictEqual([res.status, res.json.code], [404, 'REPORT_NOT_FOUND'], String(id));
  }
  assert.strictEqual((await post({ reportId: 'nope' })).status, 400);
  assert.strictEqual(await ReportShareLink.countDocuments({ label: 'X' }), 0, 'no link was left behind by a refusal');

  // A lead makes one on her campaign, never on another.
  const leads = await post({ label: 'Lead-made', reportId: String(ctx.r1._id) }, ctx.lead);
  assert.strictEqual(leads.status, 201, JSON.stringify(leads.json));
  assert.strictEqual(leads.json.share.reportId, String(ctx.r1._id));
  const theirs = await call('POST', '/admin/client-reports/shares', { as: ctx.lead, body: { campaignId: String(ctx.other._id), password: PASSWORD, reportId: String(ctx.otherReport._id) } });
  assert.strictEqual(theirs.status, 403);
  // A link to all the reports is no longer made: null, or no reportId at all, is refused
  // (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C1).
  for (const body of [{ label: 'Null', reportId: null }, { label: 'Null' }]) {
    const nul = await post(body);
    assert.deepStrictEqual([nul.status, nul.json.code], [400, 'REPORT_REQUIRED']);
  }
  assert.strictEqual(await ReportShareLink.countDocuments({ label: 'Null' }), 0);

  // The rows: a link to all the reports has reportId and report null; a link to one names its report,
  // its dates and its tab as the tabs read now, and the tab's id.
  const list = await call('GET', `/admin/client-reports/shares?campaignId=${ctx.camp._id}`);
  assert.strictEqual(list.status, 200);
  const row = (id) => list.json.shares.find((s) => s.id === String(id));
  assert.deepStrictEqual([row(ctx.all.id).reportId, row(ctx.all.id).report, row(ctx.all.id).allReports], [null, null, true]);
  assert.deepStrictEqual(row(ctx.one.id).report, {
    id: String(ctx.r2._id), weekStart: '2026-07-13', weekEnd: '2026-07-19', scopeLabel: 'Whole campaign', takenDown: false, seriesId: String(ctx.r2.seriesId),
  });
  assert.strictEqual(row(ctx.one.id).reportId, String(ctx.r2._id));
  // A walk-list report's link names its tab.
  const walkLink = await linkFor(ctx.camp, { label: 'Walker', reportId: ctx.walk._id });
  const listed = (await call('GET', '/admin/client-reports?campaignId=' + ctx.camp._id)).json.reports.find((r) => r.id === String(ctx.walk._id));
  assert.strictEqual(walkLink.report.scopeLabel, listed.seriesLabel);
  assert.strictEqual(walkLink.report.scopeLabel, 'North');
  // Every response that returns a row carries it — a rename, say.
  const renamed = await call('PATCH', `/admin/client-reports/shares/${ctx.one.id}`, { body: { label: 'Board' } });
  assert.strictEqual(renamed.json.share.reportId, String(ctx.r2._id));
  assert.strictEqual(renamed.json.share.report.id, String(ctx.r2._id));
  // The field is declared, so a filter on it is never dropped (strictQuery would match every link).
  assert.ok(ReportShareLink.schema.path('reportId'), 'reportId is a schema path');
  assert.strictEqual(await ReportShareLink.countDocuments({ campaignId: ctx.camp._id, reportId: ctx.r2._id }), 1);
});

test('with a link to one report, every public route given another report’s id answers 404', { skip }, async () => {
  const snapshotKey = encodeURIComponent(ctx.r1.snapshotKey);
  const viewsBefore = (await ClientReport.findById(ctx.r1._id).lean()).views;
  const others = [ctx.r1, ctx.walk, ctx.draft, ctx.otherReport, ctx.foreignReport, { _id: new ObjectId(), snapshotKey: 'x' }];
  for (const r of others) {
    const id = String(r._id);
    const key = encodeURIComponent(r.snapshotKey || 'x');
    for (const [path, method] of [
      [`/reports/${id}`, 'GET'],
      [`/reports/${id}/map`, 'GET'],
      [`/reports/${id}/map/doors?snapshotKey=${key}&rows=0,1`, 'GET'],
      [`/reports/${id}/areas`, 'GET'],
      [`/reports/${id}/opened`, 'POST'],
    ]) {
      const res = await pub(ctx.one, path, { method });
      assert.deepStrictEqual([res.status, res.json?.code], [404, 'REPORT_NOT_FOUND'], `${method} ${path}`);
    }
  }
  // The same reports on the link to all of them: the campaign's published ones open.
  assert.strictEqual((await pub(ctx.all, `/reports/${ctx.r1._id}`)).status, 200);
  assert.strictEqual((await pub(ctx.all, `/reports/${ctx.walk._id}`)).status, 200);
  assert.strictEqual((await pub(ctx.all, `/reports/${ctx.r1._id}/map/doors?snapshotKey=${snapshotKey}&rows=0`)).status, 200);
  // Its own report opens, map and doors included; its open counts under the link.
  const own = String(ctx.r2._id);
  assert.strictEqual((await pub(ctx.one, `/reports/${own}`)).status, 200);
  assert.strictEqual((await pub(ctx.one, `/reports/${own}/map`)).status, 200);
  assert.strictEqual((await pub(ctx.one, `/reports/${own}/map/doors?snapshotKey=${encodeURIComponent(ctx.r2.snapshotKey)}&rows=0`)).status, 200);
  assert.strictEqual((await pub(ctx.one, `/reports/${own}/opened`, { method: 'POST' })).status, 204);
  let counted = 0;
  for (let i = 0; i < 100 && !counted; i += 1) {
    counted = (await ClientReport.findById(ctx.r2._id).lean()).views?.byLink?.[ctx.one.id]?.opens || 0;
    if (!counted) await new Promise((r) => setTimeout(r, 20));
  }
  assert.strictEqual(counted, 1, 'the open counts under the one-report link');
  assert.deepStrictEqual((await ClientReport.findById(ctx.r1._id).lean()).views, viewsBefore, 'a refused open records nothing');
  // Meta, the logo and the map token read no report, and still work.
  assert.deepStrictEqual((await pub(ctx.one, '')).json, { requiresPassword: true });
  assert.strictEqual((await pub(ctx.one, '/logo')).status, 204);
  assert.strictEqual((await pub(ctx.one, '/mapbox-token')).status, 200);
});

test('the hub: one row on a link to one report — gone when taken down, back when put back up; unchanged on a link to all', { skip }, async () => {
  let hub = await pub(ctx.one, '/reports');
  assert.strictEqual(hub.status, 200);
  assert.deepStrictEqual([hub.json.single, hub.json.reportId, hub.json.gone], [true, String(ctx.r2._id), false]);
  assert.deepStrictEqual(hub.json.reports.map((r) => r.id), [String(ctx.r2._id)]);
  assert.strictEqual(hub.json.campaignName, 'Fall', 'the page header still has its names');

  // A link to all the reports: every shown report, `single: false`, and nothing else new.
  const all = await pub(ctx.all, '/reports');
  assert.strictEqual(all.json.single, false);
  assert.ok(!('reportId' in all.json) && !('gone' in all.json));
  assert.deepStrictEqual(Object.keys(all.json), ['campaignName', 'orgName', 'hasLogo', 'reports', 'single']);
  assert.deepStrictEqual(new Set(all.json.reports.map((r) => r.id)), new Set([String(ctx.r1._id), String(ctx.r2._id), String(ctx.walk._id)]));

  // Taken down: gone, and the report itself reads as taken down or removed. Put back up: there again.
  assert.strictEqual((await call('POST', `/admin/client-reports/${ctx.r2._id}/take-down`)).status, 200);
  // The links panel learns it (code review round 2, FRESH-6): the row's report says taken down.
  const panelRow = async () => (await call('GET', `/admin/client-reports/shares?campaignId=${ctx.camp._id}`)).json.shares.find((s) => s.id === ctx.one.id);
  assert.strictEqual((await panelRow()).report.takenDown, true, 'a taken-down report reads taken down in the panel');
  hub = await pub(ctx.one, '/reports');
  assert.deepStrictEqual([hub.json.single, hub.json.gone, hub.json.reports.length], [true, true, 0]);
  assert.deepStrictEqual([(await pub(ctx.one, `/reports/${ctx.r2._id}`)).status, (await pub(ctx.one, `/reports/${ctx.r2._id}`)).json.code], [404, 'REPORT_NOT_FOUND']);
  assert.strictEqual((await call('POST', `/admin/client-reports/${ctx.r2._id}/put-back-up`)).status, 200);
  assert.strictEqual((await panelRow()).report.takenDown, false, 'put back up: no longer taken down');
  hub = await pub(ctx.one, '/reports');
  assert.deepStrictEqual([hub.json.gone, hub.json.reports.map((r) => r.id)], [false, [String(ctx.r2._id)]]);
  assert.strictEqual((await pub(ctx.one, `/reports/${ctx.r2._id}`)).status, 200);

  // A link whose report no longer exists (left by a crash mid-delete): gone, never another report.
  const orphan = await ReportShareLink.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, token: 'single-orphan-token', label: 'Orphan',
    passwordHash: (await ReportShareLink.findById(ctx.one.id).lean()).passwordHash, expiresAt: new Date(Date.now() + 86400e3),
    isActive: true, reportId: new ObjectId(),
  });
  const orphanLink = { token: orphan.token, access: await accessFor(orphan.token) };
  hub = await pub(orphanLink, '/reports');
  assert.deepStrictEqual([hub.json.single, hub.json.gone, hub.json.reports], [true, true, []]);

  // A link from before the field — no reportId at all — opens every report, as it always did.
  const { insertedId } = await ReportShareLink.collection.insertOne({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, token: 'single-legacy-token', label: 'Legacy',
    passwordHash: orphan.passwordHash, expiresAt: new Date(Date.now() + 86400e3), isActive: true, createdAt: new Date(), updatedAt: new Date(),
  });
  assert.ok(!('reportId' in (await ReportShareLink.collection.findOne({ _id: insertedId }))));
  const legacy = { token: 'single-legacy-token', access: await accessFor('single-legacy-token') };
  hub = await pub(legacy, '/reports');
  assert.strictEqual(hub.json.single, false);
  assert.strictEqual(hub.json.reports.length, 3);
  assert.strictEqual((await pub(legacy, `/reports/${ctx.r1._id}`)).status, 200);
});

test('the report on a link to one report names no other: nav null, and the earlier totals “before” its start', { skip }, async () => {
  const one = await pub(ctx.one, `/reports/${ctx.r2._id}`);
  const all = await pub(ctx.all, `/reports/${ctx.r2._id}`);
  assert.strictEqual(one.status, 200, JSON.stringify(one.json));
  assert.deepStrictEqual([one.json.single, all.json.single], [true, false]);
  // On the link to all: Older points at week 1, and the line says "since the Jul 6 – Jul 12 report".
  assert.deepStrictEqual(all.json.report.nav, { olderId: String(ctx.r1._id), newerId: null });
  const line = all.json.report.earlierTotals;
  assert.ok(line?.changes?.length, `week 2 recounted week 1: ${JSON.stringify(line)}`);
  assert.deepStrictEqual(line.since, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
  assert.ok(!('before' in line));
  // On the link to one: no arrows, the same counts, no other report named.
  assert.strictEqual(one.json.report.nav, null);
  assert.deepStrictEqual(one.json.report.earlierTotals, { changes: line.changes, since: null, before: '2026-07-13' });
  assert.ok(!JSON.stringify(one.json).includes(String(ctx.r1._id)), 'week 1’s id appears nowhere');
  // Everything else is the same report.
  const strip = (j) => ({ ...j.report, nav: null, earlierTotals: null });
  assert.deepStrictEqual(strip(one.json), strip(all.json));
  assert.deepStrictEqual(one.json.survey, all.json.survey);
});

test('deleting a report deletes its one-report links, a History row each — the rest stay', { skip }, async () => {
  // A second Share on it answers with the link it has; two more from before one link per report.
  const again = await call('POST', '/admin/client-reports/shares', { body: { campaignId: String(ctx.camp._id), password: PASSWORD, reportId: String(ctx.walk._id) } });
  assert.deepStrictEqual([again.status, again.json.code, again.json.share.label], [409, 'REPORT_HAS_LINK', 'Walker']);
  await oldLink(ctx.camp, { label: 'Walk board', reportId: ctx.walk._id });
  await oldLink(ctx.camp, { label: 'Walk donor', reportId: ctx.walk._id });
  // Its three links (Walker, from the first test, too), and every other link of the campaign.
  const doomed = await ReportShareLink.find({ reportId: ctx.walk._id }).lean();
  assert.deepStrictEqual(doomed.map((l) => l.label).sort(), ['Walk board', 'Walk donor', 'Walker']);
  const keep = await ReportShareLink.find({ campaignId: ctx.camp._id, reportId: { $ne: ctx.walk._id } }, { _id: 1 }).lean();
  assert.ok(keep.length >= 4, 'the link to all the reports, Board (week 2), and more');

  const res = await call('DELETE', `/admin/client-reports/${ctx.walk._id}`);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(await ReportShareLink.countDocuments({ reportId: ctx.walk._id }), 0, 'its links are gone');
  assert.deepStrictEqual(
    (await ReportShareLink.find({ campaignId: ctx.camp._id }, { _id: 1 }).lean()).map((l) => String(l._id)).sort(),
    keep.map((l) => String(l._id)).sort(),
    'every other link stays'
  );
  for (const link of doomed) {
    const rows = await CampaignChange.find({ shareLinkId: link._id, field: 'reportLink.deleted' }).lean();
    assert.strictEqual(rows.length, 1, link.label);
    assert.deepStrictEqual(rows[0].toValue, { label: link.label, reportDeleted: true });
    assert.strictEqual(String(rows[0].byUserId), String(ctx.adminUser._id));
    assert.strictEqual(rows[0].source, 'client_report');
    assert.ok(!('via' in rows[0]));
    assert.ok(!JSON.stringify(rows[0]).includes(link.token), 'no URL token in History');
    // Its address is dead.
    const meta = await call('GET', `/share/${link.token}`, { as: null });
    assert.deepStrictEqual([meta.status, meta.json.code], [404, 'SHARE_NOT_FOUND']);
  }
  assert.strictEqual(await CampaignChange.countDocuments({ field: 'reportLink.deleted', 'toValue.reportDeleted': true }), 3);
});

test('a link made while its report is deleted goes with it, never left opening nothing', { skip }, async () => {
  const doomed = await made(ctx.camp, { weekStart: '2026-06-22', weekEnd: '2026-06-28' });
  // The delete lands between the link's check and its insert (DELETE /:id's own sweep ran before the
  // link existed): the share route sees the report gone after its insert.
  const realCreate = ReportShareLink.create;
  ReportShareLink.create = async function (...args) {
    ReportShareLink.create = realCreate;
    await ClientReport.deleteOne({ _id: doomed._id });
    return realCreate.apply(this, args);
  };
  let res;
  try {
    res = await call('POST', '/admin/client-reports/shares', { body: { campaignId: String(ctx.camp._id), label: 'Late', password: PASSWORD, reportId: String(doomed._id) } });
  } finally {
    ReportShareLink.create = realCreate;
  }
  assert.deepStrictEqual([res.status, res.json.code], [404, 'REPORT_NOT_FOUND']);
  assert.strictEqual(await ReportShareLink.countDocuments({ reportId: doomed._id }), 0);
  const rows = await CampaignChange.find({ field: { $in: ['reportLink.created', 'reportLink.deleted'] }, 'toValue.label': 'Late' }).sort({ createdAt: 1, _id: 1 }).lean();
  assert.deepStrictEqual(rows.map((r) => [r.field, !!r.toValue.reportDeleted]), [['reportLink.created', false], ['reportLink.deleted', true]]);
});

// The publish-time link check is gone (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C1, D5): a draft can never
// have a link of its own — Share makes it once the report is published — so Before you publish no longer
// counts links, working or not, of either kind.
test('the report’s checks no longer count links: a draft never has one of its own', { skip }, async () => {
  const p1 = await made(ctx.checks, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
  const draft = await runBuild((await create(ctx.checks, { weekStart: '2026-07-13', weekEnd: '2026-07-19' }))._id);
  await makeLink(ctx.checks, { label: 'Board', reportId: p1._id });
  await oldLink(ctx.checks, { label: 'Old' });
  for (const id of [p1._id, draft._id]) {
    const res = await call('GET', `/admin/client-reports/${id}`);
    assert.strictEqual(res.status, 200, JSON.stringify(res.json));
    assert.ok(res.json.checks && typeof res.json.checks === 'object', 'the checks are still there');
    assert.ok(!('links' in res.json.checks), 'but no link count');
  }
  const res = await call('POST', '/admin/client-reports/shares', { body: { campaignId: String(ctx.checks._id), password: PASSWORD, reportId: String(draft._id) } });
  assert.deepStrictEqual([res.status, res.json.code], [409, 'REPORT_NOT_SHOWN']);
});
