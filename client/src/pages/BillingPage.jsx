import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getActiveOrgId } from '../api/client.js';
import { BillingPill } from '../lib/billingStatus.jsx';
import { Badge, Card, DataTable, EmptyState } from '../components/ui/index.js';

const CONTACT = 'mailto:hello@doorline.app?subject=Doorline%20account';

const STATUS_COPY = {
  internal: 'Internal organization — no billing applies.',
  trial: 'You are on a free trial with full access.',
  active: 'Your subscription is active.',
  past_due: 'An invoice is past due — please reach out so access isn’t interrupted.',
  suspended: 'This account is paused and read-only. Your data is safe.',
  canceled: 'This subscription has ended. Your data is retained.',
};

// Why a campaign is (or isn't) billing that month. Mirrors the reason codes in
// server/src/services/billing/billingMonths.js, in the customer's language rather than the
// account manager's — 'billable' needs no label, it's the default.
const REASON_LABEL = {
  'no-field-visit': 'not billing yet',
  'start-grace': 'free — started in the last week',
  'end-grace': 'free — archived with no knocks',
  floor: 'minimum one month',
  'archived-earlier': 'archived',
  'before-start': 'before billing began',
};

// 'YYYY-MM' → a friendly month label (e.g. 'July 2026').
function monthLabel(ym) {
  if (!ym) return 'this month';
  const [y, m] = String(ym).split('-').map(Number);
  if (!y || !m) return 'this month';
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '—');
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// One month in the history table: a summary row that expands to the campaigns behind it.
function MonthRow({ m, open, onToggle }) {
  return (
    <>
      <tr className={`cursor-pointer hover:bg-sunken/60 ${open ? 'bg-sunken/40' : ''}`} onClick={onToggle}>
        <td className="py-2 pl-3 pr-2">
          <button
            type="button"
            aria-expanded={open}
            className="flex items-center gap-2 text-left font-medium text-fg"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            <span className={`text-fg-subtle transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
            {monthLabel(m.month)}
          </button>
        </td>
        <td className="py-2 pr-3 text-fg">
          {m.billableCampaigns > 0 ? plural(m.billableCampaigns, 'campaign', 'campaigns') : '—'}
        </td>
        <td className="py-2 pr-3 text-right tabular-nums text-fg">{m.doors.toLocaleString()}</td>
        <td className="py-2 pr-3 text-right tabular-nums text-fg-muted">{m.knocks.toLocaleString()}</td>
      </tr>
      {open && (
        <tr className="bg-sunken/30">
          <td colSpan={4} className="px-3 py-2">
            {m.campaigns.length === 0 ? (
              <p className="py-2 text-sm text-fg-muted">
                Nobody was in the field in {monthLabel(m.month)}.
                {m.setupCount > 0 && ` ${plural(m.setupCount, 'campaign', 'campaigns')} in setup — free until the first knock.`}
              </p>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                    <th className="py-1 pr-3">Campaign</th>
                    <th className="py-1 pr-3">Billing started</th>
                    <th className="py-1 pr-3 text-right">Doors</th>
                    <th className="py-1 pr-3 text-right">Knocks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {m.campaigns.map((c) => (
                    <tr key={c.campaignId} className={c.billable ? '' : 'text-fg-muted'}>
                      <td className="py-1.5 pr-3">
                        <span className={c.billable ? 'text-fg' : ''}>{c.name}</span>
                        {!c.isActive && <span className="ml-1 text-xs text-fg-subtle">(archived {fmtDate(c.archivedAt)})</span>}
                        {REASON_LABEL[c.reason] && (
                          <span className="ml-1 text-xs text-fg-subtle">— {REASON_LABEL[c.reason]}</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-xs">{c.firstKnockAt ? fmtDate(c.firstKnockAt) : 'Not started'}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {c.doors.toLocaleString()}
                        {/* Only meaningful once the org bills restricted homes — otherwise this
                            column IS the knock count and the note would be noise. */}
                        {c.billRestrictedDoors && c.restrictedDoors > 0 && (
                          <span className="ml-1 text-xs text-fg-subtle">
                            (incl. {c.restrictedDoors.toLocaleString()} restricted)
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{c.knocks.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// The org-admin view of the subscription: account status, what's canvassing now, and the
// month-by-month history behind it.
//
// NO PRICES, anywhere — and not merely hidden: the server strips every dollar figure before it
// leaves (services/billing/statement.js → publicUsage / publicMonthHistory), because rates are
// negotiated per client and per race and a running total on a customer's screen only invites "why
// does this say $300 when we agreed on $250". What this page DOES answer is the question a client
// actually has when they invoice their own client: which campaigns were in the field, in which
// month, and how many doors.
export default function BillingPage() {
  const orgId = getActiveOrgId();
  const qc = useQueryClient();
  const [months, setMonths] = useState(12);
  const [openMonth, setOpenMonth] = useState(null);

  const billingQ = useQuery({
    queryKey: ['admin', 'billing', orgId],
    queryFn: () => api('/admin/billing'),
    enabled: Boolean(orgId),
  });

  const historyQ = useQuery({
    queryKey: ['admin', 'billing', orgId, 'history', months],
    queryFn: () => api(`/admin/billing/history?months=${months}`),
    enabled: Boolean(orgId),
  });

  // The org-wide default for counting restricted doors as billable doors. Individual
  // campaigns can still override it from the campaign edit drawer.
  const setRestricted = useMutation({
    mutationFn: (billRestrictedDoors) =>
      api('/admin/billing/settings', { method: 'PATCH', body: { billRestrictedDoors } }),
    onSuccess: () => {
      // The prefix invalidation catches the history too — the Doors column moves with this setting.
      qc.invalidateQueries({ queryKey: ['admin', 'billing', orgId] });
      // Every door total on the report surfaces shifts with this — see CampaignsPage.
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
    },
  });

  const data = billingQ.data;
  const ent = data?.entitlement;
  const history = historyQ.data;
  const maxMonths = history?.maxMonths ?? 24;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">Billing</h1>
        <p className="text-sm text-fg-muted">Your Doorline subscription, and what you’ve canvassed.</p>
      </div>

      {billingQ.isLoading && <p className="text-sm text-fg-muted">Loading…</p>}
      {billingQ.error && (
        <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
          {billingQ.error.message}
        </div>
      )}

      {data && (
        <>
          <Card className="p-4">
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
                {/* The per-campaign breakdown the server has always sent and this page never showed:
                    WHICH campaigns make up that number, and since when. */}
                {data.usage.billing?.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-border pt-2">
                    {data.usage.billing.map((b) => (
                      <li key={b.campaignId} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                        <span className="text-fg">
                          {b.name}
                          {!b.isActive && (
                            <span className="ml-1 text-fg-subtle">(archived {fmtDate(b.archivedAt)})</span>
                          )}
                        </span>
                        <span className="text-fg-muted">
                          billing since {fmtDate(b.firstKnockAt)} · {plural(b.knocksThisMonth, 'door', 'doors')} this month
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
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
          </Card>

          {/* Month history — the thing that makes an old invoice checkable. */}
          <section>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-fg">Month by month</h2>
                <p className="text-xs text-fg-muted">
                  What was in the field each month. Open a month to see the campaigns behind it.
                </p>
              </div>
              {history && months < maxMonths && (
                <button
                  onClick={() => setMonths(maxMonths)}
                  className="text-xs font-semibold text-brand-accent hover:opacity-80"
                >
                  Show {maxMonths} months
                </button>
              )}
            </div>

            {historyQ.isLoading && <p className="text-sm text-fg-muted">Loading history…</p>}
            {historyQ.error && (
              <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
                {historyQ.error.message}
              </div>
            )}
            {history &&
              (history.months.some((m) => m.campaigns.length > 0) ? (
                <DataTable
                  head={
                    <>
                      <th className="py-2 pl-3 pr-2">Month</th>
                      <th className="py-2 pr-3">Billing</th>
                      <th className="py-2 pr-3 text-right">Doors</th>
                      <th className="py-2 pr-3 text-right">Knocks</th>
                    </>
                  }
                >
                  {history.months.map((m) => (
                    <MonthRow
                      key={m.month}
                      m={m}
                      open={openMonth === m.month}
                      onToggle={() => setOpenMonth((cur) => (cur === m.month ? null : m.month))}
                    />
                  ))}
                </DataTable>
              ) : (
                <Card>
                  <EmptyState
                    title="No field activity yet"
                    hint="Once your canvassers start knocking, every month shows up here with its campaigns and door counts."
                  />
                </Card>
              ))}
          </section>

          {/* Your OWN invoicing policy, not Doorline's. Lives directly under the history because it
              is the switch that decides what the Doors column above means. */}
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-fg">Your invoicing</h2>
              <Badge variant={data.billRestrictedDoors ? 'brand' : 'neutral'}>
                {data.billRestrictedDoors ? 'Restricted homes counted' : 'Knocked doors only'}
              </Badge>
            </div>
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
                  want those trips included. It changes the <span className="font-medium text-fg">Doors</span>{' '}
                  column above, and your exports and reports; your contact and survey rates stay based
                  on doors that were actually knocked, and it never changes what Doorline charges you.
                  Individual campaigns can override this from the campaign’s edit screen.
                </span>
              </span>
            </label>
            {setRestricted.error && (
              <p className="mt-2 text-xs text-danger">{setRestricted.error.message}</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
