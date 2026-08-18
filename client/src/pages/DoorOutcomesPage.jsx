import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth, useOrgTimeZone } from '../auth/AuthContext.jsx';
import { useCampaignTeam } from '../lib/useCampaignTeam.js';
import { formatInTz } from '../lib/datetime.js';
import { STATUS_COLORS, ACTION_LABELS } from '../lib/statusColors.js';
import { Badge, Button, Card, DataTable, EmptyState, Modal, Select, Skeleton } from '../components/ui/index.js';
import { useConversionRunPoll } from '../lib/useConversionRunPoll.js';
import { buildAnswers, dropEmptyAnswers } from '../lib/surveyAnswerForm.js';
import SurveyAnswerComposer from '../components/outcomes/SurveyAnswerComposer.jsx';
import SurveyConvertModal from '../components/outcomes/SurveyConvertModal.jsx';
import RemoveAnswersModal from '../components/outcomes/RemoveAnswersModal.jsx';
import QueueWalkthrough from '../components/outcomes/QueueWalkthrough.jsx';
import ConversionRunCard from '../components/outcomes/ConversionRunCard.jsx';

// Door Outcomes — reviewing and correcting what canvassers recorded.
//
// Two acts share this page, and the difference is real: CORRECTING a mistyped entry (where moving
// the numbers is the point) and FOLDING a retired outcome's history into another (where moving a
// number would be fabrication). The page doesn't ask which you meant — it prices every conversion
// first. A pair that cannot move a reported figure says so; a pair that can shows the campaign's
// own before/after and turns the confirm button red. That is the whole safety model, and it is why
// any door outcome may be converted here.
//
// Selection is ONE mechanism at both scales: tick a single row to fix one door, or "select all N"
// to fold an entire outcome. There is no separate single-entry mode to build or to learn.
// Org admins only — the server enforces it; a lead never sees the page's nav entry.
//
// SURVEYED is the third act, and it is the one that needed real machinery rather than a wider
// dropdown. Converting INTO Surveyed makes you compose the answers first, against the door's own
// survey, and records them attributed to the canvasser who knocked but stamped as entered by you.
// Converting OUT of it ARCHIVES the answers rather than dropping them — that direction exists for
// fraud cleanup, where the answers being removed are the evidence. Both are priced like any other
// conversion, and both are undoable. See services/canvass/surveyConversion.js.

const OUTCOMES = ['not_home', 'wrong_address', 'refused', 'no_soliciting', 'restricted'];
// Surveyed rows are listable and selectable too — they route to the survey-conversion endpoints,
// which archive their answers, never to the plain reclassify POST, which still refuses them.
const SOURCES = [...OUTCOMES, 'survey_submitted'];
const SURVEYED = 'survey_submitted';
const PAGE = 50;

const Dot = ({ k }) => (
  <span className="mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full align-middle" style={{ backgroundColor: STATUS_COLORS[k] }} aria-hidden />
);

// One before → after line. Renders "unchanged" rather than an arrow when the figure holds, so a
// glance separates what this conversion touches from what it leaves alone.
const ImpactRow = ({ label, before, after, suffix = '' }) => {
  const moved = before !== after;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-1.5 last:border-0">
      <span className="text-sm text-fg-muted">{label}</span>
      {moved ? (
        <span className="text-sm font-medium text-fg">
          <span className="text-fg-muted line-through">{before.toLocaleString()}{suffix}</span>
          <span className="mx-1.5 text-fg-subtle">→</span>
          <span className="text-danger">{after.toLocaleString()}{suffix}</span>
        </span>
      ) : (
        <span className="text-sm text-fg-muted">{before.toLocaleString()}{suffix} · unchanged</span>
      )}
    </div>
  );
};

