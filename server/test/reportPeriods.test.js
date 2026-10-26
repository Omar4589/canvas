import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as periods from '../src/services/reports/reportPeriods.js';
import { zonedDayRange } from '../src/utils/timezone.js';

// The week math (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §C, §F) with no database. The fixture table is
// the PARITY PIN: client/src/lib/reportPeriods.parity.test.js runs the same file against the client copy
// (client/src/components/clientReports/reportDates.js), so the dates New report suggests and the period
// Next report makes can't drift apart. Its expectations were generated from an independent brute-force
// reading of §C (not from either copy), with the plan's worked answers — Part 1, §C, and the round 1 and
// round 2 scenarios — asserted along the way; each case's `note` says what it pins.
const CASES = JSON.parse(readFileSync(new URL('./fixtures/reportPeriods.json', import.meta.url), 'utf8'));
const K1 = ['dayOfWeek', 'weekStartOf', 'weekEndOf', 'lastWeek', 'thisWeek', 'wholeMonthsOf', 'catchUpPeriod', 'nextPeriod', 'suggestPeriod'];

test('every fixture case: the server copy answers exactly what the table says', () => {
  assert.ok(CASES.length >= 400, `the table is a real pin (${CASES.length} cases)`);
  for (const [i, c] of CASES.entries()) {
    assert.equal(typeof periods[c.fn], 'function', `#${i} ${c.fn} is exported`);
    assert.deepStrictEqual(periods[c.fn](...c.args), c.expect, `#${i} ${c.note}`);
  }
});

test('the table covers every function, every week start, every weekday of today and every branch', () => {
  const of = (fn) => CASES.filter((c) => c.fn === fn);
  for (const fn of K1) assert.ok(of(fn).length > 0, `${fn} has cases`);
  const next = of('nextPeriod');
  const sug = of('suggestPeriod');
  const tag = (e) => `${e.kind}${e.branch ? `/${e.branch}` : ''}`;
  assert.deepStrictEqual(
    [...new Set(next.map((c) => tag(c.expect)))].sort(),
    ['catch_up/last_week', 'catch_up/this_week', 'months', 'weeks']
  );
  assert.deepStrictEqual(
    [...new Set(sug.map((c) => `${tag(c.expect)}${c.expect.longGap ? ' long gap' : ''}`))].sort(),
    ['catch_up/last_week', 'catch_up/this_week', 'last_week', 'last_week long gap', 'months', 'months long gap', 'this_week', 'weeks', 'weeks long gap']
  );
  assert.ok(sug.some((c) => c.expect.equalsLastWeek) && sug.some((c) => !c.expect.equalsLastWeek));
  // the long-gap weeks choice both as "Last week" and as another run (N > 1 weeks, or another weekday)
  assert.ok(sug.some((c) => c.expect.kind === 'weeks' && c.expect.longGap && c.expect.equalsLastWeek));
  assert.ok(sug.some((c) => c.expect.kind === 'weeks' && c.expect.longGap && c.expect.weeks > 1));
  for (const fn of ['weekStartOf', 'weekEndOf', 'lastWeek', 'thisWeek', 'catchUpPeriod', 'nextPeriod']) {
    assert.deepStrictEqual([...new Set(of(fn).map((c) => c.args[1]))].sort(), [0, 1, 2, 3, 4, 5, 6], `${fn}: every weekStartsOn`);
  }
  assert.deepStrictEqual([...new Set(sug.map((c) => c.args[0].s))].sort(), [0, 1, 2, 3, 4, 5, 6], 'suggestPeriod: every weekStartsOn');
  for (const fn of ['lastWeek', 'thisWeek']) {
    assert.deepStrictEqual([...new Set(of(fn).map((c) => periods.dayOfWeek(c.args[0])))].sort(), [0, 1, 2, 3, 4, 5, 6], `${fn}: today on every weekday`);
  }
  assert.deepStrictEqual([...new Set(next.map((c) => periods.dayOfWeek(c.args[2])))].sort(), [0, 1, 2, 3, 4, 5, 6], 'nextPeriod: today on every weekday');
  // whole-week runs of 7, 14, 21 and 28 days starting on every weekday
  for (const weeks of [1, 2, 3, 4]) {
    const starts = next.filter((c) => c.expect.kind === 'weeks' && c.expect.weeks === weeks).map((c) => periods.dayOfWeek(c.args[0].weekStart));
    assert.deepStrictEqual([...new Set(starts)].sort(), [0, 1, 2, 3, 4, 5, 6], `${weeks}-week runs start on every weekday`);
  }
});

