import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as web from '../components/clientReports/reportDates.js';
// Cross-tree on purpose (the datePresets.parity.test.js pattern): New report's date choices are worked out
// here and Next report's period on the server (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §C), and the
// two must never disagree about a date. Both copies are pure — no imports — so the server's file loads
// in this test as it is; keep it that way.
import * as server from '../../../server/src/services/reports/reportPeriods.js';

// The parity pin: ONE fixture table, also run by server/test/reportPeriods.test.js against the server copy.
const CASES = JSON.parse(readFileSync(new URL('../../../server/test/fixtures/reportPeriods.json', import.meta.url), 'utf8'));
const K1 = ['dayOfWeek', 'weekStartOf', 'weekEndOf', 'lastWeek', 'thisWeek', 'wholeMonthsOf', 'catchUpPeriod', 'nextPeriod', 'suggestPeriod'];

test('every fixture case: the client copy answers exactly what the table says', () => {
  assert.ok(CASES.length >= 400, `the table is a real pin (${CASES.length} cases)`);
  for (const fn of K1) assert.ok(CASES.some((c) => c.fn === fn), `${fn} is in the table`);
  for (const [i, c] of CASES.entries()) {
    assert.equal(typeof web[c.fn], 'function', `#${i} ${c.fn} is exported`);
    assert.deepStrictEqual(web[c.fn](...c.args), c.expect, `#${i} ${c.note}`);
  }
});

test('both copies export the same week functions and the same catch-up limit', () => {
  for (const fn of K1) assert.equal(typeof server[fn], 'function', `server ${fn}`);
  assert.equal(web.CATCH_UP_MAX_DAYS, 14);
  assert.equal(server.CATCH_UP_MAX_DAYS, web.CATCH_UP_MAX_DAYS);
});

// Beyond the table: both copies on the same inputs over a broad sweep — every weekStartsOn, lengths 1–30
// and whole months, today from before the report's end to six weeks after, across 2026–2027.
test('the client and server copies agree everywhere in a broad sweep', () => {
  let compared = 0;
  const same = (fn, args) => {
    compared += 1;
    const a = web[fn](...args);
    const b = server[fn](...args);
    if (JSON.stringify(a) !== JSON.stringify(b)) assert.fail(`${fn}(${JSON.stringify(args)}): client ${JSON.stringify(a)} ≠ server ${JSON.stringify(b)}`);
  };
  for (let i = 0; i < 730; i += 41) {
    const a = web.addDays('2026-01-01', i);
    const reports = Array.from({ length: 30 }, (_, n) => ({ weekStart: a, weekEnd: web.addDays(a, n) }));
    const first = `${a.slice(0, 8)}01`;
    reports.push({ weekStart: first, weekEnd: web.addDays(web.addDays(first, 40).slice(0, 8) + '01', -1) });
    for (const L of reports) for (let s = 0; s <= 6; s += 1) {
      same('weekStartOf', [L.weekEnd, s]);
      same('wholeMonthsOf', [L.weekStart, L.weekEnd]);
      for (let k = -2; k <= 44; k += 6) {
        const today = web.addDays(L.weekEnd, k);
        same('nextPeriod', [L, s, today]);
        same('suggestPeriod', [{ last: L, s, today, knockedBeforeThisWeek: k % 2 === 0 }]);
      }
    }
  }
  assert.ok(compared > 50000, `${compared} comparisons`);
});
