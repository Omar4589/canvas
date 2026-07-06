// Single source of truth for the GPS canvassing-quality audit thresholds. Both the
// live flag detector (flagDetection.js) and the legacy "far knock" counters in
// routes/admin/reports.js import FAR_WARN_M so "far" means ONE thing everywhere
// (historically the server flagged >50m while the client ping panel called >100m
// "far"). The client keeps a byte-parallel mirror at client/src/lib/flagThresholds.js
// (the browser can't import server ESM) — keep the two in sync.
//
// These are deliberately tunable in ONE place; calibrate against real field data.
export const FLAG_THRESHOLDS = {
  // FAR — canvasser GPS was this far from the house pin when they recorded. Tiered on
  // distance MINUS accuracy (a big distance from a poor fix is weak GPS, not "far").
  FAR_WARN_M: 75, // med — worth a look (raised from the old 50 so rooftop-pin-vs-sidewalk isn't noise)
  FAR_CONFIRM_M: 250, // high — clearly the wrong house / down the block

  // WEAK / MISSING GPS — the fix itself is untrustworthy, so distance can't be judged.
  GPS_ACCURACY_WARN_M: 100, // fix worse than this = weak_gps (med)
  GPS_ACCURACY_BAD_M: 250, // weak_gps (high)

  // RAPID succession — two consecutive DISTINCT-door actions by one canvasser this close
  // in time (too fast to physically walk between doors).
  RAPID_GAP_SEC: 20, // med
  RAPID_GAP_HIGH_SEC: 8, // high

  // ONE-SPOT (stationary) — many of a canvasser's GPS stamps land within a tiny radius
  // over a short span, covering several DISTINCT doors whose OWN pins are spread out
  // (sat in one place / in the car doing the block). The house-spread guard is what keeps
  // a legitimate apartment building — many units at one coordinate — from firing.
  ONE_SPOT_RADIUS_M: 20,
  ONE_SPOT_WINDOW_MIN: 30,
  ONE_SPOT_MIN_DISTINCT_HH: 4,
  ONE_SPOT_HOUSE_SPREAD_M: 60,
};

// Severity ordering helper (low < med < high) for rolling up a canvasser's worst flag.
export const SEVERITY_RANK = { low: 1, med: 2, high: 3 };

export function maxSeverity(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (SEVERITY_RANK[a] || 0) >= (SEVERITY_RANK[b] || 0) ? a : b;
}
