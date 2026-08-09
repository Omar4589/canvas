import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useParams, Link, useSearchParams, useNavigationType } from 'react-router-dom';
import { api, getToken, getActiveOrgId } from '../api/client.js';
import { useAuth, useOrgTimeZone } from '../auth/AuthContext.jsx';
import DateRangeSelector, { defaultRange } from '../components/DateRangeSelector.jsx';
import StatCard from '../components/StatCard.jsx';
import AnswerCanvasserTable from '../components/AnswerCanvasserTable.jsx';
import AnswerMiniMap from '../components/AnswerMiniMap.jsx';
import ResponseDetailDrawer from '../components/ResponseDetailDrawer.jsx';
import { Badge, DataTable, Segmented } from '../components/ui/index.js';
import { formatInTz } from '../lib/datetime.js';
import { percentsTo100 } from '../lib/percent.js';
import { useCampaignTeam } from '../lib/useCampaignTeam.js';

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

const LIMIT = 50;
const TIME_OPTS = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' };

const SELECT_CLS =
  'rounded border border-border-strong bg-card px-2 py-1 text-sm text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30';

// Survey Explorer: the full answer-audit workspace. Pick a survey question + answer (or
// arrive via an accordion / tag deep-link) and see who gave it, who RECORDED it, where
// those doors sit, and every individual response — all URL-addressable so a drill can be
// shared. Campaign-scoped like Timeline/Audit/Notes; every report fetch carries campaignId
// (the reports router 403s a team lead without it). No live polling on purpose.
export default function SurveyExplorerPage() {
  const { campaignId } = useParams();
  const orgTz = useOrgTimeZone();
  const { homePath } = useAuth();

  // URL is the filter state (survey/q/optionId/option/userId/effortId/view/tag + from/to),
  // written with replace so twiddling filters doesn't spam the back stack.
  const [searchParams, setSearchParams] = useSearchParams();
  const survey = searchParams.get('survey') || '';
  const q = searchParams.get('q') || '';
  const optionId = searchParams.get('optionId') || '';
  const option = searchParams.get('option') || '';
  const userId = searchParams.get('userId') || '';
  const effortId = searchParams.get('effortId') || '';
  // Round scoping. `roundNumber` restarts per walk list, so this is a Pass _id, never a number.
  const passId = searchParams.get('pass') || '';
  const tag = searchParams.get('tag') || '';
  const view = searchParams.get('view') === 'canvassers' ? 'canvassers' : 'voters';

  function updateParams(patch) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  }

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const campaigns = campaignsQ.data?.campaigns || [];
  const current = campaigns.find((c) => String(c._id) === String(campaignId)) || undefined;
  const tz = current?.timeZone || orgTz;
  const tzReady = !campaignsQ.isLoading;

  // Range: seeded from a deep-link (?from/&to, or ?range=all — All time has NO bounds, so
  // absence alone can't encode it; a bare URL means "no deep link" and defaults to Today)
  // or defaulted to the campaign's "today" once its tz is known (DashboardPage's seeding).
  const [dateRange, setDateRange] = useState(() => {
    const f = searchParams.get('from');
    const t = searchParams.get('to');
    if (f || t) return { preset: 'custom', from: f || null, to: t || null };
    if (searchParams.get('range') === 'all') return defaultRange('all', orgTz);
    return null;
  });
  const rangeTouchedRef = useRef(
    !!(searchParams.get('from') || searchParams.get('to') || searchParams.get('range') === 'all')
  );
  useEffect(() => {
    if (rangeTouchedRef.current || !tzReady) return;
    setDateRange(defaultRange('today', tz));
  }, [tzReady, tz]);
  function onRangeChange(next) {
    rangeTouchedRef.current = true;
    setDateRange(next);
    updateParams({
      from: next.from || '',
      to: next.to || '',
      range: !next.from && !next.to ? 'all' : '',
    });
  }

  const [page, setPage] = useState(0);
  const [detailId, setDetailId] = useState(null);

  // The sidebar campaign switcher re-renders this SAME mounted page with a new
  // :campaignId — clear campaign A's drill (template/question/option ids would
  // query empty in campaign B) and reseed the range. EXCEPT on back/forward: a
  // popstate restores a URL whose params belong to the destination campaign's own
  // drill — honor them (and reseed the range FROM them) instead of wiping the
  // restored history entry.
  const navigationType = useNavigationType();
  const prevCampaignRef = useRef(campaignId);
  useEffect(() => {
    if (prevCampaignRef.current === campaignId) return;
    prevCampaignRef.current = campaignId;
    setPage(0);
    setDetailId(null);
    if (navigationType === 'POP') {
      const f = searchParams.get('from');
      const t = searchParams.get('to');
      const all = searchParams.get('range') === 'all';
      rangeTouchedRef.current = !!(f || t || all);
      if (f || t) setDateRange({ preset: 'custom', from: f || null, to: t || null });
      else if (all) setDateRange(defaultRange('all', tz));
      else setDateRange(tzReady ? defaultRange('today', tz) : null);
      return;
    }
    rangeTouchedRef.current = false;
    setDateRange(tzReady ? defaultRange('today', tz) : null);
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [campaignId, tz, tzReady, setSearchParams, navigationType, searchParams]);

  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId,
  });
  const efforts = effortsQ.data?.efforts || [];

  // Rounds, for the round filter. Labelled "walk list · Pass N" because `roundNumber` restarts per
  // effort (models/Pass.js) — a bare "Pass 2" names a different round in every walk list. Same
  // effort-then-round ordering the knocks-by-pass report uses, so the two read alike.
  const passesQ = useQuery({
    queryKey: ['admin', 'passes', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes`),
    enabled: !!campaignId,
  });
  const roundOptions = useMemo(() => {
    const effortName = new Map(efforts.map((ef) => [String(ef._id), ef.name]));
    const rows = (passesQ.data?.passes || [])
      .map((p) => ({
        id: String(p._id),
        effortName: effortName.get(String(p.effortId)) || '',
        roundNumber: p.roundNumber,
        label: `${effortName.get(String(p.effortId)) || 'Walk list'} · Pass ${p.roundNumber}`,
      }))
      .sort(
        (a, b) =>
          (a.effortName || '￿').localeCompare(b.effortName || '￿') ||
          (a.roundNumber ?? Infinity) - (b.roundNumber ?? Infinity)
      );
    // Pre-turf responses carry passId:null and belong to no Pass document. Without this option
    // they'd sit in "All passes" and in no selectable pass, so the passes would not add up to the
    // headline. Sorted last, mirroring the "Legacy / no pass" row on the knocks-by-pass report.
    // This label is synthesized HERE, not supplied by the server, so it has to be kept in step with
    // routes/admin/reports.js by hand. The 'legacy' id is the server sentinel and never changes.
    if ((passesQ.data?.legacyResponseCount || 0) > 0) {
      rows.push({ id: 'legacy', effortName: '￿', roundNumber: Infinity, label: 'Legacy / no pass' });
    }
    return rows;
  }, [passesQ.data, efforts]);

  // allMembers, not members: the canvasser filter must list whoever RECORDED responses,
  // including someone since deactivated — their entries are still on the page.
  const { allMembers } = useCampaignTeam(campaignId);
  const canvasserOptions = useMemo(
    () =>
      (allMembers || [])
        .map((m) => ({
          id: String(m.user.id),
          name: `${m.user.firstName || ''} ${m.user.lastName || ''}`.trim() || m.user.email,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allMembers]
  );

  const surveysQ = useQuery({
    queryKey: ['reports', 'surveys', campaignId],
    queryFn: () => api(`/admin/reports/surveys${buildQuery({ campaignId })}`),
    enabled: !!campaignId,
  });
  const surveyList = surveysQ.data || [];

  // Same endpoint the Dashboard accordion reads — with IDENTICAL filters (incl. userId),
  // so the headline count here can never disagree with the accordion for the same drill.
  const resultsQ = useQuery({
    queryKey: [
      'reports',
      'survey-results',
      'explorer',
      campaignId,
      effortId,
      passId,
      survey,
      userId,
      dateRange?.from,
      dateRange?.to,
    ],
    queryFn: () =>
      api(
        `/admin/reports/survey-results${buildQuery({
          campaignId,
          effortId,
          passId,
          surveyTemplateId: survey,
          userId,
          from: dateRange?.from,
          to: dateRange?.to,
        })}`
      ),
    enabled: !!campaignId && !!dateRange,
  });
  const template = resultsQ.data?.surveyTemplate || null;
  const choiceQuestions = useMemo(
    () =>
      (resultsQ.data?.questions || []).filter(
        (x) => x.type === 'single_choice' || x.type === 'multiple_choice'
      ),
    [resultsQ.data]
  );

  const hasOption = !!(q && (option || optionId));
  const matchesSel = (o) => (optionId ? o.id === optionId : o.option === option);
  const selectedQuestion = choiceQuestions.find((x) => x.key === q) || null;
  const optionIdx = selectedQuestion ? (selectedQuestion.options || []).findIndex(matchesSel) : -1;
  const optionRow = optionIdx >= 0 ? selectedQuestion.options[optionIdx] : null;
  const questionTotal = selectedQuestion
    ? selectedQuestion.options.reduce((s, o) => s + (o.count || 0), 0)
    : 0;
  const percents = selectedQuestion
    ? percentsTo100(selectedQuestion.options.map((o) => o.count || 0))
    : [];
  const optionPct = optionIdx >= 0 ? percents[optionIdx] : 0;

  // EVERY drill must be template-scoped exactly like the headline: /survey-results resolves
  // the campaign's current template server-side when none is passed, but voters-by-answer /
  // answer-canvassers / the CSV do NOT — and question keys / option ids are label slugs
  // unique only WITHIN one template, so an unscoped drill on a multi-survey campaign would
  // silently count another survey's same-named option and stop summing to the headline.
  const resolvedTemplateId = survey || (template ? template.id : '');
  const drillActive = tag ? !!resolvedTemplateId : hasOption && !!resolvedTemplateId;

  // Per-canvasser breakdown — powers the "Canvassers" stat AND the By-canvasser table.
  // Deliberately NOT userId-filtered: the table lists everyone so a row click can TOGGLE
  // the filter. Tag mode never fetches (the endpoint 400s by design).
  const canvassersQ = useQuery({
    queryKey: [
      'reports',
      'answer-canvassers',
      campaignId,
      q,
      optionId,
      option,
      resolvedTemplateId,
      effortId,
      passId,
      dateRange?.from,
      dateRange?.to,
    ],
    queryFn: () =>
      api(
        `/admin/reports/answer-canvassers${buildQuery({
          questionKey: q,
          optionId,
          option,
          surveyTemplateId: resolvedTemplateId,
          campaignId,
          effortId,
          passId,
          from: dateRange?.from,
          to: dateRange?.to,
        })}`
      ),
    enabled: !!campaignId && !!dateRange && !tag && hasOption && !!resolvedTemplateId,
  });
  const canvasserRows = canvassersQ.data?.rows || [];

  const listFilters = tag
    ? {
        tag,
        surveyTemplateId: resolvedTemplateId,
        campaignId,
        userId,
        effortId,
        passId,
        from: dateRange?.from,
        to: dateRange?.to,
      }
    : {
        questionKey: q,
        optionId,
        option,
        surveyTemplateId: resolvedTemplateId,
        campaignId,
        userId,
        effortId,
        passId,
        from: dateRange?.from,
        to: dateRange?.to,
      };

  // Any filter change returns to the first page.
  useEffect(() => {
    setPage(0);
  }, [q, optionId, option, tag, survey, userId, effortId, passId, dateRange?.from, dateRange?.to]);

  const listQ = useQuery({
    queryKey: [
      'reports',
      'voters-by-answer',
      'explorer',
      campaignId,
      q,
      optionId,
      option,
      tag,
      resolvedTemplateId,
      userId,
      effortId,
      passId,
      dateRange?.from,
      dateRange?.to,
      page,
    ],
    queryFn: () =>
      api(`/admin/reports/voters-by-answer${buildQuery({ ...listFilters, limit: LIMIT, skip: page * LIMIT })}`),
    enabled: !!campaignId && !!dateRange && drillActive,
    placeholderData: keepPreviousData,
  });
  const listRows = listQ.data?.voters || [];
  const listTotal = listQ.data?.total || 0;
  const pageStart = page * LIMIT;
  const hasNext = pageStart + listRows.length < listTotal;

  // CSV of the current drill — the export endpoint streams an attachment, not JSON, so
  // the shared api() helper can't be used; raw fetch + blob (the WalkListsPage pattern).
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  async function exportCsv() {
    setExportError('');
    setExporting(true);
    try {
      const headers = {};
      const token = getToken();
      const orgId = getActiveOrgId();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (orgId) headers['X-Org-Id'] = orgId;
      const res = await fetch(`/api/admin/reports/voters-by-answer.csv${buildQuery(listFilters)}`, { headers });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const disp = res.headers.get('Content-Disposition') || '';
      const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp);
      const fileName = m ? decodeURIComponent(m[1]) : 'answers.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  function selectOption(qKey, o) {
    const active = q === qKey && matchesSel(o);
    if (active) updateParams({ optionId: '', option: '', view: '' });
    else updateParams({ q: qKey, optionId: o.id || '', option: o.option, tag: '', view: '' });
  }

  if (!campaignId || (!campaignsQ.isLoading && !current)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-xl font-semibold text-fg">Campaign not found</h1>
        <Link
          to={homePath}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          {homePath === '/campaigns' ? 'Go to Campaigns' : 'Go to Overview'}
        </Link>
      </div>
    );
  }

  const drillLabel = tag ? `Tag: ${tag}` : hasOption ? option : '';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-fg">{current?.name || 'Campaign'}</h1>
          <div className="mt-1 text-sm text-fg-muted">Survey Explorer — drill into any answer</div>
        </div>
        <DateRangeSelector value={dateRange} onChange={onRangeChange} tz={tz} />
      </div>

      {/* Filter bar */}
      <div className="mb-6 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          {surveyList.length > 1 && (
            <select
              value={survey}
              onChange={(e) => updateParams({ survey: e.target.value, q: '', optionId: '', option: '', tag: '', view: '' })}
              title="Survey"
              className={SELECT_CLS}
            >
              <option value="">
                {surveyList.find((s) => s.current)
                  ? `${surveyList.find((s) => s.current).name} (current)`
                  : 'Current survey'}
              </option>
              {surveyList
                .filter((s) => !s.current)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.responseCount}
                  </option>
                ))}
            </select>
          )}
          {!tag && choiceQuestions.length > 0 && (
            <select
              value={q}
              onChange={(e) => updateParams({ q: e.target.value, optionId: '', option: '', view: '' })}
              title="Question"
              className={SELECT_CLS}
            >
              <option value="">Pick a question…</option>
              {choiceQuestions.map((qq) => (
                <option key={qq.key} value={qq.key}>
                  {qq.label}
                </option>
              ))}
            </select>
          )}
          {(canvasserOptions.length > 0 || userId) && (
            <select
              value={userId}
              onChange={(e) => updateParams({ userId: e.target.value })}
              title="Filter by canvasser"
              className={SELECT_CLS}
            >
              <option value="">Any canvasser</option>
              {/* A table-row click or deep link can select someone off the roster (removed
                  from the org) — the filter must stay visible and clearable, not silent. */}
              {userId && !canvasserOptions.some((c) => c.id === userId) && (
                <option value={userId}>
                  {(() => {
                    const r = canvasserRows.find((x) => String(x.userId) === userId);
                    const name = r ? `${r.firstName} ${r.lastName}`.trim() : '';
                    return name ? `${name} (departed)` : 'Departed canvasser';
                  })()}
                </option>
              )}
              {canvasserOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {efforts.length > 1 && (
            <select
              value={effortId}
              onChange={(e) => updateParams({ effortId: e.target.value })}
              title="Filter to one walk list"
              className={SELECT_CLS}
            >
              <option value="">All walk lists</option>
              {efforts.map((ef) => (
                <option key={ef._id} value={ef._id}>
                  {ef.name}
                </option>
              ))}
            </select>
          )}
          {roundOptions.length > 1 && (
            <select
              value={passId}
              onChange={(e) => updateParams({ pass: e.target.value })}
              title="Filter to one round"
              className={SELECT_CLS}
            >
              <option value="">All rounds</option>
              {roundOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
          {tag && (
            <button
              type="button"
              onClick={() => updateParams({ tag: '', view: '' })}
              className="inline-flex items-center gap-1.5 rounded-full border border-brand-600 bg-brand-tint px-2.5 py-1 text-xs text-brand-accent"
              title="Clear the tag drill"
            >
              Tag: {tag} <span aria-hidden="true">✕</span>
            </button>
          )}
        </div>
        {/* Option chips for the selected question */}
        {!tag && selectedQuestion && (
          <div className="mt-3 flex flex-wrap gap-1">
            {selectedQuestion.options.map((o) => {
              const active = matchesSel(o);
              return (
                <button
                  key={o.id ?? o.option}
                  type="button"
                  onClick={() => selectOption(selectedQuestion.key, o)}
                  title={`${o.count} responses`}
                  className={
                    'rounded-full px-2.5 py-1 text-xs transition-colors ' +
                    (active
                      ? 'bg-brand-600 text-white'
                      : 'border border-border bg-card text-fg-muted hover:bg-sunken') +
                    (o.retired ? ' opacity-60' : '')
                  }
                >
                  {o.option}
                  <span className={active ? 'ml-1 opacity-80' : 'ml-1 text-fg-muted'}>{o.count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {resultsQ.isLoading || !dateRange ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-fg-muted">Loading…</div>
      ) : resultsQ.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
          Error: {resultsQ.error.message}
        </div>
      ) : !template ? (
        <div className="rounded-lg border border-dashed border-border bg-sunken p-8 text-center text-sm text-fg-muted">
          This campaign has no survey linked yet.
        </div>
      ) : !drillActive ? (
        // Nothing picked yet: every question's options as clickable chips.
        <div className="rounded-lg border border-dashed border-border bg-sunken p-6">
          <p className="text-sm font-medium text-fg">Pick a question and answer to explore</p>
          <p className="mt-1 text-sm text-fg-muted">
            You'll see the count, who recorded it, every individual response, and the doors on a map.
          </p>
          <div className="mt-4 space-y-4">
            {choiceQuestions.length === 0 && (
              <p className="text-sm text-fg-muted">No choice questions in this survey.</p>
            )}
            {choiceQuestions.map((qq) => (
              <div key={qq.key}>
                <div className="mb-1 text-xs font-medium text-fg-muted">{qq.label}</div>
                <div className="flex flex-wrap gap-1">
                  {qq.options.map((o) => (
                    <button
                      key={o.id ?? o.option}
                      type="button"
                      onClick={() => selectOption(qq.key, o)}
                      title={`${o.count} responses`}
                      className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-fg-muted transition-colors hover:bg-card hover:text-fg"
                    >
                      {o.option}
                      <span className="ml-1 text-fg-subtle">{o.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Headline: the survey-results option count for identical filters. The list below
              reports its OWN total — a rare legacy edge row can differ, so we never present
              the two as the same number. */}
          {!tag && (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <StatCard
                label="Answers"
                value={(optionRow?.count ?? 0).toLocaleString()}
                hint={`“${option}” in range`}
                accent="brand"
              />
              <StatCard
                label="% of question"
                value={`${(optionPct || 0).toFixed(1)}%`}
                hint={`of ${questionTotal.toLocaleString()} answers`}
              />
              <StatCard
                label="Canvassers"
                value={canvassersQ.isLoading ? '…' : canvasserRows.length.toLocaleString()}
                hint="recorded this answer"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-fg">{drillLabel}</h2>
              {!tag ? (
                <Segmented
                  size="sm"
                  value={view}
                  onChange={(v) => updateParams({ view: v === 'canvassers' ? 'canvassers' : '' })}
                  options={[
                    { value: 'voters', label: 'Voters' },
                    { value: 'canvassers', label: 'By canvasser' },
                  ]}
                />
              ) : (
                <span className="text-xs text-fg-muted">
                  Tags roll up distinct voters across questions, so there's no per-canvasser breakdown.
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {exportError && <span className="text-xs text-danger">{exportError}</span>}
              <button
                type="button"
                onClick={exportCsv}
                disabled={exporting}
                className="rounded border border-border-strong bg-card px-3 py-1 text-sm text-fg-muted hover:bg-sunken disabled:opacity-50"
              >
                {exporting ? 'Exporting…' : 'Export CSV'}
              </button>
            </div>
          </div>

          {/* WHERE those answers live, ABOVE the list on purpose: the map reads at a glance and
              is where you actually want to start, while the table needed a long scroll to reach.
              Clicking a pin gives the same per-response detail the table rows open, so the list
              below is now the fallback for reading in bulk rather than the only way in.

              Tag mode is skipped: the map endpoint's answer filter is per question+option only.
              `passId` keeps the dots on the same round as the list; the 'legacy' sentinel is not
              an ObjectId so the endpoint would ignore it — send nothing rather than mis-scope. */}
          {!tag && hasOption && (
            <AnswerMiniMap
              campaignId={campaignId}
              questionKey={q}
              option={option}
              optionId={optionId}
              surveyTemplateId={resolvedTemplateId}
              userId={userId}
              effortId={effortId}
              passId={passId && passId !== 'legacy' ? passId : undefined}
              from={dateRange?.from}
              to={dateRange?.to}
              tz={tz}
              onOpenResponse={setDetailId}
            />
          )}

          {!tag && view === 'canvassers' ? (
            canvassersQ.isLoading ? (
              <div className="rounded-lg border border-border bg-card p-4 text-sm text-fg-muted">Loading…</div>
            ) : canvassersQ.error ? (
              <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
                Error: {canvassersQ.error.message}
              </div>
            ) : (
              <AnswerCanvasserTable
                rows={canvasserRows}
                selectedUserId={userId}
                onSelect={(id) => updateParams({ userId: id, view: '' })}
                tz={tz}
              />
            )
          ) : listQ.isLoading ? (
            <div className="rounded-lg border border-border bg-card p-4 text-sm text-fg-muted">Loading…</div>
          ) : listQ.error ? (
            <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
              Error: {listQ.error.message}
            </div>
          ) : listRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-sunken p-8 text-center text-sm text-fg-muted">
              No entries match these filters.
            </div>
          ) : (
            <>
              <DataTable
                head={
                  <>
                    <th className="px-4 py-2.5">Voter</th>
                    <th className="px-4 py-2.5">Address</th>
                    <th className="px-4 py-2.5">Canvasser</th>
                    <th className="px-4 py-2.5">Submitted</th>
                    <th className="px-4 py-2.5">Note</th>
                    <th className="w-16 px-4 py-2.5"></th>
                  </>
                }
              >
                {listRows.map((v) => (
                  <tr
                    key={v.responseId}
                    onClick={() => setDetailId(v.responseId)}
                    className="cursor-pointer transition-colors hover:bg-sunken/60"
                  >
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-fg">{v.voter?.fullName || 'Unknown'}</span>
                      {v.voter?.party && (
                        <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs text-fg-muted">
                          {v.voter.party}
                        </span>
                      )}
                      {v.wasOfflineSubmission && (
                        <Badge variant="info" className="ml-2">
                          Offline
                        </Badge>
                      )}
                    </td>
                    <td className="max-w-[16rem] truncate px-4 py-2.5 text-fg-muted">
                      {v.household ? `${v.household.addressLine1}, ${v.household.city}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-fg-muted">
                      {v.canvasser ? `${v.canvasser.firstName} ${v.canvasser.lastName}` : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-fg-muted">
                      {formatInTz(v.submittedAt, tz, TIME_OPTS, true) || '—'}
                    </td>
                    <td className="max-w-[14rem] truncate px-4 py-2.5 text-xs italic text-fg-subtle" title={v.note || ''}>
                      {v.note ? `“${v.note}”` : ''}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {v.household && (
                        <Link
                          to={`/campaigns/${campaignId}/map?household=${v.household.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs font-medium text-brand-accent hover:underline"
                        >
                          Map →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </DataTable>
              <div className="flex items-center justify-between text-sm text-fg-muted">
                <span>
                  Showing {pageStart + 1}–{pageStart + listRows.length} of {listTotal.toLocaleString()} entries
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="rounded border border-border-strong px-3 py-1 text-sm text-fg-muted hover:bg-sunken disabled:opacity-40"
                  >
                    ‹ Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!hasNext}
                    className="rounded border border-border-strong px-3 py-1 text-sm text-fg-muted hover:bg-sunken disabled:opacity-40"
                  >
                    Next ›
                  </button>
                </div>
              </div>
            </>
          )}

        </div>
      )}

      {detailId && (
        <ResponseDetailDrawer
          responseId={detailId}
          campaignId={campaignId}
          tz={tz}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
