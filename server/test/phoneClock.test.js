import { test } from 'node:test';
import assert from 'node:assert';
import {
  WRONG_MS,
  WINDOW_MS,
  judgeDay,
  sizeBucket,
  looksLikeZone,
  small,
  shiftedDays,
  latestDayState,
  sameOffsetDays,
} from '../src/services/audit/phoneClock.js';
import { zonedDayRange } from '../src/utils/timezone.js';

// The phone-clock rule (docs/PROPOSAL_PHONE_CLOCKS.md §B), no DB. A save is { lag, live, window }:
// lag = createdAt − timestamp in ms, window = which 10-minute stretch of createdAt it arrived in.

const MIN = 60_000;
const HOUR = 60 * MIN;
const live = (lag, window) => ({ lag, live: true, window });
const queued = (lag, window = 0) => ({ lag, live: false, window });
// Live saves one window apart, each with the given lag.
const spread = (...lags) => lags.map((lag, i) => live(lag, i));

test('a right phone: prompt live saves read right', () => {
  assert.deepStrictEqual(judgeDay(spread(1000, 3000, 900, 2000)), { verdict: 'right', sizeMs: 0 });
});

test('behind: every save late, 3 live saves in 3 windows; the size is the smallest live lag', () => {
  const r = judgeDay(spread(2 * HOUR + 4000, 2 * HOUR + 1500, 2 * HOUR + 30_000));
  assert.strictEqual(r.verdict, 'behind');
  assert.strictEqual(r.sizeMs, 2 * HOUR + 1500);
});

test('behind is vetoed by one prompt save, live or queued', () => {
  assert.strictEqual(judgeDay([...spread(2 * HOUR, 2 * HOUR, 2 * HOUR), live(2000, 9)]).verdict, 'right');
  assert.strictEqual(judgeDay([...spread(2 * HOUR, 2 * HOUR, 2 * HOUR), queued(4 * MIN)]).verdict, 'right');
});

test('behind needs 3 different windows: a stall releases its late saves together', () => {
  assert.strictEqual(judgeDay([live(7 * MIN, 5), live(7 * MIN, 5), live(6.5 * MIN, 5)]).verdict, 'unjudged');
  assert.strictEqual(judgeDay([live(7 * MIN, 5), live(7 * MIN, 5), live(6.5 * MIN, 6)]).verdict, 'unjudged');
  assert.strictEqual(judgeDay([live(7 * MIN, 5), live(7 * MIN, 6), live(6.5 * MIN, 7)]).verdict, 'behind');
});

test('behind needs 3 live saves: queued saves alone never judge behind', () => {
  assert.strictEqual(judgeDay([queued(3 * HOUR), queued(5 * HOUR), queued(2 * HOUR), queued(6 * HOUR)]).verdict, 'unjudged');
  assert.strictEqual(judgeDay([live(2 * HOUR, 1), live(2 * HOUR, 2), queued(3 * HOUR)]).verdict, 'unjudged');
});

test('a right phone whose live saves mostly arrived late still reads right (the review\'s false alarm)', () => {
  // 4 of 7 delivered 5–9 minutes late: a median would say "behind 5.5 min".
  const saves = spread(5 * MIN, 6 * MIN, 7 * MIN, 9 * MIN, 2000, 1500, 800);
  assert.strictEqual(judgeDay(saves).verdict, 'right');
});

test('ahead: 3 saves, live or queued, arrived 5 minutes or more before their time; size is the largest gap', () => {
  const r = judgeDay([live(-30 * MIN, 1), queued(-29 * MIN), live(-31 * MIN, 3)]);
  assert.strictEqual(r.verdict, 'ahead');
  assert.strictEqual(r.sizeMs, 31 * MIN);
  // Queued saves alone can show it (a phone 20 minutes ahead that only sent later).
  assert.strictEqual(judgeDay([queued(-20 * MIN), queued(-18 * MIN), queued(-19 * MIN), queued(3 * HOUR)]).verdict, 'ahead');
});

test('one or two early saves are too few to call, and never read right', () => {
  assert.strictEqual(judgeDay([live(-10 * MIN, 1), live(-9 * MIN, 2), live(1000, 3)]).verdict, 'unjudged');
  assert.strictEqual(judgeDay([live(-10 * MIN, 1), live(2 * HOUR, 2), live(2 * HOUR, 3), live(2 * HOUR, 4)]).verdict, 'unjudged');
});

test('the 5-minute edges: exactly 5 minutes late counts as late, exactly 5 minutes early as early', () => {
  assert.strictEqual(judgeDay(spread(WRONG_MS, WRONG_MS, WRONG_MS)).verdict, 'behind');
  assert.strictEqual(judgeDay(spread(WRONG_MS - 1, WRONG_MS, WRONG_MS)).verdict, 'right');
  assert.strictEqual(judgeDay(spread(-WRONG_MS, -WRONG_MS, -WRONG_MS)).verdict, 'ahead');
  assert.strictEqual(judgeDay(spread(-WRONG_MS + 1, -WRONG_MS, -WRONG_MS)).verdict, 'unjudged');
});

