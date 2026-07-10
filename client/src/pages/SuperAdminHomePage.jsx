import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import CrossOrgActivityFeed from '../components/CrossOrgActivityFeed.jsx';
import LiveStatus from '../components/LiveStatus.jsx';
import { BillingPill } from '../lib/billingStatus.jsx';

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

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="text-2xl font-semibold tabular-nums text-fg">
        {value ?? '—'}
      </div>
      <div className="mt-0.5 text-xs font-medium uppercase tracking-wide text-fg-muted">
        {label}
      </div>
      {sub && <div className="mt-1 text-xs text-fg-subtle">{sub}</div>}
    </div>
  );
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
    refetchInterval: live ? 30_000 : false,
  });

  function pickOrg(orgId) {
    switchOrg(orgId);
    qc.clear();
    navigate('/admin');
  }

  const totals = overviewQ.data?.totals;
  const orgs = overviewQ.data?.organizations || [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-2xl font-semibold text-fg">Platform control room</h1>
            <LiveStatus
              live={live}
              onToggle={() => setLive((v) => !v)}
              isFetching={overviewQ.isFetching}
              updatedAt={overviewQ.dataUpdatedAt}
              onRefresh={() => overviewQ.refetch()}
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
            value={totals?.orgs?.total?.toLocaleString()}
            sub={`${totals?.orgs?.active ?? 0} active`}
          />
          <StatCard
            label="Users"
            value={totals?.users?.total?.toLocaleString()}
            sub={`${totals?.users?.active ?? 0} active · ${totals?.users?.superAdmins ?? 0} super`}
          />
          <StatCard
            label="Active now"
            value={totals?.activeNow?.count?.toLocaleString()}
            sub={`last ${totals?.activeNow?.threshold || '15m'}`}
          />
          <StatCard
            label="Today"
            value={totals?.today?.doorsKnocked?.toLocaleString()}
            sub={`${totals?.today?.surveysSubmitted ?? 0} surveys · ${
              totals?.today?.litDropped ?? 0
            } lit drops`}
          />
        </div>

        {orgs.some(
          (o) =>
            ['past_due', 'suspended'].includes(o.billing?.effective) ||
            (o.billing?.effective === 'trial' && o.billing?.trialDaysLeft != null && o.billing.trialDaysLeft <= 2)
        ) && (
          <div className="rounded-md border border-warning/30 bg-warning-tint px-4 py-3 text-sm text-warning-fg">
            <span className="font-semibold">Billing needs attention: </span>
            {orgs
              .filter(
                (o) =>
                  ['past_due', 'suspended'].includes(o.billing?.effective) ||
                  (o.billing?.effective === 'trial' && o.billing?.trialDaysLeft != null && o.billing.trialDaysLeft <= 2)
              )
              .map(
                (o) =>
                  `${o.name} (${
                    o.billing.effective === 'trial'
                      ? `trial ends in ${o.billing.trialDaysLeft}d`
                      : o.billing.effective.replace('_', ' ')
                  })`
              )
              .join(' · ')}{' '}
            <button
              onClick={() => navigate('/organizations')}
              className="font-semibold underline underline-offset-2 hover:opacity-80"
            >
              Manage →
            </button>
          </div>
        )}

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
                <button
                  key={o.id}
                  onClick={() => pickOrg(o.id)}
                  className={`group rounded-xl border p-4 text-left shadow-sm transition-colors ${
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
                      {!o.isActive && (
                        <span className="rounded-full bg-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                          inactive
                        </span>
                      )}
                      {o.billing?.effective && o.billing.effective !== 'active' && (
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
              ))}
            </div>
          )}
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
