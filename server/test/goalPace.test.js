import { test } from 'node:test';
import assert from 'node:assert';

// Pure door-goal math — no DB, no server:
//   node --test test/goalPace.test.js
// The divisor is the thing worth pinning: today does not count, and the deadline day clamps to
// one rather than dividing by zero.
//
// The verdict ladder, the trailing-rate window and the projected finish were removed from every
// surface (owner ruling 2026-08-15) and with them the tests that pinned them. What that history
// is worth remembering: the required rate once counted today while the projection never did, and
// the two disagreed on screen — "On track" printed beside "finish 2 days past the goal date".
// Anything reintroducing a projection has to divide by the same days this file asserts.

const { computeGoalPace, goalPercent, deadlineFor, daysBetween, addDays } = await import(
  '../src/services/reports/goalProgress.js'
);

const TODAY = '2026-08-14';
// 16 days out (today + 16).
const IN_16 = '2026-08-30';

const pace = (over) =>
  computeGoalPace({
    target: 10000,
    done: 3412,
    deadline: IN_16,
    deadlineSource: 'goalDate',
    todayStr: TODAY,
    ...over,
  });

test('civil-date helpers do not drift', () => {
  assert.strictEqual(daysBetween('2026-08-14', '2026-08-30'), 16);
  assert.strictEqual(daysBetween('2026-08-30', '2026-08-14'), -16);
  assert.strictEqual(daysBetween('2026-08-14', '2026-08-14'), 0);
  assert.strictEqual(addDays('2026-08-14', 20), '2026-09-03');
  assert.strictEqual(addDays('2026-01-01', -1), '2025-12-31');
  // Leap year, the one date arithmetic always gets wrong.
  assert.strictEqual(addDays('2028-02-28', 1), '2028-02-29');
});

test('percent never rounds up to 100 while doors remain', () => {
  assert.strictEqual(goalPercent(9996, 10000), 99, '99.96% is not done');
  assert.strictEqual(goalPercent(10000, 10000), 100);
  assert.strictEqual(goalPercent(10001, 10000), 100, 'clamped, never 101');
  assert.strictEqual(goalPercent(0, 10000), 0);
  assert.strictEqual(goalPercent(5, 0), 0, 'no target, no percent');
});

test('deadline falls back from goalDate to electionDay, then to nothing', () => {
  assert.deepStrictEqual(deadlineFor({ goalDate: '2026-10-28', electionDay: '2026-11-03' }), {
    deadline: '2026-10-28',
    deadlineSource: 'goalDate',
  });
  assert.deepStrictEqual(deadlineFor({ goalDate: null, electionDay: '2026-11-03' }), {
    deadline: '2026-11-03',
    deadlineSource: 'electionDay',
  });
  assert.deepStrictEqual(deadlineFor({}), { deadline: null, deadlineSource: null });
});

test('required rate divides by CALENDAR days, and TODAY DOES NOT COUNT', () => {
  const b = pace({});
  assert.strictEqual(b.remaining, 6588);
  assert.strictEqual(b.daysLeft, 16);
  // 6588 / the 16 days AFTER today — not 17. Today's canvassing is already in motion by the time
  // anyone reads the number, so counting it as an available day understates every other day.
  assert.strictEqual(b.requiredPerDay, 412);
  assert.strictEqual(b.requiredPerWeek, Math.ceil(6588 / (16 / 7)));
});

test('the deadline day clamps to one day, never divides by zero', () => {
  const last = pace({ deadline: TODAY, target: 100, done: 40 });
  assert.strictEqual(last.daysLeft, 0);
  assert.strictEqual(last.requiredPerDay, 60, 'all 60 remaining doors, today');
  assert.strictEqual(last.requiredPerWeek, null, 'a weekly rate inside the last week is noise');
});

test('a weekly rate appears only once a full week remains', () => {
  assert.strictEqual(pace({ deadline: addDays(TODAY, 6) }).requiredPerWeek, null);
  assert.ok(pace({ deadline: addDays(TODAY, 7) }).requiredPerWeek > 0);
});

test('no doors left, or no date, means no daily rate to report', () => {
  const met = pace({ done: 10000 });
  assert.strictEqual(met.remaining, 0);
  assert.strictEqual(met.percent, 100);
  assert.strictEqual(met.requiredPerDay, null, 'nothing left to require');

  const overshot = pace({ done: 12000 });
  assert.strictEqual(overshot.remaining, 0, 'never negative');
  assert.strictEqual(overshot.percent, 100);

  const undated = pace({ deadline: null, deadlineSource: null });
  assert.strictEqual(undated.daysLeft, null);
  assert.strictEqual(undated.requiredPerDay, null);
  assert.strictEqual(undated.requiredPerWeek, null);
  assert.strictEqual(undated.remaining, 6588, 'progress still reports without a date');

  const passed = pace({ deadline: '2026-08-01' });
  assert.strictEqual(passed.daysLeft, -13);
  assert.strictEqual(passed.requiredPerDay, null, 'a passed date has no daily rate');
});

test('the block carries progress only — no verdict, rate or projection', () => {
  assert.deepStrictEqual(Object.keys(pace({})).sort(), [
    'daysLeft',
    'deadline',
    'deadlineSource',
    'done',
    'percent',
    'remaining',
    'requiredPerDay',
    'requiredPerWeek',
    'target',
  ]);
});
