import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import CrossOrgActivityFeed from '../components/CrossOrgActivityFeed.jsx';
import LiveStatus from '../components/LiveStatus.jsx';
import StatCard from '../components/StatCard.jsx';
import InfoHint from '../components/InfoHint.jsx';
import { livePollOptions, liveStatusProps } from '../lib/livePoll.js';
import { BillingPill, InternalBadge } from '../lib/billingStatus.jsx';
import { PLATFORM_TOTALS, OVERVIEW_HELP, TOTALS_INTRO, IDLE_ORGS_HELP, trendCaveat } from '../lib/platformStatsMeta.js';
import { Sparkline } from '../components/charts/index.jsx';

const TREND_RANGES = [
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 365, label: '1y' },
];

function formatRelative(d) {
  if (!d) return 'No activity';
  const date = new Date(d);
  const ms = Date.now() - date.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return date.toLocaleDateString();
}

export default function SuperAdminHomePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { switchOrg, user } = useAuth();
  const [live, setLive] = useState(true);
  const [refreshMsg, setRefreshMsg] = useState(null);

  // Re-stage the demo org's recent canvassing (4 evenings + a morning-to-now
  // "today") right before a pitch. Server-side it's locked to the demo org.
  const refreshDemoMut = useMutation({
    mutationFn: () => api('/super-admin/demo/refresh-day', { method: 'POST' }),
    onSuccess: (r) => {
      setRefreshMsg(
        `Demo refreshed: ${r.staged.todayKnocks} knocks today · ${r.staged.activities} total · ${r.staged.surveys} surveys.`
      );
      qc.invalidateQueries({ queryKey: ['super-admin', 'platform-overview'] });
    },
    onError: (err) => setRefreshMsg(err.message),
  });

  const overviewQ = useQuery({
    queryKey: ['super-admin', 'platform-overview'],
    queryFn: () => api('/super-admin/platform-overview'),
    ...livePollOptions(live, true, 30_000),
  });
  // Lifetime totals (live + banked-from-deleted) — one singleton doc, cheap to poll.
  const statsQ = useQuery({
    queryKey: ['super-admin', 'platform-stats'],
    queryFn: () => api('/super-admin/access/platform-stats'),
    ...livePollOptions(live, true, 30_000),
  });
  // The per-day trend series behind the totals' sparklines (~N tiny rows; rebuilt nightly and by
  // Reconcile-now). Ends at yesterday — the last complete UTC day — by server contract.
  const [trendDays, setTrendDays] = useState(90);
  const trendsQ = useQuery({
    queryKey: ['super-admin', 'platform-trends', trendDays],
    queryFn: () => api(`/super-admin/access/platform-trends?days=${trendDays}`),
    ...livePollOptions(live, true, 30_000),
  });
  // Cost note: idle-orgs walks every active org (2 queries each). Cheap at platform scale,
  // and livePollOptions never polls a backgrounded tab; revisit the interval before the org
  // count reaches the hundreds.
  const idleQ = useQuery({
    queryKey: ['super-admin', 'idle-orgs'],
    queryFn: () => api('/super-admin/access/idle-orgs'),
    ...livePollOptions(live, true, 30_000),
  });
  // The ops-health strip: is anything on fire, who is inside customer data, is a deletion SLA
  // slipping. Same keys the Support access page uses, so the caches are shared.
  const healthQ = useQuery({
    queryKey: ['retention-health'],
    queryFn: () => api('/super-admin/access/health/retention'),
    ...livePollOptions(live, true, 30_000),
  });
  const grantsQ = useQuery({
    queryKey: ['support-grants'],
    queryFn: () => api('/super-admin/access/grants?all=1'),
    ...livePollOptions(live, true, 30_000),
  });
  const deletionsQ = useQuery({
    queryKey: ['deletion-requests', 'summary'],
    queryFn: () => api('/super-admin/access/deletion-requests?status=scheduled&limit=1'),
    ...livePollOptions(live, true, 30_000),
  });
  // One at-risk definition, shared with the Organizations page (trials expiring, past due,
  // suspended, wind-downs; the idle zombies it also returns render in their own table below).
  const atRiskQ = useQuery({
    queryKey: ['super-admin', 'organizations', 'at-risk'],
    queryFn: () => api('/super-admin/organizations/at-risk'),
    ...livePollOptions(live, true, 30_000),
  });

  // Manual "Reconcile now" — the same idempotent recompute the 03:47 UTC job runs.
  const [reconcileMsg, setReconcileMsg] = useState(null);
  const reconcileMut = useMutation({
    mutationFn: () => api('/super-admin/access/platform-stats/reconcile', { method: 'POST' }),
    onSuccess: () => {
      setReconcileMsg('Recomputed from live rows.');
      setTimeout(() => setReconcileMsg(null), 4000);
      qc.invalidateQueries({ queryKey: ['super-admin', 'platform-stats'] });
    },
    onError: (err) => setReconcileMsg(err.message),
  });

  function pickOrg(orgId) {
    switchOrg(orgId);
    qc.clear();
    navigate('/admin');
  }

  const totals = overviewQ.data?.totals;
  const orgs = overviewQ.data?.organizations || [];
  const idleOrgs = idleQ.data?.orgs || [];
  const idleMonths = idleQ.data?.months ?? 6;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-2xl font-semibold text-fg">Platform control room</h1>
            <LiveStatus
              {...liveStatusProps([overviewQ, statsQ, trendsQ, idleQ, healthQ, grantsQ, deletionsQ, atRiskQ], {
                live,
                onToggle: () => setLive((v) => !v),
              })}
            />
          </div>
          <p className="text-sm text-fg-muted">
            Hi {user?.firstName} — here&apos;s every org at a glance. Active-now is anyone
            whose last canvass action was in the past 15 min.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="Organizations"
            value={totals?.orgs?.total?.toLocaleString() ?? '—'}
            hint={`${totals?.orgs?.active ?? 0} active`}
            help={OVERVIEW_HELP.orgs}
            compact
          />
          <StatCard
            label="Users"
            value={totals?.users?.total?.toLocaleString() ?? '—'}
            hint={`${totals?.users?.active ?? 0} active · ${totals?.users?.superAdmins ?? 0} super`}
            help={OVERVIEW_HELP.users}
            compact
          />
          <StatCard
            label="Active now"
            value={totals?.activeNow?.count?.toLocaleString() ?? '—'}
            hint={`last ${totals?.activeNow?.threshold || '15m'}`}
            help={OVERVIEW_HELP.activeNow}
            compact
          />
          <StatCard
            label="Today"
            value={totals?.today?.doorsKnocked?.toLocaleString() ?? '—'}
            hint={`${totals?.today?.surveysSubmitted ?? 0} survey doors · ${
              totals?.today?.litDropped ?? 0
            } lit drops`}
            help={OVERVIEW_HELP.today}
            compact
          />
        </div>

        {/* Ops health at a glance — the landing page's "is anything on fire" row. Each chip links
            to the Support access page, where the detail lives. */}
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            onClick={() => navigate('/super-admin/access')}
            className={`rounded-full px-3 py-1 font-semibold ${
              healthQ.data
                ? healthQ.data.healthy
                  ? 'bg-success/10 text-success'
                  : 'bg-danger/10 text-danger'
                : 'bg-sunken text-fg-muted'
            }`}
            title={healthQ.data?.message || 'Retention health'}
          >
            {healthQ.data ? (healthQ.data.healthy ? '● Retention enforced' : '▲ Retention NOT ENFORCED') : 'Retention…'}
          </button>
          <button
            onClick={() => navigate('/super-admin/access')}
            className={`rounded-full px-3 py-1 font-semibold ${
              (grantsQ.data?.grants?.length || 0) > 0 ? 'bg-warning-tint text-warning-fg' : 'bg-sunken text-fg-muted'
            }`}
            title="Open support sessions — staff currently inside customer organizations"
          >
            {grantsQ.data
              ? grantsQ.data.scope === 'all'
                ? `${grantsQ.data.grants.length} staff inside customer orgs`
                : `${grantsQ.data.grants.length} of your sessions open`
              : 'Sessions…'}
          </button>
          <button
            onClick={() => navigate('/super-admin/access')}
            className={`rounded-full px-3 py-1 font-semibold ${
              (healthQ.data?.deletionRequests?.stuck || 0) + (healthQ.data?.deletionRequests?.failed || 0) > 0
                ? 'bg-danger/10 text-danger'
                : (deletionsQ.data?.total || 0) > 0
                  ? 'bg-warning-tint text-warning-fg'
                  : 'bg-sunken text-fg-muted'
            }`}
            title="Scheduled org deletions (the delete-on-request SLA)"
          >
            {deletionsQ.data
              ? `${deletionsQ.data.total} deletion${deletionsQ.data.total === 1 ? '' : 's'} scheduled${
                (healthQ.data?.deletionRequests?.stuck || 0) + (healthQ.data?.deletionRequests?.failed || 0) > 0
                  ? ` · ${(healthQ.data.deletionRequests.stuck || 0) + (healthQ.data.deletionRequests.failed || 0)} need a human`
                  : ''
              }`
              : 'Deletions…'}
          </button>
        </div>

        {(atRiskQ.data?.items || []).some((it) => it.type !== 'idle') && (
          <div className="rounded-md border border-warning/30 bg-warning-tint px-4 py-3 text-sm text-warning-fg">
            <span className="font-semibold">Billing needs attention: </span>
            {atRiskQ.data.items
              .filter((it) => it.type !== 'idle')
              .map((it, i, arr) => (
                <span key={`${it.organizationId}-${it.type}`}>
                  <button
                    onClick={() => navigate(`/organizations?billing=${it.organizationId}`)}
                    className="font-semibold underline underline-offset-2 hover:opacity-80"
                  >
                    {it.name}
                  </button>
                  {' ('}
                  {it.type === 'trial_expiring'
                    ? it.trialDaysLeft === 0
                      ? 'trial expired'
                      : `trial ends in ${it.trialDaysLeft}d`
                    : it.type === 'wind_down'
                      ? `deletes ${new Date(it.windDownEndsAt).toLocaleDateString()}`
                      : it.type.replace('_', ' ')}
                  {')'}
                  {i < arr.length - 1 ? ' · ' : ''}
                </span>
              ))}
          </div>
        )}

        {/* The other needs-a-human queue, clustered with the billing strip: orgs that no
            automatic sweep can ever resolve (see IDLE_ORGS_HELP). */}
        <div>
          <div className="mb-1 flex items-center gap-1.5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
              Idle organizations
            </h2>
            <InfoHint label="What lands an org here">{IDLE_ORGS_HELP}</InfoHint>
          </div>
          <p className="max-w-2xl text-sm text-fg-subtle">
            Active, $0 (no live campaign), and silent for over {idleMonths} months — so the
            retention sweep will never catch them and they can&apos;t reset the clock on their own.
            Decide per org: re-engage, or terminate in Billing (which starts the{' '}
            <span className="whitespace-nowrap">60-day wind-down</span>).
          </p>
          {idleQ.isLoading && <p className="mt-2 text-sm text-fg-subtle">Loading…</p>}
          {!idleQ.isLoading && idleOrgs.length === 0 && (
            <p className="mt-2 text-sm text-fg-subtle">No idle organizations — nothing to review.</p>
          )}
          {idleOrgs.length > 0 && (
            <div className="mt-2 overflow-x-auto rounded border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-xs uppercase tracking-wide text-fg-muted">
                  <tr>
                    <th className="px-3 py-2">Organization</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Months idle</th>
                    <th className="px-3 py-2">Last activity</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {idleOrgs.map((o) => (
                    <tr key={o.organizationId} className="border-t border-border">
                      <td className="px-3 py-2 text-fg">{o.name}</td>
                      <td className="px-3 py-2 text-fg-muted">{o.status}</td>
                      <td className="px-3 py-2 text-fg-muted">{o.monthsIdle}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-fg-muted">
                        {o.lastActivityAt ? new Date(o.lastActivityAt).toLocaleDateString() : 'never'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => navigate(`/organizations?billing=${o.organizationId}`)}
                          className="text-xs font-semibold text-brand-accent hover:underline"
                        >
                          Manage billing →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
              All organizations
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => refreshDemoMut.mutate()}
                disabled={refreshDemoMut.isPending}
                title="Wipe & re-stage the demo org's recent canvassing so Today looks live"
                className="text-xs font-semibold text-brand-accent hover:underline disabled:opacity-60"
              >
                {refreshDemoMut.isPending ? 'Refreshing demo…' : 'Refresh demo day'}
              </button>
              <button
                onClick={() => navigate('/organizations')}
                className="text-xs font-semibold text-brand-accent hover:underline"
              >
                Manage →
              </button>
            </div>
          </div>
          {refreshMsg && (
            <div className="mb-2 rounded-md border border-info/30 bg-info-tint px-3 py-1.5 text-xs text-info-fg">
              {refreshMsg}
            </div>
          )}

          {overviewQ.isLoading ? (
            <div className="rounded-md border border-border bg-card p-4 text-sm text-fg-muted">
              Loading…
            </div>
          ) : orgs.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-sunken p-6 text-center text-sm text-fg-muted">
              No orgs yet. Create one in Organizations.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {orgs.map((o) => (
                <div key={o.id} className="relative">
                  {/* A sibling positioned over the card, not nested in the button (invalid HTML). */}
                  <button
                    onClick={() => navigate(`/organizations/${o.id}`)}
                    title="Open this organization's detail page (roster, campaigns, access log)"
                    className="absolute bottom-3 right-3 z-10 rounded-full bg-sunken px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted hover:text-fg"
                  >
                    Details
                  </button>
                <button
                  onClick={() => pickOrg(o.id)}
                  className={`group w-full rounded-xl border p-4 text-left shadow-sm transition-colors ${
                    o.isActive
                      ? 'border-border bg-card hover:border-brand-accent/40 hover:bg-brand-tint'
                      : 'border-border bg-sunken'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-fg">
                        {o.name}
                      </div>
                      <div className="text-xs text-fg-muted">{o.slug}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {o.isInternal && <InternalBadge label="Internal" />}
                      {!o.isActive && (
                        <span className="rounded-full bg-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                          inactive
                        </span>
                      )}
                      {/* Suppress the billing pill when it would just repeat the Internal badge
                          (flag + status agreeing) — but keep it when they DISAGREE: that
                          contradiction is the drift signal worth seeing. */}
                      {o.billing?.effective &&
                        o.billing.effective !== 'active' &&
                        !(o.isInternal && o.billing.effective === 'internal') && (
                          <BillingPill effective={o.billing.effective} />
                        )}
                      {o.activeNowCount > 0 && (
                        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          🟢 {o.activeNowCount} active
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-fg-muted">
                    <div>
                      <div className="text-base font-semibold tabular-nums text-fg">
                        {o.memberCount}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide">Members</div>
                    </div>
                    <div>
                      <div className="text-base font-semibold tabular-nums text-fg">
                        {o.campaignCount}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide">Campaigns</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-fg-muted">
                        {formatRelative(o.lastActivityAt)}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide">Last active</div>
                    </div>
                  </div>
                  <div className="mt-3 text-xs font-semibold text-brand-accent opacity-0 transition-opacity group-hover:opacity-100">
                    Switch into this org →
                  </div>
                </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Lifetime marketing numbers — below the operational content on purpose. Every card
            explains itself via the shared ⓘ copy (lib/platformStatsMeta.js), including the trend
            line's exact population (live orgs only + the deleted/undated gaps, count-truth rule). */}
        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
              Platform totals
            </h2>
            <div className="flex gap-1">
              {TREND_RANGES.map((r) => (
                <button
                  key={r.days}
                  onClick={() => setTrendDays(r.days)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    trendDays === r.days ? 'bg-brand-accent text-white' : 'bg-sunken text-fg-muted hover:text-fg'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <p className="mb-3 max-w-2xl text-sm text-fg-subtle">{TOTALS_INTRO}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {PLATFORM_TOTALS.map(({ key, label, help }) => (
              <StatCard
                key={key}
                label={label}
                value={(statsQ.data?.total?.[key] ?? 0).toLocaleString()}
                compact
                help={
                  help +
                  trendCaveat({
                    deletedCount: trendsQ.data?.deleted?.[key] ?? 0,
                    undatedCount: trendsQ.data?.undated?.[key] ?? 0,
                  })
                }
              >
                {trendsQ.data?.days?.length > 0 && (
                  <Sparkline data={trendsQ.data.days.map((d) => d[key] ?? 0)} height={36} />
                )}
              </StatCard>
            ))}
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
            <span>
              Recomputed nightly · last reconciled{' '}
              {statsQ.data?.backfilledAt ? new Date(statsQ.data.backfilledAt).toLocaleString() : 'never'}
            </span>
            <button
              onClick={() => reconcileMut.mutate()}
              disabled={reconcileMut.isPending}
              title="Recompute the live tallies from real rows right now (same as the nightly job; the deleted bank is untouched)"
              className="font-semibold text-brand-accent hover:underline disabled:opacity-60"
            >
              {reconcileMut.isPending ? 'Reconciling…' : 'Reconcile now'}
            </button>
            {reconcileMsg && <span className="text-fg-muted">{reconcileMsg}</span>}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Live activity
        </h2>
        <CrossOrgActivityFeed limit={50} refetchMs={live ? 30_000 : false} />
      </div>
    </div>
  );
}
