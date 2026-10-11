import { sessionEndDecision, webAction, isPublicPath } from '../lib/sessionEnd.js';

export const TOKEN_KEY = 'canvass.token';
const ACTIVE_ORG_KEY = 'canvass.activeOrgId';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// THIS tab's active org. Read from localStorage the first time it's needed (the remembered org a
// new tab or a reload starts from), then owned by the tab: another tab switching org, signing in
// or signing out writes localStorage but no longer re-points this tab's requests underneath it.
// That used to send one org's header from a page showing another org — and, with the in-place
// password prompt, it stripped the org from a tab holding unsaved edits behind its prompt (a
// password reset or a sign-in in another tab clears or resets the stored org).
let tabOrgId;
export function getActiveOrgId() {
  if (tabOrgId === undefined) tabOrgId = localStorage.getItem(ACTIVE_ORG_KEY);
  return tabOrgId;
}

export function setActiveOrgId(orgId) {
  tabOrgId = orgId || null;
  if (orgId) localStorage.setItem(ACTIVE_ORG_KEY, orgId);
  else localStorage.removeItem(ACTIVE_ORG_KEY);
}

// A request answered "your sign-in ran out" waits here while the password prompt is up, then runs
// once more with the restored session — the 401 came from the sign-in check, so the request itself
// never ran. Nothing fails underneath the prompt: a page never swaps its form for an error (and
// loses what was typed), and a Save clicked at the wrong moment completes after the password.
// AuthContext resolves it when the session is back, and rejects it on a sign-out.
let restore = null;
const pendingRestore = () => {
  if (!restore) {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => {}); // a rejection with nothing waiting on it is expected
    restore = { promise, resolve, reject };
  }
  return restore.promise;
};
export const resolveSessionRestore = () => {
  const r = restore;
  restore = null;
  r?.resolve();
};
export const rejectSessionRestore = () => {
  const r = restore;
  restore = null;
  r?.reject(new Error('Signed out'));
};

// Whether this tab's password prompt is up — set by AuthContext on every change to it. While it is,
// a password change or another tab's sign-out is held too: the prompt answers those as well. (Not
// "a request is already waiting": one aborted while held leaves that behind with no prompt.)
let promptUp = false;
export const setSessionPromptUp = (up) => {
  promptUp = !!up;
};

const waitOrAbort = (promise, signal) => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      }
    );
  });
};

