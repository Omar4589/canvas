import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The organization's report week, the series picker's week facts and Next report on it — docs/
// PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §C, §E, §F (contracts K2–K4), against the real app and a throwaway
// mongod:
//   npm run test:int -- test/clientReportWeeks.int.test.js
//
// The week math itself is pinned by test/reportPeriods.test.js (the fixture table); this file proves
// the routes feed it the right facts — the org's setting, today in the campaign's zone — and act on its
// answer: the catch-up, the 14-day refusal, an exact later report answered, one draft under any number
// of clicks. "Today" is the real clock here, so every period is built relative to it; a test that reads
// it re-runs once if the campaign zone's day turns while it runs.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-client-report-weeks';
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
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Household } = await import('../src/models/Household.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { ensureSeries } = await import('../src/services/reports/clientReportSeries.js');
const { ensureReportPeriodGuard } = await import('../src/services/reports/clientReportIndexes.js');
const { REPORT_FIELDS } = await import('../src/services/reports/clientReportHistory.js');
const { zonedDayRange, zonedDayStr } = await import('../src/utils/timezone.js');
const { addDays } = await import('../src/services/reports/goalProgress.js');
const P = await import('../src/services/reports/reportPeriods.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;
const TZ = 'America/Chicago';

let server;
let base;
const ctx = {};

const call = async (method, path, body, { token = ctx.adminToken, orgId = ctx.org._id } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Org-Id': String(orgId) },
    body: body === undefined ? undefined : JSON.stringify(body),
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
const newCampaign = async () => {
  campN += 1;
  return Campaign.create({
    organizationId: ctx.org._id, name: `Weeks ${campN}`, type: 'survey', state: 'FL', isActive: true,
    surveyTemplateId: ctx.template._id, timeZone: TZ,
  });
};
const tabOf = (camp) => ensureSeries({ organizationId: ctx.org._id, campaignId: camp._id, kind: 'campaign' });
const reportIn = async (camp, series, weekStart, weekEnd, extra = {}) => {
  const range = zonedDayRange(weekStart, weekEnd, TZ);
  const doc = await ClientReport.create({
    organizationId: ctx.org._id, campaignId: camp._id, campaignType: 'survey', seriesId: series._id,
    scope: { kind: 'campaign', label: 'Whole campaign' }, weekStart, weekEnd, timeZone: TZ,
    rangeStartUtc: range.$gte, rangeEndUtc: range.$lt, status: 'published',
    visibility: { visibleQuestionKeys: [], mapAnswerKeys: [], showMap: false }, ...extra,
  });
  return doc.toObject();
};
// A campaign with one published report for [weekStart, weekEnd] in its whole-campaign tab.
const sourceFor = async (weekStart, weekEnd) => {
  const camp = await newCampaign();
  const series = await tabOf(camp);
  return { camp, series, source: await reportIn(camp, series, weekStart, weekEnd) };
};
const next = (r) => call('POST', `/admin/client-reports/${r._id}/next`);
const setWeek = async (s) => {
  const res = await call('PATCH', '/admin/client-reports/settings', { weekStartsOn: s });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
};
const periodOf = (r) => [r.weekStart, r.weekEnd];

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await ClientReportSeries.syncIndexes();
  await ensureReportPeriodGuard('test'); // as the web dyno and the worker do at boot
  const mkOrg = async (name, slug) => {
    const org = await Organization.create({ name, slug, isActive: true });
    await Subscription.create({ organizationId: org._id, status: 'active' });
    return org;
  };
  const org = await mkOrg('Weeks Org', 'weeks-org');
  const other = await mkOrg('Other Org', 'other-org');
  const mk = async (first, last, role, inOrg = org) => {
    const u = await User.create({ firstName: first, lastName: last, email: `${first.toLowerCase()}.${last.toLowerCase()}@w.co`, passwordHash: await User.hashPassword('Str0ng!Passw0rd'), isActive: true });
    await Membership.create({ userId: u._id, organizationId: inOrg._id, role, isActive: true });
    return u;
  };
  const admin = await mk('Ada', 'Admin', 'admin');
  const lead = await mk('Lee', 'Lead', 'lead');
  const canvasser = await mk('Cam', 'Canvasser', 'canvasser');
  const otherAdmin = await mk('Bo', 'Other', 'admin', other);
  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'S', isActive: true,
    questions: [{ key: 'support', label: 'Support?', type: 'single_choice', options: [{ id: 'y', text: 'Yes' }, { id: 'n', text: 'No' }] }],
  });
  Object.assign(ctx, {
    org, other, admin, lead, canvasser, template,
    adminToken: signUserToken(admin), leadToken: signUserToken(lead), canvasserToken: signUserToken(canvasser), otherToken: signUserToken(otherAdmin),
  });
  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

// ── K2: the organization's report week ─────────────────────────────────────────────────────────────

test('settings: Monday by default (field absent too); an admin changes it; a lead reads it and is refused the change', { skip }, async () => {
  await Organization.collection.updateOne({ _id: ctx.org._id }, { $unset: { reportWeekStartsOn: '' } });
  let res = await call('GET', '/admin/client-reports/settings');
  assert.strictEqual(res.status, 200, 'never read as a report id (the client-reports router would answer 400 Invalid id)');
  assert.deepStrictEqual(res.json, { weekStartsOn: 1 }, 'an organization saved before the setting is Monday');

  res = await call('PATCH', '/admin/client-reports/settings', { weekStartsOn: 3 });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.deepStrictEqual(res.json, { weekStartsOn: 3 });
  assert.strictEqual((await Organization.findById(ctx.org._id).lean()).reportWeekStartsOn, 3);
  assert.deepStrictEqual((await call('GET', '/admin/client-reports/settings')).json, { weekStartsOn: 3 });

  // A lead reads it ("set by an admin") and may not change it, as with the logo.
  res = await call('GET', '/admin/client-reports/settings', undefined, { token: ctx.leadToken });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.json, { weekStartsOn: 3 });
  res = await call('PATCH', '/admin/client-reports/settings', { weekStartsOn: 0 }, { token: ctx.leadToken });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.json.code, 'FORBIDDEN_ROLE');
  // A canvasser can't read it either.
  res = await call('GET', '/admin/client-reports/settings', undefined, { token: ctx.canvasserToken });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.json.code, 'FORBIDDEN_ROLE');
  assert.strictEqual((await Organization.findById(ctx.org._id).lean()).reportWeekStartsOn, 3, 'unchanged by the refusals');

  // Both ends of the range are weekdays.
  for (const s of [0, 6]) assert.deepStrictEqual((await call('PATCH', '/admin/client-reports/settings', { weekStartsOn: s })).json, { weekStartsOn: s });
  await setWeek(1);
});

