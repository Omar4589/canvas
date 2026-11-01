import { tzAbbrev } from './timezone.js';

// The `--since=` argument of the read-only console checks (audit:gps-stamps, audit:phone-clocks): a bare
// date (00:00 UTC that day) or a full time with its UTC offset.
const SINCE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/;
const NO_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

// The owner types times in Central, whose offset changes twice a year: the example names today's.
const centralOffset = (now) =>
  tzAbbrev('America/Chicago', now) === 'CDT' ? ['-05:00', 'Central daylight time'] : ['-06:00', 'Central standard time'];

// Strict on purpose: Date.parse rolls 2026-02-30 forward to March and reads a time with no offset as
// the machine's local time (UTC on a Heroku dyno), and either mistake makes the post-deploy check
// count the wrong rows. Returns { at, label } or { error }.
export const parseSince = (value, now = new Date()) => {
  if (NO_OFFSET.test(value)) {
    const [offset, name] = centralOffset(now);
    return { error: `--since=${value} has a time but no UTC offset. Add one, for example ${value.replace(' ', 'T')}${offset} (${name}).` };
  }
  const m = SINCE_SHAPE.exec(value);
  if (!m) return { error: `--since=${value} is not a date (YYYY-MM-DD) or a time with its offset (YYYY-MM-DDTHH:MM±HH:MM).` };
  const [, y, mo, d, hh = '00', mi = '00', ss = '00', frac = '0', tz = 'Z'] = m;
  const [Y, M, D, H, Mi, S] = [y, mo, d, hh, mi, ss].map(Number);
  const local = new Date(Date.UTC(Y, M - 1, D, H, Mi, S, Number(frac.padEnd(3, '0'))));
  const real =
    local.getUTCFullYear() === Y && local.getUTCMonth() === M - 1 && local.getUTCDate() === D &&
    local.getUTCHours() === H && local.getUTCMinutes() === Mi && local.getUTCSeconds() === S;
  if (!real) return { error: `--since=${value} is not a real date and time.` };
  let offsetMin = 0;
  if (tz !== 'Z') {
    const [oh, om] = tz.slice(1).split(':').map(Number);
    if (oh > 14 || om > 59) return { error: `--since=${value} has an impossible UTC offset.` };
    offsetMin = (tz[0] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  const at = new Date(local.getTime() - offsetMin * 60000);
  if (at > now) return { error: `--since=${value} is in the future.` };
  const label = hh === '00' && !m[4]
    ? `${at.toISOString()} (the bare date ${value}, read as 00:00 UTC)`
    : `${at.toISOString()} (${y}-${mo}-${d} ${hh}:${mi}${m[6] ? `:${ss}` : ''} at ${tz === 'Z' ? 'UTC' : tz})`;
  return { at, label };
};
