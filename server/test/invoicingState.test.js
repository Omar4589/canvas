import { test } from 'node:test';
import assert from 'node:assert';
import {
  DEFAULT_PAYMENT_TERMS_DAYS,
  INVOICING_LOOKBACK_MAX_MONTHS,
  INVOICING_STATES,
  PAYMENT_STATES,
  NEXT_ACTION_RANK,
  termsDaysFor,
  dueAtFor,
  effectiveDueAt,
  daysOverdue,
  paymentStateOf,
  classifyMonth,
  deriveInvoicing,
  nextActionFor,
  foldIssuedRows,
} from '../src/services/billing/invoicingState.js';

// The invoicing rules with no database and no wall clock. Every `now` here is a fixed instant —
// this file must pass identically on the 1st and the 31st, or the suite is worthless.
//
// The int suite (invoicingState.int.test.js) proves invoicing.js feeds these facts correctly
// against a real mongod; this file proves the decisions themselves.

const NOW = new Date('2026-09-23T12:00:00Z');
const CURRENT_MONTH = '2026-09';

const stmt = (over = {}) => ({
  _id: 'stmt1',
  organizationId: 'org1',
  month: '2026-08',
  status: 'issued',
  totalCents: 30000,
  issuedAt: new Date('2026-09-01T00:00:00Z'),
  dueAt: new Date('2026-10-01T00:00:00Z'),
  paidAt: null,
  lines: [],
  ...over,
});

const liveMonth = (month, totalCents, lines) => ({
  month,
  totalCents,
  rateCents: 30000,
  lines: lines || (totalCents > 0
    ? [{ campaignId: 'c1', name: 'Ward 3', billable: true, reason: 'billable', amountCents: totalCents, isActive: true }]
    : [{ campaignId: 'c1', name: 'Ward 3', billable: false, reason: 'no-field-visit', amountCents: 0, isActive: true }]),
});

// ---- terms and due dates -----------------------------------------------------

test('termsDaysFor defaults to 30 but keeps a deliberate 0', () => {
  assert.strictEqual(termsDaysFor(null), DEFAULT_PAYMENT_TERMS_DAYS);
  assert.strictEqual(termsDaysFor({}), 30);
  assert.strictEqual(termsDaysFor({ paymentTermsDays: 14 }), 14);
  assert.strictEqual(termsDaysFor({ paymentTermsDays: 0 }), 0, 'due on issue is a real setting');
  assert.strictEqual(termsDaysFor({ paymentTermsDays: null }), 30);
});

test('dueAtFor is exact day arithmetic, including terms 0 and 365', () => {
  const issued = new Date('2026-09-01T15:30:00Z');
  assert.strictEqual(dueAtFor(issued, 0).toISOString(), issued.toISOString());
  assert.strictEqual(dueAtFor(issued, 30).toISOString(), '2026-10-01T15:30:00.000Z');
  assert.strictEqual(dueAtFor(issued, 365).toISOString(), '2027-09-01T15:30:00.000Z');
  assert.strictEqual(dueAtFor(null, 30), null);
});

test('dueAtFor counts absolute days, unmoved by a DST transition', () => {
  // US DST ends 2026-11-01. Thirty ABSOLUTE days from Oct 20 is Nov 19 at the same UTC instant —
  // the arithmetic is on instants, so no local-time shift can move an invoice's due date.
  const issued = new Date('2026-10-20T12:00:00Z');
  assert.strictEqual(dueAtFor(issued, 30).toISOString(), '2026-11-19T12:00:00.000Z');
});

test('effectiveDueAt prefers the frozen date and falls back for legacy rows', () => {
  const frozen = stmt({ dueAt: new Date('2026-10-05T00:00:00Z') });
  assert.strictEqual(effectiveDueAt(frozen, 30).toISOString(), '2026-10-05T00:00:00.000Z');
  assert.strictEqual(
    effectiveDueAt(frozen, 90).toISOString(),
    '2026-10-05T00:00:00.000Z',
    'a stored due date is never recomputed from current terms'
  );
  const legacy = stmt({ dueAt: null });
  assert.strictEqual(effectiveDueAt(legacy, 30).toISOString(), '2026-10-01T00:00:00.000Z');
  assert.strictEqual(effectiveDueAt(legacy, 14).toISOString(), '2026-09-15T00:00:00.000Z');
});