test('settings: anything but a whole number 0–6 is 400 INVALID_WEEK_START and changes nothing', { skip }, async () => {
  for (const body of [{ weekStartsOn: 7 }, { weekStartsOn: -1 }, { weekStartsOn: 2.5 }, { weekStartsOn: '2' }, { weekStartsOn: null }, {}, []]) {
    const res = await call('PATCH', '/admin/client-reports/settings', body);
    assert.strictEqual(res.status, 400, JSON.stringify(body));
    assert.strictEqual(res.json.code, 'INVALID_WEEK_START', JSON.stringify(body));
  }
  assert.strictEqual((await Organization.findById(ctx.org._id).lean()).reportWeekStartsOn, 1);
});

test("settings: always the active organization's — another organization's is neither read nor written", { skip }, async () => {
  // Bo, an admin of the other organization, changes only his own.
  let res = await call('PATCH', '/admin/client-reports/settings', { weekStartsOn: 5 }, { token: ctx.otherToken, orgId: ctx.other._id });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual((await Organization.findById(ctx.other._id).lean()).reportWeekStartsOn, 5);
  assert.strictEqual((await Organization.findById(ctx.org._id).lean()).reportWeekStartsOn, 1, 'this organization untouched');
  // Ada naming Bo's organization is refused before any route runs (not a member) …
  res = await call('GET', '/admin/client-reports/settings', undefined, { orgId: ctx.other._id });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.json.code, 'ORG_CONTEXT');
  res = await call('PATCH', '/admin/client-reports/settings', { weekStartsOn: 2 }, { orgId: ctx.other._id });
  assert.strictEqual(res.status, 403);
  assert.strictEqual((await Organization.findById(ctx.other._id).lean()).reportWeekStartsOn, 5);
  // … and an organization that doesn't exist is 404.
  res = await call('GET', '/admin/client-reports/settings', undefined, { orgId: new ObjectId() });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.json.code, 'ORG_CONTEXT');
});

// ── K3: the series picker's week facts ────────────────────────────────────────────────────────────

