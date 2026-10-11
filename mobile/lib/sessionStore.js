// The phone's sign-in state, with ONE lock around every change to it.
//
// PLAIN MODULE — no imports; storage, cache clears and the server call are injected — so the race
// cases run in CI (lib/sessionStore.test.js). lib/authState.js wires it to SecureStore and the
// caches and is what the app imports. See docs/PROPOSAL_SESSION_EXPIRY.md section D2.
//
// Why a lock: sign-in, sign-out, a daily extension landing from /auth/me, a password change and
// an ended-session answer can all be in flight at once, and each is a read-then-write across an
// async storage call. Unserialized, a renewal that landed during a sign-out wrote the previous
// person's token back to storage (the next cold start signed them in again on a shared phone).
// Rules: every change to the token (and to notice, and to whether reauth is pending) runs inside the
// lock; nothing inside the lock awaits the lock; nothing a caller passes in (requestFn) touches the
// store. Only presentation details of a pending reauth (Later, collapse, expand, last use) change
// outside it — they never touch the token.
//
// State:
//   token   undefined = not read from storage yet; null = signed out; string = signed in
//   notice  { reason, email } — why the last DELIBERATE sign-out happened, for the sign-in screen
//   reauth  { reason, collapsed, laterAllowed, collapsedAt, raisedAt, activeAt, changeHeardAt } — the
//           password screen is pending; raisedAt = when it went up, activeAt = when someone last
//           used it, changeHeardAt = when it switched to asking for the new password
//   ending  true while a sign-out is clearing the caches ("Signing out…")
//   generation  bumps when the PERSON changes (a sign-in, a sign-out) — never on a daily extension
//               or a password typed into the in-place screen, which continue the same session.
//               Work started under one generation (a roster fetch) is discarded in another.
export const createSessionStore = ({
  readToken,
  persistToken,
  clearCaches,
  loadEmail,
  notifyServerSignOut,
  clearSupportPrompt,
}) => {
  let token;
  let notice = null;
  let reauth = null;
  let ending = false;
  let generation = 0;
  const listeners = new Set();

  // One snapshot object, replaced only when something changed (every change emits), so a
  // subscriber that keeps the snapshot doesn't re-render for nothing.
  let snapshot = { token, notice, reauth, ending };
  const emit = () => {
    snapshot = { token, notice, reauth, ending };
    for (const fn of listeners) fn();
  };

  let chain = Promise.resolve();
  const withLock = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => {},
      () => {}
    );
    return run;
  };

  const quietly = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      console.warn('session store:', err?.message || err);
      return undefined;
    }
  };

  // The sign-out steps, run INSIDE the lock. Today's order is kept on purpose: storage first,
  // caches next, the in-memory token LAST — the sign-in screen (which renders when the token goes
  // null) must never appear before the voter roster is gone from disk. The finally makes sure a
  // failed clear can't leave "Signing out…" up forever.
  const signOutSteps = async ({ reason = null, notifyServer = false }) => {
    if (notifyServer) {
      // Fire-and-forget; with no signal it never arrives and the session runs out on its own.
      const ended = token;
      quietly(async () => notifyServerSignOut(ended));
    }
    notice = reason
      ? {
          reason,
          // No email on the sign-in screen for an account that can't sign in again.
          email: reason === 'deleted' || reason === 'inactive' ? null : ((await quietly(loadEmail)) ?? null),
        }
      : null;
    ending = true;
    emit();
    try {
      await quietly(() => persistToken(null));
      await quietly(clearCaches);
      await quietly(async () => clearSupportPrompt());
    } finally {
      token = null;
      reauth = null;
      ending = false;
      generation += 1;
      emit();
    }
  };

  const isLive = (t) => typeof token === 'string' && token === t;

  return {
    getState: () => snapshot,
    getGeneration: () => generation,

    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    // Resolves once every queued change has run (tests, and code that must see settled state).
    settled: () => chain,

    // Reads the stored token once, at startup. Never overwrites a token set meanwhile.
    hydrate: () =>
      withLock(async () => {
        if (token !== undefined) return;
        const stored = await quietly(readToken);
        if (token === undefined) {
          token = stored || null;
          emit();
        }
      }),

    // A completed sign-in. A storage failure rejects, so the sign-in screen can say so.
    signIn: (next) =>
      withLock(async () => {
        await persistToken(next);
        token = next;
        notice = null;
        reauth = null;
        generation += 1;
        emit();
      }),

    // The person signed out (a menu, "Not you?", the update wall). Also ends the session on the
    // server, so copies of the token stop working.
    signOut: () =>
      withLock(async () => {
        if (typeof token !== 'string') return;
        await signOutSteps({ notifyServer: true });
      }),

    // A deliberate end the server reported (password changed elsewhere, account deleted) — only if
    // it is about the session we still hold.
    endSessionIfCurrent: ({ reason, token: ended }) =>
      withLock(async () => {
        if (!isLive(ended)) return false;
        await signOutSteps({ reason });
        return true;
      }),

    // The sign-in ran out: ask for the password in place. The dead token stays (the person keeps
    // their screen); a later password change while this is up switches it to the new-password copy.
    requireReauthIfCurrent: ({ reason, token: ended }) =>
      withLock(async () => {
        if (!isLive(ended)) return false;
        if (!reauth) {
          reauth = { reason, collapsed: false, laterAllowed: false, collapsedAt: null, raisedAt: Date.now() };
        } else if (reason === 'password_changed' && reauth.reason !== 'password_changed') {
          // No "Later" in this state: the screen stays covered until the new password is typed. The
          // reset window (lib/sessionEnd.js) restarts here, once — a repeat answer about the same
          // change doesn't move it.
          reauth = {
            ...reauth,
            reason,
            collapsed: false,
            laterAllowed: false,
            collapsedAt: null,
            changeHeardAt: Date.now(),
          };
        } else {
          return true;
        }
        emit();
        return true;
      }),

    // The password screen succeeded. False when the session changed meanwhile (signed out, or
    // someone else signed in) — the caller then discards the fresh token.
    completeReauth: (sent, next) =>
      withLock(async () => {
        if (!isLive(sent)) return false;
        await persistToken(next);
        token = next;
        reauth = null;
        notice = null;
        emit();
        return true;
      }),

    // GET /auth/me returned an extended token for the session that asked. Never touches notice or
    // reauth.
    adoptRenewedToken: (sent, next) =>
      withLock(async () => {
        if (typeof sent !== 'string' || !isLive(sent) || !next || next === sent) return false;
        await persistToken(next);
        token = next;
        emit();
        return true;
      }),

    // A password change from this device: the request and the adoption of its fresh token happen
    // under the lock, so an old-token 401 arriving meanwhile waits, then sees the token has moved on
    // and does nothing. requestFn must be the bare api() call — nothing that touches the store.
    rotateToken: (requestFn) =>
      withLock(async () => {
        const sent = token;
        const res = await requestFn();
        if (res?.token && typeof sent === 'string' && token === sent) {
          await persistToken(res.token);
          token = res.token;
          emit();
        }
        return res;
      }),

    // Presentation only (never the token). "Later" is offered after a sign-in attempt failed for
    // lack of signal, and never for a changed password.
    allowLater: () => {
      if (!reauth || reauth.laterAllowed || reauth.reason === 'password_changed') return;
      reauth = { ...reauth, laterAllowed: true };
      emit();
    },
    collapseReauth: (nowMs) => {
      if (!reauth || !reauth.laterAllowed || reauth.collapsed) return;
      reauth = { ...reauth, collapsed: true, collapsedAt: nowMs };
      emit();
    },
    expandReauth: () => {
      if (!reauth?.collapsed) return;
      reauth = { ...reauth, collapsed: false };
      emit();
    },
    // Someone used the password screen (a sign-in attempt, Forgot password?, Later, the notice):
    // the reset window (lib/sessionEnd.js resetWindowOpen) runs from here.
    touchReauth: (nowMs) => {
      if (!reauth) return;
      reauth = { ...reauth, activeAt: nowMs };
      emit();
    },
    // A later ended-session answer proves there is signal again; if "Later" was a while ago, bring
    // the screen back.
    expandReauthIfStale: (nowMs, minMs) => {
      if (!reauth?.collapsed || nowMs - reauth.collapsedAt < minMs) return;
      reauth = { ...reauth, collapsed: false };
      emit();
    },
  };
};
