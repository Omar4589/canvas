import rateLimit, { MemoryStore } from 'express-rate-limit';

// Email-keyed throttles for the public auth endpoints (login + password reset).
//
// Two families, built by one factory but with OPPOSITE counting semantics and
// deliberately SEPARATE stores:
//  - Login counts only FAILED attempts (skipSuccessfulRequests), so a canvass-day
//    crowd logging in from one shared-wifi IP can't lock itself out.
//  - Forgot-password counts EVERY request — the endpoint always answers 200 (the
//    anti-oracle contract), so a failures-only limiter would never accumulate.
// The stores must never be shared: reset requests must not contribute to login
// lockouts, and the super-admin "Clear lockout" button (which resets the LOGIN
// email store) must not silently clear the reset throttle.
//
// The email key relies on express.json() being mounted above; a body with no
// email falls back to IP. State lives in in-process MemoryStores, so it also
// clears on any redeploy.

// Emails exempt from auth throttling — set LOGIN_RATELIMIT_ALLOWLIST to a comma-separated list
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

// One per-IP + one per-email limiter over a shared window. countFailuresOnly picks the
// family's semantics (see the header comment). The email limiter's store is created here
// and returned so callers can READ lockout state, not just blind-clear it — both lockout
// helpers below must reach the SAME store instance (one reads it directly, one goes
// through limiter.resetKey, which is bound to the configured store).
function makeEmailKeyedLimiters({ windowMs, ipMax, emailMax, countFailuresOnly, ipMessage, emailMessage }) {
  const emailStore = new MemoryStore();
  const ipLimiter = rateLimit({
    windowMs,
    max: ipMax,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: countFailuresOnly,
    skip: skipAllowlisted,
    message: { error: ipMessage, code: 'rate-limited' },
  });
  const emailLimiter = rateLimit({
    windowMs,
    max: emailMax,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: countFailuresOnly,
    keyGenerator: (req) => emailOf(req) || req.ip,
    skip: skipAllowlisted,
    store: emailStore,
    message: { error: emailMessage, code: 'rate-limited' },
  });
  return { ipLimiter, emailLimiter, emailStore };
}

// --- Login: failed attempts only. Per-IP catches one machine guessing many accounts; ---------
// --- per-email catches many machines (rotating IPs) guessing one account. --------------------
const EMAIL_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_MAX_FAILURES = 10;

const login = makeEmailKeyedLimiters({
  windowMs: EMAIL_WINDOW_MS,
  ipMax: 50,
  emailMax: EMAIL_MAX_FAILURES,
  countFailuresOnly: true,
  ipMessage: 'Too many login attempts. Try again in a few minutes.',
  emailMessage: 'Too many login attempts for this account. Try again in a few minutes.',
});

export const loginIpLimiter = login.ipLimiter;
export const loginEmailLimiter = login.emailLimiter;

// --- Forgot-password: every request counts (always-200 endpoint). Own store — never the ------
// --- login store. The per-email cap is a mild targeted-suppression vector (someone can jam ---
// --- one address's reset window for 15 minutes); accepted — it self-heals and login is -------
// --- unaffected. ------------------------------------------------------------------------------
const forgot = makeEmailKeyedLimiters({
  windowMs: EMAIL_WINDOW_MS,
  ipMax: 20,
  emailMax: 5,
  countFailuresOnly: false,
  ipMessage: 'Too many requests. Try again in a few minutes.',
  emailMessage: 'Too many reset requests for this address. Try again in a few minutes.',
});

export const forgotIpLimiter = forgot.ipLimiter;
export const forgotEmailLimiter = forgot.emailLimiter;

// Reset-password is token-keyed (128-bit random), so brute force is not a live threat;
// this per-IP cap is belt-and-braces against scripted guessing. Counts every request —
// the endpoint 400s on a bad token, and skipSuccessfulRequests would only exempt the 200s.
export const resetIpLimiter = rateLimit({
  windowMs: EMAIL_WINDOW_MS,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipAllowlisted,
  message: { error: 'Too many requests. Try again in a few minutes.', code: 'rate-limited' },
});

// Read a user's current per-email LOGIN lockout state. Same per-process caveat as clearing: with
// multiple web dynos this reports the dyno serving the request only, and a redeploy resets
// everything — callers must present it as "on this server", never as a global truth.
export async function loginLockoutStatus(email) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return { failedAttempts: 0, locked: false, resetAt: null, maxFailures: EMAIL_MAX_FAILURES };
  const info = await login.emailStore.get(key);
  const failedAttempts = info?.totalHits || 0;
  return {
    failedAttempts,
    locked: failedAttempts >= EMAIL_MAX_FAILURES,
    resetAt: info?.resetTime || null,
    maxFailures: EMAIL_MAX_FAILURES,
    allowlisted: allowlist().has(key),
  };
}

// Super-admin recovery: clear a stuck user's per-email LOGIN lockout counter, keyed by the
// lowercased email (matching the email keyGenerator). Returns true if a reset was issued.
// Deliberately does NOT touch the forgot-password store. Caveat: MemoryStore is per-process —
// with multiple web dynos this clears only the dyno serving the request; a redeploy clears
// them all. The env allowlist is the dyno-independent safeguard.
export function clearLoginLockout(email) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return false;
  if (typeof loginEmailLimiter.resetKey === 'function') {
    loginEmailLimiter.resetKey(key);
    return true;
  }
  return false;
}
