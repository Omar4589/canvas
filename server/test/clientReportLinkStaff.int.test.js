import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Doorline staff and link passwords — docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C3, contracts K1–K4 — against
// the real app and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/linkstaff node --test test/clientReportLinkStaff.int.test.js
//
// Under a support grant (req.supportGrant), staff can make a link with a made-up password or Same as …,
// or change a password the same way — but never see one and never type one, so they can't keep opening
// a report through /share after the grant ends:
//   · Show → 403 STAFF_CANNOT_VIEW_PASSWORD; rows say passwordViewable false, reason 'staff', and
//     passwordCopyable exactly as for anyone (what Same as … needs); GET says staffUnderGrant;
//   · a typed password on POST or PATCH → 403 STAFF_CANNOT_SET_PASSWORD, nothing written;
//   · a made-up password is never in the response (generatedPassword / password), and without a seal key
//     making one up is refused — 403 PASSWORDS_NOT_KEPT — since nobody could ever see it;
//   · in an internal organization (Doorline's own: no grant), staff are members as any, and Show works.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-link-staff';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
const KEY = Buffer.alloc(32, 5).toString('base64');
process.env.CREDENTIAL_SEAL_KEY = KEY;
delete process.env.RETIRE_ALL_REPORTS_LINKS;

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { SupportAccessGrant } = await import('../src/models/SupportAccessGrant.js');
const { createGrant } = await import('../src/services/access/supportAccess.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;
const DAY = 24 * 60 * 60 * 1000;

let server;
let base;
const ctx = {};

const call = async (method, path, { body, as, headers = {} } = {}) => {
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
const shares = (as, method, path, body) => call(method, `/admin/client-reports/shares${path}`, { as, body });
const make = (as, report, body = {}) => shares(as, 'POST', '', { campaignId: String(report.campaignId), reportId: String(report._id), ...body });
const rowsAs = async (as, campaignId) => (await shares(as, 'GET', `?campaignId=${campaignId}`)).json;
let ipN = 0;
const unlock = (token, password) => {
  ipN += 1;
  return call('POST', `/share/${token}/unlock`, { body: { password }, headers: { 'X-Forwarded-For': `10.6.${ipN >> 8}.${ipN & 255}` } });
};
let weekN = 0;
const report = async (camp) => {
  weekN += 1;
  const start = new Date(Date.UTC(2026, 6, 6) + weekN * 7 * DAY);
  const day = (d) => d.toISOString().slice(0, 10);
  return ClientReport.create({
    organizationId: camp.organizationId, campaignId: camp._id, status: 'published', publishedAt: new Date(),
    weekStart: day(start), weekEnd: day(new Date(start.getTime() + 6 * DAY)), timeZone: 'America/Chicago',
    rangeStartUtc: start, rangeEndUtc: new Date(start.getTime() + 7 * DAY),
  });
};
const withoutKey = async (fn) => {
  delete process.env.CREDENTIAL_SEAL_KEY;
  try {
    return await fn();
  } finally {
    process.env.CREDENTIAL_SEAL_KEY = KEY;
  }
};

before(async () => {
  if (!URI) return;
  mongoose.set('strictQuery', true);
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await ReportShareLink.syncIndexes();
  const org = await Organization.create({ name: 'Customer Org', slug: 'staff-customer', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const internal = await Organization.create({ name: 'Doorline Demo', slug: 'staff-internal', isActive: true, isInternal: true });
  await Subscription.create({ organizationId: internal._id, status: 'internal', statusChangedAt: new Date() });
  const adminUser = await User.create({ firstName: 'Ada', lastName: 'S', email: 'ada@linkstaff.t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: adminUser._id, organizationId: org._id, role: 'admin', isActive: true });
  const staffUser = await User.create({ firstName: 'Sam', lastName: 'Staff', email: 'sam@linkstaff.t.co', passwordHash: 'x', isActive: true, isSuperAdmin: true, platformRole: 'support' });
  const { grant } = await createGrant({ actorUserId: staffUser._id, organizationId: org._id, reason: 'link password staff test' });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Fall', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/Chicago' });
  const demo = await Campaign.create({ organizationId: internal._id, name: 'Demo', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/Chicago' });
  Object.assign(ctx, {
    org, internal, camp, demo, grant,
    admin: { token: signUserToken(adminUser), orgId: org._id },
    staff: { token: signUserToken(staffUser), orgId: org._id },
    staffInternal: { token: signUserToken(staffUser), orgId: internal._id },
  });
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  // The admin's own link, with a password Doorline keeps.
  const r = await report(camp);
  const made = await make(ctx.admin, r);
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  ctx.adminLink = { ...made.json.share, password: made.json.generatedPassword };
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) {
    await SupportAccessGrant.deleteMany({});
    await mongoose.disconnect();
  }
});

test('under a grant: Show is 403, rows say “staff” — and passwordCopyable exactly as for anyone', { skip }, async () => {
  const shown = await shares(ctx.staff, 'GET', `/${ctx.adminLink.id}/password`);
  assert.deepStrictEqual([shown.status, shown.json.code], [403, 'STAFF_CANNOT_VIEW_PASSWORD']);
  assert.strictEqual(shown.json.error, 'Doorline staff can’t view link passwords.');
  assert.ok(!shown.text.includes(ctx.adminLink.password));

  const staffView = await rowsAs(ctx.staff, ctx.camp._id);
  const adminView = await rowsAs(ctx.admin, ctx.camp._id);
  assert.deepStrictEqual([staffView.staffUnderGrant, adminView.staffUnderGrant], [true, false]);
  const s = staffView.shares.find((x) => x.id === ctx.adminLink.id);
  const a = adminView.shares.find((x) => x.id === ctx.adminLink.id);
  assert.deepStrictEqual([s.passwordCopyable, s.passwordViewable, s.passwordHiddenReason], [true, false, 'staff']);
  assert.deepStrictEqual([a.passwordCopyable, a.passwordViewable, a.passwordHiddenReason], [true, true, null]);
  // A link whose password can't be shown to anyone: still 'staff' for staff (checked first).
  const legacy = await ReportShareLink.collection.insertOne({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, token: 'staff-legacy', reportId: new ObjectId(), passwordHash: 'x',
    expiresAt: new Date(Date.now() + DAY), isActive: true, createdAt: new Date(), updatedAt: new Date(),
  });
  const rows = await rowsAs(ctx.staff, ctx.camp._id);
  assert.strictEqual(rows.shares.find((x) => x.id === String(legacy.insertedId)).passwordHiddenReason, 'staff');
  assert.strictEqual((await rowsAs(ctx.admin, ctx.camp._id)).shares.find((x) => x.id === String(legacy.insertedId)).passwordHiddenReason, 'unavailable');
  await ReportShareLink.deleteOne({ _id: legacy.insertedId });
});

test('under a grant: a typed password is refused on POST and PATCH — nothing written', { skip }, async () => {
  const r = await report(ctx.camp);
  let res = await make(ctx.staff, r, { password: 'staff-typed-password' });
  assert.deepStrictEqual([res.status, res.json.code], [403, 'STAFF_CANNOT_SET_PASSWORD']);
  assert.strictEqual(await ReportShareLink.countDocuments({ reportId: r._id }), 0);
  const before = await ReportShareLink.collection.findOne({ _id: new ObjectId(ctx.adminLink.id) });
  res = await shares(ctx.staff, 'PATCH', `/${ctx.adminLink.id}`, { password: 'staff-typed-password' });
  assert.deepStrictEqual([res.status, res.json.code], [403, 'STAFF_CANNOT_SET_PASSWORD']);
  res = await shares(ctx.staff, 'PATCH', `/${ctx.adminLink.id}`, { password: 'staff-typed-password', alsoChanged: true });
  assert.strictEqual(res.status, 403);
  assert.deepStrictEqual(await ReportShareLink.collection.findOne({ _id: new ObjectId(ctx.adminLink.id) }), before, 'untouched');
});

test('under a grant: a made-up password or Same as … — the password never in the response', { skip }, async () => {
  const [r1, r2] = [await report(ctx.camp), await report(ctx.camp)];
  let res = await make(ctx.staff, r1);
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  assert.ok(!('generatedPassword' in res.json), 'never to staff');
  const made = res.json.share;
  assert.deepStrictEqual([made.passwordCopyable, made.passwordViewable, made.passwordHiddenReason], [true, false, 'staff']);
  const kept = (await shares(ctx.admin, 'GET', `/${made.id}/password`)).json.password;
  assert.strictEqual(kept.length, 12, 'the campaign’s admins can see it');
  assert.ok(!res.text.includes(kept));
  assert.strictEqual((await unlock(made.token, kept)).status, 200, 'and it works');

  res = await make(ctx.staff, r2, { passwordFrom: ctx.adminLink.id });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  assert.ok(!res.text.includes(ctx.adminLink.password));
  assert.strictEqual((await shares(ctx.admin, 'GET', `/${res.json.share.id}/password`)).json.password, ctx.adminLink.password);

  res = await shares(ctx.staff, 'PATCH', `/${made.id}`, { generatePassword: true });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.ok(!('password' in res.json), 'a change made up by staff isn’t sent back either');
  const changed = (await shares(ctx.admin, 'GET', `/${made.id}/password`)).json.password;
  assert.notStrictEqual(changed, kept);
  assert.ok(!res.text.includes(changed));
  // Rotate and Extend are not password acts: staff may.
  assert.strictEqual((await shares(ctx.staff, 'POST', `/${made.id}/rotate`)).status, 200);
  assert.strictEqual((await shares(ctx.staff, 'POST', `/${made.id}/extend`, { expiresInDays: 30 })).status, 200);
});

test('under a grant, without a seal key: making one up is refused (PASSWORDS_NOT_KEPT) — an admin’s still works', { skip }, async () => {
  await withoutKey(async () => {
    const r = await report(ctx.camp);
    let res = await make(ctx.staff, r);
    assert.deepStrictEqual([res.status, res.json.code], [403, 'PASSWORDS_NOT_KEPT']);
    assert.match(res.json.error, /^Doorline can’t keep link passwords right now/);
    assert.strictEqual(await ReportShareLink.countDocuments({ reportId: r._id }), 0);
    res = await shares(ctx.staff, 'PATCH', `/${ctx.adminLink.id}`, { generatePassword: true });
    assert.deepStrictEqual([res.status, res.json.code], [403, 'PASSWORDS_NOT_KEPT']);
    assert.strictEqual((await unlock(ctx.adminLink.token, ctx.adminLink.password)).status, 200, 'the password is unchanged');
    // The admin: made up and shown right away, though not kept.
    res = await make(ctx.admin, r);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.json.generatedPassword.length, 12);
  });
});

test('in an internal organization there is no grant: staff are members as any, and Show works', { skip }, async () => {
  const r = await report(ctx.demo);
  const res = await make(ctx.staffInternal, r);
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  assert.strictEqual(res.json.generatedPassword.length, 12, 'returned: not under a grant');
  const view = await rowsAs(ctx.staffInternal, ctx.demo._id);
  assert.strictEqual(view.staffUnderGrant, false);
  assert.deepStrictEqual(view.shares.map((x) => [x.passwordViewable, x.passwordHiddenReason]), [[true, null]]);
  const shown = await shares(ctx.staffInternal, 'GET', `/${res.json.share.id}/password`);
  assert.deepStrictEqual([shown.status, shown.json.password], [200, res.json.generatedPassword]);
});

test('the grant ended: staff reach no link at all', { skip }, async () => {
  await SupportAccessGrant.updateOne({ _id: ctx.grant._id }, { $set: { revokedAt: new Date() } });
  for (const [method, path] of [['GET', `?campaignId=${ctx.camp._id}`], ['GET', `/${ctx.adminLink.id}/password`]]) {
    const res = await shares(ctx.staff, method, path);
    assert.deepStrictEqual([res.status, res.json.code], [403, 'SUPPORT_ACCESS_REQUIRED'], `${method} ${path}`);
  }
});
