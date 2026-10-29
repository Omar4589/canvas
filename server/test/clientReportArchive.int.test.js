import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Archive (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C4, contract K7), against the real app and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/archive node --test test/clientReportArchive.int.test.js
//
//   · Archive and Unarchive are CASes on archivedAt: a repeat — or eight at once — changes nothing more and
//     writes one History row each way; `status` is never touched, on a draft or a published report;
//   · list rows, GET /:id and the duplicate answers carry archivedAt (null on a report from before the field);
//     REPORT_EXISTS says "— it’s archived", and names a report that isn't archived after its open-first rule;
//   · display-only: Publish, Take down and Put back up keep it; a link to one report and an old link to all
//     your reports still open an archived report; Next onto an archived report answers it, archived;
//   · the campaign's leads may archive, another campaign's lead can't, another organization's report is 404;
//   · and two route changes beside it: the report-delete cascade names its link's History row by the deleted
//     report (§C7), and the builder's preview words earlier totals as a one-report link does (§C8).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-client-report-archive';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.CLIENT_REPORT_QUEUE_TIMEOUT_MS = '300';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ClientReportSeries } = await import('../src/models/ClientReportSeries.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { processClientReportJob } = await import('../src/services/reports/clientReportBuilds.js');
const { ensureSeries } = await import('../src/services/reports/clientReportSeries.js');
const { ensureReportPeriodGuard, ensureAllTimeGuard } = await import('../src/services/reports/clientReportIndexes.js');
const { getQueue, QUEUE_NAMES } = await import('../src/queues/index.js');
const { zonedDayRange } = await import('../src/utils/timezone.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;
const TZ = 'America/Chicago';
const PASSWORD = 'archive-password-1';

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
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};
const archive = (id, as) => call('POST', `/admin/client-reports/${id}/archive`, { as });
const unarchive = (id, as) => call('POST', `/admin/client-reports/${id}/unarchive`, { as });
const historyRows = (reportId, field) => CampaignChange.find({ clientReportId: reportId, field }).lean();

let campN = 0;
const newCampaign = async (name, org = ctx.org) => {
  campN += 1;
  return Campaign.create({
    organizationId: org._id, name: `${name} ${campN}`, type: 'survey', state: 'FL', isActive: true,
    surveyTemplateId: ctx.template._id, timeZone: TZ,
  });
};
const tabOf = (camp) => ensureSeries({ organizationId: camp.organizationId, campaignId: camp._id, kind: 'campaign' });
// A report written straight to the collection's model, its createdAt pinned (raw write: Mongoose keeps
// createdAt immutable), for the duplicate answers' ordering.
const reportIn = async (camp, { weekStart, weekEnd, status = 'published', createdAt = null, ...extra }) => {
  const series = await tabOf(camp);
  const range = zonedDayRange(weekStart, weekEnd, TZ);
  const doc = await ClientReport.create({
    organizationId: camp.organizationId, campaignId: camp._id, campaignType: 'survey', seriesId: series._id,
    scope: { kind: 'campaign', label: 'Whole campaign' }, weekStart, weekEnd, timeZone: TZ,
    rangeStartUtc: range.$gte, rangeEndUtc: range.$lt, status, publishedAt: status === 'published' ? new Date() : null,
    visibility: { visibleQuestionKeys: [], mapAnswerKeys: [], showMap: false }, ...extra,
  });
  if (createdAt) await ClientReport.collection.updateOne({ _id: doc._id }, { $set: { createdAt } });
  return ClientReport.findById(doc._id).lean();
};

let hhN = 0;
const knock = async (camp, timestamp) => {
  hhN += 1;
  const hh = await Household.create({
    organizationId: camp.organizationId, campaignId: camp._id, isActive: true,
    addressLine1: `${hhN} Archive St`, city: 'Tampa', state: 'FL', zipCode: '33601', normalizedAddress: `ARCHIVE${hhN}`,
    location: { type: 'Point', coordinates: [-82.46 + hhN / 1e4, 27.95] },
  });
  await CanvassActivity.create({
    organizationId: camp.organizationId, campaignId: camp._id, householdId: hh._id, userId: ctx.adminUser._id,
    actionType: 'not_home', timestamp, passId: ctx.pass, location: { lat: 27.95, lng: -82.46 },
  });
};
// Noon in Chicago (CDT, UTC-5) on a July day.
const at = (day) => new Date(`${day}T12:00:00-05:00`);

