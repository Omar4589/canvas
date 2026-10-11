import { useEffect, useState } from 'react';
import { getToken, setToken as persistToken } from './auth';
import {
  clearCurrentUser,
  clearActiveCampaign,
  clearBootstrap,
  clearSelectedBooks,
  loadCurrentUser,
  setRosterWriteGuard,
} from './cache';
import { createSessionStore } from './sessionStore';
import { mayWriteRoster } from './sessionEnd';
import { clearSupportAccessPrompt } from './supportAccessState';

// The app's sign-in state: lib/sessionStore.js (one lock around every token change), wired to
// SecureStore and the caches. The token is the single source of truth for auth across screens,
// so login/logout updates propagate synchronously to every subscriber.
//
//   token: undefined = not loaded yet, null = signed out, string = signed in
//
// See docs/PROPOSAL_SESSION_EXPIRY.md section D.

// Set by app/_layout.jsx: api() imports this module, so this module can't import api() back.
let serverSignOut = async () => {};
export const setServerSignOutNotifier = (fn) => {
  serverSignOut = fn;
};

const store = createSessionStore({
  readToken: getToken,
  persistToken,
  // Each clear on its own: one rejecting must not keep the others (or the sign-out) from running.
  clearCaches: () =>
    Promise.allSettled([clearCurrentUser(), clearActiveCampaign(), clearBootstrap(), clearSelectedBooks()]),
  loadEmail: async () => (await loadCurrentUser())?.email ?? null,
  notifyServerSignOut: (token) => serverSignOut(token),
  clearSupportPrompt: clearSupportAccessPrompt,
});

// Read SecureStore once at module load.
const hydration = store.hydrate();

// A walk-list snapshot may only reach disk while signed in and not mid-sign-out: privacy.html
// promises the copy "is deleted when you sign out", and a door saved during the clears (or a
// roster fetch that lands after them) used to be able to write it back.
setRosterWriteGuard(() => {
  const { token, ending } = store.getState();
  return mayWriteRoster({ signedIn: typeof token === 'string', ending });
});

export const getCurrentToken = () => store.getState().token;
export const getSessionState = () => store.getState();
export const getSessionGeneration = () => store.getGeneration();
export const subscribeSession = (fn) => store.subscribe(fn);

export const signIn = (token) => store.signIn(token);
export const signOut = () => store.signOut();
export const endSessionIfCurrent = (args) => store.endSessionIfCurrent(args);
export const requireReauthIfCurrent = (args) => store.requireReauthIfCurrent(args);
export const completeReauth = (sent, next) => store.completeReauth(sent, next);
export const adoptRenewedToken = (sent, next) => store.adoptRenewedToken(sent, next);
export const rotateToken = (requestFn) => store.rotateToken(requestFn);
export const allowLater = () => store.allowLater();
export const collapseReauth = (nowMs = Date.now()) => store.collapseReauth(nowMs);
export const expandReauth = () => store.expandReauth();
export const expandReauthIfStale = (nowMs, minMs) => store.expandReauthIfStale(nowMs, minMs);
export const touchReauth = (nowMs = Date.now()) => store.touchReauth(nowMs);

// Subscribes a component to one slice of the session state.
const useSessionSlice = (pick) => {
  const [value, setValue] = useState(() => pick(store.getState()));
  useEffect(() => {
    const listener = () => setValue(pick(store.getState()));
    const unsubscribe = store.subscribe(listener);
    // Resync in case the state moved between render and subscribe.
    listener();
    return unsubscribe;
    // pick is a module-level selector below; never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
};

const pickToken = (s) => s.token;
const pickSession = (s) => s;

export const useAuthToken = () => useSessionSlice(pickToken);

// { token, notice, reauth, ending } — for the sign-in screen, the password screen and the gate.
export const useSessionState = () => useSessionSlice(pickSession);

export const useAuthReady = () => {
  const [ready, setReady] = useState(store.getState().token !== undefined);
  useEffect(() => {
    if (store.getState().token !== undefined) {
      setReady(true);
      return undefined;
    }
    let alive = true;
    hydration.then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  return ready;
};
