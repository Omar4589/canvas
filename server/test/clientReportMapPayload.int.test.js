import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import mongoose from 'mongoose';

// The client map's payload — code review round 1 PUBUX-4 and contract C7 — against the real app and a
// throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/crmap node --test test/clientReportMapPayload.int.test.js
//
// The pins payload is streamed from the rows (never loaded whole), gzipped once and kept in a small
// in-process cache keyed by what fixes its bytes; concurrent first opens build it once. The JSON is
// byte-for-byte what the old load-everything build produced (a reference copy of it lives below),
// gzip goes out only to a request that accepts it, and every header stays. The report payload carries
// an opaque visibility.mapVersion that moves whenever what the map serves does. An expired entry
// leaves memory on a sweep, not only when it is asked for again (P-1).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-client-report-map-payload';
process.env.REDIS_URL = 'redis://127.0.0.1:1';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ClientReportMapPoint } = await import('../src/models/ClientReportMapPoint.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { backfillLegacyRows, mapCacheStats, clearMapCache } = await import('../src/services/reports/clientReportMap.js');
const { growExtent } = await import('../src/services/reports/areaCells.js');
const bcrypt = (await import('bcryptjs')).default;

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;

let server;
let base;
const ctx = {};

// Raw HTTP, so the test sees the bytes on the wire (fetch would decode gzip silently).
const raw = (path, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = http.get(`${base}/api${path}`, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
  });
const decoded = (r) => (r.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(r.body) : r.body);
// Each report through its own link (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C2): the pins report's, unless
// another is named.
const share = (path, headers = {}, link = ctx.links.pins) => raw(`/share/${link.token}${path}`, { 'X-Share-Token': link.access, ...headers });
const admin = async (method, path, body) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.adminToken}`, 'X-Org-Id': String(ctx.org._id) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};

// ── The OLD build, kept verbatim as the reference the streamed one must equal byte for byte ─────────
const STATUS_ORDER = ['surveyed', 'lit_dropped', 'refused', 'not_target', 'not_home', 'wrong_address', 'no_soliciting', 'restricted'];
const referencePins = async (report, keys) => {
  const extentStored = await backfillLegacyRows(report);
  const rows = await ClientReportMapPoint.find({ clientReportId: report._id, snapshotId: report.snapshotId ?? null }, { lng: 1, lat: 1, status: 1, answers: 1, seq: 1 })
    .sort({ seq: 1, _id: 1 })
    .lean();
  const byKey = new Map((report.stats?.cumulative?.surveyBreakdowns || []).map((b) => [b.questionKey, b]));
  const questions = keys.filter((k) => byKey.has(k)).map((k) => {
    const b = byKey.get(k);
    return { key: k, label: b.questionLabel || '', type: b.type, options: (b.options || []).map((o) => o.option) };
  });
  const allowed = new Set(questions.map((q) => q.key));
  const statusKeys = [...STATUS_ORDER];
  const statusIndex = new Map(statusKeys.map((s, i) => [s, i]));
  const n = rows.reduce((max, r) => Math.max(max, (r.seq ?? -1) + 1), 0);
  const size = Math.max(n, rows.length);
  const lng = new Array(size).fill(null);
  const lat = new Array(size).fill(null);
  const status = new Array(size).fill(null);
  const answers = Object.fromEntries(questions.map((q) => [q.key, new Array(size).fill(null)]));
  const optionIndex = new Map(questions.map((q) => [q.key, new Map(q.options.map((o, i) => [o, i]))]));
  const indexOf = (q, label) => {
    const map = optionIndex.get(q.key);
    if (!map.has(label)) {
      q.options.push(label);
      map.set(label, q.options.length - 1);
    }
    return map.get(label);
  };
  const qByKey = new Map(questions.map((q) => [q.key, q]));
  let extent = extentStored;
  rows.forEach((p, i) => {
    const at = p.seq ?? i;
    lng[at] = Math.round(p.lng * 1e6) / 1e6;
    lat[at] = Math.round(p.lat * 1e6) / 1e6;
    if (!statusIndex.has(p.status)) {
      statusKeys.push(p.status);
      statusIndex.set(p.status, statusKeys.length - 1);
    }
    status[at] = statusIndex.get(p.status);
    for (const a of p.answers || []) {
      if (!allowed.has(a.questionKey) || a.answer == null) continue;
      const q = qByKey.get(a.questionKey);
      answers[a.questionKey][at] = Array.isArray(a.answer) ? a.answer.map((x) => indexOf(q, x)) : indexOf(q, a.answer);
    }
    if (!extentStored) extent = growExtent(extent, p.lng, p.lat);
  });
  return JSON.stringify({ mode: 'pins', snapshotKey: report.snapshotKey || 'legacy', count: rows.length, statusKeys, lng, lat, status, questions, answers, extent: extent || null });
};

const breakdowns = [
  { questionKey: 'support', questionLabel: 'Support?', type: 'single_choice', options: [{ option: 'Yes', count: 3, percent: 60 }, { option: 'No', count: 2, percent: 40 }] },
  { questionKey: 'issues', questionLabel: 'Issues', type: 'multiple_choice', options: [{ option: 'Schools', count: 2, percent: 50 }, { option: 'Roads', count: 2, percent: 50 }] },
  { questionKey: 'hidden', questionLabel: 'Hidden', type: 'single_choice', options: [{ option: 'A', count: 1, percent: 100 }] },
];
const reportDoc = (extra) => ({
  organizationId: ctx.org._id, campaignId: ctx.camp._id, status: 'published', publishedAt: new Date('2026-07-14T12:00:00Z'),
  weekStart: '2026-07-06', weekEnd: '2026-07-12', timeZone: 'America/Chicago',
  rangeStartUtc: new Date('2026-07-06T05:00:00Z'), rangeEndUtc: new Date('2026-07-13T05:00:00Z'),
  statsComputedAt: new Date('2026-07-14T12:00:00Z'), editVersion: 0,
  stats: { cumulative: { totals: { doorsKnocked: 9 }, surveyBreakdowns: breakdowns }, period: { totals: { doorsKnocked: 9 }, surveyBreakdowns: breakdowns } },
  visibility: { visibleQuestionKeys: ['support', 'issues'], mapAnswerKeys: ['support', 'issues'], showMap: true, mapMode: 'pins', areaSize: 'small', visibleTags: [], showGoal: false },
  ...extra,
});
const STATUSES = ['surveyed', 'not_home', 'refused', 'mystery_status', 'surveyed', 'lit_dropped', 'surveyed', 'wrong_address', 'surveyed'];
const pointsOf = (reportId, snapshotId, { withSeq = true } = {}) =>
  STATUSES.map((status, i) => ({
    clientReportId: reportId, organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: new ObjectId(),
    lng: -82.4 + i / 1e4 + 1e-9 * i, lat: 27.9 + i / 1e4, addressLine1: `${i} Byte St`, city: 'Tampa', state: 'FL', status,
    ...(snapshotId ? { snapshotId } : {}),
    // A gap at position 4, a repeated position (6 twice), and a far one (20): holes read null.
    ...(withSeq ? { seq: [0, 1, 2, 3, 5, 6, 6, 7, 20][i] } : {}),
    answers: status === 'surveyed'
      ? [
          // An old label the breakdown no longer lists: it joins the legend in the order it is met.
          { questionKey: 'support', answer: i === 4 ? 'Leaning yes' : i % 2 ? 'No' : 'Yes' },
          { questionKey: 'issues', answer: i === 6 ? ['Roads', 'Parks'] : ['Schools'] },
          { questionKey: 'hidden', answer: 'A' },
        ]
      : i === 2 ? [{ questionKey: 'support', answer: null }] : [],
  }));

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await ClientReportMapPoint.syncIndexes();
  const org = await Organization.create({ name: 'Map Org', slug: 'map-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const user = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ada@crmap.t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: user._id, organizationId: org._id, role: 'admin', isActive: true });
  // The survey the old report's answers came from: a report from before snapshots maps only
  // questions of a survey its campaign used (fail closed).
  const survey = await SurveyTemplate.create({
    organizationId: org._id, name: 'Doors', isActive: true,
    questions: [
      { key: 'support', label: 'Support?', type: 'single_choice', options: [{ id: 'y', text: 'Yes' }, { id: 'n', text: 'No' }] },
      { key: 'issues', label: 'Issues', type: 'multiple_choice', options: [{ id: 's', text: 'Schools' }, { id: 'r', text: 'Roads' }] },
      { key: 'hidden', label: 'Hidden', type: 'single_choice', options: [{ id: 'a', text: 'A' }] },
    ],
  });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Map', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/Chicago', surveyTemplateId: survey._id });
  Object.assign(ctx, { org, camp, adminToken: signUserToken(user) });

  const snap = new ObjectId();
  const si = { showMap: true, mapMode: 'pins', areaSize: 'small', mapKeys: ['support', 'issues'], questionDeps: [], coordinatorIds: [] };
  const pins = await ClientReport.create(reportDoc({ title: 'Pins', snapshotId: snap, snapshotKey: 'pinsKey000000001', snapshotInputs: si, mapPointCount: 9, extent: null }));
  await ClientReportMapPoint.collection.insertMany(pointsOf(pins._id, snap));
  // A report published before snapshots: rows with no positions yet, no stored extent.
  const legacy = await ClientReport.create(reportDoc({ title: 'Legacy', weekStart: '2026-06-29', weekEnd: '2026-07-05', rangeStartUtc: new Date('2026-06-29T05:00:00Z'), rangeEndUtc: new Date('2026-07-06T05:00:00Z'), snapshotId: null, mapPointCount: 9 }));
  await ClientReportMapPoint.collection.insertMany(pointsOf(legacy._id, null, { withSeq: false }));
  for (const [token, r] of [['crmap-token', pins], ['crmap-legacy-token', legacy]]) {
    await ReportShareLink.create({
      organizationId: org._id, campaignId: camp._id, token, label: 'Client', reportId: r._id,
      passwordHash: await bcrypt.hash('crmap-password-1', 4), expiresAt: new Date(Date.now() + 86400e3), isActive: true,
    });
  }
  Object.assign(ctx, { pins, legacy, token: 'crmap-token' });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const unlock = async (token) => {
    const res = await fetch(`${base}/api/share/${token}/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'crmap-password-1' }) });
    return { token, access: (await res.json()).accessToken };
  };
  ctx.links = { pins: await unlock('crmap-token'), legacy: await unlock('crmap-legacy-token') };
  ctx.access = ctx.links.pins.access;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('the streamed payload is byte-for-byte the old build — pins and a report from before snapshots', { skip }, async () => {
  clearMapCache();
  for (const r of [ctx.pins, ctx.legacy]) {
    const link = r === ctx.pins ? ctx.links.pins : ctx.links.legacy;
    const plain = await share(`/reports/${r._id}/map`, { 'Accept-Encoding': 'identity' }, link);
    assert.strictEqual(plain.status, 200, plain.body.toString());
    assert.strictEqual(plain.headers['content-encoding'], undefined, 'no gzip to a request that does not ask for it');
    const fresh = await ClientReport.findById(r._id).lean();
    const expected = await referencePins(fresh, ['support', 'issues']);
    assert.strictEqual(plain.body.toString('utf8'), expected, `${r.title}: identical bytes`);
    const gz = await share(`/reports/${r._id}/map`, { 'Accept-Encoding': 'gzip, deflate, br' }, link);
    assert.strictEqual(gz.headers['content-encoding'], 'gzip');
    assert.strictEqual(Number(gz.headers['content-length']), gz.body.length);
    assert.strictEqual(decoded(gz).toString('utf8'), expected, `${r.title}: identical once decoded`);
  }
  const pins = JSON.parse(decoded(await share(`/reports/${ctx.pins._id}/map`, { 'Accept-Encoding': 'gzip' })).toString());
  assert.strictEqual(pins.lng.length, 21, 'as long as the highest position + 1');
  assert.strictEqual(pins.lng[4], null, 'a gap reads null');
  assert.ok(!('hidden' in pins.answers), 'a question off the map never rides');
  assert.ok(pins.questions[0].options.includes('Leaning yes'));
});

