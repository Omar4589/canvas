import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import mongoose from 'mongoose';

// THROWAWAY gap-filling suite — not part of the repo; deleted right after it runs (a copy is kept
// in the session scratchpad). It covers ONLY the endpoints / modes the first investigation suite
// (scratchpad zz_tmp_dph_nosolicit.int.test.js) never exercised, with the same three scenarios:
//
//   S1  ESTIMATED  20 no_soliciting over exactly 1.0h, no FbTime            → 20 doors/hr
//   S2  CONTRAST   20 restricted over the same hour                          → 0 doors/hr
//   S3  MEASURED   FbTime connected, one closed 1.0h adjustedHours shift     → 20 doors/hr
//
// Gap surfaces: GET /mobile/me/today; the timeline's WEEK-bucket mode (>62-day range); the
// timeline's BOUNDED totals mode (totals=1&from&to); the six hours endpoints with ?effortId= /
// ?coordinatorId=; and the six hours endpoints called by a TEAM LEAD.
//
// Two mechanism probes ride along, because the S1-S3 fixtures alone cannot trigger them:
//   PROBE-split  one canvasser, one day: 20 NS on walk list A under crew Lena (15:00-16:00Z), then
//                20 NS on walk list B under crew Cole (16:30-17:30Z); measured 2.0h for the day.
//   PROBE-idle   20 NS on D (1h) and 20 NS on D+2 (1h); measured D 1h, D+1 4h (no knocks
//                anywhere — an idle clocked day inside the stint), D+2 1h.
//
// Fixtures go through the REAL mobile write routes (carrying the tap `timestamp` the app sends),
// so pass/turf/effort/coordinator attribution is exactly what production writes. Every
// surface x scenario is RECORDED (expected, actual, pass) before anything is asserted.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-dph-gap';
process.env.CREDENTIAL_SEAL_KEY = process.env.CREDENTIAL_SEAL_KEY || Buffer.alloc(32, 7).toString('base64');

const SCRATCH =
  '/private/tmp/claude-501/-Users-omarzumaya-Desktop-canvass-app/2ae092ce-ae89-4531-b3e9-c25d84bb2b2e/scratchpad';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { FbTimeConnection } = await import('../src/models/FbTimeConnection.js');
const { FbTimeShift } = await import('../src/models/FbTimeShift.js');
const { FbTimePersonLink } = await import('../src/models/FbTimePersonLink.js');
const { recomputeCampaignStats } = await import('../src/services/reports/campaignCounters.js');
// The canvasser app's own pace formatter, executed for real: a byte-identical copy of
// mobile/lib/rates.js (no imports), saved as .mjs because mobile/ is not an ESM package.
const { formatPace } = await import(`file://${SCRATCH}/rates.mjs`);

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const TZ = 'America/Chicago'; // CDT = UTC-5 in April
const D = '2026-04-14'; // a Tuesday → its week column is Monday 2026-04-13
const D1 = '2026-04-15';
const D2 = '2026-04-16';
const WEEK_MON = '2026-04-13';
const DAY = `from=${D}&to=${D}`;
const WEEK_RANGE = 'from=2026-03-01&to=2026-05-31'; // 92 days: > 62 → week buckets, ≤ 183 cap
const LAT = 30.26;
const LNG = -97.74;
const MIN = 60000;
const HOUR = 3600000;

// "Today" taps for /mobile/me/today: 20 marks, first at now-70min, last at EXACTLY +1.0h.
const T0 = new Date(Math.floor((Date.now() - 70 * MIN) / 1000) * 1000);
const TODAY_FIRST = T0.toISOString();
const TODAY_LAST = new Date(T0.getTime() + HOUR).toISOString();

// n tap times: the first at `startIso`, the last at EXACTLY startIso + spanMs.
const spread = (startIso, spanMs, n = 20) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(startIso) + Math.round((i * spanMs) / (n - 1))));

let server;
let base;
const ctx = { users: {}, tok: {}, c: {} };

// ── recording ────────────────────────────────────────────────────────────────
const RESULTS = [];
const RESULTS_FILE = `${SCRATCH}/dph_gap_results.json`;
const r2 = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);
const same = (e, a) =>
  typeof e === 'number' && typeof a === 'number' ? Math.abs(e - a) < 0.006 : JSON.stringify(e) === JSON.stringify(a);
const pick = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const expectFields = (scenario, surface, obj, exp, why = {}) => {
  for (const [field, expected] of Object.entries({ _status: 200, ...exp })) {
    let actual = pick(obj, field);
    if (actual === undefined) actual = 'absent';
    const rec = { scenario, surface, field, expected, actual, pass: same(expected, actual) };
    if (why[field]) rec.explanation = why[field];
    RESULTS.push(rec);
    console.log(`RESULT ${JSON.stringify(rec)}`);
  }
};
const flush = () => fs.writeFileSync(RESULTS_FILE, JSON.stringify(RESULTS, null, 1));
// Every record added since `mark` must pass (one test = one slice of RESULTS).
const assertCleanSince = (mark, label) => {
  flush();
  const bad = RESULTS.slice(mark).filter((r) => !r.pass);
  assert.deepStrictEqual(bad, [], `${bad.length} mismatch(es) recorded in ${label}`);
};

// ── the clients' own compositions over the timeline rows (they never re-derive a span) ──────
// web client/src/components/CanvasserSummaryTable.jsx mergedDoorsPerHour — the Timeline Doors/hr cell
const webRowRate = (row) =>
  row.measuredHoursOnDoors != null && row.measuredHoursOnDoors > 0 && row.dayKnocks != null
    ? row.dayKnocks / row.measuredHoursOnDoors
    : row.doorsPerHour || 0;
// mobile/components/CanvasserCard.jsx — the admin timeline card ("· 2h• · 10.0/hr"; blank when 0)
const mobileCardRate = (row) => {
  const hours =
    row.measuredHoursOnDoors != null && row.measuredHoursOnDoors > 0 ? row.measuredHoursOnDoors : row.hoursOnDoors;
  return hours > 0 ? (row.dayKnocks || 0) / hours : row.doorsPerHour || 0;
};
// client/src/pages/TimelinePage.jsx + mobile/app/(app)/admin/timeline.jsx — the Doors/hr KPI tile
const kpiTileRate = (rows) => {
  let hours = 0;
  let measuredHours = 0;
  let rawDoors = 0;
  let allMeasured = rows.length > 0;
  for (const r of rows) {
    rawDoors += r.dayKnocks || 0;
    hours += r.hoursOnDoors || 0;
    if (r.hoursSource === 'measured' && r.measuredHoursOnDoors != null) measuredHours += r.measuredHoursOnDoors;
    else allMeasured = false;
  }
  const hoursMeasured = allMeasured && measuredHours > 0;
  return hoursMeasured ? rawDoors / measuredHours : hours > 0 ? rawDoors / hours : null;
};

// ── http ─────────────────────────────────────────────────────────────────────
const call = async (method, path, { token, orgId, body, raw } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return { status: res.status, text: await res.text() };
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
};
const as = (who) => ({ token: ctx.tok[who], orgId: ctx.org._id });

const csvRowFor = (text, email) => {
  const lines = String(text || '').split('\n');
  const h = lines.findIndex((l) => l.startsWith('Rank,'));
  if (h < 0) return null;
  const headers = lines[h].split(',');
  const emailCol = headers.indexOf('Email');
  const line = lines.slice(h + 1).find((l) => l.split(',')[emailCol] === email);
  if (!line) return null;
  const cells = line.split(',');
  return Object.fromEntries(headers.map((k, i) => [k, /^-?\d+(\.\d+)?$/.test(cells[i]) ? Number(cells[i]) : cells[i]]));
};

