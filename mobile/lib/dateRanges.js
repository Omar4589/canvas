// Date-range presets computed in a FIXED anchor timezone (the campaign's) — NEVER the
// device clock. Every builder takes `tz` and returns **date-only** 'YYYY-MM-DD' bounds
// (or null = open); the server interprets those days in the same anchor tz, so "Yesterday"
// means the campaign's yesterday for an admin in any timezone. `from`/`to` are BOTH
// inclusive days (the server window covers the whole `to` day). Mirrors the web
// client/src/lib/datePresets.js.

export const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom' },
];

// Current date in `tz` as 'YYYY-MM-DD'. `now` is injectable so the day roll can be tested; every
// existing caller passes only `tz`.
export function todayInTz(tz, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// The range a screen should actually query: 'today' pinned to the CURRENT today, so a screen left
// open past midnight doesn't quietly widen into yesterday-plus-today under a "Today" label (the
// rangeFor('today') value is { from: <the day it was made>, to: null }). The same rule the Timeline
// applies with its fromDay. Every other preset, and a custom range, comes back unchanged.
export const effectiveRange = (range, today) =>
  range?.preset === 'today' && today && range.from !== today ? { ...range, from: today } : range;

// Add n calendar days to a 'YYYY-MM-DD' via UTC math (no tz/DST drift).
export function shiftDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function dayOfWeek(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

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
  return { from: null, to: null };
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
    return { from: shiftDays(thisMon, -7), to: shiftDays(thisMon, -1) };
  }
  if (key === 'thisMonth') return { from: firstOfMonth(today), to: null };
  if (key === 'lastMonth') {
    const lastDayPrev = shiftDays(firstOfMonth(today), -1);
    return { from: firstOfMonth(lastDayPrev), to: lastDayPrev };
  }
  return { from: null, to: null };
}

// Parse a date-only 'YYYY-MM-DD' as a LOCAL Date for display (avoids the UTC-midnight
// off-by-one in behind-UTC zones).
function ymdToLocal(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function labelForRange({ preset, from, to }) {
  const p = PRESETS.find((x) => x.key === preset);
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

// Best-guess IANA timezone of the device (kept for any non-anchored uses).
export function deviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
