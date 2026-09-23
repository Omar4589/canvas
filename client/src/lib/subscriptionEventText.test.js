import { test } from 'node:test';
import assert from 'node:assert';
import { changeText } from './subscriptionEventText.js';
import { formatDate } from './dates.js';

// An audit row must never render as nothing, and must never render as "changes updated". Those are
// the two failure modes this file exists to catch.

test('every known change kind renders its before and after', () => {
  assert.strictEqual(changeText({ pricePerCampaignCents: { from: 30000, to: 25000 } }), 'rate $300 → $250');
  assert.strictEqual(changeText({ paymentTermsDays: { from: 30, to: 14 } }), 'payment terms net 30 → net 14');
  assert.strictEqual(
    changeText({ paymentTermsDays: { from: null, to: 45 } }),
    'payment terms net 30 → net 45',
    'an org that never had explicit terms was on the default'
  );
  assert.strictEqual(changeText({ billingContact: { to: { name: 'Ada', email: 'a@b.co' } } }), 'contact → Ada · a@b.co');
  assert.strictEqual(changeText({ billingContact: { to: {} } }), 'contact → (cleared)');
  assert.strictEqual(changeText({ notes: { updated: true } }), 'notes updated');
  assert.strictEqual(
    changeText({ campaignRate: { campaignName: 'Ward 3', from: null, to: 25000 } }),
    'rate for Ward 3 org default → $250'
  );
});

test('statement events name the month in words, plus the money and the reference', () => {
  // Dates are compared through formatDate, not pinned: they render in the reader's local zone.
  assert.strictEqual(
    changeText({ statementIssued: { month: '2026-07', totalCents: 60000, externalRef: 'INV-118', dueAt: '2026-09-01T00:00:00Z' } }),
    `statement July 2026 issued · $600 · ref INV-118 · due ${formatDate('2026-09-01T00:00:00Z')}`
  );
  assert.strictEqual(
    changeText({ statementVoided: { month: '2026-07', totalCents: 60000 } }),
    'statement July 2026 voided · $600'
  );
  assert.strictEqual(
    changeText({ statementPaid: { month: '2026-07', totalCents: 60000, paidAt: '2026-09-10T00:00:00Z', paymentRef: 'CHK 4471' } }),
    `statement July 2026 marked paid · $600 · paid ${formatDate('2026-09-10T00:00:00Z')} · ref CHK 4471`
  );
});

test('unmarking paid keeps the values the row no longer holds', () => {
  // This event IS the record that the money arrived — the fields on the statement are cleared.
  const text = changeText({
    statementUnpaid: { month: '2026-07', totalCents: 60000, previousPaidAt: '2026-09-10T00:00:00Z', previousPaymentRef: 'CHK 4471' },
  });
  assert.ok(text.includes(formatDate('2026-09-10T00:00:00Z')), 'the date survives the erasure');
  assert.ok(text.includes('CHK 4471'), 'so does the reference');
  assert.ok(text.includes('unmarked paid'));
});

test('several changes in one event read as one sentence', () => {
  const text = changeText({ pricePerCampaignCents: { from: 30000, to: 25000 }, notes: { updated: true } });
  assert.strictEqual(text, 'rate $300 → $250 · notes updated');
});

test('an unknown key degrades rather than vanishing', () => {
  assert.strictEqual(changeText({ someFutureField: { from: 1, to: 2 } }), 'someFutureField updated');
  assert.strictEqual(changeText({}), '');
  assert.strictEqual(changeText(null), '', 'a malformed event never throws');
  assert.strictEqual(changeText('nonsense'), '');
});