test('an even number of saves needs no median: 4 late live saves in 4 windows', () => {
  assert.strictEqual(judgeDay(spread(HOUR + 10_000, HOUR + 2000, HOUR + 5000, HOUR + 1000)).sizeMs, HOUR + 1000);
});

test('size buckets: under an hour, under a day, a day or more', () => {
  assert.strictEqual(sizeBucket(5 * MIN), 'minutes');
  assert.strictEqual(sizeBucket(HOUR - 1), 'minutes');
  assert.strictEqual(sizeBucket(HOUR), 'hours');
  assert.strictEqual(sizeBucket(24 * HOUR - 1), 'hours');
  assert.strictEqual(sizeBucket(24 * HOUR), 'days');
});

test('looks like a time zone set by hand: within 3 minutes of whole hours, under a day', () => {
  assert.strictEqual(looksLikeZone(HOUR + 2 * MIN), true);
  assert.strictEqual(looksLikeZone(HOUR - 3 * MIN), true);
  assert.strictEqual(looksLikeZone(2 * HOUR + 4 * MIN), false);
  assert.strictEqual(looksLikeZone(30 * MIN), false);
  assert.strictEqual(looksLikeZone(24 * HOUR), false);
});

test('small: people counts under 3 print "fewer than 3", zero and the rest exactly', () => {
  assert.strictEqual(small(0), '0');
  assert.strictEqual(small(1), 'fewer than 3');
  assert.strictEqual(small(2), 'fewer than 3');
  assert.strictEqual(small(3), '3');
  assert.strictEqual(small(1234), '1,234');
});

test('shiftedDays counts the saves that land on another day once the size is applied', () => {
  const zone = 'America/Chicago';
  const late = new Date('2026-10-30T22:30:00-05:00').getTime(); // 10:30 pm phone time
  const noon = new Date('2026-10-30T12:00:00-05:00').getTime();
  assert.strictEqual(shiftedDays([late, noon], 2 * HOUR, 'behind', zone), 1); // 10:30 pm + 2 h is the next day
  assert.strictEqual(shiftedDays([late, noon], 2 * HOUR, 'ahead', zone), 0);
  const early = new Date('2026-10-30T00:30:00-05:00').getTime();
  assert.strictEqual(shiftedDays([early], HOUR, 'ahead', zone), 1); // 12:30 am − 1 h is the day before
});

test('latestDayState: still wrong, fixed, not seen, not judged', () => {
  const zone = 'America/Chicago';
  const now = new Date('2026-11-01T21:00:00-06:00');
  const d = (day, verdict) => ({ day, zone, start: zonedDayRange(day, null, zone).$gte.getTime(), verdict });
  assert.strictEqual(latestDayState([d('2026-10-30', 'right'), d('2026-10-31', 'behind')], now), 'wrong');
  assert.strictEqual(latestDayState([d('2026-11-01', 'ahead')], now), 'wrong');
  assert.strictEqual(latestDayState([d('2026-10-30', 'behind'), d('2026-11-01', 'right')], now), 'right');
  assert.strictEqual(latestDayState([d('2026-10-29', 'behind')], now), 'unseen');
  assert.strictEqual(latestDayState([d('2026-10-31', 'behind'), d('2026-11-01', 'unjudged')], now), 'unjudged');
});

test('sameOffsetDays: most of a day\'s judged canvassers off by about the same amount', () => {
  const f = (user, sizeMs, day = '2026-10-30', verdict = 'behind') => ({ user, day, verdict, sizeMs });
  const judged = (day, count) => new Map([[day, new Set(Array.from({ length: count }, (_, i) => `u${i}`))]]);
  const three = [f('u0', HOUR), f('u1', HOUR + MIN), f('u2', HOUR + 90_000)];
  assert.deepStrictEqual(sameOffsetDays(three, judged('2026-10-30', 5)), ['2026-10-30']);
  // A crew of three among many right phones is phones, not the server.
  assert.deepStrictEqual(sameOffsetDays(three, judged('2026-10-30', 40)), []);
  // Sizes more than 2 minutes apart don't cluster.
  assert.deepStrictEqual(sameOffsetDays([f('u0', HOUR), f('u1', HOUR + 5 * MIN), f('u2', 2 * HOUR)], judged('2026-10-30', 3)), []);
  // Mixed directions never cluster together.
  assert.deepStrictEqual(sameOffsetDays([f('u0', HOUR), f('u1', HOUR, '2026-10-30', 'ahead'), f('u2', HOUR)], judged('2026-10-30', 3)), []);
});

test('windows are 10 minutes', () => {
  assert.strictEqual(WINDOW_MS, 10 * MIN);
});
