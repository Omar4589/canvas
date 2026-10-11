import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as web from './sessionEnd.js';
// Cross-tree on purpose (same pattern and caveats as datePresets.parity.test.js): the phone and
// the console must say exactly the same thing about an ended sign-in.
import * as mobile from '../../../mobile/lib/sessionEnd.js';

test('the password prompt and every sign-out note read the same on phone and web', () => {
  assert.equal(web.REAUTH_TITLE, mobile.REAUTH_TITLE);
  assert.equal(web.RESET_WINDOW_MS, mobile.RESET_WINDOW_MS, 'the same Forgot-password window');
  assert.deepEqual(web.REASONS, mobile.REASONS);
  for (const reason of [...web.REASONS, 'something-new', undefined]) {
    assert.equal(web.reauthBody(reason), mobile.reauthBody(reason), `reauthBody(${reason})`);
    assert.equal(web.signedOutNote(reason), mobile.signedOutNote(reason), `signedOutNote(${reason})`);
  }
});

test('both read a server answer the same way', () => {
  const answers = [
    [401, { code: 'SESSION_REVOKED', reason: 'expired' }],
    [401, { code: 'SESSION_REVOKED' }],
    [401, { code: 'SESSION_REVOKED', reason: 'odd' }],
    [401, { code: 'KEY_EXPIRED' }],
    [403, { code: 'SESSION_REVOKED' }],
  ];
  for (const [status, data] of answers) {
    assert.equal(web.sessionEndReason(status, data), mobile.sessionEndReason(status, data), JSON.stringify(data));
  }
  for (const n of [0, 1, 2]) assert.equal(web.retryUnless401(n, { status: 500 }), mobile.retryUnless401(n, { status: 500 }));
});

test('both judge the Forgot-password window the same way', () => {
  const raisedAt = 1_000_000;
  const W = web.RESET_WINDOW_MS;
  const cases = [
    [{ raisedAt }, raisedAt + 1],
    [{ raisedAt }, raisedAt + W],
    [{ raisedAt, activeAt: raisedAt + 2 * W }, raisedAt + 2 * W + 1],
    [{ raisedAt, activeAt: raisedAt + 2 * W }, raisedAt + 3 * W],
    [{ raisedAt, activeAt: 'x' }, raisedAt + 1],
    [{ reason: 'password_changed', raisedAt }, raisedAt + 9 * W],
    [{ reason: 'password_changed', raisedAt, changeHeardAt: raisedAt + 2 * W }, raisedAt + 2 * W + 1],
    [{ reason: 'password_changed', raisedAt, changeHeardAt: raisedAt + 2 * W }, raisedAt + 3 * W],
    [{ raisedAt, activeAt: raisedAt + W, changeHeardAt: raisedAt + 2 * W }, raisedAt + 2 * W + W / 2],
    [{ reason: 'expired', raisedAt }, raisedAt + 9 * W],
    [null, raisedAt],
  ];
  for (const [reauth, now] of cases) {
    const label = JSON.stringify([reauth, now]);
    assert.equal(web.resetWindowOpen(reauth, now), mobile.resetWindowOpen(reauth, now), label);
    assert.equal(web.keepReauthInPlace(reauth, now), mobile.keepReauthInPlace(reauth, now), label);
  }
});