// ── fixtures ─────────────────────────────────────────────────────────────────
// One campaign per scenario; `lists` = [[key, doorCount], …] → one Effort (walk list) per key, each
// with an active round and a published book holding its doors.
const makeCampaign = async (org, name, prefix, lists) => {
  const campaign = await Campaign.create({ organizationId: org._id, name, type: 'survey', state: 'TX', timeZone: TZ });
  const out = { campaign, lists: {} };
  for (const [key, n] of lists) {
    const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: `Walk list ${key}` });
    const pass = await Pass.create({
      organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
      roundNumber: 1, name: 'R1', status: 'active', activatedAt: new Date('2026-04-01T00:00:00Z'),
    });
    const doors = [];
    for (let i = 1; i <= n; i++) {
      doors.push(await Household.create({
        organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
        addressLine1: `${i} ${prefix} ${key} St`, city: 'Austin', state: 'TX', zipCode: '78701',
        normalizedAddress: `${i} ${prefix.toLowerCase()} ${key.toLowerCase()} st austin tx 78701`,
        location: { type: 'Point', coordinates: [LNG, LAT] },
        status: 'unknocked', isActive: true,
      }));
    }
    await Turf.create({
      organizationId: org._id, campaignId: campaign._id, passId: pass._id, name: `${prefix} ${key} book`,
      mode: 'manual', status: 'published', householdIds: doors.map((d) => d._id), doorCount: doors.length,
    });
    out.lists[key] = { effort, pass, doors };
  }
  return out;
};

// One tap per door through the real mobile route, carrying the tap time like the app does.
const markAll = async (tok, doors, kind, times) => {
  for (let i = 0; i < doors.length; i++) {
    const r = await call('POST', `/mobile/households/${doors[i]._id}/${kind}`, {
      token: tok, orgId: ctx.org._id,
      body: { location: { lat: LAT, lng: LNG, accuracy: 5 }, timestamp: times[i].toISOString() },
    });
    if (r.status !== 201) throw new Error(`${kind} write, door ${i + 1}: ${r.status} ${JSON.stringify(r.json)}`);
  }
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, User, Membership, Campaign, CampaignManager, Subscription, Household, CanvassActivity, Effort,
    Pass, Turf, CampaignAssignment, FbTimeConnection, FbTimeShift, FbTimePersonLink,
  ]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'DPH Gap Org', slug: 'dph-gap-org', isActive: true, timeZone: TZ });
  ctx.org = org;
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const mkUser = async (key, firstName, lastName, role) => {
    const u = await User.create({
      firstName, lastName, email: `${key.toLowerCase()}@dphgap.co`, passwordHash: 'x', isActive: true,
    });
    await Membership.create({
      userId: u._id, organizationId: org._id, role, isActive: true, ...(role === 'admin' ? { billingAccess: true } : {}),
    });
    ctx.users[key] = u;
    ctx.tok[key] = signUserToken(u);
    return u;
  };
  await mkUser('admin', 'Ada', 'Admin', 'admin');
  await mkUser('lead', 'Lena', 'Lead', 'lead');
  await mkUser('coach', 'Cole', 'Coach', 'lead');
  await mkUser('NS', 'Nora', 'NoSolicit', 'canvasser');
  await mkUser('RS', 'Rita', 'Restricted', 'canvasser');
  await mkUser('SPL', 'Sam', 'Split', 'canvasser');
  await mkUser('IDL', 'Ivy', 'Idle', 'canvasser');
  await mkUser('TNS', 'Tara', 'TodayNoSolicit', 'canvasser');
  await mkUser('TRS', 'Toby', 'TodayRestricted', 'canvasser');

  ctx.c.NS = await makeCampaign(org, 'Gap S1-S3 NoSolicit', 'Sign', [['NS', 20]]);
  ctx.c.RS = await makeCampaign(org, 'Gap S2-S3 Restricted', 'Gate', [['RS', 20]]);
  ctx.c.SPL = await makeCampaign(org, 'Gap PROBE split', 'Fork', [['A', 20], ['B', 20]]);
  ctx.c.IDL = await makeCampaign(org, 'Gap PROBE idle', 'Lull', [['IDL', 40]]);
  ctx.c.TNS = await makeCampaign(org, 'Gap TODAY NoSolicit', 'Now', [['TNS', 20]]);
  ctx.c.TRS = await makeCampaign(org, 'Gap TODAY Restricted', 'Bar', [['TRS', 20]]);

  // Rosters: the crew stamp frozen onto each knock is read from here at write time.
  const assign = (u, c, coordinatorId = null) =>
    CampaignAssignment.create({
      organizationId: org._id, campaignId: ctx.c[c].campaign._id, userId: ctx.users[u]._id, coordinatorId,
    });
  await assign('NS', 'NS', ctx.users.lead._id);
  await assign('RS', 'RS', ctx.users.lead._id);
  await assign('SPL', 'SPL', ctx.users.lead._id);
  await assign('IDL', 'IDL', ctx.users.lead._id);
  await assign('TNS', 'TNS');
  await assign('TRS', 'TRS');
  // The lead MANAGES the four report campaigns (not the two "today" ones → a negative check).
  for (const c of ['NS', 'RS', 'SPL', 'IDL']) {
    await CampaignManager.create({
      organizationId: org._id, campaignId: ctx.c[c].campaign._id, userId: ctx.users.lead._id,
      grantedBy: ctx.users.admin._id,
    });
  }

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  await markAll(ctx.tok.NS, ctx.c.NS.lists.NS.doors, 'no-soliciting', spread(`${D}T15:00:00.000Z`, HOUR));
  await markAll(ctx.tok.RS, ctx.c.RS.lists.RS.doors, 'restricted', spread(`${D}T15:00:00.000Z`, HOUR));
  // PROBE-split: list A under Lena's crew, then the canvasser moves to Cole's crew for list B.
  await markAll(ctx.tok.SPL, ctx.c.SPL.lists.A.doors, 'no-soliciting', spread(`${D}T15:00:00.000Z`, HOUR));
  await CampaignAssignment.updateOne(
    { campaignId: ctx.c.SPL.campaign._id, userId: ctx.users.SPL._id },
    { $set: { coordinatorId: ctx.users.coach._id } }
  );
  await markAll(ctx.tok.SPL, ctx.c.SPL.lists.B.doors, 'no-soliciting', spread(`${D}T16:30:00.000Z`, HOUR));
  // PROBE-idle: two knock days with a gap day between.
  const idl = ctx.c.IDL.lists.IDL.doors;
  await markAll(ctx.tok.IDL, idl.slice(0, 20), 'no-soliciting', spread(`${D}T15:00:00.000Z`, HOUR));
  await markAll(ctx.tok.IDL, idl.slice(20), 'no-soliciting', spread(`${D2}T15:00:00.000Z`, HOUR));
  // Today, for /mobile/me/today.
  await markAll(ctx.tok.TNS, ctx.c.TNS.lists.TNS.doors, 'no-soliciting', spread(TODAY_FIRST, HOUR));
  await markAll(ctx.tok.TRS, ctx.c.TRS.lists.TRS.doors, 'restricted', spread(TODAY_FIRST, HOUR));
  for (const k of Object.keys(ctx.c)) await recomputeCampaignStats(ctx.c[k].campaign._id);
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

// ── surface runners ──────────────────────────────────────────────────────────
const SURFACE = {
  canvassers: 'GET /api/admin/reports/canvassers',
  csv: 'GET /api/admin/reports/canvassers.csv',
  timeline: 'GET /api/admin/reports/canvasser-timeline',
  teamAverages: 'GET /api/admin/reports/team-averages',
  summary: 'GET /api/admin/reports/canvassers/:userId/summary',
  daily: 'GET /api/admin/reports/canvassers/:userId/daily',
};

const fetchSix = async (who, key, user, q, which) => {
  const campaign = ctx.c[key].campaign;
  const qs = `campaignId=${campaign._id}${q ? `&${q}` : ''}`;
  const uid = String(user._id);
  const get = (p, raw = false) => call('GET', p, { ...as(who), raw });
  const out = {};
  if (which.includes('canvassers')) out.canvassers = await get(`/admin/reports/canvassers?${qs}`);
  if (which.includes('csv')) out.csv = await get(`/admin/reports/canvassers.csv?${qs}`, true);
  if (which.includes('timeline')) out.timeline = await get(`/admin/reports/canvasser-timeline?${qs}`);
  if (which.includes('teamAverages')) out.teamAverages = await get(`/admin/reports/team-averages?${qs}`);
  if (which.includes('summary')) out.summary = await get(`/admin/reports/canvassers/${uid}/summary?${qs}`);
  if (which.includes('daily')) out.daily = await get(`/admin/reports/canvassers/${uid}/daily?${qs}`);
  return out;
};

