import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import CrossOrgActivityFeed from '../components/CrossOrgActivityFeed.jsx';

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
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-2xl font-semibold tabular-nums text-gray-900">
        {value ?? '—'}
      </div>
      <div className="mt-0.5 text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </div>
      {sub && <div className="mt-1 text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

export default function SuperAdminHomePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { switchOrg, user } = useAuth();

  const overviewQ = useQuery({
    queryKey: ['super-admin', 'platform-overview'],
    queryFn: () => api('/super-admin/platform-overview'),
    refetchInterval: 30_000,
  });

  function pickOrg(orgId) {
    switchOrg(orgId);
    qc.clear();
    navigate('/');
  }

  const totals = overviewQ.data?.totals;
  const orgs = overviewQ.data?.organizations || [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Platform control room</h1>
          <p className="text-sm text-gray-500">
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

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              All organizations
            </h2>
            <button
              onClick={() => navigate('/organizations')}
              className="text-xs font-semibold text-brand-600 hover:underline"
            >
              Manage →
            </button>
          </div>

          {overviewQ.isLoading ? (
            <div className="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-500">
              Loading…
            </div>
          ) : orgs.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
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
                      ? 'border-gray-200 bg-white hover:border-brand-300 hover:bg-brand-50'
                      : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-gray-900">
                        {o.name}
                      </div>
                      <div className="text-xs text-gray-500">{o.slug}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {!o.isActive && (
                        <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                          inactive
                        </span>
                      )}
                      {o.activeNowCount > 0 && (
                        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          🟢 {o.activeNowCount} active
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-gray-600">
                    <div>
                      <div className="text-base font-semibold tabular-nums text-gray-900">
                        {o.memberCount}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide">Members</div>
                    </div>
                    <div>
                      <div className="text-base font-semibold tabular-nums text-gray-900">
                        {o.campaignCount}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide">Campaigns</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-700">
                        {formatRelative(o.lastActivityAt)}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide">Last active</div>
                    </div>
                  </div>
                  <div className="mt-3 text-xs font-semibold text-brand-600 opacity-0 transition-opacity group-hover:opacity-100">
                    Switch into this org →
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Live activity
        </h2>
        <CrossOrgActivityFeed limit={50} />
      </div>
    </div>
  );
}