test('every header stays: no-store, noindex, Vary, the ETag — and its 304', { skip }, async () => {
  const r = await share(`/reports/${ctx.pins._id}/map`, { 'Accept-Encoding': 'gzip' });
  assert.strictEqual(r.headers['cache-control'], 'no-store');
  assert.strictEqual(r.headers['x-robots-tag'], 'noindex, nofollow');
  assert.match(r.headers['content-type'], /^application\/json; charset=utf-8$/);
  assert.match(r.headers.vary, /Accept-Encoding/);
  assert.match(r.headers.etag, /^W\/"/);
  const again = await share(`/reports/${ctx.pins._id}/map`, { 'Accept-Encoding': 'gzip', 'If-None-Match': r.headers.etag });
  assert.strictEqual(again.status, 304);
  assert.strictEqual(again.body.length, 0);
  // The refusals are untouched JSON: a stale page, a missing access.
  const stale = await share(`/reports/${ctx.pins._id}/map?snapshotKey=old`, { 'Accept-Encoding': 'gzip' });
  assert.strictEqual(stale.status, 409);
  assert.strictEqual(JSON.parse(decoded(stale).toString()).code, 'MAP_UPDATED');
  assert.strictEqual((await raw(`/share/${ctx.token}/reports/${ctx.pins._id}/map`)).status, 401);
});

test('concurrent first opens build once; later opens come from the cache; the budget is honored', { skip }, async () => {
  clearMapCache();
  const realFind = ClientReportMapPoint.find.bind(ClientReportMapPoint);
  let builds = 0;
  ClientReportMapPoint.find = (filter, projection, ...rest) => {
    if (String(filter?.clientReportId) === String(ctx.pins._id) && projection?.lng) builds += 1;
    return realFind(filter, projection, ...rest);
  };
  try {
    const all = await Promise.all(Array.from({ length: 6 }, () => share(`/reports/${ctx.pins._id}/map`, { 'Accept-Encoding': 'gzip' })));
    assert.ok(all.every((r) => r.status === 200 && r.body.equals(all[0].body)), 'the same bytes for everyone');
    assert.strictEqual(builds, 1, 'six concurrent first opens, one build');
    await share(`/reports/${ctx.pins._id}/map`, { 'Accept-Encoding': 'gzip' });
    // The admin preview reads the same bytes from the same entry.
    const preview = await fetch(`${base}/api/admin/client-reports/${ctx.pins._id}/preview/map`, { headers: { Authorization: `Bearer ${ctx.adminToken}`, 'X-Org-Id': String(ctx.org._id) } });
    assert.strictEqual(preview.status, 200);
    assert.strictEqual(Buffer.from(await preview.arrayBuffer()).toString(), decoded(all[0]).toString());
    assert.strictEqual(builds, 1, 'later opens and the preview are served from the cache');
    assert.ok(mapCacheStats().entries >= 1);
  } finally {
    ClientReportMapPoint.find = realFind;
  }
  // A budget smaller than the payload keeps nothing (and still serves it).
  const prev = process.env.CLIENT_REPORT_MAP_CACHE_MB;
  process.env.CLIENT_REPORT_MAP_CACHE_MB = '0.0001';
  try {
    clearMapCache();
    assert.strictEqual((await share(`/reports/${ctx.pins._id}/map`, { 'Accept-Encoding': 'gzip' })).status, 200);
    assert.strictEqual(mapCacheStats().entries, 0);
  } finally {
    if (prev === undefined) delete process.env.CLIENT_REPORT_MAP_CACHE_MB;
    else process.env.CLIENT_REPORT_MAP_CACHE_MB = prev;
  }
});

test('P-1: an expired payload nobody asks for again leaves memory on the sweep — no lookup needed', { skip }, async () => {
  const saved = { ttl: process.env.CLIENT_REPORT_MAP_CACHE_TTL_MS, every: process.env.CLIENT_REPORT_MAP_CACHE_SWEEP_MS };
  process.env.CLIENT_REPORT_MAP_CACHE_TTL_MS = '150';
  process.env.CLIENT_REPORT_MAP_CACHE_SWEEP_MS = '40';
  try {
    clearMapCache();
    assert.strictEqual(mapCacheStats().sweeping, false, 'no timer while the cache is empty');
    assert.strictEqual((await share(`/reports/${ctx.pins._id}/map`, { 'Accept-Encoding': 'gzip' })).status, 200);
    const held = mapCacheStats();
    assert.strictEqual(held.entries, 1);
    assert.ok(held.bytes > 0);
    assert.strictEqual(held.sweeping, true, 'the sweep starts with the first entry');
    // Nothing asks for it again: only the sweep can drop it.
    const t0 = Date.now();
    while (mapCacheStats().entries && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 20));
    assert.deepStrictEqual(mapCacheStats(), { entries: 0, bytes: 0, building: 0, sweeping: false }, 'dropped, and the sweep stopped with the cache empty');
    assert.ok(Date.now() - t0 >= 100, 'not before it expired');
    // An entry still inside its 15 minutes stays (the default TTL), however often the sweep runs.
    delete process.env.CLIENT_REPORT_MAP_CACHE_TTL_MS;
    assert.strictEqual((await share(`/reports/${ctx.pins._id}/map`, { 'Accept-Encoding': 'gzip' })).status, 200);
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(mapCacheStats().entries, 1, 'a fresh entry survives the sweeps');
  } finally {
    for (const [k, v] of [['CLIENT_REPORT_MAP_CACHE_TTL_MS', saved.ttl], ['CLIENT_REPORT_MAP_CACHE_SWEEP_MS', saved.every]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    clearMapCache();
  }
});

test('P-1: the sweep never keeps a process alive — one that cached a payload still exits on its own', { skip }, () => {
  // A child imports the module, caches one entry under the default one-minute sweep, and simply ends:
  // a timer holding the event loop would keep it running until spawnSync's timeout kills it.
  const mod = new URL('../src/services/reports/clientReportMap.js', import.meta.url).href;
  const code = `const m = await import(${JSON.stringify(mod)});
await m.gzippedMapPayload('k', async () => ({ ok: true }));
const s = m.mapCacheStats();
console.log(JSON.stringify(s));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH } });
  assert.strictEqual(r.status, 0, `exited on its own (signal ${r.signal}): ${r.stderr}`);
  const stats = JSON.parse(r.stdout.trim());
  assert.strictEqual(stats.entries, 1, 'it did cache the payload');
  assert.strictEqual(stats.sweeping, true, 'with the sweep running when it ended');
});

test('C7: the report carries an opaque map version that moves with what the map serves — never stale bytes', { skip }, async () => {
  const one = async () => JSON.parse((await share(`/reports/${ctx.pins._id}`)).body.toString());
  const before = await one();
  const v1 = before.report.visibility.mapVersion;
  assert.ok(typeof v1 === 'string' && v1.length >= 8 && !v1.includes(String(ctx.pins._id)) && !v1.includes('pinsKey'), 'opaque');
  const firstMap = JSON.parse(decoded(await share(`/reports/${ctx.pins._id}/map`, { 'Accept-Encoding': 'gzip' })).toString());
  assert.ok('issues' in firstMap.answers);
  // The preview's version is the saved report's — an on-screen overlay doesn't move it.
  const pv = await admin('POST', `/admin/client-reports/${ctx.pins._id}/preview`, { visibility: { mapAnswerKeys: ['support'] } });
  assert.strictEqual(pv.status, 200, JSON.stringify(pv.json));
  assert.strictEqual(pv.json.report.visibility.mapVersion, v1);

  // A map question taken off (same snapshot key): a new version, and a map without it at once.
  const edit = await admin('PATCH', `/admin/client-reports/${ctx.pins._id}`, { visibility: { mapAnswerKeys: ['support'] } });
  assert.strictEqual(edit.status, 200, JSON.stringify(edit.json));
  const after = await one();
  assert.notStrictEqual(after.report.visibility.mapVersion, v1);
  const map = JSON.parse(decoded(await share(`/reports/${ctx.pins._id}/map`, { 'Accept-Encoding': 'gzip' })).toString());
  assert.strictEqual(map.snapshotKey, firstMap.snapshotKey, 'the snapshot key did not move');
  assert.ok(!('issues' in map.answers), 'the cache never serves the removed question');
  assert.deepStrictEqual(map.questions.map((q) => q.key), ['support']);
  const pv2 = await admin('GET', `/admin/client-reports/${ctx.pins._id}/preview`);
  assert.strictEqual(pv2.json.report.visibility.mapVersion, after.report.visibility.mapVersion, 'preview and client agree');

  // Map off: no version at all.
  assert.strictEqual((await admin('PATCH', `/admin/client-reports/${ctx.pins._id}`, { visibility: { showMap: false } })).status, 200);
  const off = await one();
  assert.strictEqual(off.report.visibility.showMap, false);
  assert.strictEqual(off.report.visibility.mapVersion, null);
  assert.strictEqual((await share(`/reports/${ctx.pins._id}/map`, { 'Accept-Encoding': 'gzip' })).status, 404);
});
