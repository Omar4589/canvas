import { FbTimeConnection } from '../../models/FbTimeConnection.js';
import { FbTimeShift } from '../../models/FbTimeShift.js';
import { FbTimePersonLink } from '../../models/FbTimePersonLink.js';
import { zonedDayRange, zonedDayStr } from '../../utils/timezone.js';

// Where an hours denominator comes from: measured (FbTime) or estimated (the
// first-to-last knock span). THE resolver, in the billRestricted.js sense —
// report routes ask this module and never read FbTimeConnection or
// FbTimeShift directly, so the rules below hold everywhere or nowhere.
//
// THE RULES (owner-ruled + provider contract; see docs/FBTIME_INTEGRATION.md):
//
//  · THE DAY IS BUILT HERE, in the report's own anchor timezone. The cache
//    holds SHIFTS (instants), and each one belongs entirely to the local day
//    its clockIn falls on in `tz` — the provider's own bucketing rule
//    (localDateOf), applied to the same instants in the report's zone instead
//    of one stamped at sync time. So hours-days and knock-days share a
//    bucketing BY CONSTRUCTION: the same request resolves one anchor tz and
//    feeds it to both. (The previous day-total cache was stamped with the
//    org's zone, and any campaign anchored elsewhere silently read zero
//    measured rows — the failure this shape makes unrepresentable.)
//  · Per user-day: use the measured hours where they exist AND are usable —
//    hours > 0 (a zero denominator reads as an infinite rate) and not stale
//    (an open shift from an earlier day is a forgotten clock-out, not a
//    30-hour shift; that day falls back to the span and keeps its flag).
//    Absence of hours is NEVER zero hours — it means "not measured, estimate".
//  · STALENESS IS DERIVED, EXACTLY, PER REQUEST: a day is stale when it holds
//    an open shift AND lies strictly before today-in-tz. Never cached — a
//    "today" baked into a row is wrong from the next midnight and frozen
//    wrong when sync errors. With shift-level data this is precise: today's
//    healthy open shift never flags, and only the forgotten clock-out's own
//    day falls back. (The old day-total cache knew only that the PERSON had a
//    stale shift somewhere, so it wrote the flag broad and narrowed here;
//    both halves of that dance are gone.)
//  · A user's day set is the UNION of knock-days and measured days: a day
//    with clocked hours and no knocks still spends hours, and hiding it would
//    flatter the rate. That is the mismatch that actually bites — "clocked in
//    but not knocking". (daysActive keeps its existing knock-day meaning.)
//  · Per-canvasser rows may be 'measured', 'estimated', or 'mixed' — mixed is
//    legal ONLY at this labeled per-person grain.
//  · AGGREGATES ARE ALL-OR-NOTHING: a campaign/team rate is 'measured' only
//    when EVERY contributing user is fully measured; otherwise it is the
//    span-based figure for EVERYONE, labeled 'estimated'. Partial substitution
//    would blend two different instruments into one number nobody can defend.
//  · 'estimated' is not one state, it is FOUR, and a UI that cannot tell them
//    apart is unreadable: the org never connected, this person is not linked,
//    they were linked but never clocked in, or they clocked in and forgot to
//    clock out. Only the middle two are somebody's to fix, so `hoursReason`
//    names which one it is rather than making an admin guess from an absence.
//
// Which of the three wire figures a shift contributes is the connection's
// hourFigure setting, resolved here at read time — changing the setting
// re-labels every report on the next request, no re-sync. Per-shift figures
// arrive already rounded to 2dp (the provider's contract) and are summed
// already-rounded, because that is literally how the provider's own /hours
// computes its day totals — so a day here equals the timesheet, always.

const round2 = (n) => Math.round(n * 100) / 100;

/** Span hours for one user-day bucket (last − first), the legacy estimate. */
export const spanHours = (first, last) =>
  first && last ? Math.max(0, (new Date(last) - new Date(first)) / 3600000) : 0;

