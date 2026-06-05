// Timezone helpers for anchoring report windows + day buckets to a fixed IANA zone
// (the campaign's / org's timezone) so every viewer sees identical numbers and times,
// regardless of their own device timezone. Uses the built-in Intl API — DST-aware,
// no dependency.

// The UTC instant for a given wall-clock time (Y-M-D H:M:S) in `tz`. Works by asking
// Intl what wall time `tz` shows for a UTC guess, measuring the offset, and undoing it.
// (US day boundaries are at local midnight, which always exists — DST shifts happen at
// 2am — so there's no spring-forward gap to worry about for day windows.)
export function zonedTimeToUtc(y, mo, d, h, mi, s, tz) {
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, s);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcGuess));
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  let hh = Number(map.hour);
  if (hh === 24) hh = 0; // some environments render midnight as '24'
  const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hh, Number(map.minute), Number(map.second));
  const offset = asUtc - utcGuess; // how far ahead of UTC `tz` is at this instant
  return new Date(utcGuess - offset);
}

// Inclusive-from / exclusive-to UTC window for the local days [fromDay .. toDay] in
// `tz`. Inputs are date-only 'YYYY-MM-DD' (or null). A single day (from==to) yields a
// full 24h window (the bug we're fixing). Returns {} | { $gte } | { $lt } | both.
export function zonedDayRange(fromDay, toDay, tz) {
  const range = {};
  if (fromDay) {
    const [y, m, d] = String(fromDay).split('-').map(Number);
    if (y && m && d) range.$gte = zonedTimeToUtc(y, m, d, 0, 0, 0, tz);
  }
  if (toDay) {
    const [y, m, d] = String(toDay).split('-').map(Number);
    if (y && m && d) range.$lt = zonedTimeToUtc(y, m, d + 1, 0, 0, 0, tz); // start of the day AFTER → exclusive
  }
  return range;
}

// Short timezone label (e.g. 'CDT' / 'CST') for `tz` at a given instant (DST-aware).
export function tzAbbrev(tz, at = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(at);
    const p = parts.find((x) => x.type === 'timeZoneName');
    return p ? p.value : '';
  } catch {
    return '';
  }
}

// 'YYYY-MM-DD' for an instant as seen in `tz` (for server-side day grouping that must
// match the Mongo $dateToString buckets).
export function zonedDayStr(instant, tz) {
  // en-CA gives YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant instanceof Date ? instant : new Date(instant));
}
