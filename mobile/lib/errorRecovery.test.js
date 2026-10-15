import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BURST_COUNT,
  BURST_WINDOW_MS,
  MESSAGE_CAP,
  normalizeError,
  decide,
  shouldTakeOver,
  createErrorStore,
  createGlobalHandler,
  installGlobalErrorHandler,
  _resetForTests,
} from './errorRecovery.js';

// Values a thrown "error" can be in practice, including the hostile ones that once made React Native's
// own reporting throw (docs/PROPOSAL_ERROR_RECOVERY.md §B1).
const throwingProxy = new Proxy(
  {},
  {
    get() {
      throw new Error('trap');
    },
    has() {
      throw new Error('trap');
    },
    ownKeys() {
      throw new Error('trap');
    },
    getPrototypeOf() {
      throw new Error('trap');
    },
  }
);
const cyclic = {};
cyclic.self = cyclic;
const hostile = [
  ['an Error', new TypeError('boom')],
  ['undefined', undefined],
  ['null', null],
  ['a string', 'text'],
  ['a number', 42],
  ['a Symbol', Symbol('s')],
  ['Object.create(null)', Object.create(null)],
  ['a plain object', { code: 7 }],
  ['a cyclic object', cyclic],
  ['a numeric message', { message: 12 }],
  ['a throwing message getter', Object.defineProperty({}, 'message', { get() { throw new Error('x'); } })],
  ['a throwing toString', { message: { toString() { throw new Error('x'); } } }],
  ['a Proxy that throws on every read', throwingProxy],
  ['a 2 MB message', new Error('m'.repeat(2_000_000))],
];

test('normalizeError: every value becomes an Error with string fields, and it never throws', () => {
  for (const [label, value] of hostile) {
    const e = normalizeError(value);
    assert.ok(e instanceof Error, label);
    assert.equal(typeof e.name, 'string', label);
    assert.equal(typeof e.message, 'string', label);
    assert.equal(typeof e.stack, 'string', label);
    assert.ok(e.message.length > 0, label);
    assert.ok(e.message.length <= MESSAGE_CAP + 1, label);
    assert.ok(!e.message.includes('[object Object]'), label);
  }
});

test('normalizeError: keeps a real error, describes what is not one', () => {
  const real = normalizeError(new TypeError('boom'));
  assert.equal(real.name, 'TypeError');
  assert.equal(real.message, 'boom');
  assert.match(real.stack, /boom/);
  assert.equal(normalizeError('text').message, 'text');
  assert.equal(normalizeError(42).message, '42');
  assert.equal(normalizeError(undefined).message, 'Unknown error (undefined)');
  assert.equal(normalizeError(null).message, 'Unknown error (null)');
  assert.equal(normalizeError({ code: 7 }).message, 'Unknown error (object)');
  assert.equal(normalizeError(cyclic).message, 'Unknown error (object)');
  assert.equal(normalizeError({ message: 12 }).message, '12');
  assert.equal(normalizeError(throwingProxy).message, 'Unknown error (object)');
});

const base = { isFatal: true, isDev: false, enabled: true, hasHost: true, message: 'x', recent: [], now: 10_000 };

test('decide: forwards development, non-fatal, no host, the switch off, and native-wrapped errors', () => {
  assert.equal(decide({ ...base, isDev: true }), 'forward');
  assert.equal(decide({ ...base, isFatal: false }), 'forward');
  assert.equal(decide({ ...base, hasHost: false }), 'forward');
  assert.equal(decide({ ...base, enabled: false }), 'forward');
  assert.equal(decide({ ...base, message: 'Non-js exception: Hits microtasks retries bound.' }), 'forward');
  assert.equal(decide(base), 'notice');
});

