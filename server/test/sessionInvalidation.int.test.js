import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Session revocation on password change — and the exact status/code contract the mobile
// offline queue depends on to HOLD (never drop) queued knocks when auth breaks mid-shift.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/sessioninv node --test test/sessionInvalidation.int.test.js
//
// The rules under test:
//   - A SELF-SET password change (emailed reset, or /auth/change-password) stamps
//     User.passwordChangedAt; requireAuth then 401s any token issued before it, with
//     code SESSION_REVOKED. "I changed my password" ends every other session.
//   - change-password returns a FRESH token so the device that made the change continues
//     seamlessly (critical for a canvasser completing the forced change mid-shift).
//   - An ADMIN temp reset does NOT hard-revoke: live sessions get the passwordGate's
//     403 PASSWORD_CHANGE_REQUIRED (recoverable in-app), never a 401 — revocation lands
//     only when the user completes the forced change themselves.
//   - passwordChangedAt null grandfathers every session issued before this feature.
//
// JWT iat is whole seconds, so a token minted in the same second as the stamp is honored
// (that's how the fresh token works). Tests sleep across a second boundary before stamping
// so the OLD token's iat is strictly earlier.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-session-invalidation';

const { createApp } = await import('../src/app.js');
const { Organization } = await import('../src/models/Organization.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { issuePasswordResetToken } = await import('../src/services/auth/passwordReset.js');
const { clearOutbox } = await import('../src/services/mail/mailer.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const STRONG_1 = 'Fielda-Work1!';
const STRONG_2 = 'Fielda-Work2!';

let server;
let base;
const ctx = {};

// Cross the next whole-second boundary, so a token minted BEFORE this call has an iat
// strictly less than a passwordChangedAt stamped AFTER it.
const nextSecond = () => new Promise((r) => setTimeout(r, 1100));

async function call(method, path, { token, orgId, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

async function login(email, password) {
  return call('POST', '/auth/login', { body: { email, password } });
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});
beforeEach(async () => {
  if (!URI) return;
  for (const M of [Organization, Subscription, User, Membership]) await M.deleteMany({});
  clearOutbox();
  const org = await Organization.create({ name: 'Sess Org', slug: 'sess-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active', statusChangedAt: new Date() });
  const admin = await User.create({
    firstName: 'Ada', lastName: 'Admin', email: 'sadmin@t.co',
    passwordHash: await User.hashPassword(STRONG_1), isActive: true,
  });
  const walker = await User.create({
    firstName: 'Wal', lastName: 'Walker', email: 'walker@t.co',
    passwordHash: await User.hashPassword(STRONG_1), isActive: true,
  });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: walker._id, organizationId: org._id, role: 'canvasser', isActive: true });
  Object.assign(ctx, { org, admin, walker });
});

test('an emailed reset REVOKES every existing session — 401 SESSION_REVOKED, and only then', { skip }, async () => {
  const first = await login('walker@t.co', STRONG_1);
  const oldToken = first.json.token;
  assert.strictEqual((await call('GET', '/auth/me', { token: oldToken })).status, 200, 'baseline: session works');

  await nextSecond();
  const { rawToken } = await issuePasswordResetToken(ctx.walker._id, { hours: 1 });
  const reset = await call('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: STRONG_2 } });
  assert.strictEqual(reset.status, 200);

  const revoked = await call('GET', '/auth/me', { token: oldToken });
  assert.strictEqual(revoked.status, 401, 'the pre-reset session is dead');
  assert.strictEqual(revoked.json.code, 'SESSION_REVOKED', 'with the explicit code clients route on');

  // The contract the mobile offline queue depends on, pinned on a GATED route (requireAuth
  // runs before the passwordGate and role checks): a revoked session gets a 401 there — the
  // queue's hold branch — never some other 4xx it would treat as a bad submission and drop.
  const gated = await call('GET', '/admin/memberships', { token: oldToken, orgId: ctx.org._id });
  assert.strictEqual(gated.status, 401, 'gated routes 401 a revoked session (the queue holds on 401)');
  assert.strictEqual(gated.json.code, 'SESSION_REVOKED');

  const relog = await login('walker@t.co', STRONG_2);
  assert.strictEqual(relog.status, 200, 'the new password signs in');
  assert.strictEqual((await call('GET', '/auth/me', { token: relog.json.token })).status, 200, 'and its session works');
});

test('change-password kills an OUTSTANDING emailed reset link — a stale link cannot reset the moved-on password', { skip }, async () => {
  const tok = (await login('walker@t.co', STRONG_1)).json.token;
  const { rawToken } = await issuePasswordResetToken(ctx.walker._id, { hours: 1 });

  await nextSecond();
  const change = await call('POST', '/auth/change-password', {
    token: tok,
    body: { currentPassword: STRONG_1, newPassword: STRONG_2 },
  });
  assert.strictEqual(change.status, 200);

  const stale = await call('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: 'Hijack-Attempt3!' } });
  assert.strictEqual(stale.status, 400, 'the pre-change link is dead');
  assert.strictEqual(stale.json.code, 'RESET_INVALID');
  assert.strictEqual((await login('walker@t.co', STRONG_2)).status, 200, 'the user’s chosen password stands');
});

test('change-password rotates: fresh token in the response works, the old session dies', { skip }, async () => {
  const first = await login('walker@t.co', STRONG_1);
  const oldToken = first.json.token;

  await nextSecond();
  const change = await call('POST', '/auth/change-password', {
    token: oldToken,
    body: { currentPassword: STRONG_1, newPassword: STRONG_2 },
  });
  assert.strictEqual(change.status, 200);
  assert.ok(change.json.token, 'the response carries a fresh token');

  // The fresh token is minted in the SAME second as the stamp — it must be honored
  // immediately (this is the seamless mid-shift continuation).
  assert.strictEqual((await call('GET', '/auth/me', { token: change.json.token })).status, 200);

  const revoked = await call('GET', '/auth/me', { token: oldToken });
  assert.strictEqual(revoked.status, 401, 'the token that MADE the change is itself revoked');
  assert.strictEqual(revoked.json.code, 'SESSION_REVOKED');
});

test('admin temp reset does NOT hard-revoke — the gate 403s recoverably; revocation lands on the forced change', { skip }, async () => {
  const adminTok = (await login('sadmin@t.co', STRONG_1)).json.token;
  const walkerTok = (await login('walker@t.co', STRONG_1)).json.token;

  await nextSecond();
  const tempPw = 'temp-pass-123';
  const resetByAdmin = await call('PATCH', `/admin/memberships/${ctx.walker._id}/password`, {
    token: adminTok, orgId: ctx.org._id, body: { password: tempPw },
  });
  assert.strictEqual(resetByAdmin.status, 200);

  // The live session is SUSPENDED (password gate), not killed: /auth stays reachable so the
  // user can complete the forced change, and a protected route answers with the recoverable
  // code — the exact contract the mobile queue's hold-don't-drop branch matches on.
  assert.strictEqual((await call('GET', '/auth/me', { token: walkerTok })).status, 200, '/auth is exempt from the gate');
  const gated = await call('GET', '/admin/memberships', { token: walkerTok, orgId: ctx.org._id });
  assert.strictEqual(gated.status, 403, 'protected surfaces are gated, not 401d');
  assert.strictEqual(gated.json.code, 'PASSWORD_CHANGE_REQUIRED');

  // Completing the forced change from the SAME device: fresh token continues, all older die.
  await nextSecond();
  const change = await call('POST', '/auth/change-password', {
    token: walkerTok, body: { currentPassword: tempPw, newPassword: STRONG_2 },
  });
  assert.strictEqual(change.status, 200);
  assert.ok(change.json.token);
  assert.strictEqual((await call('GET', '/auth/me', { token: change.json.token })).status, 200, 'the device that changed continues');
  const after_ = await call('GET', '/auth/me', { token: walkerTok });
  assert.strictEqual(after_.status, 401, 'every session predating the change is out');
  assert.strictEqual(after_.json.code, 'SESSION_REVOKED');
});

test('grandfathering: passwordChangedAt null honors old sessions forever', { skip }, async () => {
  const tok = (await login('walker@t.co', STRONG_1)).json.token;
  await nextSecond();
  const fresh = await User.findById(ctx.walker._id).lean();
  assert.strictEqual(fresh.passwordChangedAt, null, 'nothing stamps without a password change');
  assert.strictEqual((await call('GET', '/auth/me', { token: tok })).status, 200, 'sessions from before the feature keep working');
});
