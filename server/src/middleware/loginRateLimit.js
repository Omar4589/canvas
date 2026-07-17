import rateLimit, { MemoryStore } from 'express-rate-limit';

// Login throttles. Both count only FAILED attempts (skipSuccessfulRequests), so a canvass-day
// crowd logging in from one shared-wifi IP can't lock itself out. Per-IP catches one machine
// guessing many accounts; per-email catches many machines (rotating IPs) guessing one account.
// The email key relies on express.json() being mounted above; a body with no email falls back to
// IP. State lives in the default in-process MemoryStore, so it also clears on any redeploy.

// Emails exempt from login throttling — set LOGIN_RATELIMIT_ALLOWLIST to a comma-separated list
// (e.g. the owner/super-admin). An allowlisted account can never lock itself out on a mistyped
// password. Read per-request so the env can be changed without a code edit.
function allowlist() {
  return new Set(
    String(process.env.LOGIN_RATELIMIT_ALLOWLIST || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

function emailOf(req) {
  return String(req.body?.email || '').trim().toLowerCase();
}

// Bypass BOTH limiters for allowlisted emails so their attempts never count on IP or email.
function skipAllowlisted(req) {
  const email = emailOf(req);
  return !!email && allowlist().has(email);
}

export const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: skipAllowlisted,
  message: { error: 'Too many login attempts. Try again in a few minutes.', code: 'rate-limited' },
});

// The email limiter's store is held explicitly (instead of the implicit default) so the lockout
// state can be READ, not just blind-cleared — see loginLockoutStatus below. Same MemoryStore the
// library would have created; behavior is unchanged.
const EMAIL_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_MAX_FAILURES = 10;
const emailStore = new MemoryStore();

export const loginEmailLimiter = rateLimit({
  windowMs: EMAIL_WINDOW_MS,
  max: EMAIL_MAX_FAILURES,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => emailOf(req) || req.ip,
  skip: skipAllowlisted,
  store: emailStore,
  message: { error: 'Too many login attempts for this account. Try again in a few minutes.', code: 'rate-limited' },
});

// Read a user's current per-email lockout state. Same per-process caveat as clearing: with
// multiple web dynos this reports the dyno serving the request only, and a redeploy resets
// everything — callers must present it as "on this server", never as a global truth.
export async function loginLockoutStatus(email) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return { failedAttempts: 0, locked: false, resetAt: null, maxFailures: EMAIL_MAX_FAILURES };
  const info = await emailStore.get(key);
  const failedAttempts = info?.totalHits || 0;
  return {
    failedAttempts,
    locked: failedAttempts >= EMAIL_MAX_FAILURES,
    resetAt: info?.resetTime || null,
    maxFailures: EMAIL_MAX_FAILURES,
    allowlisted: allowlist().has(key),
  };
}

// Super-admin recovery: clear a stuck user's per-email lockout counter, keyed by the lowercased
// email (matching loginEmailLimiter's keyGenerator). Returns true if a reset was issued.
// Caveat: MemoryStore is per-process — with multiple web dynos this clears only the dyno serving
// the request; a redeploy clears them all. The env allowlist is the dyno-independent safeguard.
export function clearLoginLockout(email) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return false;
  if (typeof loginEmailLimiter.resetKey === 'function') {
    loginEmailLimiter.resetKey(key);
    return true;
  }
  return false;
}
