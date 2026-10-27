import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Latest progress — all-time reports (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §N), against the real app
// and a throwaway mongod:
//   npm run test:int -- test/clientReportAllTime.int.test.js
//
// An all-time report starts on the day of the campaign's first knock in its zone, whatever first day is
// sent, and never after its last day; the duplicate guard names it by its last day; Next on it makes the
// next one through today with its settings and notes, answers the one already made, and refuses when it
// already runs through today or a newer one is in the tab; a dated report's Next never counts it as a
// later report; its build's period IS its running total, compared with the latest shown report ending by
// its last day, and the one-report form of that line names the day after that report; and every list —
// the admin list, the client's hub, its Older / Newer — goes by the last day. "Today" is the real clock
// in the through-today cases, which re-run once if the campaign zone's day turns while they run.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-client-report-all-time';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.CLIENT_REPORT_QUEUE_TIMEOUT_MS = '300';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ClientReportSeries } = await import('../src/models/ClientReportSeries.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { processClientReportJob } = await import('../src/services/reports/clientReportBuilds.js');
const { ensureSeries } = await import('../src/services/reports/clientReportSeries.js');
const { ensureReportPeriodGuard, ensureAllTimeGuard, isReportPeriodGuardError } = await import('../src/services/reports/clientReportIndexes.js');
const { getQueue, QUEUE_NAMES } = await import('../src/queues/index.js');
const { zonedDayRange, zonedDayStr } = await import('../src/utils/timezone.js');
const { addDays } = await import('../src/services/reports/goalProgress.js');
const P = await import('../src/services/reports/reportPeriods.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;
const TZ = 'America/Chicago';
const PASSWORD = 'all-time-password';

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

const zoneDay = () => zonedDayStr(new Date(), TZ);
// Runs fn(today); if it fails and the zone's day turned meanwhile, once more on the new day.
const onToday = async (fn) => {
  const day = zoneDay();
  try {
    await fn(day);
  } catch (err) {
    if (zoneDay() === day) throw err;
    await fn(zoneDay());
  }
};

let campN = 0;
const newCampaign = async (name) => {
  campN += 1;
  return Campaign.create({
    organizationId: ctx.org._id, name: `${name} ${campN}`, type: 'survey', state: 'FL', isActive: true,
    surveyTemplateId: ctx.template._id, timeZone: TZ,
  });
};
const tabOf = (camp) => ensureSeries({ organizationId: ctx.org._id, campaignId: camp._id, kind: 'campaign' });
// A published report put straight in the tab (its numbers don't matter to the route under test).
const reportIn = async (camp, series, weekStart, weekEnd, extra = {}) => {
  const range = zonedDayRange(weekStart, weekEnd, TZ);
  const doc = await ClientReport.create({
    organizationId: ctx.org._id, campaignId: camp._id, campaignType: 'survey', seriesId: series._id,
    scope: { kind: 'campaign', label: 'Whole campaign' }, weekStart, weekEnd, timeZone: TZ,
    rangeStartUtc: range.$gte, rangeEndUtc: range.$lt, status: 'published', publishedAt: new Date(),
    visibility: { visibleQuestionKeys: [], mapAnswerKeys: [], showMap: false }, ...extra,
  });
  return doc.toObject();
};
const next = (r) => call('POST', `/admin/client-reports/${r._id}/next`);
const create = (body) => call('POST', '/admin/client-reports', { body });

let hhN = 0;
const household = async (camp) => {
  hhN += 1;
  return Household.create({
    organizationId: ctx.org._id, campaignId: camp._id, isActive: true,
    addressLine1: `${hhN} All Time St`, city: 'Tampa', state: 'FL', zipCode: '33601', normalizedAddress: `ALLTIME${hhN}`,
    location: { type: 'Point', coordinates: [-82.46 + hhN / 1e4, 27.95] },
  });
};
const entry = (camp, hh, actionType, timestamp) =>
  CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, userId: ctx.adminUser._id,
    actionType, timestamp, passId: ctx.pass, location: { lat: 27.95, lng: -82.46 },
  });
