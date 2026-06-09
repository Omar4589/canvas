import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import StatCard from '../components/StatCard.jsx';
import CoverageBar from '../components/CoverageBar.jsx';
import QuestionResults from '../components/QuestionResults.jsx';
import CanvasserTable from '../components/CanvasserTable.jsx';
import CanvasserResponsesModal from '../components/CanvasserResponsesModal.jsx';
import DateRangeSelector, { defaultRange } from '../components/DateRangeSelector.jsx';
import VoterHighlights from '../components/VoterHighlights.jsx';
import SetupProgress from '../components/SetupProgress.jsx';
import { rateAccent, ratePct } from '../lib/rates.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function SectionHeading({ title, right }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      {right}
    </div>
  );
}

export default function DashboardPage() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const orgTz = useOrgTimeZone();
  // dateRange stays null until the campaign's timezone is known, so presets resolve in
  // the campaign's clock (not the device's) and range queries never fetch a device-tz window.
  const [dateRange, setDateRange] = useState(null);
  const rangeTouchedRef = useRef(false);
  function onRangeChange(next) {
    rangeTouchedRef.current = true;
    setDateRange(next);
  }
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedCanvasser, setSelectedCanvasser] = useState(null);
  const [effortId, setEffortId] = useState('');

  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId,
  });
  const efforts = effortsQ.data?.efforts || [];

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });

  const campaigns = campaignsQ.data?.campaigns || [];
  const campaignsLoading = campaignsQ.isLoading;
  const current =
    campaigns.find((c) => String(c._id) === String(campaignId)) || undefined;
  const selectedCampaign = current || null;
  // Anchor timezone for date presets + the report window: the campaign's, falling back to
  // the org's. tzReady flips once the campaigns list has loaded (so `current.timeZone` is known).
  const tz = current?.timeZone || orgTz;
  const tzReady = !campaignsLoading;
  const activeCampaigns = campaigns.filter((c) => c.isActive);
  // Active campaigns plus the current one (even when archived) for the switcher.
  const switcherCampaigns =
    current && current.isActive === false
      ? [...activeCampaigns, current]
      : activeCampaigns;

  // Once the campaign's timezone is known, compute the default range in THAT clock so
  // "Today"/"Yesterday" mean the campaign's day for every admin. Archived campaigns have
  // no recent activity → default to all-time. Range queries are gated on dateRange below,
  // so they never fetch a device-tz window. Skips if the admin already picked a range.
  useEffect(() => {
    if (rangeTouchedRef.current || !tzReady) return;
    setDateRange(defaultRange(current && current.isActive === false ? 'all' : 'today', tz));
  }, [tzReady, tz, current]);

  const overviewQ = useQuery({
    queryKey: ['reports', 'overview', campaignId, effortId],
    queryFn: () =>
      api(`/admin/reports/overview${buildQuery({ campaignId, effortId: effortId || undefined })}`),
    enabled: !!campaignId,
    refetchInterval: 30_000,
  });

  // Range-scoped activity (knocks/surveys/rate). Coverage stays all-time from /overview.
  const rollupQ = useQuery({
    queryKey: ['reports', 'campaign-rollup', campaignId, effortId, dateRange?.from, dateRange?.to],
    queryFn: () =>
      api(
        `/admin/reports/campaign-rollup${buildQuery({
          campaignId,
          effortId: effortId || undefined,
          from: dateRange?.from,
          to: dateRange?.to,
        })}`
      ),
    enabled: !!campaignId && !!dateRange,
    refetchInterval: 30_000,
  });

  const surveysQ = useQuery({
    queryKey: ['reports', 'surveys', campaignId],
    queryFn: () =>
      api(`/admin/reports/surveys${buildQuery({ campaignId })}`),
    enabled: !!campaignId,
  });

  const canvassersQ = useQuery({
    queryKey: ['reports', 'canvassers', campaignId, effortId, dateRange?.from, dateRange?.to],
    queryFn: () =>
      api(
        `/admin/reports/canvassers${buildQuery({
          campaignId,
          effortId: effortId || undefined,
          from: dateRange?.from,
          to: dateRange?.to,
        })}`
      ),
    enabled: !!campaignId && !!dateRange,
    refetchInterval: 30_000,
  });

  const surveyResultsQ = useQuery({
    queryKey: [
      'reports',
      'survey-results',
      campaignId,
      effortId,
      selectedTemplateId,
      dateRange?.from,
      dateRange?.to,
    ],
    queryFn: () =>
      api(
        `/admin/reports/survey-results${buildQuery({
          campaignId,
          effortId: effortId || undefined,
          surveyTemplateId: selectedTemplateId,
          from: dateRange?.from,
          to: dateRange?.to,
          voterPreview: 5,
        })}`
      ),
    enabled: !!campaignId && !!dateRange && selectedCampaign?.type !== 'lit_drop',
    refetchInterval: 30_000,
  });

  const surveyResultsRef = useRef(null);
  const questionResultsRefs = useRef({});

  function scrollToOption(questionKey) {
    const el = questionResultsRefs.current[questionKey];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const overview = overviewQ.data || {};
  const totals = overview.totals || {};
  const canvass = overview.canvass || {};
  const rangeStats = rollupQ.data?.cumulative || {};
  const isLitDrop = selectedCampaign?.type === 'lit_drop';

  const knockedPct = totals.households
    ? Math.round((100 * (totals.homesKnocked || 0)) / totals.households)
    : 0;

  // Guard: missing/falsy campaign id, or an id that resolves to no campaign.
  if (!campaignId || (!campaignsLoading && !current)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-xl font-semibold text-fg">
          {!campaignId ? 'No campaign selected' : 'Campaign not found'}
        </h1>
        <p className="text-sm text-fg-muted">
          Pick a campaign from the Overview to view its dashboard.
        </p>
        <Link
          to="/admin"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
        >
          Go to Overview
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            to="/admin"
            className="text-sm font-medium text-brand-accent hover:underline"
          >
            ‹ Overview
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-fg">
            {current?.name || 'Dashboard'}
          </h1>
          {selectedCampaign && (
            <div className="mt-1 text-sm text-fg-muted">
              {selectedCampaign.type === 'survey' ? 'Survey' : 'Lit drop'}{' '}
              <span className="text-fg-subtle">·</span> {selectedCampaign.state}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">
              Campaign
            </span>
            <select
              value={campaignId}
              onChange={(e) => navigate('/dashboard/' + e.target.value)}
              disabled={campaignsLoading}
              className="rounded border border-border-strong bg-card px-2 py-1 text-sm text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              {!switcherCampaigns.some((c) => String(c._id) === String(campaignId)) && (
                <option value={campaignId || ''} hidden>
                  {campaignsLoading ? 'Loading…' : current?.name || 'Select campaign'}
                </option>
              )}
              {switcherCampaigns.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name} ({c.type === 'survey' ? 'Survey' : 'Lit drop'})
                  {c.isActive === false ? ' · Archived' : ''}
                </option>
              ))}
            </select>
          </div>
          {efforts.length > 1 && (
            <select
              value={effortId}
              onChange={(e) => setEffortId(e.target.value)}
              title="Filter to one effort"
              className="rounded border border-border-strong bg-card px-2 py-1 text-sm text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="">All efforts</option>
              {efforts.map((ef) => (
                <option key={ef._id} value={ef._id}>{ef.name}</option>
              ))}
            </select>
          )}
          <DateRangeSelector value={dateRange} onChange={onRangeChange} tz={tz} />
          {overview.tzAbbrev && (
            <span className="self-center text-xs font-medium text-fg-subtle" title={`Dates & times in ${overview.timeZone}`}>
              {overview.tzAbbrev}
            </span>
          )}
        </div>
      </div>

      {current && current.isActive === false && (
        <div className="mb-6 rounded-md border border-warning/30 bg-warning-tint px-4 py-2 text-sm text-warning-fg">
          This campaign is archived — data is read-only. Reactivate it from
          Campaigns to resume canvassing.
        </div>
      )}

      {current && current.isActive !== false && (
        <div className="mb-6">
          <SetupProgress campaignId={campaignId} />
        </div>
      )}

      {/* Activity — honors the selected date range */}
      <section className="mb-6">
        <SectionHeading
          title="Activity"
          right={<span className="text-xs text-fg-muted">Selected range</span>}
        />
        {rollupQ.isLoading ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-fg-muted">
            Loading…
          </div>
        ) : rollupQ.error ? (
          <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
            Error: {rollupQ.error.message}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              label="Knocks"
              value={rangeStats.knocks?.toLocaleString()}
              hint="billable · per house-pass"
              accent="brand"
            />
            {isLitDrop ? (
              <StatCard
                label="Lit drops"
                value={rangeStats.litDropped?.toLocaleString()}
                hint="events"
                accent="green"
              />
            ) : (
              <>
                <StatCard
                  label="Surveys"
                  value={rangeStats.surveysSubmitted?.toLocaleString()}
                  hint="per voter"
                  accent="green"
                />
                <StatCard
                  label="Surveyed voters"
                  value={rangeStats.surveyedVoters?.toLocaleString()}
                  hint="distinct voters reached"
                />
              </>
            )}
            <StatCard
              label={isLitDrop ? 'Lit rate' : 'Connection rate'}
              value={ratePct(rangeStats.connectionRate)}
              hint={isLitDrop ? 'lit knocks ÷ knocks' : 'surveyed knocks ÷ knocks'}
              accent={rateAccent(rangeStats.connectionRate)}
            />
          </div>
        )}
      </section>

      {/* Coverage — current-state, all-time */}
      <section className="mb-8">
        <SectionHeading
          title="Coverage"
          right={<span className="text-xs text-fg-muted">All-time</span>}
        />
        {overviewQ.isLoading ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-fg-muted">
            Loading…
          </div>
        ) : overviewQ.error ? (
          <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
            Error loading coverage: {overviewQ.error.message}
          </div>
        ) : (
          <>
            <p className="mb-2 text-sm text-fg-muted">
              <span className="font-semibold text-fg">
                {(totals.households || 0).toLocaleString()}
              </span>{' '}
              households
              <span className="mx-2 text-fg-subtle">·</span>
              <span className="font-semibold text-fg">
                {(totals.homesKnocked || 0).toLocaleString()}
              </span>{' '}
              knocked
              <span className="text-fg-subtle"> ({knockedPct}%)</span>
            </p>
            <CoverageBar canvass={canvass} />
          </>
        )}
      </section>

      {surveyResultsQ.data?.surveyTemplate &&
        surveyResultsQ.data.questions?.some((q) => q.type === 'multiple_choice') && (
          <section className="mb-8">
            <SectionHeading
              title="Voter highlights"
              right={
                <span className="text-xs text-fg-muted">
                  Latest voters per option
                </span>
              }
            />
            <VoterHighlights
              surveyResults={surveyResultsQ.data}
              onSeeAll={scrollToOption}
              tz={tz}
            />
          </section>
        )}

      {selectedCampaign?.type === 'survey' && (
        <section className="mb-8" ref={surveyResultsRef}>
          <SectionHeading
            title="Survey results"
            right={
              (surveysQ.data || []).length > 1 ? (
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="rounded border border-border bg-card px-2 py-1 text-sm text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <option value="">Campaign survey</option>
                  {(surveysQ.data || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.responseCount}
                    </option>
                  ))}
                </select>
              ) : null
            }
          />
          {surveyResultsQ.isLoading ? (
            <div className="rounded-lg border border-border bg-card p-4 text-sm text-fg-muted">
              Loading survey results…
            </div>
          ) : surveyResultsQ.error ? (
            <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
              Error: {surveyResultsQ.error.message}
            </div>
          ) : !surveyResultsQ.data?.surveyTemplate ? (
            <div className="rounded-lg border border-dashed border-border bg-sunken p-6 text-center text-sm text-fg-muted">
              This campaign has no survey linked yet.
            </div>
          ) : surveyResultsQ.data.totalResponses === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-sunken p-6 text-center text-sm text-fg-muted">
              No responses in this range yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {surveyResultsQ.data.questions.map((q) => (
                <div
                  key={q.key}
                  ref={(el) => {
                    questionResultsRefs.current[q.key] = el;
                  }}
                >
                  <QuestionResults
                    question={q}
                    surveyTemplateId={surveyResultsQ.data.surveyTemplate.id}
                    dateRange={dateRange}
                    campaignId={campaignId}
                    tz={tz}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="mb-8">
        <SectionHeading
          title="Canvassers"
          right={
            <span className="text-xs text-fg-muted">
              Click a row to view individual responses
            </span>
          }
        />
        {canvassersQ.isLoading ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-fg-muted">
            Loading canvassers…
          </div>
        ) : canvassersQ.error ? (
          <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
            Error: {canvassersQ.error.message}
          </div>
        ) : (
          <CanvasserTable
            rows={canvassersQ.data || []}
            onRowClick={setSelectedCanvasser}
            tz={tz}
          />
        )}
      </section>

      {selectedCanvasser && (
        <CanvasserResponsesModal
          canvasser={selectedCanvasser}
          dateRange={dateRange}
          campaignId={campaignId}
          tz={tz}
          onClose={() => setSelectedCanvasser(null)}
        />
      )}
    </div>
  );
}
