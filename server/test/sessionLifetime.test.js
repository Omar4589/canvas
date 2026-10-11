import { test } from 'node:test';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';

// Session lifetime — the pure pieces (no database). The HTTP contract, extension, sign-out and
// the bull board guard are in sessionLifetime.int.test.js. See docs/PROPOSAL_SESSION_EXPIRY.md.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-session-lifetime';

const {
  signUserToken,
  renewUserToken,
  renewalDue,
  legacySessionId,
  verifySessionToken,
  verifyToken,
  sessionClaims,
  signShareToken,
  SESSION_MAX_MS,
} = await import('../src/services/auth/tokens.js');
const { requireBullBoardAuth, signBullBoardTicket, BULL_BOARD_COOKIE } = await import('../src/queues/bullBoard.js');

const SECRET = process.env.JWT_SECRET;
const USER = { _id: '64b7f0c2a1b2c3d4e5f60718', email: 'walker@t.co', isSuperAdmin: false };
const nowSec = () => Math.floor(Date.now() / 1000);

test('renewalDue: daily for a 30-day token, halfway for a short one', () => {
  const now = 2_000_000_000;
  const thirty = { iat: now - 86399, exp: now - 86399 + 30 * 86400 };
  assert.strictEqual(renewalDue(thirty, now), false, 'a day minus a second is not due');
  assert.strictEqual(renewalDue({ ...thirty, iat: now - 86400, exp: now - 86400 + 30 * 86400 }, now), true);
  const twoMin = { iat: now - 59, exp: now - 59 + 120 };
  assert.strictEqual(renewalDue(twoMin, now), false);
  assert.strictEqual(renewalDue({ iat: now - 60, exp: now - 60 + 120 }, now), true, 'a 2-minute token is due after one');
});

test('signUserToken carries auth_ms and a session id; renewUserToken keeps both and never defaults', () => {
  const plain = jwt.decode(signUserToken(USER));
  assert.ok(Number.isFinite(plain.auth_ms), 'auth_ms is set');
  assert.match(plain.sid, /^[0-9a-f-]{36}$/, 'a random uuid sid');
  const given = jwt.decode(signUserToken(USER, { authMs: 1234, sid: 's-1' }));
  assert.strictEqual(given.auth_ms, 1234);
  assert.strictEqual(given.sid, 's-1');
  const renewed = jwt.decode(renewUserToken(USER, { authMs: 1234, sid: 's-1' }));
  assert.strictEqual(renewed.auth_ms, 1234, 'an extension keeps the original sign-in time');
  assert.strictEqual(renewed.sid, 's-1', 'and the same session');
  assert.throws(() => renewUserToken(USER, { sid: 's-1' }), /authMs is required/);
  assert.throws(() => renewUserToken(USER, { authMs: NaN, sid: 's-1' }), /authMs is required/);
  assert.throws(() => renewUserToken(USER, { authMs: 1 }), /sid is required/);
});

test('legacySessionId: every copy of one old token shares an id; different tokens differ', () => {
  const a = jwt.sign({ sub: USER._id, email: USER.email, isSuperAdmin: false }, SECRET, { expiresIn: '30d' });
  const b = jwt.sign({ sub: USER._id, email: USER.email, isSuperAdmin: false, iat: nowSec() - 5 }, SECRET, {
    expiresIn: '30d',
  });
  assert.strictEqual(legacySessionId(a), legacySessionId(`${a}`), 'a copy is the same string');
  assert.match(legacySessionId(a), /^legacy:[0-9a-f]{32}$/);
  assert.notStrictEqual(legacySessionId(a), legacySessionId(b));
});

