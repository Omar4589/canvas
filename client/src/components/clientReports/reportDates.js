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
 * The New report dialog's default period (§F10): the day after the series' last report, for that
 * report's length, ending no later than yesterday; with no earlier report, the seven days ending
 * yesterday. When the last report already reaches yesterday the period can only lie ahead, so it
 * keeps the report's length (the server accepts it; the builder says the period isn't over).
 *
 * After a long gap (§O4 "Continue's default period after a long gap is the current week"): when at
 * least one more whole stretch of that length would still be unreported after the natural next
 * period, it suggests the stretch ending yesterday instead, and returns the days it skips as
 * `skipped: { start, end }` so the dialog can say no report covers them. Otherwise the shape is
 * `{ weekStart, weekEnd, fromLast }`, as before. `today` is the campaign zone's civil day.
 */
export const defaultPeriod = ({ lastReport = null, today }) => {
  const yesterday = addDays(today, -1);
  if (!lastReport?.weekStart || !lastReport?.weekEnd) {
    return { weekStart: addDays(yesterday, -6), weekEnd: yesterday, fromLast: false };
  }
  const len = Math.max(1, periodDays(lastReport.weekStart, lastReport.weekEnd));
  const weekStart = addDays(lastReport.weekEnd, 1);
  const natural = addDays(weekStart, len - 1);
  if (daysBetween(natural, yesterday) >= len) {
    const start = addDays(yesterday, -(len - 1));
    return { weekStart: start, weekEnd: yesterday, fromLast: true, skipped: { start: weekStart, end: addDays(start, -1) } };
  }
  const weekEnd = daysBetween(natural, yesterday) >= 0 ? natural : daysBetween(weekStart, yesterday) >= 0 ? yesterday : natural;
  return { weekStart, weekEnd, fromLast: true };
};

/** Today's civil day in a zone. */
export const todayIn = (tz, now = new Date()) => dayInTz(now, tz) || `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