test('daysOverdue rounds up whole days and is 0 before the date', () => {
  const late = stmt({ dueAt: new Date('2026-09-10T12:00:00Z') });
  assert.strictEqual(daysOverdue(late, { now: NOW, termsDays: 30 }), 13);
  assert.strictEqual(daysOverdue(stmt(), { now: NOW, termsDays: 30 }), 0);
});

// ---- payment state -----------------------------------------------------------

test('paymentStateOf: the four states, and the boundaries between them', () => {
  const opts = { now: NOW, termsDays: 30 };
  assert.strictEqual(paymentStateOf(null, opts), null);
  assert.strictEqual(paymentStateOf(stmt({ status: 'void' }), opts), null, 'void decides nothing');
  assert.strictEqual(paymentStateOf(stmt({ totalCents: 0 }), opts), 'settled');
  assert.strictEqual(
    paymentStateOf(stmt({ totalCents: 0, paidAt: new Date() }), opts),
    'settled',
    '$0 is settled before anything else — there was never anything to collect'
  );
  assert.strictEqual(paymentStateOf(stmt({ paidAt: new Date('2026-09-20T00:00:00Z') }), opts), 'paid');
  assert.strictEqual(
    paymentStateOf(stmt({ dueAt: new Date('2026-09-01T00:00:00Z'), paidAt: new Date('2026-09-22T00:00:00Z') }), opts),
    'paid',
    'a late payment that arrived is not still overdue'
  );
  assert.strictEqual(paymentStateOf(stmt({ dueAt: new Date('2026-09-01T00:00:00Z') }), opts), 'overdue');
  assert.strictEqual(paymentStateOf(stmt(), opts), 'outstanding');
});

test('the overdue boundary is strict — due exactly now is still outstanding', () => {
  const opts = { now: NOW, termsDays: 30 };
  assert.strictEqual(paymentStateOf(stmt({ dueAt: NOW }), opts), 'outstanding');
  assert.strictEqual(
    paymentStateOf(stmt({ dueAt: new Date(NOW.getTime() - 1) }), opts),
    'overdue',
    'one millisecond past due is overdue'
  );
});

test('PAYMENT_STATES is exhaustive over every statement shape', () => {
  const opts = { now: NOW, termsDays: 30 };
  const shapes = [
    stmt(),
    stmt({ totalCents: 0 }),
    stmt({ paidAt: new Date() }),
    stmt({ dueAt: new Date('2026-01-01T00:00:00Z') }),
    stmt({ dueAt: null }),
  ];
  for (const s of shapes) {
    const ps = paymentStateOf(s, opts);
    assert.ok(PAYMENT_STATES.includes(ps), `${ps} must be a declared payment state`);
  }
});

// ---- month state -------------------------------------------------------------

test('classifyMonth truth table', () => {
  const base = { currentMonth: CURRENT_MONTH, now: NOW, termsDays: 30 };
  const c = (over) => classifyMonth({ ...base, ...over });

  assert.strictEqual(c({ month: '2026-08', frozen: null, liveTotalCents: 0, internal: true }), 'internal');
  assert.strictEqual(
    c({ month: '2026-09', frozen: null, liveTotalCents: 30000 }),
    'open',
    'the running month is never awaiting — you cannot invoice a month that has not finished'
  );
  assert.strictEqual(
    c({ month: '2026-10', frozen: null, liveTotalCents: 0 }),
    'open',
    'a future month reads open, never zero'
  );
  assert.strictEqual(
    c({ month: '2026-09', frozen: stmt({ month: '2026-09' }), liveTotalCents: 30000 }),
    'open',
    'a force-issued current month still shows the running meter'
  );
  assert.strictEqual(c({ month: '2026-08', frozen: null, liveTotalCents: 30000 }), 'awaiting');
  assert.strictEqual(
    c({ month: '2026-08', frozen: null, liveTotalCents: 0 }),
    'zero',
    'a closed $0 month owes nothing and must never be counted as needing an invoice'
  );
  assert.strictEqual(c({ month: '2026-08', frozen: stmt(), liveTotalCents: 30000 }), 'issued');
  assert.strictEqual(
    c({ month: '2026-08', frozen: stmt({ dueAt: new Date('2026-09-01T00:00:00Z') }), liveTotalCents: 30000 }),
    'overdue'
  );
  assert.strictEqual(
    c({ month: '2026-08', frozen: stmt({ paidAt: new Date('2026-09-05T00:00:00Z') }), liveTotalCents: 30000 }),
    'paid'
  );
  assert.strictEqual(c({ month: '2026-08', frozen: stmt({ totalCents: 0 }), liveTotalCents: 0 }), 'settled');
  assert.strictEqual(
    c({ month: '2026-08', frozen: stmt({ dueAt: null }), liveTotalCents: 30000 }),
    'issued',
    'a legacy row with no dueAt falls back to current terms and is not yet due'
  );
  assert.strictEqual(
    c({ month: '2026-08', frozen: null, liveTotalCents: 30000, internal: true }),
    'internal',
    'internal beats everything'
  );
});