test("series picker: the org's week, today in the campaign's zone, and whether anyone knocked before this week began", { skip }, async () => {
  await onToday(async () => {
    const camp = await newCampaign();
    const hh = await Household.create({
      organizationId: ctx.org._id, campaignId: camp._id, isActive: true, addressLine1: '1 Week St', city: 'Tampa', state: 'FL',
      zipCode: '33601', normalizedAddress: `WEEK${camp._id}`, location: { type: 'Point', coordinates: [-82.46, 27.95] },
    });
    const row = (actionType, timestamp, campaignId = camp._id) =>
      CanvassActivity.create({
        organizationId: ctx.org._id, campaignId, householdId: hh._id, userId: ctx.canvasser._id, actionType, timestamp,
        location: { lat: 27.95, lng: -82.46 },
      });
    const picker = async () => {
      const res = await call('GET', `/admin/client-reports/series?campaignId=${camp._id}`);
      assert.strictEqual(res.status, 200, JSON.stringify(res.json));
      return res.json;
    };
    const today = zoneDay();
    // An org week that starts TODAY, and one that started six days ago.
    const sToday = P.dayOfWeek(today);
    const sEarly = (sToday + 1) % 7;
    await setWeek(sToday);
    let p = await picker();
    assert.strictEqual(p.weekStartsOn, sToday);
    assert.strictEqual(p.today, today, "today is the campaign zone's day");
    assert.ok(Array.isArray(p.series), 'the picker itself is unchanged');
    assert.strictEqual(p.knockedBeforeThisWeek, false, 'no knock at all');

    const began = zonedDayRange(today, null, TZ).$gte; // midnight in Chicago
    await row('not_home', new Date(began.getTime() + 60e3));
    assert.strictEqual((await picker()).knockedBeforeThisWeek, false, 'a knock this week only: a new campaign');
    await row('note_added', new Date(began.getTime() - 60e3));
    await row('restricted', new Date(began.getTime() - 60e3));
    assert.strictEqual((await picker()).knockedBeforeThisWeek, false, 'notes and restrictions are not knocks');
    await row('refused', new Date(began.getTime() - 60e3), (await newCampaign())._id);
    assert.strictEqual((await picker()).knockedBeforeThisWeek, false, "another campaign's knock doesn't count");
    // 02:00 UTC today is still yesterday evening in Chicago: before this week there, though after UTC midnight.
    const [y, m, d] = today.split('-').map(Number);
    await row('not_home', new Date(Date.UTC(y, m - 1, d, 2, 0, 0)));
    p = await picker();
    assert.strictEqual(p.knockedBeforeThisWeek, true, "the boundary is the campaign zone's midnight");
    // The org's week moves the boundary: with a week that began six days ago, that knock is this week's.
    await setWeek(sEarly);
    p = await picker();
    assert.strictEqual(p.weekStartsOn, sEarly);
    assert.strictEqual(p.knockedBeforeThisWeek, false, 'inside a week that began six days ago');
    await setWeek(1);
  });
});

// ── K4: Next report ───────────────────────────────────────────────────────────────────────────────

test("Next: after an odd-length report the period runs to the end of the org's last week; the org's week is read per request", { skip }, async () => {
  await onToday(async (today) => {
    await Organization.collection.updateOne({ _id: ctx.org._id }, { $unset: { reportWeekStartsOn: '' } }); // Monday, unstored
    const endOfLastWeek = addDays(P.weekStartOf(today, 1), -1);
    const S = addDays(endOfLastWeek, -9); // a Friday: a 10-day catch-up
    const { source } = await sourceFor(addDays(S, -5), addDays(S, -1));
    let res = await next(source);
    assert.strictEqual(res.status, 201, JSON.stringify(res.json));
    assert.deepStrictEqual(periodOf(res.json.report), [S, endOfLastWeek], 'Friday to the end of last week');
    assert.strictEqual(new Date(res.json.report.rangeStartUtc).getTime(), new Date(source.rangeEndUtc).getTime(), 'starts where the source ended');
    assert.deepStrictEqual(res.json.warnings, []);
    await call('DELETE', `/admin/client-reports/${res.json.report._id}`);

    // An org whose weeks start on that Friday: the same report is followed by one of its weeks (rule 3a).
    await setWeek(P.dayOfWeek(S));
    res = await next(source);
    assert.strictEqual(res.status, 201, JSON.stringify(res.json));
    assert.deepStrictEqual(periodOf(res.json.report), [S, addDays(S, 6)]);
    await setWeek(1);
  });
});