// The per-user slice each surface shows for `user` (day D for the per-day lists).
const views = (res, user) => {
  const uid = String(user._id);
  const v = {};
  if (res.canvassers) {
    const row = Array.isArray(res.canvassers.json) ? res.canvassers.json.find((c) => c.userId === uid) : null;
    v.canvassers = { _status: res.canvassers.status, ...(row || {}) };
  }
  if (res.csv) v.csv = { _status: res.csv.status, ...(csvRowFor(res.csv.text, user.email) || {}) };
  if (res.timeline) {
    const rows = res.timeline.json?.canvassers || [];
    const row = rows.find((c) => c.userId === uid) || null;
    v.timeline = {
      _status: res.timeline.status,
      row,
      top: res.timeline.json,
      client: row
        ? {
            webRowDoorsPerHour: r2(webRowRate(row)),
            mobileCardDoorsPerHour: r2(mobileCardRate(row)),
            kpiTileDoorsPerHour: r2(kpiTileRate(rows)),
          }
        : null,
    };
  }
  if (res.teamAverages) v.teamAverages = { _status: res.teamAverages.status, ...(res.teamAverages.json || {}) };
  if (res.summary) {
    v.summary = {
      _status: res.summary.status,
      kpi: res.summary.json?.kpi,
      day0: (res.summary.json?.lastSevenDays || []).find((d) => d.date === D),
    };
  }
  if (res.daily) {
    v.daily = { _status: res.daily.status, ...((res.daily.json?.days || []).find((d) => d.date === D) || {}) };
  }
  return v;
};

const six = async (sc, { who = 'admin', key, user, q, label, exp, why = {} }) => {
  const which = Object.keys(exp);
  const res = await fetchSix(who, key, user, q, which);
  const v = views(res, user);
  const tag = `${who}; ${ctx.c[key].campaign.name}; ${label}`;
  for (const k of which) expectFields(sc, `${SURFACE[k]} [${tag}]`, v[k], exp[k], why[k] || {});
  return { res, v };
};

// Did FbTime-derived hours reach this payload?
const fbHoursSeen = (k, v) => {
  switch (k) {
    case 'canvassers':
      return ['measured', 'mixed'].includes(v.hoursSource);
    case 'csv':
      return ['Measured', 'Mixed'].includes(v['Hours source']);
    case 'timeline':
      return (
        v.row?.measuredHoursOnDoors != null ||
        ['measured', 'mixed'].includes(v.row?.hoursSource) ||
        v.top?.measuredKpi?.hoursSource === 'measured'
      );
    case 'teamAverages':
      return v.hoursSource === 'measured';
    case 'summary':
      return ['measured', 'mixed'].includes(v.kpi?.hoursSource) || v.day0?.hoursSource === 'measured';
    case 'daily':
      return v.hoursSource === 'measured';
    default:
      return false;
  }
};
const fbEvidence = (k, v) => {
  switch (k) {
    case 'canvassers':
      return `hoursOnDoors=${v.hoursOnDoors} doorsPerHour=${v.doorsPerHour} hoursSource=${v.hoursSource} hoursReason=${v.hoursReason} hoursFlags=${JSON.stringify(v.hoursFlags)}`;
    case 'csv':
      return `'Hours on doors'=${v['Hours on doors']} 'Knocks/hr'=${v['Knocks/hr']} 'Hours source'=${v['Hours source']}`;
    case 'timeline':
      return `row.measuredHoursOnDoors=${v.row?.measuredHoursOnDoors} row.hoursSource=${v.row?.hoursSource} row.hoursFlags=${JSON.stringify(v.row?.hoursFlags)} top.measuredKpi=${JSON.stringify(v.top?.measuredKpi)}`;
    case 'teamAverages':
      return `hoursSource=${v.hoursSource} avg.hoursOnDoors=${v.avg?.hoursOnDoors} avg.doorsPerHour=${v.avg?.doorsPerHour}`;
    case 'summary':
      return `kpi.hoursOnDoors=${v.kpi?.hoursOnDoors} kpi.hoursSource=${v.kpi?.hoursSource} kpi.hoursFlags=${JSON.stringify(v.kpi?.hoursFlags)} lastSevenDays[${D}]=${JSON.stringify(v.day0 && { hoursOnDoors: v.day0.hoursOnDoors, hoursSource: v.day0.hoursSource })}`;
    case 'daily':
      return `days[${D}].hoursOnDoors=${v.hoursOnDoors} hoursSource=${v.hoursSource} doorsPerHour=${v.doorsPerHour}`;
    default:
      return '';
  }
};
const DOC_CLAIM =
  'DOC CLAIM: docs/FBTIME_INTEGRATION.md:324 ("link state only, never this person\'s hours … the only FbTime fact a lead can see anywhere"), :409-413 ("never hours"); docs/PRIVACY_VERIFICATION.md v5 note (~:916, "A lead therefore learns one boolean plus an FbTime display name … never hours")';

// As the LEAD: the dph numbers, then the same request as admin (identity), then (measured
// scenarios) whether FbTime-derived hours reached the lead.
const leadChecks = async (sc, { key, user, q, label, exp, why = {}, privacy = false }) => {
  const { res: L, v } = await six(sc, { who: 'lead', key, user, q, label, exp, why });
  const which = Object.keys(exp);
  const A = await fetchSix('admin', key, user, q, which);
  const name = ctx.c[key].campaign.name;
  for (const k of which) {
    const body = (r) => (k === 'csv' ? String(r.text || '').split('\n').slice(1).join('\n') : JSON.stringify(r.json));
    const identical = L[k].status === A[k].status && body(L[k]) === body(A[k]);
    expectFields(sc, `${SURFACE[k]} [lead vs admin, same request; ${name}; ${label}]`,
      { _status: L[k].status, leadPayloadIdenticalToAdmin: identical }, { leadPayloadIdenticalToAdmin: true }, {
        leadPayloadIdenticalToAdmin:
          'tests the premise that the reports router (reports.js:65 requireOrgRole(\'admin\', \'lead\')) admits a lead and strips no field (the csv compares everything after its "hours as of <now>" stamp line)',
      });
    if (privacy) {
      expectFields(`${sc}-LEAD-PRIVACY`, `${SURFACE[k]} [lead; ${name}; ${label}]`,
        { _status: L[k].status, leadReceivesFbTimeHours: fbHoursSeen(k, v[k]) }, { leadReceivesFbTimeHours: false }, {
          leadReceivesFbTimeHours: `${DOC_CLAIM}. ACTUAL lead payload: ${fbEvidence(k, v[k])}`,
        });
    }
  }
};

const todayCall = async (sc, key, { since, label, exp, why = {} }) => {
  const c = ctx.c[key].campaign;
  const qs = since === undefined ? '' : `&since=${encodeURIComponent(since)}`;
  const r = await call('GET', `/mobile/me/today?campaignId=${c._id}${qs}`, as(key));
  const j = r.json || {};
  expectFields(sc, `GET /api/mobile/me/today [${key} on ${c.name}; ${label}] (map "Today's shift" Pace = mobile/lib/rates.js formatPace)`, {
    _status: r.status, ...j, appPace: formatPace(j.doorsKnocked, j.firstDoorAt, j.lastDoorAt),
  }, exp, why);
};

// ── expectations ─────────────────────────────────────────────────────────────
const WHY_RESTRICTED_HOURS =
  'BY DESIGN: span aggregations include restricted rows (time reaching an inaccessible home counts as time worked) — the hour is charged, no knocks are, so the rate is 0';