test('decide: the burst boundary is five inside three seconds', () => {
  const now = 10_000;
  const four = [now - 2_900, now - 2_000, now - 1_000, now - 10];
  assert.equal(decide({ ...base, recent: four.slice(0, BURST_COUNT - 2), now }), 'notice');
  assert.equal(decide({ ...base, recent: four, now }), 'escalate');
  // Five spread over more than three seconds: the oldest has left the window.
  const spread = [now - BURST_WINDOW_MS - 1, now - 2_000, now - 1_000, now - 10];
  assert.equal(decide({ ...base, recent: spread, now }), 'notice');
});

test('shouldTakeOver: only an escalate decided off a door', () => {
  assert.equal(shouldTakeOver({ decision: 'escalate', inDoorFlow: false }), true);
  assert.equal(shouldTakeOver({ decision: 'escalate', inDoorFlow: true }), false);
  assert.equal(shouldTakeOver({ decision: 'notice', inDoorFlow: false }), false);
  assert.equal(shouldTakeOver({ decision: 'forward', inDoorFlow: false }), false);
});

const report = (store, decision, at) => store.report(normalizeError(new Error(`e${at}`)), { decision, at, wallAt: 1 });

test('store: a stable snapshot, replaced only when something changed', () => {
  const store = createErrorStore();
  const first = store.getState();
  assert.equal(store.getState(), first);
  let emits = 0;
  store.subscribe(() => {
    emits += 1;
  });
  store.dismiss(); // nothing to dismiss
  store.clear();
  assert.equal(emits, 0);
  assert.equal(store.getState(), first);
  report(store, 'notice', 100);
  const afterReport = store.getState();
  assert.notEqual(afterReport, first);
  assert.equal(afterReport.count, 1);
  assert.equal(typeof afterReport.last.message, 'string');
  store.dismiss();
  assert.notEqual(store.getState(), afterReport);
  assert.equal(store.getState().last, null);
  assert.equal(store.getState().count, 0);
  report(store, 'notice', 200);
  const beforeClear = store.getState();
  store.clear();
  assert.notEqual(store.getState(), beforeClear);
  assert.equal(emits, 4);
});

test('store: recent stays pruned to the burst window', () => {
  const store = createErrorStore();
  for (let i = 0; i < 50; i += 1) report(store, 'notice', i * 1_000);
  const recent = store.recentTimes();
  assert.ok(recent.every((t) => 49_000 - t < BURST_WINDOW_MS));
  assert.ok(recent.length <= 3);
});

test('store: takeover only from an escalate decided off a door — never from a burst that ended on one', () => {
  const store = createErrorStore();
  store.setInDoorFlow(true);
  report(store, 'escalate', 100);
  assert.equal(store.getState().takeover, false);
  store.setInDoorFlow(false); // left the door; the burst has stopped
  assert.equal(store.getState().takeover, false);
  report(store, 'escalate', 200); // the loop is still running
  assert.equal(store.getState().takeover, true);
});

test('store: takeover is not sticky — a later lone error, on a door or off it, never takes over', () => {
  const store = createErrorStore();
  report(store, 'escalate', 100); // a loop off the doors (the crash screen acts on this emit)
  assert.equal(store.getState().takeover, true);
  store.setInDoorFlow(true);
  report(store, 'notice', 60_000); // minutes later, one error on a door
  assert.equal(store.getState().takeover, false);
  store.setInDoorFlow(false);
  report(store, 'notice', 120_000); // and one off it
  assert.equal(store.getState().takeover, false);
});

test('store: hosts survive clear(); a release is idempotent', () => {
  const store = createErrorStore();
  const release = store.addHost();
  store.addHost();
  store.clear();
  assert.equal(store.hasHost(), true);
  release();
  release();
  assert.equal(store.hasHost(), true); // the second host is still there
});

