// Shared billing-status display metadata (pill label + classes) so the
// Organizations table, Control Room cards, the super-admin Billing panel, and
// the org Billing page all render the same states the same way. Keyed by the
// EFFECTIVE state from entitlementFor — 'trial_expired' arrives via the
// entitlement banner field, not as a status.
export const BILLING_STATUS_META = {
  internal: { label: 'Internal', cls: 'bg-sunken text-fg-muted' },
  trial: { label: 'Trial', cls: 'bg-info-tint text-info-fg' },
  active: { label: 'Active', cls: 'bg-emerald-100 text-emerald-700' },
  past_due: { label: 'Past due', cls: 'bg-warning-tint text-warning-fg' },
  suspended: { label: 'Suspended', cls: 'bg-danger-tint text-danger' },
  canceled: { label: 'Canceled', cls: 'bg-sunken text-fg-muted' },
};

export function BillingPill({ effective, className = '' }) {
  const meta = BILLING_STATUS_META[effective];
  if (!meta) return null;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls} ${className}`}>
      {meta.label}
    </span>
  );
}

// A flag-keyed badge for Organization.isInternal — the born-immutable marker that this org holds
// only Doorline's own synthetic data. DISTINCT from the billing pill: that shows billing STATE
// (which can drift or heal), this marks the tamper-proof security-boundary FLAG. Reuses the
// 'internal' status colors so the two read as the same concept wherever they sit side by side.
// `compact` shrinks it for tight spots (the org switcher header + dropdown rows).
export function InternalBadge({ label = 'Internal', compact = false, className = '' }) {
  const size = compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${size} ${BILLING_STATUS_META.internal.cls} ${className}`}
      title="Internal Doorline organization — staff enter without a support grant; holds only synthetic data"
    >
      {label}
    </span>
  );
}

export function fmtUsd(cents) {
  if (cents == null) return '—';
  const dollars = cents / 100;
  return dollars % 1 === 0 ? `$${dollars.toLocaleString()}` : `$${dollars.toFixed(2)}`;
}

// 'YYYY-MM' for the current month (local clock — the account manager's view).
export function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
