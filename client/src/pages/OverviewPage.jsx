import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import StatCard from '../components/StatCard.jsx';
import CoverageBar from '../components/CoverageBar.jsx';
import DateRangeSelector, { defaultRange } from '../components/DateRangeSelector.jsx';
import { rateAccent, ratePct } from '../lib/rates.js';
import { formatInTz } from '../lib/datetime.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

function typeLabel(type) {
  return type === 'lit_drop' ? 'Lit drop' : 'Survey';
}

function StatRow({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}

function CampaignCard({ campaign, onClick }) {
  const c = campaign;
  const tz = useOrgTimeZone();
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-brand-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-gray-900">{c.name}</div>
        <span
          className={
            c.type === 'lit_drop'
              ? 'rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700'
              : 'rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700'
          }
        >
          {typeLabel(c.type)}
        </span>
      </div>

      <div className="space-y-1.5">
        <StatRow label="Households" value={fmt(c.households)} />
        <StatRow label="Houses knocked" value={`${fmt(c.homesKnocked)} (${c.knockedPct ?? 0}%)`} />
        <StatRow label="Knocks" value={fmt(c.knocks)} />
        {c.type === 'lit_drop' ? (
          <StatRow label="Lit drops" value={fmt(c.litDropped)} />
        ) : (
          <>
            <StatRow label="Surveys" value={fmt(c.surveysSubmitted)} />
            <StatRow label="Surveyed voters" value={fmt(c.surveyedVoters)} />
          </>
        )}
        <StatRow label={c.type === 'lit_drop' ? 'Lit rate' : 'Connection'} value={ratePct(c.connectionRate)} />
        <StatRow label="Canvassers" value={fmt(c.activeCanvassers)} />
        <StatRow
          label="Last activity"
          value={
            c.lastActivityAt
              ? formatInTz(c.lastActivityAt, tz, { month: 'numeric', day: 'numeric', year: 'numeric' }, false)
              : '—'
          }
        />
      </div>

      {c.coverage && <CoverageBar canvass={c.coverage} />}
    </button>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg
      className={`h-4 w-4 text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function OverviewPage() {
  const navigate = useNavigate();
  // Org-wide rollup → anchor presets to the org tz (available at login; campaigns may span
  // zones, so no single campaign tz applies here).
  const orgTz = useOrgTimeZone();
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [dateRange, setDateRange] = useState(() => defaultRange('today', orgTz));

  const activeQ = useQuery({
    queryKey: ['campaign-rollup', 'active', dateRange.from, dateRange.to],
    queryFn: () =>
      api(
        `/admin/reports/campaign-rollup${buildQuery({
          scope: 'active',
          from: dateRange.from,
          to: dateRange.to,
        })}`
      ),
  });

  // Archived is reviewed as historical data → always all-time.
  const archivedQ = useQuery({
    queryKey: ['campaign-rollup', 'archived'],
    queryFn: () => api('/admin/reports/campaign-rollup?scope=archived'),
    enabled: archivedExpanded,
  });

  const cumulative = activeQ.data?.cumulative || {};
  const campaigns = activeQ.data?.campaigns || [];
  const archivedCampaigns = archivedQ.data?.campaigns || [];

  // Heads-up when a relative preset could read a day off for an off-zone campaign near
  // midnight (server flag). Hidden for All-time / Custom (explicit dates → no seam).
  const seamNames = activeQ.data?.seamCampaigns || [];
  const showDaySeam =
    activeQ.data?.crossZoneDaySeam &&
    dateRange.preset !== 'all' &&
    dateRange.preset !== 'custom';
  const seamLabel =
    seamNames.length <= 2
      ? seamNames.join(' and ')
      : `${seamNames.slice(0, 2).join(', ')} and ${seamNames.length - 2} more`;
  const seamPlural = seamNames.length > 1;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Overview</h1>
        <div className="flex items-center gap-2">
          <DateRangeSelector value={dateRange} onChange={setDateRange} tz={orgTz} />
          {activeQ.data?.tzAbbrev && (
            <span className="self-center text-xs font-medium text-gray-400" title={`Dates & times in ${activeQ.data.timeZone}`}>
              {activeQ.data.tzAbbrev}
            </span>
          )}
        </div>
      </div>

      {showDaySeam && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Heads up — it's just past midnight in another time zone.{' '}
          <span className="font-semibold">{seamLabel}</span> {seamPlural ? 'have' : 'has'} already started a new
          day, so {seamPlural ? 'their' : 'its'} numbers in this range may be a day off here. Open{' '}
          {seamPlural ? 'those campaigns' : 'that campaign'} directly for exact figures.
        </div>
      )}

      {activeQ.isLoading ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
          Loading…
        </div>
      ) : activeQ.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error loading overview: {activeQ.error.message}
        </div>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold text-gray-900">
              All active campaigns
            </h2>
            <div className="mb-4">
              <CoverageBar canvass={cumulative.coverage} />
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <StatCard
                label="Households"
                value={cumulative.households?.toLocaleString()}
              />
              <StatCard
                label="Houses knocked"
                value={cumulative.homesKnocked?.toLocaleString()}
                hint={`${cumulative.knockedPct ?? 0}% of households`}
                accent="brand"
              />
              <StatCard
                label="Knocks"
                value={cumulative.knocks?.toLocaleString()}
                hint="billable · per house-pass"
              />
              <StatCard
                label="Surveys"
                value={cumulative.surveysSubmitted?.toLocaleString()}
                hint="per voter"
                accent="green"
              />
              <StatCard
                label="Surveyed voters"
                value={cumulative.surveyedVoters?.toLocaleString()}
                hint="distinct voters reached"
              />
              <StatCard
                label="Connection rate"
                value={ratePct(cumulative.connectionRate)}
                hint="surveyed knocks ÷ knocks"
                accent={rateAccent(cumulative.connectionRate)}
              />
              <StatCard
                label="Lit drops"
                value={cumulative.litDropped?.toLocaleString()}
              />
              <StatCard
                label="Active canvassers"
                value={cumulative.activeCanvassers?.toLocaleString()}
              />
            </div>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold text-gray-900">Campaigns</h2>
            {campaigns.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
                No active campaigns yet.{' '}
                <Link to="/campaigns" className="font-medium text-brand-700 hover:underline">
                  Create or activate one
                </Link>{' '}
                to start canvassing.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {campaigns.map((c) => (
                  <CampaignCard
                    key={c.id}
                    campaign={c}
                    onClick={() => navigate('/dashboard/' + c.id)}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="mb-8">
            <button
              type="button"
              onClick={() => setArchivedExpanded((v) => !v)}
              className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-left text-sm font-semibold text-gray-900 shadow-sm transition-colors hover:bg-gray-50"
              aria-expanded={archivedExpanded}
            >
              <ChevronIcon open={archivedExpanded} />
              Archived campaigns
            </button>

            {archivedExpanded && (
              <div className="mt-3">
                {archivedQ.isLoading ? (
                  <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
                    Loading…
                  </div>
                ) : archivedQ.error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    Error: {archivedQ.error.message}
                  </div>
                ) : archivedCampaigns.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
                    No archived campaigns.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                    {archivedCampaigns.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => navigate('/dashboard/' + c.id)}
                        className="flex w-full flex-wrap items-center gap-x-6 gap-y-1 border-t border-gray-100 px-4 py-3 text-left text-sm transition-colors first:border-t-0 hover:bg-gray-50"
                      >
                        <span className="font-medium text-gray-900">{c.name}</span>
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          Archived · read-only
                        </span>
                        <span className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-1 text-gray-600">
                          <span>
                            <span className="text-gray-400">Households</span>{' '}
                            <span className="font-medium text-gray-900">
                              {fmt(c.households)}
                            </span>
                          </span>
                          <span>
                            <span className="text-gray-400">Knocked</span>{' '}
                            <span className="font-medium text-gray-900">
                              {c.knockedPct ?? 0}%
                            </span>
                          </span>
                          <span>
                            <span className="text-gray-400">Knocks</span>{' '}
                            <span className="font-medium text-gray-900">
                              {fmt(c.knocks)}
                            </span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