// Noon in Chicago (CDT, UTC-5) on a July day.
const at = (day) => new Date(`${day}T12:00:00-05:00`);
let vN = 0;
const surveyedDoor = async (camp, when, support) => {
  const hh = await household(camp);
  await entry(camp, hh, 'survey_submitted', when);
  vN += 1;
  const v = await Voter.create({ organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, stateVoterId: `AT${vN}`, firstName: 'A', lastName: `T${vN}`, fullName: `A T${vN}` });
  await SurveyResponse.create({
    organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, voterId: v._id, userId: ctx.adminUser._id,
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
const publish = async (r) => {
  const res = await call('POST', `/admin/client-reports/${r._id}/publish`, { body: { snapshotId: String(r.snapshotId), editVersion: r.editVersion ?? 0 } });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  return ClientReport.findById(r._id).lean();
};
const made = async (camp, body) => {
  const res = await create({ campaignId: String(camp._id), ...body });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  return publish(await runBuild(res.json.report._id));
};

// A link through the real route, unlocked.
let ipN = 0;
const linkFor = async (camp, { label, reportId } = {}) => {
  const res = await call('POST', '/admin/client-reports/shares', {
    body: { campaignId: String(camp._id), label, password: PASSWORD, ...(reportId ? { reportId: String(reportId) } : {}) },
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  ipN += 1;
  const unlock = await call('POST', `/share/${res.json.share.token}/unlock`, { as: null, body: { password: PASSWORD }, headers: { 'X-Forwarded-For': `10.9.${ipN >> 8}.${ipN & 255}` } });
  assert.strictEqual(unlock.status, 200, JSON.stringify(unlock.json));
  return { ...res.json.share, access: unlock.json.accessToken };
};
const pub = (link, path) => call('GET', `/share/${link.token}${path}`, { as: null, headers: { 'X-Share-Token': link.access } });

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

  const org = await Organization.create({ name: 'All Time Org', slug: 'all-time-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const adminUser = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ada@all-time.t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: adminUser._id, organizationId: org._id, role: 'admin', isActive: true });
  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'All time', isActive: true,
    questions: [{ key: 'support', label: 'Support?', type: 'single_choice', options: [{ id: 'y', text: 'Yes' }, { id: 'n', text: 'No' }] }],
  });
  Object.assign(ctx, { org, adminUser, template, pass: new ObjectId(), admin: { token: signUserToken(adminUser), orgId: org._id } });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('an all-time report starts on the campaign’s first knock — in its zone, whatever first day is sent — and never after its last day', { skip }, async () => {
  const camp = await newCampaign('Starts');
  const hh = await household(camp);
  // Not knocks — a restricted door and a note, before the first knock — never decide where it starts.
  await entry(camp, hh, 'restricted', new Date('2026-06-01T17:00:00Z'));
  await entry(camp, hh, 'note_added', new Date('2026-06-02T17:00:00Z'));
  // The first knock: 11:30 pm on Jun 15 in Chicago, already Jun 16 in UTC.
  await entry(camp, hh, 'not_home', new Date('2026-06-16T04:30:00Z'));
  await entry(camp, hh, 'refused', new Date('2026-06-20T17:00:00Z'));
  await onToday(async (today) => {
    await ClientReport.deleteMany({ campaignId: camp._id });
    const res = await create({ campaignId: String(camp._id), allTime: true, weekStart: '2001-01-01', weekEnd: today });
    assert.strictEqual(res.status, 201, JSON.stringify(res.json));
    const r = res.json.report;
    assert.deepStrictEqual([r.allTime, r.weekStart, r.weekEnd], [true, '2026-06-15', today], 'the zone’s day of the first knock, never the day sent');
    assert.strictEqual(new Date(r.rangeStartUtc).toISOString(), zonedDayRange('2026-06-15', today, TZ).$gte.toISOString());
    assert.deepStrictEqual(res.json.warnings, [], 'never “starts after today”');
    // Everything up to a day before the first knock: it starts on that day.
    const early = await create({ campaignId: String(camp._id), allTime: true, weekEnd: '2026-06-10' });
    assert.strictEqual(early.status, 201, JSON.stringify(early.json));
    assert.deepStrictEqual([early.json.report.weekStart, early.json.report.weekEnd], ['2026-06-10', '2026-06-10']);
    // The list says which reports are all-time, newest last day first.
    const list = await call('GET', `/admin/client-reports?campaignId=${camp._id}`);
    assert.deepStrictEqual(list.json.reports.map((x) => [x.weekEnd, x.allTime]), [[today, true], ['2026-06-10', true]]);
  });
  // A campaign nobody has knocked on: today, or its last day when that is earlier.
  const quiet = await newCampaign('Quiet');
  await onToday(async (today) => {
    await ClientReport.deleteMany({ campaignId: quiet._id });
    const a = await create({ campaignId: String(quiet._id), allTime: true, weekEnd: today });
    assert.deepStrictEqual([a.json.report.weekStart, a.json.report.weekEnd], [today, today]);
    const yesterday = addDays(today, -1);
    const b = await create({ campaignId: String(quiet._id), allTime: true, weekEnd: yesterday });
    assert.deepStrictEqual([b.json.report.weekStart, b.json.report.weekEnd], [yesterday, yesterday]);
  });
  // A dated report still needs its first day.
  const bad = await create({ campaignId: String(camp._id), weekEnd: '2026-07-01' });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.json.error, /weekStart is required/);
});

test('the duplicate guard names an all-time report by its last day; a dated report ending that day is another report', { skip }, async () => {
  const camp = await newCampaign('Twice');
  const body = { campaignId: String(camp._id), allTime: true, weekEnd: '2026-07-19' };
  const first = await create(body);
  assert.strictEqual(first.status, 201, JSON.stringify(first.json));
  const again = await create(body);
  assert.strictEqual(again.status, 409, JSON.stringify(again.json));
  assert.strictEqual(again.json.code, 'REPORT_EXISTS');
  assert.strictEqual(again.json.allTime, true);
  assert.strictEqual(again.json.reportId, String(first.json.report._id));
  assert.strictEqual(again.json.error, 'You already have a draft all-time Whole campaign report through Jul 19, 2026.');
  const dated = await create({ campaignId: String(camp._id), weekStart: '2026-07-13', weekEnd: '2026-07-19' });
  assert.strictEqual(dated.status, 201, JSON.stringify(dated.json));
  assert.ok(!dated.json.report.allTime);
  // Make a second one: on purpose, outside the guard.
  const second = await create({ ...body, allowDuplicate: true });
  assert.strictEqual(second.status, 201, JSON.stringify(second.json));
});

test('Next on an all-time report: the next one through today, its settings and notes copied — answered once made, refused when it runs through today', { skip }, async () => {
  await onToday(async (today) => {
    const camp = await newCampaign('Next');
    const series = await tabOf(camp);
    await entry(camp, await household(camp), 'not_home', new Date('2026-06-16T04:30:00Z')); // Jun 15 in Chicago
    const source = await reportIn(camp, series, '2026-06-15', addDays(today, -1), {
      allTime: true,
      observations: [{ heading: 'Voter intent', body: 'Warm' }],
      visibility: { visibleQuestionKeys: ['support'], mapAnswerKeys: [], showMap: false, visibleTags: [], showGoal: false },
      supportQuestionKey: 'support',
    });
    const res = await next(source);
    assert.strictEqual(res.status, 201, JSON.stringify(res.json));
    const made1 = res.json.report;
    assert.deepStrictEqual([made1.allTime, made1.weekStart, made1.weekEnd], [true, '2026-06-15', today]);
    assert.deepStrictEqual(made1.observations.map((o) => [o.heading, o.body]), [['Voter intent', 'Warm']]);
    assert.strictEqual(String(made1.copiedFrom.reportId), String(source._id));
    assert.deepStrictEqual(made1.visibility.visibleQuestionKeys, ['support']);
    assert.strictEqual(made1.supportQuestionKey, 'support');
    assert.deepStrictEqual(res.json.warnings, []);
    assert.strictEqual(String((await ClientReport.findById(source._id).lean()).nextReportId), String(made1._id));
    // A second click answers the same report.
    const again = await next(source);
    assert.strictEqual(again.status, 200, JSON.stringify(again.json));
    assert.deepStrictEqual([String(again.json.report._id), again.json.existing], [String(made1._id), true]);
    // An older all-time report answers the one Next would make — it is already there.
    const older = await reportIn(camp, series, '2026-06-15', addDays(today, -3), { allTime: true });
    const answered = await next(older);
    assert.strictEqual(answered.status, 200, JSON.stringify(answered.json));
    assert.strictEqual(String(answered.json.report._id), String(made1._id));
    // One that runs through today is brought up to date by Refresh numbers, never followed.
    const through = await next(made1);
    assert.strictEqual(through.status, 409, JSON.stringify(through.json));
    assert.strictEqual(through.json.code, 'ALREADY_THROUGH_TODAY');
    assert.strictEqual(through.json.error, 'This report already runs through today — press Refresh numbers to bring it up to date.');
  });
});

test('Next on an all-time report with a newer all-time one in the tab is refused; a dated report’s Next never counts all-time reports as later ones', { skip }, async () => {
  await onToday(async (today) => {
    const camp = await newCampaign('Kinds');
    const series = await tabOf(camp);
    const older = await reportIn(camp, series, '2026-06-15', addDays(today, -5), { allTime: true });
    await reportIn(camp, series, '2026-06-15', addDays(today, -3), { allTime: true });
    const stale = await next(older);
    assert.strictEqual(stale.status, 409, JSON.stringify(stale.json));
    assert.strictEqual(stale.json.code, 'NOT_LATEST_REPORT');
    // The tab's newest dated report, with all-time reports beside it — one starting only today (nobody had
    // knocked when it was made), after the dated one ends: Next follows the dated report.
    const lw = P.lastWeek(today, 1);
    const dated = await reportIn(camp, series, lw.weekStart, lw.weekEnd);
    await reportIn(camp, series, today, today, { allTime: true });
    const res = await next(dated);
    assert.strictEqual(res.status, 201, JSON.stringify(res.json));
    assert.strictEqual(res.json.report.weekStart, addDays(lw.weekEnd, 1));
    assert.ok(!res.json.report.allTime);
  });
});

test('an all-time report’s build: its period IS its running total; it compares with the latest shown report ending by its last day; every list goes by the last day', { skip }, async () => {
  const camp = await newCampaign('July');
  await surveyedDoor(camp, at('2026-07-01'), 'Yes');
  await surveyedDoor(camp, at('2026-07-08'), 'No');
  const w1 = await made(camp, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
  assert.strictEqual(w1.stats.cumulative.totals.doorsKnocked, 2);
  // A door from week 1 that arrives late, and one in the week after.
  await surveyedDoor(camp, at('2026-07-10'), 'Yes');
  await surveyedDoor(camp, at('2026-07-15'), 'No');
  const all = await made(camp, { allTime: true, weekEnd: '2026-07-19' });
  assert.deepStrictEqual([all.allTime, all.weekStart, all.weekEnd], [true, '2026-07-01', '2026-07-19']);
  assert.strictEqual(all.stats.cumulative.totals.doorsKnocked, 4);
  assert.deepStrictEqual(all.stats.period.totals, all.stats.cumulative.totals, 'its period is its running total');
  assert.strictEqual(String(all.comparedReportId), String(w1._id), 'the latest shown report ending by its last day');
  assert.strictEqual(all.earlierTotals.doorsKnocked, 3, 'week 1 recounted with its late door');
  // Who made the knocks, frozen for the builder's one-canvasser check (internal: never on the client's page).
  assert.deepStrictEqual([all.stats.cumulative.provenance.canvassers, all.stats.period.provenance.canvassers], [1, 1]);

  // The admin list: newest last day first (by the first day, the all-time report would sink).
  const list = await call('GET', `/admin/client-reports?campaignId=${camp._id}`);
  assert.deepStrictEqual(list.json.reports.map((r) => [r.id, r.allTime]), [[String(all._id), true], [String(w1._id), false]]);

  // The client's hub, its Older / Newer, and the earlier-totals line naming week 1.
  const link = await linkFor(camp, { label: 'Client' });
  const hub = await pub(link, '/reports');
  assert.strictEqual(hub.status, 200, JSON.stringify(hub.json));
  assert.deepStrictEqual(hub.json.reports.map((r) => [r.id, r.allTime]), [[String(all._id), true], [String(w1._id), false]]);
  const page = await pub(link, `/reports/${all._id}`);
  assert.strictEqual(page.status, 200, JSON.stringify(page.json));
  assert.strictEqual(page.json.report.allTime, true);
  assert.ok(!('provenance' in page.json.report.stats.cumulative), 'the canvasser count never reaches the client');
  assert.deepStrictEqual(page.json.report.nav, { olderId: String(w1._id), newerId: null });
  assert.deepStrictEqual(page.json.report.earlierTotals.since, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
  assert.deepStrictEqual(page.json.report.earlierTotals.changes.find((c) => c.card === 'doorsKnocked'), { card: 'doorsKnocked', delta: 1 });
  const weekPage = await pub(link, `/reports/${w1._id}`);
  assert.deepStrictEqual(weekPage.json.report.nav, { olderId: null, newerId: String(all._id) });

  // On a link to just the all-time report: the same counts, through week 1's last day.
  const one = await linkFor(camp, { label: 'Board', reportId: all._id });
  const onePage = await pub(one, `/reports/${all._id}`);
  assert.strictEqual(onePage.status, 200, JSON.stringify(onePage.json));
  assert.strictEqual(onePage.json.report.earlierTotals.since, null);
  assert.strictEqual(onePage.json.report.earlierTotals.through, '2026-07-12');
  assert.ok(!('before' in onePage.json.report.earlierTotals));
  assert.strictEqual(onePage.json.report.nav, null);
});

// Noon in Chicago on a civil day.
const noonOn = (day) => new Date(zonedDayRange(day, day, TZ).$gte.getTime() + 12 * 3600e3);

test('a dated report and an all-time report with the same dates never stand for each other — in New report and in Next (code review)', { skip }, async () => {
  await onToday(async (today) => {
    // The first knock six days ago, so [that day, today] is both a dated period and all time.
    const camp = await newCampaign('Same dates');
    const series = await tabOf(camp);
    const first = addDays(today, -6);
    await entry(camp, await household(camp), 'not_home', noonOn(first));
    const dated = await create({ campaignId: String(camp._id), weekStart: first, weekEnd: today });
    assert.strictEqual(dated.status, 201, JSON.stringify(dated.json));
    // Latest progress through today: its own report, never "you already have one".
    const all = await create({ campaignId: String(camp._id), allTime: true, weekEnd: today });
    assert.strictEqual(all.status, 201, JSON.stringify(all.json));
    assert.deepStrictEqual([all.json.report.allTime, all.json.report.weekStart, all.json.report.weekEnd], [true, first, today]);
    const raw = async (id) => ClientReport.collection.findOne({ _id: new ObjectId(String(id)) });
    const [d, a] = [await raw(dated.json.report._id), await raw(all.json.report._id)];
    assert.deepStrictEqual([d.dupGuard, 'allTimeGuard' in d], [true, false], 'a dated report sits in report_period_guard');
    assert.deepStrictEqual([a.allTimeGuard, 'dupGuard' in a], [true, false], 'an all-time one in report_all_time_guard');
    // Each kind still finds its own double.
    const again = await create({ campaignId: String(camp._id), allTime: true, weekEnd: today });
    assert.deepStrictEqual([again.status, again.json.code, again.json.reportId, again.json.allTime], [409, 'REPORT_EXISTS', String(all.json.report._id), true]);
    const datedAgain = await create({ campaignId: String(camp._id), weekStart: first, weekEnd: today });
    assert.deepStrictEqual([datedAgain.status, datedAgain.json.reportId, datedAgain.json.allTime], [409, String(dated.json.report._id), false]);
    // Next on an all-time report ending yesterday answers the all-time report through today — never the dated draft.
    const source = await reportIn(camp, series, first, addDays(today, -1), { allTime: true });
    const next1 = await next(source);
    assert.strictEqual(next1.status, 200, JSON.stringify(next1.json));
    assert.deepStrictEqual([String(next1.json.report._id), next1.json.report.allTime], [String(all.json.report._id), true]);

    // The other way round: a dated report's Next whose period is an all-time report's dates makes its own.
    const camp2 = await newCampaign('Same dates, Next');
    const series2 = await tabOf(camp2);
    await entry(camp2, await household(camp2), 'not_home', noonOn(first));
    const all2 = await create({ campaignId: String(camp2._id), allTime: true, weekEnd: today });
    assert.strictEqual(all2.status, 201, JSON.stringify(all2.json));
    const week = await reportIn(camp2, series2, addDays(first, -7), addDays(first, -1));
    const next2 = await next(week);
    assert.strictEqual(next2.status, 201, JSON.stringify(next2.json));
    assert.deepStrictEqual([next2.json.report.weekStart, next2.json.report.weekEnd, !!next2.json.report.allTime], [first, today, false]);
    assert.notStrictEqual(String(next2.json.report._id), String(all2.json.report._id));
  });
});

test('Latest progress pressed at the same moment, many times, makes one draft (report_all_time_guard)', { skip }, async () => {
  const camp = await newCampaign('Race');
  const body = { campaignId: String(camp._id), allTime: true, weekEnd: '2026-07-19' };
  const results = await Promise.all(Array.from({ length: 6 }, () => create(body)));
  assert.ok(results.every((r) => [200, 201, 409].includes(r.status)), JSON.stringify(results.map((r) => r.status)));
  assert.strictEqual(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.strictEqual(await ClientReport.countDocuments({ campaignId: camp._id }), 1);
  const made1 = results.find((r) => r.status === 201).json.report;
  for (const r of results.filter((x) => x.status !== 201)) {
    assert.strictEqual(String(r.json.reportId || r.json.report?._id), String(made1._id), 'every other press is answered with that one');
  }
});

test('report_all_time_guard: unique on { seriesId, weekEnd }, partial on allTimeGuard — built at boot, and it heals guarded doubles', { skip }, async () => {
  const col = ClientReport.collection;
  const guard = (await col.indexes()).find((i) => i.name === 'report_all_time_guard');
  assert.ok(guard, 'built');
  assert.deepStrictEqual([guard.key, guard.unique, guard.partialFilterExpression], [{ seriesId: 1, weekEnd: 1 }, true, { allTimeGuard: true }]);
  const path = ClientReport.schema.path('allTimeGuard');
  assert.ok(path && path.instance === 'Boolean' && path.defaultValue === undefined, 'declared, no default');
  // Guarded doubles that landed while it was missing: the build keeps the first made, unguards the rest.
  const camp = await newCampaign('Heal');
  const series = new ObjectId();
  await col.dropIndex('report_all_time_guard');
  const twin = (sec, weekStart) => ({
    organizationId: ctx.org._id, campaignId: camp._id, seriesId: series, scope: { kind: 'campaign', label: 'Whole campaign' },
    weekStart, weekEnd: '2026-07-19', allTime: true, timeZone: TZ, status: 'draft', allTimeGuard: true,
    rangeStartUtc: zonedDayRange(weekStart, '2026-07-19', TZ).$gte, rangeEndUtc: zonedDayRange(weekStart, '2026-07-19', TZ).$lt,
    createdAt: new Date(Date.UTC(2026, 6, 20, 0, 0, sec)),
  });
  // Keyed on the last day alone: two first days (the first knock moved) are still one all-time report.
  const [older, newer] = Object.values((await col.insertMany([twin(1, '2026-07-01'), twin(2, '2026-06-28')])).insertedIds);
  const warn = console.warn;
  const lines = [];
  console.warn = (...a) => lines.push(a.join(' '));
  try {
    assert.strictEqual(await ensureAllTimeGuard('test'), true);
  } finally {
    console.warn = warn;
  }
  assert.ok(lines.some((l) => /report_all_time_guard: a duplicate key failed the build; 1 report\(s\) sharing a tab and last day/.test(l)), lines.join('\n'));
  assert.strictEqual((await col.findOne({ _id: older })).allTimeGuard, true);
  assert.ok(!('allTimeGuard' in (await col.findOne({ _id: newer }))));
  const err = await col.insertOne(twin(3, '2026-07-02')).then(() => null, (e) => e);
  assert.ok(isReportPeriodGuardError(err), `a new guarded double is refused: ${err?.message}`);
  await col.deleteMany({ seriesId: series });

  // An all-time report from before its own guard (development builds only) carried dupGuard: the boot step
  // takes it out of report_period_guard, so a dated report of the same dates is let in, not a 500.
  const tab = await tabOf(camp);
  const range = zonedDayRange('2026-07-13', '2026-07-19', TZ);
  const { insertedId } = await col.insertOne({
    organizationId: ctx.org._id, campaignId: camp._id, seriesId: tab._id, scope: { kind: 'campaign', label: 'Whole campaign' },
    weekStart: '2026-07-13', weekEnd: '2026-07-19', allTime: true, dupGuard: true, timeZone: TZ, status: 'draft',
    rangeStartUtc: range.$gte, rangeEndUtc: range.$lt, createdAt: new Date(),
  });
  assert.strictEqual(await ensureAllTimeGuard('test'), true);
  assert.ok(!('dupGuard' in (await col.findOne({ _id: insertedId }))), 'out of report_period_guard');
  const dated = await create({ campaignId: String(camp._id), weekStart: '2026-07-13', weekEnd: '2026-07-19' });
  assert.strictEqual(dated.status, 201, JSON.stringify(dated.json));
});

test('an all-time team report keeps the one-person check: the build’s frozen canvasser count, never the door-visit figures (code review)', { skip }, async () => {
  const camp = await newCampaign('One person');
  const coord = await User.create({ firstName: 'Cora', lastName: 'Coord', email: `cora${campN}@all-time.t.co`, passwordHash: 'x', isActive: true });
  const team = await ClientReportSeries.create({ organizationId: ctx.org._id, campaignId: camp._id, kind: 'team', label: 'Paid team', coordinatorIds: [coord._id], crewKeys: [coord._id] });
  for (const day of ['2026-10-20', '2026-10-21', '2026-10-22']) {
    const hh = await household(camp);
    await CanvassActivity.create({ organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, userId: coord._id, coordinatorId: coord._id, actionType: 'not_home', timestamp: noonOn(day), location: { lat: 27.95, lng: -82.46 } });
  }
  const teamReport = async (weekStart, weekEnd, extra = {}) => {
    const range = zonedDayRange(weekStart, weekEnd, TZ);
    const { insertedId } = await ClientReport.collection.insertOne({
      organizationId: ctx.org._id, campaignId: camp._id, campaignType: 'survey', seriesId: team._id,
      scope: { kind: 'team', label: 'Paid team' }, weekStart, weekEnd, timeZone: TZ, rangeStartUtc: range.$gte, rangeEndUtc: range.$lt,
      status: 'draft', snapshotId: new ObjectId(), statsComputedAt: new Date(),
      snapshotInputs: { showMap: false, mapMode: 'pins', areaSize: 'small', mapKeys: [], questionDeps: [], coordinatorIds: [coord._id] },
      visibility: { visibleQuestionKeys: [], mapAnswerKeys: [], showMap: false }, createdAt: new Date(), updatedAt: new Date(), ...extra,
    });
    return insertedId;
  };
  const checksOf = async (id) => {
    const res = await call('GET', `/admin/client-reports/${id}`);
    assert.strictEqual(res.status, 200, JSON.stringify(res.json));
    return res.json.checks.team;
  };
  // A dated team report: the door-visit figures, one canvasser among them, as before.
  const dated = await checksOf(await teamReport('2026-10-19', '2026-10-25'));
  assert.strictEqual(dated.canvassers, 1);
  assert.ok(Array.isArray(dated.teams) && !dated.allTime);
  // All time, with the build's count frozen: that count alone.
  const frozen = await checksOf(await teamReport('2026-10-20', '2026-10-25', { allTime: true, stats: { cumulative: { provenance: { canvassers: 1 } } } }));
  assert.deepStrictEqual(frozen, { allTime: true, canvassers: 1 });
  // All time, built before the count was frozen: the same distinct the period figures run.
  assert.deepStrictEqual(await checksOf(await teamReport('2026-10-20', '2026-10-25', { allTime: true })), { allTime: true, canvassers: 1 });
});