/**
 * Does this day's stale flag actually disqualify it? Only a day strictly
 * before today can be stale ("stale" MEANS open since an earlier day).
 * loadMeasuredHours already derives the flag exactly, so for overlay-built
 * entries this guard is redundant by construction — it stays for hand-built
 * fixtures and any caller composing its own overlay, where a flag without a
 * calendar keeps the conservative broad behavior: never narrow without having
 * looked at the calendar. Plain string comparison is correct: both sides are
 * 'YYYY-MM-DD'.
 */
export const staleDay = (m, day, today) =>
  Boolean(m?.isStale) && (!today || !day || day < today);

/** Is this measured row a usable denominator for its day? */
export const usableMeasuredDay = (m, day, today) =>
  Boolean(m) && m.hours > 0 && !staleDay(m, day, today);

/**
 * The measured-hours overlay for an org and date range (inclusive
 * 'YYYY-MM-DD' bounds; null = unbounded on that side), day-bucketed in `tz` —
 * the report's anchor zone, whatever it is. A shift is in range exactly when
 * its clockIn falls inside [from..to]'s UTC window in `tz`, because a shift
 * belongs entirely to the local day it started — so the range query and the
 * bucketing agree by definition, for ANY zone.
 *
 * enabled:false — org never connected, or connection errored/disconnected:
 * every caller then behaves exactly as before this feature existed.
 */
export async function loadMeasuredHours({ organizationId, from = null, to = null, tz }) {
  const none = {
    enabled: false,
    hourFigure: null,
    byUserDay: new Map(),
    daysByUser: new Map(),
    linkedUserIds: new Set(),
    today: null,
  };
  if (!organizationId || !tz) return none;

  const connection = await FbTimeConnection.findOne({ organizationId, status: 'connected' })
    .select('hourFigure')
    .lean();
  if (!connection) return none;

  const q = { organizationId, userId: { $ne: null } };
  if (from || to) {
    const window = zonedDayRange(from, to, tz);
    if (window.$gte || window.$lt) {
      q.clockIn = {};
      if (window.$gte) q.clockIn.$gte = window.$gte;
      if (window.$lt) q.clockIn.$lt = window.$lt;
    }
  }

  // The link set rides along with the hours because the two answer ONE question
  // between them ("why is this person estimated?") and a caller that had to load
  // links separately would be the caller that forgets to. Covered by the unique
  // {organizationId, userId} index, and it is a roster-sized read — one small
  // document per linked canvasser, not per shift.
  const [rows, links] = await Promise.all([
    FbTimeShift.find(q)
      .select('userId clockIn grossHours adjustedHours workedHours isOpen isManualEntry')
      .lean(),
    FbTimePersonLink.find({ organizationId }).select('userId').lean(),
  ]);

  // The calendar anchor, evaluated per request so it can never itself go
  // stale — and in the SAME zone the buckets below are built in.
  const today = zonedDayStr(new Date(), tz);

  const byUserDay = new Map();
  const daysByUser = new Map();
  for (const r of rows) {
    const uid = String(r.userId);
    const day = zonedDayStr(r.clockIn, tz);
    const key = `${uid}|${day}`;
    let entry = byUserDay.get(key);
    if (!entry) {
      entry = { hours: 0, isOpen: false, isStale: false, isManualEntry: false };
      byUserDay.set(key, entry);
      if (!daysByUser.has(uid)) daysByUser.set(uid, new Set());
      daysByUser.get(uid).add(day);
    }
    entry.hours += r[connection.hourFigure] ?? 0;
    entry.isOpen ||= Boolean(r.isOpen);
    entry.isManualEntry ||= Boolean(r.isManualEntry);
    // Exact staleness: THIS shift is open and started on an earlier local day
    // — a forgotten clock-out, so the whole day's denominator is untrusted.
    // (One runaway shift spoils its day even beside a clean one: a day is
    // usable or not as a whole, same rule as always.)
    if (r.isOpen && day < today) entry.isStale = true;
  }
  // Per-shift figures are 2dp; re-round each day's sum so float noise from the
  // addition never reaches a wire figure (the provider rounds its sums too).
  for (const entry of byUserDay.values()) entry.hours = round2(entry.hours);

  return {
    enabled: true,
    hourFigure: connection.hourFigure,
    byUserDay,
    daysByUser,
    linkedUserIds: new Set(links.map((l) => String(l.userId))),
    today,
  };
}

