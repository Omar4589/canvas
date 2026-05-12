// Shared date-range presets and helpers.
//
// Every screen that filters by date (admin leaderboard, canvasser drilldown,
// activity feed, etc.) must use these so the boundaries are consistent.
// `from` is inclusive, `to` is exclusive (matches the existing leaderboard).
// A null bound means "no lower/upper limit".

export const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom' },
];

export function rangeFor(preset, custom) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  if (preset === 'today') {
    return { from: start.toISOString(), to: null };
  }
  if (preset === 'yesterday') {
    const yStart = new Date(start);
    yStart.setDate(yStart.getDate() - 1);
    return { from: yStart.toISOString(), to: start.toISOString() };
  }
  if (preset === '7d') {
    const s = new Date(start);
    s.setDate(s.getDate() - 6);
    return { from: s.toISOString(), to: null };
  }
  if (preset === '30d') {
    const s = new Date(start);
    s.setDate(s.getDate() - 29);
    return { from: s.toISOString(), to: null };
  }
  if (preset === 'all') {
    return { from: null, to: null };
  }
  if (preset === 'custom' && custom) {
    return { from: custom.from || null, to: custom.to || null };
  }
  return { from: null, to: null };
}

export function labelForRange({ preset, from, to }) {
  const p = PRESETS.find((x) => x.key === preset);
  if (p && preset !== 'custom') return p.label;
  if (preset === 'custom') {
    const f = from ? new Date(from) : null;
    const t = to ? new Date(to) : null;
    const opts = { month: 'short', day: 'numeric' };
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

// Quick chips inside the custom picker.
export function quickRangeFor(key) {
  const now = new Date();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (key === 'thisWeek') {
    // Monday-as-week-start
    const day = (start.getDay() + 6) % 7;
    const s = new Date(start);
    s.setDate(s.getDate() - day);
    return { from: s.toISOString(), to: null };
  }
  if (key === 'lastWeek') {
    const day = (start.getDay() + 6) % 7;
    const sThisMon = new Date(start);
    sThisMon.setDate(sThisMon.getDate() - day);
    const sLastMon = new Date(sThisMon);
    sLastMon.setDate(sLastMon.getDate() - 7);
    return { from: sLastMon.toISOString(), to: sThisMon.toISOString() };
  }
  if (key === 'thisMonth') {
    const s = new Date(start.getFullYear(), start.getMonth(), 1);
    return { from: s.toISOString(), to: null };
  }
  if (key === 'lastMonth') {
    const s = new Date(start.getFullYear(), start.getMonth() - 1, 1);
    const e = new Date(start.getFullYear(), start.getMonth(), 1);
    return { from: s.toISOString(), to: e.toISOString() };
  }
  return { from: null, to: null };
}

// Best-guess IANA timezone (modern RN supports Intl.DateTimeFormat).
export function deviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
