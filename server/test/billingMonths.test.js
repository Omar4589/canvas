import { test } from 'node:test';
import assert from 'node:assert';
import {
  START_GRACE_DAYS,
  END_GRACE_DAYS,
  monthOf,
  dayOfMonth,
  daysInMonth,
  addMonths,
  startGraceApplies,
  billingStartMonth,
  needsStartMonthVisitCount,
  decideMonth,
} from '../src/services/billing/billingMonths.js';

// The billing-month rules at every calendar boundary, with no database. The int suite
// (statement.int.test.js) proves statement.js feeds these facts correctly; this file proves the
// rules themselves. Everything is fixed-date — nothing here may depend on the wall clock, or the
// suite would pass or fail depending on what day of the month CI runs.

// ---- calendar primitives -----------------------------------------------------

test('daysInMonth is leap-safe', () => {
  assert.strictEqual(daysInMonth('2026-01'), 31);
  assert.strictEqual(daysInMonth('2026-02'), 28);
  assert.strictEqual(daysInMonth('2028-02'), 29, '2028 is a leap year');
  assert.strictEqual(daysInMonth('2024-02'), 29);
  assert.strictEqual(daysInMonth('2000-02'), 29, 'century divisible by 400');
  assert.strictEqual(daysInMonth('1900-02'), 28, 'century not divisible by 400');
  assert.strictEqual(daysInMonth('2026-04'), 30);
  assert.strictEqual(daysInMonth('2026-12'), 31);
});

test('addMonths rolls the year in both directions', () => {
  assert.strictEqual(addMonths('2026-01', 1), '2026-02');
  assert.strictEqual(addMonths('2026-12', 1), '2027-01');
  assert.strictEqual(addMonths('2026-01', -1), '2025-12');
  assert.strictEqual(addMonths('2026-06', 0), '2026-06');
  assert.strictEqual(addMonths('2026-11', 14), '2028-01');
});

test('monthOf / dayOfMonth slice civil-date strings', () => {
  assert.strictEqual(monthOf('2026-03-09'), '2026-03');
  assert.strictEqual(dayOfMonth('2026-03-09'), 9);
  assert.strictEqual(dayOfMonth('2026-03-31'), 31);
});

test('month strings compare lexicographically (the whole module leans on this)', () => {
  assert.ok('2026-01' < '2026-02');
  assert.ok('2026-09' < '2026-10', 'zero padding is what makes this safe');
  assert.ok('2026-12' < '2027-01');
});

// ---- start grace: the boundary is `>`, so exactly 7 days qualify ---------------

const GRACE_BOUNDARIES = [
  // [month, lastNonGraceDay, firstGraceDay, lengthNote]
  ['2026-01', 24, 25, '31-day'],
  ['2026-04', 23, 24, '30-day'],
  ['2026-02', 21, 22, '28-day Feb'],
  ['2028-02', 22, 23, '29-day leap Feb'],
];

for (const [month, lastNo, firstYes, note] of GRACE_BOUNDARIES) {
  test(`start grace boundary — ${month} (${note})`, () => {
    const len = daysInMonth(month);
    assert.strictEqual(firstYes, len - START_GRACE_DAYS + 1, 'exactly 7 days qualify');
    assert.strictEqual(startGraceApplies(`${month}-${String(lastNo).padStart(2, '0')}`), false);
    assert.strictEqual(startGraceApplies(`${month}-${String(firstYes).padStart(2, '0')}`), true);
    assert.strictEqual(startGraceApplies(`${month}-${String(len).padStart(2, '0')}`), true, 'last day');
    assert.strictEqual(startGraceApplies(`${month}-01`), false, 'first day');
  });
}

test('billingStartMonth shifts only when the grace fires, and rolls the year', () => {
  assert.strictEqual(billingStartMonth('2026-01-24'), '2026-01');
  assert.strictEqual(billingStartMonth('2026-01-25'), '2026-02');
  assert.strictEqual(billingStartMonth('2026-12-31'), '2027-01', 'December rollover');
  assert.strictEqual(billingStartMonth(null), null);
});

// ---- decideMonth ---------------------------------------------------------------

// Convenience: run a campaign across a span of months and collect {month: reason}.
function runMonths(from, count, facts) {
  const out = {};
  let m = from;
  for (let i = 0; i < count; i += 1) {
    const visits = facts.visitsByMonth?.[m] ?? 0;
    const need = needsStartMonthVisitCount({ ...facts, month: m });
    const d = decideMonth({
      month: m,
      firstVisitDay: facts.firstVisitDay,
      archivedDay: facts.archivedDay,
      visitsThisMonth: visits,
      visitsInStartMonth: need ? (facts.visitsByMonth?.[need] ?? 0) : undefined,
    });
    out[m] = d.reason;
    m = addMonths(m, 1);
  }
  return out;
}

