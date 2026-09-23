import Badge from '../components/ui/Badge.jsx';
import { fmtUsd } from './money.js';

// Shared billing-status display metadata, so the Organizations desk, the org page, the Control
// Room, the month-close board and the customer's own Billing page all render the same state the
// same way. Keyed by the EFFECTIVE state from entitlementFor.
//
// Now expressed as Badge VARIANTS rather than class strings. The old table hard-coded a raw green
// palette pair for `active` while every other row used semantic tokens, so that one pill did not
// flip in dark mode and drifted from the rest of the design system.
export const BILLING_STATUS_META = {
  internal: { label: 'Internal', variant: 'neutral' },
  trial: { label: 'Trial', variant: 'info' },
  active: { label: 'Active', variant: 'success' },
  past_due: { label: 'Past due', variant: 'warning' },
  suspended: { label: 'Suspended', variant: 'danger' },
  canceled: { label: 'Canceled', variant: 'neutral' },
  // NOT an effective state — see accountStateMeta. An expired trial resolves to effective
  // 'suspended', which reads identically to a deliberate suspension on a pill although the two
  // need completely different actions from an account manager.
  trial_expired: { label: 'Trial expired', variant: 'danger' },
};

// THE one function every status cell calls.
//
// `effective` alone cannot tell "their trial ran out" from "we suspended them", because
// entitlementFor resolves an expired trial to effective 'suspended'. The `banner` field already
// carried the difference and simply never reached a list row. Both inputs are accepted so this
// works from the list route (status + effective + banner) and from a full entitlement payload.
export const accountStateMeta = ({ effective, banner, status, trialDaysLeft, windDownEndsAt } = {}) => {
  const expiredTrial = banner === 'trial_expired' || (status === 'trial' && effective === 'suspended');
  if (expiredTrial) {
    return { ...BILLING_STATUS_META.trial_expired, key: 'trial_expired' };
  }
  const meta = BILLING_STATUS_META[effective];
  if (!meta) {
    // An org with no subscription record fails OPEN server-side (entitlement.js) — say so rather
    // than rendering a blank cell that reads as "loading".
    return { label: 'Active', variant: 'success', key: 'active', title: 'No subscription record — access fails open' };
  }
  if (effective === 'trial' && typeof trialDaysLeft === 'number') {
    return { ...meta, key: 'trial', label: `Trial · ${trialDaysLeft}d left` };
  }
  if (effective === 'canceled' && windDownEndsAt) {
    return { ...meta, key: 'canceled' };
  }
  return { ...meta, key: effective };
};

// The badge itself. Takes the same inputs as accountStateMeta.
export function AccountStateBadge({ effective, banner, status, trialDaysLeft, windDownEndsAt, className = '' }) {
  const meta = accountStateMeta({ effective, banner, status, trialDaysLeft, windDownEndsAt });
  return (
    <Badge variant={meta.variant} dot className={className} title={meta.title}>
      {meta.label}
    </Badge>
  );
}

// The original pill, signature unchanged — the Control Room, the month-close board and the
// customer Billing page all import it and none of them has the banner to hand.
export function BillingPill({ effective, className = '' }) {
  const meta = BILLING_STATUS_META[effective];
  if (!meta) return null;
  return (
    <Badge variant={meta.variant} className={className}>
      {meta.label}
    </Badge>
  );
}

// A flag-keyed badge for Organization.isInternal — the born-immutable marker that this org holds
// only Doorline's own synthetic data. DISTINCT from the billing pill: that shows billing STATE
// (which can drift or heal), this marks the tamper-proof security-boundary FLAG. Reuses the
// 'internal' variant so the two read as the same concept wherever they sit side by side.
// `compact` shrinks it for tight spots (the org switcher header + dropdown rows) — kept as its own
// span rather than a Badge prop, because Badge hard-codes its padding and Tailwind resolves
// conflicting utilities by stylesheet order, not class order.
export function InternalBadge({ label = 'Internal', compact = false, className = '' }) {
  const title =
    'Internal Doorline organization — staff enter without a support grant; holds only synthetic data';
  if (compact) {
    return (
      <span
        className={`inline-flex items-center rounded-full bg-sunken px-1.5 py-0.5 text-[10px] font-medium text-fg-muted ${className}`}
        title={title}
      >
        {label}
      </span>
    );
  }
  return (
    <Badge variant="neutral" className={className} title={title}>
      {label}
    </Badge>
  );
}

// Re-exported so every existing `import { fmtUsd } from '.../billingStatus.jsx'` keeps working;
// it lives in money.js because the pure invoicing libs need it and node --test cannot load .jsx.
export { fmtUsd };
