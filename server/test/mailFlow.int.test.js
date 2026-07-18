import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The self-serve password-reset flow, end to end, over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/mailflow_test node --test test/mailFlow.int.test.js
//
// The mailer is DORMANT here (no RESEND_API_KEY / MAIL_FROM), so every send is recorded on the
// exported `outbox` array instead of hitting the network — that is the assertion surface. forgot-password
// answers 200 and does its user lookup + token write + send DETACHED, AFTER the response (the anti-oracle
// contract), so outbox assertions POLL briefly for the entry rather than reading it synchronously — the
// same precedent as test/accessLogCoverage.int.test.js.
//
// FORGOT-PASSWORD RATE-LIMIT BUDGET (the forgot limiters are module-level MemoryStores, fresh for THIS
// node process): per-IP 20 / 15min, per-email 5 / 15min, counting EVERY request. All calls here come from
// 127.0.0.1, so they share the per-IP budget. Count of forgot calls, in run order:
//   oracle(2) + inactive/deleted(2) + hashed-token(1) = 5, THEN the throttle test's 6 = 11 total < 20.
// Everything after the hashed-token test mints its reset token DIRECTLY via issuePasswordResetToken (no
// forgot call), so the reset-endpoint cases cost the forgot budget nothing. The throttle test runs LAST
// and uses a FRESH email (per-email counter starts at 0, so its 6th request is the one that trips the 5).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-mailflow';

