// Civil-date helpers for the Client Reports pages. A report's period is two 'YYYY-MM-DD' days in the
// campaign's time zone, and the client only ever reads civil dates (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md
// §F0), so everything here is calendar arithmetic in UTC — never the viewer's clock — and labels are
// formatted with timeZone 'UTC' so a behind-UTC browser can never shift a day.

const pad = (n) => String(n).padStart(2, '0');

const partsOf = (ymd) => {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  return y && m && d ? { y, m, d } : null;
};

/** 'YYYY-MM-DD' + n calendar days. */
export const addDays = (ymd, n) => {
  const p = partsOf(ymd);
  if (!p) return ymd;
  return new Date(Date.UTC(p.y, p.m - 1, p.d + n)).toISOString().slice(0, 10);
};

/** Whole calendar days from a to b (b − a). A DST week is still 7 days apart. */
export const daysBetween = (a, b) => {
  const x = partsOf(a);
  const y = partsOf(b);
  if (!x || !y) return 0;
  return Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / 86400000);
};

/** How many days a period covers, both ends included. */
export const periodDays = (start, end) => daysBetween(start, end) + 1;

/** An instant's civil day in a time zone ('YYYY-MM-DD'). */
export const dayInTz = (instant, tz) => {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
};

/** 'YYYY-MM-DD' → 'Oct 21' (or 'Oct 21, 2026' with `year`). */
export const formatCivil = (ymd, { year = false } = {}) => {
  const p = partsOf(ymd);
  if (!p) return ymd || '';
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(year ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
};

/**
 * A period as people read it: 'Oct 13 – Oct 19', one day as 'Oct 13', and the year on both sides only
 * when the period crosses one ('Dec 29, 2025 – Jan 4, 2026').
 */
export const formatPeriod = (start, end) => {
  if (!start && !end) return '';
  if (!end || start === end) return formatCivil(start);
  if (!start) return formatCivil(end);
  const crossYear = String(start).slice(0, 4) !== String(end).slice(0, 4);
  return `${formatCivil(start, { year: crossYear })} – ${formatCivil(end, { year: crossYear })}`;
};

/** An instant as a date in the report's zone: 'Oct 21'. */
export const formatDayOf = (instant, tz) => {
  const day = instant ? dayInTz(instant, tz) : null;
  return day ? formatCivil(day) : '';
};

/**
 * The days no report covers between two consecutive reports of a series (newer first, as the list
 * shows them), or null when they touch or overlap. About dates only: nothing is said about days after
 * the newest report (§F10 "never days not yet reported").
 */
export const gapBetween = (newer, older) => {
  if (!newer?.weekStart || !older?.weekEnd) return null;
  const start = addDays(older.weekEnd, 1);
  const end = addDays(newer.weekStart, -1);
  return daysBetween(start, end) >= 0 ? { start, end } : null;
};

/**
 * The days no dated report of a tab covers, as a Map of report id → { start, end }: each gap keyed by the
 * report whose days run up to it, so the list draws the line just above that report's row. Worked out
 * over all the tab's dated reports in start order, against the furthest last day so far — never row by
 * row: listed by last day, a report beside another isn't always what covers the days before it (a month
 * with a week inside it). All-time reports (SIMPLIFY §N) never make or close a gap: the lines are about
 * the days the dated reports skipped.
 */
export const gapsAbove = (reports = []) => {
  const out = new Map();
  // Where each report sits in the list: of two that end the same day, the line goes above the one listed
  // first, so it sits right under the reports after the gap (code review).
  const at = new Map(reports.map((r, i) => [r, i]));
  const dated = reports
    .filter((r) => !r.allTime && r.weekStart && r.weekEnd)
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0));
  let coverer = null;
  for (const r of dated) {
    const gap = coverer ? gapBetween(r, coverer) : null;
    if (gap) out.set(coverer.id, gap);
    if (!coverer || r.weekEnd > coverer.weekEnd || (r.weekEnd === coverer.weekEnd && at.get(r) < at.get(coverer))) coverer = r;
  }
  return out;
};

