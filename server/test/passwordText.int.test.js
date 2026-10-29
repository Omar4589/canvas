import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// A password with a lone surrogate never reaches bcrypt (utils/passwordText.js): bcryptjs 2.4.3 runs out
// of memory on one and the whole process exits, so before this guard ONE request to sign-in, or to a
// client link's password page, took the web dyno down. Against the real app and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/pwtext node --test test/passwordText.int.test.js
// A missing guard doesn't fail an assertion here — it kills this test process, which fails the run.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-password-text';
process.env.REDIS_URL = 'redis://127.0.0.1:1';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { Subscription } = await import('../src/models/Subscription.js');
const bcrypt = (await import('bcryptjs')).default;

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const DAY = 24 * 60 * 60 * 1000;

// Meets every rule a password is checked against (length, upper, lower, number, special), plus half a
// surrogate pair: JSON.stringify sends it as "\ud800" and the server's JSON.parse hands back a lone one.
const LONE = 'Abcdefgh1234!\ud800';
const PASSWORD = 'Str0ng!Passw0rd';
const LINK_PASSWORD = 'correct-horse-battery';

let server;
let base;
const ctx = {};

async function call(method, path, { token, orgId, body, headers = {} } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { /* empty or not JSON */ }
  return { status: res.status, json };
}

before(async () => {
  if (!URI) return;
  mongoose.set('strictQuery', true);
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();

  const org = await Organization.create({ name: 'Acme Text', slug: 'acme-text', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const user = await User.create({ firstName: 'Ada', lastName: 'T', email: 'ada@pwtext.t.co', passwordHash: await User.hashPassword(PASSWORD), isActive: true });
  await Membership.create({ userId: user._id, organizationId: org._id, role: 'admin', isActive: true });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Fall Text', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/Chicago' });
  const now = new Date();
  const link = await ReportShareLink.create({
    organizationId: org._id,
    campaignId: camp._id,
    token: 'pwtext-link-token-000000000000000',
    label: 'Candidate',
    passwordHash: await bcrypt.hash(LINK_PASSWORD, 4),
    expiresAt: new Date(now.getTime() + 90 * DAY),
    lifetimeStartAt: now,
    credentialVersion: 0,
    passwordMeetsRule: true,
    failedUnlockAt: [],
    failedUnlocksTotal: 0,
    failedByDay: [],
  });
  Object.assign(ctx, { user, camp, link, admin: { token: signUserToken(user), orgId: org._id } });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('sign-in: a lone surrogate is just a wrong password, and the server stays up', { skip }, async () => {
  const wrong = await call('POST', '/auth/login', { body: { email: 'ada@pwtext.t.co', password: LONE } });
  assert.strictEqual(wrong.status, 401);
  assert.strictEqual(wrong.json.error, 'Invalid credentials');
  const right = await call('POST', '/auth/login', { body: { email: 'ada@pwtext.t.co', password: PASSWORD } });
  assert.strictEqual(right.status, 200, 'the same server answers the next sign-in');
  assert.ok(right.json.token);
});

test('changing a password: a lone surrogate is refused as the new one, and fails as the current one', { skip }, async () => {
  const asNew = await call('POST', '/auth/change-password', { token: ctx.admin.token, body: { currentPassword: PASSWORD, newPassword: LONE } });
  assert.strictEqual(asNew.status, 400);
  assert.match(asNew.json.error, /character that can’t be used/);
  const asCurrent = await call('POST', '/auth/change-password', { token: ctx.admin.token, body: { currentPassword: LONE, newPassword: 'N3w!Password99' } });
  assert.strictEqual(asCurrent.status, 401);
  const fresh = await User.findById(ctx.user._id);
  assert.strictEqual(await fresh.verifyPassword(PASSWORD), true, 'the password is unchanged');
});

test('User.hashPassword refuses a lone surrogate with a 400; verifyPassword says no', { skip }, async () => {
  await assert.rejects(User.hashPassword(LONE), (e) => e.status === 400 && e.code === 'PASSWORD_INVALID');
  const fresh = await User.findById(ctx.user._id);
  assert.strictEqual(await fresh.verifyPassword(LONE), false);
});

test('a client link password page: a lone surrogate is a wrong password, using no slot', { skip }, async () => {
  const token = ctx.link.token;
  const wrong = await call('POST', `/share/${token}/unlock`, { headers: { 'X-Forwarded-For': '10.0.0.1' }, body: { password: LONE } });
  assert.strictEqual(wrong.status, 401);
  assert.strictEqual(wrong.json.code, 'SHARE_PASSWORD_WRONG');
  const after1 = await ReportShareLink.findById(ctx.link._id).lean();
  assert.strictEqual((after1.failedUnlockAt || []).length, 0, 'never reached the failure budget or bcrypt');
  const right = await call('POST', `/share/${token}/unlock`, { headers: { 'X-Forwarded-For': '10.0.0.2' }, body: { password: LINK_PASSWORD } });
  assert.strictEqual(right.status, 200, 'the same server unlocks the link');
  assert.ok(right.json.accessToken);
});

test('making or changing a link password: a lone surrogate is refused', { skip }, async () => {
  const made = await call('POST', '/admin/client-reports/shares', { ...ctx.admin, body: { campaignId: String(ctx.camp._id), password: LONE } });
  assert.strictEqual(made.status, 400);
  assert.strictEqual(made.json.code, 'SHARE_PASSWORD_INVALID');
  const changed = await call('PATCH', `/admin/client-reports/shares/${ctx.link._id}`, { ...ctx.admin, body: { password: LONE } });
  assert.strictEqual(changed.status, 400);
  assert.strictEqual(changed.json.code, 'SHARE_PASSWORD_INVALID');
  const fresh = await ReportShareLink.findById(ctx.link._id).lean();
  assert.ok(await bcrypt.compare(LINK_PASSWORD, fresh.passwordHash), 'the link keeps its password');
});