const EXP = {
  S1: {
    canvassers: {
      knocks: 20, noSoliciting: 20, restricted: 0, hoursOnDoors: 1, doorsPerHour: 20,
      hoursSource: 'estimated', hoursReason: 'not-connected',
    },
    csv: { Knocks: 20, 'No soliciting': 20, Restricted: 0, 'Hours on doors': 1, 'Knocks/hr': 20, 'Hours source': 'Estimated' },
    timeline: {
      'row.dayKnocks': 20, 'row.dayRestricted': 0, 'row.hoursOnDoors': 1, 'row.doorsPerHour': 20,
      'row.measuredHoursOnDoors': null, 'row.hoursSource': 'estimated',
      'client.webRowDoorsPerHour': 20, 'client.mobileCardDoorsPerHour': 20, 'client.kpiTileDoorsPerHour': 20,
    },
    teamAverages: { canvasserCount: 1, hoursSource: 'estimated', 'avg.homesKnocked': 20, 'avg.hoursOnDoors': 1, 'avg.doorsPerHour': 20 },
    summary: {
      'kpi.homesKnocked': 20, 'kpi.restricted': 0, 'kpi.hoursOnDoors': 1, 'kpi.doorsPerHour': 20,
      'kpi.hoursSource': 'estimated', 'day0.hoursOnDoors': 1, 'day0.hoursSource': 'estimated',
    },
    daily: { homesKnocked: 20, noSoliciting: 20, hoursOnDoors: 1, doorsPerHour: 20, hoursSource: 'estimated' },
  },
  S2: {
    canvassers: {
      knocks: 0, noSoliciting: 0, restricted: 20, hoursOnDoors: 1, doorsPerHour: 0,
      hoursSource: 'estimated', hoursReason: 'not-connected',
    },
    csv: { Knocks: 0, 'No soliciting': 0, Restricted: 20, 'Hours on doors': 1, 'Knocks/hr': 0, 'Hours source': 'Estimated' },
    timeline: {
      'row.dayKnocks': 0, 'row.dayRestricted': 20, 'row.hoursOnDoors': 1, 'row.doorsPerHour': 0,
      'row.measuredHoursOnDoors': null, 'row.hoursSource': 'estimated',
      'client.webRowDoorsPerHour': 0, 'client.mobileCardDoorsPerHour': 0, 'client.kpiTileDoorsPerHour': 0,
    },
    teamAverages: { canvasserCount: 1, hoursSource: 'estimated', 'avg.homesKnocked': 0, 'avg.hoursOnDoors': 1, 'avg.doorsPerHour': 0 },
    summary: {
      'kpi.homesKnocked': 0, 'kpi.restricted': 20, 'kpi.hoursOnDoors': 1, 'kpi.doorsPerHour': 0,
      'kpi.hoursSource': 'estimated', 'day0.hoursOnDoors': 1,
    },
    daily: { homesKnocked: 0, noSoliciting: 0, hoursOnDoors: 1, doorsPerHour: 0, hoursSource: 'estimated' },
  },
  S3: {
    canvassers: {
      knocks: 20, noSoliciting: 20, hoursOnDoors: 1, doorsPerHour: 20, hoursSource: 'measured', hoursReason: null,
    },
    csv: { Knocks: 20, 'No soliciting': 20, 'Hours on doors': 1, 'Knocks/hr': 20, 'Hours source': 'Measured' },
    timeline: {
      'row.dayKnocks': 20, 'row.hoursOnDoors': 1, 'row.doorsPerHour': 20, 'row.measuredHoursOnDoors': 1,
      'row.hoursSource': 'measured', 'row.hoursReason': null,
      'client.webRowDoorsPerHour': 20, 'client.mobileCardDoorsPerHour': 20, 'client.kpiTileDoorsPerHour': 20,
      'top.measuredKpi': { hoursOnDoors: 1, hoursSource: 'measured' },
    },
    teamAverages: { canvasserCount: 1, hoursSource: 'measured', 'avg.homesKnocked': 20, 'avg.hoursOnDoors': 1, 'avg.doorsPerHour': 20 },
    summary: {
      'kpi.homesKnocked': 20, 'kpi.hoursOnDoors': 1, 'kpi.doorsPerHour': 20, 'kpi.hoursSource': 'measured',
      'day0.hoursOnDoors': 1, 'day0.hoursSource': 'measured',
    },
    daily: { homesKnocked: 20, noSoliciting: 20, hoursOnDoors: 1, doorsPerHour: 20, hoursSource: 'measured' },
  },
  S3RS: {
    canvassers: { knocks: 0, restricted: 20, hoursOnDoors: 1, doorsPerHour: 0, hoursSource: 'measured', hoursReason: null },
    csv: { Knocks: 0, Restricted: 20, 'Hours on doors': 1, 'Knocks/hr': 0, 'Hours source': 'Measured' },
    timeline: {
      'row.dayKnocks': 0, 'row.dayRestricted': 20, 'row.doorsPerHour': 0, 'row.measuredHoursOnDoors': 1,
      'row.hoursSource': 'measured', 'client.webRowDoorsPerHour': 0, 'client.kpiTileDoorsPerHour': 0,
      'top.measuredKpi': { hoursOnDoors: 1, hoursSource: 'measured' },
    },
    teamAverages: { canvasserCount: 1, hoursSource: 'measured', 'avg.homesKnocked': 0, 'avg.hoursOnDoors': 1, 'avg.doorsPerHour': 0 },
    summary: {
      'kpi.homesKnocked': 0, 'kpi.restricted': 20, 'kpi.hoursOnDoors': 1, 'kpi.doorsPerHour': 0,
      'kpi.hoursSource': 'measured', 'day0.hoursSource': 'measured',
    },
    daily: { homesKnocked: 0, hoursOnDoors: 1, doorsPerHour: 0, hoursSource: 'measured' },
  },
};
const WHY_S2 = {
  canvassers: { hoursOnDoors: WHY_RESTRICTED_HOURS },
  csv: { 'Hours on doors': WHY_RESTRICTED_HOURS },
  timeline: { 'row.hoursOnDoors': WHY_RESTRICTED_HOURS },
  teamAverages: { 'avg.hoursOnDoors': WHY_RESTRICTED_HOURS },
  summary: { 'kpi.hoursOnDoors': WHY_RESTRICTED_HOURS },
  daily: { hoursOnDoors: WHY_RESTRICTED_HOURS },
};

const WHY_SLICE =
  'GAP (walk-list / crew slice): the knocks narrow to the slice but the measured denominator is the canvasser\'s WHOLE clocked day. loadMeasuredHours receives organizationId/from/to/tz/campaignId only (reports.js:1051-1057 /canvassers, 2542-2548 timeline, 3105-3111 csv, 3446-3452 team-averages, 3636-3642 summary, 3900-3905 daily — that one without even campaignId) and foldUserHours (hoursSource.js) takes a measured day whole. 20 doors on this slice ÷ 2.0 clocked h = 10/hr, though the pace on the slice was 20/hr (20 doors in its 1h). Each slice is charged the full day: list A 2h + list B 2h = 4h against 2h clocked';
const WHY_CREW_BLIND =
  'this route never reads ?coordinatorId (no crewFilter call — only /canvassers, /canvassers.csv and /canvasser-timeline call it, reports.js:947/3070/2364) so the crew param is silently ignored and the figure is the canvasser\'s whole campaign day (both lists). No shipped client sends coordinatorId here (mobile canvasser drill + compare qsBase = campaignId/effortId/from/to/tz; web CampaignTeamPage sends campaignId only)';
const WHY_SPAN_GAP =
  'BY DESIGN (estimated): the span is first→last tap of the day, 15:00Z→17:30Z = 2.5h including the 30-min break between lists → 40/2.5';
const WHY_BOUNDED_TOTALS =
  'GAP (bounded totals): knocks are clipped to [from..to] (window = zonedDayRange(from,to), reports.js:2358) but the FbTime overlay loads UNBOUNDED in totals mode (reports.js:2544-2545 `from: totalsMode ? null : from`), so the idle clocked day D+1 (4h, inside the canvasser\'s all-time stint, no knocks anywhere → unionDayAllowed) is charged to a window that does not contain it: 1h + 4h = 5h. The same window in day/range mode reads 1h. No shipped client sends totals=1 WITH bounds (web TimelinePage.jsx:149 and mobile admin/timeline.jsx:218-223 send totals=1 only for All time, with no from/to)';
