import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import StatCard from '../components/StatCard.jsx';
import CoverageBar from '../components/CoverageBar.jsx';
import QuestionResults from '../components/QuestionResults.jsx';
import CanvasserTable from '../components/CanvasserTable.jsx';
import CanvasserResponsesModal from '../components/CanvasserResponsesModal.jsx';
import DateRangeSelector, { rangeFromId } from '../components/DateRangeSelector.jsx';
import VoterHighlights from '../components/VoterHighlights.jsx';
import CampaignSelector, { useCampaignSelection } from '../components/CampaignSelector.jsx';

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
  const [rangeId, setRangeId] = useState('all');
  const dateRange = useMemo(() => rangeFromId(rangeId), [rangeId]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedCanvasser, setSelectedCanvasser] = useState(null);

  const {
    campaignId,
    setCampaignId,
    campaigns,
    selected: selectedCampaign,
    isLoading: campaignsLoading,
  } = useCampaignSelection();

  const overviewQ = useQuery({
    queryKey: ['reports', 'overview', campaignId],
    queryFn: () =>
      api(`/admin/reports/overview${buildQuery({ campaignId })}`),
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
  const events = overview.events || {};

  const knockedPct = totals.households
    ? Math.round((100 * (totals.homesKnocked || 0)) / totals.households)
    : 0;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Overview</h1>
          {selectedCampaign && (
            <div className="mt-1 text-sm text-gray-600">
              {selectedCampaign.name}{' '}
              <span className="text-gray-400">·</span>{' '}
              {selectedCampaign.type === 'survey' ? 'Survey' : 'Lit drop'}{' '}
              <span className="text-gray-400">·</span> {selectedCampaign.state}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CampaignSelector
            campaignId={campaignId}
            onChange={setCampaignId}
            campaigns={campaigns}
            isLoading={campaignsLoading}
          />
          <DateRangeSelector value={rangeId} onChange={setRangeId} />
        </div>
      </div>

      {!campaignId && !campaignsLoading && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No active campaign selected. Create one on the{' '}
          <a href="/campaigns" className="underline">
            Campaigns
          </a>{' '}
          page.
        </div>
      )}

      {overviewQ.isLoading ? (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
          Loading overview…
        </div>
      ) : overviewQ.error ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error loading overview: {overviewQ.error.message}
        </div>
      ) : (
        <>
          <section className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              label="Households"
              value={totals.households?.toLocaleString()}
              hint="unique addresses"
            />
            <StatCard
              label={selectedCampaign?.type === 'lit_drop' ? 'Homes visited' : 'Homes knocked'}
              value={totals.homesKnocked?.toLocaleString()}
              hint={`${knockedPct}% of households · unique`}
              accent="brand"
            />
            {selectedCampaign?.type === 'lit_drop' ? (
              <StatCard
                label="Lit drops"
                value={events.litDropped?.toLocaleString()}
                hint="events"
                accent="green"
              />
            ) : (
              <StatCard
                label="Surveys submitted"
                value={totals.surveysSubmitted?.toLocaleString()}
                hint="per voter"
                accent="green"
              />
            )}
            <StatCard
              label="Active canvassers"
              value={totals.activeUsers?.toLocaleString()}
            />
          </section>

          {selectedCampaign?.type !== 'lit_drop' && (
            <section className="mb-6">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Canvasser activity
                </h2>
                <span className="text-xs text-gray-400">
                  events · sums to leaderboard
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <StatCard
                  label="Surveys submitted"
                  value={events.surveySubmitted?.toLocaleString()}
                  hint="per voter"
                  accent="green"
                />
                <StatCard
                  label="Not home"
                  value={events.notHome?.toLocaleString()}
                  hint="events"
                  accent="amber"
                />
                <StatCard
                  label="Wrong addresses"
                  value={events.wrongAddress?.toLocaleString()}
                  hint="events"
                  accent="red"
                />
              </div>
            </section>
          )}
        </>
      )}

      <section className="mb-8">
        <SectionHeading title="Canvass coverage" />
        {overviewQ.isLoading ? (
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            Loading…
          </div>
        ) : (
          <CoverageBar canvass={canvass} />
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
