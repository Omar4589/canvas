import { test } from 'node:test';
import assert from 'node:assert';

// Pure door-goal pace math — no DB, no server:
//   node --test test/goalPace.test.js
// The verdict ladder is the thing worth pinning: a wrong "behind" on a healthy campaign is
// worse than no verdict at all, so the suppression rules get as much coverage as the happy path.

const { computeGoalPace, goalPercent, deadlineFor, daysBetween, addDays } = await import(
  '../src/services/reports/goalProgress.js'
);

const TODAY = '2026-08-14';
// 16 days out (today + 16), so 17 usable days counting today.
const IN_16 = '2026-08-30';

const pace = (over) =>
  computeGoalPace({
    target: 10000,
    done: 3412,
    deadline: IN_16,
    deadlineSource: 'goalDate',
    todayStr: TODAY,
    recentDoors: 0,
    windowDays: 14,
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
  const b = pace({ recentDoors: 14 * 305 });
  assert.strictEqual(b.remaining, 6588);
  assert.strictEqual(b.daysLeft, 16);
  // 6588 / the 16 days AFTER today — not 17. Today's canvassing is already in motion by the time
  // anyone reads the number, so counting it as an available day understates every other day.
  assert.strictEqual(b.requiredPerDay, 412);
  assert.strictEqual(b.requiredPerWeek, Math.ceil(6588 / (16 / 7)));

  // The clamp: on the deadline day there are no days after today, and "all of it, today" is the
  // only truthful framing left — a divisor of 1, never 0.
  const last = pace({ deadline: TODAY, target: 100, done: 40, recentDoors: 14 * 5 });
  assert.strictEqual(last.daysLeft, 0);
  assert.strictEqual(last.requiredPerDay, 60, 'all 60 remaining doors, today');
  assert.strictEqual(last.requiredPerWeek, null, 'a weekly rate inside the last week is noise');
});

test('verdict ladder: ahead / on_track / behind against the trailing rate', () => {
  // required is 412/day.
  assert.strictEqual(pace({ recentDoors: 14 * 305 }).verdict, 'behind', '0.74x');
  assert.strictEqual(pace({ recentDoors: 14 * 400 }).verdict, 'on_track', '0.97x is on track');
  assert.strictEqual(pace({ recentDoors: 14 * 425 }).verdict, 'on_track', '1.03x is on track');
  assert.strictEqual(pace({ recentDoors: 14 * 900 }).verdict, 'ahead');
});

// The regression that earned this test. The shipped card once read "On track" directly beside
// "finish Aug 20 — 2 days past the goal date", because requiredPerDay counted today while
// projectedFinish never did. Working at exactly the required rate must land exactly on the
// deadline; if these two ever disagree again, one of them started counting today.
test('a crew doing EXACTLY the required rate finishes exactly on the deadline', () => {
  const required = pace({ recentDoors: 0 }).requiredPerDay; // 412
  const exact = pace({ recentDoors: 14 * required, windowDays: 14 });
  assert.strictEqual(exact.verdict, 'on_track');
  assert.strictEqual(exact.projectedFinish, IN_16, 'the projection lands ON the goal date');
  assert.strictEqual(exact.projectedDaysLate, null, 'and is therefore not late');
});

test('verdict is SUPPRESSED until there is enough canvassing to judge', () => {
  // Two days of history: the campaign may be doing fine, and 600 doors ÷ 14 would call it behind.
  const young = pace({ done: 600, recentDoors: 600, windowDays: 2 });
  assert.strictEqual(young.verdict, 'no_pace');
  assert.strictEqual(young.projectedFinish, null, 'no projection off two days');
  assert.ok(young.requiredPerDay > 0, 'the required rate is still reported');
  assert.strictEqual(young.recentPerDay, 300, 'and so is what they are actually doing');

  // The floor is 5 days.
  assert.strictEqual(pace({ recentDoors: 4 * 100, windowDays: 4 }).verdict, 'no_pace');
  assert.notStrictEqual(pace({ recentDoors: 5 * 100, windowDays: 5 }).verdict, 'no_pace');

  // A campaign with history but a dead window gets no verdict either — zero doors over two
  // weeks is a stopped campaign, and "behind" understates that.
  assert.strictEqual(pace({ recentDoors: 0, windowDays: 14 }).verdict, 'no_pace');
});

test('terminal states short-circuit the ladder', () => {
  assert.strictEqual(pace({ done: 10000, recentDoors: 14 * 10 }).verdict, 'complete');
  assert.strictEqual(pace({ done: 12000, recentDoors: 14 * 10 }).verdict, 'complete');
  assert.strictEqual(pace({ deadline: null, deadlineSource: null }).verdict, 'no_deadline');
  assert.strictEqual(pace({ deadline: '2026-08-01', recentDoors: 14 * 10 }).verdict, 'past_due');

  // Complete wins over a passed date: hitting the goal late is still hitting the goal.
  assert.strictEqual(pace({ done: 10000, deadline: '2026-08-01' }).verdict, 'complete');

  const none = pace({ deadline: null, deadlineSource: null });
  assert.strictEqual(none.requiredPerDay, null);
  assert.strictEqual(none.daysLeft, null);
});

test('projection is dated, bounded, and honest about being late', () => {
  const behind = pace({ recentDoors: 14 * 305 });
  // 6588 / 305 = 22 days out.
  assert.strictEqual(behind.projectedFinish, addDays(TODAY, 22));
  assert.strictEqual(behind.projectedDaysLate, daysBetween(IN_16, behind.projectedFinish));
  assert.ok(behind.projectedDaysLate > 0);

  const ahead = pace({ recentDoors: 14 * 900 });
  assert.ok(ahead.projectedFinish < IN_16);
  assert.strictEqual(ahead.projectedDaysLate, null, 'on time carries no lateness');

  // A crawl would project into the 2030s — better to say nothing than to print that.
  const crawl = pace({ deadline: IN_16, recentDoors: 14, windowDays: 14 });
  assert.strictEqual(crawl.verdict, 'behind');
  assert.strictEqual(crawl.projectedFinish, null, 'beyond a year, no projection');
});

test('recentPerDay is rounded for display but the verdict uses the raw rate', () => {
  // 0.4/day: displays as 0, but must still be judged (and judged as behind, not as no data).
  const trickle = computeGoalPace({
    target: 100,
    done: 10,
    deadline: IN_16,
    todayStr: TODAY,
    recentDoors: 6,
    windowDays: 14,
  });
  assert.strictEqual(trickle.recentPerDay, 0, 'rounds to 0 — we do not inflate it to 1');
  assert.strictEqual(trickle.verdict, 'behind', 'but 0.43/day still gets judged');
});