const runBuild = async (reportId) => {
  const jobId = new ObjectId().toHexString();
  await ClientReport.updateOne({ _id: reportId }, { $set: { 'build.status': 'queued', 'build.jobId': jobId, 'build.startedAt': new Date() } });
  const out = await processClientReportJob({ id: jobId, data: { reportId: String(reportId) }, moveToDelayed: async () => {}, updateProgress: async () => {} }, 'token');
  assert.ok(out?.committed, `the build committed: ${JSON.stringify(out)}`);
  return ClientReport.findById(reportId).lean();
};
const draftOf = async (camp, body) => {
  const res = await call('POST', '/admin/client-reports', { body: { campaignId: String(camp._id), ...body } });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  return runBuild(res.json.report._id);
};
const publish = async (r) => {
  const res = await call('POST', `/admin/client-reports/${r._id}/publish`, { body: { snapshotId: String(r.snapshotId), editVersion: r.editVersion ?? 0 } });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  return ClientReport.findById(r._id).lean();
};

// A link written to the model as Share makes one (a link to one report, in the one-link guard) or as one
// made before (to all the campaign's reports), then unlocked through the real public route.
let linkN = 0;
const linkTo = async (camp, reportId = null) => {
  linkN += 1;
  const link = await ReportShareLink.create({
    organizationId: camp.organizationId, campaignId: camp._id, token: `archive-link-${linkN}-${new ObjectId()}`,
    passwordHash: await bcrypt.hash(PASSWORD, 4), passwordMeetsRule: true, expiresAt: new Date(Date.now() + 30 * 86400e3),
    lifetimeStartAt: new Date(), credentialVersion: 0, isActive: true,
    ...(reportId ? { reportId, oneLinkGuard: true } : {}),
  });
  const unlock = await call('POST', `/share/${link.token}/unlock`, { as: null, body: { password: PASSWORD }, headers: { 'X-Forwarded-For': `10.7.0.${linkN}` } });
  assert.strictEqual(unlock.status, 200, JSON.stringify(unlock.json));
  return { link, access: unlock.json.accessToken };
};
const pub = ({ link, access }, path) => call('GET', `/share/${link.token}${path}`, { as: null, headers: { 'X-Share-Token': access } });

before(async () => {
  if (!URI) return;
  mongoose.set('strictQuery', true); // as production's connectDb: an undeclared filter key is stripped
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await ClientReportSeries.syncIndexes();
  await ensureReportPeriodGuard('test'); // as the web dyno and the worker do at boot
  await ensureAllTimeGuard('test');
  // Builds are driven by hand (runBuild): the queue answers at once instead of timing out on Redis.
  getQueue(QUEUE_NAMES.CLIENT_REPORT).add = async (name, data, opts) => ({ id: opts?.jobId });

  const org = await Organization.create({ name: 'Archive Org', slug: 'archive-org', isActive: true });
  const other = await Organization.create({ name: 'Other Org', slug: 'archive-other-org', isActive: true });
  for (const o of [org, other]) await Subscription.create({ organizationId: o._id, status: 'active' });
  const user = (first, email) => User.create({ firstName: first, lastName: 'Archive', email, passwordHash: 'x', isActive: true });
  const [adminUser, leadUser, otherLead, otherAdmin] = await Promise.all([
    user('Ada', 'ada@archive.t.co'), user('Lee', 'lee@archive.t.co'), user('Lou', 'lou@archive.t.co'), user('Oz', 'oz@archive-other.t.co'),
  ]);
  await Membership.create({ userId: adminUser._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: leadUser._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: otherLead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: otherAdmin._id, organizationId: other._id, role: 'admin', isActive: true });
  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Archive', isActive: true,
    questions: [{ key: 'support', label: 'Support?', type: 'single_choice', options: [{ id: 'y', text: 'Yes' }, { id: 'n', text: 'No' }] }],
  });
  const as = (u, o = org) => ({ token: signUserToken(u), orgId: o._id });
  Object.assign(ctx, {
    org, other, adminUser, template, pass: new ObjectId(),
    admin: as(adminUser), lead: as(leadUser), otherLead: as(otherLead), otherAdmin: as(otherAdmin, other),
    leadUser, otherLeadUser: otherLead,
  });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('Archive and Unarchive are CASes: a repeat changes nothing, one History row each way, status untouched', { skip }, async () => {
  const camp = await newCampaign('CAS');
  const shown = await reportIn(camp, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });

  const first = await archive(shown._id);
  assert.strictEqual(first.status, 200, JSON.stringify(first.json));
  const r = first.json.report;
  assert.ok(r.archivedAt, 'archived');
  assert.strictEqual(String(r.archivedBy), String(ctx.adminUser._id));
  assert.deepStrictEqual([r.status, r.takenDownAt], ['published', null], 'status and take-down untouched');
  const again = await archive(shown._id);
  assert.strictEqual(again.status, 200, 'a repeat answers the report as it is');
  assert.strictEqual(again.json.report.archivedAt, r.archivedAt, 'the first archive’s time stands');
  const rows = await historyRows(shown._id, 'clientReport.archived');
  assert.strictEqual(rows.length, 1, 'one History row, never a second for the repeat');
  assert.strictEqual(String(rows[0].byUserId), String(ctx.adminUser._id));
  assert.strictEqual(rows[0].periodLabel, 'Jul 6 – Jul 12, 2026');
  assert.strictEqual(String(rows[0].seriesId), String(shown.seriesId));

  const back = await unarchive(shown._id);
  assert.strictEqual(back.status, 200, JSON.stringify(back.json));
  assert.deepStrictEqual([back.json.report.archivedAt, back.json.report.archivedBy, back.json.report.status], [null, null, 'published']);
  assert.strictEqual((await unarchive(shown._id)).json.report.archivedAt, null);
  assert.strictEqual((await historyRows(shown._id, 'clientReport.unarchived')).length, 1);

  // Eight archives at once: one wins, every request answers 200, one History row.
  const burst = await Promise.all(Array.from({ length: 8 }, () => archive(shown._id)));
  assert.deepStrictEqual(burst.map((b) => b.status), Array(8).fill(200));
  assert.strictEqual(new Set(burst.map((b) => b.json.report.archivedAt)).size, 1, 'one archivedAt');
  assert.strictEqual((await historyRows(shown._id, 'clientReport.archived')).length, 2, 'the first archive and this burst’s one');

  // A draft can be archived, and stays a draft.
  const draft = await reportIn(camp, { weekStart: '2026-07-13', weekEnd: '2026-07-19', status: 'draft' });
  const d = await archive(draft._id);
  assert.strictEqual(d.status, 200, JSON.stringify(d.json));
  assert.deepStrictEqual([d.json.report.status, !!d.json.report.archivedAt], ['draft', true]);
  const raw = await ClientReport.collection.findOne({ _id: draft._id });
  assert.strictEqual(raw.status, 'draft', 'never the unused archived status');
});

