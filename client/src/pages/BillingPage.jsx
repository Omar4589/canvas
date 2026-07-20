import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getActiveOrgId } from '../api/client.js';
import { BillingPill } from '../lib/billingStatus.jsx';

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

// The org-admin view of the subscription: status and the plan summary. Rates, status changes,
// and the billing contact all live on the super-admin side — this page is deliberately read-only.
export default function BillingPage() {
  const orgId = getActiveOrgId();
  const qc = useQueryClient();

  const billingQ = useQuery({
    queryKey: ['admin', 'billing', orgId],
    queryFn: () => api('/admin/billing'),
    enabled: Boolean(orgId),
  });

  // The org-wide default for counting restricted doors as billable doors. Individual
  // campaigns can still override it from the campaign edit drawer.
  const setRestricted = useMutation({
    mutationFn: (billRestrictedDoors) =>
      api('/admin/billing/settings', { method: 'PATCH', body: { billRestrictedDoors } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'billing', orgId] });
      // Every door total on the report surfaces shifts with this — see CampaignsPage.
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
    },
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
            {/* No price here, deliberately: rates are negotiated per client and per race, so the
                number belongs in a conversation with your account manager, not on a dashboard. The
                server strips it too (services/billing/statement.js → publicUsage) — this is not a
                hidden field. What DOES belong here is when the meter starts and stops, because
                that is the part customers act on. */}
            <p className="mt-3 text-sm text-fg-muted">
              A campaign starts billing the month of its first field visit — a knock, or a restricted
              home a canvasser walked to. Start in the <span className="font-medium text-fg">last
              week of a month</span> and that month is on us. Billing then runs every month until you{' '}
              <span className="font-medium text-fg">archive</span> the campaign, whether or not anyone
              knocks, so archiving a finished race is what stops it.
            </p>
            {data.usage && (
              <div className="mt-3 rounded-lg border border-border bg-sunken px-3 py-2.5">
                <p className="text-sm text-fg">
                  This month:{' '}
                  <span className="font-semibold">
                    {data.usage.billableCampaigns}{' '}
                    {data.usage.billableCampaigns === 1 ? 'campaign' : 'campaigns'}
                  </span>{' '}
                  canvassing.
                </p>
                <p className="mt-1 text-xs text-fg-muted">
                  For {monthLabel(data.usage.month)}. Campaigns still in setup are free until their
                  first knock.
                </p>
                {data.usage.setupCount > 0 && (
                  <p className="mt-1.5 text-xs text-fg-subtle">
                    {data.usage.setupCount} campaign{data.usage.setupCount === 1 ? '' : 's'} in setup —
                    free until the first knock.
                  </p>
                )}
                {data.usage.graceCount > 0 && (
                  <p className="mt-1.5 text-xs text-fg-subtle">
                    {data.usage.graceCount} campaign{data.usage.graceCount === 1 ? '' : 's'} started in
                    the last week of the month — free this month.
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

          {/* Your OWN invoicing policy, not Doorline's. Lives on this page because it is a
              billing-counting decision and this page already has the bill-payer's attention. */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-fg">Your invoicing</h2>
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={Boolean(data.billRestrictedDoors)}
                disabled={setRestricted.isPending}
                onChange={(e) => setRestricted.mutate(e.target.checked)}
              />
              <span>
                Count restricted homes as billable doors
                <span className="mt-1 block text-xs text-fg-muted">
                  A restricted home is one your canvasser walked to and couldn’t reach — a locked
                  gate or a secured building. Turn this on if you invoice your client per door and
                  want those trips included. It changes only the door totals on your exports and
                  reports; your contact and survey rates stay based on doors that were actually
                  knocked, and it never changes what Doorline charges you. Individual campaigns can
                  override this from the campaign’s edit screen.
                </span>
              </span>
            </label>
            {setRestricted.error && (
              <p className="mt-2 text-xs text-danger">{setRestricted.error.message}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
