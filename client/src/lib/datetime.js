// Format instants in a FIXED IANA timezone (the campaign's / org's), so every admin —
// whatever their own device timezone — sees the same clock time, with a short label
// (CDT/CST/EST…). Falls back to viewer-local if no tz is given.

export function tzAbbrev(tz, at = new Date()) {
  if (!tz) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(at);
    return parts.find((p) => p.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
}

const DEFAULT_OPTS = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };

// e.g. formatInTz(iso, 'America/Chicago') -> "Jun 3, 2:01 PM CDT"
export function formatInTz(instant, tz, opts = DEFAULT_OPTS, withLabel = true) {
  if (!instant) return '';
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return '';
  if (!tz) return d.toLocaleString(undefined, opts);
  const base = new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tz }).format(d);
  const hasTime = opts.hour || opts.minute || opts.second;
  return withLabel && hasTime ? `${base} ${tzAbbrev(tz, d)}` : base;
}

// Date only, no time/label, in tz. e.g. "Jun 3, 2026"
export function formatDateInTz(instant, tz) {
  return formatInTz(instant, tz, { month: 'short', day: 'numeric', year: 'numeric' }, false);
}