test('list rows and GET /:id carry archivedAt — null on a report from before the field', { skip }, async () => {
  const camp = await newCampaign('Rows');
  const kept = await reportIn(camp, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
  const archived = await reportIn(camp, { weekStart: '2026-07-13', weekEnd: '2026-07-19' });
  await archive(archived._id);
  // Written as an older server wrote it: no archivedAt key at all.
  const series = await tabOf(camp);
  const range = zonedDayRange('2026-06-29', '2026-07-05', TZ);
  const { insertedId: legacyId } = await ClientReport.collection.insertOne({
    organizationId: ctx.org._id, campaignId: camp._id, campaignType: 'survey', seriesId: series._id,
    scope: { kind: 'campaign', label: 'Whole campaign' }, weekStart: '2026-06-29', weekEnd: '2026-07-05', timeZone: TZ,
    rangeStartUtc: range.$gte, rangeEndUtc: range.$lt, status: 'published', publishedAt: new Date(),
    visibility: { visibleQuestionKeys: [], mapAnswerKeys: [], showMap: false }, createdAt: new Date(), updatedAt: new Date(),
  });

  const list = await call('GET', `/admin/client-reports?campaignId=${camp._id}`);
  assert.strictEqual(list.status, 200, JSON.stringify(list.json));
  const rowOf = (id) => list.json.reports.find((x) => x.id === String(id));
  assert.strictEqual(rowOf(kept._id).archivedAt, null);
  assert.ok(rowOf(archived._id).archivedAt, 'the archived row says so');
  assert.ok('archivedAt' in rowOf(legacyId) && rowOf(legacyId).archivedAt === null);

  const one = async (id) => {
    const res = await call('GET', `/admin/client-reports/${id}`);
    assert.strictEqual(res.status, 200, JSON.stringify(res.json));
    return res.json.report;
  };
  assert.ok((await one(archived._id)).archivedAt);
  const legacy = await one(legacyId);
  assert.ok('archivedAt' in legacy && legacy.archivedAt === null, 'the key is there on a report from before the field');
  // …and a legacy report archives and unarchives like any other.
  assert.ok((await archive(legacyId)).json.report.archivedAt);
  assert.strictEqual((await unarchive(legacyId)).json.report.archivedAt, null);
});

test('REPORT_EXISTS carries archivedAt and says so — and names a report that isn’t archived, after its open-first rule', { skip }, async () => {
  const camp = await newCampaign('Duplicates');
  const dates = { weekStart: '2026-07-06', weekEnd: '2026-07-12' };
  const older = await reportIn(camp, { ...dates, createdAt: new Date('2026-07-13T15:00:00Z') });
  const newer = await reportIn(camp, { ...dates, createdAt: new Date('2026-07-14T15:00:00Z') });
  const exists = async () => {
    const res = await call('POST', '/admin/client-reports', { body: { campaignId: String(camp._id), ...dates } });
    assert.strictEqual(res.status, 409, JSON.stringify(res.json));
    assert.strictEqual(res.json.code, 'REPORT_EXISTS');
    return res.json;
  };

  let d = await exists();
  assert.deepStrictEqual([d.reportId, d.archivedAt], [String(newer._id), null], 'two shown: the newest');
  assert.match(d.error, /To bring its numbers up to date/);
  await archive(newer._id);
  d = await exists();
  assert.deepStrictEqual([d.reportId, d.archivedAt], [String(older._id), null], 'the one that isn’t archived');
  await archive(older._id);
  d = await exists();
  assert.strictEqual(d.reportId, String(newer._id), 'both archived: the newest again');
  assert.ok(d.archivedAt);
  assert.strictEqual(d.error, 'You already published a Whole campaign report for Jul 6 – Jul 12, 2026 — it’s archived.');

  // The open-first rule comes first: an archived draft is still the one to open.
  const draft = await reportIn(camp, { ...dates, status: 'draft', createdAt: new Date('2026-07-12T15:00:00Z') });
  await unarchive(newer._id);
  await archive(draft._id);
  d = await exists();
  assert.deepStrictEqual([d.reportId, d.status, !!d.archivedAt], [String(draft._id), 'draft', true]);
  assert.strictEqual(d.error, 'You already have a draft Whole campaign report for Jul 6 – Jul 12, 2026 — it’s archived.');
  // Both taken down (older still archived, newer not): the one that isn't archived. Then a taken-down
  // one, archived, says both.
  await ClientReport.deleteOne({ _id: draft._id });
  await call('POST', `/admin/client-reports/${newer._id}/take-down`);
  await call('POST', `/admin/client-reports/${older._id}/take-down`);
  d = await exists();
  assert.deepStrictEqual([d.reportId, d.takenDown, d.archivedAt], [String(newer._id), true, null], 'the one that isn’t archived');
  await archive(newer._id);
  await ClientReport.deleteOne({ _id: older._id });
  d = await exists();
  assert.strictEqual(d.error, 'You already published a Whole campaign report for Jul 6 – Jul 12, 2026, taken down — it’s archived.');
});

test('Publish, Take down and Put back up keep archivedAt; a one-report link and an old link to all your reports still open it', { skip }, async () => {
  const camp = await newCampaign('Display only');
  await knock(camp, at('2026-07-07'));
  const draft = await draftOf(camp, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
  const stamped = (await archive(draft._id)).json.report.archivedAt;
  assert.ok(stamped);

  const published = await publish(draft);
  assert.strictEqual(published.status, 'published');
  assert.strictEqual(published.archivedAt.toISOString(), stamped, 'Publish keeps it');
  const down = await call('POST', `/admin/client-reports/${draft._id}/take-down`);
  assert.strictEqual(down.status, 200, JSON.stringify(down.json));
  assert.strictEqual(down.json.report.archivedAt, stamped, 'Take down keeps it');
  const up = await call('POST', `/admin/client-reports/${draft._id}/put-back-up`);
  assert.strictEqual(up.status, 200, JSON.stringify(up.json));
  assert.strictEqual(up.json.report.archivedAt, stamped, 'Put back up keeps it');

  // Nothing changes for the client: its own link opens it, and an old link to all the reports lists it.
  const own = await linkTo(camp, draft._id);
  const page = await pub(own, `/reports/${draft._id}`);
  assert.strictEqual(page.status, 200, JSON.stringify(page.json));
  assert.strictEqual(page.json.report.id, String(draft._id));
  assert.ok(!('archivedAt' in page.json.report), 'never on the client’s page');
  const ownHub = await pub(own, '/reports');
  assert.deepStrictEqual(ownHub.json.reports.map((x) => x.id), [String(draft._id)]);
  const all = await linkTo(camp);
  const hub = await pub(all, '/reports');
  assert.strictEqual(hub.status, 200, JSON.stringify(hub.json));
  assert.deepStrictEqual(hub.json.reports.map((x) => x.id), [String(draft._id)]);
  assert.strictEqual((await pub(all, `/reports/${draft._id}`)).status, 200);
});

test('Next onto an archived report answers it, archived', { skip }, async () => {
  const camp = await newCampaign('Next');
  await knock(camp, at('2026-07-07'));
  const week1 = await publish(await draftOf(camp, { weekStart: '2026-07-06', weekEnd: '2026-07-12' }));
  const made = await call('POST', `/admin/client-reports/${week1._id}/next`);
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  await archive(made.json.report._id);
  const again = await call('POST', `/admin/client-reports/${week1._id}/next`);
  assert.strictEqual(again.status, 200, JSON.stringify(again.json));
  assert.deepStrictEqual([again.json.existing, again.json.report._id], [true, made.json.report._id]);
  assert.ok(again.json.report.archivedAt, 'the builder opens on it archived, with Unarchive');
});

test('the campaign’s leads may archive; another campaign’s lead can’t; another organization’s report is 404', { skip }, async () => {
  const camp = await newCampaign('Leads');
  const elsewhere = await newCampaign('Elsewhere');
  await CampaignManager.create({ campaignId: camp._id, userId: ctx.leadUser._id, organizationId: ctx.org._id });
  await CampaignManager.create({ campaignId: elsewhere._id, userId: ctx.otherLeadUser._id, organizationId: ctx.org._id });
  const r = await reportIn(camp, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });

  const byLead = await archive(r._id, ctx.lead);
  assert.strictEqual(byLead.status, 200, JSON.stringify(byLead.json));
  assert.strictEqual(String(byLead.json.report.archivedBy), String(ctx.leadUser._id));
  assert.strictEqual((await unarchive(r._id, ctx.otherLead)).status, 403);
  assert.strictEqual((await archive(r._id, ctx.otherLead)).status, 403);
  const foreign = await unarchive(r._id, ctx.otherAdmin);
  assert.deepStrictEqual([foreign.status, foreign.json.code], [404, 'REPORT_NOT_FOUND']);
  assert.ok((await ClientReport.findById(r._id).lean()).archivedAt, 'still archived');
  assert.strictEqual((await unarchive(r._id, ctx.lead)).status, 200);
  assert.strictEqual((await archive('not-an-id')).status, 400);
});

test('deleting a report names its link’s History row by the deleted report (§C7)', { skip }, async () => {
  const camp = await newCampaign('Delete');
  const r = await reportIn(camp, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
  const { link } = await linkTo(camp, r._id);
  const res = await call('DELETE', `/admin/client-reports/${r._id}`);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(await ReportShareLink.exists({ _id: link._id }), null, 'its link went with it');
  const row = await CampaignChange.findOne({ shareLinkId: link._id, field: 'reportLink.deleted' }).lean();
  assert.ok(row, 'a History row for the link');
  assert.deepStrictEqual(
    [String(row.clientReportId), String(row.seriesId), row.periodLabel, row.toValue.reportDeleted],
    [String(r._id), String(r.seriesId), 'Jul 6 – Jul 12, 2026', true],
    'named by the report, which can no longer be looked up'
  );
});

test('the builder’s preview words earlier totals as the report’s own link does (§C8)', { skip }, async () => {
  const camp = await newCampaign('Earlier');
  await knock(camp, at('2026-07-07'));
  await knock(camp, at('2026-07-08'));
  const week1 = await publish(await draftOf(camp, { weekStart: '2026-07-06', weekEnd: '2026-07-12' }));
  // A knock timed in week 1 that synced after it was built: the next build recounts week 1 with it.
  await knock(camp, at('2026-07-09'));
  const week2 = await publish(await draftOf(camp, { weekStart: '2026-07-13', weekEnd: '2026-07-19' }));
  assert.strictEqual(String(week2.comparedReportId), String(week1._id));

  const preview = await call('GET', `/admin/client-reports/${week2._id}/preview`);
  assert.strictEqual(preview.status, 200, JSON.stringify(preview.json));
  const line = preview.json.report.earlierTotals;
  assert.deepStrictEqual(line, { changes: [{ card: 'doorsKnocked', delta: 1 }], since: null, before: '2026-07-13' }, 'no “since <period>” clause');
  // Exactly what the client reads through the report's own link.
  const own = await linkTo(camp, week2._id);
  const page = await pub(own, `/reports/${week2._id}`);
  assert.strictEqual(page.status, 200, JSON.stringify(page.json));
  assert.deepStrictEqual(page.json.report.earlierTotals, line);
  // The POST preview (the builder's on-screen state) reads it the same way.
  const posted = await call('POST', `/admin/client-reports/${week2._id}/preview`, { body: { title: 'On screen' } });
  assert.deepStrictEqual(posted.json.report.earlierTotals, line);
});
