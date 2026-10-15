import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRestart, SETTLE_BOUND_MS } from './restartPolicy.js';

// A fake clock: sleep() advances it, so the five-second bound runs instantly.
const harness = (overrides = {}) => {
  let t = 0;
  const calls = { reload: 0, before: 0 };
  let chain = Promise.resolve();
  const deps = {
    hasInFlightActions: () => false,
    sessionSettled: () => chain,
    getSessionState: () => ({ reauth: null, ending: false }),
    inDoorFlow: (path) => /^\/(household|voter|survey-practice)\//.test(path || ''),
    reloadAsync: async () => {
      calls.reload += 1;
    },
    now: () => t,
    // Advances the fake clock but still yields to other work, as a real timer would.
    sleep: (ms) =>
      new Promise((resolve) =>
        setImmediate(() => {
          t += ms;
          resolve();
        })
      ),
    ...overrides,
  };
  const restart = createRestart(deps);
  return { restart, calls, setChain: (p) => (chain = p), advance: (ms) => (t += ms), time: () => t };
};

test('reloads when nothing is in the way', async () => {
  const { restart, calls } = harness();
  assert.equal(await restart({ getPath: () => '/map' }), 'reloading');
  assert.equal(calls.reload, 1);
});

test('waits for a save, then reloads; refuses if it is still in flight after five seconds', async () => {
  // The save settles after a few 250 ms polls.
  let polls = 0;
  const settles = harness({
    hasInFlightActions: () => {
      polls += 1;
      return polls < 4;
    },
  });
  assert.equal(await settles.restart({}), 'reloading');
  const stuck = harness({ hasInFlightActions: () => true });
  assert.equal(await stuck.restart({}), 'saving');
  assert.equal(stuck.calls.reload, 0);
  assert.ok(stuck.time() >= SETTLE_BOUND_MS);
});

test('waits for the session store, and again for work queued during the wait', async () => {
  let release1;
  let release2;
  const first = new Promise((r) => (release1 = r));
  const second = new Promise((r) => (release2 = r));
  const h = harness();
  h.setChain(first);
  const pending = h.restart({});
  // first chain settles, but new work was queued meanwhile
  h.setChain(second);
  release1();
  await new Promise((r) => setImmediate(r));
  release2();
  assert.equal(await pending, 'reloading');
});

test('a session store that never settles inside the bound → saving', async () => {
  const h = harness();
  h.setChain(new Promise(() => {}));
  assert.equal(await h.restart({}), 'saving');
  assert.equal(h.calls.reload, 0);
});

test('a sign-out in progress → saving', async () => {
  const h = harness({ getSessionState: () => ({ reauth: null, ending: true }) });
  assert.equal(await h.restart({}), 'saving');
});

test('on a door or in a survey → door, read after the wait', async () => {
  const h = harness();
  assert.equal(await h.restart({ getPath: () => '/household/abc' }), 'door');
  assert.equal(await h.restart({ getPath: () => '/voter/1/survey' }), 'door');
  assert.equal(await h.restart({ getPath: () => '/survey-practice/s1' }), 'door');
  assert.equal(h.calls.reload, 0);
});

test('the password screen pending → password; a crash screen skips that refusal', async () => {
  const pendingReauth = { getSessionState: () => ({ reauth: { reason: 'expired' }, ending: false }) };
  const h = harness(pendingReauth);
  assert.equal(await h.restart({ getPath: () => '/map' }), 'password');
  assert.equal(h.calls.reload, 0);
  const crash = harness(pendingReauth);
  assert.equal(await crash.restart({ fromCrashScreen: true }), 'reloading');
});

test('beforeReload runs first; a rejecting beforeReload still reloads', async () => {
  const order = [];
  const h = harness({
    reloadAsync: async () => {
      order.push('reload');
    },
  });
  await h.restart({
    fromCrashScreen: true,
    beforeReload: async () => {
      order.push('before');
    },
  });
  assert.deepEqual(order, ['before', 'reload']);
  const h2 = harness();
  assert.equal(
    await h2.restart({
      fromCrashScreen: true,
      beforeReload: async () => {
        throw new Error('sign-out failed');
      },
    }),
    'reloading'
  );
});

