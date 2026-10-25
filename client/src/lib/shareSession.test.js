import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// The client pages' session for one share link (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F6, §H1):
// "Keep me signed in on this device", "Sign out on this device", and the ONE error handler every
// share call goes through — driven against a stubbed fetch and in-memory storage.

const memStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    keys: () => [...m.keys()],
  };
};
globalThis.localStorage = memStorage();
globalThis.sessionStorage = memStorage();

let calls = [];
let answer = () => ({ status: 200, body: {} });
globalThis.fetch = (url, init = {}) => {
  calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
  if (init.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  const { status, body } = answer(url, init);
  return Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body == null ? '' : JSON.stringify(body)) });
};

const { createShareSession } = await import('./shareSession.js');
const { getShareAccess, markOpenedToday, wasOpenedToday } = await import('./shareAccess.js');
const { SHARE_COPY, classifyShareError, shareRetry } = await import('./shareErrors.js');

const TOKEN = 'tok3nTOK3Ntok3nTOK3Ntok3n12';
const KEY = `doorline.share.${TOKEN}`;
const failure = (status, code, error = 'nope') => Object.assign(new Error(error), { status, code, data: { error, code } });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  calls = [];
  answer = () => ({ status: 200, body: { accessToken: 'jwt-1' } });
});

test('keep me signed in: a remembered token lives in localStorage, a plain one in this tab only', async () => {
  const s = createShareSession(TOKEN);
  assert.equal(await s.unlock({ password: 'correct horse battery', remember: true }), true);
  assert.deepEqual(calls[0].body, { password: 'correct horse battery', remember: true });
  assert.match(calls[0].url, new RegExp(`/api/share/${TOKEN}/unlock$`));
  assert.equal(localStorage.getItem(KEY), 'jwt-1');
  assert.equal(sessionStorage.getItem(KEY), null);
  assert.equal(s.getSnapshot().remembered, true);
  assert.equal(createShareSession(TOKEN).getSnapshot().accessToken, 'jwt-1', 'a new tab picks the remembered token up');

  answer = () => ({ status: 200, body: { accessToken: 'jwt-2' } });
  await s.unlock({ password: 'correct horse battery', remember: false });
  assert.equal(sessionStorage.getItem(KEY), 'jwt-2');
  assert.equal(localStorage.getItem(KEY), null, 'one copy only: signing in this way replaces the remembered one');
  assert.equal(s.getSnapshot().remembered, false);
});

test('sign out on this device clears both copies and brings back the gate', async () => {
  const s = createShareSession(TOKEN);
  await s.unlock({ password: 'pw', remember: true });
  sessionStorage.setItem(KEY, 'stray');
  const before = s.getSnapshot().ends;
  let heard = 0;
  const off = s.subscribe(() => {
    heard += 1;
  });
  s.signOut();
  off();
  assert.equal(localStorage.getItem(KEY), null);
  assert.equal(sessionStorage.getItem(KEY), null);
  assert.equal(getShareAccess(TOKEN), null);
  const snap = s.getSnapshot();
  assert.equal(snap.accessToken, null);
  assert.equal(snap.gate, 'signed-out');
  assert.equal(snap.ends, before + 1, 'the page is told to forget what it read');
  assert.ok(heard >= 1);
});

test('the one error handler: a 401 drops the token and asks for the password again', async () => {
  const s = createShareSession(TOKEN);
  await s.unlock({ password: 'pw', remember: true });
  const c = s.handleError(failure(401, 'password-required'), 'jwt-1');
  assert.equal(c.kind, 'password');
  assert.equal(s.getSnapshot().accessToken, null);
  assert.equal(s.getSnapshot().gate, 'changed');
  assert.equal(localStorage.getItem(KEY), null, 'the remembered token is dropped');
});

test('a 401 from a call that left with an older token leaves the new session alone', async () => {
  const s = createShareSession(TOKEN);
  await s.unlock({ password: 'pw' });
  const c = s.handleError(failure(401, 'password-required'), 'jwt-old');
  assert.equal(c.stale, true);
  assert.equal(s.getSnapshot().accessToken, 'jwt-1');
  assert.equal(s.getSnapshot().gate, null);
});

test('a dead or expired link drops the token and says so; a report, map or network problem keeps the session', async () => {
  for (const [err, kind] of [
    [failure(404, 'SHARE_NOT_FOUND'), 'link-gone'],
    [failure(410, 'SHARE_EXPIRED', 'This report link has expired. Ask your campaign contact for a new one.'), 'expired'],
    [failure(410, undefined, 'This report is no longer available.'), 'expired'],
  ]) {
    localStorage.clear();
    const s = createShareSession(TOKEN);
    await s.unlock({ password: 'pw', remember: true });
    s.handleError(err);
    const snap = s.getSnapshot();
    assert.equal(snap.fatal.kind, kind);
    assert.equal(snap.accessToken, null);
    assert.equal(localStorage.getItem(KEY), null);
    if (kind === 'expired') assert.equal(snap.fatal.message, err.data.error, "the server's own words");
  }
  for (const [err, kind] of [
    [failure(404, 'REPORT_NOT_FOUND'), 'report-gone'],
    [failure(400, 'INVALID_ID'), 'report-gone'],
    [failure(404, 'MAP_NOT_SHARED'), 'map-off'],
    [failure(409, 'MAP_UPDATED'), 'map-updated'],
    [failure(500, null), 'retry'],
    [new TypeError('Failed to fetch'), 'retry'],
  ]) {
    const s = createShareSession(TOKEN);
    await s.unlock({ password: 'pw', remember: true });
    assert.equal(s.handleError(err).kind, kind);
    assert.equal(s.getSnapshot().accessToken, 'jwt-1', `${kind} keeps the session`);
    assert.equal(s.getSnapshot().fatal, null);
    assert.equal(localStorage.getItem(KEY), 'jwt-1');
  }
});

