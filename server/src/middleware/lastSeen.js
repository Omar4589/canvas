// Throttle for the User.lastSeenAt stamp.
//
// Why it exists: lastLoginAt only moves when someone types a password, and with 30-day tokens and a
// mobile app that skips the login screen, that is a lie about whether an account is alive — a daily
// canvasser reads "27d ago". lastSeenAt answers "when was this person last here" honestly, which
// means stamping on ordinary authenticated requests rather than on login.
//
// Why throttled: requireAuth runs on EVERY authenticated request. Stamping each one would put a
// write on the hottest read path in the app. One write per user per window is all the column needs —
// it renders a relative time, so 15-minute resolution is already finer than the display.
//
// Why an in-process Map and not "is the stored value older than 15 min?": requireAuth runs TWICE on
// every /admin, /mobile and /super-admin request (routes/index.js mounts it, then each sub-router
// mounts it again) and THREE times on nested campaign routes (/admin/campaigns is mounted ahead of
// /admin/campaigns/:campaignId/*, and Express use() prefix-matches). All of those passes read the
// same stale document, so a DB comparison would fire the write on every one of them — 2-3x the
// amplification the throttle exists to prevent. Recording the decision here, before the write is
// issued, is what makes passes 2 and 3 no-ops.
//
// Per-process, like the login limiter's store (middleware/loginRateLimit.js): N web dynos each issue
// one write per window per user, and a redeploy clears the table and costs one extra write per
// active user. Both are fine, because the worst case of a miss is one redundant idempotent $set —
// never a wrong answer and never a dropped stamp.

export const WINDOW_MS = 15 * 60 * 1000;

// Bounded so a long-lived dyno serving a large org can't grow this without limit. 5k entries (a
// 24-char id + a number each) is comfortably under a megabyte, and evicting someone still active
// costs exactly one extra write when they come back.
export const MAX_TRACKED = 5000;

const stamped = new Map();

export const shouldStampLastSeen = (userId, now = Date.now()) => {
  const last = stamped.get(userId);
  if (last !== undefined && now - last < WINDOW_MS) return false;

  // delete-then-set, not a bare set: Map iterates in INSERTION order and re-setting an existing key
  // does not move it, so without the delete the eviction below would drop an arbitrary entry rather
  // than the least-recently-seen one. With it, the iterator is exactly recency order.
  stamped.delete(userId);
  stamped.set(userId, now);

  while (stamped.size > MAX_TRACKED) {
    const oldest = stamped.keys().next();
    if (oldest.done) break;
    stamped.delete(oldest.value);
  }

  return true;
};

export const resetLastSeenThrottle = () => stamped.clear();

// Test seam only — the suite asserts the bound actually holds.
export const trackedCount = () => stamped.size;
