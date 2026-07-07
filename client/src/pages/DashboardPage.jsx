import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import StatCard from '../components/StatCard.jsx';
import CoverageBar from '../components/CoverageBar.jsx';
import QuestionResults, { TagResults } from '../components/QuestionResults.jsx';
import CanvasserSummaryTable from '../components/CanvasserSummaryTable.jsx';
import CanvasserResponsesModal from '../components/CanvasserResponsesModal.jsx';
import DateRangeSelector, { defaultRange } from '../components/DateRangeSelector.jsx';
import InfoHint from '../components/InfoHint.jsx';
import SetupProgress from '../components/SetupProgress.jsx';
import NextStepBanner from '../components/NextStepBanner.jsx';
import { rateAccent, ratePct } from '../lib/rates.js';
import { metricHelp } from '../lib/metricHelp.js';
import { useCampaignTeam } from '../lib/useCampaignTeam.js';
import { todayInTz } from '../lib/datePresets.js';
import { useAuth, useOrgTimeZone } from '../auth/AuthContext.jsx';

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
  const location = useLocation();
  const justCreated = location.state?.justCreated; // set by CampaignsPage right after create
  const orgTz = useOrgTimeZone();
  const { homePath } = useAuth(); // /admin for admins, /campaigns for leads (no Overview)
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

  const overview = overviewQ.data || {};
  const totals = overview.totals || {};
  // A brand-new campaign (no voters imported) has nothing to report yet — keep the
  // SetupProgress checklist front and center instead of a wall of empty widgets.
  const hasDoors = (totals.households || 0) > 0;
  const overviewReady = !overviewQ.isLoading && !overviewQ.error;
  const canvass = overview.canvass || {};
  const rangeStats = rollupQ.data?.cumulative || {};
  const isLitDrop = selectedCampaign?.type === 'lit_drop';

  // Reuse the Timeline's canvasser table. Its rows come from /canvasser-timeline;
  // here we normalize the /admin/reports/canvassers leaderboard rows into the same
  // shape — rename Doors/Surveys/Lit, compute doors-per-hour from first→last, and
  // join the coordinator from the shared campaign-assignments cache (like TimelinePage).
  const { members } = useCampaignTeam(campaignId);
  const coordByUserId = useMemo(() => {
    const m = new Map();
    for (const member of members) {
      m.set(String(member.user.id), {
        coordinatorName: member.user.coordinatorName || null,
      });
    }
    return m;
  }, [members]);
  const canvasserRows = useMemo(() => {
    return (canvassersQ.data || []).map((r) => {
      const dayKnocks = r.knocks ?? r.homesKnocked ?? 0;
      const first = r.firstActivityAt ? new Date(r.firstActivityAt).getTime() : null;
      const last = r.lastActivityAt ? new Date(r.lastActivityAt).getTime() : null;
      const hours = first && last ? (last - first) / 3600000 : 0;
      return {
        ...r,
        dayKnocks,
        daySurveys: r.surveysSubmitted ?? 0,
        dayLit: r.litDropped ?? 0,
        doorsPerHour: hours > 0 ? Math.round((dayKnocks / hours) * 100) / 100 : 0,
        coordinatorName: coordByUserId.get(String(r.userId))?.coordinatorName || null,
      };
    });
  }, [canvassersQ.data, coordByUserId]);
  const rangeTo = dateRange?.to || (tz ? todayInTz(tz) : null);
  const singleDayRange = !!dateRange && dateRange.from === rangeTo;

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
          Pick a campaign to view its dashboard.
        </p>
        <Link
          to={homePath}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
        >
          {homePath === '/campaigns' ? 'Go to Campaigns' : 'Go to Overview'}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-fg">
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
          {efforts.length > 1 && (
            <select
              value={effortId}
              onChange={(e) => setEffortId(e.target.value)}
              title="Filter to one walk list"
              className="rounded border border-border-strong bg-card px-2 py-1 text-sm text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="">All walk lists</option>
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

      {justCreated && (
        <NextStepBanner
          tone="success"
          title={`${current?.name || 'Campaign'} created.`}
          className="mb-6"
          action={{ label: 'Import voters', to: `/campaigns/${campaignId}/import` }}
        >
          Start with the checklist below — first up, import your voter file.
        </NextStepBanner>
      )}
      {current && current.isActive !== false && (
        <div className="mb-6">
          <SetupProgress campaignId={campaignId} />
        </div>
      )}

      {overviewReady && !hasDoors ? (
        <section className="mb-8">
          <div className="rounded-lg border border-dashed border-border bg-sunken p-8 text-center">
            <p className="text-sm font-medium text-fg">No data yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
              Coverage and live stats appear here once you import voters and canvassing starts. Use the
              checklist above to get set up.
            </p>
          </div>
        </section>
      ) : (
        <>
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
              help={metricHelp.doors}
            />
            {isLitDrop ? (
              <StatCard
                label="Lit drops"
                value={rangeStats.litDropped?.toLocaleString()}
                hint="events"
                accent="green"
                help={metricHelp.litDrops}
              />
            ) : (
              <>
                <StatCard
                  label="Surveys"
                  value={rangeStats.surveysSubmitted?.toLocaleString()}
                  hint="per voter"
                  accent="green"
                  help={metricHelp.surveys}
                />
                <StatCard
                  label="Surveyed voters"
                  value={rangeStats.surveyedVoters?.toLocaleString()}
                  hint="distinct voters reached"
                  help={metricHelp.surveyedVoters}
                />
              </>
            )}
            <StatCard
              label={isLitDrop ? 'Lit rate' : 'Connection rate'}
              value={ratePct(rangeStats.connectionRate)}
              hint={isLitDrop ? 'lit knocks ÷ knocks' : 'surveyed knocks ÷ knocks'}
              accent={rateAccent(rangeStats.connectionRate)}
              help={metricHelp.connectionRate}
            />
          </div>
        )}
      </section>

      {/* Coverage — current-state, all-time */}
      <section className="mb-8">
        <SectionHeading
          title="Coverage"
          right={
            <span className="flex items-center gap-1 text-xs text-fg-muted">
              All-time
              <InfoHint label="About Coverage">{metricHelp.households}</InfoHint>
            </span>
          }
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


      {selectedCampaign?.type === 'survey' && (
        <section className="mb-8" ref={surveyResultsRef}>
          {(() => {
            // A campaign can swap surveys over time; each keeps its own responses. Offer a
            // switcher when there's a past survey to view, defaulting to the current one.
            const surveys = surveysQ.data || [];
            const past = surveys.filter((s) => !s.current);
            const current = surveys.find((s) => s.current);
            const viewingPast = !!selectedTemplateId && past.some((s) => s.id === selectedTemplateId);
            return (
              <>
                <SectionHeading
                  title="Survey results"
                  right={
                    past.length ? (
                      <select
                        value={selectedTemplateId}
                        onChange={(e) => setSelectedTemplateId(e.target.value)}
                        className="rounded border border-border bg-card px-2 py-1 text-sm text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                      >
                        <option value="">
                          {current ? `${current.name} (current) · ${current.responseCount}` : 'Current survey'}
                        </option>
                        {past.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} · {s.responseCount}
                          </option>
                        ))}
                      </select>
                    ) : null
                  }
                />
                {viewingPast && (
                  <p className="mb-3 text-xs text-warning-fg">
                    Showing a survey no longer attached to this campaign — its responses still count toward
                    this campaign's totals.
                  </p>
                )}
              </>
            );
          })()}
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
            <>
            {(surveyResultsQ.data.tags || []).length > 0 && (
              <div className="mb-4">
                <TagResults
                  tags={surveyResultsQ.data.tags}
                  surveyTemplateId={surveyResultsQ.data.surveyTemplate.id}
                  dateRange={dateRange}
                  campaignId={campaignId}
                  tz={tz}
                />
              </div>
            )}
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
            </>
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
          <CanvasserSummaryTable
            rows={canvasserRows}
            tz={tz}
            singleDay={singleDayRange}
            litMode={isLitDrop}
            onRowClick={setSelectedCanvasser}
          />
        )}
      </section>
        </>
      )}

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
