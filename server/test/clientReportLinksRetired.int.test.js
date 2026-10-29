import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Links to all your reports, and the switch that turns them off — docs/PROPOSAL_CLIENT_REPORT_LINKS.md
// §C1, contracts K5, K6 and K9 — against the real app and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/retired node --test test/clientReportLinksRetired.int.test.js
//
//   · RETIRE_ALL_REPORTS_LINKS unset (how the deploy ships): they still open, as before; no new one is
//     made (REPORT_REQUIRED); they can get a new password (never kept sealed, never alsoChanged, never by
//     Doorline staff under a grant) or a new address, or be deleted — unlock, extend, renew, enable, a
//     label and Show answer 409 ALL_REPORTS_LINK;
//   · on (`on` / `true` / `1`, any case, trimmed): all ten public routes answer 410 SHARE_RETIRED with the
//     plan's words — a device signed in before included, before the expiry and billing checks — while a
//     link to one report is untouched and a turned-off link still answers 404; every admin action but
//     DELETE answers 409 ("…can only be deleted now."); a deleted one's History says allReports;
//   · unset again: they open at once, signed-in devices included — nothing was written to them.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-links-retired';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.CREDENTIAL_SEAL_KEY = Buffer.alloc(32, 7).toString('base64');
delete process.env.RETIRE_ALL_REPORTS_LINKS;

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { SupportAccessGrant } = await import('../src/models/SupportAccessGrant.js');
const { createGrant } = await import('../src/services/access/supportAccess.js');
const { allReportsRetired } = await import('../src/services/reports/shareLinks.js');
const bcrypt = (await import('bcryptjs')).default;

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = 'all-reports-password';
const RETIRED = { error: 'This link no longer works. Ask the person who sent it for the link to the latest report.', code: 'SHARE_RETIRED' };
const BEFORE_SWITCH = 'Links that open all your reports can only get a new password or a new address, or be deleted.';
const AFTER_SWITCH = 'Links that open all your reports can only be deleted now.';

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
  return { status: res.status, json, text, headers: res.headers };
};
const admin = (method, path, body, as) => call(method, `/admin/client-reports/shares${path}`, { body, as });
let ipN = 0;
const unlock = (token, password = PASSWORD) => {
  ipN += 1;
  return call('POST', `/share/${token}/unlock`, { as: null, body: { password }, headers: { 'X-Forwarded-For': `10.4.${ipN >> 8}.${ipN & 255}` } });
};
const pub = (token, path, access, method = 'GET') => call(method, `/share/${token}${path}`, { as: null, headers: access ? { 'X-Share-Token': access } : {} });
// Every public route (share.js), each of which runs loadShare first.
const everyRoute = (token, reportId) => [
  ['GET', ''],
  ['POST', '/unlock'],
  ['GET', '/reports'],
  ['GET', `/reports/${reportId}`],
  ['GET', `/reports/${reportId}/map`],
  ['GET', `/reports/${reportId}/map/doors?snapshotKey=x&rows=0`],
  ['GET', `/reports/${reportId}/areas`],
  ['GET', '/mapbox-token'],
  ['POST', `/reports/${reportId}/opened`],
  ['GET', '/logo'],
].map(([method, path]) => ({ method, path, token }));
const hit = ({ method, path, token }, access) =>
  path === '/unlock' ? unlock(token) : pub(token, path, access, method);
// A link to all your reports, as one made before one link per report looks.
const allReportsLink = async (token, extra = {}) => {
  const now = new Date();
  const { insertedId } = await ReportShareLink.collection.insertOne({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, token, label: 'Candidate',
    passwordHash: await bcrypt.hash(PASSWORD, 4), expiresAt: new Date(now.getTime() + 30 * DAY), isActive: true,
    createdAt: now, updatedAt: now, ...extra,
  });
  return insertedId;
};
const raw = (id) => ReportShareLink.collection.findOne({ _id: id });

