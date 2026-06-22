// Date-range presets computed in a FIXED anchor timezone (the campaign's, or the org's
// for org-wide views) — NEVER the viewer's device clock. Every builder takes `tz` and
// returns **date-only** 'YYYY-MM-DD' bounds (or null = open); the server interprets those
// days in the same anchor tz, so "Yesterday" means the campaign's yesterday for every
// admin in any timezone. `from`/`to` are BOTH inclusive days (the server window covers
// the whole `to` day).

export const RANGE_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
];

// Current date in `tz` as 'YYYY-MM-DD' (en-CA gives ISO order).
export function todayInTz(tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Add n calendar days to a 'YYYY-MM-DD' using UTC math (pure calendar arithmetic, no tz/DST drift).
export function shiftDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Day of week (0=Sun..6=Sat) for a 'YYYY-MM-DD'.
function dayOfWeek(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// First day of the month containing `ymd`.
function firstOfMonth(ymd) {
  const [y, m] = ymd.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

export function rangeFor(preset, custom, tz) {
  const today = todayInTz(tz);
  if (preset === 'today') return { from: today, to: null };
  if (preset === 'yesterday') {
    const y = shiftDays(today, -1);
    return { from: y, to: y };
  }
  if (preset === '7d') return { from: shiftDays(today, -6), to: null };
  if (preset === '30d') return { from: shiftDays(today, -29), to: null };
  if (preset === 'custom' && custom) return { from: custom.from || null, to: custom.to || null };
  return { from: null, to: null }; // all
}

// Quick chips inside the custom picker (Monday-as-week-start).
export function quickRangeFor(key, tz) {
  const today = todayInTz(tz);
  if (key === 'thisWeek') {
    const back = (dayOfWeek(today) + 6) % 7;
    return { from: shiftDays(today, -back), to: null };
  }
  if (key === 'lastWeek') {
    const back = (dayOfWeek(today) + 6) % 7;
    const thisMon = shiftDays(today, -back);
    return { from: shiftDays(thisMon, -7), to: shiftDays(thisMon, -1) }; // last Mon..last Sun
  }
  if (key === 'thisMonth') return { from: firstOfMonth(today), to: null };
  if (key === 'lastMonth') {
    const lastDayPrev = shiftDays(firstOfMonth(today), -1);
    return { from: firstOfMonth(lastDayPrev), to: lastDayPrev };
  }
  return { from: null, to: null };
}

// Initialize page state in one line. `tz` is the anchor (campaign/org) timezone.
export function defaultRange(preset, tz) {
  return { preset, ...rangeFor(preset, undefined, tz) };
}

// Parse a date-only 'YYYY-MM-DD' as a LOCAL Date for display (avoids the UTC-midnight
// off-by-one that `new Date('2026-06-04')` causes in behind-UTC zones).
export function ymdToLocal(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Format a single 'YYYY-MM-DD' day as 'Jun 1, 2026'. Falls back to the raw string if unparseable.
export function formatDay(ymd) {
  const d = ymdToLocal(ymd);
  if (isNaN(d)) return ymd || '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Format a report week (two 'YYYY-MM-DD' days) as a human range — what clients read instead of
// '2026-05-31 → 2026-06-13'. Same day → one date; same year → the year is shown once at the end
// ('May 31 – Jun 13, 2026'); cross-year → the year is shown on both sides
// ('Dec 29, 2025 – Jan 4, 2026'); a missing side → the present day alone; unparseable → 'start – end'.
export function formatWeekRange(start, end) {
  if (start && !end) return formatDay(start);
  if (end && !start) return formatDay(end);
  if (!start && !end) return '';
  const s = ymdToLocal(start);
  const e = ymdToLocal(end);
  if (isNaN(s) || isNaN(e)) return `${start} – ${end}`;
  if (s.toDateString() === e.toDateString()) return formatDay(start);
  const withYear = { month: 'short', day: 'numeric', year: 'numeric' };
  const noYear = { month: 'short', day: 'numeric' };
  const sameYear = s.getFullYear() === e.getFullYear();
  return `${s.toLocaleDateString(undefined, sameYear ? noYear : withYear)} – ${e.toLocaleDateString(undefined, withYear)}`;
}

// Title fallback for a report with no custom title, e.g. 'Week of May 31'. (The full range with the
// year is shown separately as a subtitle, so this stays terse.)
export function weekOfTitle(start) {
  const d = ymdToLocal(start);
  if (isNaN(d)) return start ? `Week of ${start}` : 'Weekly report';
  return `Week of ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export function labelForRange({ preset, from, to }) {
  const p = RANGE_PRESETS.find((x) => x.id === preset);
  if (p && preset !== 'custom') return p.label;
  if (preset === 'custom') {
    const opts = { month: 'short', day: 'numeric' };
    const f = from ? ymdToLocal(from) : null;
    const t = to ? ymdToLocal(to) : null;
    if (f && t) {
      const same = f.toDateString() === t.toDateString();
      if (same) return f.toLocaleDateString(undefined, opts);
      return `${f.toLocaleDateString(undefined, opts)} – ${t.toLocaleDateString(undefined, opts)}`;
    }
    if (f) return `Since ${f.toLocaleDateString(undefined, opts)}`;
    if (t) return `Until ${t.toLocaleDateString(undefined, opts)}`;
  }
  return 'All time';
}
