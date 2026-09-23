import { test } from 'node:test';
import assert from 'node:assert';
import {
  INVOICING_STATES,
  INVOICING_STATE_META,
  stateMeta,
  daysOverdue,
  dueLabel,
  reasonLabel,
  nextActions,
  nextActionLabel,
  ledgerFilter,
  pickedSummary,
  campaignInvoicing,
  campaignRows,
  campaignNeedsAttention,
} from './invoicing.js';

// The client half of the invoicing vocabulary. The server owns the decisions; what can go wrong
// here is a state nothing renders, a filter that quietly includes a paid month, or a campaign fold
// that counts a non-billable line.

const ASOF = '2026-09-23T12:00:00.000Z';
const CURRENT = '2026-09';

test('every server state has a client rendering, and nothing extra', () => {
  // A state the server sends and the client cannot render is a blank cell; one the client knows
  // and the server never sends is dead vocabulary. This list is copied from
  // server/src/services/billing/invoicingState.js INVOICING_STATES.
  const SERVER_STATES = ['internal', 'open', 'awaiting', 'zero', 'issued', 'overdue', 'paid', 'settled'];
  assert.deepStrictEqual([...INVOICING_STATES].sort(), [...SERVER_STATES].sort());
  assert.deepStrictEqual(Object.keys(INVOICING_STATE_META).sort(), [...SERVER_STATES].sort());
});

test('each state renders a label and a token variant, never a raw key', () => {
  for (const s of INVOICING_STATES) {
    const meta = stateMeta(s, { dueAt: ASOF, paidAt: ASOF, closesOn: ASOF, asOf: ASOF });
    assert.ok(meta.label && typeof meta.label === 'string', `${s} has a label`);
    assert.ok(
      ['neutral', 'brand', 'success', 'warning', 'danger', 'info'].includes(meta.variant),
      `${s} uses a design-system variant, not a hard-coded colour`
    );
  }
  assert.strictEqual(stateMeta('awaiting').label, 'Needs invoice');
  assert.strictEqual(stateMeta('zero').label, 'Nothing to bill');
  assert.strictEqual(stateMeta('settled').label, 'Settled ($0)');
  assert.strictEqual(stateMeta('unknown-future-state').variant, 'neutral', 'an unknown state degrades, never throws');
});

test('daysOverdue reads the response stamp, not the browser clock', () => {
  assert.strictEqual(daysOverdue('2026-09-10T12:00:00Z', ASOF), 13);
  assert.strictEqual(daysOverdue('2026-09-23T12:00:00Z', ASOF), 0, 'due exactly now is not late');
  assert.strictEqual(daysOverdue('2026-10-01T00:00:00Z', ASOF), 0);
  assert.strictEqual(daysOverdue(null, ASOF), 0);
  assert.strictEqual(
    daysOverdue('2026-09-23T00:00:00Z', ASOF),
    1,
    'a part-day late is a day late — matches the server'
  );
});

test('dueLabel flips at the due date', () => {
  assert.ok(dueLabel('2026-10-05T00:00:00Z', ASOF).startsWith('Due '));
  assert.strictEqual(dueLabel('2026-09-01T12:00:00Z', ASOF), '22d overdue');
  assert.strictEqual(dueLabel(null, ASOF), '—');
});

test('reasonLabel explains every rule code in plain words', () => {
  for (const code of ['billable', 'no-field-visit', 'start-grace', 'end-grace', 'floor', 'before-start', 'archived-earlier']) {
    const label = reasonLabel(code);
    assert.ok(label && label !== code, `${code} is explained, not echoed`);
  }
  assert.strictEqual(reasonLabel('something-new'), 'something-new', 'an unknown code still says something');
});

// ---- next actions ------------------------------------------------------------

const inv = (over = {}) => ({
  internal: false,
  asOf: ASOF,
  awaiting: { months: [], totalCents: 0 },
  outstanding: { count: 0, totalCents: 0 },
  overdue: { count: 0, totalCents: 0 },
  drifting: [],
  ...over,
});

test('nextActions lists everything open, most urgent first', () => {
  const items = nextActions(
    inv({
      overdue: { count: 1, totalCents: 30000, statements: [{ month: '2026-07', totalCents: 30000, dueAt: '2026-08-31T00:00:00Z' }] },
      awaiting: { months: [{ month: '2026-08', totalCents: 60000 }], totalCents: 60000 },
      drifting: [{ month: '2026-06', issuedTotalCents: 30000, liveTotalCents: 60000 }],
    }),
    { banner: 'trial_expired' },
    { orgId: 'abc' }
  );
  assert.deepStrictEqual(items.map((i) => i.kind), ['overdue', 'trial', 'awaiting', 'drift']);
  assert.ok(items[0].label.includes('overdue'));
  assert.ok(items[2].href.includes('tab=statements&month=2026-08'), 'each item links to where it is fixed');
});

test('nextActions is empty for a clean org, and for an internal one whatever it owes', () => {
  assert.deepStrictEqual(nextActions(inv(), {}, { orgId: 'x' }), []);
  assert.deepStrictEqual(
    nextActions(inv({ internal: true, overdue: { count: 9, totalCents: 99999 } }), {}, { orgId: 'x' }),
    [],
    'an internal org is never chased'
  );
});

test('nextActionLabel says what to do and which tab does it', () => {
  assert.deepStrictEqual(
    nextActionLabel({ nextAction: 'issue', invoicing: inv({ awaiting: { months: [{}, {}], totalCents: 1 } }) }),
    { label: 'Issue 2 months', tab: 'statements', tone: 'warning' }
  );
  assert.strictEqual(nextActionLabel({ nextAction: 'issue', invoicing: inv({ awaiting: { months: [{}] } }) }).label, 'Issue 1 month');
  assert.strictEqual(nextActionLabel({ nextAction: 'chase', invoicing: inv({ overdue: { totalCents: 60000 } }) }).label, 'Chase $600');
  assert.strictEqual(nextActionLabel({ nextAction: 'rescue_trial' }).tab, 'account');
  assert.strictEqual(nextActionLabel({}).label, '—');
});