before(async () => {
  if (!URI) return;
  mongoose.set('strictQuery', true);
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await ReportShareLink.syncIndexes();
  const org = await Organization.create({ name: 'Retired Org', slug: 'retired-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const mk = async (first, extra = {}, role = null) => {
    const u = await User.create({ firstName: first, lastName: 'R', email: `${first.toLowerCase()}@retired.t.co`, passwordHash: 'x', isActive: true, ...extra });
    if (role) await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
    return u;
  };
  const adminUser = await mk('Ada', {}, 'admin');
  const staffUser = await mk('Sam', { isSuperAdmin: true, platformRole: 'support' });
  await createGrant({ actorUserId: staffUser._id, organizationId: org._id, reason: 'retired links support test' });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Fall', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/Chicago' });
  const report = await ClientReport.create({
    organizationId: org._id, campaignId: camp._id, status: 'published', publishedAt: new Date(),
    weekStart: '2026-07-06', weekEnd: '2026-07-12', timeZone: 'America/Chicago',
    rangeStartUtc: new Date('2026-07-06T05:00:00Z'), rangeEndUtc: new Date('2026-07-13T05:00:00Z'),
    visibility: { visibleQuestionKeys: [], mapAnswerKeys: [], showMap: false },
  });
  Object.assign(ctx, {
    org, camp, report, adminUser,
    admin: { token: signUserToken(adminUser), orgId: org._id },
    staff: { token: signUserToken(staffUser), orgId: org._id },
  });
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  ctx.all = await allReportsLink('retired-all');
  ctx.open = await allReportsLink('retired-open', { passwordHash: null, expiresAt: null, label: 'Old open' });
  ctx.off = await allReportsLink('retired-off', { isActive: false, label: 'Board' });
  ctx.expired = await allReportsLink('retired-expired', { expiresAt: new Date(Date.now() - DAY), label: '' });
  const one = await admin('POST', '', { campaignId: String(camp._id), reportId: String(report._id), password: PASSWORD });
  assert.strictEqual(one.status, 201, JSON.stringify(one.json));
  ctx.one = one.json.share;
});

afterEach(() => {
  delete process.env.RETIRE_ALL_REPORTS_LINKS;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) {
    await SupportAccessGrant.deleteMany({});
    await mongoose.disconnect();
  }
});

test('the switch reads on / true / 1 — any case, trimmed — and nothing else, at call time', () => {
  for (const v of ['on', 'ON', 'true', 'True', '1', ' on ', '\ttrue\n']) assert.strictEqual(allReportsRetired(v), true, JSON.stringify(v));
  for (const v of [undefined, null, '', 'off', 'false', '0', 'yes', 'enabled', 'onn']) assert.strictEqual(allReportsRetired(v), false, JSON.stringify(v));
  delete process.env.RETIRE_ALL_REPORTS_LINKS;
  assert.strictEqual(allReportsRetired(), false, 'unset: off');
  process.env.RETIRE_ALL_REPORTS_LINKS = 'On';
  assert.strictEqual(allReportsRetired(), true, 'read when called, not at import');
});

test('switch unset: a link to all your reports opens as before; a new one is never made', { skip }, async () => {
  assert.strictEqual((await pub('retired-all', '')).status, 200);
  const access = (await unlock('retired-all')).json.accessToken;
  assert.ok(access);
  const hub = await pub('retired-all', '/reports', access);
  assert.deepStrictEqual([hub.status, hub.json.single, hub.json.reports.length], [200, false, 1]);
  assert.strictEqual((await pub('retired-all', `/reports/${ctx.report._id}`, access)).status, 200);
  assert.strictEqual((await pub('retired-open', '/reports')).status, 200, 'an open legacy link too');
  ctx.allAccess = access;

  for (const body of [{}, { reportId: null }]) {
    const res = await admin('POST', '', { campaignId: String(ctx.camp._id), password: PASSWORD, ...body });
    assert.deepStrictEqual([res.status, res.json.code], [400, 'REPORT_REQUIRED']);
  }
  const list = await admin('GET', `?campaignId=${ctx.camp._id}`);
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.json.allReportsRetired, false);
  assert.strictEqual(list.json.staffUnderGrant, false);
  const row = list.json.shares.find((s) => s.token === 'retired-all');
  assert.deepStrictEqual(
    [row.allReports, row.reportId, row.report, row.passwordCopyable, row.passwordViewable, row.passwordHiddenReason, row.samePasswordCount, row.samePasswordTabs],
    [true, null, null, false, false, 'unavailable', 0, []]
  );
  assert.strictEqual(list.json.shares.find((s) => s.id === ctx.one.id).samePasswordCount, 0, 'never counted with a link to all your reports');
});