const WHY_IDLE_BY_DESIGN =
  'BY DESIGN (hoursSource.js header, union rule + campaign-scoped attribution): a clocked day with no knocks that lies inside the window AND inside the canvasser\'s stint on this campaign is charged — "clocked in but not knocking" must not flatter the rate. Here D+1 (4h idle) is inside the window';

// ── tests ────────────────────────────────────────────────────────────────────
test('FIXTURE: the real mobile write path stored exactly the scenario rows', { skip }, async () => {
  const mark = RESULTS.length;
  const lead = String(ctx.users.lead._id);
  const coach = String(ctx.users.coach._id);
  const cases = [
    ['NS', 'NS', 'NS', 'NS', 'no_soliciting', 20, `${D}T15:00:00.000Z`, `${D}T16:00:00.000Z`, [lead]],
    ['RS', 'RS', 'RS', 'RS', 'restricted', 20, `${D}T15:00:00.000Z`, `${D}T16:00:00.000Z`, [lead]],
    ['SPL list A', 'SPL', 'SPL', 'A', 'no_soliciting', 20, `${D}T15:00:00.000Z`, `${D}T16:00:00.000Z`, [lead]],
    ['SPL list B', 'SPL', 'SPL', 'B', 'no_soliciting', 20, `${D}T16:30:00.000Z`, `${D}T17:30:00.000Z`, [coach]],
    ['IDL', 'IDL', 'IDL', 'IDL', 'no_soliciting', 40, `${D}T15:00:00.000Z`, `${D2}T16:00:00.000Z`, [lead]],
    ['TNS', 'TNS', 'TNS', 'TNS', 'no_soliciting', 20, TODAY_FIRST, TODAY_LAST, [null]],
    ['TRS', 'TRS', 'TRS', 'TRS', 'restricted', 20, TODAY_FIRST, TODAY_LAST, [null]],
  ];
  for (const [name, uk, ck, lk, actionType, n, first, last, coords] of cases) {
    const rows = await CanvassActivity.find({
      userId: ctx.users[uk]._id, campaignId: ctx.c[ck].campaign._id, effortId: ctx.c[ck].lists[lk].effort._id,
    }).lean();
    expectFields('FIXTURE', `CanvassActivity rows for ${name} (written by POST /api/mobile/households/:id/${actionType === 'restricted' ? 'restricted' : 'no-soliciting'})`, {
      _status: 200,
      rows: rows.length,
      actionTypes: [...new Set(rows.map((r) => r.actionType))],
      distinctDoors: new Set(rows.map((r) => String(r.householdId))).size,
      viaBulk: rows.filter((r) => r.via === 'bulk').length,
      withPassId: rows.filter((r) => r.passId).length,
      coordinatorIds: [...new Set(rows.map((r) => (r.coordinatorId ? String(r.coordinatorId) : null)))],
      first: rows.length ? new Date(Math.min(...rows.map((r) => +r.timestamp))).toISOString() : null,
      last: rows.length ? new Date(Math.max(...rows.map((r) => +r.timestamp))).toISOString() : null,
    }, { rows: n, actionTypes: [actionType], distinctDoors: n, viaBulk: 0, withPassId: n, coordinatorIds: coords, first, last });
  }
  const mid = new Date();
  mid.setHours(0, 0, 0, 0);
  expectFields('FIXTURE', '"today" marks lie after local midnight and before now', {
    _status: 200, afterLocalMidnight: T0 >= mid, beforeNow: Date.parse(TODAY_LAST) < Date.now(),
  }, { afterLocalMidnight: true, beforeNow: true });
  assert.equal(await FbTimeConnection.countDocuments({}), 0, 'no FbTime connection exists yet');
  assertCleanSince(mark, 'FIXTURE');
});

test('S1/S2 GET /mobile/me/today — the map "Today\'s shift" pace, no FbTime', { skip }, async () => {
  const mark = RESULTS.length;
  const mid = new Date();
  mid.setHours(0, 0, 0, 0);
  for (const [since, label] of [
    [mid.toISOString(), 'since = device-local midnight (exactly what map.jsx:493-500 sends, startOfDay.setHours at :498)'],
    [undefined, 'no since → server-local-midnight fallback (me.js:239-241)'],
    [new Date(Date.now() - 40 * HOUR).toISOString(), 'since 40h ago (> 36h) → same fallback'],
  ]) {
    await todayCall('S1', 'TNS', {
      since, label,
      exp: { doorsKnocked: 20, restricted: 0, knockedHomes: 20, firstDoorAt: TODAY_FIRST, lastDoorAt: TODAY_LAST, appPace: '20.0/hr' },
    });
    await todayCall('S2', 'TRS', {
      since, label,
      exp: {
        doorsKnocked: 0, restricted: 20, knockedHomes: 0, restrictedHomes: 20,
        firstDoorAt: TODAY_FIRST, lastDoorAt: TODAY_LAST, appPace: '—',
      },
      why: {
        firstDoorAt: 'restricted taps still open/close the shift window (me.js:109-112) — First/Last door show, Doors stays 0',
        appPace: "formatPace returns '—' when doorsKnocked is 0 (mobile/lib/rates.js)",
      },
    });
  }
  assertCleanSince(mark, 'S1/S2 /today');
});

test('S1/S2 canvasser-timeline WEEK mode (from=2026-03-01&to=2026-05-31, 92 days), no FbTime', { skip }, async () => {
  const mark = RESULTS.length;
  const label = `${WEEK_RANGE} (92 days → week buckets)`;
  const weekTop = { 'top.mode': 'range', 'top.bucket': 'week', 'top.days.length': 14, 'top.days.0': '2026-02-23', 'top.overlapsOmitted': true };
  await six('S1', {
    key: 'NS', user: ctx.users.NS, q: WEEK_RANGE, label,
    exp: { timeline: {
      ...weekTop, ...EXP.S1.timeline, 'row.knocksByDay': { [WEEK_MON]: 20 }, 'row.hoursReason': 'not-connected',
      'top.dayTotals.knocks': { [WEEK_MON]: 20 }, 'top.grandKnocks': 20, 'top.billableKnocks': 20,
      'top.measuredKpi': { hoursOnDoors: null, hoursSource: 'estimated' },
    } },
  });
  await six('S2', {
    key: 'RS', user: ctx.users.RS, q: WEEK_RANGE, label,
    exp: { timeline: {
      ...weekTop, ...EXP.S2.timeline, 'row.knocksByDay': {}, 'top.dayTotals.knocks': {},
      'top.grandKnocks': 0, 'top.billableKnocks': 0, 'top.restrictedDoors': 20,
    } },
    why: { timeline: WHY_S2.timeline },
  });
  // Week mode must still sum PER-DAY spans (reports.js:2348-2354): two 1h knock days two days
  // apart are 2h on doors, not the 49h calendar span D 15:00Z → D+2 16:00Z.
  await six('S1-PROBE-idle', {
    key: 'IDL', user: ctx.users.IDL, q: WEEK_RANGE, label,
    exp: { timeline: {
      ...weekTop, 'row.knocksByDay': { [WEEK_MON]: 40 }, 'row.dayKnocks': 40, 'row.hoursOnDoors': 2,
      'row.doorsPerHour': 20, 'row.hoursSource': 'estimated',
      'client.webRowDoorsPerHour': 20, 'client.mobileCardDoorsPerHour': 20, 'client.kpiTileDoorsPerHour': 20,
    } },
    why: { timeline: { 'row.hoursOnDoors': 'week mode folds DAY buckets to Mondays only in Node; the aggregation still buckets by day, so hours = 1h (D) + 1h (D+2), never the calendar span' } },
  });
  assertCleanSince(mark, 'S1/S2 week mode');
});

