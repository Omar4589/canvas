const TOKEN_KEY = 'canvass.token';
const ACTIVE_ORG_KEY = 'canvass.activeOrgId';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getActiveOrgId() {
  return localStorage.getItem(ACTIVE_ORG_KEY);
}

export function setActiveOrgId(orgId) {
  if (orgId) localStorage.setItem(ACTIVE_ORG_KEY, orgId);
  else localStorage.removeItem(ACTIVE_ORG_KEY);
}

export async function api(
  path,
  { method = 'GET', body, headers = {}, formData, public: isPublic = false, shareToken, signal } = {}
) {
  const finalHeaders = { ...headers };
  // Public (share-link) calls carry no user identity — only the optional share access token.
  // sentToken is held so the SESSION_REVOKED handler below can tell "this very session was
  // revoked" from a stale in-flight request that predates a token rotation.
  let sentToken = null;
  if (!isPublic) {
    sentToken = getToken();
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
    // The password was changed elsewhere (self-serve reset or change on another device) and the
    // server revoked this session. Clear the dead token and land on sign-in — without this,
    // every panel fails with a Retry button that can never succeed. Two guards:
    //  - Act only if the token THIS request carried is still the stored one. After
    //    change-password rotates the token, a poll that left with the OLD token can land 401
    //    here (another tab, or a request already in flight) — clearing then would wipe the
    //    just-adopted session and sign out the very person who changed their password.
    //  - Never redirect off a PUBLIC page. The AuthProvider probes /auth/me on every route,
    //    so a stale token would otherwise yank someone out of /reset-password/:token (mid
    //    reset!) or a shared report; clearing the dead token alone ends the noise there.
    if (
      res.status === 401 &&
      data?.code === 'SESSION_REVOKED' &&
      typeof window !== 'undefined' &&
      sentToken &&
      sentToken === getToken()
    ) {
      setToken(null);
      const p = window.location.pathname;
      const isPublic =
        p === '/' ||
        ['/login', '/forgot-password', '/reset-password', '/r', '/privacy', '/terms', '/delete-account', '/update-required']
          .some((base) => p === base || p.startsWith(`${base}/`));
      if (!isPublic) window.location.assign('/login');
    }

    const err = new Error(data?.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.code = data?.code || null; // so callers can branch without digging into err.data
    err.data = data;
    throw err;
  }
  return data;
}
