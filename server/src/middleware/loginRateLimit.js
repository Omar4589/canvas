import rateLimit from 'express-rate-limit';

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

export const loginEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => emailOf(req) || req.ip,
  skip: skipAllowlisted,
  message: { error: 'Too many login attempts for this account. Try again in a few minutes.', code: 'rate-limited' },
});

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