test('S1/S2 canvasser-timeline BOUNDED totals (totals=1&from=D&to=D), no FbTime', { skip }, async () => {
  const mark = RESULTS.length;
  const q = `totals=1&${DAY}`;
  const label = `totals=1&${DAY} (campaign-to-date shape, bounded)`;
  const totTop = { 'top.mode': 'totals', 'top.range': { from: D, to: D }, 'row.knocksByDay': 'absent', 'row.knocksByHour': 'absent' };
  await six('S1', { key: 'NS', user: ctx.users.NS, q, label, exp: { timeline: { ...totTop, ...EXP.S1.timeline } } });
  await six('S2', {
    key: 'RS', user: ctx.users.RS, q, label, exp: { timeline: { ...totTop, ...EXP.S2.timeline } },
    why: { timeline: WHY_S2.timeline },
  });
  await six('S1-PROBE-idle', {
    key: 'IDL', user: ctx.users.IDL, q, label,
    exp: { timeline: {
      ...totTop, 'row.dayKnocks': 20, 'row.hoursOnDoors': 1, 'row.doorsPerHour': 20, 'row.hoursSource': 'estimated',
      'client.webRowDoorsPerHour': 20, 'client.kpiTileDoorsPerHour': 20,
    } },
    why: { timeline: { 'row.dayKnocks': 'the D+2 knocks are clipped out by the bounded window' } },
  });
  assertCleanSince(mark, 'S1/S2 bounded totals');
});

test('S1/S2 the six hours endpoints with ?effortId= and ?coordinatorId=, no FbTime', { skip }, async () => {
  const mark = RESULTS.length;
  const lead = ctx.users.lead._id;
  const coach = ctx.users.coach._id;
  // Core: all of the canvasser's work is inside the filter, so the filter must change nothing.
  await six('S1', {
    key: 'NS', user: ctx.users.NS, q: `effortId=${ctx.c.NS.lists.NS.effort._id}&${DAY}`,
    label: `effortId=<Walk list NS>, from=to=${D}`, exp: EXP.S1,
  });
  await six('S1', {
    key: 'NS', user: ctx.users.NS, q: `coordinatorId=${lead}&${DAY}`,
    label: `coordinatorId=<Lena Lead's crew>, from=to=${D}`, exp: EXP.S1,
  });
  await six('S2', {
    key: 'RS', user: ctx.users.RS, q: `effortId=${ctx.c.RS.lists.RS.effort._id}&${DAY}`,
    label: `effortId=<Walk list RS>, from=to=${D}`, exp: EXP.S2, why: WHY_S2,
  });
  await six('S2', {
    key: 'RS', user: ctx.users.RS, q: `coordinatorId=${lead}&${DAY}`,
    label: `coordinatorId=<Lena Lead's crew>, from=to=${D}`, exp: EXP.S2, why: WHY_S2,
  });

  // PROBE-split, estimated: the span narrows with the knocks, so every crew-aware slice reads 20/hr.
  const slice = {
    canvassers: { knocks: 20, noSoliciting: 20, hoursOnDoors: 1, doorsPerHour: 20, hoursSource: 'estimated' },
    csv: { Knocks: 20, 'Hours on doors': 1, 'Knocks/hr': 20 },
    timeline: {
      'row.dayKnocks': 20, 'row.hoursOnDoors': 1, 'row.doorsPerHour': 20,
      'client.webRowDoorsPerHour': 20, 'client.mobileCardDoorsPerHour': 20, 'client.kpiTileDoorsPerHour': 20,
    },
    teamAverages: { canvasserCount: 1, 'avg.homesKnocked': 20, 'avg.hoursOnDoors': 1, 'avg.doorsPerHour': 20 },
    summary: { 'kpi.homesKnocked': 20, 'kpi.hoursOnDoors': 1, 'kpi.doorsPerHour': 20 },
    daily: { homesKnocked: 20, hoursOnDoors: 1, doorsPerHour: 20 },
  };
  await six('S1-PROBE-split', {
    key: 'SPL', user: ctx.users.SPL, q: `effortId=${ctx.c.SPL.lists.B.effort._id}&${DAY}`,
    label: `effortId=<Walk list B> (2nd hour), from=to=${D}`, exp: slice,
  });
  await six('S1-PROBE-split', {
    key: 'SPL', user: ctx.users.SPL, q: `effortId=${ctx.c.SPL.lists.A.effort._id}&${DAY}`,
    label: `effortId=<Walk list A> (1st hour), from=to=${D}`, exp: { canvassers: slice.canvassers, timeline: slice.timeline },
  });
  const blindWhy = {
    'kpi.homesKnocked': WHY_CREW_BLIND, 'kpi.hoursOnDoors': WHY_CREW_BLIND, 'kpi.doorsPerHour': WHY_CREW_BLIND,
    'avg.homesKnocked': WHY_CREW_BLIND, 'avg.hoursOnDoors': WHY_CREW_BLIND, 'avg.doorsPerHour': WHY_CREW_BLIND,
    homesKnocked: WHY_CREW_BLIND, hoursOnDoors: WHY_CREW_BLIND, doorsPerHour: WHY_CREW_BLIND,
  };
  await six('S1-PROBE-split', {
    key: 'SPL', user: ctx.users.SPL, q: `coordinatorId=${coach}&${DAY}`,
    label: `coordinatorId=<Cole Coach's crew> (2nd hour), from=to=${D}`, exp: slice,
    why: { teamAverages: blindWhy, summary: blindWhy, daily: blindWhy },
  });
  // Context: the unfiltered campaign day.
  await six('S1-PROBE-split', {
    key: 'SPL', user: ctx.users.SPL, q: DAY, label: `no filter, from=to=${D}`,
    exp: {
      canvassers: { knocks: 40, hoursOnDoors: 2.5, doorsPerHour: 16, hoursSource: 'estimated' },
      timeline: { 'row.dayKnocks': 40, 'row.hoursOnDoors': 2.5, 'row.doorsPerHour': 16, 'client.webRowDoorsPerHour': 16 },
    },
    why: { canvassers: { doorsPerHour: WHY_SPAN_GAP }, timeline: { 'row.doorsPerHour': WHY_SPAN_GAP } },
  });
  assertCleanSince(mark, 'S1/S2 filters');
});

test('S1/S2 the six hours endpoints called by a TEAM LEAD, no FbTime', { skip }, async () => {
  const mark = RESULTS.length;
  await leadChecks('S1', { key: 'NS', user: ctx.users.NS, q: DAY, label: `from=to=${D}`, exp: EXP.S1 });
  await leadChecks('S2', { key: 'RS', user: ctx.users.RS, q: DAY, label: `from=to=${D}`, exp: EXP.S2, why: WHY_S2 });
  // The lead tier stays campaign-scoped (reports.js:115-120).
  for (const [path, label] of [
    [`/admin/reports/canvassers?all=1&${DAY}`, 'all=1 (org-wide)'],
    [`/admin/reports/canvassers?${DAY}`, 'no campaignId'],
    [`/admin/reports/canvassers?campaignId=${ctx.c.TNS.campaign._id}&${DAY}`, 'a campaign the lead holds no grant for'],
  ]) {
    const r = await call('GET', path, as('lead'));
    expectFields('LEAD-SCOPE', `GET /api/admin/reports/canvassers [lead; ${label}]`, { _status: r.status }, { _status: 403 });
  }
  assertCleanSince(mark, 'S1/S2 lead');
});