test('verifySessionToken: ignores expiry, refuses anything unreadable, throws only without a secret', () => {
  const expired = jwt.sign({ sub: USER._id, iat: nowSec() - 100 }, SECRET, { expiresIn: '1s' });
  assert.ok(verifySessionToken(expired), 'expiry is checked by requireAuth, after the user lookup');
  assert.strictEqual(verifySessionToken(jwt.sign({ sub: USER._id }, 'other-secret')), null, 'bad signature');
  assert.strictEqual(verifySessionToken('not.a.token'), null, 'malformed');
  const nonJson = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from('nope').toString('base64url')}.sig`;
  assert.strictEqual(verifySessionToken(nonJson), null, 'a payload that is not JSON');
  const future = jwt.sign({ sub: USER._id }, SECRET, { expiresIn: '1d', notBefore: '1h' });
  assert.strictEqual(verifySessionToken(future), null, 'nbf in the future');
  const forgedExpired = jwt.sign({ sub: USER._id, iat: nowSec() - 100 }, 'other-secret', { expiresIn: '1s' });
  assert.strictEqual(verifySessionToken(forgedExpired), null, 'a forged expired token is invalid, never "expired"');
  const saved = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    assert.throws(() => verifySessionToken(expired), /JWT_SECRET not configured/, 'a server fault, answered 503');
  } finally {
    process.env.JWT_SECRET = saved;
  }
});

test('verifyToken (share unlocks) still enforces expiry', () => {
  const share = jwt.sign({ kind: 'share', shareId: 'x', campaignId: 'y', iat: nowSec() - 100 }, SECRET, {
    expiresIn: '1s',
  });
  assert.throws(() => verifyToken(share), /jwt expired/, 'the 24h share window is not widened');
  assert.ok(verifyToken(signShareToken({ shareId: 'x', campaignId: 'y' })));
});

test('sessionClaims: normalizes good tokens, refuses every other shape', () => {
  const iat = nowSec();
  const good = sessionClaims({ sub: USER._id, iat, exp: iat + 60, auth_ms: 5, sid: 's' });
  assert.deepStrictEqual(good, { sub: USER._id, iat, exp: iat + 60, hasAuthMs: true, authMs: 5, sid: 's' });
  const old = sessionClaims({ sub: USER._id, email: 'x', isSuperAdmin: false, iat, exp: iat + 60 });
  assert.strictEqual(old.hasAuthMs, false);
  assert.strictEqual(old.authMs, iat * 1000 + 999, 'an old token counts as the last ms of its iat second');
  assert.strictEqual(old.sid, null);
  const bad = [
    'a string',
    ['array'],
    null,
    { sub: USER._id, iat, exp: iat + 60, purpose: 'bullboard' },
    { kind: 'share', shareId: 'x', campaignId: 'y', iat, exp: iat + 60 },
    { kind: 'share', sub: USER._id, iat, exp: iat + 60 },
    { sub: 6, iat, exp: iat + 60 },
    { sub: 'not-an-object-id', iat, exp: iat + 60 },
    { sub: USER._id, iat: iat + 0.5, exp: iat + 60 },
    { sub: USER._id, iat, exp: String(iat + 60) },
    { sub: USER._id, iat },
    { sub: USER._id, iat, exp: iat + 60, auth_ms: 'soon' },
    { sub: USER._id, iat, exp: iat + 60, sid: '' },
    { sub: USER._id, iat, exp: iat + 60, sid: 7 },
  ];
  for (const payload of bad) assert.strictEqual(sessionClaims(payload), null, JSON.stringify(payload));
});

test('old-token revocation is exactly the old whole-second rule', () => {
  // Through sessionClaims, the value requireAuth actually compares with passwordChangedAt.
  let mismatches = 0;
  for (let i = 0; i < 20000; i += 1) {
    const iat = 1_700_000_000 + Math.floor(Math.random() * 100);
    const changedMs = 1_700_000_000_000 + Math.floor(Math.random() * 100_000);
    const { authMs } = sessionClaims({ sub: USER._id, iat, exp: iat + 60 });
    const newRule = authMs < changedMs;
    const oldRule = iat < Math.floor(changedMs / 1000);
    if (newRule !== oldRule) mismatches += 1;
  }
  assert.strictEqual(mismatches, 0);
});

test('the cap constant is 90 days', () => {
  assert.strictEqual(SESSION_MAX_MS, 90 * 86400 * 1000);
});

// requireBullBoardAuth accepts only its own ticket, and only from the cookie.
const runGuard = (req) => {
  let outcome = null;
  const res = {
    status(code) {
      outcome = { code };
      return this;
    },
    send(body) {
      outcome = { ...outcome, body };
      return this;
    },
  };
  requireBullBoardAuth({ headers: {}, query: {}, ...req }, res, () => {
    outcome = { code: 'next' };
  });
  return outcome;
};

test('bull board: the ticket in its cookie opens it; a session token never does', () => {
  const superAdmin = { _id: USER._id, email: 'boss@t.co', isSuperAdmin: true };
  const ticket = signBullBoardTicket(superAdmin);
  const session = signUserToken(superAdmin);
  const cookie = (t) => ({ headers: { cookie: `${BULL_BOARD_COOKIE}=${encodeURIComponent(t)}` } });
  assert.strictEqual(runGuard(cookie(ticket)).code, 'next');
  assert.strictEqual(runGuard(cookie(session)).code, 403, 'a session token in the cookie');
  assert.strictEqual(runGuard({ headers: { authorization: `Bearer ${ticket}` } }).code, 403, 'Bearer is not read');
  assert.strictEqual(runGuard({ query: { t: ticket } }).code, 403, '?t= is not read');
  assert.strictEqual(runGuard({ headers: { authorization: `Bearer ${session}` } }).code, 403);
  const staffless = signBullBoardTicket({ _id: USER._id, isSuperAdmin: false });
  assert.strictEqual(runGuard(cookie(staffless)).code, 403);
});
