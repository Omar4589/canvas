import { API_BASE_URL, CLIENT_API_VERSION } from './config';
import { getToken } from './auth';
import { getCurrentToken } from './authState';
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

// Default request timeout. A bare fetch with no timeout was the main cause of the
// multi-second "did it register?" delay canvassers saw: on weak/dead signal the
// socket would hang until the OS-level TCP timeout (~60s) before failing, which is
// only when a household action would finally queue offline. Aborting at 20s lets
// callers fail fast and queue (or fall back to cache) instead of waiting that out.
const DEFAULT_TIMEOUT_MS = 20000;

export async function api(
  path,
  { method = 'GET', body, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, signal, orgId: orgIdOverride } = {}
) {
  const token = await getToken();
  // orgId is normally the active org, but the offline queue pins each item to the org it was
  // recorded under — a multi-org user who re-logs into a different org must not flush org-A
  // knocks under an org-B header (they'd 4xx and be dropped as "bad submissions").
  const orgId = orgIdOverride !== undefined ? orgIdOverride : await loadActiveOrgId();
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

  const controller = new AbortController();
  init.signal = controller.signal;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  // A caller-supplied signal (e.g. react-query's per-fetch signal) aborts the
  // same internal controller, so superseded requests stop consuming the radio.
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api${path}`, init);
    // Headers are in — stop the timeout timer so a body that finishes streaming
    // just after the deadline isn't aborted, which would turn a response the
    // server already persisted into a "timeout" that submitOrQueue re-POSTs. A
    // caller-supplied signal can still abort the body read (react-query cancel).
    clearTimeout(timer);
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
      // Tag org-context failures so the global handler can recover gracefully. The server
      // now also sends code:'ORG_CONTEXT' explicitly (middleware/orgContext.js); keep the
      // string set as the fallback so an older server still recovers.
      if (res.status === 400 || res.status === 403 || res.status === 404) {
        if (data?.code === 'ORG_CONTEXT' || ORG_CONTEXT_ERRORS.has(data?.error)) {
          err.code = 'ORG_CONTEXT';
        }
      }
      // "Your ROLE is too low for this endpoint." Distinct from ORG_CONTEXT: the org is
      // fine, the role isn't. Usually a screen bug — but it ALSO fires when a role changed
      // under the user mid-session, which the global handler disambiguates by refetching.
      if (res.status === 403 && data?.code === 'FORBIDDEN_ROLE' && !err.code) {
        err.code = 'FORBIDDEN_ROLE';
      }
      // The server explicitly revoked this session (password changed elsewhere). Tagged so the
      // global handler can sign out to the login screen instead of every query dead-ending.
      // The offline queue is untouched by sign-out, so queued knocks survive to flush after
      // the user signs back in. Tagged ONLY when the token this request carried is still the
      // one in use: an in-flight request from BEFORE a token rotation (change-password adopts
      // a fresh token) can land 401 AFTER the rotation, and signing out then would wipe the
      // brand-new session. A stale request's 401 keeps err.status for the queue's hold logic
      // but never triggers the global sign-out.
      if (res.status === 401 && data?.code === 'SESSION_REVOKED') {
        const current = getCurrentToken();
        if (!current || current === token) err.code = 'SESSION_REVOKED';
      }
      throw err;
    }
    return data;
  } catch (err) {
    // A timeout abort surfaces with no `.status`, so submitOrQueue treats it like
    // any other transport failure and queues the submission for later retry.
    // External aborts (caller cancellation) rethrow as-is so react-query treats
    // them as cancellations, not failures. (timedOut implies the controller
    // aborted, since the timer callback sets it and then aborts.)
    if (timedOut) {
      const timeoutErr = new Error('Request timed out');
      timeoutErr.code = 'TIMEOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}