// ---- the ledger --------------------------------------------------------------

const MONTHS = [
  { month: '2026-09', state: 'open', issued: false, totalCents: 30000, lines: [] },
  { month: '2026-08', state: 'awaiting', issued: false, totalCents: 60000, lines: [] },
  { month: '2026-07', state: 'overdue', issued: true, totalCents: 30000, lines: [] },
  { month: '2026-06', state: 'paid', issued: true, totalCents: 30000, lines: [] },
  { month: '2026-05', state: 'zero', issued: false, totalCents: 0, lines: [] },
  { month: '2026-04', state: 'settled', issued: true, totalCents: 0, lines: [] },
];

test('the Outstanding filter means money out — never paid, never a $0 settled row', () => {
  assert.deepStrictEqual(ledgerFilter(MONTHS, 'outstanding').map((m) => m.month), ['2026-07']);
  assert.deepStrictEqual(ledgerFilter(MONTHS, 'awaiting').map((m) => m.month), ['2026-08']);
  assert.deepStrictEqual(ledgerFilter(MONTHS, 'paid').map((m) => m.month), ['2026-06']);
  assert.deepStrictEqual(ledgerFilter(MONTHS, 'issued').map((m) => m.month), ['2026-07', '2026-06', '2026-04']);
  assert.strictEqual(ledgerFilter(MONTHS, 'all').length, 6);
  assert.strictEqual(ledgerFilter(MONTHS, 'nonsense').length, 6, 'an unknown filter shows everything, never nothing');
});

test('pickedSummary totals the ticked months and flags what needs force', () => {
  const picked = new Set(['2026-09', '2026-08', '2026-07']);
  const s = pickedSummary(MONTHS, picked, CURRENT);
  assert.strictEqual(s.count, 3);
  assert.strictEqual(s.totalCents, 120000);
  assert.deepStrictEqual(s.unissuedMonths, ['2026-09', '2026-08'], 'an already-issued month is not offered again');
  assert.deepStrictEqual(s.openMonths, ['2026-09'], 'the running month needs force, and the modal must say so');
});

// ---- the campaign pivot ------------------------------------------------------

const line = (id, over = {}) => ({
  campaignId: id, name: `C${id}`, billable: true, reason: 'billable', amountCents: 30000, rateCents: 30000, ...over,
});

const PIVOT_MONTHS = [
  { month: '2026-09', state: 'open', lines: [line('a'), line('b', { billable: false, reason: 'no-field-visit', amountCents: 0 })] },
  { month: '2026-08', state: 'awaiting', lines: [line('a')] },
  { month: '2026-07', state: 'overdue', lines: [line('a')] },
  { month: '2026-06', state: 'paid', lines: [line('a'), line('b')] },
];

test('campaignInvoicing folds months sideways and ignores non-billable lines', () => {
  const fold = campaignInvoicing(PIVOT_MONTHS);
  const a = fold.get('a');
  assert.strictEqual(a.monthsBilled, 4);
  assert.strictEqual(a.billedToDateCents, 120000);
  assert.strictEqual(a.awaitingMonths, 1);
  assert.strictEqual(a.overdueMonths, 1);
  assert.strictEqual(a.paidMonths, 1);
  assert.deepStrictEqual(a.byMonth.map((m) => m.month), ['2026-06', '2026-07', '2026-08', '2026-09'], 'oldest first');

  const b = fold.get('b');
  assert.strictEqual(b.monthsBilled, 1, 'the September line is not billable and must not be counted');
  assert.strictEqual(b.billedToDateCents, 30000);
});

test('campaignRows joins the facts and reports this month plainly', () => {
  const rows = campaignRows({
    campaigns: [
      { campaignId: 'a', name: 'Ward 3', isActive: true, firstKnockAt: '2026-06-10T00:00:00Z', billingStartMonth: '2026-06', households: 900 },
      { campaignId: 'b', name: 'Mayor', isActive: true, firstKnockAt: null, billingStartMonth: null, households: 40 },
    ],
    months: PIVOT_MONTHS,
    detailCampaigns: [{ id: 'a', lastActivityAt: '2026-09-20T00:00:00Z' }],
    currentMonth: CURRENT,
  });
  const a = rows.find((r) => r.campaignId === 'a');
  assert.strictEqual(a.started, true);
  assert.strictEqual(a.monthsBilled, 4);
  assert.strictEqual(a.thisMonth.billable, true);
  assert.strictEqual(a.lastActivityAt, '2026-09-20T00:00:00Z');

  const b = rows.find((r) => r.campaignId === 'b');
  assert.strictEqual(b.started, false, 'never been to the field');
  assert.strictEqual(b.thisMonth.billable, false);
  assert.strictEqual(b.thisMonth.reason, 'no-field-visit');
});

test('campaigns sort by what needs attention, not alphabetically', () => {
  const rows = [
    { name: 'Zeta', isActive: true, overdueMonths: 0, awaitingMonths: 0 },
    { name: 'Alpha', isActive: true, overdueMonths: 0, awaitingMonths: 2 },
    { name: 'Beta', isActive: false, overdueMonths: 1, awaitingMonths: 0 },
    { name: 'Gamma', isActive: false, overdueMonths: 0, awaitingMonths: 0 },
  ].sort(campaignNeedsAttention);
  assert.deepStrictEqual(rows.map((r) => r.name), ['Beta', 'Alpha', 'Zeta', 'Gamma']);
});
