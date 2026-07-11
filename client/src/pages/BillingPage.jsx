import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

// The org-admin view of the subscription: status, the plan summary, and the
// billing contact. Rates and status changes live on the super-admin side —
// this page is deliberately read-mostly.
export default function BillingPage() {
  const qc = useQueryClient();
  const orgId = getActiveOrgId();
  const [contact, setContact] = useState({ name: '', email: '' });
  const [saved, setSaved] = useState(false);

  const billingQ = useQuery({
    queryKey: ['admin', 'billing', orgId],
    queryFn: () => api('/admin/billing'),
    enabled: Boolean(orgId),
  });

  useEffect(() => {
    if (billingQ.data?.billingContact) setContact(billingQ.data.billingContact);
  }, [billingQ.data]);

  const contactMut = useMutation({
    mutationFn: (body) => api('/admin/billing/contact', { method: 'PATCH', body }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      qc.invalidateQueries({ queryKey: ['admin', 'billing'] });
    },
  });

  const data = billingQ.data;
  const ent = data?.entitlement;
  const inputCls =
    'mt-1 w-full rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30';

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
              </div>
            )}
            <a
              href={CONTACT}
              className="mt-3 inline-block text-sm font-semibold text-brand-accent underline underline-offset-2 hover:opacity-80"
            >
              Contact Doorline →
            </a>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              contactMut.mutate({ name: contact.name.trim(), email: contact.email.trim() });
            }}
            className="rounded-xl border border-border bg-card p-4 shadow-sm"
          >
            <h2 className="text-sm font-semibold text-fg">Billing contact</h2>
            <p className="text-xs text-fg-muted">Who invoices and renewal notices should reach.</p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-fg-muted">Name</label>
                <input
                  value={contact.name}
                  onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-fg-muted">Email</label>
                <input
                  type="email"
                  value={contact.email}
                  onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="submit"
                disabled={contactMut.isPending || !ent?.canWrite}
                className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
              >
                {contactMut.isPending ? 'Saving…' : 'Save contact'}
              </button>
              {saved && <span className="text-sm text-success-fg">Saved.</span>}
              {contactMut.error && <span className="text-sm text-danger">{contactMut.error.message}</span>}
            </div>
          </form>
        </>
      )}
    </div>
  );
}
