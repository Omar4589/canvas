import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// api()'s `identifyIfSignedIn` (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F7): a PUBLIC call that
// names whoever is signed in to Doorline on this browser — the share page's "opened" ping, so the
// org's own people count apart from the link — and nothing more. It must never set off the
// session-ended handling (sentToken stays null, the call is quiet) and never send an org header.

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
};
globalThis.localStorage = memStorage();
const events = [];
globalThis.window = {
  location: { pathname: '/r/tok3n/reports/abc', assign() {} },
  dispatchEvent: (e) => {
    events.push(e.type);
    return true;
  },
};

let seen = [];
let reply = { status: 204, body: null };
globalThis.fetch = (url, init = {}) => {
  seen.push({ url, headers: init.headers || {} });
  return Promise.resolve({
    ok: reply.status >= 200 && reply.status < 300,
    status: reply.status,
    text: () => Promise.resolve(reply.body == null ? '' : JSON.stringify(reply.body)),
  });
};

const { api, TOKEN_KEY } = await import('../api/client.js');

const PING = '/share/tok3n/reports/abc/opened';
const ping = (extra = {}) => api(PING, { method: 'POST', public: true, shareToken: 'share-jwt', identifyIfSignedIn: true, ...extra });

beforeEach(() => {
  localStorage.clear();
  seen = [];
  events.length = 0;
  reply = { status: 204, body: null };
});

test('signed in on this browser: the ping names the session, with the share token and no org header', async () => {
  localStorage.setItem(TOKEN_KEY, 'console-jwt');
  localStorage.setItem('canvass.activeOrgId', 'org-1');
  assert.equal(await ping(), null, 'a 204 reads as nothing');
  assert.equal(seen[0].url, `/api${PING}`);
  assert.equal(seen[0].headers.Authorization, 'Bearer console-jwt');
  assert.equal(seen[0].headers['X-Share-Token'], 'share-jwt');
  assert.equal(seen[0].headers['X-Org-Id'], undefined);
});

test('nobody signed in, or storage blocked: no Authorization at all', async () => {
  await ping();
  assert.equal(seen[0].headers.Authorization, undefined);
  const real = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() {
      throw new Error('SecurityError');
    },
  };
  try {
    await ping();
    assert.equal(seen[1].headers.Authorization, undefined);
  } finally {
    globalThis.localStorage = real;
  }
});

test('a plain public call never carries the console session', async () => {
  localStorage.setItem(TOKEN_KEY, 'console-jwt');
  await api('/share/tok3n/reports', { public: true, shareToken: 'share-jwt' });
  assert.equal(seen[0].headers.Authorization, undefined);
});

test('an ended-session answer to the ping never sets off the sign-out handling', async () => {
  localStorage.setItem(TOKEN_KEY, 'console-jwt');
  reply = { status: 401, body: { error: 'Session ended', code: 'SESSION_REVOKED', reason: 'password_changed' } };
  await assert.rejects(ping(), (err) => err.status === 401 && err.code === 'SESSION_REVOKED');
  assert.deepEqual(events, []);
  // The same answer to an ordinary console call does — so the test can see the event when it fires.
  await assert.rejects(api('/admin/whatever'));
  assert.deepEqual(events, ['doorline:session-ended']);
});