const billableCount = (reasons) =>
  Object.values(reasons).filter((r) => r === 'billable' || r === 'floor').length;

test('a campaign that never went to the field never bills', () => {
  const d = decideMonth({ month: '2026-03', firstVisitDay: null, archivedDay: null, visitsThisMonth: 0 });
  assert.deepStrictEqual(d, { billable: false, reason: 'no-field-visit', startMonth: null, floorMonth: null });
});

test('ordinary campaign: bills from the first-visit month onward', () => {
  const reasons = runMonths('2026-01', 4, {
    firstVisitDay: '2026-02-10',
    archivedDay: null,
    visitsByMonth: { '2026-02': 40, '2026-03': 25 },
  });
  assert.deepStrictEqual(reasons, {
    '2026-01': 'before-start',
    '2026-02': 'billable',
    '2026-03': 'billable',
    '2026-04': 'billable', // never archived → keeps billing even with zero knocks
  });
});

test('start grace: a late-month first visit makes that month free', () => {
  const reasons = runMonths('2026-01', 3, {
    firstVisitDay: '2026-01-28',
    archivedDay: null,
    visitsByMonth: { '2026-01': 12, '2026-02': 60 },
  });
  assert.deepStrictEqual(reasons, {
    '2026-01': 'start-grace',
    '2026-02': 'billable',
    '2026-03': 'billable',
  });
});

test('start-grace boundary decides a real month: day 24 bills, day 25 does not', () => {
  const bills = decideMonth({
    month: '2026-01', firstVisitDay: '2026-01-24', archivedDay: null, visitsThisMonth: 5,
  });
  const free = decideMonth({
    month: '2026-01', firstVisitDay: '2026-01-25', archivedDay: null, visitsThisMonth: 5,
  });
  assert.strictEqual(bills.reason, 'billable');
  assert.strictEqual(free.reason, 'start-grace');
});

test('archive month bills; the month after does not', () => {
  const reasons = runMonths('2026-02', 4, {
    firstVisitDay: '2026-02-10',
    archivedDay: '2026-03-20',
    visitsByMonth: { '2026-02': 40, '2026-03': 30 },
  });
  assert.deepStrictEqual(reasons, {
    '2026-02': 'billable',
    '2026-03': 'billable',
    '2026-04': 'archived-earlier',
    '2026-05': 'archived-earlier',
  });
});

test('end grace: archived in the first 3 days with nobody out → free', () => {
  const reasons = runMonths('2026-02', 4, {
    firstVisitDay: '2026-02-10',
    archivedDay: '2026-04-02',
    visitsByMonth: { '2026-02': 40, '2026-03': 30 }, // April: zero
  });
  assert.deepStrictEqual(reasons, {
    '2026-02': 'billable',
    '2026-03': 'billable',
    '2026-04': 'end-grace',
    '2026-05': 'archived-earlier',
  });
});

test('end grace is DENIED when someone knocked that month', () => {
  const reasons = runMonths('2026-04', 1, {
    firstVisitDay: '2026-02-10',
    archivedDay: '2026-04-03',
    visitsByMonth: { '2026-04': 8 }, // knocked Apr 1-2, archived Apr 3 — real work
  });
  assert.strictEqual(reasons['2026-04'], 'billable');
});

test('end grace is DENIED on the 4th, even with zero visits', () => {
  const reasons = runMonths('2026-04', 1, {
    firstVisitDay: '2026-02-10',
    archivedDay: '2026-04-04',
    visitsByMonth: {},
  });
  assert.strictEqual(reasons['2026-04'], 'billable');
});

test(`END_GRACE_DAYS covers exactly days 1..${END_GRACE_DAYS}`, () => {
  for (let day = 1; day <= 5; day += 1) {
    const d = decideMonth({
      month: '2026-04',
      firstVisitDay: '2026-02-10',
      archivedDay: `2026-04-0${day}`,
      visitsThisMonth: 0,
    });
    assert.strictEqual(d.reason, day <= END_GRACE_DAYS ? 'end-grace' : 'billable', `day ${day}`);
  }
});

// ---- the floor: both graces firing must never net to a free campaign ----------

test('floor via A < S: first visit in the grace window, archived that same month', () => {
  const reasons = runMonths('2026-01', 3, {
    firstVisitDay: '2026-01-28',
    archivedDay: '2026-01-30',
    visitsByMonth: { '2026-01': 6 },
  });
  assert.deepStrictEqual(reasons, {
    '2026-01': 'floor',
    '2026-02': 'archived-earlier',
    '2026-03': 'archived-earlier',
  });
  assert.strictEqual(billableCount(reasons), 1, 'exactly one month bills');
});

