import { test } from 'node:test';
import assert from 'node:assert';
import {
  isMonthStr,
  addMonths,
  monthsBetween,
  monthLabel,
  shortMonthLabel,
  lastDayOf,
  closesAt,
} from './months.js';

// Month math with no wall clock. The three private copies this replaced each handled rollover and
// bad input slightly differently; these are the cases where they disagreed.

test('isMonthStr accepts only a real YYYY-MM', () => {
  assert.ok(isMonthStr('2026-01'));
  assert.ok(isMonthStr('2026-12'));
  assert.ok(!isMonthStr('2026-13'), 'month 13 is not a month');
  assert.ok(!isMonthStr('2026-00'));
  assert.ok(!isMonthStr('2026-1'), 'a missing leading zero breaks string comparison');
  assert.ok(!isMonthStr('2026-01-15'));
  assert.ok(!isMonthStr(''));
  assert.ok(!isMonthStr(null));
  assert.ok(!isMonthStr('nonsense'));
});

test('addMonths rolls the year in both directions', () => {
  assert.strictEqual(addMonths('2026-12', 1), '2027-01');
  assert.strictEqual(addMonths('2026-01', -1), '2025-12');
  assert.strictEqual(addMonths('2026-06', 0), '2026-06');
  assert.strictEqual(addMonths('2026-09', -35), '2023-10', 'the invoicing lookback');
  assert.strictEqual(addMonths('2026-01', 24), '2028-01');
});

test('addMonths returns null on bad input rather than a plausible wrong month', () => {
  assert.strictEqual(addMonths('nonsense', 1), null);
  assert.strictEqual(addMonths('2026-13', 1), null);
  assert.strictEqual(addMonths(null, 1), null);
});

test('monthsBetween is inclusive, oldest first, and empty when inverted', () => {
  assert.deepStrictEqual(monthsBetween('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepStrictEqual(monthsBetween('2026-05', '2026-05'), ['2026-05']);
  assert.deepStrictEqual(monthsBetween('2026-06', '2026-05'), [], 'an inverted range is empty, not reversed');
  assert.deepStrictEqual(monthsBetween('bad', '2026-05'), []);
});

test('labels read as a person would say them', () => {
  assert.strictEqual(monthLabel('2026-07'), 'July 2026');
  assert.strictEqual(monthLabel('2026-01'), 'January 2026');
  assert.strictEqual(shortMonthLabel('2026-07'), 'Jul 2026');
  assert.strictEqual(monthLabel('garbage'), '—');
  assert.strictEqual(shortMonthLabel(null), '—');
});

test('lastDayOf is leap-safe', () => {
  assert.strictEqual(lastDayOf('2026-02').toISOString().slice(0, 10), '2026-02-28');
  assert.strictEqual(lastDayOf('2028-02').toISOString().slice(0, 10), '2028-02-29', '2028 is a leap year');
  assert.strictEqual(lastDayOf('2026-01').toISOString().slice(0, 10), '2026-01-31');
  assert.strictEqual(lastDayOf('2026-04').toISOString().slice(0, 10), '2026-04-30');
  assert.strictEqual(lastDayOf('nope'), null);
});

test('closesAt is UTC midnight on the 1st of the next month — the clock the issue gate reads', () => {
  assert.strictEqual(closesAt('2026-09').toISOString(), '2026-10-01T00:00:00.000Z');
  assert.strictEqual(closesAt('2026-12').toISOString(), '2027-01-01T00:00:00.000Z');
});
