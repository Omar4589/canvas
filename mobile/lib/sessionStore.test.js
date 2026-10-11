import { test } from 'node:test';
import assert from 'node:assert';
import { createSessionStore } from './sessionStore.js';

// The race cases behind the one lock. Storage and caches are fakes whose timing each test
// controls: `gate()` returns a promise plus the function that releases it.
const gate = () => {
  let release;
  const promise = new Promise((r) => {
    release = r;
  });
  return { promise, release };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

const makeStore = ({ stored = 'T0', clearDelay, persistDelay, email = 'walker@t.co', clearThrows } = {}) => {
  const disk = { token: stored, roster: true };
  const calls = { serverSignOut: [], supportCleared: 0 };
  const store = createSessionStore({
    readToken: async () => disk.token,
    persistToken: async (t) => {
      if (persistDelay) await persistDelay();
      disk.token = t;
    },
    clearCaches: async () => {
      if (clearDelay) await clearDelay();
      if (clearThrows) throw new Error('storage unavailable');
      disk.roster = false;
    },
    loadEmail: async () => email,
    notifyServerSignOut: async (t) => {
      calls.serverSignOut.push(t);
    },
    clearSupportPrompt: () => {
      calls.supportCleared += 1;
    },
  });
  return { store, disk, calls };
};

test('hydrate reads storage once and never overwrites a token set meanwhile', async () => {
  const { store } = makeStore({ stored: 'T0' });
  await store.hydrate();
  assert.equal(store.getState().token, 'T0');
  await store.signIn('T1');
  await store.hydrate();
  assert.equal(store.getState().token, 'T1');
});

test('sign out while an extension is in flight: memory and storage both end empty', async () => {
  const slow = gate();
  const { store, disk } = makeStore({ clearDelay: () => slow.promise });
  await store.hydrate();
  const signingOut = store.signOut();
  // The /auth/me answer lands mid-clear.
  const adopting = store.adoptRenewedToken('T0', 'T1');
  slow.release();
  await signingOut;
  assert.equal(await adopting, false);
  assert.equal(store.getState().token, null);
  assert.equal(disk.token, null, 'the old person is not written back');
});

test('two extensions in flight: memory and storage agree', async () => {
  const { store, disk } = makeStore();
  await store.hydrate();
  const a = store.adoptRenewedToken('T0', 'T1');
  const b = store.adoptRenewedToken('T0', 'T2');
  assert.equal(await a, true);
  assert.equal(await b, false, 'the second answer was for a token that is no longer live');
  assert.equal(store.getState().token, 'T1');
  assert.equal(disk.token, 'T1');
});

test('an old-token 401 during a password change waits, then does nothing', async () => {
  const req = gate();
  const { store } = makeStore();
  await store.hydrate();
  const rotating = store.rotateToken(async () => {
    await req.promise;
    return { token: 'T1' };
  });
  const ended = store.endSessionIfCurrent({ reason: 'password_changed', token: 'T0' });
  req.release();
  await rotating;
  assert.equal(await ended, false);
  assert.equal(store.getState().token, 'T1', 'the device that changed the password stays signed in');
});

test('a deliberate end: note with email, caches cleared, token null last, support prompt cleared', async () => {
  const { store, disk, calls } = makeStore();
  await store.hydrate();
  const seen = [];
  store.subscribe(() => seen.push({ ...store.getState() }));
  assert.equal(await store.endSessionIfCurrent({ reason: 'password_changed', token: 'T0' }), true);
  const s = store.getState();
  assert.equal(s.token, null);
  assert.deepEqual(s.notice, { reason: 'password_changed', email: 'walker@t.co' });
  assert.equal(disk.roster, false);
  assert.equal(disk.token, null);
  assert.equal(calls.supportCleared, 1);
  assert.deepEqual(calls.serverSignOut, [], 'the server already ended it');
  const endingFrame = seen.find((f) => f.ending);
  assert.equal(endingFrame.token, 'T0', '"Signing out…" shows while the token is still held');
});

test('no email on the note for a deleted account', async () => {
  const { store } = makeStore();
  await store.hydrate();
  await store.endSessionIfCurrent({ reason: 'deleted', token: 'T0' });
  assert.deepEqual(store.getState().notice, { reason: 'deleted', email: null });
});

test('the reasoned end and a reason-less sign-out: the note survives either order', async () => {
  const { store } = makeStore();
  await store.hydrate();
  const a = store.endSessionIfCurrent({ reason: 'password_changed', token: 'T0' });
  const b = store.signOut(); // e.g. a screen's own sign-out landing second
  await Promise.all([a, b]);
  assert.equal(store.getState().notice.reason, 'password_changed');
});

test('a manual sign-out tells the server and clears any old note', async () => {
  const { store, calls } = makeStore();
  await store.hydrate();
  await store.endSessionIfCurrent({ reason: 'deleted', token: 'T0' });
  await store.signIn('T1');
  assert.equal(store.getState().notice, null, 'signing in clears the note');
  await store.signOut();
  assert.deepEqual(calls.serverSignOut, ['T1']);
  assert.equal(store.getState().notice, null);
});

test('a bare request from the previous session cannot end the next one', async () => {
  const { store } = makeStore();
  await store.hydrate();
  await store.signOut();
  await store.signIn('T2');
  // The stale answer named the session held when it was sent: T0.
  assert.equal(await store.requireReauthIfCurrent({ reason: 'missing', token: 'T0' }), false);
  assert.equal(await store.endSessionIfCurrent({ reason: 'deleted', token: 'T0' }), false);
  assert.equal(store.getState().token, 'T2');
  assert.equal(store.getState().reauth, null);
});

test('reauth in place: the token stays, completeReauth swaps it and clears the screen', async () => {
  const { store, disk } = makeStore();
  await store.hydrate();
  assert.equal(await store.requireReauthIfCurrent({ reason: 'expired', token: 'T0' }), true);
  assert.equal(store.getState().token, 'T0', 'the person keeps their screen');
  assert.equal(store.getState().reauth.reason, 'expired');
  assert.equal(disk.roster, true, 'nothing is deleted');
  assert.equal(await store.completeReauth('T0', 'T1'), true);
  assert.equal(store.getState().token, 'T1');
  assert.equal(store.getState().reauth, null);
  assert.equal(disk.token, 'T1');
});

test('a stale extension after a reauth does nothing', async () => {
  const { store } = makeStore();
  await store.hydrate();
  await store.requireReauthIfCurrent({ reason: 'expired', token: 'T0' });
  await store.completeReauth('T0', 'T1');
  assert.equal(await store.adoptRenewedToken('T0', 'T9'), false);
  assert.equal(store.getState().token, 'T1');
});

test('completeReauth after a sign-out returns false (the caller discards the fresh token)', async () => {
  const { store } = makeStore();
  await store.hydrate();
  await store.requireReauthIfCurrent({ reason: 'expired', token: 'T0' });
  await store.signOut();
  assert.equal(await store.completeReauth('T0', 'T1'), false);
  assert.equal(store.getState().token, null);
});

test('a password change while the screen is up switches it to the new-password copy, without Later', async () => {
  const { store } = makeStore();
  await store.hydrate();
  await store.requireReauthIfCurrent({ reason: 'expired', token: 'T0' });
  store.allowLater();
  store.collapseReauth(1000);
  assert.equal(store.getState().reauth.collapsed, true);
  await store.requireReauthIfCurrent({ reason: 'password_changed', token: 'T0' });
  const r = store.getState().reauth;
  assert.equal(r.reason, 'password_changed');
  assert.equal(r.collapsed, false);
  assert.equal(r.laterAllowed, false);
  store.allowLater();
  assert.equal(store.getState().reauth.laterAllowed, false, 'never offered for a changed password');
});

test('Later collapses only once allowed; it re-expands on a stale answer', async () => {
  const { store } = makeStore();
  await store.hydrate();
  await store.requireReauthIfCurrent({ reason: 'expired', token: 'T0' });
  store.collapseReauth(0);
  assert.equal(store.getState().reauth.collapsed, false, 'not before a failed attempt allows it');
  store.allowLater();
  store.collapseReauth(1000);
  assert.equal(store.getState().reauth.collapsed, true);
  store.expandReauthIfStale(1000 + 60_000, 30 * 60_000);
  assert.equal(store.getState().reauth.collapsed, true, 'too soon');
  store.expandReauthIfStale(1000 + 31 * 60_000, 30 * 60_000);
  assert.equal(store.getState().reauth.collapsed, false);
});

test('a manual sign-out during reauth clears it', async () => {
  const { store } = makeStore();
  await store.hydrate();
  await store.requireReauthIfCurrent({ reason: 'expired', token: 'T0' });
  await store.signOut();
  assert.equal(store.getState().reauth, null);
  assert.equal(store.getState().token, null);
});

test('hydration racing an early end: the end runs after hydration, against the stored token', async () => {
  const slowRead = gate();
  const disk = { token: 'T0' };
  const store = createSessionStore({
    readToken: async () => {
      await slowRead.promise;
      return disk.token;
    },
    persistToken: async (t) => {
      disk.token = t;
    },
    clearCaches: async () => {},
    loadEmail: async () => null,
    notifyServerSignOut: async () => {},
    clearSupportPrompt: () => {},
  });
  const hydrating = store.hydrate();
  const ending = store.endSessionIfCurrent({ reason: 'deleted', token: 'T0' });
  slowRead.release();
  await hydrating;
  assert.equal(await ending, true);
  assert.equal(store.getState().token, null);
});

test('a clear that throws still finishes the sign-out ("Signing out…" never sticks)', async () => {
  const { store } = makeStore({ clearThrows: true });
  await store.hydrate();
  await store.endSessionIfCurrent({ reason: 'password_changed', token: 'T0' });
  const s = store.getState();
  assert.equal(s.ending, false);
  assert.equal(s.token, null);
});

test('a sign-in typed while a slow clear is pending lands after it', async () => {
  const slow = gate();
  const { store, disk } = makeStore({ clearDelay: () => slow.promise });
  await store.hydrate();
  const ending = store.endSessionIfCurrent({ reason: 'password_changed', token: 'T0' });
  const signingIn = store.signIn('T2');
  await tick();
  assert.equal(store.getState().token, 'T0', 'the sign-in waits for the clear');
  slow.release();
  await Promise.all([ending, signingIn]);
  assert.equal(store.getState().token, 'T2');
  assert.equal(disk.token, 'T2');
});

test('the generation changes with the person, never with an extension or a reauth', async () => {
  const { store } = makeStore();
  await store.hydrate();
  const g0 = store.getGeneration();
  await store.adoptRenewedToken('T0', 'T1');
  await store.requireReauthIfCurrent({ reason: 'expired', token: 'T1' });
  await store.completeReauth('T1', 'T2');
  await store.rotateToken(async () => ({ token: 'T3' }));
  assert.equal(store.getGeneration(), g0, 'the same session throughout');
  await store.signOut();
  const g1 = store.getGeneration();
  assert.notEqual(g1, g0);
  await store.signIn('T4');
  assert.notEqual(store.getGeneration(), g1);
});

test('one snapshot object per change: subscribers see a new object only when something changed', async () => {
  const { store } = makeStore();
  await store.hydrate();
  const a = store.getState();
  assert.equal(store.getState(), a, 'same object between changes');
  store.collapseReauth(0); // nothing to collapse: no change, no new snapshot
  assert.equal(store.getState(), a);
  await store.requireReauthIfCurrent({ reason: 'expired', token: 'T0' });
  assert.notEqual(store.getState(), a);
  assert.ok(Number.isFinite(store.getState().reauth.raisedAt), 'the screen records when it went up');
});

test('a password change while the screen is up keeps the time the screen went up', async () => {
  const { store } = makeStore();
  await store.hydrate();
  await store.requireReauthIfCurrent({ reason: 'expired', token: 'T0' });
  const raisedAt = store.getState().reauth.raisedAt;
  await store.requireReauthIfCurrent({ reason: 'password_changed', token: 'T0' });
  assert.equal(store.getState().reauth.raisedAt, raisedAt);
});

test('touchReauth stamps the last use of the screen, and a password change keeps it', async () => {
  const { store } = makeStore();
  await store.hydrate();
  const before = store.getState();
  store.touchReauth(5);
  assert.equal(store.getState(), before, 'no screen, nothing to stamp');
  await store.requireReauthIfCurrent({ reason: 'expired', token: 'T0' });
  store.touchReauth(123);
  assert.equal(store.getState().reauth.activeAt, 123);
  await store.requireReauthIfCurrent({ reason: 'password_changed', token: 'T0' });
  assert.equal(store.getState().reauth.activeAt, 123);
  assert.equal(store.getState().reauth.reason, 'password_changed');
  const heard = store.getState().reauth.changeHeardAt;
  assert.ok(Number.isFinite(heard), 'the switch to the new-password screen restarts the window');
  await store.requireReauthIfCurrent({ reason: 'password_changed', token: 'T0' });
  assert.equal(store.getState().reauth.changeHeardAt, heard, 'a repeat answer about the same change does not');
});