export async function api(path, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    formData,
    public: isPublic = false,
    shareToken,
    signal,
    // An explicit bearer token, e.g. ending one specific session on the server.
    token: tokenOverride,
    // Never report a session end from this call (the page-load check, the password prompt's login,
    // a sign-out).
    quiet = false,
    // Internal: this is the one retry after the session was restored.
    _retried = false,
  } = options;
  const finalHeaders = { ...headers };
  // Public (share-link) calls carry no user identity — only the optional share access token.
  // sentToken is held so an ended-session answer can tell "this very session ended" from a stale
  // in-flight request that predates a token change. Read synchronously, before the first await,
  // so a caller can clear the stored token right after calling (logout does).
  let sentToken = null;
  if (!isPublic) {
    sentToken = tokenOverride !== undefined ? tokenOverride : getToken();
    const orgId = getActiveOrgId();
    if (sentToken) finalHeaders.Authorization = `Bearer ${sentToken}`;
    if (orgId) finalHeaders['X-Org-Id'] = orgId;
  }
  if (shareToken) finalHeaders['X-Share-Token'] = shareToken;

  const init = { method, headers: finalHeaders };
  if (signal) init.signal = signal;

  if (formData) {
    init.body = formData;
  } else if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`/api${path}`, init);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    // A locked-out user (temp password) gets 403'd on every protected route;
    // funnel any in-flight call to the forced change-password screen.
    if (
      res.status === 403 &&
      data?.code === 'PASSWORD_CHANGE_REQUIRED' &&
      typeof window !== 'undefined' &&
      window.location.pathname !== '/change-password'
    ) {
      window.location.assign('/change-password');
    }
    // The active org isn't ours — removed from the org mid-session, or a stale localStorage
    // id. Drop it and send the user to the picker, the same recovery the mobile client
    // already does centrally. Without this, every panel fails with a Retry button that can
    // never succeed.
    //
    // Deliberately NOT done for code === 'FORBIDDEN_ROLE': that only means the caller hit an
    // endpoint above their role, which must not eject them from the org.
    // 404 as well as 403: orgContext.js answers 404 ORG_CONTEXT for an org that is deactivated or
    // being deleted, and without this those two land on an unretryable error instead of the picker.
    // Safe to widen — ORG_CONTEXT is emitted by that middleware alone.
    if (
      (res.status === 403 || res.status === 404) &&
      data?.code === 'ORG_CONTEXT' &&
      typeof window !== 'undefined' &&
      window.location.pathname !== '/select-org'
    ) {
      setActiveOrgId(null);
      window.location.assign('/select-org');
    }
    // Platform staff reached into a customer org they hold no membership in, without a live support
    // access grant. Broadcast it so the app can offer the ONE thing that resolves it — a grant modal.
    //
    // Without this, the server's (correct, helpful) error told the operator to start a session with a
    // reason, and the product gave them no way to do that: every org in the switcher was a dead end
    // whose Retry button could never succeed. The lock had no handle.
    //
    // A window event rather than a per-page handler, because the 403 can surface from any query on any
    // screen, and a per-page hook is one somebody forgets on the next page.
    if (res.status === 403 && data?.code === 'SUPPORT_ACCESS_REQUIRED' && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('doorline:support-access-required', {
          detail: { organizationId: data.organizationId, organizationName: data.organizationName },
        })
      );
    }
    const err = new Error(data?.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.code = data?.code || null; // so callers can branch without digging into err.data
    err.data = data;

    // The server says this session ended — every such 401 is code SESSION_REVOKED plus a reason
    // (lib/sessionEnd.js). Reported to the AuthProvider as a window event, like the support-access
    // prompt above, because it can surface from any request on any page. The provider decides:
    // a sign-in that ran out → the password prompt IN PLACE (the token is NOT cleared here —
    // clearing it would push every other open tab into a sign-out and throw away their unsaved
    // work); a deliberate end (password changed elsewhere, account deleted, signed out in another
    // tab) → the sign-in page with a note. Without this every panel failed with a Retry button
    // that could never succeed. Acted on only when this request carried the token still stored
    // (sessionEndDecision): after a password change rotates the token, a poll that left with the
    // OLD one can land 401 here, and must not touch the new session.
    if (!quiet && typeof window !== 'undefined') {
      const ended = sessionEndDecision({ status: res.status, data, sentToken, storedToken: getToken() });
      if (ended) {
        // Held for the password (see pendingRestore above): a run-out, or — while the prompt is
        // already up — a password change or another tab's sign-out, which the prompt also answers.
        // Never on a public page (no prompt there) and never twice for one request.
        const hold =
          !_retried &&
          !isPublicPath(window.location.pathname) &&
          (webAction(ended.reason) === 'reauth' ||
            (promptUp && (ended.reason === 'password_changed' || ended.reason === 'missing')));
        // Created BEFORE the event, so a provider that decides "sign out" can reject it at once.
        const waiting = hold ? pendingRestore() : null;
        window.dispatchEvent(
          new CustomEvent('doorline:session-ended', { detail: { reason: ended.reason, sentToken } })
        );
        if (waiting) {
          try {
            await waitOrAbort(waiting, signal);
          } catch (waitErr) {
            if (waitErr?.name === 'AbortError') throw waitErr;
            throw err;
          }
          return api(path, { ...options, _retried: true });
        }
      }
    }
    throw err;
  }
  return data;
}
