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
  { method = 'GET', body, headers = {}, formData, public: isPublic = false, shareToken } = {}
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
    const err = new Error(data?.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
