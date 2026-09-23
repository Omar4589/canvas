import { fmtUsd } from './money.js';
import { formatDate } from './dates.js';
import { monthLabel } from './months.js';

// A billing audit row, in one sentence.
//
// SubscriptionEvent.changes has always carried the before/after values; the history used to render
// most of them as a bare "X updated", which is the one thing an audit trail must not say. Lifted
// out of OrgBillingPanel so the org page's Account tab and anything else reading the trail phrase
// an event identically.
//
// The unknown-key fallback is deliberate and tested: a future field must degrade to
// "<key> updated" rather than rendering nothing, because a silent event is worse than a vague one.
export const changeText = (ch) => {
  if (!ch || typeof ch !== 'object') return '';
  const parts = [];

  if (ch.pricePerCampaignCents) {
    parts.push(`rate ${fmtUsd(ch.pricePerCampaignCents.from ?? 30000)} → ${fmtUsd(ch.pricePerCampaignCents.to)}`);
  }
  if (ch.paymentTermsDays) {
    const from = ch.paymentTermsDays.from;
    parts.push(`payment terms ${from == null ? 'net 30' : `net ${from}`} → net ${ch.paymentTermsDays.to}`);
  }
  if (ch.billingContact) {
    const to = ch.billingContact.to || {};
    parts.push(`contact → ${[to.name, to.email].filter(Boolean).join(' · ') || '(cleared)'}`);
  }
  if (ch.trialEndsAt) parts.push(`trial end ${formatDate(ch.trialEndsAt.from)} → ${formatDate(ch.trialEndsAt.to)}`);
  if (ch.notes) parts.push('notes updated');
  if (ch.campaignRate) {
    const { campaignName, from, to } = ch.campaignRate;
    parts.push(
      `rate for ${campaignName || 'a campaign'} ${from == null ? 'org default' : fmtUsd(from)} → ${
        to == null ? 'org default' : fmtUsd(to)
      }`
    );
  }
  if (ch.statementIssued) {
    const s = ch.statementIssued;
    parts.push(
      `statement ${monthLabel(s.month)} issued · ${fmtUsd(s.totalCents)}` +
        `${s.externalRef ? ` · ref ${s.externalRef}` : ''}` +
        `${s.dueAt ? ` · due ${formatDate(s.dueAt)}` : ''}`
    );
  }
  if (ch.statementVoided) {
    parts.push(`statement ${monthLabel(ch.statementVoided.month)} voided · ${fmtUsd(ch.statementVoided.totalCents)}`);
  }
  if (ch.statementPaid) {
    const s = ch.statementPaid;
    parts.push(
      `statement ${monthLabel(s.month)} marked paid · ${fmtUsd(s.totalCents)} · paid ${formatDate(s.paidAt)}` +
        `${s.paymentRef ? ` · ref ${s.paymentRef}` : ''}`
    );
  }
  if (ch.statementUnpaid) {
    const s = ch.statementUnpaid;
    // Names the values the row no longer holds — this event IS the record that the money arrived.
    parts.push(
      `statement ${monthLabel(s.month)} unmarked paid (was paid ${formatDate(s.previousPaidAt)}` +
        `${s.previousPaymentRef ? `, ref ${s.previousPaymentRef}` : ''})`
    );
  }

  const known = [
    'pricePerCampaignCents', 'paymentTermsDays', 'billingContact', 'trialEndsAt', 'notes',
    'campaignRate', 'statementIssued', 'statementVoided', 'statementPaid', 'statementUnpaid',
  ];
  const rest = Object.keys(ch).filter((k) => !known.includes(k));
  if (rest.length) parts.push(`${rest.join(', ')} updated`);
  return parts.join(' · ');
};
