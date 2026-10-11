import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sessionEndReason,
  webAction,
  sessionEndDecision,
  isPublicPath,
  parseSignedOut,
  tokenClaims,
  renewCheckDue,
  shouldAdoptRenewedToken,
  retryUnless401,
  RESET_WINDOW_MS,
  resetWindowOpen,
  keepReauthInPlace,
} from './sessionEnd.js';

// A token-shaped string with these claims (unsigned: the client never verifies, only reads).
const fakeToken = (claims) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

test('only a 401 SESSION_REVOKED is a session end', () => {
  assert.equal(sessionEndReason(401, { code: 'SESSION_REVOKED', reason: 'expired' }), 'expired');
  assert.equal(sessionEndReason(401, { code: 'SESSION_REVOKED' }), 'password_changed');
  assert.equal(sessionEndReason(401, { code: 'SESSION_REVOKED', reason: 'new-thing' }), 'invalid');
  assert.equal(sessionEndReason(401, { error: 'Invalid credentials' }), null, 'wrong password');
  assert.equal(sessionEndReason(401, { code: 'password-required' }), null, 'share-link password');
  for (const code of ['KEY_REVOKED', 'KEY_INVALID', 'KEY_EXPIRED']) assert.equal(sessionEndReason(401, { code }), null, code);
});

test('webAction: a run-out asks in place; deliberate ends go to sign-in', () => {
  assert.equal(webAction('expired'), 'reauth');
  assert.equal(webAction('invalid'), 'reauth');
  for (const r of ['missing', 'password_changed', 'deleted', 'inactive']) assert.equal(webAction(r), 'signout', r);
  assert.equal(webAction('password_changed', { reauthUp: true }), 'reauth');
});

test('sessionEndDecision acts only on the session this tab still holds', () => {
  const ended = { code: 'SESSION_REVOKED', reason: 'expired' };
  assert.deepEqual(sessionEndDecision({ status: 401, data: ended, sentToken: 'A', storedToken: 'A' }), { reason: 'expired' });
  assert.equal(sessionEndDecision({ status: 401, data: ended, sentToken: 'A', storedToken: 'B' }), null, 'rotated');
  assert.equal(sessionEndDecision({ status: 401, data: ended, sentToken: 'A', storedToken: null }), null);
  const missing = { code: 'SESSION_REVOKED', reason: 'missing' };
  assert.deepEqual(sessionEndDecision({ status: 401, data: missing, sentToken: null, storedToken: null }), { reason: 'missing' });
  assert.equal(sessionEndDecision({ status: 401, data: missing, sentToken: null, storedToken: 'B' }), null);
  assert.equal(sessionEndDecision({ status: 401, data: { error: 'Invalid credentials' }, sentToken: 'A', storedToken: 'A' }), null);
  assert.equal(sessionEndDecision({ status: 401, data: { code: 'KEY_EXPIRED' }, sentToken: 'A', storedToken: 'A' }), null);
});

test('public pages and the allowlisted note', () => {
  for (const p of ['/', '/login', '/r/abc', '/reset-password/xyz', '/privacy']) assert.ok(isPublicPath(p), p);
  for (const p of ['/admin', '/campaigns/1', '/select-org', '/change-password', '/rx']) assert.ok(!isPublicPath(p), p);
  assert.equal(parseSignedOut('deleted'), 'deleted');
  assert.equal(parseSignedOut('<script>'), null);
  assert.equal(parseSignedOut(null), null);
});

test('tokenClaims reads, never trusts, and never throws', () => {
  assert.deepEqual(tokenClaims(fakeToken({ sub: 'u1', email: 'a@b.co', iat: 5, exp: 9 })), {
    sub: 'u1',
    email: 'a@b.co',
    iat: 5,
    exp: 9,
  });
  assert.equal(tokenClaims('garbage'), null);
  assert.equal(tokenClaims(null), null);
  assert.equal(tokenClaims('a.%%%.c'), null);
});

