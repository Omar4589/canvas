import { test } from 'node:test';
import assert from 'node:assert';

// The merge + aggregate rules in services/reports/hoursSource.js — pure units,
// fixtures hand-computed against the provider contract's own worked example
// (a 6h shift with one 45-minute break: gross 6.00, adjusted 5.50, worked 5.25).
//   node --test test/hoursSourceFold.test.js
const { foldUserHours, aggregateSource, usableMeasuredDay, spanHours } = await import(
  '../src/services/reports/hoursSource.js'
);

const measuredWith = (entries, { enabled = true, hourFigure = 'adjustedHours' } = {}) => {
  const byUserDay = new Map();
  const daysByUser = new Map();
  for (const [uid, day, row] of entries) {
    byUserDay.set(`${uid}|${day}`, row);
    if (!daysByUser.has(uid)) daysByUser.set(uid, new Set());
    daysByUser.get(uid).add(day);
  }
  return { enabled, hourFigure, byUserDay, daysByUser };
};

const noFlags = { isOpen: false, isStale: false, isManualEntry: false };

test('no connection: every day estimated, exactly the old span sums', () => {
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [
      { day: '2026-08-10', spanHours: 3.5 },
      { day: '2026-08-11', spanHours: 4.25 },
    ],
    measured: { enabled: false, byUserDay: new Map(), daysByUser: new Map() },
  });
  assert.strictEqual(fold.hoursOnDoors, 7.75);
  assert.strictEqual(fold.hoursSource, 'estimated');
  assert.strictEqual(fold.measuredDays, 0);
});

test('a fully measured range uses measured hours and says so', () => {
  // The contract's 6h/45m-break shift: adjusted 5.50 where the span read 4.9.
  const measured = measuredWith([
    ['u1', '2026-08-10', { hours: 5.5, ...noFlags }],
    ['u1', '2026-08-11', { hours: 8.0, ...noFlags }],
  ]);
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [
      { day: '2026-08-10', spanHours: 4.9 },
      { day: '2026-08-11', spanHours: 7.1 },
    ],
    measured,
  });
  assert.strictEqual(fold.hoursOnDoors, 13.5);
  assert.strictEqual(fold.hoursSource, 'measured');
  assert.strictEqual(fold.estimatedDays, 0);
});

test('a partially measured range is mixed: measured days measured, the rest span', () => {
  const measured = measuredWith([['u1', '2026-08-10', { hours: 5.5, ...noFlags }]]);
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [
      { day: '2026-08-10', spanHours: 4.9 },
      { day: '2026-08-11', spanHours: 3.0 }, // no measured row → span
    ],
    measured,
  });
  assert.strictEqual(fold.hoursOnDoors, 8.5);
  assert.strictEqual(fold.hoursSource, 'mixed');
  assert.strictEqual(fold.measuredDays, 1);
  assert.strictEqual(fold.estimatedDays, 1);
});

test('a measured day with NO knocks still adds hours — clocked-but-not-knocking lowers the rate', () => {
  const measured = measuredWith([
    ['u1', '2026-08-10', { hours: 5.0, ...noFlags }],
    ['u1', '2026-08-12', { hours: 4.0, ...noFlags }], // clocked, zero knocks
  ]);
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [{ day: '2026-08-10', spanHours: 4.0 }],
    measured,
  });
  assert.strictEqual(fold.hoursOnDoors, 9.0);
  assert.strictEqual(fold.extraMeasuredDays, 1);
  assert.strictEqual(fold.hoursSource, 'measured');
});

test('a STALE measured day (forgotten clock-out) falls back to the span and keeps its flag', () => {
  const measured = measuredWith([
    ['u1', '2026-08-10', { hours: 31.2, isOpen: true, isStale: true, isManualEntry: false }],
  ]);
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [{ day: '2026-08-10', spanHours: 4.0 }],
    measured,
  });
  assert.strictEqual(fold.hoursOnDoors, 4.0, 'the 31-hour ghost shift must not poison the denominator');
  assert.strictEqual(fold.hoursSource, 'estimated');
  assert.strictEqual(fold.hasStaleShift, true);
});

test('zero measured hours reads as ABSENT, never as a zero denominator', () => {
  const measured = measuredWith([['u1', '2026-08-10', { hours: 0, ...noFlags }]]);
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [{ day: '2026-08-10', spanHours: 2.5 }],
    measured,
  });
  assert.strictEqual(fold.hoursOnDoors, 2.5);
  assert.strictEqual(fold.hoursSource, 'estimated');
  assert.strictEqual(usableMeasuredDay({ hours: 0, isStale: false }), false);
});

test('open and manual-entry days count as measured, flags rolled up', () => {
  const measured = measuredWith([
    ['u1', '2026-08-10', { hours: 3.0, isOpen: true, isStale: false, isManualEntry: false }],
    ['u1', '2026-08-11', { hours: 6.0, isOpen: false, isStale: false, isManualEntry: true }],
  ]);
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [
      { day: '2026-08-10', spanHours: 2.0 },
      { day: '2026-08-11', spanHours: 5.0 },
    ],
    measured,
  });
  assert.strictEqual(fold.hoursOnDoors, 9.0);
  assert.strictEqual(fold.hasOpenShift, true);
  assert.strictEqual(fold.hasManualEntry, true);
  assert.strictEqual(fold.hoursSource, 'measured');
});

test('the hourFigure setting picks which wire figure a row contributes', () => {
  // Same row, read under workedHours instead of adjustedHours: 5.25 not 5.50.
  // (loadMeasuredHours resolves the figure into `hours`; the fold is agnostic —
  // this pins the seam's shape: one number per row, chosen upstream.)
  const asWorked = measuredWith([['u1', '2026-08-10', { hours: 5.25, ...noFlags }]], {
    hourFigure: 'workedHours',
  });
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [{ day: '2026-08-10', spanHours: 4.9 }],
    measured: asWorked,
  });
  assert.strictEqual(fold.hoursOnDoors, 5.25);
});

test('AGGREGATE ALL-OR-NOTHING: one non-measured contributor makes the aggregate estimated', () => {
  const m = (source) => ({ hoursSource: source });
  assert.strictEqual(aggregateSource([m('measured'), m('measured')]), 'measured');
  assert.strictEqual(aggregateSource([m('measured'), m('mixed')]), 'estimated');
  assert.strictEqual(aggregateSource([m('measured'), m('estimated')]), 'estimated');
  assert.strictEqual(aggregateSource([]), 'estimated', 'nobody measured is not "measured"');
});

test('spanHours guards nulls and inverted ranges', () => {
  assert.strictEqual(spanHours(null, null), 0);
  const t = Date.now();
  assert.strictEqual(spanHours(new Date(t), new Date(t - 1000)), 0);
  assert.strictEqual(spanHours(new Date(t), new Date(t + 3600000)), 1);
});