test('floor via A === S + end grace: the Oct 29 → Nov 2 campaign', () => {
  // The owner's scenario: first knock Oct 29 (start grace), archived Nov 2 (end grace),
  // nobody out in November. Both graces fire; the floor charges October.
  const reasons = runMonths('2026-10', 3, {
    firstVisitDay: '2026-10-29',
    archivedDay: '2026-11-02',
    visitsByMonth: { '2026-10': 30 }, // November: zero
  });
  assert.deepStrictEqual(reasons, {
    '2026-10': 'floor',
    '2026-11': 'end-grace',
    '2026-12': 'archived-earlier',
  });
  assert.strictEqual(billableCount(reasons), 1, 'exactly one month bills — never zero, never two');
});

test('floor does NOT double-charge when the start month earned its own charge', () => {
  // Same dates, but canvassers DID go out on Nov 1. November bills on its own merits, so the
  // floor must stay out of it and October keeps its start grace.
  const reasons = runMonths('2026-10', 3, {
    firstVisitDay: '2026-10-29',
    archivedDay: '2026-11-02',
    visitsByMonth: { '2026-10': 30, '2026-11': 9 },
  });
  assert.deepStrictEqual(reasons, {
    '2026-10': 'start-grace',
    '2026-11': 'billable',
    '2026-12': 'archived-earlier',
  });
  assert.strictEqual(billableCount(reasons), 1);
});

test('invariant: any campaign that went to the field bills at least one month', () => {
  const cases = [
    { firstVisitDay: '2026-01-28', archivedDay: '2026-01-29', visitsByMonth: { '2026-01': 1 } },
    { firstVisitDay: '2026-01-31', archivedDay: '2026-02-01', visitsByMonth: { '2026-01': 1 } },
    { firstVisitDay: '2026-01-25', archivedDay: '2026-02-03', visitsByMonth: { '2026-01': 4 } },
    { firstVisitDay: '2026-02-22', archivedDay: '2026-03-01', visitsByMonth: { '2026-02': 2 } },
    { firstVisitDay: '2026-12-31', archivedDay: '2027-01-02', visitsByMonth: { '2026-12': 3 } },
    { firstVisitDay: '2026-06-15', archivedDay: '2026-06-16', visitsByMonth: { '2026-06': 9 } },
  ];
  for (const c of cases) {
    const start = addMonths(monthOf(c.firstVisitDay), -1);
    const reasons = runMonths(start, 5, c);
    assert.ok(
      billableCount(reasons) >= 1,
      `${c.firstVisitDay} → ${c.archivedDay} billed nothing: ${JSON.stringify(reasons)}`
    );
  }
});

// ---- the two-phase hook -------------------------------------------------------

test('needsStartMonthVisitCount asks only in the one corner that needs it', () => {
  const graced = { firstVisitDay: '2026-10-29', archivedDay: '2026-11-02' };
  assert.strictEqual(
    needsStartMonthVisitCount({ ...graced, month: '2026-10' }), '2026-11',
    'evaluating F needs the visit count of F+1'
  );
  assert.strictEqual(
    needsStartMonthVisitCount({ ...graced, month: '2026-11' }), null,
    'only ever asked for the first-visit month'
  );
  // No start grace → the S === F short-circuit decides it from dates alone.
  assert.strictEqual(
    needsStartMonthVisitCount({ firstVisitDay: '2026-10-05', archivedDay: '2026-11-02', month: '2026-10' }),
    null
  );
  // Archived outside the end-grace window → dates alone again.
  assert.strictEqual(
    needsStartMonthVisitCount({ firstVisitDay: '2026-10-29', archivedDay: '2026-11-09', month: '2026-10' }),
    null
  );
  // Never archived, or never canvassed.
  assert.strictEqual(needsStartMonthVisitCount({ firstVisitDay: '2026-10-29', archivedDay: null, month: '2026-10' }), null);
  assert.strictEqual(needsStartMonthVisitCount({ firstVisitDay: null, archivedDay: '2026-11-02', month: '2026-10' }), null);
});

test('decideMonth refuses to guess when a required fact is missing', () => {
  assert.throws(
    () => decideMonth({
      month: '2026-10',
      firstVisitDay: '2026-10-29',
      archivedDay: '2026-11-02',
      visitsThisMonth: 30,
      // visitsInStartMonth deliberately absent
    }),
    /visitsInStartMonth is required/
  );
  assert.throws(
    () => decideMonth({ month: '2026-10', firstVisitDay: '2026-10-05', archivedDay: null }),
    /visitsThisMonth must be a number/
  );
});

test('decideMonth reports the start and floor months it derived', () => {
  const d = decideMonth({
    month: '2026-11', firstVisitDay: '2026-10-29', archivedDay: null, visitsThisMonth: 4,
  });
  assert.strictEqual(d.startMonth, '2026-11');
  assert.strictEqual(d.floorMonth, '2026-10');
});
