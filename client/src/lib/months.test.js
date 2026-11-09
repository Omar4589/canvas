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
  campaignDayLabel,
  addDays,
  renewalGraceEnd,
  ordinal,
  renewsOnLabel,
  lineBillingRule,
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

// ---- days on the campaign's own calendar (billing rules v4) ----------------------------

test('campaignDayLabel prints a campaign day as is, and falls back to the instant for old rows', () => {
  // A date-only string through new Date() is UTC midnight, the day before in every US zone; the
  // label must not move it.
  assert.match(campaignDayLabel('2026-11-05'), /Nov 5, 2026/);
  assert.match(campaignDayLabel('2026-12-31'), /Dec 31, 2026/);
  // No day field (a statement frozen before rules v4): the instant, as it always read.
  assert.match(campaignDayLabel(undefined, '2026-07-02T12:00:00Z'), /Jul 2, 2026/);
  assert.strictEqual(campaignDayLabel(null, null), '—');
  assert.strictEqual(campaignDayLabel('Nov 5', null), '—', 'a malformed day is not guessed at');
});

test('addDays and renewalGraceEnd cross month and year ends', () => {
  assert.strictEqual(addDays('2026-12-30', 2), '2027-01-01');
  assert.strictEqual(addDays('2028-02-28', 1), '2028-02-29');
  assert.strictEqual(addDays('nope', 1), null);
  assert.strictEqual(renewalGraceEnd('2027-02-28'), '2027-03-02', 'the renewal day and the two after it');
});

test('ordinal suffixes, including the teens', () => {
  assert.deepStrictEqual(
    [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st']
  );
  assert.strictEqual(ordinal(0), '');
});

test('renewsOnLabel names the day, and says what a 29th–31st start does in short months', () => {
  assert.strictEqual(renewsOnLabel('2026-12-15'), 'renews on the 15th');
  assert.strictEqual(renewsOnLabel('2026-12-28'), 'renews on the 28th');
  assert.strictEqual(renewsOnLabel('2027-01-29'), 'renews on the 29th (or the month’s last day)');
  assert.strictEqual(renewsOnLabel('2027-01-31'), 'renews on the 31st (or the month’s last day)');
  assert.strictEqual(renewsOnLabel(null), '');
});

test('lineBillingRule reads a frozen pre-v4 line with a first visit as calendar months', () => {
  assert.strictEqual(lineBillingRule({ billingRule: 'cycle' }), 'cycle');
  assert.strictEqual(lineBillingRule({ billingRule: null, firstKnockAt: null }), null);
  assert.strictEqual(lineBillingRule({ firstKnockAt: '2026-07-02T12:00:00Z' }), 'calendar', 'no key at all: an old line');
  assert.strictEqual(lineBillingRule({}), null);
});