test('invariants over a sweep: contiguity, never a whole-week catch-up, long gaps complete and on the grid', () => {
  const add = (d, n) => new Date(Date.UTC(...d.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0))) + n * 86400000).toISOString().slice(0, 10);
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
  const zones = ['America/New_York', 'America/Chicago', 'America/Phoenix', 'America/Los_Angeles', 'Pacific/Honolulu', 'America/Anchorage'];
  // Checked cheaply, reported in full: the first broken case fails with everything needed to replay it.
  const must = (ok, what, ctx) => {
    if (!ok) assert.fail(`${what}: ${JSON.stringify(ctx)}`);
  };
  let cases = 0;
  for (let i = 0; i < 365; i += 11) {
    const a = add('2026-01-01', i);
    const reports = Array.from({ length: 29 }, (_, n) => ({ weekStart: a, weekEnd: add(a, n) }));
    const first = `${a.slice(0, 8)}01`;
    for (const months of [1, 3]) {
      const [y, m] = first.split('-').map(Number);
      const after = new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
      reports.push({ weekStart: first, weekEnd: add(after, -1) });
    }
    for (const L of reports) for (let s = 0; s <= 6; s += 1) for (let k = -2; k <= 40; k += 4) {
      const today = add(L.weekEnd, k);
      cases += 1;
      const P = periods.nextPeriod(L, s, today);
      const n = days(P.weekStart, P.weekEnd);
      const ctx = { L, s, today, P };
      must(P.weekStart === add(L.weekEnd, 1) && n >= 1, 'every rule starts the day after the report', ctx);
      if (P.kind === 'catch_up') {
        must(n % 7 !== 0, 'a catch-up is never whole weeks', ctx);
        must(periods.weekEndOf(P.weekEnd, s) === P.weekEnd, 'a catch-up ends on a report week end', ctx);
      }
      if (P.kind === 'weeks') must(n === 7 * P.weeks, 'weeks are whole', ctx);
      if (P.kind === 'months') must(periods.wholeMonthsOf(P.weekStart, P.weekEnd) === P.months, 'months stay months', ctx);
      if (cases % 9 === 0) {
        // Next's own NEXT_PERIOD_MISMATCH test (routes/admin/clientReports.js), DST zones included
        const tz = zones[cases % zones.length];
        must(zonedDayRange(P.weekStart, P.weekEnd, tz).$gte.getTime() === zonedDayRange(L.weekStart, L.weekEnd, tz).$lt.getTime(), `contiguous in ${tz}`, ctx);
      }
      const choice = periods.suggestPeriod({ last: L, s, today, knockedBeforeThisWeek: true });
      const cctx = { ...ctx, choice };
      if (!choice.longGap) {
        must(choice.weekStart === P.weekStart && choice.weekEnd === P.weekEnd && choice.skipped === null, 'without a long gap, New report offers what Next makes', cctx);
        continue;
      }
      must(choice.weekEnd < today && choice.weekStart > L.weekEnd, 'a long-gap choice is complete (ends before today) and after the report', cctx);
      must(choice.skipped.start === P.weekStart && choice.skipped.end === add(choice.weekStart, -1), 'skipped = the days between', cctx);
      if (choice.kind === 'weeks') must(days(P.weekStart, choice.weekStart) % (7 * P.weeks) === 1, 'on the series grid', cctx);
      if (P.kind === 'catch_up') {
        const lw = periods.lastWeek(today, s);
        must(n > periods.CATCH_UP_MAX_DAYS && choice.weekStart === lw.weekStart && choice.weekEnd === lw.weekEnd, 'a long catch-up suggests last week', cctx);
      }
    }
  }
  assert.ok(cases > 50000, `${cases} cases`);
});

test('reportWeekStartsOnOf: Monday unless the organization chose a real weekday', () => {
  assert.equal(periods.reportWeekStartsOnOf({}), 1, 'an organization saved before the setting');
  assert.equal(periods.reportWeekStartsOnOf(null), 1);
  assert.equal(periods.reportWeekStartsOnOf({ reportWeekStartsOn: null }), 1);
  for (let s = 0; s <= 6; s += 1) assert.equal(periods.reportWeekStartsOnOf({ reportWeekStartsOn: s }), s);
  for (const bad of [7, -1, 2.5, '3', Number.NaN]) assert.equal(periods.reportWeekStartsOnOf({ reportWeekStartsOn: bad }), 1, `${bad} reads as Monday`);
});