test('a failed reload → failed', async () => {
  const h = harness({
    reloadAsync: async () => {
      throw new Error('not supported');
    },
  });
  assert.equal(await h.restart({}), 'failed');
});

test('a save that starts while waiting for the session store is waited for, never reloaded over', async () => {
  // The session store is busy; a door is recorded from the map meanwhile and settles a little later.
  let saving = false;
  let release;
  const h = harness({ hasInFlightActions: () => saving });
  h.setChain(new Promise((r) => (release = r)));
  const pending = h.restart({ getPath: () => '/map' });
  await new Promise((r) => setImmediate(r));
  saving = true; // optimisticSubmit took the lock
  release(); // the session store goes idle while the save is still in flight
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(h.calls.reload, 0, 'never reloads over the in-flight save');
  saving = false; // the save settles
  assert.equal(await pending, 'reloading');
  assert.equal(h.calls.reload, 1);
});

test('a save still in flight at the bound after the session wait → saving', async () => {
  let saving = false;
  let release;
  const h = harness({ hasInFlightActions: () => saving });
  h.setChain(new Promise((r) => (release = r)));
  const pending = h.restart({});
  await new Promise((r) => setImmediate(r));
  saving = true;
  release();
  assert.equal(await pending, 'saving');
  assert.equal(h.calls.reload, 0);
});

test('a save in flight after beforeReload → saving, checked right before the reload', async () => {
  let saving = false;
  const h = harness({ hasInFlightActions: () => saving });
  const outcome = await h.restart({
    fromCrashScreen: true,
    beforeReload: async () => {
      saving = true;
    },
  });
  assert.equal(outcome, 'saving');
  assert.equal(h.calls.reload, 0);
});

test('session work that keeps getting replaced ends at the bound instead of spinning', async () => {
  // A store whose chain is a fresh, already-settled promise on every read: each pass finds new work.
  const h = harness({ sessionSettled: () => Promise.resolve() });
  assert.equal(await h.restart({}), 'saving');
  assert.equal(h.calls.reload, 0);
  assert.ok(h.time() >= SETTLE_BOUND_MS);
});

test('the cover is raised right before the reload, and lowered only if it fails', async () => {
  const events = [];
  const ok = harness({
    reloadAsync: async () => {
      events.push('reload');
    },
    onReloadStart: () => events.push('start'),
    onReloadFailed: () => events.push('failed'),
  });
  assert.equal(await ok.restart({}), 'reloading');
  assert.deepEqual(events, ['start', 'reload']);

  events.length = 0;
  const failing = harness({
    reloadAsync: async () => {
      events.push('reload');
      throw new Error('no');
    },
    onReloadStart: () => events.push('start'),
    onReloadFailed: () => events.push('failed'),
  });
  assert.equal(await failing.restart({}), 'failed');
  assert.deepEqual(events, ['start', 'reload', 'failed']);

  // A refusal never raises it.
  events.length = 0;
  const refused = harness({
    hasInFlightActions: () => true,
    onReloadStart: () => events.push('start'),
  });
  assert.equal(await refused.restart({}), 'saving');
  assert.deepEqual(events, []);
});

test('a restart while another reload is already waiting joins it instead of queueing a second', async () => {
  let pending = false;
  const h = harness({
    reloadAlreadyPending: () => pending,
    onReloadStart: () => {
      pending = true;
    },
    reloadAsync: () => new Promise(() => {}), // waits in the update queue
  });
  h.restart({}); // the first one raises the cover and waits
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(pending, true);
  assert.equal(await h.restart({}), 'reloading');
});

test('joining a waiting reload never runs beforeReload (a sign-out must not start under it)', async () => {
  let ran = false;
  const h = harness({ reloadAlreadyPending: () => true });
  const outcome = await h.restart({
    fromCrashScreen: true,
    beforeReload: async () => {
      ran = true;
    },
  });
  assert.equal(outcome, 'reloading');
  assert.equal(ran, false);
  assert.equal(h.calls.reload, 0);
});
