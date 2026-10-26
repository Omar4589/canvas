// Report weeks and the period after a report (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §C). ONE definition
// in two copies: this file (Next report, the series picker, `npm run report:tab-weeks`) and
// client/src/components/clientReports/reportDates.js (New report's date choices). Both run one fixture
// table, server/test/fixtures/reportPeriods.json — server/test/reportPeriods.test.js here,
// client/src/lib/reportPeriods.parity.test.js there — so a change to one copy fails the other's test until
// the two say the same thing again (the bookStatusFilter.js pattern).
//
// Pure functions on civil 'YYYY-MM-DD' days in the campaign's zone. The weekday is Date.UTC's, so nothing
// here reads a clock or a time zone: a DST week is seven days like any other, and "today" is always passed
// in (the caller's campaign-zone day). `s` is the organization's report week start, 0 = Sunday … 6 =
// Saturday (Organization.reportWeekStartsOn, Monday unless an admin changes it).

const partsOf = (ymd) => {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  return y && m && d ? { y, m, d } : null;
};

// The client's addDays / daysBetween / periodDays, character for character (reportDates.js), so the two
// copies can't disagree about a day.
const addDays = (ymd, n) => {
  const p = partsOf(ymd);
  if (!p) return ymd;
  return new Date(Date.UTC(p.y, p.m - 1, p.d + n)).toISOString().slice(0, 10);
};
const daysBetween = (a, b) => {
  const x = partsOf(a);
  const y = partsOf(b);
  if (!x || !y) return 0;
  return Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / 86400000);
};
const periodDays = (start, end) => daysBetween(start, end) + 1;

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
 * mid-week, so it is never a whole number of weeks. Also the New report nudge's "Move this tab to Monday –
 * Sunday weeks", which is this catch-up for a tab whose weeks run on another weekday.
 */
export const catchUpPeriod = (last, s, today) => {
  const weekStart = addDays(last.weekEnd, 1);
  const endOfLastWeek = addDays(weekStartOf(today, s), -1);
  return daysBetween(weekStart, endOfLastWeek) >= 0
    ? { weekStart, weekEnd: endOfLastWeek, kind: 'catch_up', branch: 'last_week' }
    : { weekStart, weekEnd: weekEndOf(weekStart, s), kind: 'catch_up', branch: 'this_week' };
};

/**
 * The period after report `last` ({ weekStart, weekEnd }) — Next report's period and New report's first
 * choice before its long-gap rule (§C). Every rule starts the day after `last`, so Next's
 * NEXT_PERIOD_MISMATCH contiguity check always holds.
 *   1. N whole calendar months → the next N months (a month → the next month, a quarter → the next quarter).
 *   2. A whole number of weeks, on any weekday → the same length again (a Sunday-to-Saturday series carries
 *      on Sunday-to-Saturday).
 *   3a. Any other length that ended on a report week's end → one report week. Without it a catch-up made
 *      a week late came out 14 days and rule 2 repeated 14 days for ever (§I round 2).
 *   3b. Any other length → the catch-up (catchUpPeriod), so the report after it is a normal week. This is
 *      what ends the "Oct 14 – Oct 26" reports, which came from copying the last report's length.
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

/** Next report refuses a catch-up longer than this (409 NEXT_GAP_TOO_LONG); New report suggests last week instead. */
export const CATCH_UP_MAX_DAYS = 14;

/**
 * New report's first choice (§C). With no earlier report in the tab: last week — or this week when the
 * campaign has no knock before this week began (`knockedBeforeThisWeek === false`, from the series picker),
 * so a new campaign's first report is never an empty last week. Otherwise nextPeriod, then the long-gap rule
 * on the series' own cadence, where a run is COMPLETE when its last day is before today:
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

// ── Server only (not in the client copy) ──────────────────────────────────────────────────────────────

/**
 * An organization's report week start, 0–6. Monday (1) for an organization saved before the setting
 * existed (no migration, §C) — and for anything out of range, so a stray value can never turn into
 * nonsense dates.
 */
export const reportWeekStartsOnOf = (org) => {
  const s = org?.reportWeekStartsOn ?? 1;
  return Number.isInteger(s) && s >= 0 && s <= 6 ? s : 1;
};