test('FBTIME: connect the org, link every canvasser, cache closed shifts', { skip }, async () => {
  const org = ctx.org._id;
  await FbTimeConnection.create({
    organizationId: org, status: 'connected', hourFigure: 'adjustedHours', keyCiphertext: 'unused-here',
    keyPrefix: 'fbt_test_xx', fbtimeOrgId: 'f1', fbtimeOrgName: 'Fake',
  });
  const todayClockIn = new Date(T0.getTime() - 5 * MIN).toISOString();
  const people = [
    ['NS', 'bbbbbbbbbbbbbbbbbbbbbbb1', [[`${D}T15:00:00.000Z`, 1]]],
    ['RS', 'bbbbbbbbbbbbbbbbbbbbbbb2', [[`${D}T15:00:00.000Z`, 1]]],
    ['SPL', 'bbbbbbbbbbbbbbbbbbbbbbb3', [[`${D}T15:00:00.000Z`, 2]]],
    // D+1 is the idle clocked day: 4h, no knocks anywhere.
    ['IDL', 'bbbbbbbbbbbbbbbbbbbbbbb4', [[`${D}T15:00:00.000Z`, 1], [`${D1}T15:00:00.000Z`, 4], [`${D2}T15:00:00.000Z`, 1]]],
    ['TNS', 'bbbbbbbbbbbbbbbbbbbbbbb5', [[todayClockIn, 1]]],
    ['TRS', 'bbbbbbbbbbbbbbbbbbbbbbb6', [[todayClockIn, 1]]],
  ];
  let n = 0;
  for (const [k, pid, shifts] of people) {
    const u = ctx.users[k];
    await FbTimePersonLink.create({
      organizationId: org, userId: u._id, fbtimePersonId: pid, fbtimeEmail: u.email,
      fbtimeName: `${u.firstName} ${u.lastName}`, source: 'manual',
    });
    for (const [clockIn, hours] of shifts) {
      n += 1;
      await FbTimeShift.create({
        organizationId: org, shiftId: `sh-${k}-${n}`, fbtimePersonId: pid, userId: u._id, clockIn: new Date(clockIn),
        grossHours: hours, adjustedHours: hours, workedHours: hours, isOpen: false,
      });
    }
  }
  assert.equal(await FbTimeShift.countDocuments({ organizationId: org }), 8);
  assert.equal(await FbTimePersonLink.countDocuments({ organizationId: org }), 6);
});

test('S3 GET /mobile/me/today with FbTime connected and a 1.0h shift today', { skip }, async () => {
  const mark = RESULTS.length;
  const mid = new Date();
  mid.setHours(0, 0, 0, 0);
  const why = {
    appPace: 'BY DESIGN of the canvasser app: /today never reads FbTime — its pace is doorsKnocked over the first→last tap span (1.0h here, equal to the measured 1.0h)',
  };
  await todayCall('S3', 'TNS', {
    since: mid.toISOString(), label: 'since = device-local midnight; FbTime shift today 1.0h',
    exp: { doorsKnocked: 20, restricted: 0, firstDoorAt: TODAY_FIRST, lastDoorAt: TODAY_LAST, appPace: '20.0/hr' }, why,
  });
  await todayCall('S3', 'TRS', {
    since: mid.toISOString(), label: 'since = device-local midnight; FbTime shift today 1.0h',
    exp: { doorsKnocked: 0, restricted: 20, appPace: '—' },
  });
  assertCleanSince(mark, 'S3 /today');
});

test('S3 canvasser-timeline WEEK mode and BOUNDED totals, measured', { skip }, async () => {
  const mark = RESULTS.length;
  const weekTop = { 'top.mode': 'range', 'top.bucket': 'week', 'row.knocksByDay': { [WEEK_MON]: 20 } };
  await six('S3', {
    key: 'NS', user: ctx.users.NS, q: WEEK_RANGE, label: `${WEEK_RANGE} (week buckets)`,
    exp: { timeline: { ...weekTop, ...EXP.S3.timeline } },
  });
  await six('S3', {
    key: 'RS', user: ctx.users.RS, q: WEEK_RANGE, label: `${WEEK_RANGE} (week buckets)`,
    exp: { timeline: { 'top.bucket': 'week', ...EXP.S3RS.timeline } },
  });
  const totTop = { 'top.mode': 'totals', 'top.range': { from: D, to: D } };
  await six('S3', {
    key: 'NS', user: ctx.users.NS, q: `totals=1&${DAY}`, label: `totals=1&${DAY} (bounded)`,
    exp: { timeline: { ...totTop, ...EXP.S3.timeline } },
  });
  await six('S3', {
    key: 'RS', user: ctx.users.RS, q: `totals=1&${DAY}`, label: `totals=1&${DAY} (bounded)`,
    exp: { timeline: { ...totTop, ...EXP.S3RS.timeline } },
  });
  assertCleanSince(mark, 'S3 week + bounded totals');
});

test('S3 the six hours endpoints with ?effortId= and ?coordinatorId=, measured', { skip }, async () => {
  const mark = RESULTS.length;
  const lead = ctx.users.lead._id;
  await six('S3', {
    key: 'NS', user: ctx.users.NS, q: `effortId=${ctx.c.NS.lists.NS.effort._id}&${DAY}`,
    label: `effortId=<Walk list NS>, from=to=${D}`, exp: EXP.S3,
  });
  await six('S3', {
    key: 'NS', user: ctx.users.NS, q: `coordinatorId=${lead}&${DAY}`,
    label: `coordinatorId=<Lena Lead's crew>, from=to=${D}`, exp: EXP.S3,
  });
  await six('S3', {
    key: 'RS', user: ctx.users.RS, q: `effortId=${ctx.c.RS.lists.RS.effort._id}&${DAY}`,
    label: `effortId=<Walk list RS>, from=to=${D}`, exp: EXP.S3RS,
  });
  await six('S3', {
    key: 'RS', user: ctx.users.RS, q: `coordinatorId=${lead}&${DAY}`,
    label: `coordinatorId=<Lena Lead's crew>, from=to=${D}`, exp: EXP.S3RS,
  });
  assertCleanSince(mark, 'S3 filters');
});

test('S3 the six hours endpoints called by a TEAM LEAD, measured (+ what FbTime data the lead receives)', { skip }, async () => {
  const mark = RESULTS.length;
  await leadChecks('S3', { key: 'NS', user: ctx.users.NS, q: DAY, label: `from=to=${D}`, exp: EXP.S3, privacy: true });
  await leadChecks('S3', { key: 'RS', user: ctx.users.RS, q: DAY, label: `from=to=${D}`, exp: EXP.S3RS, privacy: true });
  // PROBE-idle as the lead: over D..D+1 the lead reads 5h for a canvasser whose knock span is 1h —
  // the extra 4h is an FbTime-only fact (clocked 4h on D+1 with zero knocks).
  const idleWhy = {
    'row.measuredHoursOnDoors': WHY_IDLE_BY_DESIGN, hoursOnDoors: WHY_IDLE_BY_DESIGN, 'kpi.hoursOnDoors': WHY_IDLE_BY_DESIGN,
  };
  await leadChecks('S3-PROBE-idle', {
    key: 'IDL', user: ctx.users.IDL, q: `from=${D}&to=${D1}`, label: `from=${D}&to=${D1} (D+1 = 4h idle clocked day)`,
    exp: {
      canvassers: { knocks: 20, hoursOnDoors: 5, doorsPerHour: 4, hoursSource: 'measured' },
      timeline: {
        'row.dayKnocks': 20, 'row.hoursOnDoors': 1, 'row.measuredHoursOnDoors': 5, 'row.hoursSource': 'measured',
        'client.webRowDoorsPerHour': 4,
      },
      summary: { 'kpi.homesKnocked': 20, 'kpi.hoursOnDoors': 5, 'kpi.doorsPerHour': 4, 'day0.hoursOnDoors': 1, 'day0.hoursSource': 'measured' },
      daily: { homesKnocked: 20, hoursOnDoors: 1, doorsPerHour: 20, hoursSource: 'measured' },
    },
    why: { canvassers: idleWhy, timeline: idleWhy, summary: idleWhy },
    privacy: true,
  });
  assertCleanSince(mark, 'S3 lead');
});

