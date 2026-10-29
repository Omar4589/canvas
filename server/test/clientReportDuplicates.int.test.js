import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// No accidental doubles — docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §E, contract K5 — against the real
// app and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/dupes node --test test/clientReportDuplicates.int.test.js
//
//   · the guard index: report_period_guard, unique on {seriesId, weekStart, weekEnd} and partial on
//     dupGuard: true, built at boot by an explicit createIndex — ClientReport is never synced;
//   · New report looks first: 409 REPORT_EXISTS names the report a tab already has for those dates (a
//     draft, a published one, a taken-down one); "Make a second one" (allowDuplicate) is let in, and
//     stays outside the guard;
//   · ten Creates of one period at the same moment make exactly one report: the others answer it
//     (200, existing: true, with its maker's name), and leave no build job and no History row;
//   · the guard index heals itself (code review round 1, SRV-1): guarded doubles that landed while it was
//     missing leave the guard — the first made keeps it — and it builds; any other failure is retried in
//     the background, a bounded number of times, never holding up boot.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-report-duplicates';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.CLIENT_REPORT_QUEUE_TIMEOUT_MS = '300';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { ClientReport, REPORT_PERIOD_GUARD } = await import('../src/models/ClientReport.js');
const { ClientReportSeries } = await import('../src/models/ClientReportSeries.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { processClientReportJob } = await import('../src/services/reports/clientReportBuilds.js');
const { syncClientReportIndexes, ensureReportPeriodGuard, isReportPeriodGuardError } = await import('../src/services/reports/clientReportIndexes.js');
const { getQueue, QUEUE_NAMES } = await import('../src/queues/index.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;

let server;
let base;
const ctx = {};
// Every build job the routes enqueue: the queue answers at once (no Redis), and each add is counted.
const enqueued = [];

const call = async (method, path, { body, as = ctx.ada } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${as.token}`, 'X-Org-Id': String(as.orgId) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};
const createReport = (body, as) => call('POST', '/admin/client-reports', { as, body: { campaignId: String(ctx.camp._id), ...body } });
const raw = (id) => ClientReport.collection.findOne({ _id: new ObjectId(String(id)) });
const runBuild = async (reportId) => {
  const jobId = new ObjectId().toHexString();
  await ClientReport.updateOne({ _id: reportId }, { $set: { 'build.status': 'queued', 'build.jobId': jobId, 'build.startedAt': new Date() } });
  const out = await processClientReportJob({ id: jobId, data: { reportId: String(reportId) }, moveToDelayed: async () => {}, updateProgress: async () => {} }, 'token');
  assert.ok(out?.committed, `the build committed: ${JSON.stringify(out)}`);
  return ClientReport.findById(reportId).lean();
};
const publish = async (id) => {
  const r = await runBuild(id);
  const res = await call('POST', `/admin/client-reports/${id}/publish`, { body: { snapshotId: String(r.snapshotId), editVersion: r.editVersion ?? 0 } });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
};
const createdRows = (ids) => CampaignChange.countDocuments({ field: 'clientReport.created', clientReportId: { $in: ids.map((id) => new ObjectId(String(id))) } });

// Hold every report insert until `n` requests have reached it, so all of them are past the look-first
// check before the first one lands — the race the guard index closes, every time, not by luck.
const holdInserts = (n) => {
  const realCreate = ClientReport.create;
  let arrived = 0;
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  const failSafe = setTimeout(() => open(), 10000);
  ClientReport.create = async function (...args) {
    arrived += 1;
    if (arrived >= n) open();
    await gate;
    return realCreate.apply(this, args);
  };
  return () => {
    clearTimeout(failSafe);
    ClientReport.create = realCreate;
    return arrived;
  };
};

before(async () => {
  if (!URI) return;
  mongoose.set('strictQuery', true); // as production's connectDb: an undeclared filter key is stripped
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  // Model.init() is memoized, so nothing rebuilds ClientReport's declared indexes after the drop; with
  // the integration preload (scripts/testIndexPreload.mjs) its first build has finished by now.
  await ClientReport.createIndexes();
  await ClientReportSeries.syncIndexes();
  getQueue(QUEUE_NAMES.CLIENT_REPORT).add = async (name, data, opts) => {
    enqueued.push({ reportId: String(data.reportId), jobId: String(opts.jobId) });
    return { id: opts.jobId };
  };

  const org = await Organization.create({ name: 'Dupes Org', slug: 'dupes-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const mk = async (first, last, role) => {
    const u = await User.create({ firstName: first, lastName: last, email: `${first.toLowerCase()}@dupes.t.co`, passwordHash: 'x', isActive: true });
    await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
    return u;
  };
  const ada = await mk('Ada', 'Lovelace', 'admin');
  const bo = await mk('Bo', 'Builder', 'admin');
  const lea = await mk('Lea', 'Lead', 'lead');
  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Dupes', isActive: true,
    questions: [{ key: 'support', label: 'Support?', type: 'single_choice', options: [{ id: 'y', text: 'Yes' }, { id: 'n', text: 'No' }] }],
  });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Dupes', type: 'survey', state: 'FL', isActive: true, surveyTemplateId: template._id, timeZone: 'America/Chicago' });
  await CampaignManager.create({ campaignId: camp._id, userId: lea._id, organizationId: org._id, grantedBy: ada._id });
  const north = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const hh = await Household.create({
    organizationId: org._id, campaignId: camp._id, isActive: true, addressLine1: '1 Dupe St', city: 'Tampa', state: 'FL', zipCode: '33601',
    normalizedAddress: 'DUPE1', location: { type: 'Point', coordinates: [-82.46, 27.95] },
  });
  await CanvassActivity.create({ organizationId: org._id, campaignId: camp._id, householdId: hh._id, userId: ada._id, actionType: 'not_home', timestamp: new Date('2026-07-08T17:00:00Z'), passId: new ObjectId(), location: { lat: 27.95, lng: -82.46 } });
  Object.assign(ctx, {
    org, camp, north, adaUser: ada, boUser: bo,
    ada: { token: signUserToken(ada), orgId: org._id },
    bo: { token: signUserToken(bo), orgId: org._id },
    lea: { token: signUserToken(lea), orgId: org._id },
  });

  // Boot, as server.js and worker.js run it — with the guard index missing first, so it is boot that
  // builds it (here autoIndex would have built it from the schema; production has autoIndex off).
  await ClientReport.init();
  await ClientReport.collection.dropIndex(REPORT_PERIOD_GUARD.options.name).catch(() => {});
  await ClientReport.collection.createIndex({ campaignId: 1, createdAt: -1 }, { name: 'built_by_hand_in_prod' });
  await syncClientReportIndexes('test');

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('the guard index: report_period_guard, unique, partial on dupGuard — built at boot, ClientReport never synced', { skip }, async () => {
  const indexes = await ClientReport.collection.indexes();
  const guard = indexes.find((i) => i.name === 'report_period_guard');
  assert.ok(guard, 'built at boot');
  assert.deepStrictEqual(guard.key, { seriesId: 1, weekStart: 1, weekEnd: 1 });
  assert.strictEqual(guard.unique, true);
  assert.deepStrictEqual(guard.partialFilterExpression, { dupGuard: true });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(REPORT_PERIOD_GUARD)), {
    keys: { seriesId: 1, weekStart: 1, weekEnd: 1 },
    options: { name: 'report_period_guard', unique: true, partialFilterExpression: { dupGuard: true } },
  });
  // createIndex never drops: an index production built by hand survives the boot step.
  assert.ok(indexes.some((i) => i.name === 'built_by_hand_in_prod'), 'syncIndexes never ran on ClientReport');
  // migrate:build-indexes' dry run (declared keys vs. built keys) lists nothing missing for it.
  const built = new Set(indexes.map((i) => JSON.stringify(i.key)));
  assert.ok(ClientReport.schema.indexes().some(([k]) => JSON.stringify(k) === JSON.stringify(guard.key)), 'declared, so --sync keeps it');
  assert.deepStrictEqual(ClientReport.schema.indexes().filter(([k]) => !built.has(JSON.stringify(k))), []);
  // dupGuard is a declared Boolean with NO default: absent = outside the guard.
  const path = ClientReport.schema.path('dupGuard');
  assert.ok(path, 'declared');
  assert.strictEqual(path.instance, 'Boolean');
  assert.strictEqual(path.defaultValue, undefined);
  // Booting again is harmless.
  await syncClientReportIndexes('test-again');
  assert.strictEqual((await ClientReport.collection.indexes()).filter((i) => i.name === 'report_period_guard').length, 1);

  // Outside the guard: reports without dupGuard (every report before it), twins included.
  const series = new ObjectId();
  const doc = () => ({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, seriesId: series, scope: { kind: 'campaign', label: 'Whole campaign' },
    weekStart: '2026-05-04', weekEnd: '2026-05-10', timeZone: 'America/Chicago',
    rangeStartUtc: new Date('2026-05-04T05:00:00Z'), rangeEndUtc: new Date('2026-05-11T05:00:00Z'), status: 'draft',
  });
  await ClientReport.create(doc());
  await ClientReport.create(doc());
  await ClientReport.create({ ...doc(), dupGuard: true });
  const err = await ClientReport.create({ ...doc(), dupGuard: true }).then(() => null, (e) => e);
  assert.ok(isReportPeriodGuardError(err), `a second guarded one is refused by the index: ${err?.message}`);
  assert.strictEqual(err.code, 11000);
  assert.ok(String(err.message).includes('report_period_guard'));
  assert.strictEqual(await ClientReport.countDocuments({ seriesId: series }), 3);
  await ClientReport.deleteMany({ seriesId: series });
});

test('New report looks first: REPORT_EXISTS names the draft, the published report, the taken-down one; Make a second one stays outside the guard', { skip }, async () => {
  const period = { weekStart: '2026-07-06', weekEnd: '2026-07-12' };
  const first = await createReport(period);
  assert.strictEqual(first.status, 201, JSON.stringify(first.json));
  const firstId = first.json.report._id;
  assert.strictEqual((await raw(firstId)).dupGuard, true, 'a plain create is guarded');

  let res = await createReport(period);
  assert.strictEqual(res.status, 409);
  assert.deepStrictEqual(res.json, {
    error: 'You already have a draft Whole campaign report for Jul 6 – Jul 12, 2026.',
    code: 'REPORT_EXISTS',
    reportId: firstId,
    status: 'draft',
    takenDown: false,
    archivedAt: null, // not archived (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C4: clientReportArchive.int.test.js)
    weekStart: '2026-07-06',
    weekEnd: '2026-07-12',
    allTime: false, // a dated report (an all-time one is named by its last day: clientReportAllTime.int.test.js)
    scopeLabel: 'Whole campaign',
  });
  // A lead of the campaign is told the same.
  res = await createReport(period, ctx.lea);
  assert.deepStrictEqual([res.status, res.json.code, res.json.reportId], [409, 'REPORT_EXISTS', firstId]);

  // Make a second one: let in, and outside the guard (no dupGuard at all).
  const second = await createReport({ ...period, allowDuplicate: true });
  assert.strictEqual(second.status, 201, JSON.stringify(second.json));
  assert.ok(!('dupGuard' in (await raw(second.json.report._id))), 'a deliberate second one carries no dupGuard');
  // Two drafts: the newest is named.
  res = await createReport(period);
  assert.deepStrictEqual([res.status, res.json.reportId], [409, second.json.report._id]);

  // Published (the second deleted): named, with the Refresh numbers hint.
  await publish(firstId);
  assert.strictEqual((await call('DELETE', `/admin/client-reports/${second.json.report._id}`)).status, 200);
  res = await createReport(period);
  assert.strictEqual(res.status, 409);
  assert.deepStrictEqual([res.json.reportId, res.json.status, res.json.takenDown], [firstId, 'published', false]);
  assert.strictEqual(res.json.error, 'You already published a Whole campaign report for Jul 6 – Jul 12, 2026. To bring its numbers up to date, open it and press Refresh numbers.');
  // Taken down.
  assert.strictEqual((await call('POST', `/admin/client-reports/${firstId}/take-down`)).status, 200);
  res = await createReport(period);
  assert.deepStrictEqual([res.json.reportId, res.json.status, res.json.takenDown], [firstId, 'published', true]);
  assert.strictEqual(res.json.error, 'You already published a Whole campaign report for Jul 6 – Jul 12, 2026, taken down.');

  // Another tab, or other dates: no clash.
  const walk = await createReport({ ...period, effortId: String(ctx.north._id) });
  assert.strictEqual(walk.status, 201, JSON.stringify(walk.json));
  assert.strictEqual((await raw(walk.json.report._id)).dupGuard, true);
  res = await createReport({ ...period, effortId: String(ctx.north._id) });
  assert.deepStrictEqual([res.status, res.json.scopeLabel, res.json.reportId], [409, 'North', walk.json.report._id]);
  assert.match(res.json.error, /^You already have a draft North report for /);
  const later = await createReport({ weekStart: '2026-07-13', weekEnd: '2026-07-19' });
  assert.strictEqual(later.status, 201);
  // Same start, other end: another period.
  assert.strictEqual((await createReport({ weekStart: '2026-07-13', weekEnd: '2026-07-26' })).status, 201);

  // Deleting a report frees its dates.
  assert.strictEqual((await call('DELETE', `/admin/client-reports/${firstId}`)).status, 200);
  const again = await createReport(period);
  assert.strictEqual(again.status, 201, JSON.stringify(again.json));
  assert.strictEqual((await raw(again.json.report._id)).dupGuard, true);
});

test('ten Creates of one period at the same moment make ONE report; the rest answer it with its maker’s name — no orphan job or History row', { skip }, async () => {
  const period = { weekStart: '2026-08-03', weekEnd: '2026-08-09' };
  const jobsBefore = enqueued.length;
  const release = holdInserts(10);
  let results;
  try {
    results = await Promise.all(Array.from({ length: 10 }, (_, i) => createReport(period, i % 2 ? ctx.bo : ctx.ada)));
  } finally {
    assert.strictEqual(release(), 10, 'all ten were past the look-first check, at the insert');
  }
  const made = results.filter((r) => r.status === 201);
  const answered = results.filter((r) => r.status === 200);
  assert.strictEqual(made.length, 1, JSON.stringify(results.map((r) => [r.status, r.json?.code])));
  assert.strictEqual(answered.length, 9);
  const winner = made[0].json.report;
  const stored = await ClientReport.find({ campaignId: ctx.camp._id, ...period }).lean();
  assert.deepStrictEqual(stored.map((r) => String(r._id)), [String(winner._id)], 'exactly one report');
  assert.strictEqual(stored[0].dupGuard, true);
  const maker = String(winner.createdBy) === String(ctx.adaUser._id) ? 'Ada Lovelace' : 'Bo Builder';
  for (const r of answered) {
    assert.strictEqual(r.json.existing, true);
    assert.strictEqual(String(r.json.report._id), String(winner._id));
    assert.strictEqual(r.json.createdByName, maker, '"Ada made this report a moment ago — you’re both in it."');
    assert.ok(r.json.build && r.json.build.status, 'the build rides along, as on a 201');
  }
  // One build job — the winner's — and one "created" History row.
  const jobs = enqueued.slice(jobsBefore);
  assert.deepStrictEqual(jobs.map((j) => j.reportId), [String(winner._id)]);
  assert.strictEqual(jobs[0].jobId, String(stored[0].build.jobId));
  assert.strictEqual(await createdRows([winner._id]), 1);
  assert.strictEqual(await CampaignChange.countDocuments({ campaignId: ctx.camp._id, field: 'clientReport.created', periodLabel: 'Aug 3 – Aug 9, 2026' }), 1);
});

test('Creates at the same moment without holding them: still one report per period, and every other answer names it', { skip }, async () => {
  for (const [weekStart, weekEnd] of [['2026-08-10', '2026-08-16'], ['2026-08-17', '2026-08-23'], ['2026-08-24', '2026-08-30'], ['2026-08-31', '2026-09-06'], ['2026-09-07', '2026-09-13']]) {
    const jobsBefore = enqueued.length;
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => createReport({ weekStart, weekEnd }, i % 2 ? ctx.bo : ctx.ada)));
    const stored = await ClientReport.find({ campaignId: ctx.camp._id, weekStart, weekEnd }, { _id: 1 }).lean();
    assert.strictEqual(stored.length, 1, `${weekStart}: ${JSON.stringify(results.map((r) => [r.status, r.json?.code]))}`);
    const id = String(stored[0]._id);
    assert.strictEqual(results.filter((r) => r.status === 201).length, 1);
    for (const r of results.filter((x) => x.status !== 201)) {
      // Past the look-first: the winner's draft. Before it: REPORT_EXISTS naming that draft.
      if (r.status === 200) assert.deepStrictEqual([r.json.existing, String(r.json.report._id)], [true, id]);
      else assert.deepStrictEqual([r.status, r.json.code, r.json.reportId], [409, 'REPORT_EXISTS', id]);
    }
    assert.deepStrictEqual(enqueued.slice(jobsBefore).map((j) => j.reportId), [id]);
    assert.strictEqual(await createdRows([id]), 1);
  }
});

test('Make a second one, pressed at the same moment, is never guarded: each is its own report', { skip }, async () => {
  const period = { weekStart: '2026-09-14', weekEnd: '2026-09-20', allowDuplicate: true };
  const results = await Promise.all([createReport(period), createReport(period, ctx.bo), createReport(period)]);
  assert.deepStrictEqual(results.map((r) => r.status), [201, 201, 201]);
  const stored = await ClientReport.collection.find({ campaignId: ctx.camp._id, weekStart: '2026-09-14' }).toArray();
  assert.strictEqual(stored.length, 3);
  assert.ok(stored.every((r) => !('dupGuard' in r)));
  // And New report then names one of them.
  const res = await createReport({ weekStart: '2026-09-14', weekEnd: '2026-09-20' });
  assert.deepStrictEqual([res.status, res.json.code], [409, 'REPORT_EXISTS']);
  assert.ok(stored.some((r) => String(r._id) === res.json.reportId));
});

test('a lost race whose winner is deleted at that very moment makes its own report, once', { skip }, async () => {
  const period = { weekStart: '2026-09-21', weekEnd: '2026-09-27' };
  const series = await ClientReportSeries.findOne({ campaignId: ctx.camp._id, kind: 'campaign' }).lean();
  // The winner: a guarded draft that landed after this request looked (the look-first is made to miss
  // it), and is deleted just before this request reads it back.
  const winner = await ClientReport.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, seriesId: series._id, scope: { kind: 'campaign', label: 'Whole campaign' },
    ...period, timeZone: 'America/Chicago', rangeStartUtc: new Date('2026-09-21T05:00:00Z'), rangeEndUtc: new Date('2026-09-28T05:00:00Z'),
    status: 'draft', dupGuard: true, createdBy: ctx.boUser._id,
  });
  const realFind = ClientReport.find;
  const realFindOne = ClientReport.findOne;
  ClientReport.find = function (filter, ...rest) {
    if (filter?.weekStart === period.weekStart) {
      ClientReport.find = realFind;
      return { lean: async () => [] };
    }
    return realFind.call(this, filter, ...rest);
  };
  ClientReport.findOne = function (filter, ...rest) {
    if (filter?.dupGuard === true && filter.weekStart === period.weekStart) {
      ClientReport.findOne = realFindOne;
      return { lean: async () => { await ClientReport.deleteOne({ _id: winner._id }); return null; } };
    }
    return realFindOne.call(this, filter, ...rest);
  };
  const jobsBefore = enqueued.length;
  let res;
  try {
    res = await createReport(period);
  } finally {
    ClientReport.find = realFind;
    ClientReport.findOne = realFindOne;
  }
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  const stored = await ClientReport.find({ campaignId: ctx.camp._id, ...period }).lean();
  assert.deepStrictEqual(stored.map((r) => String(r._id)), [String(res.json.report._id)], 'the key was free again: one report, this one');
  assert.strictEqual(stored[0].dupGuard, true);
  assert.strictEqual(String(stored[0].createdBy), String(ctx.adaUser._id));
  assert.deepStrictEqual(enqueued.slice(jobsBefore).map((j) => j.reportId), [String(res.json.report._id)]);
  assert.strictEqual(await createdRows([res.json.report._id]), 1);
});

// ── The guard heals itself (code review round 1, SRV-1) ────────────────────────────────────────────
// While report_period_guard is missing (its boot build failed), two guarded creates can land at the same
// instant — and their shared key then failed every later build, so the guard stayed off for good.

// Runs fn(lines) with every console line collected instead of printed; returns the lines.
const quietLogs = async (fn) => {
  const lines = [];
  const real = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(real)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  try {
    await fn(lines);
  } finally {
    Object.assign(console, real);
  }
  return lines;
};
const until = async (check, ms = 5000) => {
  for (const t0 = Date.now(); !(await check()); ) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 10));
  }
  return true;
};
const guardIndex = async () => (await ClientReport.collection.indexes()).find((i) => i.name === REPORT_PERIOD_GUARD.options.name);

test('the guard index heals itself: guarded doubles from a window without it leave the guard — the first made keeps it — and it builds', { skip }, async () => {
  const series = await ClientReportSeries.findOne({ campaignId: ctx.camp._id, kind: 'campaign', endedAt: null }).lean();
  await ClientReport.collection.dropIndex(REPORT_PERIOD_GUARD.options.name);
  const at = (s) => new Date(Date.UTC(2026, 9, 1, 12, 0, s));
  const doc = (weekStart, weekEnd, extra = {}) => ({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, seriesId: series._id, scope: { kind: 'campaign', label: 'Whole campaign' },
    weekStart, weekEnd, timeZone: 'America/Chicago', status: 'draft', dupGuard: true, ...extra,
  });
  // Landed raw, as the doubles did. The first made of each key: the pair's older (published) one; the
  // trio's oldest, inserted last; of two made at the same instant, the smaller _id. A missing tab and a
  // null one share the index's key. A legacy twin (no dupGuard) is outside the guard and stays so.
  const legacyTwin = doc('2026-10-05', '2026-10-11', { createdAt: at(0) });
  delete legacyTwin.dupGuard;
  const noTab = doc('2026-11-02', '2026-11-08', { createdAt: at(9) });
  delete noTab.seriesId;
  const rows = [
    doc('2026-10-05', '2026-10-11', { status: 'published', createdAt: at(1) }),
    doc('2026-10-05', '2026-10-11', { createdAt: at(2) }),
    legacyTwin,
    doc('2026-10-12', '2026-10-18', { createdAt: at(5) }),
    doc('2026-10-12', '2026-10-18', { createdAt: at(4) }),
    doc('2026-10-12', '2026-10-18', { createdAt: at(3) }),
    doc('2026-10-19', '2026-10-25', { createdAt: at(6) }),
    doc('2026-10-19', '2026-10-25', { createdAt: at(6) }),
    doc('2026-11-02', '2026-11-08', { seriesId: null, createdAt: at(8) }),
    noTab,
  ];
  const ids = Object.values((await ClientReport.collection.insertMany(rows)).insertedIds);
  const [pairFirst, pairSecond, legacy, trioNewest, trioMiddle, trioFirst, sameFirst, sameSecond, nullTab, missingTab] = ids;

  // Two dynos booting at the same moment: both build it, healing the same way.
  let results;
  const lines = await quietLogs(async () => {
    results = await Promise.all([ensureReportPeriodGuard('test-web'), ensureReportPeriodGuard('test-worker')]);
  });
  assert.deepStrictEqual(results, [true, true], lines.join('\n'));
  const idx = await guardIndex();
  assert.ok(idx?.unique && idx.partialFilterExpression?.dupGuard === true, 'built');
  assert.ok(lines.some((l) => /report_period_guard: a duplicate key failed the build; 5 report\(s\) sharing a tab and dates/.test(l)), lines.join('\n'));
  const raw = new Map((await ClientReport.collection.find({ _id: { $in: ids } }).toArray()).map((r) => [String(r._id), r]));
  assert.strictEqual(raw.size, ids.length, 'every report is still there');
  for (const id of [pairFirst, trioFirst, sameFirst, nullTab]) assert.strictEqual(raw.get(String(id)).dupGuard, true, 'the first made keeps the guard');
  for (const id of [pairSecond, trioNewest, trioMiddle, sameSecond, missingTab, legacy]) {
    assert.ok(!('dupGuard' in raw.get(String(id))), 'an ordinary second report: no dupGuard at all');
  }

  // New report's look-first still finds them (the pair's draft is named), and the guard holds again.
  const res = await createReport({ weekStart: '2026-10-05', weekEnd: '2026-10-11' });
  assert.deepStrictEqual([res.status, res.json.code, res.json.reportId], [409, 'REPORT_EXISTS', String(pairSecond)]);
  const err = await ClientReport.collection.insertOne(doc('2026-10-19', '2026-10-25', { createdAt: new Date() })).then(() => null, (e) => e);
  assert.ok(isReportPeriodGuardError(err), 'a new guarded double is refused');
  // Healed, the next boot is quiet.
  const again = await quietLogs(async () => assert.strictEqual(await ensureReportPeriodGuard('test-again'), true));
  assert.deepStrictEqual(again, []);
  await ClientReport.collection.deleteMany({ _id: { $in: ids } });
});

test('any other build failure is retried in the background — each retry healing too, a bounded number of them — never holding up boot', { skip }, async () => {
  const col = ClientReport.collection;
  const realCreateIndex = col.createIndex;
  let calls = 0;
  let failures = 0;
  // A failover: createIndexes answers PrimarySteppedDown `failures` times, then works.
  col.createIndex = async function (...args) {
    calls += 1;
    if (calls <= failures) throw Object.assign(new Error('not primary'), { code: 189, codeName: 'PrimarySteppedDown' });
    return realCreateIndex.apply(this, args);
  };
  const series = new ObjectId();
  try {
    await col.dropIndex(REPORT_PERIOD_GUARD.options.name);
    failures = 2;
    let lines = await quietLogs(async (seen) => {
      const t0 = Date.now();
      assert.strictEqual(await ensureReportPeriodGuard('test', { retryDelaysMs: [20, 20, 20] }), false, 'not built yet — boot carries on');
      assert.ok(Date.now() - t0 < 1000, 'the retries never hold up the caller');
      assert.ok(await until(() => seen.some((l) => /index built on retry 2/.test(l))), seen.join('\n'));
    });
    assert.strictEqual(calls, 3);
    assert.ok((await guardIndex())?.unique, 'built in the background');
    assert.match(lines[0], /report_period_guard index failed — retry 1 of 3 in 0\.02 s: not primary/);

    // Guarded doubles land while it is missing: the retry heals them, as the boot build does.
    await col.dropIndex(REPORT_PERIOD_GUARD.options.name);
    const twins = [1, 2].map((s) => ({ organizationId: ctx.org._id, campaignId: ctx.camp._id, seriesId: series, weekStart: '2026-12-07', weekEnd: '2026-12-13', status: 'draft', dupGuard: true, createdAt: new Date(Date.UTC(2026, 9, 2, 0, 0, s)) }));
    const [older, newer] = Object.values((await col.insertMany(twins)).insertedIds);
    calls = 0;
    failures = 1;
    lines = await quietLogs(async (seen) => {
      assert.strictEqual(await ensureReportPeriodGuard('test', { retryDelaysMs: [20] }), false);
      assert.ok(await until(() => seen.some((l) => /index built on retry 1/.test(l))), seen.join('\n'));
    });
    assert.ok(lines.some((l) => /a duplicate key failed the build; 1 report\(s\)/.test(l)), lines.join('\n'));
    assert.strictEqual((await col.findOne({ _id: older })).dupGuard, true);
    assert.ok(!('dupGuard' in (await col.findOne({ _id: newer }))));

    // Failing every time: one try and three retries, then it stops until the next boot.
    await col.dropIndex(REPORT_PERIOD_GUARD.options.name);
    calls = 0;
    failures = Infinity;
    lines = await quietLogs(async (seen) => {
      assert.strictEqual(await ensureReportPeriodGuard('test', { retryDelaysMs: [10, 10, 10] }), false);
      assert.ok(await until(() => seen.some((l) => /no retries left; the next boot tries again/.test(l))), seen.join('\n'));
      await new Promise((r) => setTimeout(r, 100));
    });
    assert.strictEqual(calls, 4, `bounded: ${lines.join('\n')}`);
    assert.strictEqual(await guardIndex(), undefined);
  } finally {
    col.createIndex = realCreateIndex;
    await col.deleteMany({ seriesId: series });
  }
  // Built again for whatever runs after.
  assert.strictEqual(await ensureReportPeriodGuard('test'), true);
  assert.ok((await guardIndex())?.unique);
});