/**
 * WHY a row is not fully measured — null when it is (nothing to explain).
 *
 * Precedence is "who can act on it", outermost first: an org that never
 * connected has nothing to fix, an unlinked person is an admin's two-click fix
 * on the Integrations page, a stale shift is somebody's forgotten clock-out in
 * FbTime, and 'no-hours' is the residue that is usually just a day off.
 *
 * `linkedUserIds` absent (a caller that predates it) yields 'no-hours' rather
 * than 'not-linked': never accuse a mapping of being missing without having
 * looked at the mapping.
 */
const hoursReasonFor = ({ uid, measured, hoursSource, hasStaleShift }) => {
  if (hoursSource === 'measured') return null;
  if (!measured.enabled) return 'not-connected';
  const links = measured.linkedUserIds;
  if (links instanceof Set && !links.has(uid)) return 'not-linked';
  if (hasStaleShift) return 'stale-shift';
  return 'no-hours';
};

/**
 * Fold one user's per-day span rows together with the measured overlay.
 *
 * perDayRows: [{ day, spanHours }] — this user's knock-day buckets.
 * Returns hours + provenance for the row:
 *   { hoursOnDoors, hoursSource, hoursReason, measuredDays, estimatedDays,
 *     extraMeasuredDays, hasOpenShift, hasStaleShift, hasManualEntry }
 */
export function foldUserHours({ userId, perDayRows, measured }) {
  const uid = String(userId);
  let hours = 0;
  let measuredDays = 0;
  let estimatedDays = 0;
  let extraMeasuredDays = 0;
  let hasOpenShift = false;
  let hasStaleShift = false;
  let hasManualEntry = false;

  const knockDays = new Set();
  for (const d of perDayRows) {
    knockDays.add(d.day);
    const m = measured.enabled ? measured.byUserDay.get(`${uid}|${d.day}`) : null;
    if (usableMeasuredDay(m, d.day, measured.today)) {
      hours += m.hours;
      measuredDays += 1;
      hasOpenShift ||= m.isOpen;
      hasManualEntry ||= m.isManualEntry;
    } else {
      hours += d.spanHours;
      estimatedDays += 1;
      // staleDay, not the raw flag: the rolled-up flag feeds hoursReason
      // 'stale-shift', which must only ever name days that actually fell back.
      if (staleDay(m, d.day, measured.today)) hasStaleShift = true;
    }
  }

  // Measured days with no knocks: the clocked-but-not-knocking case. Hours in,
  // day NOT counted toward daysActive (that stays a knock-day count).
  if (measured.enabled) {
    for (const day of measured.daysByUser.get(uid) || []) {
      if (knockDays.has(day)) continue;
      const m = measured.byUserDay.get(`${uid}|${day}`);
      if (!usableMeasuredDay(m, day, measured.today)) continue;
      hours += m.hours;
      measuredDays += 1;
      extraMeasuredDays += 1;
      hasOpenShift ||= m.isOpen;
      hasManualEntry ||= m.isManualEntry;
    }
  }

  const hoursSource =
    measuredDays > 0 && estimatedDays === 0
      ? 'measured'
      : measuredDays > 0
        ? 'mixed'
        : 'estimated';

  return {
    hoursOnDoors: round2(hours),
    hoursSource,
    hoursReason: hoursReasonFor({ uid, measured, hoursSource, hasStaleShift }),
    measuredDays,
    estimatedDays,
    extraMeasuredDays,
    hasOpenShift,
    hasStaleShift,
    hasManualEntry,
  };
}

/**
 * The aggregate label. 'measured' only when every contributor is fully
 * measured (and there is at least one); anything less is 'estimated' — never
 * 'mixed', never a blend.
 */
export function aggregateSource(folds) {
  let any = false;
  for (const f of folds) {
    any = true;
    if (f.hoursSource !== 'measured') return 'estimated';
  }
  return any ? 'measured' : 'estimated';
}
