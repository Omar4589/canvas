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
  CYCLE_BILLING_FROM,
  cycleBillingFrom,
  setCycleBillingFromForTests,
  billingRuleFor,
  renewalDayIn,
  addDays,
  renewalGraceEnd,
  renewalsAround,
  reminderDates,
  startMonthFor,
  needsRenewalVisitCount,
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
    const needRenewal = needsRenewalVisitCount({ ...facts, month: m });
    const d = decideMonth({
      month: m,
      firstVisitDay: facts.firstVisitDay,
      archivedDay: facts.archivedDay,
      visitsThisMonth: visits,
      visitsInStartMonth: need ? (facts.visitsByMonth?.[need] ?? 0) : undefined,
      // Monthly-renewal campaigns only: anyone out from the renewal through the archive day.
      visitsSinceRenewal: needRenewal ? (facts.visitsSinceRenewal ?? 0) : undefined,
      // Undefined for the calendar cases below, whose dates all precede the switch day.
      cycleFrom: facts.cycleFrom,
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
  assert.deepStrictEqual(d, {
    billable: false,
    reason: 'no-field-visit',
    startMonth: null,
    floorMonth: null,
    billingRule: null,
    renewalDay: null,
  });
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
    // Dated before the switch day so it stays a calendar case (2026-12-31 would renew monthly).
    { firstVisitDay: '2025-12-31', archivedDay: '2026-01-02', visitsByMonth: { '2025-12': 3 } },
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

// ---- monthly renewals (v4): campaigns first out on or after the switch day ----------

// Pin a regime explicitly, so none of this depends on where the real switch day sits.
const CYCLE = '2000-01-01'; // every first visit below renews monthly
const CALENDAR = '9999-12-31'; // every first visit below keeps calendar months

// One cycle month, deciding with the same two-phase dance statement.js does.
const cycleMonth = (month, firstVisitDay, archivedDay, visitsSinceRenewal) => {
  const facts = { month, firstVisitDay, archivedDay, cycleFrom: CYCLE };
  const need = needsRenewalVisitCount(facts);
  return decideMonth({ ...facts, visitsThisMonth: 0, visitsSinceRenewal: need ? visitsSinceRenewal : undefined });
};

test('the switch day is November 5, 2026, compared on the first visit', () => {
  assert.strictEqual(CYCLE_BILLING_FROM, '2026-11-05');
  assert.strictEqual(billingRuleFor('2026-11-05', '2026-11-05'), 'cycle', 'on the switch day');
  assert.strictEqual(billingRuleFor('2026-11-04', '2026-11-05'), 'calendar', 'the day before');
  assert.strictEqual(billingRuleFor(null, '2026-11-05'), null, 'never been to the field');
  // With no switch day passed, the live one decides.
  assert.strictEqual(billingRuleFor('2026-11-05'), 'cycle');
  assert.strictEqual(billingRuleFor('2026-11-04'), 'calendar');
  assert.strictEqual(decideMonth({ month: '2026-11', firstVisitDay: '2026-11-04', archivedDay: null, visitsThisMonth: 1 }).billingRule, 'calendar');
  assert.strictEqual(decideMonth({ month: '2026-11', firstVisitDay: '2026-11-05', archivedDay: null, visitsThisMonth: 1 }).billingRule, 'cycle');
});

test('the test seam moves the live switch day, validates it, and refuses in production', () => {
  try {
    setCycleBillingFromForTests('2001-02-03');
    assert.strictEqual(cycleBillingFrom(), '2001-02-03');
    assert.strictEqual(billingRuleFor('2001-02-03'), 'cycle');
    assert.throws(() => setCycleBillingFromForTests('Nov 5'), /YYYY-MM-DD/);
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      assert.throws(() => setCycleBillingFromForTests('2001-01-01'), /tests only/);
    } finally {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
    }
  } finally {
    setCycleBillingFromForTests(null);
  }
  assert.strictEqual(cycleBillingFrom(), CYCLE_BILLING_FROM, 'null resets it');
});

test('renewalDayIn: 29th-31st starts take the last day of shorter months, then go back', () => {
  const cases = [
    // [month, firstVisitDay, expected]
    ['2027-02', '2027-01-31', '2027-02-28'],
    ['2028-02', '2027-01-31', '2028-02-29'], // leap
    ['2027-03', '2027-01-31', '2027-03-31'], // back to the 31st
    ['2027-04', '2027-01-31', '2027-04-30'],
    ['2027-02', '2027-01-30', '2027-02-28'],
    ['2027-02', '2027-01-29', '2027-02-28'],
    ['2028-02', '2027-01-29', '2028-02-29'],
    ['2027-02', '2027-01-28', '2027-02-28'], // no clamp needed
    ['2027-02', '2027-01-01', '2027-02-01'],
    ['2027-01', '2026-12-15', '2027-01-15'], // December to January
    ['2026-12', '2026-11-30', '2026-12-30'],
  ];
  for (const [month, first, expected] of cases) {
    assert.strictEqual(renewalDayIn(month, first), expected, `${first} in ${month}`);
  }
});

test('addDays and the 3-day window cross month ends, year ends and leap days', () => {
  assert.strictEqual(addDays('2026-12-30', 2), '2027-01-01');
  assert.strictEqual(addDays('2028-02-28', 1), '2028-02-29');
  assert.strictEqual(addDays('2027-02-28', 1), '2027-03-01');
  assert.strictEqual(addDays('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(renewalGraceEnd('2027-03-15'), '2027-03-17', 'the renewal day and the two after it');
  assert.strictEqual(renewalGraceEnd('2027-12-31'), '2028-01-02');
  assert.strictEqual(renewalGraceEnd('2027-02-28'), '2027-03-02');
});

test('Part 1 examples table: the new rules beside today\'s, row by row', () => {
  const rows = [
    // first knock, archived, anyone out since the last renewal, new-rule renewals that bill, today's months
    { first: '2027-09-15', archived: '2027-11-03', since: 1, byMonth: { '2027-11': 6 }, cycle: 2, calendar: 3 },
    { first: '2027-09-01', archived: '2027-11-03', since: 1, byMonth: { '2027-11': 6 }, cycle: 3, calendar: 3 },
    { first: '2027-09-01', archived: '2027-11-02', since: 0, byMonth: {}, cycle: 2, calendar: 2 },
    { first: '2027-09-28', archived: '2027-11-01', since: 0, byMonth: {}, cycle: 2, calendar: 1 },
  ];
  for (const r of rows) {
    const base = { firstVisitDay: r.first, archivedDay: r.archived, visitsSinceRenewal: r.since };
    const visitsByMonth = { [r.first.slice(0, 7)]: 9, ...r.byMonth };
    const cycle = runMonths('2027-08', 6, { ...base, visitsByMonth, cycleFrom: CYCLE });
    const calendar = runMonths('2027-08', 6, { ...base, visitsByMonth, cycleFrom: CALENDAR });
    assert.strictEqual(billableCount(cycle), r.cycle, `${r.first} → ${r.archived} new rules: ${JSON.stringify(cycle)}`);
    assert.strictEqual(billableCount(calendar), r.calendar, `${r.first} → ${r.archived} today: ${JSON.stringify(calendar)}`);
  }
  // Jan 31, still running: every renewal bills (Jan 31, Feb 28, Mar 31, Apr 30 …); today's rules
  // make January free on the last-week rule.
  const jan31 = { firstVisitDay: '2027-01-31', archivedDay: null, visitsByMonth: { '2027-01': 3 } };
  const cyc = runMonths('2027-01', 6, { ...jan31, cycleFrom: CYCLE });
  const cal = runMonths('2027-01', 6, { ...jan31, cycleFrom: CALENDAR });
  assert.strictEqual(billableCount(cyc), 6);
  assert.strictEqual(cal['2027-01'], 'start-grace');
  assert.strictEqual(billableCount(cal), 5);
  assert.deepStrictEqual(
    ['2027-01', '2027-02', '2027-03', '2027-04'].map((m) => cycleMonth(m, '2027-01-31', null).renewalDay),
    ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']
  );
});

test('the September 15 campaign month by month: two renewals bill, November never renews', () => {
  const reasons = runMonths('2027-08', 5, {
    firstVisitDay: '2027-09-15',
    archivedDay: '2027-11-03',
    visitsSinceRenewal: 1,
    cycleFrom: CYCLE,
  });
  assert.deepStrictEqual(reasons, {
    '2027-08': 'before-start',
    '2027-09': 'billable',
    '2027-10': 'billable',
    '2027-11': 'archived-before-renewal',
    '2027-12': 'archived-earlier',
  });
  assert.strictEqual(cycleMonth('2027-11', '2027-09-15', '2027-11-03').renewalDay, '2027-11-15', 'names the renewal it skipped');
  assert.strictEqual(cycleMonth('2027-12', '2027-09-15', '2027-11-03').renewalDay, null, 'nothing to name after that');
});

test('archive the day before, the day of, and each day after a renewal', () => {
  const F = '2027-01-15'; // March's renewal is 2027-03-15; its window ends 2027-03-17
  const at = (archived, since) => cycleMonth('2027-03', F, archived, since);
  assert.strictEqual(at('2027-03-14', 0).reason, 'archived-before-renewal');
  assert.strictEqual(at('2027-03-14', 0).billable, false);
  assert.strictEqual(at('2027-03-15', 0).reason, 'renewal-grace', 'on the renewal day, nobody out');
  assert.strictEqual(at('2027-03-15', 1).reason, 'billable', 'someone went out that day');
  assert.strictEqual(at('2027-03-16', 0).reason, 'renewal-grace');
  assert.strictEqual(at('2027-03-17', 0).reason, 'renewal-grace', "the window's last day");
  assert.strictEqual(at('2027-03-17', 1).reason, 'billable');
  assert.strictEqual(at('2027-03-18', 0).reason, 'billable', 'the day after the window');
  for (const archived of ['2027-03-15', '2027-03-16', '2027-03-17']) {
    assert.strictEqual(at(archived, 0).renewalDay, '2027-03-15');
  }
  // Earlier months are untouched by a March archive.
  assert.strictEqual(cycleMonth('2027-02', F, '2027-03-15', 0).reason, 'billable');
});

test('a renewal window that crosses a month end, a year end, and a leap day', () => {
  // Anchor 30: March's renewal is Mar 30, so its window is Mar 30, Mar 31, Apr 1.
  assert.strictEqual(cycleMonth('2027-03', '2027-01-30', '2027-04-01', 0).reason, 'renewal-grace');
  assert.strictEqual(cycleMonth('2027-04', '2027-01-30', '2027-04-01', 0).reason, 'archived-before-renewal');
  assert.strictEqual(cycleMonth('2027-03', '2027-01-30', '2027-04-02', 0).reason, 'billable', 'a day too late');
  // Anchor 31 in December: Dec 31, Jan 1, Jan 2.
  assert.strictEqual(cycleMonth('2027-12', '2027-10-31', '2028-01-02', 0).reason, 'renewal-grace');
  assert.strictEqual(cycleMonth('2028-01', '2027-10-31', '2028-01-02', 0).reason, 'archived-before-renewal');
  // Anchor 31 in February: Feb 28, Mar 1, Mar 2 (and Feb 29 in a leap year).
  assert.strictEqual(cycleMonth('2027-02', '2027-01-31', '2027-03-02', 0).reason, 'renewal-grace');
  assert.strictEqual(cycleMonth('2027-02', '2027-01-31', '2027-03-03', 0).reason, 'billable');
  assert.strictEqual(cycleMonth('2028-02', '2027-12-31', '2028-02-29', 0).renewalDay, '2028-02-29');
  assert.strictEqual(cycleMonth('2028-02', '2027-12-31', '2028-03-02', 0).reason, 'renewal-grace');
  assert.strictEqual(cycleMonth('2028-02', '2027-12-31', '2028-03-03', 0).reason, 'billable');
});

test('the first month always bills, whatever the archive date says', () => {
  const F = '2027-03-10';
  for (const archived of [null, '2027-03-05', '2027-03-10', '2027-03-11', '2027-03-12']) {
    const d = cycleMonth('2027-03', F, archived);
    assert.strictEqual(d.reason, 'billable', `archived ${archived}`);
    assert.strictEqual(d.renewalDay, F);
  }
  assert.strictEqual(needsRenewalVisitCount({ month: '2027-03', firstVisitDay: F, archivedDay: '2027-03-11', cycleFrom: CYCLE }), null);
  // An archive before the first visit (an offline visit uploaded after archiving) bills that month
  // and nothing after.
  assert.strictEqual(cycleMonth('2027-04', F, '2027-03-05').reason, 'archived-earlier');
});

test('needsRenewalVisitCount asks once, for the month whose window holds the archive', () => {
  const base = { firstVisitDay: '2027-01-15', archivedDay: '2027-03-16', cycleFrom: CYCLE };
  const asks = ['2027-01', '2027-02', '2027-03', '2027-04'].map((month) => needsRenewalVisitCount({ ...base, month }));
  assert.deepStrictEqual(asks, [null, null, { from: '2027-03-15', to: '2027-03-16' }, null]);
  // Across a month end, the month that asks is the renewal's, not the archive's.
  const late = { firstVisitDay: '2027-01-31', archivedDay: '2027-03-01', cycleFrom: CYCLE };
  assert.deepStrictEqual(needsRenewalVisitCount({ ...late, month: '2027-02' }), { from: '2027-02-28', to: '2027-03-01' });
  assert.strictEqual(needsRenewalVisitCount({ ...late, month: '2027-03' }), null);
  // Never for a calendar campaign, an unarchived one, or one never out.
  assert.strictEqual(needsRenewalVisitCount({ ...base, month: '2027-03', cycleFrom: CALENDAR }), null);
  assert.strictEqual(needsRenewalVisitCount({ ...base, month: '2027-03', archivedDay: null }), null);
  assert.strictEqual(needsRenewalVisitCount({ ...base, month: '2027-03', firstVisitDay: null }), null);
});

test('a cycle campaign never asks the start-grace question, and calendar ones never renew', () => {
  const graced = { firstVisitDay: '2026-10-29', archivedDay: '2026-11-02', month: '2026-10' };
  assert.strictEqual(needsStartMonthVisitCount({ ...graced, cycleFrom: CALENDAR }), '2026-11');
  assert.strictEqual(needsStartMonthVisitCount({ ...graced, cycleFrom: CYCLE }), null);
  const cal = decideMonth({ month: '2026-03', firstVisitDay: '2026-02-10', archivedDay: null, visitsThisMonth: 3, cycleFrom: CALENDAR });
  assert.strictEqual(cal.billingRule, 'calendar');
  assert.strictEqual(cal.renewalDay, null);
  const cyc = cycleMonth('2026-03', '2026-02-10', null);
  assert.strictEqual(cyc.billingRule, 'cycle');
  assert.strictEqual(cyc.startMonth, '2026-02');
  assert.strictEqual(cyc.floorMonth, null);
});

test('decideMonth refuses to guess a renewal\'s fate without the visit fact', () => {
  assert.throws(
    () => decideMonth({ month: '2027-03', firstVisitDay: '2027-01-15', archivedDay: '2027-03-16', visitsThisMonth: 0, cycleFrom: CYCLE }),
    /visitsSinceRenewal is required/
  );
  // Outside every window the dates decide alone, so the fact isn't needed.
  assert.strictEqual(
    decideMonth({ month: '2027-03', firstVisitDay: '2027-01-15', archivedDay: '2027-03-20', visitsThisMonth: 0, cycleFrom: CYCLE }).reason,
    'billable'
  );
});

test('renewalsAround: the first renewal is never "last", and nothing before the first visit', () => {
  const F = '2027-01-15';
  assert.deepStrictEqual(renewalsAround(F, '2027-01-14'), { last: null, next: null });
  assert.deepStrictEqual(renewalsAround(F, '2027-01-15'), { last: null, next: '2027-02-15' });
  assert.deepStrictEqual(renewalsAround(F, '2027-02-14'), { last: null, next: '2027-02-15' });
  assert.deepStrictEqual(renewalsAround(F, '2027-02-15'), { last: '2027-02-15', next: '2027-03-15' });
  assert.deepStrictEqual(renewalsAround(F, '2027-03-01'), { last: '2027-02-15', next: '2027-03-15' });
  assert.deepStrictEqual(renewalsAround('2027-01-31', '2027-03-01'), { last: '2027-02-28', next: '2027-03-31' });
});

test('reminderDates: the next renewal, plus the last one only inside its 3 days', () => {
  const F = '2027-01-15';
  assert.deepStrictEqual(reminderDates(F, '2027-02-15'), {
    nextRenewalDay: '2027-03-15', lastRenewalDay: '2027-02-15', graceUntilDay: '2027-02-17',
  });
  assert.deepStrictEqual(reminderDates(F, '2027-02-17'), {
    nextRenewalDay: '2027-03-15', lastRenewalDay: '2027-02-15', graceUntilDay: '2027-02-17',
  });
  assert.deepStrictEqual(reminderDates(F, '2027-02-18'), {
    nextRenewalDay: '2027-03-15', lastRenewalDay: null, graceUntilDay: null,
  });
  // The day after the first visit: the first renewal always bills, so nothing is offered as free.
  assert.deepStrictEqual(reminderDates(F, '2027-01-16'), {
    nextRenewalDay: '2027-02-15', lastRenewalDay: null, graceUntilDay: null,
  });
  // First visit Nov 30: no free renewal on Dec 1.
  assert.deepStrictEqual(reminderDates('2026-11-30', '2026-12-01'), {
    nextRenewalDay: '2026-12-30', lastRenewalDay: null, graceUntilDay: null,
  });
  // A first visit stamped after today (a phone's clock) gives no dates at all.
  assert.deepStrictEqual(reminderDates('2027-01-20', '2027-01-19'), {
    nextRenewalDay: null, lastRenewalDay: null, graceUntilDay: null,
  });
  // A clamped renewal's window runs into the next month.
  assert.deepStrictEqual(reminderDates('2027-01-31', '2027-03-01'), {
    nextRenewalDay: '2027-03-31', lastRenewalDay: '2027-02-28', graceUntilDay: '2027-03-02',
  });
});

test('startMonthFor: the first-visit month for cycle, the v3 start month for calendar', () => {
  assert.strictEqual(startMonthFor('2026-11-28', CYCLE), '2026-11', 'no start grace on the new rules');
  assert.strictEqual(startMonthFor('2026-11-28', CALENDAR), '2026-12');
  assert.strictEqual(startMonthFor('2026-11-10', CALENDAR), '2026-11');
  assert.strictEqual(startMonthFor(null, CYCLE), null);
});

// An independent statement of the new rules, by renewal instead of by month: renewal k (k = 0 is
// the first visit) bills unless it is k >= 1 and the archive came before it, or inside its 3 days
// with nobody out since. decideMonth must agree for every anchor day, every archive day, both visit
// answers, across leap and ordinary years.
test('simulation: decideMonth agrees with the by-renewal statement of the rules', () => {
  const starts = ['2027-01', '2027-02', '2027-11', '2027-12', '2028-01', '2028-02'];
  let decisions = 0;
  for (const startMonth of starts) {
    for (let day = 1; day <= daysInMonth(startMonth); day += 1) {
      const F = `${startMonth}-${String(day).padStart(2, '0')}`;
      for (let offset = -1; offset <= 400; offset += 7) {
        const A = addDays(F, offset);
        for (const since of [0, 1]) {
          for (let k = 0; k <= 14; k += 1) {
            const month = addMonths(startMonth, k);
            const R = k === 0 ? F : renewalDayIn(month, F);
            const expectBills = k === 0 || !(A < R || (A <= addDays(R, 2) && since === 0));
            const d = cycleMonth(month, F, A, since);
            assert.strictEqual(d.billable, expectBills, `F=${F} A=${A} since=${since} month=${month}`);
            if (k >= 1 && !expectBills && A >= R) assert.strictEqual(d.reason, 'renewal-grace');
            decisions += 1;
          }
        }
      }
    }
  }
  assert.ok(decisions > 100000, `ran ${decisions} decisions`);
});