test('every share read carries the token and goes through the handler; an abort is nobody\'s error', async () => {
  const s = createShareSession(TOKEN);
  await s.unlock({ password: 'pw' });
  answer = () => ({ status: 200, body: { reports: [] } });
  await s.get('/reports');
  const read = calls[calls.length - 1];
  assert.equal(read.url, `/api/share/${TOKEN}/reports`);
  assert.equal(read.init.headers['X-Share-Token'], 'jwt-1');
  assert.equal(read.init.headers.Authorization, undefined, 'never the console session');

  answer = () => ({ status: 401, body: { error: 'Password required', code: 'password-required' } });
  await assert.rejects(s.get('/reports'));
  assert.equal(s.getSnapshot().gate, 'changed');

  answer = () => ({ status: 200, body: { accessToken: 'jwt-1' } });
  const s2 = createShareSession(TOKEN);
  await s2.unlock({ password: 'pw' });
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(s2.get('/reports', { signal: ctrl.signal }), { name: 'AbortError' });
  assert.equal(s2.getSnapshot().accessToken, 'jwt-1');
});

test('the gate says what went wrong with an unlock — by code for a 429', async () => {
  const s = createShareSession(TOKEN);
  for (const [status, body, text] of [
    [401, { error: 'Incorrect password' }, SHARE_COPY.wrongPassword],
    [429, { error: 'Locked', code: 'SHARE_LOCKED' }, SHARE_COPY.locked],
    [429, { error: 'Too many attempts. Try again in a few minutes.', code: 'rate-limited' }, SHARE_COPY.rateLimited],
    [400, { error: 'Password required' }, SHARE_COPY.noPassword],
    [503, null, SHARE_COPY.unreachable],
  ]) {
    answer = () => ({ status, body });
    assert.equal(await s.unlock({ password: 'guess' }), false);
    const snap = s.getSnapshot();
    assert.equal(snap.unlockError, text);
    assert.equal(snap.unlocking, false);
    assert.equal(snap.fatal, null);
    assert.equal(snap.accessToken, null);
  }
  assert.equal(SHARE_COPY.locked, 'This link is locked after too many wrong passwords. Try again later, or ask the person who sent it.');
  assert.equal(SHARE_COPY.rateLimited, 'Too many tries from this connection — wait 15 minutes.');

  answer = () => ({ status: 404, body: { error: 'This report link is not available.', code: 'SHARE_NOT_FOUND' } });
  await s.unlock({ password: 'guess' });
  assert.equal(s.getSnapshot().fatal.kind, 'link-gone', 'a dead link at the gate is a dead link');
});

test('an open legacy link unlocks without a password; a tab follows another tab\'s remembered sign-in and sign-out', async () => {
  const s = createShareSession(TOKEN);
  await s.unlock({});
  assert.deepEqual(calls[0].body, { remember: false });

  const a = createShareSession(TOKEN);
  await a.unlock({ password: 'pw', remember: true });
  const b = createShareSession(TOKEN);
  assert.equal(b.getSnapshot().accessToken, 'jwt-1');
  // Tab A signs out: tab B, holding the same remembered token, follows.
  a.signOut();
  b.syncFromStorage();
  assert.equal(b.getSnapshot().accessToken, null);
  assert.equal(b.getSnapshot().gate, 'signed-out');
  // Tab A signs in again, remembered: tab B, at the gate, is let in.
  answer = () => ({ status: 200, body: { accessToken: 'jwt-9' } });
  await a.unlock({ password: 'pw', remember: true });
  b.syncFromStorage();
  assert.equal(b.getSnapshot().accessToken, 'jwt-9');
  assert.equal(b.getSnapshot().gate, null);
});

test('opened: once per report per browser per day, kept in one key per link', () => {
  const day1 = new Date(2026, 9, 24, 9, 0);
  const day1late = new Date(2026, 9, 24, 23, 59);
  const day2 = new Date(2026, 9, 25, 0, 1);
  assert.equal(wasOpenedToday(TOKEN, 'r1', day1), false);
  markOpenedToday(TOKEN, 'r1', day1);
  markOpenedToday(TOKEN, 'r2', day1);
  assert.equal(wasOpenedToday(TOKEN, 'r1', day1late), true);
  assert.equal(wasOpenedToday(TOKEN, 'r3', day1late), false);
  assert.equal(wasOpenedToday(TOKEN, 'r1', day2), false, 'a new day counts again');
  markOpenedToday(TOKEN, 'r1', day2);
  assert.deepEqual(JSON.parse(localStorage.getItem(`doorline.share.opened.${TOKEN}`)), { day: '2026-10-25', reports: ['r1'] }, 'yesterday is gone');
});

test('share reads retry a network or server error once, never an answer', () => {
  assert.equal(shareRetry(0, new TypeError('Failed to fetch')), true);
  assert.equal(shareRetry(0, failure(502)), true);
  assert.equal(shareRetry(1, failure(502)), false);
  for (const status of [400, 401, 404, 409, 410, 429]) assert.equal(shareRetry(0, failure(status)), false);
  assert.equal(classifyShareError(Object.assign(new Error('x'), { name: 'AbortError' })).kind, 'aborted');
});
