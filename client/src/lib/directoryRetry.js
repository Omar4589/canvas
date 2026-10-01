// The retry rule for the org voters directory (VotersPage). The console's global default is
// `retry: 1` (main.jsx), which re-runs ANY failed query once, a second later — including a 503
// the server took its whole time budget to send. On the 2026-09-30 incident that turned one
// slow org-wide read into roughly twice the wait before the page admitted anything was wrong.
//
// api/client.js stamps `status` (and `code`) on every error it builds from an HTTP response.
// No status means fetch itself rejected — a dropped connection, a tab waking up — and that is
// the one failure worth a second try. Any HTTP answer is final: Heroku's H12 503, the
// handler's own DIRECTORY_TIMEOUT 503 (the page offers a Try again for it), a 4xx.
export const shouldRetryDirectory = (failureCount, err) => failureCount < 1 && err?.status == null;
