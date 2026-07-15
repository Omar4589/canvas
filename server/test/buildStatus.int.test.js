import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';

// The public build-currency endpoint over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/build_test node --test test/buildStatus.int.test.js
// The route itself touches neither the DB nor auth — it compares query strings against env
// vars — but the suite still carries the standard MONGODB_URI_TEST guard: createApp() eagerly
// builds the bull-board queues (live ioredis handles), so it may only run under the int
// harness, whose --test-force-exit reaps them. That invariant is what keeps plain `npm test`
// Redis-free; this file must not be the one to break it.
// The product promise under test: the nag flips via env alone (Heroku config:set, no deploy),
// it is per-platform, and every malformed/unconfigured case FAILS OPEN to "ok" — a wrong
// "outdated" would false-alarm the whole fleet.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-build-status';

const { createApp } = await import('../src/app.js');
const { closeQueues } = await import('../src/queues/index.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs the int harness)';

const ANDROID_RV = 'a48879ce7fb3dede115e8872c1c2caa5d190a4a0';
const IOS_RV = '91ab883302cea4c355e4b3a77865098b95aa48d5';
const OLD_RV = 'dfeb86fe6977144dc9b69643e8d2e1f8459e94ba';

const ENV_KEYS = [
  'MOBILE_CURRENT_RUNTIME_ANDROID',
  'MOBILE_CURRENT_RUNTIME_IOS',
  'MOBILE_UPDATE_MODE',
  'MOBILE_UPDATE_NOTE',
  'MOBILE_STORE_URL_ANDROID',
  'MOBILE_STORE_URL_IOS',
];

let server;
let base;

before(async () => {
  if (!URI) return;
  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  // Drain the bull-board queue handles when Redis is reachable; bounded because quit() never
  // resolves against a Redis that was never there (the harness force-exit is the backstop).
  await Promise.race([closeQueues(), new Promise((r) => setTimeout(r, 2000))]);
});

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

async function check(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${base}/api/build-status?${qs}`);
  assert.equal(res.status, 200);
  return res.json();
}

test('unconfigured platform reads ok (feature off by default)', { skip }, async () => {
  const body = await check({ platform: 'android', runtimeVersion: OLD_RV });
  assert.deepEqual(body, { status: 'ok' });
});

test('matching runtimeVersion reads ok', { skip }, async () => {
  process.env.MOBILE_CURRENT_RUNTIME_ANDROID = ANDROID_RV;
  const body = await check({ platform: 'android', runtimeVersion: ANDROID_RV });
  assert.deepEqual(body, { status: 'ok' });
});

test('superseded runtimeVersion reads outdated, soft by default, no note/storeUrl', { skip }, async () => {
  process.env.MOBILE_CURRENT_RUNTIME_ANDROID = ANDROID_RV;
  const body = await check({ platform: 'android', runtimeVersion: OLD_RV });
  assert.deepEqual(body, { status: 'outdated', mode: 'soft', note: null, storeUrl: null });
});

test('hard mode and note come from env; mode tolerates case and whitespace', { skip }, async () => {
  process.env.MOBILE_CURRENT_RUNTIME_ANDROID = ANDROID_RV;
  process.env.MOBILE_UPDATE_MODE = ' Hard ';
  process.env.MOBILE_UPDATE_NOTE = 'Old versions stop working Friday.';
  const body = await check({ platform: 'android', runtimeVersion: OLD_RV });
  assert.deepEqual(body, {
    status: 'outdated',
    mode: 'hard',
    note: 'Old versions stop working Friday.',
    storeUrl: null,
  });

  // Any unrecognized mode string degrades to the safe one.
  process.env.MOBILE_UPDATE_MODE = 'blocking';
  const soft = await check({ platform: 'android', runtimeVersion: OLD_RV });
  assert.equal(soft.mode, 'soft');
});

test('storeUrl override is per-platform (TestFlight era: iOS only)', { skip }, async () => {
  process.env.MOBILE_CURRENT_RUNTIME_ANDROID = ANDROID_RV;
  process.env.MOBILE_CURRENT_RUNTIME_IOS = IOS_RV;
  process.env.MOBILE_STORE_URL_IOS = 'https://beta.itunes.apple.com/v1/app/6764581850';

  const ios = await check({ platform: 'ios', runtimeVersion: OLD_RV });
  assert.equal(ios.storeUrl, 'https://beta.itunes.apple.com/v1/app/6764581850');

  // Android keeps its built-in URL — the override must not bleed across platforms.
  const android = await check({ platform: 'android', runtimeVersion: OLD_RV });
  assert.equal(android.storeUrl, null);
});

test('comma-separated list: every listed build is current (staged rollout)', { skip }, async () => {
  process.env.MOBILE_CURRENT_RUNTIME_ANDROID = `${ANDROID_RV}, ${OLD_RV}`;
  for (const rv of [ANDROID_RV, OLD_RV]) {
    const body = await check({ platform: 'android', runtimeVersion: rv });
    assert.deepEqual(body, { status: 'ok' }, `expected ok for ${rv}`);
  }
});

test('platforms are independent: an old iOS build is not judged by the android var', { skip }, async () => {
  process.env.MOBILE_CURRENT_RUNTIME_ANDROID = ANDROID_RV;
  const iosUnconfigured = await check({ platform: 'ios', runtimeVersion: OLD_RV });
  assert.deepEqual(iosUnconfigured, { status: 'ok' });

  process.env.MOBILE_CURRENT_RUNTIME_IOS = IOS_RV;
  const iosOutdated = await check({ platform: 'ios', runtimeVersion: OLD_RV });
  assert.equal(iosOutdated.status, 'outdated');
});

test('malformed requests fail open to ok', { skip }, async () => {
  process.env.MOBILE_CURRENT_RUNTIME_ANDROID = ANDROID_RV;
  process.env.MOBILE_UPDATE_MODE = 'hard';
  for (const params of [
    {},
    { platform: 'android' },
    { runtimeVersion: OLD_RV },
    { platform: 'windows', runtimeVersion: OLD_RV },
  ]) {
    const body = await check(params);
    assert.deepEqual(body, { status: 'ok' }, `expected ok for ${JSON.stringify(params)}`);
  }
});

test('env flips take effect with no restart (read per-request)', { skip }, async () => {
  const before_ = await check({ platform: 'android', runtimeVersion: OLD_RV });
  assert.equal(before_.status, 'ok');

  process.env.MOBILE_CURRENT_RUNTIME_ANDROID = ANDROID_RV;
  const after_ = await check({ platform: 'android', runtimeVersion: OLD_RV });
  assert.equal(after_.status, 'outdated');
});