test('renewCheckDue: old enough, used since issued, and not checked recently', () => {
  const day = 86400;
  const iat = 1_000_000;
  const token = fakeToken({ iat, exp: iat + 30 * day });
  const issuedMs = iat * 1000;
  const twoDaysLater = issuedMs + 2 * day * 1000;
  const used = issuedMs + 60_000;
  assert.equal(renewCheckDue({ token, now: twoDaysLater, lastCheckAt: 0, lastInteractionAt: used }), true);
  assert.equal(renewCheckDue({ token, now: issuedMs + 3600_000, lastCheckAt: 0, lastInteractionAt: used }), false, 'too young');
  assert.equal(renewCheckDue({ token, now: twoDaysLater, lastCheckAt: 0, lastInteractionAt: 0 }), false, 'nobody used the tab');
  assert.equal(
    renewCheckDue({ token, now: twoDaysLater, lastCheckAt: twoDaysLater - 60_000, lastInteractionAt: used }),
    false,
    'checked a minute ago (a staff tab must not ask every minute)'
  );
  assert.equal(
    renewCheckDue({ token, now: twoDaysLater, lastCheckAt: twoDaysLater - 7 * 3600_000, lastInteractionAt: used }),
    true
  );
  // A 2-minute test token: due after a minute, re-checkable every 30 seconds.
  const short = fakeToken({ iat, exp: iat + 120 });
  assert.equal(renewCheckDue({ token: short, now: issuedMs + 61_000, lastCheckAt: 0, lastInteractionAt: used }), true);
  assert.equal(renewCheckDue({ token: 'garbage', now: twoDaysLater, lastInteractionAt: used }), false);
});

test('shouldAdoptRenewedToken and the retry rule', () => {
  assert.equal(shouldAdoptRenewedToken({ sentToken: 'A', currentToken: 'A', newToken: 'B' }), true);
  assert.equal(shouldAdoptRenewedToken({ sentToken: 'A', currentToken: null, newToken: 'B' }), false, 'signed out meanwhile');
  assert.equal(shouldAdoptRenewedToken({ sentToken: 'A', currentToken: 'C', newToken: 'B' }), false);
  assert.equal(shouldAdoptRenewedToken({ sentToken: 'A', currentToken: 'A', newToken: undefined }), false);
  assert.equal(retryUnless401(0, { status: 500 }), true);
  assert.equal(retryUnless401(1, { status: 500 }), false);
  assert.equal(retryUnless401(0, { status: 401 }), false);
});

test('the reset window runs from the last use of the prompt; a new-password prompt stays', () => {
  const raisedAt = 1_000_000;
  const MIN = 60_000;
  assert.equal(resetWindowOpen({ raisedAt }, raisedAt + MIN), true);
  assert.equal(resetWindowOpen({ raisedAt }, raisedAt + RESET_WINDOW_MS), false, 'a tab left on the prompt');
  const forgot = raisedAt + 3 * RESET_WINDOW_MS;
  assert.equal(resetWindowOpen({ raisedAt, activeAt: forgot }, forgot + 5 * MIN), true, 'Forgot password? clicked later');
  assert.equal(resetWindowOpen({ raisedAt, activeAt: forgot }, forgot + RESET_WINDOW_MS), false);
  assert.equal(resetWindowOpen(null, raisedAt), false);
  const asking = { reason: 'password_changed', raisedAt, changeHeardAt: raisedAt + 10 * MIN };
  assert.equal(keepReauthInPlace(asking, raisedAt + 35 * MIN), true, 'half an hour to type the new password');
  assert.equal(keepReauthInPlace(asking, raisedAt + 10 * RESET_WINDOW_MS), false, 'not forever');
  assert.equal(keepReauthInPlace({ reason: 'expired', raisedAt }, raisedAt + RESET_WINDOW_MS), false);
  assert.equal(keepReauthInPlace(null, raisedAt), false);
  assert.equal(webAction('password_changed', { reauthUp: keepReauthInPlace({ reason: 'expired', raisedAt }, raisedAt + MIN) }), 'reauth');
});
