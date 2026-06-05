import { API_BASE_URL, CLIENT_API_VERSION } from './config';
import { getToken } from './auth';
import { loadActiveOrgId } from './cache';

// Server messages that mean "this request had no valid active-organization
// context" — a stale activeOrgId or a client/server version skew. We tag these
// so a single handler can recover (clear the stale org and re-route) instead of
// every screen dead-ending on a Retry button. See the QueryCache onError in
// app/_layout.jsx. Matched on the exact strings the server returns from
// middleware/orgContext.js + routes/mobile/bootstrap.js.
const ORG_CONTEXT_ERRORS = new Set([
  'Active organization required (X-Org-Id header)',
  'Organization not found',
  'Not a member of this organization',
  'Invalid X-Org-Id',
]);

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const token = await getToken();
  const orgId = await loadActiveOrgId();
  const finalHeaders = {
    Accept: 'application/json',
    'X-Client-Version': String(CLIENT_API_VERSION),
    ...headers,
  };
  if (token) finalHeaders.Authorization = `Bearer ${token}`;
  if (orgId) finalHeaders['X-Org-Id'] = orgId;

  const init = { method, headers: finalHeaders };
  if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE_URL}/api${path}`, init);
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
    const err = new Error(data?.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.data = data;
    // Tag org-context failures so the global handler can recover gracefully.
    if (res.status === 400 || res.status === 403 || res.status === 404) {
      if (ORG_CONTEXT_ERRORS.has(data?.error)) err.code = 'ORG_CONTEXT';
    }
    throw err;
  }
  return data;
}
