import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import StatCard from '../components/StatCard.jsx';
import CoverageBar from '../components/CoverageBar.jsx';
import QuestionResults from '../components/QuestionResults.jsx';
import CanvasserTable from '../components/CanvasserTable.jsx';
import CanvasserResponsesModal from '../components/CanvasserResponsesModal.jsx';
import DateRangeSelector, { rangeFromId } from '../components/DateRangeSelector.jsx';
import VoterHighlights from '../components/VoterHighlights.jsx';
import { rateAccent, ratePct } from '../lib/rates.js';

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
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {right}
    </div>
  );
}

export default function DashboardPage() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const [rangeId, setRangeId] = useState('all');
  const dateRange = useMemo(() => rangeFromId(rangeId), [rangeId]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedCanvasser, setSelectedCanvasser] = useState(null);

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
  const activeCampaigns = campaigns.filter((c) => c.isActive);
  // Active campaigns plus the current one (even when archived) for the switcher.
  const switcherCampaigns =
    current && current.isActive === false
      ? [...activeCampaigns, current]
      : activeCampaigns;

  const overviewQ = useQuery({
    queryKey: ['reports', 'overview', campaignId],
    queryFn: () =>
      api(`/admin/reports/overview${buildQuery({ campaignId })}`),
    enabled: !!campaignId,
  });

  // Range-scoped activity (knocks/surveys/rate). Coverage stays all-time from /overview.
  const rollupQ = useQuery({
    queryKey: ['reports', 'campaign-rollup', campaignId, dateRange.from, dateRange.to],
    queryFn: () =>
      api(
        `/admin/reports/campaign-rollup${buildQuery({
          campaignId,
          from: dateRange.from,
          to: dateRange.to,
        })}`
      ),
    enabled: !!campaignId,
  });

  const surveysQ = useQuery({
    queryKey: ['reports', 'surveys', campaignId],
    queryFn: () =>
      api(`/admin/reports/surveys${buildQuery({ campaignId })}`),
    enabled: !!campaignId,
  });

  const canvassersQ = useQuery({
    queryKey: ['reports', 'canvassers', campaignId, dateRange.from, dateRange.to],
    queryFn: () =>
      api(
        `/admin/reports/canvassers${buildQuery({
          campaignId,
          from: dateRange.from,
          to: dateRange.to,
        })}`
      ),
    enabled: !!campaignId,
  });

  const surveyResultsQ = useQuery({
    queryKey: [
      'reports',
      'survey-results',
      campaignId,
      selectedTemplateId,
      dateRange.from,
      dateRange.to,
    ],
    queryFn: () =>
      api(
        `/admin/reports/survey-results${buildQuery({
          campaignId,
          surveyTemplateId: selectedTemplateId,
          from: dateRange.from,
          to: dateRange.to,
          voterPreview: 5,
        })}`
      ),
    enabled: !!campaignId && selectedCampaign?.type !== 'lit_drop',
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
        <h1 className="text-xl font-semibold text-gray-900">
          {!campaignId ? 'No campaign selected' : 'Campaign not found'}
        </h1>
        <p className="text-sm text-gray-600">
          Pick a campaign from the Overview to view its dashboard.
        </p>
        <Link
          to="/"
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
            to="/"
            className="text-sm font-medium text-brand-700 hover:underline"
          >
            ‹ Overview
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">
            {current?.name || 'Dashboard'}
          </h1>
          {selectedCampaign && (
            <div className="mt-1 text-sm text-gray-600">
              {selectedCampaign.type === 'survey' ? 'Survey' : 'Lit drop'}{' '}
              <span className="text-gray-400">·</span> {selectedCampaign.state}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Campaign
            </span>
            <select
              value={campaignId}
              onChange={(e) => navigate('/dashboard/' + e.target.value)}
              disabled={campaignsLoading}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
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
          <DateRangeSelector value={rangeId} onChange={setRangeId} />
        </div>
      </div>

      {current && current.isActive === false && (
        <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          This campaign is archived — data is read-only. Reactivate it from
          Campaigns to resume canvassing.
        </div>
      )}

      {/* Activity — honors the selected date range */}
      <section className="mb-6">
        <SectionHeading
          title="Activity"
          right={<span className="text-xs text-gray-500">Selected range</span>}
        />
        {rollupQ.isLoading ? (
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            Loading…
          </div>
        ) : rollupQ.error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
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
          right={<span className="text-xs text-gray-500">All-time</span>}
        />
        {overviewQ.isLoading ? (
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            Loading…
          </div>
        ) : overviewQ.error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Error loading coverage: {overviewQ.error.message}
          </div>
        ) : (
          <>
            <p className="mb-2 text-sm text-gray-700">
              <span className="font-semibold text-gray-900">
                {(totals.households || 0).toLocaleString()}
              </span>{' '}
              households
              <span className="mx-2 text-gray-300">·</span>
              <span className="font-semibold text-gray-900">
                {(totals.homesKnocked || 0).toLocaleString()}
              </span>{' '}
              knocked
              <span className="text-gray-400"> ({knockedPct}%)</span>
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
                <span className="text-xs text-gray-500">
                  Latest voters per option
                </span>
              }
            />
            <VoterHighlights
              surveyResults={surveyResultsQ.data}
              onSeeAll={scrollToOption}
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
                  className="rounded border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
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
            <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
              Loading survey results…
            </div>
          ) : surveyResultsQ.error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              Error: {surveyResultsQ.error.message}
            </div>
          ) : !surveyResultsQ.data?.surveyTemplate ? (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
              This campaign has no survey linked yet.
            </div>
          ) : surveyResultsQ.data.totalResponses === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
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
            <span className="text-xs text-gray-500">
              Click a row to view individual responses
            </span>
          }
        />
        {canvassersQ.isLoading ? (
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            Loading canvassers…
          </div>
        ) : canvassersQ.error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Error: {canvassersQ.error.message}
          </div>
        ) : (
          <CanvasserTable
            rows={canvassersQ.data || []}
            onRowClick={setSelectedCanvasser}
          />
        )}
      </section>

      {selectedCanvasser && (
        <CanvasserResponsesModal
          canvasser={selectedCanvasser}
          dateRange={dateRange}
          campaignId={campaignId}
          onClose={() => setSelectedCanvasser(null)}
        />
      )}
    </div>
  );
}
