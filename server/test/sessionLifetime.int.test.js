import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

// Session lifetime — the HTTP contract behind docs/PROPOSAL_SESSION_EXPIRY.md:
//   - every requireAuth 401 is { code: 'SESSION_REVOKED', reason } with plain text;
//   - server faults are 503, never 401;
//   - GET /auth/me extends a used sign-in (same auth_ms + sid), within its rules;
//   - auth_ms revokes to the millisecond, and old tokens behave exactly as before;
//   - the 90-day cap; POST /auth/logout ends the session and every copy of it;
//   - bull board takes only its own cookie ticket.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/sesslife node --test test/sessionLifetime.int.test.js
//
// Tokens are minted by hand with a backdated iat (jsonwebtoken bases exp on a given iat) so the
// clock never has to move.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-session-lifetime';

const { createApp } = await import('../src/app.js');
const { Organization } = await import('../src/models/Organization.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { signShareToken, legacySessionId, SESSION_MAX_MS } = await import('../src/services/auth/tokens.js');
const { signBullBoardTicket } = await import('../src/queues/bullBoard.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const PASSWORD = 'Fielda-Work1!';
const SECRET = process.env.JWT_SECRET;
const DAY = 86400;
const nowSec = () => Math.floor(Date.now() / 1000);

let server;
let base;
const ctx = {};

async function call(method, path, { token, body, headers = {}, raw } = {}) {
  const res = await fetch(`${base}${raw ? '' : '/api'}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON (bull board HTML) */
  }
  return { status: res.status, json, text, headers: res.headers };
}

// A session token as the server would mint it (auth_ms + sid), or an OLD one (neither), with any iat.
const mint = (user, { ageSec = 0, expiresIn = '30d', authMs, sid, legacy = false } = {}) => {
  const iat = nowSec() - ageSec;
  const claims = { sub: String(user._id), email: user.email, isSuperAdmin: !!user.isSuperAdmin, iat };
  if (!legacy) {
    claims.auth_ms = authMs ?? iat * 1000;
    claims.sid = sid ?? `sid-${Math.random().toString(36).slice(2)}`;
  }
  return jwt.sign(claims, SECRET, { expiresIn });
};

// Signs ANY payload as HS256, including shapes jsonwebtoken itself refuses to sign (a string exp),
// so the server's own shape check is what gets tested.
const rawSign = (payload) => {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}`;
  return `${head}.${crypto.createHmac('sha256', SECRET).update(head).digest('base64url')}`;
};

const me = (token) => call('GET', '/auth/me', { token });
const reasonOf = (r) => `${r.status} ${r.json?.code} ${r.json?.reason}`;

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});
beforeEach(async () => {
  if (!URI) return;
  for (const M of [Organization, Subscription, User, Membership, ReportShareLink]) await M.deleteMany({});
  const org = await Organization.create({ name: 'Life Org', slug: 'life-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active', statusChangedAt: new Date() });
  const hash = await User.hashPassword(PASSWORD);
  const mk = (email, extra = {}) =>
    User.create({ firstName: 'T', lastName: email.split('@')[0], email, passwordHash: hash, isActive: true, ...extra });
  const walker = await mk('walker@t.co');
  const admin = await mk('admin@t.co');
  const boss = await mk('boss@t.co', { isSuperAdmin: true, platformRole: 'break_glass' });
  const lonely = await mk('lonely@t.co');
  const forced = await mk('forced@t.co', { mustChangePassword: true, tempPasswordSetAt: new Date() });
  const oldOff = await mk('oldoff@t.co', { isActive: false });
  const gone = await mk('gone@t.co', { isActive: false, deletedAt: new Date() });
  // boss holds a membership too, so the "super admin is never extended" case can only pass on
  // the isSuperAdmin rule itself (internal-org staff do hold memberships).
  for (const [u, role] of [
    [walker, 'canvasser'],
    [admin, 'admin'],
    [forced, 'canvasser'],
    [boss, 'admin'],
  ]) {
    await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
  }
  Object.assign(ctx, { org, walker, admin, boss, lonely, forced, oldOff, gone });
});

test('every ended session answers 401 SESSION_REVOKED with a reason and plain text', { skip }, async () => {
  const none = await call('GET', '/auth/me');
  assert.strictEqual(reasonOf(none), '401 SESSION_REVOKED missing');
  assert.strictEqual(none.json.error, 'Sign in to continue.');

  const expired = await me(mint(ctx.walker, { ageSec: 2 * DAY, expiresIn: '1d' }));
  assert.strictEqual(reasonOf(expired), '401 SESSION_REVOKED expired');
  assert.strictEqual(expired.json.error, 'Your sign-in has ended. Sign in again to keep going.');

  const goneExpired = await me(mint(ctx.gone, { ageSec: 2 * DAY, expiresIn: '1d' }));
  assert.strictEqual(reasonOf(goneExpired), '401 SESSION_REVOKED deleted', 'deleted wins over expired');
  assert.strictEqual(goneExpired.json.error, 'This account has been deleted.');

  const oldOff = await me(mint(ctx.oldOff));
  assert.strictEqual(reasonOf(oldOff), '401 SESSION_REVOKED inactive');
  assert.strictEqual(oldOff.json.error, "This account can't be used to sign in.");

  const nobody = await me(mint({ _id: new mongoose.Types.ObjectId(), email: 'x@t.co' }));
  assert.strictEqual(reasonOf(nobody), '401 SESSION_REVOKED invalid', 'no user with that id');
  assert.strictEqual(nobody.json.error, 'Your sign-in has ended. Sign in again to keep going.');

  const changedToken = mint(ctx.walker, { authMs: Date.now() - 60_000 });
  await User.updateOne({ _id: ctx.walker._id }, { $set: { passwordChangedAt: new Date() } });
  const changed = await me(changedToken);
  assert.strictEqual(reasonOf(changed), '401 SESSION_REVOKED password_changed');
  assert.strictEqual(changed.json.error, 'Your password was changed — sign in again.');
  await User.updateOne({ _id: ctx.walker._id }, { $set: { passwordChangedAt: null } });

  // The wrong-password 401s are not session ends and stay uncoded.
  const badLogin = await call('POST', '/auth/login', { body: { email: 'walker@t.co', password: 'nope' } });
  assert.strictEqual(badLogin.status, 401);
  assert.strictEqual(badLogin.json.code, undefined);
  const tok = (await call('POST', '/auth/login', { body: { email: 'walker@t.co', password: PASSWORD } })).json.token;
  const badChange = await call('POST', '/auth/change-password', {
    token: tok,
    body: { currentPassword: 'wrong', newPassword: 'Fielda-Work2!' },
  });
  assert.strictEqual(badChange.status, 401);
  assert.strictEqual(badChange.json.code, undefined);
});

test('unreadable or foreign tokens are `invalid` without ever reading the database', { skip }, async (t) => {
  const iat = nowSec();
  const sign = (payload, opts = {}) => jwt.sign(payload, SECRET, opts);
  const nonJson = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from('nope').toString(
    'base64url'
  )}.sig`;
  const cases = {
    'bad signature': jwt.sign({ sub: String(ctx.walker._id) }, 'other-secret', { expiresIn: '1d' }),
    malformed: 'not-a-token',
    'non-JSON payload': nonJson,
    'string payload': sign('just a string'),
    'numeric sub': sign({ sub: 6 }, { expiresIn: '1d' }),
    'string exp': rawSign({ sub: String(ctx.walker._id), iat, exp: String(iat + 100) }),
    'float iat': rawSign({ sub: String(ctx.walker._id), iat: iat + 0.5, exp: iat + 100 }),
    'no exp': rawSign({ sub: String(ctx.walker._id), iat }),
    'share token': signShareToken({ shareId: 'x', campaignId: 'y' }),
    'kind with a valid sub': rawSign({ kind: 'share', sub: String(ctx.walker._id), iat, exp: iat + 100 }),
    'bull board ticket': signBullBoardTicket(ctx.boss),
    'forged expired': jwt.sign({ sub: String(ctx.walker._id), iat: iat - 100 }, 'other-secret', { expiresIn: '1s' }),
    'nbf in the future': sign({ sub: String(ctx.walker._id) }, { expiresIn: '1d', notBefore: '1h' }),
  };
  const findById = t.mock.method(User, 'findById');
  for (const [label, token] of Object.entries(cases)) {
    const r = await me(token);
    assert.strictEqual(reasonOf(r), '401 SESSION_REVOKED invalid', label);
  }
  assert.strictEqual(findById.mock.callCount(), 0, 'none of them reached the user lookup');
});

test('server faults answer 503 with generic text, never a 401', { skip }, async (t) => {
  const token = mint(ctx.walker);
  // Fails the way a lost database connection does: the lookup rejects when it is awaited, with
  // or without a projection chained on (requireAuth asks for +endedSessionIds).
  t.mock.method(User, 'findById', () => {
    const query = {
      select: () => query,
      then: (onOk, onFail) =>
        Promise.reject(new Error('connection to db-host-17.internal timed out')).then(onOk, onFail),
    };
    return query;
  });
  const dbDown = await me(token);
  assert.strictEqual(dbDown.status, 503);
  assert.strictEqual(dbDown.json.error, 'Sign-in check unavailable. Try again.');
  assert.ok(!dbDown.text.includes('db-host-17'), 'the internal message never leaves the server');
  t.mock.restoreAll();

  const saved = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    const noSecret = await me(token);
    assert.strictEqual(noSecret.status, 503);
    assert.ok(!noSecret.text.includes('JWT_SECRET'));
  } finally {
    process.env.JWT_SECRET = saved;
  }
});

test('an expired share unlock still answers password-required (share keeps its own 24h check)', { skip }, async () => {
  // A link to one report, as every link is now (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C2), so
  // RETIRE_ALL_REPORTS_LINKS never stands between it and the share token's own check.
  const share = await ReportShareLink.create({
    organizationId: ctx.org._id,
    campaignId: new mongoose.Types.ObjectId(),
    reportId: new mongoose.Types.ObjectId(),
    token: 'life-share-token',
    passwordHash: await User.hashPassword('share-pass'),
    isActive: true,
  });
  const expiredUnlock = jwt.sign(
    { kind: 'share', shareId: String(share._id), campaignId: String(share.campaignId), iat: nowSec() - 2 * DAY },
    SECRET,
    { expiresIn: '24h' }
  );
  const r = await call('GET', '/share/life-share-token/reports', { headers: { 'X-Share-Token': expiredUnlock } });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.json.code, 'password-required');
});

test('GET /auth/me extends a used sign-in, keeping its auth_ms and session id', { skip }, async () => {
  const authMs = (nowSec() - 2 * DAY) * 1000;
  const old = mint(ctx.walker, { ageSec: 2 * DAY, authMs, sid: 'walker-session' });
  const before_ = await User.findById(ctx.walker._id).lean();
  const r = await me(old);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('cache-control'), 'no-store');
  assert.ok(r.json.token, 'a fresh token comes back');
  const fresh = jwt.decode(r.json.token);
  assert.strictEqual(fresh.auth_ms, authMs, 'same sign-in time');
  assert.strictEqual(fresh.sid, 'walker-session', 'same session');
  assert.ok(fresh.iat >= nowSec() - 5, 'a new iat');
  assert.strictEqual((await me(r.json.token)).status, 200, 'the new token works');
  const after_ = await User.findById(ctx.walker._id).lean();
  assert.deepStrictEqual(after_.lastLoginAt, before_.lastLoginAt, 'extension never stamps lastLoginAt');
});

test('/auth/me does not extend when it should not', { skip }, async () => {
  const young = await me(mint(ctx.walker, { ageSec: 3600 }));
  assert.strictEqual(young.status, 200);
  assert.strictEqual(young.json.token, undefined, 'under a day old');

  for (const [label, user] of [
    ['forced password change', ctx.forced],
    ['no memberships', ctx.lonely],
    ['super admin', ctx.boss],
  ]) {
    const r = await me(mint(user, { ageSec: 2 * DAY }));
    assert.strictEqual(r.status, 200, label);
    assert.strictEqual(r.json.token, undefined, label);
  }

  // An OLD token minted under a long JWT_EXPIRES_IN, more than 90 days old: not capped (it predates
  // auth_ms), and never extended into a token that would be born past the cap.
  const ancient = mint(ctx.walker, { ageSec: 100 * DAY, expiresIn: '365d', legacy: true });
  const r = await me(ancient);
  assert.strictEqual(r.status, 200, 'old tokens are not capped');
  assert.strictEqual(r.json.token, undefined, 'and not extended past the cap');
});

test('a failure while extending never fails /auth/me', { skip }, async () => {
  const saved = process.env.JWT_EXPIRES_IN;
  process.env.JWT_EXPIRES_IN = 'banana'; // jwt.sign throws on this
  try {
    const r = await me(mint(ctx.walker, { ageSec: 2 * DAY }));
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.token, undefined);
  } finally {
    if (saved === undefined) delete process.env.JWT_EXPIRES_IN;
    else process.env.JWT_EXPIRES_IN = saved;
  }
});

test('old tokens: extended with their derived sign-in time and session id', { skip }, async () => {
  const old = mint(ctx.walker, { ageSec: 2 * DAY, legacy: true });
  const { iat } = jwt.decode(old);
  const r = await me(old);
  assert.ok(r.json.token);
  const fresh = jwt.decode(r.json.token);
  assert.strictEqual(fresh.auth_ms, iat * 1000 + 999);
  assert.strictEqual(fresh.sid, legacySessionId(old));
});

test('old tokens: a later password change revokes both the token and its extension', { skip }, async () => {
  const old = mint(ctx.walker, { ageSec: 2 * DAY, legacy: true });
  const { iat } = jwt.decode(old);
  const extended = (await me(old)).json.token;
  // Stamp BETWEEN the old iat and the extension's own iat. Under the old iat rule the extension
  // (iat = now) would survive this stamp; under auth_ms it must not.
  await User.updateOne({ _id: ctx.walker._id }, { $set: { passwordChangedAt: new Date((iat + 3600) * 1000) } });
  assert.strictEqual(reasonOf(await me(old)), '401 SESSION_REVOKED password_changed');
  assert.strictEqual(reasonOf(await me(extended)), '401 SESSION_REVOKED password_changed');
});

test('two copies of one old token: signing one out ends both', { skip }, async () => {
  const old = mint(ctx.walker, { ageSec: 2 * DAY, legacy: true });
  const copyA = (await me(old)).json.token;
  const copyB = (await me(old)).json.token;
  assert.strictEqual(jwt.decode(copyA).sid, jwt.decode(copyB).sid, 'one derived session id');
  assert.strictEqual((await call('POST', '/auth/logout', { token: copyA })).status, 200);
  assert.strictEqual(reasonOf(await me(copyB)), '401 SESSION_REVOKED invalid');
  assert.strictEqual(reasonOf(await me(old)), '401 SESSION_REVOKED invalid');
});

test('a login in the same second as a password change is revoked by it', { skip }, async () => {
  const login = await call('POST', '/auth/login', { body: { email: 'walker@t.co', password: PASSWORD } });
  const { auth_ms: authMs, iat } = jwt.decode(login.json.token);
  // A stamp after the login's sign-in time but inside its iat second: the old whole-second rule
  // let this token through.
  const changed = Math.max(authMs + 1, iat * 1000);
  assert.strictEqual(Math.floor(changed / 1000), iat, 'same second as the token');
  await User.updateOne({ _id: ctx.walker._id }, { $set: { passwordChangedAt: new Date(changed) } });
  assert.strictEqual(reasonOf(await me(login.json.token)), '401 SESSION_REVOKED password_changed');
});

test('change-password keeps the changing device signed in and ends every other session', { skip }, async () => {
  const other = (await call('POST', '/auth/login', { body: { email: 'walker@t.co', password: PASSWORD } })).json.token;
  const mine = (await call('POST', '/auth/login', { body: { email: 'walker@t.co', password: PASSWORD } })).json.token;
  const changed = await call('POST', '/auth/change-password', {
    token: mine,
    body: { currentPassword: PASSWORD, newPassword: 'Fielda-Work2!' },
  });
  assert.strictEqual(changed.status, 200);
  const stamp = (await User.findById(ctx.walker._id).lean()).passwordChangedAt.getTime();
  assert.strictEqual(jwt.decode(changed.json.token).auth_ms, stamp, 'one instant for the stamp and the token');
  assert.strictEqual((await me(changed.json.token)).status, 200);
  assert.strictEqual(reasonOf(await me(other)), '401 SESSION_REVOKED password_changed');
});

test('the 90-day cap ends a sign-in that carries auth_ms', { skip }, async () => {
  const authMs = Date.now() - SESSION_MAX_MS - 60_000;
  const capped = mint(ctx.walker, { ageSec: 3600, authMs });
  assert.strictEqual(reasonOf(await me(capped)), '401 SESSION_REVOKED expired');
});

test('POST /auth/logout ends that session and its copies, and nothing else', { skip }, async () => {
  // Minted, not logged in: login's fire-and-forget lastLoginAt write moves updatedAt and could land
  // after `before_` is read below.
  const s1 = mint(ctx.walker, { sid: 'walker-s1' });
  const s2 = mint(ctx.walker, { sid: 'walker-s2' });
  const copyOfS1 = `${s1}`;
  const before_ = await User.findById(ctx.walker._id).lean();
  assert.strictEqual((await call('POST', '/auth/logout', { token: s1 })).status, 200);
  assert.strictEqual(reasonOf(await me(s1)), '401 SESSION_REVOKED invalid');
  assert.strictEqual(reasonOf(await me(copyOfS1)), '401 SESSION_REVOKED invalid');
  assert.strictEqual((await me(s2)).status, 200, 'the other session keeps working');
  const after_ = await User.findById(ctx.walker._id).select('+endedSessionIds').lean();
  assert.deepStrictEqual(after_.updatedAt, before_.updatedAt, 'a sign-out does not move updatedAt');
  assert.deepStrictEqual(after_.endedSessionIds, [jwt.decode(s1).sid]);
  assert.ok(!('endedSessionIds' in (await User.findById(ctx.walker._id).lean())), 'not loaded unless asked for');
  assert.ok(!('endedSessionIds' in (await me(s2)).json.user), 'never sent to a client');
});

test('the ended list keeps the last 200; deletion clears it', { skip }, async () => {
  const filler = Array.from({ length: 200 }, (_, i) => `old-${i}`);
  await User.updateOne({ _id: ctx.walker._id }, { $set: { endedSessionIds: filler } });
  const s = (await call('POST', '/auth/login', { body: { email: 'walker@t.co', password: PASSWORD } })).json.token;
  await call('POST', '/auth/logout', { token: s });
  const list = (await User.findById(ctx.walker._id).select('+endedSessionIds').lean()).endedSessionIds;
  assert.strictEqual(list.length, 200);
  assert.strictEqual(list[0], 'old-1', 'the oldest dropped');
  assert.strictEqual(list.at(-1), jwt.decode(s).sid);

  const del = await call('DELETE', '/auth/account', {
    token: (await call('POST', '/auth/login', { body: { email: 'walker@t.co', password: PASSWORD } })).json.token,
    body: { currentPassword: PASSWORD },
  });
  assert.strictEqual(del.status, 200, JSON.stringify(del.json));
  assert.deepStrictEqual((await User.findById(ctx.walker._id).select('+endedSessionIds').lean()).endedSessionIds, []);
});

test('bull board opens only for its own ticket in its cookie', { skip }, async () => {
  const session = mint(ctx.boss);
  const ticket = signBullBoardTicket(ctx.boss);
  const cookie = (t) => ({ cookie: `bb_token=${encodeURIComponent(t)}` });
  assert.strictEqual((await call('GET', '/admin/queues', { raw: true, headers: cookie(session) })).status, 403);
  assert.strictEqual((await call('GET', '/admin/queues', { raw: true, token: session })).status, 403);
  assert.strictEqual((await call('GET', `/admin/queues?t=${encodeURIComponent(ticket)}`, { raw: true })).status, 403);
  assert.strictEqual((await call('GET', '/admin/queues', { raw: true, headers: cookie(ticket) })).status, 200);
});