test('Next: whole weeks keep their length and weekday, whole months stay months — whatever the org week', { skip }, async () => {
  await setWeek(1);
  // A Wednesday-to-Tuesday fortnight, long ago: Next fills the gap from the next day (New report would not).
  let { source } = await sourceFor('2026-03-04', '2026-03-17');
  let res = await next(source);
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  assert.deepStrictEqual(periodOf(res.json.report), ['2026-03-18', '2026-03-31']);
  // A quarter → the next quarter.
  ({ source } = await sourceFor('2026-01-01', '2026-03-31'));
  res = await next(source);
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  assert.deepStrictEqual(periodOf(res.json.report), ['2026-04-01', '2026-06-30']);
  // February 2026 is also four Sunday-to-Saturday weeks: with Sunday weeks it is still a month.
  await setWeek(0);
  ({ source } = await sourceFor('2026-02-01', '2026-02-28'));
  res = await next(source);
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  assert.deepStrictEqual(periodOf(res.json.report), ['2026-03-01', '2026-03-31']);
  await setWeek(1);
});

test('Next: a catch-up over 14 days is refused 409 NEXT_GAP_TOO_LONG with both periods, and makes nothing; 13 days is made', { skip }, async () => {
  await onToday(async (today) => {
    await setWeek(1);
    const endOfLastWeek = addDays(P.weekStartOf(today, 1), -1);
    const lastWeek = P.lastWeek(today, 1);
    for (const days of [15, 20]) {
      const S = addDays(endOfLastWeek, -(days - 1));
      const { source, series } = await sourceFor(addDays(S, -3), addDays(S, -1));
      const res = await next(source);
      assert.strictEqual(res.status, 409, JSON.stringify(res.json));
      assert.strictEqual(res.json.code, 'NEXT_GAP_TOO_LONG');
      assert.deepStrictEqual(res.json.catchUp, { weekStart: S, weekEnd: endOfLastWeek }, `${days} days`);
      assert.deepStrictEqual(res.json.suggested, lastWeek, "New report's long-gap choice: last week");
      assert.strictEqual(await ClientReport.countDocuments({ seriesId: series._id }), 1, 'no draft');
      assert.strictEqual(await CampaignChange.countDocuments({ seriesId: series._id, field: REPORT_FIELDS.created }), 0, 'no History row');
      assert.strictEqual((await ClientReport.findById(source._id).lean()).nextReportId, null);
    }
    const S = addDays(endOfLastWeek, -12);
    const { source } = await sourceFor(addDays(S, -3), addDays(S, -1));
    const res = await next(source);
    assert.strictEqual(res.status, 201, JSON.stringify(res.json));
    assert.deepStrictEqual(periodOf(res.json.report), [S, endOfLastWeek], 'a 13-day catch-up is made');
  });
});

test('Next: an exact later report is answered (200 existing); any other later report is still 409 NOT_LATEST_REPORT', { skip }, async () => {
  await setWeek(1);
  let { camp, series, source } = await sourceFor('2026-09-07', '2026-09-13');
  const made = await reportIn(camp, series, '2026-09-14', '2026-09-20', { status: 'draft' }); // e.g. from New report
  let res = await next(source);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.existing, true);
  assert.strictEqual(String(res.json.report._id), String(made._id));
  assert.ok('build' in res.json);
  assert.strictEqual(await ClientReport.countDocuments({ seriesId: series._id }), 2, 'nothing new');

  ({ camp, series, source } = await sourceFor('2026-09-07', '2026-09-13'));
  await reportIn(camp, series, '2026-09-14', '2026-09-16');
  res = await next(source);
  assert.strictEqual(res.status, 409, JSON.stringify(res.json));
  assert.strictEqual(res.json.code, 'NOT_LATEST_REPORT');
});

// Eight rounds: a single round of ten caught the two-reads race (a click refused NOT_LATEST_REPORT) in only
// 2 of 5 runs.
test('Next: ten clicks at once make ONE guarded draft — one 201, the rest answer it, one History row (8 rounds)', { skip }, async () => {
  await setWeek(1);
  for (let round = 0; round < 8; round += 1) {
    const { series, source } = await sourceFor('2026-08-03', '2026-08-09');
    const all = await Promise.all(Array.from({ length: 10 }, () => next(source)));
    assert.ok(all.every((r) => [200, 201].includes(r.status)), `round ${round}: ${JSON.stringify(all.map((r) => [r.status, r.json?.code]))}`);
    assert.strictEqual(all.filter((r) => r.status === 201).length, 1, `round ${round}: exactly one made it`);
    const ids = new Set(all.map((r) => String(r.json.report._id)));
    assert.strictEqual(ids.size, 1, `round ${round}: every click lands on the same draft`);
    assert.ok(all.filter((r) => r.status === 200).every((r) => r.json.existing === true));
    const [id] = [...ids];
    assert.deepStrictEqual(await ClientReport.find({ seriesId: series._id, weekStart: '2026-08-10' }).distinct('_id').then((x) => x.map(String)), [id]);
    const raw = await ClientReport.collection.findOne({ _id: new ObjectId(id) });
    assert.strictEqual(raw.dupGuard, true, "Next's insert is guarded (§E)");
    assert.strictEqual(await CampaignChange.countDocuments({ seriesId: series._id, field: REPORT_FIELDS.created }), 1, `round ${round}: one "created" row`);
    assert.strictEqual(String((await ClientReport.findById(source._id).lean()).nextReportId), id);
  }
});

