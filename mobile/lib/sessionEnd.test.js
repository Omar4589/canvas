import { test } from 'node:test';
import assert from 'node:assert';
import {
  REASONS,
  sessionEndReason,
  phoneAction,
  tokenToEnd,
  CANVASS_FLOW,
  shouldDefer,
  isFieldScreen,
  retryUnless401,
  mayWriteRoster,
  reauthBody,
  signedOutNote,
  pendingLine,
  reauthNotice,
  notYouConfirm,
  RESET_WINDOW_MS,
  resetWindowOpen,
  keepReauthInPlace,
  tokenSub,
} from './sessionEnd.js';

test('sessionEndReason: only a 401 SESSION_REVOKED is a session end', () => {
  for (const r of REASONS) assert.equal(sessionEndReason(401, { code: 'SESSION_REVOKED', reason: r }), r);
  assert.equal(sessionEndReason(401, { code: 'SESSION_REVOKED' }), 'password_changed', 'an older server');
  assert.equal(sessionEndReason(401, { code: 'SESSION_REVOKED', reason: 'from-the-future' }), 'invalid');
  assert.equal(sessionEndReason(401, { error: 'Invalid credentials' }), null, 'a wrong typed password');
  for (const code of ['KEY_REVOKED', 'KEY_INVALID', 'KEY_EXPIRED']) {
    assert.equal(sessionEndReason(401, { code }), null, `FbTime ${code}`);
  }
  assert.equal(sessionEndReason(403, { code: 'SESSION_REVOKED' }), null);
  assert.equal(sessionEndReason(401, null), null);
});

test('phoneAction: run-outs ask in place; deliberate ends sign out', () => {
  for (const r of ['expired', 'invalid', 'missing']) assert.equal(phoneAction(r), 'reauth', r);
  for (const r of ['deleted', 'inactive', 'password_changed']) assert.equal(phoneAction(r), 'signout', r);
  assert.equal(phoneAction('password_changed', { reauthUp: true }), 'reauth', 'Forgot password from the screen');
  assert.equal(phoneAction('deleted', { reauthUp: true }), 'signout');
});

test('tokenToEnd: never ends a session other than the one the answer was about', () => {
  assert.equal(tokenToEnd({ sentToken: 'A', heldAtSend: 'A', current: 'A' }), 'A');
  assert.equal(tokenToEnd({ sentToken: 'A', heldAtSend: undefined, current: undefined }), 'A', 'hydrating');
  assert.equal(tokenToEnd({ sentToken: 'A', heldAtSend: 'A', current: 'B' }), null, 'rotated meanwhile');
  assert.equal(tokenToEnd({ sentToken: 'A', heldAtSend: 'A', current: null }), null, 'signed out meanwhile');
  assert.equal(tokenToEnd({ sentToken: null, heldAtSend: 'A', current: 'A' }), 'A', 'storage lost the token');
  assert.equal(
    tokenToEnd({ sentToken: null, heldAtSend: 'A', current: 'B' }),
    null,
    'a bare request from the previous session landing after a new sign-in'
  );
  assert.equal(tokenToEnd({ sentToken: null, heldAtSend: null, current: 'B' }), null, 'sent while signed out');
  assert.equal(tokenToEnd({ sentToken: null, heldAtSend: undefined, current: undefined }), null);
});

test('the door flow and the field screens', () => {
  for (const p of ['/household/abc', '/voter/v1/survey', '/survey-practice/s1']) {
    assert.ok(CANVASS_FLOW.test(p), p);
    assert.equal(shouldDefer(p, false), true, p);
  }
  for (const p of ['/map', '/books', '/building', '/survey-practice', '/admin', '/login', null]) {
    assert.equal(shouldDefer(p, false), false, String(p));
  }
  assert.equal(shouldDefer('/map', true), true, 'a save in flight');
  for (const p of ['/map', '/books', '/building']) assert.ok(isFieldScreen(p), p);
  for (const p of ['/admin', '/household/1', '/mapx', '/campaigns']) assert.ok(!isFieldScreen(p), p);
});

test('retryUnless401: one retry for everything except a 401', () => {
  assert.equal(retryUnless401(0, { status: 500 }), true);
  assert.equal(retryUnless401(1, { status: 500 }), false);
  assert.equal(retryUnless401(0, new Error('Request timed out')), true);
  assert.equal(retryUnless401(0, { status: 401 }), false);
});

test('mayWriteRoster: never once a sign-out began, never while signed out', () => {
  assert.equal(mayWriteRoster({ signedIn: true, ending: false }), true);
  assert.equal(mayWriteRoster({ signedIn: true, ending: true }), false);
  assert.equal(mayWriteRoster({ signedIn: false, ending: false }), false);
});

test('copy: the password screen never says "signed out"; notes say why', () => {
  assert.ok(!/signed out/i.test(reauthBody('expired')));
  assert.ok(!/signed out/i.test(reauthBody('password_changed')));
  assert.match(reauthBody('password_changed'), /new password/);
  assert.match(signedOutNote('password_changed'), /password was changed/);
  assert.match(signedOutNote('deleted'), /deleted/);
  assert.match(signedOutNote('inactive'), /admin/);
  for (const r of ['missing', 'expired', 'invalid', 'whatever']) {
    assert.equal(signedOutNote(r), "You've been signed out. Sign in again to keep going.", r);
  }
});

