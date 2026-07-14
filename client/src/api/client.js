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
  if (!isPublic) {
    const token = getToken();
    const orgId = getActiveOrgId();
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
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
    if (
      res.status === 403 &&
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
    throw err;
  }
  return data;
}
