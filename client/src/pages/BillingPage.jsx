import { useQuery } from '@tanstack/react-query';
import { api, getActiveOrgId } from '../api/client.js';
import { BillingPill, fmtUsd } from '../lib/billingStatus.jsx';

const CONTACT = 'mailto:hello@doorline.app?subject=Doorline%20account';

const STATUS_COPY = {
  internal: 'Internal organization — no billing applies.',
  trial: 'You are on a free trial with full access.',
  active: 'Your subscription is active.',
  past_due: 'An invoice is past due — please reach out so access isn’t interrupted.',
  suspended: 'This account is paused and read-only. Your data is safe.',
  canceled: 'This subscription has ended. Your data is retained.',
};

// 'YYYY-MM' → a friendly month label (e.g. 'July 2026') for the live usage line.
function monthLabel(ym) {
  if (!ym) return 'this month';
  const [y, m] = String(ym).split('-').map(Number);
  if (!y || !m) return 'this month';
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// A short 'Jul 8' date for the per-campaign breakdown.
function fmtShort(d) {
  return d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
}

// The org-admin view of the subscription: status and the plan summary. Rates, status changes,
// and the billing contact all live on the super-admin side — this page is deliberately read-only.
export default function BillingPage() {
  const orgId = getActiveOrgId();

  const billingQ = useQuery({
    queryKey: ['admin', 'billing', orgId],
    queryFn: () => api('/admin/billing'),
    enabled: Boolean(orgId),
  });

  const data = billingQ.data;
  const ent = data?.entitlement;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">Billing</h1>
        <p className="text-sm text-fg-muted">Your Doorline subscription.</p>
      </div>

      {billingQ.isLoading && <p className="text-sm text-fg-muted">Loading…</p>}
      {billingQ.error && (
        <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
          {billingQ.error.message}
        </div>
      )}

      {data && (
        <>
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <BillingPill effective={ent?.effective} />
              <p className="text-sm text-fg">{STATUS_COPY[ent?.effective] || ''}</p>
            </div>
            {ent?.effective === 'trial' && data.trialEndsAt && (
              <p className="mt-2 text-sm text-fg-muted">
                Trial ends {new Date(data.trialEndsAt).toLocaleDateString()}
                {ent.trialDaysLeft != null &&
                  ` — ${ent.trialDaysLeft} day${ent.trialDaysLeft === 1 ? '' : 's'} left`}
                .
              </p>
            )}
            <p className="mt-3 text-sm text-fg-muted">
              Plan: <span className="font-medium text-fg">{fmtUsd(data.pricePerCampaignCents)} per active campaign / month</span>
              . A campaign starts billing the month it records its first knock and stops after the
              month it’s archived.
            </p>
            {data.usage && (
              <div className="mt-3 rounded-lg border border-border bg-sunken px-3 py-2.5">
                <p className="text-sm text-fg">
                  This month:{' '}
                  <span className="font-semibold">
                    {data.usage.billableCampaigns}{' '}
                    {data.usage.billableCampaigns === 1 ? 'campaign' : 'campaigns'}
                  </span>{' '}
                  canvassing · about{' '}
                  <span className="font-semibold">{fmtUsd(data.usage.totalCents)}</span> expected.
                </p>
                <p className="mt-1 text-xs text-fg-muted">
                  A running estimate for {monthLabel(data.usage.month)}. Campaigns still in setup are
                  free until their first knock, so this can rise as more start canvassing.
                </p>

                {data.usage.billing?.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-border pt-2 text-xs">
                    {data.usage.billing.map((c) => (
                      <li key={c.campaignId} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-fg">
                          {c.name}
                          <span className="text-fg-subtle">
                            {c.isActive ? ' · active' : ` · archived ${fmtShort(c.archivedAt)}`}
                            {c.firstKnockAt && ` · first knock ${fmtShort(c.firstKnockAt)}`}
                          </span>
                        </span>
                        <span className="shrink-0 font-medium text-fg">{fmtUsd(c.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {data.usage.setupCount > 0 && (
                  <p className="mt-1.5 text-xs text-fg-subtle">
                    {data.usage.setupCount} more campaign{data.usage.setupCount === 1 ? '' : 's'} in
                    setup — free until the first knock.
                  </p>
                )}
              </div>
            )}
            <a
              href={CONTACT}
              className="mt-3 inline-block text-sm font-semibold text-brand-accent underline underline-offset-2 hover:opacity-80"
            >
              Contact Doorline →
            </a>
          </div>

        </>
      )}
    </div>
  );
}
