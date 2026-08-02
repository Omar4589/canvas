import { getToken, getActiveOrgId } from '../api/client.js';

// Authenticated attachment download — the api() helper is JSON-only (it consumes every body
// as text), so attachments need a raw fetch with the auth headers attached by hand, then a
// blob-anchor click. Extracted from the idiom inlined in DashboardPage/WalkListsPage/
// SurveyExplorerPage (those copies are candidates to adopt this later; not migrated here).
// Throws Error(`Download failed: ${status}`) — callers own the busy/error UI. When the
// server answers with JSON (a 409/410 with an error message), that message is thrown
// instead so the user sees "This export has expired…" rather than a bare status code.
// Returns the resolved filename.
export const downloadFile = async (path, { fallbackName = 'download.csv' } = {}) => {
  const headers = {};
  const token = getToken();
  const orgId = getActiveOrgId();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['X-Org-Id'] = orgId;
  const res = await fetch(`/api${path}`, { headers });
  if (!res.ok) {
    let message = `Download failed: ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the status message
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const disp = res.headers.get('Content-Disposition') || '';
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp);
  const fileName = m ? decodeURIComponent(m[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return fileName;
};