test('S3-PROBE-split: walk-list / crew slices of a 2.0h measured day', { skip }, async () => {
  const mark = RESULTS.length;
  const coach = ctx.users.coach._id;
  // Expected = the honest per-slice pace: 20 doors in the 1h spent on that slice.
  const honest = {
    canvassers: { knocks: 20, noSoliciting: 20, hoursOnDoors: 1, doorsPerHour: 20, hoursSource: 'measured' },
    csv: { Knocks: 20, 'Hours on doors': 1, 'Knocks/hr': 20, 'Hours source': 'Measured' },
    timeline: {
      'row.dayKnocks': 20, 'row.hoursOnDoors': 1, 'row.doorsPerHour': 20, 'row.measuredHoursOnDoors': 1,
      'row.hoursSource': 'measured',
      'client.webRowDoorsPerHour': 20, 'client.mobileCardDoorsPerHour': 20, 'client.kpiTileDoorsPerHour': 20,
    },
    teamAverages: { canvasserCount: 1, hoursSource: 'measured', 'avg.homesKnocked': 20, 'avg.hoursOnDoors': 1, 'avg.doorsPerHour': 20 },
    summary: {
      'kpi.homesKnocked': 20, 'kpi.hoursOnDoors': 1, 'kpi.doorsPerHour': 20, 'kpi.hoursSource': 'measured',
      'day0.hoursOnDoors': 1,
    },
    daily: { homesKnocked: 20, hoursOnDoors: 1, doorsPerHour: 20, hoursSource: 'measured' },
  };
  const sliceWhy = {
    canvassers: { hoursOnDoors: WHY_SLICE, doorsPerHour: WHY_SLICE },
    csv: { 'Hours on doors': WHY_SLICE, 'Knocks/hr': WHY_SLICE },
    timeline: {
      'row.measuredHoursOnDoors': WHY_SLICE, 'client.webRowDoorsPerHour': WHY_SLICE,
      'client.mobileCardDoorsPerHour': WHY_SLICE, 'client.kpiTileDoorsPerHour': WHY_SLICE,
    },
    teamAverages: { 'avg.hoursOnDoors': WHY_SLICE, 'avg.doorsPerHour': WHY_SLICE },
    summary: { 'kpi.hoursOnDoors': WHY_SLICE, 'kpi.doorsPerHour': WHY_SLICE, 'day0.hoursOnDoors': WHY_SLICE },
    daily: { hoursOnDoors: WHY_SLICE, doorsPerHour: WHY_SLICE },
  };
  await six('S3-PROBE-split', {
    key: 'SPL', user: ctx.users.SPL, q: `effortId=${ctx.c.SPL.lists.B.effort._id}&${DAY}`,
    label: `effortId=<Walk list B> (2nd hour), from=to=${D}`, exp: honest, why: sliceWhy,
  });
  await six('S3-PROBE-split', {
    key: 'SPL', user: ctx.users.SPL, q: `effortId=${ctx.c.SPL.lists.A.effort._id}&${DAY}`,
    label: `effortId=<Walk list A> (1st hour), from=to=${D}`,
    exp: { canvassers: honest.canvassers, timeline: honest.timeline },
    why: { canvassers: sliceWhy.canvassers, timeline: sliceWhy.timeline },
  });
  const blind = (k) => Object.fromEntries(Object.keys(honest[k]).map((f) => [f, WHY_CREW_BLIND]));
  await six('S3-PROBE-split', {
    key: 'SPL', user: ctx.users.SPL, q: `coordinatorId=${coach}&${DAY}`,
    label: `coordinatorId=<Cole Coach's crew> (2nd hour), from=to=${D}`, exp: honest,
    why: {
      canvassers: sliceWhy.canvassers, csv: sliceWhy.csv, timeline: sliceWhy.timeline,
      teamAverages: blind('teamAverages'), summary: blind('summary'), daily: blind('daily'),
    },
  });
  // Context: the unfiltered campaign day — the measured denominator is right at this grain.
  await six('S3-PROBE-split', {
    key: 'SPL', user: ctx.users.SPL, q: DAY, label: `no filter, from=to=${D}`,
    exp: {
      canvassers: { knocks: 40, hoursOnDoors: 2, doorsPerHour: 20, hoursSource: 'measured' },
      timeline: { 'row.dayKnocks': 40, 'row.measuredHoursOnDoors': 2, 'client.webRowDoorsPerHour': 20 },
    },
  });
  assertCleanSince(mark, 'S3-PROBE-split');
});

test('S3-PROBE-idle: bounded totals vs the same window in day/range mode, measured', { skip }, async () => {
  const mark = RESULTS.length;
  const user = ctx.users.IDL;
  await six('S3-PROBE-idle', {
    key: 'IDL', user, q: DAY, label: `${DAY} (single-day mode — the reference for this window)`,
    exp: { timeline: {
      'row.dayKnocks': 20, 'row.hoursOnDoors': 1, 'row.measuredHoursOnDoors': 1, 'row.hoursSource': 'measured',
      'client.webRowDoorsPerHour': 20, 'client.mobileCardDoorsPerHour': 20, 'client.kpiTileDoorsPerHour': 20,
      'top.measuredKpi': { hoursOnDoors: 1, hoursSource: 'measured' },
    } },
  });
  await six('S3-PROBE-idle', {
    key: 'IDL', user, q: `totals=1&${DAY}`, label: `totals=1&${DAY} (bounded totals — same window)`,
    exp: { timeline: {
      'top.mode': 'totals', 'top.range': { from: D, to: D },
      'row.dayKnocks': 20, 'row.hoursOnDoors': 1, 'row.doorsPerHour': 20, 'row.measuredHoursOnDoors': 1,
      'row.hoursSource': 'measured',
      'client.webRowDoorsPerHour': 20, 'client.mobileCardDoorsPerHour': 20, 'client.kpiTileDoorsPerHour': 20,
      'top.measuredKpi': { hoursOnDoors: 1, hoursSource: 'measured' },
    } },
    why: { timeline: {
      'row.measuredHoursOnDoors': WHY_BOUNDED_TOTALS, 'client.webRowDoorsPerHour': WHY_BOUNDED_TOTALS,
      'client.mobileCardDoorsPerHour': WHY_BOUNDED_TOTALS, 'client.kpiTileDoorsPerHour': WHY_BOUNDED_TOTALS,
      'top.measuredKpi': WHY_BOUNDED_TOTALS,
    } },
  });
  // Context rows: windows that DO contain the idle day charge it by design.
  await six('S3-PROBE-idle', {
    key: 'IDL', user, q: `from=${D}&to=${D1}`, label: `from=${D}&to=${D1} (range mode; contains the idle day)`,
    exp: { timeline: {
      'row.dayKnocks': 20, 'row.measuredHoursOnDoors': 5, 'client.webRowDoorsPerHour': 4,
      'top.measuredKpi': { hoursOnDoors: 5, hoursSource: 'measured' },
    } },
    why: { timeline: { 'row.measuredHoursOnDoors': WHY_IDLE_BY_DESIGN } },
  });
  await six('S3-PROBE-idle', {
    key: 'IDL', user, q: WEEK_RANGE, label: `${WEEK_RANGE} (week buckets; contains the idle day)`,
    exp: { timeline: {
      'top.bucket': 'week', 'row.knocksByDay': { [WEEK_MON]: 40 }, 'row.dayKnocks': 40, 'row.hoursOnDoors': 2,
      'row.measuredHoursOnDoors': 6, 'row.hoursSource': 'measured',
      'client.webRowDoorsPerHour': 6.67, 'client.mobileCardDoorsPerHour': 6.67, 'client.kpiTileDoorsPerHour': 6.67,
    } },
    why: { timeline: { 'row.measuredHoursOnDoors': WHY_IDLE_BY_DESIGN } },
  });
  await six('S3-PROBE-idle', {
    key: 'IDL', user, q: 'totals=1', label: 'totals=1 (unbounded — what the All time chip sends)',
    exp: { timeline: {
      'top.mode': 'totals', 'top.range': { from: null, to: null },
      'row.dayKnocks': 40, 'row.hoursOnDoors': 2, 'row.measuredHoursOnDoors': 6, 'client.webRowDoorsPerHour': 6.67,
    } },
    why: { timeline: { 'row.measuredHoursOnDoors': WHY_IDLE_BY_DESIGN } },
  });
  assertCleanSince(mark, 'S3-PROBE-idle');
});

test('DUMP: write every recorded expected/actual pair to the scratchpad', { skip }, () => {
  flush();
  const failed = RESULTS.filter((r) => !r.pass);
  console.log(`SUMMARY ${JSON.stringify({ total: RESULTS.length, passed: RESULTS.length - failed.length, failed: failed.length })}`);
  for (const f of failed) console.log(`MISMATCH ${JSON.stringify(f)}`);
});
