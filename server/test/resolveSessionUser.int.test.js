import { test, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

// resolveSessionUser (services/auth/resolveSessionUser.js) must reach EXACTLY requireAuth's verdict
// for every token, without answering a request and without stamping lastSeenAt — it is how a public
// report open tells a signed-in member from a link holder (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md
// §F7), and a token requireAuth would refuse must never name a member there.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/resolve node --test test/resolveSessionUser.int.test.js
//
// The two are run over the same matrix: valid, renewal-due, expired, past the 90-day cap, an old token
// (no auth_ms, no sid), an ended session (new and old shapes), a password changed since sign-in, a
// deleted, an inactive and a missing account, a share token, a bull-board ticket, a forged signature,
// junk, nothing at all — and a server with no secret. If requireAuth gains a check, this is where the
// matrix shows the two have drifted.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-resolve-session';
process.env.REDIS_URL = 'redis://127.0.0.1:1';

const { requireAuth } = await import('../src/middleware/auth.js');
const { resolveSessionUser } = await import('../src/services/auth/resolveSessionUser.js');
const { signShareToken, legacySessionId, SESSION_MAX_MS } = await import('../src/services/auth/tokens.js');
const { signBullBoardTicket } = await import('../src/queues/bullBoard.js');
const { User } = await import('../src/models/User.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const SECRET = process.env.JWT_SECRET;
const DAY = 86400;
const nowSec = () => Math.floor(Date.now() / 1000);

const mint = (user, { ageSec = 0, expiresIn = '30d', authMs, sid, legacy = false, secret = SECRET } = {}) => {
  const iat = nowSec() - ageSec;
  const claims = { sub: String(user._id), email: user.email, isSuperAdmin: !!user.isSuperAdmin, iat };
  if (!legacy) {
    claims.auth_ms = authMs ?? iat * 1000;
    claims.sid = sid ?? `sid-${crypto.randomUUID()}`;
  }
  return jwt.sign(claims, secret, { expiresIn });
};

// requireAuth's verdict for a token, read off the middleware itself: through (with which user), a
// coded 401 (its reason), or a 503 server fault.
const viaRequireAuth = async (token) => {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  let out = null;
  const res = {
    status(code) { this.code = code; return this; },
    json(body) { out = { code: this.code, body }; return this; },
  };
  let nextErr;
  let nexted = false;
  await requireAuth(req, res, (err) => { nexted = true; nextErr = err; });
  if (nexted && !nextErr) return { verdict: 'ok', userId: String(req.user._id) };
  if (nexted && nextErr) return { verdict: nextErr.status === 503 ? 'fault' : `error:${nextErr.status}` };
  assert.strictEqual(out.code, 401);
  assert.strictEqual(out.body.code, 'SESSION_REVOKED');
  return { verdict: out.body.reason };
};
const viaResolve = async (token) => {
  const { user, reason } = await resolveSessionUser(token);
  return user ? { verdict: 'ok', userId: String(user._id) } : { verdict: reason };
};

const ctx = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await User.deleteMany({});
  const mk = (email, extra = {}) => User.create({ firstName: 'R', lastName: email.split('@')[0], email, passwordHash: 'x', isActive: true, ...extra });
  Object.assign(ctx, {
    walker: await mk('walker@r.co'),
    staff: await mk('staff@r.co', { isSuperAdmin: true, platformRole: 'support' }),
    changed: await mk('changed@r.co', { passwordChangedAt: new Date(Date.now() - 60 * 1000) }),
    ended: await mk('ended@r.co'),
    gone: await mk('gone@r.co', { isActive: false, deletedAt: new Date() }),
    off: await mk('off@r.co', { isActive: false }),
    quiet: await mk('quiet@r.co'),
  });
  const endedToken = mint(ctx.ended, { sid: 'ended-sid' });
  const endedLegacy = mint(ctx.ended, { legacy: true, ageSec: 5 });
  await User.updateOne({ _id: ctx.ended._id }, { $set: { endedSessionIds: ['ended-sid', legacySessionId(endedLegacy)] } });
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  Object.assign(ctx, { endedToken, endedLegacy, junkJson: `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc('not an object')}` });
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

test('resolveSessionUser reaches requireAuth’s verdict for every token in the matrix', { skip }, async () => {
  const ghost = { _id: new mongoose.Types.ObjectId(), email: 'ghost@r.co' };
  const matrix = {
    valid: mint(ctx.walker),
    'super admin': mint(ctx.staff),
    'renewal due, still valid': mint(ctx.walker, { ageSec: 2 * DAY }),
    expired: mint(ctx.walker, { ageSec: 31 * DAY }),
    'past the 90-day cap': mint(ctx.walker, { authMs: Date.now() - SESSION_MAX_MS - 60 * 1000 }),
    'old token, no auth_ms or sid': mint(ctx.walker, { legacy: true }),
    'ended session': ctx.endedToken,
    'ended session, old token': ctx.endedLegacy,
    'password changed since sign-in': mint(ctx.changed, { authMs: Date.now() - 2 * 60 * 1000 }),
    'signed in after the password change': mint(ctx.changed),
    'deleted account': mint(ctx.gone),
    'inactive account': mint(ctx.off),
    'no such account': mint(ghost),
    'share token': signShareToken({ shareId: new mongoose.Types.ObjectId(), campaignId: new mongoose.Types.ObjectId(), cv: 3 }),
    'bull board ticket': signBullBoardTicket(ctx.staff),
    'forged signature': mint(ctx.walker, { secret: 'not-the-secret' }),
    'a payload that is not an object': ctx.junkJson,
    junk: 'definitely.not.a-jwt',
    nothing: '',
  };
  const seen = new Set();
  for (const [name, token] of Object.entries(matrix)) {
    const a = await viaRequireAuth(token);
    const b = await viaResolve(token);
    assert.deepStrictEqual(b, a, `${name}: requireAuth said ${JSON.stringify(a)}, resolveSessionUser ${JSON.stringify(b)}`);
    seen.add(a.verdict);
  }
  // The matrix exercises every verdict requireAuth can reach.
  for (const v of ['ok', 'expired', 'invalid', 'deleted', 'inactive', 'password_changed', 'missing']) {
    assert.ok(seen.has(v), `the matrix reaches "${v}"`);
  }
});

test('a server fault is a fault for both — never a member, never a 401', { skip }, async () => {
  const token = mint(ctx.walker);
  const saved = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    const original = console.error;
    console.error = () => {};
    try {
      assert.deepStrictEqual(await viaRequireAuth(token), { verdict: 'fault' });
    } finally {
      console.error = original;
    }
    assert.deepStrictEqual(await viaResolve(token), { verdict: 'fault' });
  } finally {
    process.env.JWT_SECRET = saved;
  }
});

test('resolveSessionUser never stamps lastSeenAt (requireAuth does)', { skip }, async () => {
  const token = mint(ctx.quiet);
  assert.strictEqual((await viaResolve(token)).verdict, 'ok');
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual((await User.findById(ctx.quiet._id).lean()).lastSeenAt, null, 'no stamp from the resolver');
  assert.strictEqual((await viaRequireAuth(token)).verdict, 'ok');
  await new Promise((r) => setTimeout(r, 100));
  assert.ok((await User.findById(ctx.quiet._id).lean()).lastSeenAt, 'the middleware does stamp — so the check above means something');
});