const { createApp } = await import('../src/app.js');
const { User } = await import('../src/models/User.js');
const { outbox, clearOutbox } = await import('../src/services/mail/mailer.js');
const { issuePasswordResetToken, sha256Hex, INVITE_TOKEN_HOURS } = await import(
  '../src/services/auth/passwordReset.js'
);

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll the outbox for a predicate — sends are fire-and-forget, so an entry lands a few ms after the
// HTTP call returns. ~50ms × 40 ≈ 2s ceiling.
async function waitFor(pred, { timeout = 2000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (pred()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(interval);
  }
}

// The reset link (raw token) travels in the email body only; both html and text carry it.
function tokenFromEntry(entry) {
  const blob = `${entry?.html || ''}\n${entry?.text || ''}`;
  const m = blob.match(/reset-password\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

async function call(method, path, { body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
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

const STRONG = 'Str0ng!Pass1'; // upper + lower + number + special + len≥8

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await User.deleteMany({});
  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

beforeEach(() => {
  clearOutbox();
});

async function mkUser({ email, password = 'OldPass!23', ...rest } = {}) {
  return User.create({
    firstName: 'Case',
    lastName: 'User',
    email,
    passwordHash: await User.hashPassword(password),
    isActive: true,
    ...rest,
  });
}

// 1) ORACLE — a real address and a nonexistent one are indistinguishable in status AND body; only the
//    real account produces an email.  (2 forgot calls)
test('forgot-password is an oracle: same 200 + body for real vs unknown; exactly one send (the real user)', { skip }, async () => {
  await mkUser({ email: 'oracle.real@t.co' });

  const real = await call('POST', '/auth/forgot-password', { body: { email: 'oracle.real@t.co' } });
  const fake = await call('POST', '/auth/forgot-password', { body: { email: 'nobody.here@t.co' } });

  assert.strictEqual(real.status, 200);
  assert.strictEqual(fake.status, 200);
  assert.deepStrictEqual(real.json, fake.json, 'the response body must not reveal whether the account exists');

  // Only the real user is emailed; poll until exactly one entry has settled.
  const ok = await waitFor(() => outbox.length === 1);
  assert.ok(ok, `expected exactly one send, saw ${outbox.length}`);
  assert.strictEqual(outbox[0].kind, 'passwordReset');
  assert.deepStrictEqual(outbox[0].to, ['oracle.real@t.co']);
});

// 2) An inactive or soft-deleted account is eligibility-gated OUT of the send — same generic 200, but no
//    email at all.  (2 forgot calls)
test('inactive and soft-deleted users get the generic 200 but NO email', { skip }, async () => {
  await mkUser({ email: 'inactive@t.co', isActive: false });
  await mkUser({ email: 'deleted@t.co', isActive: true, deletedAt: new Date() });

  const a = await call('POST', '/auth/forgot-password', { body: { email: 'inactive@t.co' } });
  const b = await call('POST', '/auth/forgot-password', { body: { email: 'deleted@t.co' } });
  assert.strictEqual(a.status, 200);
  assert.strictEqual(b.status, 200);

  // Prove ABSENCE: the detached block early-returns before any send, so give it a beat and confirm empty.
  await sleep(300);
  assert.strictEqual(outbox.length, 0, 'ineligible users must produce no email');
});

// 3) The persisted token is a HASH of the emailed one — a leaked DB row is not a working link.  (1 forgot)
test('the stored reset token is sha256(raw), never the raw token itself', { skip }, async () => {
  const user = await mkUser({ email: 'hash.user@t.co' });
  const r = await call('POST', '/auth/forgot-password', { body: { email: 'hash.user@t.co' } });
  assert.strictEqual(r.status, 200);

  const seen = await waitFor(() => outbox.length === 1);
  assert.ok(seen, 'the reset email should have been recorded');
  const raw = tokenFromEntry(outbox[0]);
  assert.ok(raw && raw.length >= 20, 'a raw token must appear in the email link');

  const fresh = await User.findById(user._id).lean();
  assert.strictEqual(fresh.passwordResetToken, sha256Hex(raw), 'DB stores the hash of the emailed token');
  assert.notStrictEqual(fresh.passwordResetToken, raw, 'DB never stores the raw token');
});

// 4) Happy path — a strong password sets the login and clears the token fields.  (0 forgot; token minted directly)
test('reset with a strong password works: new password logs in, old is rejected, token fields cleared', { skip }, async () => {
  const user = await mkUser({ email: 'happy@t.co', password: 'OldPass!23' });
  const { rawToken } = await issuePasswordResetToken(user._id);

  const reset = await call('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: STRONG } });
  assert.strictEqual(reset.status, 200);
  assert.deepStrictEqual(reset.json, { ok: true });

  const good = await call('POST', '/auth/login', { body: { email: 'happy@t.co', password: STRONG } });
  assert.strictEqual(good.status, 200, 'the new password logs in');
  const bad = await call('POST', '/auth/login', { body: { email: 'happy@t.co', password: 'OldPass!23' } });
  assert.strictEqual(bad.status, 401, 'the old password no longer works');

  const fresh = await User.findById(user._id).lean();
  assert.strictEqual(fresh.passwordResetToken, null);
  assert.strictEqual(fresh.passwordResetExpiresAt, null);
});

// 5) The token is single-use — the atomic match+consume can't run twice.  (0 forgot)
test('a reset token is single-use: the second submit of the same token is RESET_INVALID', { skip }, async () => {
  const user = await mkUser({ email: 'single.use@t.co' });
  const { rawToken } = await issuePasswordResetToken(user._id);

  const first = await call('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: STRONG } });
  assert.strictEqual(first.status, 200);
  const second = await call('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: 'An0ther!Pw' } });
  assert.strictEqual(second.status, 400);
  assert.strictEqual(second.json.code, 'RESET_INVALID');
});

// 6) An expired token is rejected and does NOT change the password.  (0 forgot)
test('an expired token is RESET_INVALID and leaves the password unchanged', { skip }, async () => {
  const user = await mkUser({ email: 'expired@t.co', password: 'OldPass!23' });
  const { rawToken } = await issuePasswordResetToken(user._id);
  const before = await User.findById(user._id).lean();

  await User.updateOne({ _id: user._id }, { $set: { passwordResetExpiresAt: new Date(Date.now() - 1000) } });

  const reset = await call('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: STRONG } });
  assert.strictEqual(reset.status, 400);
  assert.strictEqual(reset.json.code, 'RESET_INVALID');

  const after = await User.findById(user._id).lean();
  assert.strictEqual(after.passwordHash, before.passwordHash, 'the password hash must be untouched');
});

// 7) A weak password fails Zod BEFORE the token lookup, so it does NOT consume the token — the user fixes
//    it and resubmits the SAME link.  (0 forgot)
test('a weak password 400s on shape (not RESET_INVALID) and does not consume the token', { skip }, async () => {
  const user = await mkUser({ email: 'weak.then.strong@t.co' });
  const { rawToken } = await issuePasswordResetToken(user._id);

  const weak = await call('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: 'weak' } });
  assert.strictEqual(weak.status, 400);
  assert.notStrictEqual(weak.json.code, 'RESET_INVALID', 'a weak password is a validation failure, not a spent token');
  assert.strictEqual(weak.json.error, 'Invalid input');

  const strong = await call('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: STRONG } });
  assert.strictEqual(strong.status, 200, 'the same token still works after the weak attempt');
});

// 8) mustChangePassword / invite links: the same machinery, at the 72h INVITE_TOKEN_HOURS TTL, clears the
//    temp-password state — this is how a set-password invite is consumed.  (0 forgot)
test('consuming an invite (INVITE_TOKEN_HOURS) token clears mustChangePassword + tempPasswordSetAt', { skip }, async () => {
  const user = await mkUser({
    email: 'invitee@t.co',
    mustChangePassword: true,
    tempPasswordSetAt: new Date(),
  });
  const { rawToken } = await issuePasswordResetToken(user._id, { hours: INVITE_TOKEN_HOURS });

  const reset = await call('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: STRONG } });
  assert.strictEqual(reset.status, 200);

  const fresh = await User.findById(user._id).lean();
  assert.strictEqual(fresh.mustChangePassword, false);
  assert.strictEqual(fresh.tempPasswordSetAt, null);
  assert.strictEqual(fresh.passwordResetToken, null);
});

// 10) A structurally-valid but unknown token is the generic RESET_INVALID.  (0 forgot)
test('a garbage (well-formed but unknown) token is RESET_INVALID', { skip }, async () => {
  const reset = await call('POST', '/auth/reset-password', {
    body: { token: 'g'.repeat(40), newPassword: STRONG }, // ≥20 chars, so it passes Zod and reaches the lookup
  });
  assert.strictEqual(reset.status, 400);
  assert.strictEqual(reset.json.code, 'RESET_INVALID');
});

// 9) Throttle — MUST run LAST (it consumes the forgot budget). Six requests for one FRESH email: the 6th
//    trips the per-email cap of 5. Then prove the LOGIN limiter is a SEPARATE store — a login attempt for
//    that same email still returns 401 invalid-credentials, not 429.
//    Budget: 5 earlier forgot calls + 6 here = 11 per-IP hits < 20 cap; fresh email → per-email starts at 0.
test('forgot-password throttles at the 6th request for one email; the login limiter is untouched', { skip }, async () => {
  await mkUser({ email: 'throttle@t.co', password: 'OldPass!23' });

  const statuses = [];
  for (let i = 0; i < 6; i++) {
    const r = await call('POST', '/auth/forgot-password', { body: { email: 'throttle@t.co' } });
    statuses.push(r.status);
  }
  for (let i = 0; i < 5; i++) assert.strictEqual(statuses[i], 200, `request ${i + 1} should pass`);
  assert.strictEqual(statuses[5], 429, 'the 6th reset request for this email is throttled');

  // The forgot throttle must not have bled into the login limiter (separate store).
  const login = await call('POST', '/auth/login', { body: { email: 'throttle@t.co', password: 'wrong-password' } });
  assert.strictEqual(login.status, 401, 'login is still reachable (401 invalid creds), not 429');
});