test('store: the switch — on by default; a remembered answer applies only until the server answers', () => {
  const store = createErrorStore();
  assert.equal(store.isEnabled(), true);
  store.hydrateEnabled(false); // last launch said off; the server hasn't answered yet
  assert.equal(store.isEnabled(), false);
  store.setEnabled(true); // the server's answer this launch
  assert.equal(store.isEnabled(), true);
  store.hydrateEnabled(false); // a slow storage read lands late: ignored
  assert.equal(store.isEnabled(), true);
  store.setEnabled(false);
  assert.equal(store.isEnabled(), false);
  store.clear(); // a sign-out never touches the switch
  assert.equal(store.isEnabled(), false);
  // Only an explicit false turns it off.
  const loose = createErrorStore();
  loose.setEnabled(undefined);
  assert.equal(loose.isEnabled(), true);
});

const makeHandler = ({ isDev = false, hasHost = true, enabled = true, previous } = {}) => {
  const store = createErrorStore();
  if (hasHost) store.addHost();
  store.setEnabled(enabled);
  const calls = [];
  const prev = previous || ((e, fatal) => calls.push({ e, fatal }));
  let t = 0;
  const handler = createGlobalHandler({ previous: prev, store, isDev, now: () => (t += 10) });
  return { handler, store, calls };
};

test('handler: an intercepted error goes to the log once as non-fatal, never fatal, and to the store', () => {
  const { handler, store, calls } = makeHandler();
  handler(new Error('tap'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fatal, false);
  assert.equal(store.getState().count, 1);
  assert.equal(store.getState().last.message, 'tap');
});

test('handler: a forwarded fatal passes through as fatal; development and no host forward', () => {
  for (const opts of [{ isDev: true }, { hasHost: false }, { enabled: false }]) {
    const { handler, store, calls } = makeHandler(opts);
    handler(new Error('x'), true);
    assert.deepEqual(calls.map((c) => c.fatal), [true]);
    assert.equal(store.getState().count, 0);
  }
  const { handler, calls } = makeHandler();
  handler(new Error('Non-js exception: native'), true);
  assert.deepEqual(calls.map((c) => c.fatal), [true]);
});

test('handler: a forwarded fatal is unwrapped — if React Native\'s report throws, so does this', () => {
  const { handler } = makeHandler({
    hasHost: false,
    previous: () => {
      throw new Error('report failed');
    },
  });
  assert.throws(() => handler(new Error('x'), true), /report failed/);
});

test('handler: never throws on the intercept path, for any value, even when the log line throws', () => {
  const { handler, store } = makeHandler({
    previous: () => {
      throw new Error('log failed');
    },
  });
  for (const [label, value] of hostile) {
    assert.doesNotThrow(() => handler(value, true), label);
  }
  assert.ok(store.getState().count > 0);
});

test('handler: a forwarded non-fatal is guarded (a noexcept caller must never see a throw)', () => {
  const { handler } = makeHandler({
    previous: () => {
      throw new Error('log failed');
    },
  });
  assert.doesNotThrow(() => handler(new Error('listener'), false));
});

test('handler: a throwing store falls back to the fatal path without throwing', () => {
  const calls = [];
  const store = createErrorStore();
  store.addHost();
  store.report = () => {
    throw new Error('store broke');
  };
  const handler = createGlobalHandler({
    previous: (e, fatal) => calls.push(fatal),
    store,
    isDev: false,
    now: () => 1,
  });
  assert.doesNotThrow(() => handler(new Error('x'), true));
  assert.deepEqual(calls, [false, true]);
});

test('install: wraps the existing global handler, once', () => {
  _resetForTests();
  const seen = [];
  let installed = (e, fatal) => seen.push(['original', fatal]);
  const ErrorUtils = {
    getGlobalHandler: () => installed,
    setGlobalHandler: (fn) => {
      installed = fn;
    },
  };
  installGlobalErrorHandler({ ErrorUtils, isDev: false });
  const wrapped = installed;
  installGlobalErrorHandler({ ErrorUtils, isDev: false });
  assert.equal(installed, wrapped);
  // No host is mounted on the shared store in this process, so a fatal is forwarded unchanged.
  wrapped(new Error('x'), true);
  assert.deepEqual(seen, [['original', true]]);
  _resetForTests();
});