test('classifyMonth returns only declared states, and the partition is exclusive', () => {
  const seen = new Set();
  for (const internal of [true, false]) {
    for (const month of ['2026-07', '2026-09', '2026-10']) {
      for (const frozen of [null, stmt(), stmt({ totalCents: 0 }), stmt({ paidAt: new Date() }), stmt({ dueAt: new Date('2026-01-01') })]) {
        for (const liveTotalCents of [0, 30000]) {
          const s = classifyMonth({ month, currentMonth: CURRENT_MONTH, frozen, liveTotalCents, internal, now: NOW, termsDays: 30 });
          assert.ok(INVOICING_STATES.includes(s), `${s} must be a declared invoicing state`);
          seen.add(s);
        }
      }
    }
  }
  // Every declared state is reachable from some combination — a state nothing can produce is a
  // vocabulary the UI would render and never see.
  for (const s of INVOICING_STATES) assert.ok(seen.has(s), `${s} was never produced`);
});

// ---- the org rollup ----------------------------------------------------------

test('deriveInvoicing: awaiting counts only closed months with money and no statement', () => {
  const inv = deriveInvoicing({
    months: [
      liveMonth('2026-06', 30000), // issued below
      liveMonth('2026-07', 0), // closed, nothing to bill → zero, NOT awaiting
      liveMonth('2026-08', 60000), // closed, owed → awaiting
      liveMonth('2026-09', 30000), // running
    ],
    campaigns: [{ campaignId: 'c1', firstKnockAt: new Date('2026-06-10T00:00:00Z') }],
    issuedStatements: [stmt({ month: '2026-06', _id: 's6' })],
    currentMonth: CURRENT_MONTH,
    now: NOW,
    termsDays: 30,
    windowFrom: '2026-06',
  });
  assert.deepStrictEqual(inv.awaiting.months.map((m) => m.month), ['2026-08']);
  assert.strictEqual(inv.awaiting.totalCents, 60000);
  assert.strictEqual(inv.running.totalCents, 30000);
  assert.strictEqual(inv.running.issuedEarly, null);
  assert.strictEqual(inv.outstanding.count, 1, 'the issued June statement is owed');
  assert.strictEqual(inv.outstanding.totalCents, 30000);
});

test('deriveInvoicing stamps when it was computed, so no consumer falls back to a browser clock', () => {
  const inv = deriveInvoicing({ months: [], campaigns: [], issuedStatements: [], currentMonth: CURRENT_MONTH, now: NOW });
  assert.strictEqual(inv.asOf.toISOString(), NOW.toISOString());
});

test('deriveInvoicing: billingSince is the oldest month carrying a billable line', () => {
  const inv = deriveInvoicing({
    months: [liveMonth('2026-06', 0), liveMonth('2026-07', 30000), liveMonth('2026-08', 30000)],
    campaigns: [],
    issuedStatements: [],
    currentMonth: CURRENT_MONTH,
    now: NOW,
  });
  assert.strictEqual(inv.billingSince, '2026-07');
});