test('copy: the pending line, the notice and the Not-you confirm', () => {
  assert.equal(pendingLine(0, 'expired'), null);
  assert.equal(pendingLine(3, 'deleted'), null, 'never promised to an account that cannot sign in');
  assert.equal(pendingLine(3, 'inactive'), null);
  assert.match(pendingLine(1, 'expired'), /^1 recorded item is saved on this phone\. It'll be sent/);
  assert.match(pendingLine(3, 'password_changed'), /^3 recorded items .* as yourself\.$/);
  assert.match(reauthNotice(0), /send new work/);
  assert.match(reauthNotice(1), /1 item is waiting/);
  assert.match(reauthNotice(4), /4 items are waiting/);
  assert.equal(notYouConfirm(), 'Signing out removes your saved houses from this phone. Sign out anyway?');
  assert.match(notYouConfirm({ pending: 2, noSignal: true }), /2 saved items .* need signal/);
});

test('the reset window runs from the last use of the password screen, not from when it went up', () => {
  const raisedAt = 1_000_000;
  const MIN = 60_000;
  assert.equal(resetWindowOpen({ raisedAt }, raisedAt + MIN), true);
  assert.equal(resetWindowOpen({ raisedAt }, raisedAt + RESET_WINDOW_MS), false, 'a phone left at the screen');
  // Up at 09:00, Later at 09:01, back in signal at 10:35, Forgot password? at 10:35, the reset
  // answer at 10:40: the person's own reset, in place.
  const later = raisedAt + MIN;
  const forgot = raisedAt + 95 * MIN;
  assert.equal(resetWindowOpen({ raisedAt, activeAt: forgot }, forgot + 5 * MIN), true, 'Forgot password after a long Later');
  assert.equal(resetWindowOpen({ raisedAt, activeAt: later }, forgot + 5 * MIN), false, 'untouched since Later');
  assert.equal(resetWindowOpen({ raisedAt, activeAt: forgot }, forgot + RESET_WINDOW_MS), false);
  assert.equal(resetWindowOpen({ raisedAt, activeAt: raisedAt - MIN }, raisedAt + MIN), true, 'never earlier than raisedAt');
  assert.equal(resetWindowOpen({ raisedAt, activeAt: 'soon' }, raisedAt + MIN), true);
  assert.equal(resetWindowOpen(null, raisedAt), false);
  assert.equal(resetWindowOpen({}, raisedAt), false);
});

test('keepReauthInPlace: half an hour from the switch to the new-password screen, then a sign-out', () => {
  const raisedAt = 1_000_000;
  const MIN = 60_000;
  // Forgot password? at +1 min, the reset heard at +10 min: the screen asks for the new password.
  const asking = { reason: 'password_changed', raisedAt, activeAt: raisedAt + MIN, changeHeardAt: raisedAt + 10 * MIN };
  assert.equal(keepReauthInPlace(asking, raisedAt + 35 * MIN), true, 'a repeat answer while they fetch the new password');
  assert.equal(keepReauthInPlace(asking, raisedAt + 41 * MIN), false, 'left untouched half an hour after the switch');
  assert.equal(keepReauthInPlace(asking, raisedAt + 5 * 60 * MIN), false, 'a lost phone no longer keeps its houses forever');
  assert.equal(keepReauthInPlace({ ...asking, activeAt: raisedAt + 4 * 60 * MIN }, raisedAt + 4 * 60 * MIN + 5 * MIN), true, 'still being used');
  assert.equal(keepReauthInPlace({ reason: 'expired', raisedAt }, raisedAt + 1), true);
  assert.equal(keepReauthInPlace(null, raisedAt), false);
  // Wired as app/_layout.jsx does: the reason decides only through phoneAction.
  assert.equal(phoneAction('password_changed', { reauthUp: keepReauthInPlace(asking, raisedAt + 5 * 60 * MIN) }), 'signout');
  assert.equal(phoneAction('password_changed', { reauthUp: keepReauthInPlace(asking, raisedAt + 35 * MIN) }), 'reauth');
});

test('tokenSub reads the account id from a token without verifying it', () => {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const payload = part({ sub: '64b7f0c2a1e4d5f6a7b8c9d0', n: '???>>>' });
  assert.ok(/[-_]/.test(payload), 'exercises the url-safe alphabet');
  assert.equal(tokenSub(`${part({ alg: 'HS256' })}.${payload}.sig`), '64b7f0c2a1e4d5f6a7b8c9d0');
  assert.equal(tokenSub(`h.${part({ sub: 42 })}.s`), null, 'not a string');
  assert.equal(tokenSub(`h.${part({ iat: 1 })}.s`), null, 'no sub');
  assert.equal(tokenSub('h.%%%.s'), null);
  assert.equal(tokenSub('no-dots'), null);
  assert.equal(tokenSub(null), null);
});