export default function DoorOutcomesPage() {
  const { campaignId } = useParams();
  const { homePath, isOrgAdmin } = useAuth();
  const orgTz = useOrgTimeZone();
  const qc = useQueryClient();

  const [outcomes, setOutcomes] = useState([]); // [] = every convertible outcome
  const [userId, setUserId] = useState('');
  const [passId, setPassId] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(() => new Set());
  const [allMatching, setAllMatching] = useState(false); // "select all N" — filter-scoped, not ids
  const [target, setTarget] = useState('not_home');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  // Surveyed direction state. `composing` holds the resolved template while the admin picks
  // answers; `activeRun` is the run being watched (bulk) or walked (queue).
  const [composing, setComposing] = useState(null);
  const [vals, setVals] = useState({});
  const [otherTexts, setOtherTexts] = useState({});
  const [activeRunId, setActiveRunId] = useState(null);
  const [walking, setWalking] = useState(null);
  const [queueTemplate, setQueueTemplate] = useState(null);

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const current = (campaignsQ.data?.campaigns || []).find((c) => String(c._id) === String(campaignId));
  const tz = current?.timeZone || orgTz;
  const { members } = useCampaignTeam(campaignId);

  const passesQ = useQuery({
    queryKey: ['admin', 'campaign-passes', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes`),
    enabled: !!campaignId && isOrgAdmin,
  });
  const passes = passesQ.data?.passes || [];

  // The filter as the server reads it — one object so the query key, the dry run and the write
  // can never describe different scopes.
  const scope = useMemo(
    () => ({ ...(outcomes.length ? { outcomes } : {}), ...(userId ? { userId } : {}), ...(passId ? { passId } : {}) }),
    [outcomes, userId, passId]
  );

  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    if (outcomes.length) sp.set('outcomes', outcomes.join(','));
    if (userId) sp.set('userId', userId);
    if (passId) sp.set('passId', passId);
    sp.set('skip', String(page * PAGE));
    sp.set('limit', String(PAGE));
    return sp.toString();
  }, [outcomes, userId, passId, page]);

  const entriesQ = useQuery({
    queryKey: ['admin', 'outcome-entries', campaignId, qs],
    queryFn: () => api(`/admin/campaigns/${campaignId}/outcome-entries?${qs}`),
    enabled: !!campaignId && isOrgAdmin,
    placeholderData: keepPreviousData,
  });
  const entries = entriesQ.data?.entries || [];
  const total = entriesQ.data?.total || 0;
  const facets = entriesQ.data?.facets || {};

  const runsQ = useQuery({
    queryKey: ['admin', 'campaigns', campaignId, 'reclassify'],
    queryFn: () => api(`/admin/campaigns/${campaignId}/reclassify-outcomes`),
    enabled: !!campaignId && isOrgAdmin,
  });
  const runs = runsQ.data?.runs || [];

  const resetSelection = () => {
    setSelected(new Set());
    setAllMatching(false);
  };
  const afterWrite = () => {
    setPreview(null);
    resetSelection();
    qc.invalidateQueries({ queryKey: ['admin', 'outcome-entries', campaignId] });
    qc.invalidateQueries({ queryKey: ['admin', 'campaigns', campaignId, 'reclassify'] });
    // Door statuses and every derived number moved — let the rest of the console refetch.
    qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
    qc.invalidateQueries({ queryKey: ['reports'] });
  };

  // The bulk answer set, empty rows dropped — partial entry is legal, but an unanswered question
  // should not be stored as a blank row on every voter.
  const composedAnswers = () =>
    dropEmptyAnswers(buildAnswers((composing?.questions || []).filter((q) => !q.retired), vals, otherTexts));
  const answeredCount = () => composedAnswers().length;

  // `actionIds` is omitted for "select all N" so the server works from the filter — the selection
  // is then whatever currently matches, not a page's worth of stale checkboxes.
  const body = (extra = {}) => ({
    to: target,
    scope,
    ...(allMatching ? {} : { actionIds: [...selected] }),
    ...extra,
  });

  // Conversion runs live beside the reclassify runs in "Past changes".
  const convRunsQ = useQuery({
    queryKey: ['admin', 'campaigns', campaignId, 'survey-conversions'],
    queryFn: () => api(`/admin/campaigns/${campaignId}/survey-conversions`),
    enabled: !!campaignId && isOrgAdmin,
  });
  const convRuns = convRunsQ.data?.runs || [];
  const { run: liveRun } = useConversionRunPoll({ campaignId, runId: activeRunId });

  // A finished (or failed) run invalidates the same things a reclassify does.
  const prevStatus = liveRun?.status;
  useEffect(() => {
    if (prevStatus === 'completed' || prevStatus === 'failed' || prevStatus === 'reverted') afterWrite();
    // afterWrite only invalidates caches; re-running it on an unchanged status is the bug to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevStatus]);

  const convBody = (extra = {}) => ({
    direction,
    to: direction === 'to_survey' ? SURVEYED : target,
    scope,
    ...(allMatching ? {} : { actionIds: [...selected] }),
    ...extra,
  });

  // Step 1 of the Surveyed direction: resolve the ONE template these doors use. A selection
  // spanning two surveys is refused here rather than written under whichever came first.
  const loadTemplate = useMutation({
    mutationFn: () =>
      api(`/admin/campaigns/${campaignId}/survey-conversions/template`, {
        method: 'POST',
        body: { scope, ...(allMatching ? {} : { actionIds: [...selected] }) },
      }),
    onSuccess: (d) => {
      setComposing(d.template);
      setVals({});
      setOtherTexts({});
    },
    onError: (e) => setError(e.message),
  });

  const convDryRun = useMutation({
    mutationFn: () =>
      api(`/admin/campaigns/${campaignId}/survey-conversions`, {
        method: 'POST',
        body: convBody({ dryRun: true, ...(composing ? { answers: composedAnswers() } : {}) }),
      }),
    onSuccess: setPreview,
    onError: (e) => setError(e.message),
  });

  const convRun = useMutation({
    mutationFn: (mode) =>
      api(`/admin/campaigns/${campaignId}/survey-conversions`, {
        method: 'POST',
        body: convBody({ mode, ...(composing && mode === 'bulk' ? { answers: composedAnswers() } : {}) }),
      }),
    onSuccess: (d, mode) => {
      setPreview(null);
      setComposing(null);
      resetSelection();
      if (mode === 'queue') setWalking(d.run);
      else setActiveRunId(d.run.id);
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns', campaignId, 'survey-conversions'] });
    },
    onError: (e) => {
      // A 503 still created the run — surface the message and let them Resume from the card.
      setError(e.message);
      setPreview(null);
    },
  });

  // Door-by-door needs the template BEFORE the session opens, or the walkthrough renders with
  // nothing to answer. One mutation does both halves so the two can't get out of order.
  const startQueue = useMutation({
    mutationFn: async () => {
      const t = await api(`/admin/campaigns/${campaignId}/survey-conversions/template`, {
        method: 'POST',
        body: { scope, ...(allMatching ? {} : { actionIds: [...selected] }) },
      });
      const d = await api(`/admin/campaigns/${campaignId}/survey-conversions`, {
        method: 'POST',
        body: convBody({ mode: 'queue' }),
      });
      return { template: t.template, run: d.run };
    },
    onSuccess: ({ template, run }) => {
      setQueueTemplate(template);
      setWalking(run);
      resetSelection();
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns', campaignId, 'survey-conversions'] });
    },
    onError: (e) => setError(e.message),
  });

  const convRevert = useMutation({
    mutationFn: (runId) =>
      api(`/admin/campaigns/${campaignId}/survey-conversions/${runId}/revert`, { method: 'POST' }),
    onSuccess: (d) => {
      setActiveRunId(d.run?.id || null);
      afterWrite();
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns', campaignId, 'survey-conversions'] });
    },
    onError: (e) => setError(e.message),
  });

  const convResume = useMutation({
    mutationFn: (runId) =>
      api(`/admin/campaigns/${campaignId}/survey-conversions/${runId}/resume`, { method: 'POST' }),
    onSuccess: (d) => setActiveRunId(d.run.id),
    onError: (e) => setError(e.message),
  });

  const dryRun = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/reclassify-outcomes`, { method: 'POST', body: body({ dryRun: true }) }),
    onSuccess: setPreview,
    onError: (e) => setError(e.message),
  });
  const run = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/reclassify-outcomes`, { method: 'POST', body: body() }),
    onSuccess: afterWrite,
    onError: (e) => { setError(e.message); setPreview(null); },
  });
  const revert = useMutation({
    mutationFn: (runId) => api(`/admin/campaigns/${campaignId}/reclassify-outcomes/revert`, { method: 'POST', body: { runId } }),
    onSuccess: afterWrite,
    onError: (e) => setError(e.message),
  });

  if (!campaignId || (!campaignsQ.isLoading && !current)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-xl font-semibold text-fg">Campaign not found</h1>
        <Link to={homePath} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          Go back
        </Link>
      </div>
    );
  }
  if (!isOrgAdmin) {
    return (
      <div className="max-w-lg">
        <EmptyState
          title="Org admins only"
          hint="Changing what a recorded entry says is an org-admin action. Ask an admin if an outcome was recorded wrongly."
        />
      </div>
    );
  }

  const isSurveyCampaign = current?.type === 'survey';
  const selectionCount = allMatching ? total : selected.size;
  // Direction is read off the SELECTION and the target, never asked for: picking Surveyed as the
  // target means "record answers", and having surveyed rows selected means "remove them".
  const selectedRows = entries.filter((e) => allMatching || selected.has(e.id));
  const selectionHasSurveyed = allMatching
    ? outcomes.length === 1 && outcomes[0] === SURVEYED
    : selectedRows.some((e) => e.actionType === SURVEYED);
  const direction = selectionHasSurveyed ? 'from_survey' : target === SURVEYED ? 'to_survey' : null;
  const isSurveyConversion = direction !== null;
  const toggleOutcome = (k) => {
    setPage(0);
    resetSelection();
    setOutcomes((prev) => (prev.includes(k) ? prev.filter((o) => o !== k) : [...prev, k]));
  };

  return (
    <div className="pb-24">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-fg">{current?.name || 'Campaign'}</h1>
        <div className="mt-1 text-sm text-fg-muted">
          Door Outcomes — review and correct what canvassers recorded at each door
        </div>
      </div>

      {/* Filters */}
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {SOURCES.map((k) => {
            const on = outcomes.includes(k);
            const n = facets[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleOutcome(k)}
                className={[
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  on ? 'border-brand-accent bg-brand-tint text-brand-tint-fg' : 'border-border bg-card text-fg-muted hover:bg-sunken',
                ].join(' ')}
              >
                <Dot k={k} />
                {ACTION_LABELS[k]}
                {n ? <span className="ml-1 text-fg-subtle">{n}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select value={userId} onChange={(e) => { setUserId(e.target.value); setPage(0); resetSelection(); }} className="w-52">
            <option value="">All canvassers</option>
            {members.map((m) => (
              <option key={m.user.id} value={m.user.id}>
                {[m.user.firstName, m.user.lastName].filter(Boolean).join(' ') || m.user.email}
              </option>
            ))}
          </Select>
          <Select value={passId} onChange={(e) => { setPassId(e.target.value); setPage(0); resetSelection(); }} className="w-52">
            <option value="">All rounds</option>
            {passes.map((p) => (
              <option key={p._id} value={p._id}>{p.name || `Round ${p.roundNumber}`}</option>
            ))}
          </Select>
          {(outcomes.length || userId || passId) ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setOutcomes([]); setUserId(''); setPassId(''); setPage(0); resetSelection(); }}
            >
              Clear filters
            </Button>
          ) : null}
          <span className="ml-auto text-xs text-fg-muted">
            {entriesQ.isLoading ? 'Loading…' : `${total.toLocaleString()} ${total === 1 ? 'entry' : 'entries'}`}
          </span>
        </div>
      </Card>

      {error && (
        <div className="mb-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{error}</div>
      )}

      {/* Entries */}
      {entriesQ.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !entries.length ? (
        <EmptyState
          title="No entries match"
          hint="Nothing recorded here yet, or the filters are too narrow. Lit-drop entries never appear — a lit drop has no answers to move either way."
        />
      ) : (
        <>
          <DataTable
            head={
              <>
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    className="h-4 w-4 accent-brand-accent"
                    checked={entries.every((e) => selected.has(e.id)) && !!entries.length}
                    onChange={(ev) => {
                      setAllMatching(false);
                      setSelected((prev) => {
                        const next = new Set(prev);
                        for (const e of entries) ev.target.checked ? next.add(e.id) : next.delete(e.id);
                        return next;
                      });
                    }}
                  />
                </th>
                <th className="px-3 py-2">Door</th>
                <th className="px-3 py-2">Recorded</th>
                <th className="px-3 py-2">Canvasser</th>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Round</th>
              </>
            }
          >
            {entries.map((e) => (
              <tr key={e.id} className={selected.has(e.id) || allMatching ? 'bg-brand-tint/30' : undefined}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Select ${e.address}`}
                    className="h-4 w-4 accent-brand-accent"
                    checked={allMatching || selected.has(e.id)}
                    onChange={() => {
                      setAllMatching(false);
                      setSelected((prev) => {
                        const next = new Set(prev);
                        next.has(e.id) ? next.delete(e.id) : next.add(e.id);
                        return next;
                      });
                    }}
                  />
                </td>
                <td className="px-3 py-2 text-fg">{e.address}</td>
                <td className="px-3 py-2 whitespace-nowrap text-fg">
                  <Dot k={e.actionType} />
                  {ACTION_LABELS[e.actionType]}
                </td>
                <td className="px-3 py-2 text-fg-muted">{e.canvasser}</td>
                <td className="px-3 py-2 whitespace-nowrap text-fg-muted">{formatInTz(e.timestamp, tz)}</td>
                <td className="px-3 py-2 text-fg-muted">{e.round || '—'}</td>
              </tr>
            ))}
          </DataTable>

          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-fg-muted">
              {page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {total.toLocaleString()}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}

      {/* Past runs — desk-entry conversions listed beside plain reclassifications, because from an
          admin's point of view they are the same act at different depths. */}
      {convRuns.length > 0 && (
        <Card className="mt-6">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-fg">Survey answer changes</h2>
          <ul>
            {convRuns.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 last:border-0">
                <div className="min-w-0 text-sm text-fg">
                  <span className="font-medium">
                    {r.direction === 'to_survey'
                      ? `${(r.sources || []).map((x) => ACTION_LABELS[x] || x).join(', ') || 'Door entries'} → Surveyed`
                      : `Surveyed → ${ACTION_LABELS[r.to] || r.to}`}
                  </span>
                  <div className="mt-0.5 text-xs text-fg-muted">
                    {r.direction === 'to_survey'
                      ? `${(r.counts?.responsesCreated || 0).toLocaleString()} answers recorded`
                      : `${(r.counts?.responsesArchived || 0).toLocaleString()} answers removed`}
                    {' · '}
                    {(r.counts?.entriesConverted || 0).toLocaleString()} entries
                    {r.by ? ` · ${r.by}` : ''} · {formatInTz(r.createdAt, tz)}
                  </div>
                </div>
                {r.revertedAt ? (
                  <Badge variant="neutral">Undone</Badge>
                ) : r.status === 'open' ? (
                  <Badge variant="neutral">
                    Unfinished — {(r.progress?.doorsDone || 0).toLocaleString()} of{' '}
                    {(r.progress?.doorsTotal || 0).toLocaleString()} done
                  </Badge>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={convRevert.isPending}
                    onClick={() => { setError(null); convRevert.mutate(r.id); }}
                  >
                    Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Past runs */}
      {runs.length > 0 && (
        <Card className="mt-6">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-fg">Past changes</h2>
          <ul>
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 last:border-0">
                <div className="min-w-0 text-sm text-fg">
                  <span className="font-medium">{r.from === 'mixed' ? 'Several outcomes' : ACTION_LABELS[r.from]}</span>
                  <span className="text-fg-muted"> → </span>
                  <span className="font-medium">{ACTION_LABELS[r.to]}</span>
                  <div className="mt-0.5 text-xs text-fg-muted">
                    {r.count.toLocaleString()} {r.count === 1 ? 'entry' : 'entries'} · {r.doorCount.toLocaleString()}{' '}
                    {r.doorCount === 1 ? 'door' : 'doors'}
                    {r.by ? ` · ${r.by}` : ''} · {formatInTz(r.createdAt, tz)}
                  </div>
                </div>
                {r.revertedAt ? (
                  <Badge variant="neutral">Reverted</Badge>
                ) : (
                  <Button variant="secondary" size="sm" disabled={revert.isPending} onClick={() => { setError(null); revert.mutate(r.id); }}>
                    {revert.isPending ? 'Reverting…' : 'Revert'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Selection action bar — the one control for both a single fix and a whole-outcome fold. */}
      {/* Sticky inside the content column, not fixed to the viewport: a `left-60` offset would
          be wrong the moment the sidebar collapses to w-16. */}
      {selectionCount > 0 && (
        <div className="sticky bottom-4 z-30 mt-4 rounded-card border border-border bg-card/95 p-3 shadow-overlay backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-fg">
              {selectionCount.toLocaleString()} selected
            </span>
            {!allMatching && selected.size === entries.length && total > entries.length && (
              <button type="button" className="text-sm font-medium text-brand-accent hover:underline" onClick={() => setAllMatching(true)}>
                Select all {total.toLocaleString()} matching
              </button>
            )}
            <button type="button" className="text-sm text-fg-muted hover:underline" onClick={resetSelection}>Clear</button>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm text-fg-muted">Change to</span>
              <Select value={target} onChange={(e) => setTarget(e.target.value)} className="w-44">
                {OUTCOMES.filter((o) => !(current?.disabledOutcomes || []).includes(o)).map((o) => (
                  <option key={o} value={o}>{ACTION_LABELS[o]}</option>
                ))}
                {/* Surveyed is only offered as a TARGET when nothing surveyed is selected — you
                    cannot convert a survey into a survey, and offering it would imply you could. */}
                {isSurveyCampaign && !selectionHasSurveyed && (
                  <option value={SURVEYED}>{ACTION_LABELS[SURVEYED]}</option>
                )}
              </Select>
              {direction === 'to_survey' ? (
                <>
                  <Button
                    variant="secondary"
                    disabled={loadTemplate.isPending}
                    onClick={() => { setError(null); loadTemplate.mutate(); }}
                  >
                    {loadTemplate.isPending ? 'Loading survey…' : 'Enter answers'}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={startQueue.isPending}
                    onClick={() => { setError(null); startQueue.mutate(); }}
                  >
                    {startQueue.isPending ? 'Starting…' : 'Door by door'}
                  </Button>
                </>
              ) : direction === 'from_survey' ? (
                <Button
                  variant="danger"
                  disabled={convDryRun.isPending}
                  onClick={() => { setError(null); convDryRun.mutate(); }}
                >
                  {convDryRun.isPending ? 'Checking…' : 'Review removal'}
                </Button>
              ) : (
                <Button disabled={dryRun.isPending} onClick={() => { setError(null); dryRun.mutate(); }}>
                  {dryRun.isPending ? 'Checking…' : 'Review changes'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* A run in flight, or the result of the last one. */}
      {liveRun && !walking && (
        <ConversionRunCard
          run={liveRun}
          busy={convRevert.isPending || convResume.isPending}
          onRevert={() => { setError(null); convRevert.mutate(liveRun.id); }}
          onResume={() => { setError(null); convResume.mutate(liveRun.id); }}
          onDismiss={() => setActiveRunId(null)}
        />
      )}

      {/* Step 1 of the Surveyed direction: compose the answers, against the doors' own survey. */}
      {composing && (
        <Modal
          onClose={() => setComposing(null)}
          title="Record survey answers"
          subtitle={`These answers will be recorded for every voter at ${selectionCount.toLocaleString()} ${selectionCount === 1 ? 'door' : 'doors'}`}
          size="lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setComposing(null)}>Cancel</Button>
              <Button
                disabled={convDryRun.isPending}
                onClick={() => { setError(null); convDryRun.mutate(); }}
              >
                {convDryRun.isPending ? 'Checking…' : 'Review changes'}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-fg-muted">
            Every voter at these doors gets the same answers, except anyone marked do-not-contact
            and anyone who already answered this round. If the answers differ door to door, use
            <span className="font-medium text-fg"> Door by door</span> instead.
          </p>
          <SurveyAnswerComposer
            template={composing}
            vals={vals}
            otherTexts={otherTexts}
            onChange={setVals}
            onOtherChange={setOtherTexts}
            idPrefix="bulk"
          />
        </Modal>
      )}

      {/* Step 2 forward: priced, in the campaign's own numbers, before anything is written. */}
      {preview?.direction === 'to_survey' && (
        <SurveyConvertModal
          preview={preview}
          answeredCount={answeredCount()}
          busy={convRun.isPending}
          onCancel={() => setPreview(null)}
          onConfirm={() => convRun.mutate('bulk')}
        />
      )}

      {/* The reverse direction, with the names of everyone losing an answer. */}
      {preview?.direction === 'from_survey' && (
        <RemoveAnswersModal
          preview={preview}
          target={target}
          tz={tz}
          busy={convRun.isPending}
          onCancel={() => setPreview(null)}
          onConfirm={() => convRun.mutate('bulk')}
        />
      )}

      {/* Door-by-door desk entry. */}
      {walking && queueTemplate && (
        <QueueWalkthrough
          campaignId={campaignId}
          run={walking}
          template={queueTemplate}
          onDone={() => { setWalking(null); setQueueTemplate(null); setActiveRunId(walking.id); afterWrite(); }}
          onCancel={() => { setWalking(null); setQueueTemplate(null); setActiveRunId(walking.id); afterWrite(); }}
        />
      )}

      {/* Confirm — the impact preview is the safety mechanism, so it is never skippable. */}
      {preview && !preview.direction && (
        <Modal
          onClose={() => setPreview(null)}
          title={`Change ${preview.entries.toLocaleString()} ${preview.entries === 1 ? 'entry' : 'entries'} across ${preview.doors.toLocaleString()} ${preview.doors === 1 ? 'door' : 'doors'}`}
          subtitle={`${preview.sources.map((s) => ACTION_LABELS[s]).join(', ')} → ${ACTION_LABELS[preview.to]}`}
          size="lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setPreview(null)} disabled={run.isPending}>Cancel</Button>
              <Button variant={preview.rateNeutral ? 'primary' : 'danger'} onClick={() => run.mutate()} disabled={run.isPending}>
                {run.isPending ? 'Changing…' : preview.rateNeutral ? 'Change entries' : 'Change entries anyway'}
              </Button>
            </>
          }
        >
          {preview.rateNeutral ? (
            <p className="text-sm text-fg">
              <span className="font-medium">No reported numbers change.</span> These outcomes count
              identically — each is one knock and none counts as reaching a person — so knocks, contact
              rate, coverage and billable doors all stay exactly where they are.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-fg">
                <span className="font-medium text-danger">This changes reported numbers.</span> These are
                the figures your invoice and client reports will show afterwards:
              </p>
              <div className="rounded-card border border-border bg-sunken/40 px-3 py-1">
                <ImpactRow label="Knocks" before={preview.impact.before.knocks} after={preview.impact.after.knocks} />
                <ImpactRow label="Billable doors" before={preview.impact.before.billableDoors} after={preview.impact.after.billableDoors} />
                <ImpactRow label="Contact rate" before={preview.impact.before.contactRate} after={preview.impact.after.contactRate} suffix="%" />
                <ImpactRow label="Survey rate" before={preview.impact.before.connectionRate} after={preview.impact.after.connectionRate} suffix="%" />
                <ImpactRow label="Restricted doors" before={preview.impact.before.restrictedDoors} after={preview.impact.after.restrictedDoors} />
              </div>
            </>
          )}
          <p className="mt-3 text-xs text-fg-muted">
            Every entry keeps its time, location and canvasser — only what it says changes. This is
            recorded in the campaign&rsquo;s history, and you can revert it from this page.
          </p>
        </Modal>
      )}
    </div>
  );
}