test('deriveInvoicing: in the floor corner billingSince reads the month that actually billed', () => {
  // First visit Oct 29 (start grace → bills from Nov), archived Nov 2 with nobody out in November.
  // The floor makes OCTOBER bill. billingStartMonth() would say November — a month AFTER the one
  // that carried the money — so billingSince must read the line, not the campaign's start month.
  const floorLine = [
    { campaignId: 'c1', name: 'Blitz', billable: true, reason: 'floor', amountCents: 30000, isActive: false },
  ];
  const novLine = [
    { campaignId: 'c1', name: 'Blitz', billable: false, reason: 'end-grace', amountCents: 0, isActive: false },
  ];
  const inv = deriveInvoicing({
    months: [liveMonth('2026-10', 30000, floorLine), liveMonth('2026-11', 0, novLine)],
    campaigns: [{ campaignId: 'c1', firstKnockAt: new Date('2026-10-29T00:00:00Z'), billingStartMonth: '2026-11' }],
    issuedStatements: [],
    currentMonth: '2026-12',
    now: new Date('2026-12-10T00:00:00Z'),
  });
  assert.strictEqual(inv.billingSince, '2026-10');
});

test('billingSince survives the desk\'s narrow scan, where frozen rows carry no lines', () => {
  // The desk projects `lines` away and only recomputes the BACKLOG, so a fully-invoiced org's
  // months array may start long after it began billing. Reading frozen.lines there would be
  // undefined and the earliest issued statement is the only remaining evidence — without it the
  // column named the first UNINVOICED month, i.e. the opposite of the answer.
  const inv = deriveInvoicing({
    months: [liveMonth('2026-09', 30000)], // the cheap span: just the running month
    campaigns: [],
    issuedStatements: [
      stmt({ _id: 'a', month: '2026-06', totalCents: 30000 }),
      stmt({ _id: 'b', month: '2026-07', totalCents: 30000 }),
    ].map(({ lines, ...rest }) => rest), // lines: 0 projection — the key is ABSENT
    currentMonth: CURRENT_MONTH,
    now: NOW,
    windowFrom: '2026-09',
  });
  assert.strictEqual(inv.billingSince, '2026-06', 'the earliest issued statement is proof its month billed');
});

test('a $0 issued statement does not backdate billingSince', () => {
  const inv = deriveInvoicing({
    months: [liveMonth('2026-09', 30000)],
    campaigns: [],
    issuedStatements: [stmt({ month: '2026-04', totalCents: 0, lines: undefined })],
    currentMonth: CURRENT_MONTH,
    now: NOW,
  });
  assert.strictEqual(
    inv.billingSince,
    '2026-09',
    'it reads the month that actually has a billable line — a settled $0 statement is not evidence of billing'
  );
});

test('deriveInvoicing: a voided-and-not-reissued month returns to awaiting', () => {
  const inv = deriveInvoicing({
    months: [liveMonth('2026-08', 30000)],
    campaigns: [],
    // A void row is not an issued statement, so the month has none.
    issuedStatements: [stmt({ status: 'void', month: '2026-08' })],
    currentMonth: CURRENT_MONTH,
    now: NOW,
  });
  assert.deepStrictEqual(inv.awaiting.months.map((m) => m.month), ['2026-08']);
  assert.strictEqual(inv.outstanding.count, 0, 'a void statement owes nothing');
});

test('deriveInvoicing: an issued month never returns to awaiting, even when it drifts', () => {
  const inv = deriveInvoicing({
    months: [liveMonth('2026-08', 60000)], // live says $600
    campaigns: [],
    issuedStatements: [stmt({ month: '2026-08', totalCents: 30000 })], // we invoiced $300
    currentMonth: CURRENT_MONTH,
    now: NOW,
  });
  assert.strictEqual(inv.awaiting.months.length, 0);
  assert.strictEqual(inv.outstanding.totalCents, 30000, 'what is owed is what was sent');
  assert.deepStrictEqual(inv.drifting.map((d) => d.month), ['2026-08']);
  assert.strictEqual(inv.drifting[0].liveTotalCents, 60000);
});