/** Today's civil day in a zone. */
export const todayIn = (tz, now = new Date()) => dayInTz(now, tz) || `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;

// ── Report weeks and the period after a report (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §C) ─────────────
// ONE definition in two copies: this block and server/src/services/reports/reportPeriods.js (Next report,
// the series picker). Both run one fixture table, server/test/fixtures/reportPeriods.json — here through
// client/src/lib/reportPeriods.parity.test.js — so a change to one copy fails until the other matches it.
// `s` is the organization's report week start, 0 = Sunday … 6 = Saturday (Monday unless an admin changes
// it); `today` is the campaign zone's civil day, never the viewer's.

// Months as one running number (year × 12 + month − 1), so "N months on" is plain addition.
const monthNumberOf = (ymd) => {
  const p = partsOf(ymd);
  return p ? p.y * 12 + p.m - 1 : 0;
};
const firstOfMonthNumber = (n) => new Date(Date.UTC(Math.floor(n / 12), n % 12, 1)).toISOString().slice(0, 10);
const lastOfMonthNumber = (n) => new Date(Date.UTC(Math.floor(n / 12), (n % 12) + 1, 0)).toISOString().slice(0, 10);

/** The weekday of a civil day: 0 = Sunday … 6 = Saturday. */
export const dayOfWeek = (day) => {
  const p = partsOf(day);
  return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() : 0;
};

/** The first day of the report week holding `day`. */
export const weekStartOf = (day, s) => addDays(day, -((dayOfWeek(day) - s + 7) % 7));

/** The last day of the report week holding `day`. */
export const weekEndOf = (day, s) => addDays(weekStartOf(day, s), 6);

/** The most recent full report week: on a Monday (s = 1), the Monday-to-Sunday just ended. */
export const lastWeek = (today, s) => {
  const weekStart = addDays(weekStartOf(today, s), -7);
  return { weekStart, weekEnd: addDays(weekStart, 6) };
};

/** The whole current report week, today included — "This week, not over yet". */
export const thisWeek = (today, s) => {
  const weekStart = weekStartOf(today, s);
  return { weekStart, weekEnd: addDays(weekStart, 6) };
};

/**
 * N ≥ 1 when start … end is N whole calendar months (starts on a month's first day, ends on a month's
 * last day), else 0. A February that is also four aligned weeks is a month (§C rule 1 is checked first).
 */
export const wholeMonthsOf = (start, end) => {
  const a = partsOf(start);
  if (!a || a.d !== 1 || !partsOf(end) || addDays(end, 1).slice(8) !== '01') return 0;
  const months = monthNumberOf(end) - monthNumberOf(start) + 1;
  return months >= 1 ? months : 0;
};

/**
 * §C rule 3b on its own: from the day after `last` to the end of the last complete report week — or, when
 * `last` already reaches into this week, to the end of the week that day falls in. It always starts
 * mid-week, so it is never a whole number of weeks. Also the nudge's "Move this tab to Monday – Sunday
 * weeks", which is this catch-up for a tab whose weeks run on another weekday.
 */
export const catchUpPeriod = (last, s, today) => {
  const weekStart = addDays(last.weekEnd, 1);
  const endOfLastWeek = addDays(weekStartOf(today, s), -1);
  return daysBetween(weekStart, endOfLastWeek) >= 0
    ? { weekStart, weekEnd: endOfLastWeek, kind: 'catch_up', branch: 'last_week' }
    : { weekStart, weekEnd: weekEndOf(weekStart, s), kind: 'catch_up', branch: 'this_week' };
};

/**
 * The period after report `last` ({ weekStart, weekEnd }) — New report's first choice before its long-gap
 * rule, and exactly what Next report makes (§C):
 *   1. N whole calendar months → the next N months (a month → the next month, a quarter → the next quarter).
 *   2. A whole number of weeks, on any weekday → the same length again.
 *   3a. Any other length that ended on a report week's end → one report week.
 *   3b. Any other length → the catch-up (catchUpPeriod); the report after it is a normal week.
 */
export const nextPeriod = (last, s, today) => {
  const weekStart = addDays(last.weekEnd, 1);
  const months = wholeMonthsOf(last.weekStart, last.weekEnd);
  if (months) return { weekStart, weekEnd: lastOfMonthNumber(monthNumberOf(weekStart) + months - 1), kind: 'months', months };
  const len = Math.max(1, periodDays(last.weekStart, last.weekEnd)); // a report always has a day; never divide by 0 weeks
  if (len % 7 === 0) return { weekStart, weekEnd: addDays(weekStart, len - 1), kind: 'weeks', weeks: len / 7 };
  if (weekStartOf(weekStart, s) === weekStart) return { weekStart, weekEnd: addDays(weekStart, 6), kind: 'weeks', weeks: 1 };
  return catchUpPeriod(last, s, today);
};

/** Next report refuses a catch-up longer than this (NEXT_GAP_TOO_LONG); New report suggests last week instead. */
export const CATCH_UP_MAX_DAYS = 14;

/**
 * New report's first choice (§C). With no earlier report in the tab: last week — or this week when the
 * campaign has no knock before this week began (`knockedBeforeThisWeek === false`, from the series picker).
 * Otherwise nextPeriod, then the long-gap rule on the series' own cadence, where a run is COMPLETE when its
 * last day is before today:
 *   · weeks and months — the grid is the series' runs continued (every 7·weeks days, or every N months, from
 *     the next period); when at least one more complete run lies on it after the next period, the most
 *     recent complete run, and `skipped` names the days no report covers;
 *   · a catch-up longer than CATCH_UP_MAX_DAYS — last week, and `skipped` the days before it.
 * A first choice that ends after today is kept (the builder says the period isn't over).
 * Returns { weekStart, weekEnd, kind: 'weeks'|'months'|'catch_up'|'last_week'|'this_week', weeks?, months?,
 * branch?, longGap, skipped: { start, end } | null, equalsLastWeek }.
 */
export const suggestPeriod = ({ last = null, s, today, knockedBeforeThisWeek } = {}) => {
  const recent = lastWeek(today, s);
  const choice = (period, skipped = null) => ({
    ...period,
    longGap: !!skipped,
    skipped,
    equalsLastWeek: period.weekStart === recent.weekStart && period.weekEnd === recent.weekEnd,
  });
  if (!last?.weekStart || !last?.weekEnd) {
    return knockedBeforeThisWeek === false ? choice({ ...thisWeek(today, s), kind: 'this_week' }) : choice({ ...recent, kind: 'last_week' });
  }
  const next = nextPeriod(last, s, today);
  if (next.kind === 'weeks') {
    const len = 7 * next.weeks;
    const complete = Math.floor(daysBetween(next.weekStart, today) / len); // complete runs on the grid, the next period first
    if (complete < 2) return choice(next);
    const weekStart = addDays(next.weekStart, (complete - 1) * len);
    return choice({ weekStart, weekEnd: addDays(weekStart, len - 1), kind: 'weeks', weeks: next.weeks }, { start: next.weekStart, end: addDays(weekStart, -1) });
  }
  if (next.kind === 'months') {
    const first = monthNumberOf(next.weekStart);
    const complete = Math.floor((monthNumberOf(today) - first) / next.months);
    if (complete < 2) return choice(next);
    const from = first + (complete - 1) * next.months;
    const weekStart = firstOfMonthNumber(from);
    return choice({ weekStart, weekEnd: lastOfMonthNumber(from + next.months - 1), kind: 'months', months: next.months }, { start: next.weekStart, end: addDays(weekStart, -1) });
  }
  if (periodDays(next.weekStart, next.weekEnd) <= CATCH_UP_MAX_DAYS) return choice(next);
  return choice({ ...recent, kind: 'last_week' }, { start: next.weekStart, end: addDays(recent.weekStart, -1) });
};
