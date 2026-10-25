import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

// Who opened a client report — docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F7 as amended by §O9, the §K
// "Opens" bullets — against the real app and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/opens node --test test/clientReportOpens.int.test.js
//
// POST /share/:token/reports/:id/opened answers 204 at once, behind the link's own access; only after
// that does the server look at a Doorline session the page may send. Doorline staff, and admins, leads
// and other members of the LINK's organization, are counted apart from the link; everyone else — no
// session, an ended or stale one, another organization's member — counts under the link. One update
// per open, never moving the report's updatedAt; old documents (no views, an explicit null viewCount)
// count from zero. The old viewCount/lastViewedAt totals are frozen: "N views before per-link counts"
// is a before-the-upgrade number, so no open since moves it (§P3, code review ADMINUX-12).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-report-opens';
process.env.REDIS_URL = 'redis://127.0.0.1:1';

const { createApp } = await import('../src/app.js');
const { signUserToken, signShareToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { Subscription } = await import('../src/models/Subscription.js');
const bcrypt = (await import('bcryptjs')).default;

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const SECRET = process.env.JWT_SECRET;

let server;
let base;
const ctx = {};

const post = async (path, headers = {}) => {
  const res = await fetch(`${base}/api${path}`, { method: 'POST', headers });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 204 */ }
  return { status: res.status, json, text };
};
const unlockOf = async (token, password) => {
  const res = await fetch(`${base}/api/share/${token}/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({ password }),
  });
  return (await res.json()).accessToken;
};
// One open, from the page: the link's share token always, and the viewer's Doorline session when the
// page has one. The count is written AFTER the 204, so wait for it to land.
const open = async ({ reportId = ctx.report._id, link = ctx.link, session = null, expect }) => {
  const before = await ClientReport.findById(reportId).lean();
  const res = await post(`/share/${link.token}/reports/${reportId}/opened`, {
    'X-Share-Token': link.access,
    ...(session ? { Authorization: `Bearer ${session}` } : {}),
  });
  assert.strictEqual(res.status, 204, `${JSON.stringify(res.json)}`);
  assert.strictEqual(res.text, '', 'no body: nothing about the viewer comes back');
  const total = (r) => {
    const v = r?.views || {};
    return Object.values(v.byLink || {}).reduce((n, x) => n + (x.opens || 0), 0)
      + ['admins', 'leads', 'others', 'staff'].reduce((n, k) => n + (v.members?.[k]?.opens || 0), 0);
  };
  const want = total(before) + 1;
  for (let i = 0; i < 100; i += 1) {
    const now = await ClientReport.findById(reportId).lean();
    if (total(now) === want) {
      if (expect) expect(now, before);
      return now;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('the open was never recorded');
};
const linkCount = (r, link = ctx.link) => r.views?.byLink?.[String(link.id)]?.opens || 0;
const member = (r, k) => r.views?.members?.[k]?.opens || 0;

before(async () => {
  if (!URI) return;
  mongoose.set('strictQuery', true);
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  const org = await Organization.create({ name: 'Opens Org', slug: 'opens-org', isActive: true });
  const elsewhere = await Organization.create({ name: 'Elsewhere', slug: 'elsewhere', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const mk = async (first, extra = {}, memberships = []) => {
    const u = await User.create({ firstName: first, lastName: 'O', email: `${first.toLowerCase()}@opens.t.co`, passwordHash: 'x', isActive: true, ...extra });
    for (const [o, role, isActive = true] of memberships) await Membership.create({ userId: u._id, organizationId: o._id, role, isActive });
    return u;
  };
  Object.assign(ctx, {
    org,
    staff: await mk('Staff', { isSuperAdmin: true, platformRole: 'support' }),
    admin: await mk('Admin', {}, [[org, 'admin']]),
    lead: await mk('Lead', {}, [[org, 'lead']]),
    canvasser: await mk('Canvasser', {}, [[org, 'canvasser']]),
    former: await mk('Former', {}, [[org, 'admin', false]]),
    outsider: await mk('Outsider', {}, [[elsewhere, 'admin']]),
    changed: await mk('Changed', { passwordChangedAt: new Date() }, [[org, 'admin']]),
    ended: await mk('Ended', {}, [[org, 'lead']]),
    gone: await mk('Gone', { isActive: false, deletedAt: new Date() }, [[org, 'admin']]),
  });
  await User.updateOne({ _id: ctx.ended._id }, { $set: { endedSessionIds: ['opens-ended-sid'] } });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Opens', type: 'survey', state: 'FL', isActive: true });
  const report = await ClientReport.create({
    organizationId: org._id, campaignId: camp._id, status: 'published', publishedAt: new Date('2026-07-14T12:00:00Z'),
    weekStart: '2026-07-06', weekEnd: '2026-07-12', timeZone: 'America/Chicago',
    rangeStartUtc: new Date('2026-07-06T05:00:00Z'), rangeEndUtc: new Date('2026-07-13T05:00:00Z'),
    visibility: { visibleQuestionKeys: [], mapAnswerKeys: [], showMap: false },
  });
  const mkLink = async (token, label) => {
    const l = await ReportShareLink.create({
      organizationId: org._id, campaignId: camp._id, token, label,
      passwordHash: await bcrypt.hash(`${token}-password`, 4), expiresAt: new Date(Date.now() + 86400e3), isActive: true,
    });
    return { id: l._id, token, access: null };
  };
  const link = await mkLink('opens-candidate', 'Candidate');
  const second = await mkLink('opens-consultant', 'Consultant');
  Object.assign(ctx, { camp, report, link, second });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  link.access = await unlockOf(link.token, `${link.token}-password`);
  second.access = await unlockOf(second.token, `${second.token}-password`);
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('a link holder’s open counts under the link; the old totals stay what they were before per-link counts', { skip }, async () => {
  const before = await ClientReport.findById(ctx.report._id).lean();
  const r = await open({});
  assert.strictEqual(linkCount(r), 1);
  assert.ok(r.views.byLink[String(ctx.link.id)].firstOpenedAt && r.views.byLink[String(ctx.link.id)].lastOpenedAt);
  assert.strictEqual(r.viewCount, before.viewCount, '"N views before per-link counts" never moves (ADMINUX-12)');
  assert.strictEqual(String(r.lastViewedAt), String(before.lastViewedAt), 'nor its last-viewed date');
  const again = await open({});
  assert.strictEqual(linkCount(again), 2);
  assert.strictEqual(
    new Date(again.views.byLink[String(ctx.link.id)].firstOpenedAt).getTime(),
    new Date(r.views.byLink[String(ctx.link.id)].firstOpenedAt).getTime(),
    'the first open stays the first'
  );
  assert.strictEqual(String(again.updatedAt), String(before.updatedAt), 'an open never moves updatedAt');
  const other = await open({ link: ctx.second });
  assert.strictEqual(linkCount(other, ctx.second), 1, 'each link its own count');
  assert.strictEqual(linkCount(other), 2);
});

test('staff, admins, leads and other members of the link’s organization are counted apart from the link', { skip }, async () => {
  const start = await ClientReport.findById(ctx.report._id).lean();
  await open({ session: signUserToken(ctx.staff) });
  await open({ session: signUserToken(ctx.admin) });
  await open({ session: signUserToken(ctx.lead) });
  const r = await open({ session: signUserToken(ctx.canvasser) });
  assert.deepStrictEqual(
    ['staff', 'admins', 'leads', 'others'].map((k) => member(r, k)),
    [1, 1, 1, 1],
    'Doorline staff, admins, leads (a lead who is the client shows here) and everyone else in the org'
  );
  assert.ok(r.views.members.staff.lastOpenedAt);
  assert.strictEqual(linkCount(r), linkCount(start), 'none of them reached the link’s count');
  assert.strictEqual(r.viewCount, start.viewCount, 'nor the old link total');
  assert.strictEqual((await User.findById(ctx.canvasser._id).lean()).lastSeenAt, null, 'identifying a viewer never stamps last-seen');
});

test('an ended, stale or foreign session — or no Doorline session at all — counts under the link', { skip }, async () => {
  const mint = (user, extra = {}) =>
    jwt.sign({ sub: String(user._id), email: user.email, isSuperAdmin: false, auth_ms: Date.now() - 60 * 1000, sid: `s-${crypto.randomUUID()}`, ...extra }, SECRET, { expiresIn: '30d' });
  const sessions = {
    'a member of another organization': signUserToken(ctx.outsider),
    'a former member (membership inactive)': signUserToken(ctx.former),
    'an ended session': mint(ctx.ended, { sid: 'opens-ended-sid' }),
    'a password changed since sign-in': mint(ctx.changed, { auth_ms: Date.now() - 10 * 60 * 1000 }),
    'a deleted account': signUserToken(ctx.gone),
    'an expired token': jwt.sign({ sub: String(ctx.admin._id), email: 'x', iat: Math.floor(Date.now() / 1000) - 40 * 86400, auth_ms: Date.now() - 40 * 86400e3, sid: 'old' }, SECRET, { expiresIn: '30d' }),
    'a share token': signShareToken({ shareId: ctx.link.id, campaignId: ctx.camp._id }),
    junk: 'not-a-token',
  };
  for (const [name, session] of Object.entries(sessions)) {
    const before = await ClientReport.findById(ctx.report._id).lean();
    const r = await open({ session });
    assert.strictEqual(linkCount(r), linkCount(before) + 1, `${name} counts under the link`);
  }
});

test('the open needs the link’s access, and only a shown report counts', { skip }, async () => {
  const noAccess = await post(`/share/${ctx.link.token}/reports/${ctx.report._id}/opened`, { Authorization: `Bearer ${signUserToken(ctx.admin)}` });
  assert.strictEqual(noAccess.status, 401, 'a Doorline session is never a way in');
  assert.strictEqual(noAccess.json.code, 'password-required');
  const taken = await ClientReport.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, status: 'published', publishedAt: new Date(), takenDownAt: new Date(),
    weekStart: '2026-07-13', weekEnd: '2026-07-19', timeZone: 'America/Chicago',
    rangeStartUtc: new Date('2026-07-13T05:00:00Z'), rangeEndUtc: new Date('2026-07-20T05:00:00Z'),
  });
  const res = await post(`/share/${ctx.link.token}/reports/${taken._id}/opened`, { 'X-Share-Token': ctx.link.access });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.json.code, 'REPORT_NOT_FOUND');
  assert.strictEqual((await ClientReport.findById(taken._id).lean()).views?.byLink, undefined, 'nothing counted');
});

test('an old report — no views, an explicit null viewCount — counts from zero, and its old total stays put', { skip }, async () => {
  const now = new Date();
  const { insertedId } = await ClientReport.collection.insertOne({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, status: 'published', publishedAt: now, takenDownAt: null,
    weekStart: '2026-06-01', weekEnd: '2026-06-07', timeZone: 'America/Chicago',
    rangeStartUtc: new Date('2026-06-01T05:00:00Z'), rangeEndUtc: new Date('2026-06-08T05:00:00Z'),
    viewCount: null, lastViewedAt: null, createdAt: now, updatedAt: now,
  });
  const r = await open({ reportId: insertedId });
  assert.strictEqual(r.viewCount, null, 'the before-the-upgrade total is untouched');
  assert.strictEqual(r.lastViewedAt, null);
  assert.strictEqual(linkCount(r), 1);
  const m = await open({ reportId: insertedId, session: signUserToken(ctx.lead) });
  assert.strictEqual(member(m, 'leads'), 1);
  assert.strictEqual(m.viewCount, null, 'a member’s open leaves it alone too');
  // A report that HAD old views keeps exactly that number however often it is opened since.
  const { insertedId: withViews } = await ClientReport.collection.insertOne({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, status: 'published', publishedAt: now, takenDownAt: null,
    weekStart: '2026-05-25', weekEnd: '2026-05-31', timeZone: 'America/Chicago',
    rangeStartUtc: new Date('2026-05-25T05:00:00Z'), rangeEndUtc: new Date('2026-06-01T05:00:00Z'),
    viewCount: 7, lastViewedAt: new Date('2026-06-02T12:00:00Z'), createdAt: now, updatedAt: now,
  });
  await open({ reportId: withViews });
  const w = await open({ reportId: withViews });
  assert.strictEqual(w.viewCount, 7);
  assert.strictEqual(new Date(w.lastViewedAt).toISOString(), '2026-06-02T12:00:00.000Z');
  assert.strictEqual(linkCount(w), 2);
});