test('deriveInvoicing: overdue, paid and next-due aggregates', () => {
  const inv = deriveInvoicing({
    months: [],
    campaigns: [],
    issuedStatements: [
      stmt({ _id: 'a', month: '2026-05', dueAt: new Date('2026-06-15T00:00:00Z') }), // overdue 100d
      stmt({ _id: 'b', month: '2026-06', dueAt: new Date('2026-09-30T00:00:00Z') }), // outstanding
      stmt({ _id: 'c', month: '2026-07', paidAt: new Date('2026-09-10T00:00:00Z') }), // paid
      stmt({ _id: 'd', month: '2026-04', totalCents: 0 }), // settled — invisible to money
      stmt({ _id: 'e', month: '2026-03', status: 'void' }), // void — invisible
    ],
    currentMonth: CURRENT_MONTH,
    now: NOW,
  });
  assert.strictEqual(inv.outstanding.count, 2, 'overdue rows are also outstanding');
  assert.strictEqual(inv.outstanding.totalCents, 60000);
  assert.strictEqual(inv.outstanding.nextDueAt.toISOString(), '2026-09-30T00:00:00.000Z');
  assert.strictEqual(inv.overdue.count, 1);
  assert.strictEqual(inv.overdue.totalCents, 30000);
  // Jun 15 00:00 → Sep 23 12:00 is 100.5 days; a part-day late is a day late, so it rounds up.
  assert.strictEqual(inv.overdue.maxDaysOverdue, 101);
  assert.strictEqual(inv.paid.count, 1);
  assert.strictEqual(inv.paid.last12Cents, 30000);
  assert.strictEqual(inv.paid.lastPaidAt.toISOString(), '2026-09-10T00:00:00.000Z');
});

test('deriveInvoicing: a force-issued current month shows the meter AND is owed', () => {
  const frozen = stmt({ month: '2026-09', _id: 'early', totalCents: 30000 });
  const inv = deriveInvoicing({
    months: [liveMonth('2026-09', 30000)],
    campaigns: [],
    issuedStatements: [frozen],
    currentMonth: CURRENT_MONTH,
    now: NOW,
  });
  assert.ok(inv.running.issuedEarly, 'the running card says it was issued early');
  assert.strictEqual(inv.awaiting.months.length, 0, 'never awaiting — it already has a statement');
  assert.strictEqual(inv.outstanding.count, 1, 'but it carries a due date and someone must pay it');
});

test('deriveInvoicing: an unpaid statement older than the scan window still counts', () => {
  const inv = deriveInvoicing({
    months: [liveMonth('2026-08', 0)], // the window only reaches August
    campaigns: [],
    issuedStatements: [stmt({ month: '2023-01', dueAt: new Date('2023-02-01T00:00:00Z') })],
    currentMonth: CURRENT_MONTH,
    now: NOW,
    windowFrom: '2026-08',
    windowTruncated: true,
  });
  assert.strictEqual(inv.overdue.count, 1, 'statements are read org-wide, never window-bound');
  assert.strictEqual(inv.window.truncated, true);
});

test('deriveInvoicing: an internal org produces no money signals at all', () => {
  const inv = deriveInvoicing({
    months: [liveMonth('2026-08', 30000), liveMonth('2026-09', 30000)],
    campaigns: [],
    issuedStatements: [],
    currentMonth: CURRENT_MONTH,
    now: NOW,
    internal: true,
  });
  assert.strictEqual(inv.internal, true);
  assert.strictEqual(inv.awaiting.months.length, 0);
  assert.ok(inv.monthStates.every((m) => m.state === 'internal'));
});

// ---- next action -------------------------------------------------------------

