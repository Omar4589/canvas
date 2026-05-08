import { API_BASE_URL } from './config';
import { getToken } from './auth';
import { loadActiveOrgId } from './cache';

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const token = await getToken();
  const orgId = await loadActiveOrgId();
  const finalHeaders = { Accept: 'application/json', ...headers };
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
    throw err;
  }
  return data;
}
