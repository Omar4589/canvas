import rateLimit, { MemoryStore } from 'express-rate-limit';

// Throttle for the campaign Team page's "who owns this email?" lookup
// (POST /admin/campaigns/:campaignId/crew/resolve).
//
// WHY THIS EXISTS. The lookup answers, for addresses inside the caller's own organization, "yes —
// that's Maria Gomez." That is the right answer for the operator who just typed the address, and it
// is strictly narrower than the org-wide roster the endpoint next to it used to hand every team
// lead. But it is also the only way left to learn a colleague's name one address at a time, so it
// gets a ceiling: real onboarding never needs thirty lookups an hour, and enumeration needs
// thousands.
//
// KEYED ON THE ACTOR, NEVER THE IP. A canvass office shares one WAN address — IP-keying would lock
// out a whole launch day while barely inconveniencing a script. `req.user` is resolved by
// requireAuth above this middleware; the `|| req.ip` fallback is unreachable there and exists so a
// mis-ordered mount degrades to a limit rather than a crash.
//
// Per-process MemoryStore, same caveat as loginRateLimit.js: with multiple web dynos this counts
// per dyno and a redeploy clears it. That is acceptable for a nuisance ceiling — the durable
// deterrent is the AccessLog subject line the route writes whenever a lookup names somebody.
export const crewResolveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?._id || req.ip),
  store: new MemoryStore(),
  message: {
    error: 'Too many lookups. Try again in a little while.',
    code: 'rate-limited',
  },
});
