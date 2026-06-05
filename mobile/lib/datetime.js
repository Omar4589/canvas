// Shared time formatters. Use everywhere so audit timestamps look the same.
//
// Functions take an optional `tz` (IANA, the campaign's): when given, the time is
// formatted in THAT zone with its short label (CDT/CST…), so every admin sees the
// same clock time regardless of their own device timezone. Omit `tz` for the
// device-local personal lens (unchanged behavior).

export function tzAbbrev(tz, at = new Date()) {
  if (!tz) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(at);
    return parts.find((p) => p.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
}

// e.g. formatInTz(iso, 'America/Chicago') -> "Jun 3, 2:01 PM CDT"
export function formatInTz(instant, tz, opts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, withLabel = true) {
  if (!instant) return '';
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return '';
  if (!tz) return d.toLocaleString(undefined, opts);
  const base = new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tz }).format(d);
  const hasTime = opts.hour || opts.minute || opts.second;
  return withLabel && hasTime ? `${base} ${tzAbbrev(tz, d)}` : base;
}

export function timeAgo(date) {
  if (!date) return '';
  const ms = Date.now() - new Date(date).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

// Audit-grade absolute timestamp, e.g. "May 1, 2026 · 3:42:18 PM CDT". Pass `tz` (the
// campaign's) to anchor it; omit for device-local.
export function formatExact(date, tz) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const z = tz ? { timeZone: tz } : {};
  const datePart = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', ...z }).format(d);
  const timePart = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    ...z,
  }).format(d);
  return `${datePart} · ${timePart}`;
}

// Compact "shift range" display (first → last door). Pass `tz` to anchor + label it.
// Same day: "8:32 AM – 11:47 AM CDT"
// Multi-day: "May 1, 8:32 AM – May 5, 6:00 PM CDT"
export function formatRange(first, last, tz) {
  if (!first && !last) return '';
  const f = first ? new Date(first) : null;
  const l = last ? new Date(last) : null;
  if (f && Number.isNaN(f.getTime())) return '';
  if (l && Number.isNaN(l.getTime())) return '';

  const z = tz ? { timeZone: tz } : {};
  const fmtTime = (d) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', ...z }).format(d);
  const fmtDate = (d) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...z }).format(d);
  const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...z }).format(d);
  const todayKey = dayKey(new Date());

  function part(d) {
    if (dayKey(d) === todayKey) return fmtTime(d);
    return `${fmtDate(d)}, ${fmtTime(d)}`;
  }

  let out;
  if (!l || (f && f.getTime() === l.getTime())) out = part(f || l);
  else if (!f) out = part(l);
  else out = `${part(f)} – ${part(l)}`;
  return tz ? `${out} ${tzAbbrev(tz, l || f)}` : out;
}