test('Next: losing at report_period_guard answers the report that got in, and leaves nothing behind', { skip }, async () => {
  await setWeek(1);
  const idx = (await ClientReport.collection.indexes()).find((i) => i.name === 'report_period_guard');
  assert.ok(idx?.unique, 'the guard index is built');
  const { camp, series, source } = await sourceFor('2026-07-06', '2026-07-12');
  // A guarded draft for exactly the next period that the "later report" look can't see — standing in for a
  // request that inserted between this one's look and its insert.
  const theirs = await reportIn(camp, series, '2026-07-13', '2026-07-19', { status: 'draft', dupGuard: true });
  await ClientReport.collection.updateOne({ _id: theirs._id }, { $set: { rangeStartUtc: new Date(source.rangeStartUtc) } });
  const res = await next(source);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.existing, true);
  assert.strictEqual(String(res.json.report._id), String(theirs._id));
  assert.strictEqual(await ClientReport.countDocuments({ seriesId: series._id }), 2, 'no second draft');
  assert.strictEqual(await CampaignChange.countDocuments({ seriesId: series._id, field: REPORT_FIELDS.created }), 0, 'no "created" row from the loser');
  assert.strictEqual((await ClientReport.findById(source._id).lean()).nextReportId, null, 'the loser never claimed the source');
});

test('Next: the contiguity check still refuses a period that does not start where the report ends', { skip }, async () => {
  await setWeek(1);
  const { source } = await sourceFor('2026-06-01', '2026-06-07');
  await ClientReport.collection.updateOne({ _id: source._id }, { $set: { rangeEndUtc: new Date(new Date(source.rangeEndUtc).getTime() + 3600e3) } });
  const res = await next(source);
  assert.strictEqual(res.status, 409, JSON.stringify(res.json));
  assert.strictEqual(res.json.code, 'NEXT_PERIOD_MISMATCH');
});

test('Next: a period that starts after today still says so (STARTS_AFTER_TODAY)', { skip }, async () => {
  await onToday(async (today) => {
    await setWeek(1);
    const week = P.thisWeek(today, 1);
    const { source } = await sourceFor(week.weekStart, week.weekEnd);
    const res = await next(source);
    assert.strictEqual(res.status, 201, JSON.stringify(res.json));
    assert.deepStrictEqual(periodOf(res.json.report), [addDays(week.weekEnd, 1), addDays(week.weekEnd, 7)]);
    assert.deepStrictEqual(res.json.warnings, ['STARTS_AFTER_TODAY']);
  });
});

// Code review round 1, WEEK-3: New report's first choice can be a week that hasn't begun; its create
// answers the same warning Next's does, so the builder opens on its "hasn't started yet" note.
test("New report: a period that starts after today in the campaign's zone says so (STARTS_AFTER_TODAY); one that has begun doesn't", { skip }, async () => {
  await onToday(async (today) => {
    await setWeek(1);
    const camp = await newCampaign();
    const create = async (weekStart, weekEnd) => {
      const res = await call('POST', '/admin/client-reports', { campaignId: String(camp._id), weekStart, weekEnd });
      assert.strictEqual(res.status, 201, JSON.stringify(res.json));
      return res.json.warnings;
    };
    const week = P.thisWeek(today, 1);
    assert.deepStrictEqual(await create(week.weekStart, week.weekEnd), [], 'this week has begun, though it is not over');
    assert.deepStrictEqual(await create(today, today), [], 'today has begun');
    assert.deepStrictEqual(await create(addDays(week.weekEnd, 1), addDays(week.weekEnd, 7)), ['STARTS_AFTER_TODAY'], 'next week');
    assert.deepStrictEqual(await create(addDays(today, 1), addDays(today, 1)), ['STARTS_AFTER_TODAY'], 'tomorrow');
  });
});
