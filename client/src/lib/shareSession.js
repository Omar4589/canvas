import { api } from '../api/client.js';
import { getShareAccess, isShareAccessRemembered, setShareAccess, clearShareAccess } from './shareAccess.js';
import { classifyShareError, unlockErrorText } from './shareErrors.js';

// One share link's session on this device — the unlock token, the password gate and the link's
// dead ends — as a small store the client pages subscribe to (useSyncExternalStore). It holds the
// ONE error handler every share call goes through (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §H1):
//
//   · 401 → the token is dropped and the gate comes back with "it may have changed";
//   · 404 SHARE_NOT_FOUND / 410 → the token is dropped and the page says what happened;
//   · everything else (a report taken down, the map, a network error) leaves the session alone —
//     the page that asked shows it.
//
// A store, not component state, so the rules are testable without a DOM and every page shares one
// answer. It outlives the pages (one per link token, for the life of the tab), which is also why an
// unlock in flight needs no abort: it resolves into the store, never into an unmounted component.

const sessions = new Map();

export const createShareSession = (token) => {
  let state = {
    accessToken: getShareAccess(token),
    remembered: isShareAccessRemembered(token),
    gate: null, // null | 'changed' (a 401 brought it back) | 'signed-out'
    fatal: null, // null | { kind: 'link-gone' | 'expired', message }
    unlocking: false,
    unlockError: null,
    ends: 0, // bumps whenever the session is dropped, so the page forgets what it read with it
  };
  const listeners = new Set();
  const set = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const drop = (patch) => {
    clearShareAccess(token);
    set({ accessToken: null, remembered: false, unlocking: false, ends: state.ends + 1, ...patch });
  };

  /**
   * The one error handler. `sentToken` is the token the failed call carried: a call that left
   * before a fresh unlock can land after it, and its 401 says nothing about the new session.
   * Returns the classification ({ kind, … }) for the page to show what is its own business.
   */
  const handleError = (err, sentToken = state.accessToken) => {
    const c = classifyShareError(err);
    if (c.kind === 'password') {
      if ((sentToken ?? null) !== (state.accessToken ?? null)) return { ...c, stale: true };
      drop({ gate: 'changed', fatal: null });
    } else if (c.kind === 'link-gone' || c.kind === 'expired') {
      drop({ fatal: c, gate: null });
    }
    return c;
  };

  /** Trade the password for a token; `remember` keeps it on this device (localStorage, ≤30 days). */
  const unlock = async ({ password, remember = false } = {}) => {
    set({ unlocking: true, unlockError: null });
    try {
      const body = password === undefined ? { remember: !!remember } : { password, remember: !!remember };
      const r = await api(`/share/${token}/unlock`, { method: 'POST', public: true, body });
      if (!r?.accessToken) throw Object.assign(new Error('No access token'), { status: 500 });
      setShareAccess(token, r.accessToken, { remember: !!remember });
      set({ accessToken: r.accessToken, remembered: !!remember, gate: null, fatal: null, unlocking: false });
      return true;
    } catch (err) {
      const c = classifyShareError(err);
      if (c.kind === 'link-gone' || c.kind === 'expired') drop({ fatal: c, gate: null });
      else set({ unlocking: false, unlockError: unlockErrorText(err) });
      return false;
    }
  };

  /** Sign out on this device: both stored copies go, and the gate comes back. */
  const signOut = () => drop({ gate: 'signed-out', fatal: null, unlockError: null });

  /**
   * Another tab changed the stored token: a remembered sign-out there ends this tab's remembered
   * session too, and a remembered sign-in there lets this tab, still at the gate, in.
   */
  const syncFromStorage = () => {
    const stored = getShareAccess(token);
    if (state.accessToken && state.remembered && stored !== state.accessToken) {
      if (stored) set({ accessToken: stored, remembered: isShareAccessRemembered(token) });
      else drop({ gate: 'signed-out', fatal: null });
    } else if (!state.accessToken && stored && !state.fatal) {
      set({ accessToken: stored, remembered: isShareAccessRemembered(token), gate: null, unlockError: null });
    }
  };

  /** A share read: the link's path, this session's token, and the one error handler. */
  const get = (path, { signal, ...rest } = {}) => {
    const sent = state.accessToken;
    return api(`/share/${token}${path}`, { public: true, shareToken: sent || undefined, signal, ...rest }).catch((err) => {
      if (err?.name !== 'AbortError') handleError(err, sent);
      throw err;
    });
  };

  return {
    token,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    handleError,
    unlock,
    signOut,
    syncFromStorage,
    get,
  };
};

/** The session for a link token — one per token for the life of the tab. */
export const getShareSession = (token) => {
  if (!sessions.has(token)) sessions.set(token, createShareSession(token));
  return sessions.get(token);
};