test('nextActionFor precedence, and the rank order the desk sorts by', () => {
  const clean = { overdue: { count: 0 }, awaiting: { months: [] }, outstanding: { count: 0 } };
  const ent = { banner: null, trialDaysLeft: null };
  assert.strictEqual(nextActionFor({ invoicing: clean, entitlement: ent, sub: { status: 'active' } }), 'none');
  assert.strictEqual(
    nextActionFor({ invoicing: { ...clean, outstanding: { count: 1 } }, entitlement: ent, sub: { status: 'active' } }),
    'await_payment'
  );
  assert.strictEqual(
    nextActionFor({ invoicing: { ...clean, awaiting: { months: [{}] } }, entitlement: ent, sub: { status: 'active' } }),
    'issue'
  );
  assert.strictEqual(
    nextActionFor({ invoicing: clean, entitlement: { banner: 'trial_expired' }, sub: { status: 'trial' } }),
    'rescue_trial'
  );
  assert.strictEqual(
    nextActionFor({
      invoicing: { ...clean, awaiting: { months: [{}] } },
      entitlement: { trialDaysLeft: 2 },
      sub: { status: 'trial' },
    }),
    'rescue_trial',
    'an expiring trial outranks issuing — the customer stops working when it lapses'
  );
  assert.strictEqual(
    nextActionFor({
      invoicing: { ...clean, overdue: { count: 1 } },
      entitlement: { banner: 'trial_expired' },
      sub: { status: 'trial' },
    }),
    'chase',
    'money already owed outranks everything'
  );
  assert.strictEqual(
    nextActionFor({
      invoicing: clean,
      // The deletion date is on the ENTITLEMENT (entitlementFor computes it); Subscription has no
      // such path, so passing it on `sub` would test a shape production never produces.
      entitlement: { windDownEndsAt: new Date('2026-11-01T00:00:00Z') },
      sub: { status: 'canceled' },
    }),
    'wind_down'
  );
  assert.strictEqual(
    nextActionFor({ invoicing: clean, entitlement: ent, sub: { status: 'canceled' } }),
    'none',
    'a canceled org with no resolved deletion date has no wind-down to act on'
  );
  assert.strictEqual(
    nextActionFor({ invoicing: { ...clean, internal: true, overdue: { count: 9 } }, entitlement: ent, sub: {} }),
    'none',
    'an internal org is never chased'
  );
  assert.ok(NEXT_ACTION_RANK.chase < NEXT_ACTION_RANK.rescue_trial);
  assert.ok(NEXT_ACTION_RANK.rescue_trial < NEXT_ACTION_RANK.issue);
  assert.ok(NEXT_ACTION_RANK.issue < NEXT_ACTION_RANK.await_payment);
  assert.ok(NEXT_ACTION_RANK.await_payment < NEXT_ACTION_RANK.none);
});

// ---- the cheap list path -----------------------------------------------------

test('foldIssuedRows groups by org, honours per-org terms, and ignores void and $0', () => {
  const rows = [
    stmt({ _id: '1', organizationId: 'A', month: '2026-06', dueAt: new Date('2026-07-01T00:00:00Z') }),
    stmt({ _id: '2', organizationId: 'A', month: '2026-07', dueAt: new Date('2026-10-05T00:00:00Z') }),
    stmt({ _id: '3', organizationId: 'A', month: '2026-05', paidAt: new Date('2026-08-01T00:00:00Z') }),
    stmt({ _id: '4', organizationId: 'B', month: '2026-08', totalCents: 0 }),
    stmt({ _id: '5', organizationId: 'B', month: '2026-07', status: 'void' }),
    // Legacy row for org C: no dueAt. Org C is on net-14, so issuedAt + 14d = Sep 15 — overdue.
    stmt({ _id: '6', organizationId: 'C', month: '2026-08', dueAt: null }),
  ];
  const out = foldIssuedRows(rows, { now: NOW, termsByOrg: new Map([['C', 14]]) });

  const a = out.get('A');
  assert.strictEqual(a.outstandingCount, 2);
  assert.strictEqual(a.outstandingCents, 60000);
  assert.strictEqual(a.overdueCount, 1);
  assert.strictEqual(a.overdueCents, 30000);
  assert.strictEqual(a.oldestDueAt.toISOString(), '2026-07-01T00:00:00.000Z');
  assert.strictEqual(a.lastPaidAt.toISOString(), '2026-08-01T00:00:00.000Z');

  const b = out.get('B');
  assert.strictEqual(b.outstandingCount, 0, 'a $0 settled row and a void row owe nothing');
  assert.strictEqual(b.overdueCount, 0);

  const c = out.get('C');
  assert.strictEqual(c.overdueCount, 1, 'a legacy row falls back to the ORG’s terms, not the default');
  assert.strictEqual(c.maxDaysOverdue, 9, 'Sep 15 → Sep 23 12:00 is 8.5 days, rounded up');
});

test('the lookback window is its own constant, wider than the history cap', () => {
  assert.strictEqual(INVOICING_LOOKBACK_MAX_MONTHS, 36);
});
