import { FbTimeConnection } from '../../models/FbTimeConnection.js';
import { FbTimeDailyHours } from '../../models/FbTimeDailyHours.js';
import { FbTimePersonLink } from '../../models/FbTimePersonLink.js';
import { zonedDayStr } from '../../utils/timezone.js';

// Where an hours denominator comes from: measured (FbTime) or estimated (the
// first-to-last knock span). THE resolver, in the billRestricted.js sense —
// report routes ask this module and never read FbTimeConnection or
// FbTimeDailyHours directly, so the rules below hold everywhere or nowhere.
//
// THE RULES (owner-ruled + provider contract; see docs/FBTIME_INTEGRATION.md):
//
//  · Per user-day: use the measured row where one exists AND is usable —
//    hours > 0 (a zero denominator reads as an infinite rate) and not stale
//    (an open shift from an earlier day is a forgotten clock-out, not a
//    30-hour shift; that day falls back to the span and keeps its flag).
//    Absence of a row is NEVER zero hours — it means "not measured, estimate".
//  · STALENESS ONLY REACHES BACKWARD: sync writes isStale broad
//    (person.hasStaleShift && day.hasOpenShift — the provider names the person,
//    never the shift), so someone with an old forgotten clock-out who is on the
//    clock right now gets TODAY's healthy row flagged too. Narrowed here at
//    read time, not at sync: shifts belong entirely to the day they started
//    (FbTimeDailyHours.day), so a runaway shift can never contaminate another
//    day's row — and "stale" MEANS open since an earlier day, so today's open
//    shift is just open. Read time, because a "today" baked into a cached row
//    goes wrong at midnight and freezes wrong when sync errors.
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
// Which of the three wire figures a measured row contributes is the
// connection's hourFigure setting, resolved here at read time — changing the
// setting re-labels every report on the next request, no re-sync.

const round2 = (n) => Math.round(n * 100) / 100;

/** Span hours for one user-day bucket (last − first), the legacy estimate. */
export const spanHours = (first, last) =>
  first && last ? Math.max(0, (new Date(last) - new Date(first)) / 3600000) : 0;

/**
 * Does this row's stale flag actually disqualify THIS day? Only a day strictly
 * before today can be stale (see the STALENESS ONLY REACHES BACKWARD rule
 * above). No `today` (a legacy caller or fixture) keeps the old broad
 * behavior — never narrow without having looked at the calendar. Plain string
 * comparison is correct: both sides are 'YYYY-MM-DD'.
 */
export const staleDay = (m, day, today) =>
  Boolean(m?.isStale) && (!today || !day || day < today);

/** Is this measured row a usable denominator for its day? */
export const usableMeasuredDay = (m, day, today) =>
  Boolean(m) && m.hours > 0 && !staleDay(m, day, today);

/**
 * The measured-hours overlay for an org and date range (inclusive
 * 'YYYY-MM-DD' bounds; null = unbounded on that side).
 *
 * enabled:false — org never connected, or connection errored/disconnected:
 * every caller then behaves exactly as before this feature existed.
 *
 * The tz filter is the bucket-alignment guard: rows are stamped with the zone
 * they were pulled under (the org's), and a report anchored to a DIFFERENT
 * zone (a campaign whose timeZone differs from the org's) must not join
 * hours-days against knock-days bucketed differently — those requests simply
 * see no measured rows and stay estimated, which is honest. Documented in
 * docs/FBTIME_INTEGRATION.md.
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

  const q = { organizationId, userId: { $ne: null }, timeZone: tz };
  if (from || to) {
    q.day = {};
    if (from) q.day.$gte = from;
    if (to) q.day.$lte = to;
  }

  // The link set rides along with the hours because the two answer ONE question
  // between them ("why is this person estimated?") and a caller that had to load
  // links separately would be the caller that forgets to. Covered by the unique
  // {organizationId, userId} index, and it is a roster-sized read — one small
  // document per linked canvasser, not per day.
  const [rows, links] = await Promise.all([
    FbTimeDailyHours.find(q)
      .select('userId day grossHours adjustedHours workedHours isOpen isStale isManualEntry')
      .lean(),
    FbTimePersonLink.find({ organizationId }).select('userId').lean(),
  ]);

  const byUserDay = new Map();
  const daysByUser = new Map();
  for (const r of rows) {
    const uid = String(r.userId);
    byUserDay.set(`${uid}|${r.day}`, {
      hours: r[connection.hourFigure] ?? 0,
      isOpen: Boolean(r.isOpen),
      isStale: Boolean(r.isStale),
      isManualEntry: Boolean(r.isManualEntry),
    });
    if (!daysByUser.has(uid)) daysByUser.set(uid, new Set());
    daysByUser.get(uid).add(r.day);
  }

  return {
    enabled: true,
    hourFigure: connection.hourFigure,
    byUserDay,
    daysByUser,
    linkedUserIds: new Set(links.map((l) => String(l.userId))),
    // The calendar anchor for staleDay, in the SAME zone the rows were bucketed
    // under — evaluated per request, so it can never itself go stale.
    today: zonedDayStr(new Date(), tz),
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
