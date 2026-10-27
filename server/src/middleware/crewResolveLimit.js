import rateLimit, { MemoryStore } from 'express-rate-limit';

// Throttles for the campaign Team page's "who owns this email?" lookup
// (POST /admin/campaigns/:campaignId/crew/resolve).
//
// WHY THIS EXISTS. The lookup answers, for addresses inside the caller's own organization, "yes —
// that's Maria Gomez." That is the right answer for the operator who just typed the address, and it
// is strictly narrower than the org-wide roster the endpoint next to it used to hand every team
// lead. But it is also the only way left to learn a colleague's name one address at a time, so it
// gets a ceiling: real onboarding never needs thirty named lookups an hour, and enumeration needs
// thousands.
//
// TWO LIMITS, EACH COUNTING ONLY ITS OWN KIND (owner ruling 2026-10-26): a lookup that finds nobody
// (`outside`) counts toward 60 an hour, so a launch-day crew of new people can be added; one that
// names somebody counts toward 30, as before. The route sets res.locals.lookup to 'outside' or
// 'named', and each limiter gives a request back (skipSuccessfulRequests) unless the flag is its own
// kind — so a mistyped address (400) or a refusal (429) counts for neither, whatever the mount order.
// express-rate-limit counts a lookup when it ARRIVES, before the answer is known, so once either limit
// is reached every lookup waits for that limiter's hour. That is the safe behavior: refusing only the
// lookups that would name someone would make the refusal itself say who is in the organization.
//
// An `outside` answer is byte-identical whether or not the address has an account elsewhere; what a
// script could learn from many of them is only a small timing difference, which resolveEmailInOrg
// narrows and the 60-an-hour limit bounds. Lookups are NOT written to AccessLog — that records only
// Doorline staff under a support grant (middleware/accessLog.js).
//
// KEYED ON THE ACTOR, NEVER THE IP. A canvass office shares one WAN address — IP-keying would lock
// out a whole launch day while barely inconveniencing a script. `req.user` is resolved by
// requireAuth above this middleware; the `|| req.ip` fallback is unreachable there and exists so a
// mis-ordered mount degrades to a limit rather than a crash.
//
// Per-process MemoryStore, same caveat as loginRateLimit.js: with multiple web dynos this counts
// per dyno and a redeploy clears it. That is acceptable for a nuisance ceiling.
const HOUR_MS = 60 * 60 * 1000;

// The 429 says how long to wait, from the limiter that refused (it set req.rateLimit last).
const tooMany = (req) => {
  const reset = req.rateLimit?.resetTime;
  return {
    error: 'Too many lookups. Try again in a little while.',
    code: 'rate-limited',
    retryAfterSeconds: reset ? Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000)) : null,
  };
};

const lookupLimiter = (kind, max) =>
  rateLimit({
    windowMs: HOUR_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user?._id || req.ip),
    store: new MemoryStore(),
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) => res.locals?.lookup !== kind,
    message: tooMany,
  });

export const OUTSIDE_LOOKUPS_PER_HOUR = 60;
export const NAMED_LOOKUPS_PER_HOUR = 30;
export const crewResolveLimiters = [
  lookupLimiter('outside', OUTSIDE_LOOKUPS_PER_HOUR),
  lookupLimiter('named', NAMED_LOOKUPS_PER_HOUR),
];
