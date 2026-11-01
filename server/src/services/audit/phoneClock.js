import { zonedDayStr } from '../../utils/timezone.js';

// Phones with a wrong clock (docs/PROPOSAL_PHONE_CLOCKS.md §B): the pure rule behind
// `npm run audit:phone-clocks`. A visit row carries the phone's time (`timestamp`) and the server's
// (`createdAt`); lag = createdAt − timestamp. Delivery delay only ever ADDS lag — a weak signal, a
// phone pocketed mid-save, the offline queue — so a right clock never reads early, and a day is read
// from its most prompt saves, never from a median a run of late deliveries can drag.
//
// One canvasser-day is judged at a time, from its own rows only:
//   ahead    — MIN_SAVES or more saves (live or queued) arrived WRONG_MS or more before their time;
//   behind   — no save that day arrived within WRONG_MS of its time, and MIN_SAVES or more live saves
//              fall in MIN_SAVES or more different WINDOW_MS windows (a slow server releases its late
//              rows together, in one window; a wrong clock shows in every window);
//   right    — neither, no save arrived early, and at least one arrived within WRONG_MS;
//   unjudged — anything else (never counted as right).

export const WRONG_MS = 5 * 60_000;
export const MIN_SAVES = 3;
export const WINDOW_MS = 10 * 60_000;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const ZONE_SLACK_MS = 3 * 60_000;
const SAME_OFFSET_MS = 2 * 60_000;

// `saves`: [{ lag, live, window }]. `sizeMs` is how far off: at least that much for ahead, at most for
// behind (the smallest live lag still holds that save's own delivery delay).
export const judgeDay = (saves) => {
  const early = saves.filter((s) => s.lag <= -WRONG_MS);
  if (early.length >= MIN_SAVES) return { verdict: 'ahead', sizeMs: early.reduce((m, s) => Math.max(m, -s.lag), 0) };
  const live = saves.filter((s) => s.live);
  const anyPrompt = saves.some((s) => s.lag < WRONG_MS);
  if (!anyPrompt && live.length >= MIN_SAVES && new Set(live.map((s) => s.window)).size >= MIN_SAVES) {
    return { verdict: 'behind', sizeMs: live.reduce((m, s) => Math.min(m, s.lag), Infinity) };
  }
  // One or two early saves are impossible on a right clock but too few to call: not judged.
  if (!early.length && saves.some((s) => Math.abs(s.lag) < WRONG_MS)) return { verdict: 'right', sizeMs: 0 };
  return { verdict: 'unjudged', sizeMs: 0 };
};

export const isWrong = (verdict) => verdict === 'ahead' || verdict === 'behind';

// 5 min to under 1 h · 1 h to under 24 h · 24 h or more.
export const sizeBucket = (ms) => (ms < HOUR_MS ? 'minutes' : ms < DAY_MS ? 'hours' : 'days');

// Within 3 minutes of a whole number of hours, under a day: usually a time zone set by hand.
export const looksLikeZone = (ms) => {
  const hours = Math.round(ms / HOUR_MS);
  return hours >= 1 && ms < DAY_MS && Math.abs(ms - hours * HOUR_MS) <= ZONE_SLACK_MS;
};

// The pace replay's small-count rule (migrations/replayPacePause.js): staff can see an organization's
// member list and each member's visit count, so a count of 1 or 2 people could point at one of them.
export const small = (n) => (n > 0 && n < 3 ? 'fewer than 3' : n.toLocaleString('en-US'));

// Of a wrong day's saves, how many land on another day in `zone` once the size is applied.
export const shiftedDays = (timestamps, sizeMs, verdict, zone) => {
  const shift = verdict === 'behind' ? sizeMs : -sizeMs;
  let n = 0;
  for (const t of timestamps) if (zonedDayStr(t, zone) !== zonedDayStr(t + shift, zone)) n += 1;
  return n;
};

const dayBefore = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
};

// One canvasser's newest canvasser-day (`days`: [{ day, zone, start, verdict }], `start` the day's first
// instant): 'wrong' — still wrong, on the run day or the day before in its zone; 'unseen' — wrong, but
// older than that; 'right' — fixed; 'unjudged' — nothing to tell on that day.
export const latestDayState = (days, now) => {
  const newest = days.reduce((m, d) => Math.max(m, d.start), -Infinity);
  const latest = days.filter((d) => d.start === newest);
  if (latest.some((d) => isWrong(d.verdict))) {
    const { day, zone } = latest[0];
    return day >= dayBefore(zonedDayStr(now, zone)) ? 'wrong' : 'unseen';
  }
  return latest.some((d) => d.verdict === 'right') ? 'right' : 'unjudged';
};

// Days on which 3 or more canvassers read off the same way by sizes within 2 minutes of each other, and
// make up at least half of that day's judged canvassers: more likely the server's clock or the stored
// data than phones. `flagged`: [{ user, day, verdict, sizeMs }]; `judgedByDay`: Map(day → Set of users).
export const sameOffsetDays = (flagged, judgedByDay) => {
  const byDay = new Map();
  for (const f of flagged) byDay.set(f.day, [...(byDay.get(f.day) || []), f]);
  const days = [];
  for (const [day, list] of byDay) {
    const judged = judgedByDay.get(day)?.size || 0;
    const clustered = ['ahead', 'behind'].some((verdict) => {
      const sizes = [...new Map(list.filter((f) => f.verdict === verdict).map((f) => [f.user, f.sizeMs])).values()].sort((a, b) => a - b);
      let best = 0;
      for (let i = 0, j = 0; j < sizes.length; j += 1) {
        while (sizes[j] - sizes[i] > SAME_OFFSET_MS) i += 1;
        best = Math.max(best, j - i + 1);
      }
      return best >= MIN_SAVES && best * 2 >= judged;
    });
    if (clustered) days.push(day);
  }
  return days.sort();
};
