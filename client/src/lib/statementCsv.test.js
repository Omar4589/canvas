import { test } from 'node:test';
import assert from 'node:assert';
import {
  statementCsvRows,
  statementCsvName,
  combinedCsvRows,
  combinedCsvName,
  provenance,
  paymentCell,
} from './statementCsv.js';

// The sheet that gets attached to an invoice email. What matters is that it says where its numbers
// came from and whether the money arrived — an unlabelled export is how a live recompute gets
// mistaken for what was actually billed.

const line = (over = {}) => ({
  name: 'Ward 3',
  households: 900,
  firstKnockAt: '2026-06-14T15:00:00Z',
  billingStartMonth: '2026-06',
  archivedAt: null,
  knocksThisMonth: 412,
  restrictedDoorsThisMonth: 8,
  billableDoorsThisMonth: 420,
  billRestrictedDoors: false,
  billable: true,
  reason: 'billable',
  rateCents: 30000,
  amountCents: 30000,
  ...over,
});

test('provenance names the source, and never lets a live sheet pass for an issued one', () => {
  assert.strictEqual(provenance({}), 'LIVE — not issued, recomputed on export');
  const p = provenance({ issued: true, issuedAt: '2026-08-01T00:00:00Z', issuedBy: 'Sue Super', rulesVersion: 3, externalRef: 'INV-7' });
  assert.ok(p.startsWith('ISSUED'));
  assert.ok(p.includes('Sue Super') && p.includes('rules v3') && p.includes('INV-7'));
});

test('the payment cell states the four outcomes plainly', () => {
  assert.strictEqual(paymentCell({}), '', 'a live month has no payment state');
  assert.strictEqual(paymentCell({ issued: true, totalCents: 0, paymentState: 'settled' }), 'SETTLED ($0)');
  assert.strictEqual(
    paymentCell({ issued: true, totalCents: 30000, paidAt: '2026-09-10T00:00:00Z', paymentRef: 'CHK 1' }),
    'PAID 2026-09-10 ref CHK 1'
  );
  assert.strictEqual(
    paymentCell({ issued: true, totalCents: 30000, paymentState: 'overdue', dueAt: '2026-08-31T00:00:00Z' }),
    'OVERDUE — was due 2026-08-31'
  );
  assert.strictEqual(
    paymentCell({ issued: true, totalCents: 30000, paymentState: 'outstanding', dueAt: '2026-10-31T00:00:00Z' }),
    'UNPAID — due 2026-10-31'
  );
});

test('a single-month sheet leads with its provenance and payment, then the lines, then a total', () => {
  const rows = statementCsvRows({
    month: '2026-07',
    view: { lines: [line(), line({ name: 'Mayor', billable: false, reason: 'no-field-visit', amountCents: 0 })], totalCents: 30000 },
    statement: { issuedAt: '2026-08-01T00:00:00Z', issuedBy: 'Sue', rulesVersion: 3, externalRef: 'INV-7', totalCents: 30000, dueAt: '2026-08-31T00:00:00Z', paymentState: 'outstanding' },
    orgName: 'Acme Campaigns',
  });
  assert.strictEqual(rows[0][0], 'Statement');
  assert.ok(String(rows[0][2]).startsWith('ISSUED'), 'the FIRST thing the sheet says is where it came from');
  assert.strictEqual(rows[1][0], 'Payment');
  assert.ok(rows[3].includes('Bills from'), 'the start-grace month has its own column');
  assert.strictEqual(rows[rows.length - 1][0], 'Total');
  assert.strictEqual(rows[rows.length - 1][11], '300.00');
  // Nothing may be undefined: a hole in a CSV reads as a data error to whoever opens it.
  for (const r of rows) for (const cell of r) assert.notStrictEqual(cell, undefined);
});

test('a combined sheet runs oldest first, subtotals each month, and totals the lot', () => {
  const rows = combinedCsvRows({
    orgName: 'Acme',
    months: [
      { month: '2026-08', issued: false, totalCents: 60000, lines: [line(), line({ name: 'Mayor' })] },
      { month: '2026-07', issued: true, issuedAt: '2026-08-01T00:00:00Z', rulesVersion: 3, totalCents: 30000, paidAt: '2026-09-01T00:00:00Z', lines: [line()] },
    ],
  });
  const monthCol = rows.filter((r) => r[0] === '2026-07' || r[0] === '2026-08').map((r) => r[0]);
  assert.strictEqual(monthCol[0], '2026-07', 'an invoice reads forwards even though the screen reads backwards');
  assert.ok(rows.some((r) => r[0] === '2026-07 subtotal'));
  assert.ok(rows.some((r) => r[0] === '2026-08 subtotal'));
  const total = rows.find((r) => r[0] === 'TOTAL');
  assert.strictEqual(total[total.length - 1], '900.00', 'the grand total is the sum of the subtotals');
  const julyLine = rows.find((r) => r[0] === '2026-07');
  assert.ok(String(julyLine[1]).startsWith('ISSUED'));
  assert.ok(String(julyLine[2]).startsWith('PAID'));
  const augLine = rows.find((r) => r[0] === '2026-08');
  assert.ok(String(augLine[1]).startsWith('LIVE'), 'an unissued month is labelled live on every one of its lines');
});

test('file names carry the org, the months and the provenance', () => {
  assert.strictEqual(
    statementCsvName({ orgName: 'Acme Campaigns', month: '2026-07', issued: true }),
    'acme-campaigns-statement-2026-07-issued.csv'
  );
  assert.strictEqual(
    statementCsvName({ orgName: 'Acme Campaigns', month: '2026-07', issued: false }),
    'acme-campaigns-statement-2026-07-live.csv'
  );
  assert.strictEqual(
    combinedCsvName({ orgName: 'Acme', months: [{ month: '2026-08' }, { month: '2026-07' }] }),
    'acme-statements-2026-07-to-2026-08.csv'
  );
});

test('an empty selection produces no sheet rather than a header with nothing under it', () => {
  assert.deepStrictEqual(combinedCsvRows({ months: [], orgName: 'Acme' }), []);
});