test('switch unset: a new password (never kept, never alsoChanged, never by staff) and a new address; everything else 409', { skip }, async () => {
  const id = String(ctx.all);
  const before = await raw(ctx.all);
  let res = await admin('PATCH', `/${id}`, { password: 'a-new-season-password' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  let doc = await raw(ctx.all);
  assert.strictEqual(doc.passwordSealed, null, 'an all-reports link’s password is never kept, key or not');
  assert.strictEqual(doc.credentialVersion, (before.credentialVersion ?? 0) + 1);
  assert.strictEqual((await pub('retired-all', '/reports', ctx.allAccess)).status, 401, 'devices signed out');
  assert.strictEqual(res.json.share.passwordViewable, false);
  res = await admin('PATCH', `/${id}`, { generatePassword: true });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.password.length, 12, 'the made-up password, shown once');
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');
  assert.strictEqual((await raw(ctx.all)).passwordSealed, null);
  assert.strictEqual((await unlock('retired-all', res.json.password)).status, 200);
  res = await admin('PATCH', `/${id}`, { password: PASSWORD });
  assert.strictEqual(res.status, 200);

  // Never "change it on the other links", never with anything else, never staff under a grant.
  for (const body of [
    { password: 'also-everywhere-pw', alsoChanged: true },
    { password: 'with-a-label-too-1', label: 'X' },
    { label: 'Renamed' },
    { isActive: true },
    { isActive: false },
    {},
  ]) {
    res = await admin('PATCH', `/${id}`, body);
    assert.deepStrictEqual([res.status, res.json.code, res.json.error], [409, 'ALL_REPORTS_LINK', BEFORE_SWITCH], JSON.stringify(body));
  }
  for (const body of [{ password: 'staff-typed-password' }, { generatePassword: true }]) {
    res = await admin('PATCH', `/${id}`, body, ctx.staff);
    assert.deepStrictEqual([res.status, res.json.code], [403, 'STAFF_CANNOT_SET_PASSWORD'], JSON.stringify(body));
    assert.ok(!('password' in res.json));
  }
  for (const path of ['/unlock', '/extend', '/renew']) {
    res = await admin('POST', `/${id}${path}`, { expiresInDays: 30 });
    assert.deepStrictEqual([res.status, res.json.code, res.json.error], [409, 'ALL_REPORTS_LINK', BEFORE_SWITCH], path);
  }
  res = await admin('GET', `/${id}/password`);
  assert.deepStrictEqual([res.status, res.json.code], [409, 'ALL_REPORTS_LINK']);
  assert.ok(!('password' in res.json));
  // The turned-off one can't be turned back on; the expired one can't be renewed or extended.
  assert.strictEqual((await admin('PATCH', `/${ctx.off}`, { isActive: true })).json.code, 'ALL_REPORTS_LINK');
  assert.strictEqual((await admin('POST', `/${ctx.expired}/renew`, {})).json.code, 'ALL_REPORTS_LINK');
  assert.strictEqual((await admin('POST', `/${ctx.expired}/extend`, { expiresInDays: 30 })).json.code, 'ALL_REPORTS_LINK');
  doc = await raw(ctx.off);
  assert.strictEqual(doc.isActive, false);

  // A new address works — staff may too (no password learned).
  res = await admin('POST', `/${id}/rotate`, null, ctx.staff);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.notStrictEqual(res.json.share.token, 'retired-all');
  await ReportShareLink.updateOne({ _id: ctx.all }, { $set: { token: 'retired-all' } }); // back, for the tests below
  ctx.allAccess = (await unlock('retired-all')).json.accessToken;
  assert.strictEqual((await pub('retired-all', '/reports', ctx.allAccess)).status, 200);
});

test('switch on: all ten public routes answer 410 SHARE_RETIRED — a signed-in device included — and a link to one report is untouched', { skip }, async () => {
  const signedIn = ctx.allAccess;
  const beforeDoc = await raw(ctx.all);
  process.env.RETIRE_ALL_REPORTS_LINKS = 'on';
  for (const token of ['retired-all', 'retired-open', 'retired-expired']) {
    for (const route of everyRoute(token, ctx.report._id)) {
      const res = await hit(route, signedIn);
      assert.strictEqual(res.status, 410, `${token} ${route.method} ${route.path}: ${res.text}`);
      assert.deepStrictEqual(res.json, RETIRED, `${token} ${route.method} ${route.path}`);
      assert.strictEqual(res.headers.get('cache-control'), 'no-store');
    }
  }
  // Retired is said before expired: the expired one gets the reason it stopped, not "expired".
  // A link already turned off answers 404 first, as today.
  for (const route of everyRoute('retired-off', ctx.report._id)) {
    const res = await hit(route);
    assert.deepStrictEqual([res.status, res.json?.code], [404, 'SHARE_NOT_FOUND'], `${route.method} ${route.path}`);
  }
  // The report's own link works: meta, unlock, the hub, the report.
  assert.strictEqual((await pub(ctx.one.token, '')).status, 200);
  const access = (await unlock(ctx.one.token)).json.accessToken;
  assert.ok(access);
  const hub = await pub(ctx.one.token, '/reports', access);
  assert.deepStrictEqual([hub.status, hub.json.single], [200, true]);
  assert.strictEqual((await pub(ctx.one.token, `/reports/${ctx.report._id}`, access)).status, 200);
  // Refused without a write: no lastAccessedAt, no failure counted, no version moved.
  assert.deepStrictEqual(await raw(ctx.all), beforeDoc, 'nothing written to the link');
});

test('switch on: every admin action but DELETE answers 409 “…can only be deleted now.”; DELETE says allReports in History', { skip }, async () => {
  process.env.RETIRE_ALL_REPORTS_LINKS = 'TRUE';
  const id = String(ctx.all);
  const list = await admin('GET', `?campaignId=${ctx.camp._id}`);
  assert.strictEqual(list.json.allReportsRetired, true);
  for (const [method, path, body] of [
    ['PATCH', `/${id}`, { password: 'after-the-switch-pw' }],
    ['PATCH', `/${id}`, { generatePassword: true }],
    ['PATCH', `/${id}`, { isActive: true }],
    ['POST', `/${id}/rotate`, null],
    ['POST', `/${id}/unlock`, null],
    ['POST', `/${id}/extend`, { expiresInDays: 30 }],
    ['POST', `/${id}/renew`, { expiresInDays: 30 }],
    ['GET', `/${id}/password`, null],
  ]) {
    const res = await admin(method, path, body);
    assert.deepStrictEqual([res.status, res.json.code, res.json.error], [409, 'ALL_REPORTS_LINK', AFTER_SWITCH], `${method} ${path}`);
    assert.ok(!('password' in res.json));
  }
  // The link to one report keeps every action.
  assert.strictEqual((await admin('POST', `/${ctx.one.id}/extend`, { expiresInDays: 30 })).status, 200);
  assert.strictEqual((await admin('GET', `/${ctx.one.id}/password`)).json.password, PASSWORD);

  const del = await admin('DELETE', `/${ctx.expired}`);
  assert.strictEqual(del.status, 200);
  assert.strictEqual(await ReportShareLink.countDocuments({ _id: ctx.expired }), 0);
  const [row] = await CampaignChange.find({ shareLinkId: ctx.expired, field: 'reportLink.deleted' }).lean();
  assert.deepStrictEqual(row.toValue, { label: '', allReports: true });
  assert.deepStrictEqual([row.clientReportId, row.seriesId, row.periodLabel], [null, null, null], 'no report to name');
  assert.ok(!JSON.stringify(row).includes('retired-expired'), 'no token in History');
  // A link to one report's delete row says nothing of the kind, and names its report.
  assert.strictEqual((await admin('DELETE', `/${ctx.one.id}`)).status, 200);
  const [oneRow] = await CampaignChange.find({ shareLinkId: new mongoose.Types.ObjectId(ctx.one.id), field: 'reportLink.deleted' }).lean();
  assert.deepStrictEqual(oneRow.toValue, { label: '' });
  assert.strictEqual(String(oneRow.clientReportId), String(ctx.report._id));
  assert.strictEqual(oneRow.periodLabel, 'Jul 6 – Jul 12, 2026');
});

test('unset again: they open at once, a device signed in before included — nothing was written to them', { skip }, async () => {
  process.env.RETIRE_ALL_REPORTS_LINKS = '1';
  assert.strictEqual((await pub('retired-all', '/reports', ctx.allAccess)).status, 410);
  delete process.env.RETIRE_ALL_REPORTS_LINKS;
  const hub = await pub('retired-all', '/reports', ctx.allAccess);
  assert.strictEqual(hub.status, 200, 'the same share token: its version never moved');
  assert.strictEqual((await pub('retired-open', '/reports')).status, 200);
  process.env.RETIRE_ALL_REPORTS_LINKS = 'off';
  assert.strictEqual((await pub('retired-all', '', null)).status, 200, '"off" is off');
  // Every row the switch touched in History: none.
  const rows = await CampaignChange.find({ shareLinkId: ctx.all }).lean();
  assert.ok(rows.every((r) => !['reportLink.disabled', 'reportLink.deleted'].includes(r.field)));
});
