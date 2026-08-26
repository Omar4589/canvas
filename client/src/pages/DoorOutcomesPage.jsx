import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth, useOrgTimeZone } from '../auth/AuthContext.jsx';
import { useCampaignTeam } from '../lib/useCampaignTeam.js';
import { useRoundOptions } from '../lib/useRoundOptions.js';
import { buildScope, scopeToSearchParams } from '../lib/outcomeScope.js';
import { downloadFile } from '../lib/downloadFile.js';
import DateRangeSelector, { defaultRange, labelForRange } from '../components/DateRangeSelector.jsx';
import AnswerFilters from '../components/AnswerFilters.jsx';
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
import RunDetailModal from '../components/outcomes/RunDetailModal.jsx';

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
  // Deep-link seeds (the MapPage answer-drill idiom): the audit page's "correct their entries"
  // and the Survey Explorer's "correct in Door Outcomes" arrive with the filter prefilled —
  // read ONCE into initial state, then the page owns it. Deliberately not live URL state: on a
  // page whose primary control is "Select all N → Remove answers", a bookmark that silently
  // re-applies someone's old scope is the accident class the rest of this file engineers out;
  // every write is still previewed and priced regardless of how the filter arrived.
  const [searchParams] = useSearchParams();
  const { homePath, isOrgAdmin } = useAuth();
  const orgTz = useOrgTimeZone();
  const qc = useQueryClient();

  const [outcomes, setOutcomes] = useState([]); // [] = every convertible outcome
  const [userId, setUserId] = useState(() => searchParams.get('userId') || '');
  const [passId, setPassId] = useState(() => searchParams.get('passId') || '');
  const [effortId, setEffortId] = useState(() => searchParams.get('effortId') || '');
  // All time on purpose: this is a correction desk, reached because of a mistake that is usually
  // days or weeks old — a Today default would open it empty on the exact journey it exists for.
  // Both bounds null, so no tz-ready gate is needed to render the selector.
  const [dateRange, setDateRange] = useState(() => {
    const f = searchParams.get('dateFrom');
    const t = searchParams.get('dateTo');
    return f || t ? { preset: 'custom', from: f || null, to: t || null } : defaultRange('all');
  });
  // The survey-answer filter. Question keys and option ids are slugs unique only WITHIN one
  // template, so the filter always carries which survey it means; '' = the campaign's current
  // default. `answersOpen` is pure UI and never touches the page or the selection.
  const [surveyTemplateId, setSurveyTemplateId] = useState(() => searchParams.get('surveyTemplateId') || '');
  const [answerFilters, setAnswerFilters] = useState(() => {
    const questionKey = searchParams.get('questionKey');
    if (!questionKey) return [];
    const optionId = searchParams.get('optionId');
    const option = searchParams.get('option');
    if (optionId) return [{ questionKey, values: [optionId], texts: [] }];
    // Orphan/legacy bucket: no stable id, so the text rides BOTH lanes — the AnswerFilters
    // convention for options whose id is null.
    if (option) return [{ questionKey, values: [option], texts: [option] }];
    return [];
  });
  const [answerTagFilters, setAnswerTagFilters] = useState([]);
  const [answersOpen, setAnswersOpen] = useState(() => !!searchParams.get('questionKey'));
  // The address search applies on Enter/blur, not per keystroke — every applied filter re-scopes
  // the WRITE, and half-typed scopes should never exist. `searchDraft` is the input box.
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('search') || '');
  const [sort, setSort] = useState('newest');
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(() => new Set());
  const [allMatching, setAllMatching] = useState(false); // "select all N" — filter-scoped, not ids
  const [target, setTarget] = useState('not_home');
  const [preview, setPreview] = useState(null);
  const [unknockPreview, setUnknockPreview] = useState(null);
  const [error, setError] = useState(null);
  // Surveyed direction state. `composing` holds the resolved template while the admin picks
  // answers; `activeRun` is the run being watched (bulk) or walked (queue).
  const [composing, setComposing] = useState(null);
  const [vals, setVals] = useState({});
  const [otherTexts, setOtherTexts] = useState({});
  const [activeRunId, setActiveRunId] = useState(null);
  const [walking, setWalking] = useState(null);
  const [queueTemplate, setQueueTemplate] = useState(null);
  const [detailRun, setDetailRun] = useState(null); // the run whose itemized history is open

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const current = (campaignsQ.data?.campaigns || []).find((c) => String(c._id) === String(campaignId));
  const tz = current?.timeZone || orgTz;
  // allMembers, not members: the picker half of that hook drops deactivated people because the
  // server refuses to ASSIGN them — but this page is a report over recorded history, and the
  // flagship query here is about the canvasser who was just fired. Their rows are in the table
  // with their name on them; the filter must be able to name them too.
  const { allMembers } = useCampaignTeam(campaignId);

  // Rounds + walk lists from the shared hook, so a round is named "walk list · Pass N" — a bare
  // "Round 2" names a different round in every walk list, which stops being tolerable the moment
  // a walk-list filter sits beside it. The 'legacy' sentinel row is excluded: it is not an
  // ObjectId, and this page's scope schema refuses non-id values rather than ignoring them.
  const { roundOptions, effortsQ } = useRoundOptions(campaignId);
  const efforts = effortsQ.data?.efforts || [];
  const roundChoices = useMemo(
    () => roundOptions.filter((r) => r.id !== 'legacy' && (!effortId || r.effortId === effortId)),
    [roundOptions, effortId]
  );

  const resetSelection = () => {
    setSelected(new Set());
    setAllMatching(false);
  };
  // Every filter change invalidates both the page cursor and the selection — forgetting the
  // second is the dangerous one, since `allMatching` means "write whatever the filter matches".
  // One wrapper so a new filter can't be added without both.
  const applyFilter = (apply) => {
    apply();
    setPage(0);
    resetSelection();
    setError(null);
  };
  // Rounds belong to walk lists: narrowing to one walk list clears a round that isn't in it,
  // or the page would show two sane-looking filters over a permanently empty table.
  const selectEffort = (id) => {
    setEffortId(id);
    if (passId && id && !roundOptions.some((r) => r.id === passId && r.effortId === id)) setPassId('');
  };
  const clearAnswers = () => {
    setAnswerFilters([]);
    setAnswerTagFilters([]);
  };
  // Question keys don't survive a template change — carrying picks across would silently match
  // another survey's same-named option.
  const selectTemplate = (id) => {
    setSurveyTemplateId(id);
    clearAnswers();
  };


  // The answer filter's three derived states. `narrowed` is the gate (mirrors the server's
  // hasOtherNarrowing — the outcome chips deliberately don't count); `answerActive` means the
  // picks are actually FILTERING, as opposed to sitting paused because the gate closed under
  // them; `effectiveOutcomes` derives — never mutates — the locked Surveyed chip, so clearing
  // the answer filter restores the admin's own chips with no save/restore dance.
  const answerCount = answerFilters.length + answerTagFilters.length;
  const narrowed = !!(userId || passId || effortId || dateRange.from || dateRange.to || search);
  const answerActive = narrowed && answerCount > 0;
  const effectiveOutcomes = answerActive ? [SURVEYED] : outcomes;

  // The filter as the server reads it — ONE object (lib/outcomeScope.js), so the query key, the
  // dry run and the write can never describe different scopes. The query string is DERIVED from
  // it below, never rebuilt from page state beside it: under "Select all N matching" the server
  // re-resolves the selection from this scope alone, so a filter present in the table's request
  // but missing from the write's body would rewrite rows the admin never saw. Paused answer
  // picks (gate closed) are withheld here — the server would refuse them, correctly.
  const scope = useMemo(
    () =>
      buildScope({
        outcomes: effectiveOutcomes,
        userId,
        passId,
        effortId,
        dateRange,
        search,
        surveyTemplateId,
        answerFilters: answerActive ? answerFilters : [],
        answerTagFilters: answerActive ? answerTagFilters : [],
      }),
    [effectiveOutcomes, userId, passId, effortId, dateRange, search, surveyTemplateId, answerFilters, answerTagFilters, answerActive]
  );

  const qs = useMemo(() => {
    const sp = scopeToSearchParams(scope);
    sp.set('skip', String(page * PAGE));
    sp.set('limit', String(PAGE));
    if (sort !== 'newest') sp.set('sort', sort);
    return sp.toString();
  }, [scope, page, sort]);

  // One dismissible token per applied narrowing. With seven filters, a collapsed disclosure and
  // deep links that can seed state the selects can't always display (a de-rostered canvasser has
  // no roster row to name), an invisible filter is a correctness hazard on a page whose primary
  // control is "Select all N → Remove answers" — the scope must be READABLE in one place.
  const filterTokens = useMemo(() => {
    const out = [];
    if (!answerActive && outcomes.length) {
      out.push({ key: 'outcomes', label: `${outcomes.length} ${outcomes.length === 1 ? 'outcome' : 'outcomes'}`, clear: () => setOutcomes([]) });
    }
    if (userId) {
      const m = allMembers.find((x) => String(x.user.id) === String(userId));
      const name = m ? [m.user.firstName, m.user.lastName].filter(Boolean).join(' ') || m.user.email : 'One canvasser';
      out.push({ key: 'user', label: name, clear: () => setUserId('') });
    }
    if (effortId) {
      out.push({ key: 'effort', label: efforts.find((ef) => String(ef._id) === String(effortId))?.name || 'One walk list', clear: () => setEffortId('') });
    }
    if (passId) {
      out.push({ key: 'pass', label: roundOptions.find((r) => r.id === passId)?.label || 'One round', clear: () => setPassId('') });
    }
    if (dateRange.from || dateRange.to) {
      out.push({ key: 'date', label: labelForRange(dateRange), clear: () => setDateRange(defaultRange('all')) });
    }
    if (search) {
      out.push({ key: 'search', label: `“${search}”`, clear: () => { setSearch(''); setSearchDraft(''); } });
    }
    if (answerCount) {
      out.push({
        key: 'answers',
        label: answerActive ? `${answerCount} answer ${answerCount === 1 ? 'filter' : 'filters'}` : 'Answer filter paused',
        paused: !answerActive,
        clear: clearAnswers,
      });
    }
    return out;
  }, [outcomes, userId, effortId, passId, dateRange, answerCount, answerActive, allMembers, efforts, roundOptions]);

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

  // The answer picker's two feeds. Templates come from /admin/reports/surveys — every survey
  // that has responses for this campaign plus the current one, so a campaign that SWAPPED
  // surveys can still reach the old one's answers. Questions come from /survey-results for the
  // chosen template (merged options, retired + legacy buckets, the __other__ write-in seeded),
  // fetched lazily — a page that never opens the disclosure never pays for it. Deliberately NOT
  // narrowed by the page's own filters: options must never depend on the filters they set, or
  // narrowing to one canvasser would delete the chips that narrowed it.
  const surveysQ = useQuery({
    queryKey: ['reports', 'surveys', campaignId],
    queryFn: () => api(`/admin/reports/surveys?campaignId=${campaignId}`),
    enabled: !!campaignId && isOrgAdmin && current?.type === 'survey',
  });
  const surveyList = surveysQ.data || [];
  const surveyResQ = useQuery({
    queryKey: ['reports', 'survey-results', campaignId, surveyTemplateId],
    queryFn: () =>
      api(`/admin/reports/survey-results?campaignId=${campaignId}${surveyTemplateId ? `&surveyTemplateId=${surveyTemplateId}` : ''}`),
    enabled: !!campaignId && isOrgAdmin && current?.type === 'survey' && answersOpen,
  });
  const choiceQuestions = (surveyResQ.data?.questions || []).filter(
    (q) => q.type === 'single_choice' || q.type === 'multiple_choice'
  );
  const surveyTags = (surveyResQ.data?.tags || []).map((t) => t.tag).filter(Boolean);

  // One mounted element serves every /campaigns/:id/outcomes — the sidebar switcher re-renders
  // it with a new id, so every campaign-scoped id below belongs to the campaign we're leaving.
  // Render-phase reset (the AuditPage/DuplicateSurveysPage idiom) so no query fires with a stale
  // pair. The date range deliberately survives the flip: it is campaign-agnostic, and both
  // sibling pages keep theirs "so an audit survives a campaign flip".
  const [prevCampaignId, setPrevCampaignId] = useState(campaignId);
  if (prevCampaignId !== campaignId) {
    setPrevCampaignId(campaignId);
    setOutcomes([]);
    setUserId('');
    setEffortId('');
    setPassId('');
    setSurveyTemplateId('');
    setAnswerFilters([]);
    setAnswerTagFilters([]);
    setAnswersOpen(false);
    setSearch('');
    setSearchDraft('');
    setPage(0);
    resetSelection();
    setPreview(null);
    setUnknockPreview(null);
    setComposing(null);
    setError(null);
  }
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
  // is then whatever currently matches, not a page's worth of stale checkboxes. selectionBody is
  // the ONE spelling of that rule; body/convBody/loadTemplate all spread it, so the three POSTs
  // can never describe different selections.
  const selectionBody = () => ({
    scope,
    ...(allMatching ? {} : { actionIds: [...selected] }),
  });
  const body = (extra = {}) => ({
    to: target,
    ...selectionBody(),
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
    ...selectionBody(),
    ...extra,
  });

  // Step 1 of the Surveyed direction: resolve the ONE template these doors use. A selection
  // spanning two surveys is refused here rather than written under whichever came first.
  const loadTemplate = useMutation({
    mutationFn: () =>
      api(`/admin/campaigns/${campaignId}/survey-conversions/template`, {
        method: 'POST',
        body: selectionBody(),
      }),
    onSuccess: (d) => {
      // Carry the resolved DOOR count with the template: the modal's subtitle says "doors", and
      // selectionCount is an ENTRY count — 12 entries can be 9 doors (two rounds at one address),
      // and the dry-run modal that follows uses the server's real doors, so the two disagreed.
      setComposing({ ...d.template, doorCount: d.doors });
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

  // ONE call: the creating POST resolves the template itself (refusing a mixed-template selection)
  // and returns the session ready to walk — doorsRemaining and the survey together. A separate
  // /template call here would also be subtly wrong: it resolves from the SELECTION, while the run
  // freezes its own, and the two must never diverge mid-session.
  const startQueue = useMutation({
    mutationFn: () =>
      api(`/admin/campaigns/${campaignId}/survey-conversions`, {
        method: 'POST',
        body: convBody({ mode: 'queue' }),
      }),
    onSuccess: (d) => {
      setQueueTemplate(d.run.template || null);
      setWalking(d.run);
      resetSelection();
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns', campaignId, 'survey-conversions'] });
    },
    onError: (e) => setError(e.message),
  });

  const closeQueue = useMutation({
    mutationFn: (runId) => api(`/admin/campaigns/${campaignId}/survey-conversions/${runId}/close`, { method: 'POST' }),
    onSuccess: (d) => {
      setActiveRunId(d.run.id);
      afterWrite();
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns', campaignId, 'survey-conversions'] });
    },
    onError: (e) => setError(e.message),
  });

  // Re-enter an unfinished door-by-door session. The GET carries both halves — the remaining doors
  // (derived from what's already saved, so it is right no matter how the session ended) and the
  // survey the run froze at creation.
  const resumeQueue = useMutation({
    mutationFn: (runId) => api(`/admin/campaigns/${campaignId}/survey-conversions/${runId}`),
    onSuccess: ({ run }) => {
      if (!run.doorsRemaining?.length) {
        // Nothing left — it was finished but never closed. Close it rather than opening an empty
        // walkthrough the admin would have to dismiss.
        return closeQueue.mutate(run.id);
      }
      setQueueTemplate(run.template || null);
      setWalking(run);
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

  // UNKNOCK — the fourth act, and the only one that REMOVES entries. No target outcome, its own
  // preview state (the reclassify `preview` renders a different modal family).
  const unknockRunsQ = useQuery({
    queryKey: ['admin', 'campaigns', campaignId, 'unknock'],
    queryFn: () => api(`/admin/campaigns/${campaignId}/unknock-entries`),
    enabled: !!campaignId && isOrgAdmin,
  });
  const unknockRuns = unknockRunsQ.data?.runs || [];
  const afterUnknock = () => {
    setUnknockPreview(null);
    afterWrite();
    qc.invalidateQueries({ queryKey: ['admin', 'campaigns', campaignId, 'unknock'] });
  };
  const unknockDryRun = useMutation({
    mutationFn: () =>
      api(`/admin/campaigns/${campaignId}/unknock-entries`, { method: 'POST', body: { ...selectionBody(), dryRun: true } }),
    onSuccess: setUnknockPreview,
    onError: (e) => setError(e.message),
  });
  const unknockRun = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/unknock-entries`, { method: 'POST', body: selectionBody() }),
    onSuccess: afterUnknock,
    onError: (e) => { setError(e.message); setUnknockPreview(null); },
  });
  const unknockRevert = useMutation({
    mutationFn: (runId) => api(`/admin/campaigns/${campaignId}/unknock-entries/revert`, { method: 'POST', body: { runId } }),
    onSuccess: afterUnknock,
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
  // Under a truncated answer scope `total` is a LOWER bound — the wire says so, the count
  // renders "N+", and "Select all N matching" is withdrawn outright: its entire meaning is
  // that N is the truth.
  const totalIsLowerBound = !!entriesQ.data?.totalIsLowerBound;
  const anyFilter =
    outcomes.length > 0 || !!userId || !!passId || !!effortId || !!dateRange.from || !!dateRange.to || answerCount > 0;
  const selectedRows = entries.filter((e) => allMatching || selected.has(e.id));
  // Direction is read off the SELECTION and the target, never asked for: picking Surveyed as
  // the target means "record answers", and having surveyed rows selected means "remove them".
  // Under "select all N" the matching set's make-up comes from the server's `sources` — the
  // old guess (`outcomes.length === 1 && outcomes[0] === SURVEYED`) broke the moment a filter
  // could imply Surveyed without the chip being ticked, and was already wrong for a select-all
  // whose chips were simply left blank over an all-surveyed table.
  const selectionSources = allMatching
    ? entriesQ.data?.sources || []
    : [...new Set(selectedRows.map((e) => e.actionType))];
  const selectionHasSurveyed = selectionSources.includes(SURVEYED);
  // A selection straddling the surveyed boundary has no honest single action — the server
  // refuses it (SELECTION_SPANS_DIRECTIONS), so the bar explains instead of offering buttons.
  const selectionSpans = selectionHasSurveyed && selectionSources.some((k) => k !== SURVEYED);
  const direction = selectionHasSurveyed ? 'from_survey' : target === SURVEYED ? 'to_survey' : null;
  const isSurveyConversion = direction !== null;
  const toggleOutcome = (k) =>
    applyFilter(() => setOutcomes((prev) => (prev.includes(k) ? prev.filter((o) => o !== k) : [...prev, k])));

  return (
    <div className="pb-24">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-fg">{current?.name || 'Campaign'}</h1>
          <div className="mt-1 text-sm text-fg-muted">
            Door Outcomes — review and correct what canvassers recorded at each door
          </div>
        </div>
        {/* In the header, not the filter Card — it is the tallest control in the set, and every
            other dated page puts it here. Held until the campaigns list lands so a click on
            "Today" inside the first frame can't resolve the org's today instead of the
            campaign's; the All-time default itself needs no tz at all. */}
        {!campaignsQ.isLoading && (
          <DateRangeSelector value={dateRange} onChange={(next) => applyFilter(() => setDateRange(next))} tz={tz} />
        )}
      </div>

      {/* Filters */}
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {SOURCES.map((k) => {
            const on = effectiveOutcomes.includes(k);
            const locked = answerActive && k !== SURVEYED;
            const n = facets[k];
            return (
              <button
                key={k}
                type="button"
                disabled={answerActive}
                aria-pressed={on}
                title={
                  answerActive
                    ? locked
                      ? 'Clear the answer filter to include other outcomes.'
                      : 'An answer filter only ever matches surveyed entries.'
                    : undefined
                }
                onClick={() => toggleOutcome(k)}
                className={[
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  on ? 'border-brand-accent bg-brand-tint text-brand-tint-fg' : 'border-border bg-card text-fg-muted hover:bg-sunken',
                  answerActive ? 'cursor-default' : '',
                  locked ? 'opacity-50' : '',
                ].join(' ')}
              >
                <Dot k={k} />
                {ACTION_LABELS[k]}
                {/* An em dash, never a blank, on a locked chip: a chip with no number reads as
                    "this campaign has none of these", which under the lock is a lie — and the
                    facets can't say otherwise, since a zero-count outcome is simply absent from
                    the $group. */}
                {locked ? (
                  <span className="ml-1 text-fg-subtle">—</span>
                ) : n ? (
                  <span className="ml-1 text-fg-subtle">{n}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        {answerActive && (
          <div className="mt-1.5 text-xs text-fg-muted">
            Only surveyed entries carry answers, so the other outcomes are off while an answer filter is on.
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Applies on Enter/blur, never per keystroke — an applied filter re-scopes the WRITE,
              and half-typed scopes should not exist. */}
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFilter(() => setSearch(searchDraft.trim()));
            }}
            onBlur={() => {
              if (searchDraft.trim() !== search) applyFilter(() => setSearch(searchDraft.trim()));
            }}
            placeholder="Search address, city or ZIP"
            className="w-56 rounded-lg border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
          <Select value={userId} onChange={(e) => applyFilter(() => setUserId(e.target.value))} className="w-52">
            <option value="">All canvassers</option>
            {allMembers.map((m) => (
              <option key={m.user.id} value={m.user.id}>
                {[m.user.firstName, m.user.lastName].filter(Boolean).join(' ') || m.user.email}
                {m.user.isActive === false ? ' (deactivated)' : ''}
              </option>
            ))}
          </Select>
          {efforts.length > 1 && (
            <Select
              value={effortId}
              onChange={(e) => applyFilter(() => selectEffort(e.target.value))}
              className="w-52"
              title="Filter to one walk list"
            >
              <option value="">All walk lists</option>
              {efforts.map((ef) => (
                <option key={ef._id} value={ef._id}>{ef.name}</option>
              ))}
            </Select>
          )}
          <Select value={passId} onChange={(e) => applyFilter(() => setPassId(e.target.value))} className="w-52">
            <option value="">All rounds</option>
            {roundChoices.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </Select>
          {isSurveyCampaign && (
            <Button variant="secondary" size="sm" aria-expanded={answersOpen} onClick={() => setAnswersOpen((o) => !o)}>
              <span className="mr-1">{answersOpen ? '▾' : '▸'}</span>
              Survey answers
              {answerCount > 0 ? <span className="ml-1.5 text-brand-accent">{answerCount}</span> : null}
            </Button>
          )}
          {anyFilter ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                applyFilter(() => {
                  setOutcomes([]);
                  setUserId('');
                  setEffortId('');
                  setPassId('');
                  setDateRange(defaultRange('all'));
                  setSurveyTemplateId('');
                  clearAnswers();
                })
              }
            >
              Clear filters
            </Button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <Select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }} className="w-32" title="Sort order">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </Select>
            <Button
              variant="secondary"
              size="sm"
              disabled={exporting || !total}
              title="Download the filtered entries as a CSV — the file carries exactly what the table shows, survey evidence included"
              onClick={async () => {
                setExporting(true);
                try {
                  await downloadFile(`/admin/campaigns/${campaignId}/outcome-entries.csv?${scopeToSearchParams(scope)}`, {
                    fallbackName: 'door-outcomes.csv',
                  });
                } catch (e) {
                  setError(e.message);
                } finally {
                  setExporting(false);
                }
              }}
            >
              {exporting ? 'Exporting…' : 'Export CSV'}
            </Button>
            <span className="text-xs text-fg-muted">
              {/* isFetching, not isLoading: keepPreviousData makes isLoading fire only on first
                  mount, so a slow refetch under a new filter would read as a finished count. */}
              {entriesQ.isFetching
                ? 'Loading…'
                : `${total.toLocaleString()}${totalIsLowerBound ? '+' : ''} ${total === 1 ? 'entry' : 'entries'} · ${(entriesQ.data?.doors || 0).toLocaleString()}${totalIsLowerBound ? '+' : ''} ${(entriesQ.data?.doors || 0) === 1 ? 'door' : 'doors'}`}
            </span>
          </div>
        </div>

        {/* The answer filter — collapsed by default; the tall block lives on a sunken
            sub-surface so the card keeps reading as one control strip. */}
        {answersOpen && isSurveyCampaign && (
          <div className="mt-3 rounded-card border border-border bg-sunken/40 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-fg-muted">Filter answers from</span>
              {surveyList.length > 1 ? (
                <Select
                  value={surveyTemplateId}
                  onChange={(e) => applyFilter(() => selectTemplate(e.target.value))}
                  className="w-56"
                  title="Which survey's answers to filter by — answers recorded under other surveys stay out"
                >
                  <option value="">
                    {surveyList.find((t) => t.current)
                      ? `${surveyList.find((t) => t.current).name} (current)`
                      : 'Current survey'}
                  </option>
                  {surveyList
                    .filter((t) => !t.current)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.responseCount}
                      </option>
                    ))}
                </Select>
              ) : (
                <span className="text-xs text-fg">{surveyList[0]?.name || 'this campaign’s survey'}</span>
              )}
              {answerCount > 0 && (
                <button type="button" className="text-xs text-fg-muted hover:underline" onClick={() => applyFilter(clearAnswers)}>
                  Clear answers
                </button>
              )}
            </div>

            {/* The gate, as an affordance (the server refusal is the backstop). Three states:
                closed (no picks yet), paused (picks kept but not filtering — the state that
                would otherwise be a silent lie), open. */}
            {!narrowed && answerCount === 0 && (
              <div className="mb-2 rounded-card border border-border bg-card px-2.5 py-1.5 text-xs text-fg-muted">
                Pick a canvasser, walk list, round, date range or address search first — an answer
                filter on its own would read every survey in the campaign.
              </div>
            )}
            {!narrowed && answerCount > 0 && (
              <div className="mb-2 rounded-card border border-danger/30 bg-danger-tint px-2.5 py-1.5 text-xs text-danger">
                These answer chips aren’t filtering anything right now. Pick a canvasser, walk list,
                round, date range or address search above to switch them back on — your picks are kept.
              </div>
            )}
            {answerActive && totalIsLowerBound && (
              <div className="mb-2 rounded-card border border-danger/30 bg-danger-tint px-2.5 py-1.5 text-xs text-danger">
                More answers matched than can be scanned at once — this is the most recent{' '}
                {(entriesQ.data?.answerScope?.cap || 0).toLocaleString()}. Narrow the date range, round
                or canvasser to see the rest. “Select all matching” is off until you do.
              </div>
            )}

            {surveyResQ.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : choiceQuestions.length === 0 && surveyTags.length === 0 ? (
              <div className="text-xs text-fg-muted">This survey has no choice questions to filter by.</div>
            ) : (
              <div className={narrowed ? '' : 'pointer-events-none opacity-50'} aria-disabled={!narrowed}>
                <AnswerFilters
                  questions={choiceQuestions}
                  value={answerFilters}
                  onChange={(v) => applyFilter(() => setAnswerFilters(v))}
                  tags={surveyTags}
                  tagValue={answerTagFilters}
                  onTagChange={(v) => applyFilter(() => setAnswerTagFilters(v))}
                />
              </div>
            )}
          </div>
        )}

        {/* What is actually applied, readable whether or not the disclosure is open. */}
        {filterTokens.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {filterTokens.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => applyFilter(t.clear)}
                title={`Remove: ${t.label}`}
                className={[
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
                  t.paused
                    ? 'border-danger/40 bg-danger-tint text-danger hover:bg-danger-tint/70'
                    : 'border-brand-accent/40 bg-brand-tint text-brand-tint-fg hover:bg-brand-tint/70',
                ].join(' ')}
              >
                {t.label}
                <span aria-hidden>×</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {error && (
        <div className="mb-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{error}</div>
      )}

      {/* Entries */}
      {entriesQ.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : entriesQ.isError ? (
        // A failed fetch must never read as "no entries match" — the admin would widen the
        // filter and select-all against whatever the retry returns.
        <EmptyState
          title="Couldn't load the entries"
          hint={`${entriesQ.error?.message || 'The request failed.'} Nothing here is filtered — retry before acting on this page.`}
        />
      ) : !entries.length ? (
        anyFilter ? (
          <EmptyState
            title="No entries match these filters"
            hint="Clear a filter to widen the view. Entries an earlier change already converted stay hidden until that change is undone."
          />
        ) : (
          <EmptyState
            title="Nothing recorded yet"
            hint="Nothing recorded here yet. Lit-drop entries never appear — a lit drop has no answers to move either way."
          />
        )
      ) : (
        <>
          <DataTable
            className={entriesQ.isFetching ? 'opacity-60 transition-opacity' : ''}
            head={
              <>
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    className="h-4 w-4 accent-brand-accent"
                    checked={allMatching || (entries.every((e) => selected.has(e.id)) && !!entries.length)}
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
                {isSurveyCampaign && <th className="px-3 py-2">Answers</th>}
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
                {/* The row's survey evidence: a filter whose result the admin can't see would be
                    unverifiable on a page that rewrites history — and the Surveyed direction
                    archives EVERY answer at the visit, so "who else goes" must be said here. */}
                {isSurveyCampaign && (
                  <td className="px-3 py-2 align-top">
                    {e.actionType !== SURVEYED || !e.survey ? (
                      <span className="text-fg-subtle">—</span>
                    ) : (
                      <div className="max-w-[24rem]">
                        {answerActive && e.survey.matched?.length ? (
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-xs font-medium text-fg">{e.survey.matched[0].voterName}</span>
                            {e.survey.matched[0].answers.map((a) => (
                              <Badge key={a.questionKey} variant="brand">{a.text}</Badge>
                            ))}
                            {e.survey.matchedVoters > 1 && (
                              <span className="text-xs text-fg-muted">+{e.survey.matchedVoters - 1} more matched</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-fg-muted" title={(e.survey.otherNames || []).join(', ')}>
                            {e.survey.voters.toLocaleString()} {e.survey.voters === 1 ? 'voter' : 'voters'} ·{' '}
                            {e.survey.answers.toLocaleString()} {e.survey.answers === 1 ? 'answer' : 'answers'}
                          </span>
                        )}
                        {answerActive && e.survey.voters > (e.survey.matchedVoters || 0) && (
                          <div
                            className={`mt-0.5 text-xs ${selected.has(e.id) || allMatching ? 'text-danger' : 'text-fg-muted'}`}
                            title={(e.survey.otherNames || []).join(', ')}
                          >
                            {e.survey.voters - e.survey.matchedVoters} other
                            {e.survey.voters - e.survey.matchedVoters === 1 ? '' : 's'} at this visit — their answers go too
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                )}
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
                  {r.scopeSummary && (
                    <div className="mt-0.5 text-xs text-fg-subtle">
                      Filtered to: {r.scopeSummary}
                      {r.byIds ? ' · hand-picked rows' : ''}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setDetailRun({
                      type: 'conversion',
                      id: r.id,
                      direction: r.direction,
                      title:
                        r.direction === 'to_survey'
                          ? `${(r.sources || []).map((x) => ACTION_LABELS[x] || x).join(', ') || 'Door entries'} → Surveyed`
                          : `Surveyed → ${ACTION_LABELS[r.to] || r.to}`,
                      by: r.by,
                      createdAt: r.createdAt,
                      samples: r.samples,
                      samplesTotal: r.samplesTotal,
                      samplesTruncated: r.samplesTruncated,
                    })
                  }
                >
                  Details
                </Button>
                {r.revertedAt ? (
                  <Badge variant="neutral">Undone</Badge>
                ) : r.status === 'open' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="neutral">
                      Unfinished — {(r.progress?.doorsDone || 0).toLocaleString()} of{' '}
                      {(r.progress?.doorsTotal || 0).toLocaleString()} done
                    </Badge>
                    <Button
                      size="sm"
                      disabled={resumeQueue.isPending}
                      onClick={() => { setError(null); resumeQueue.mutate(r.id); }}
                    >
                      {resumeQueue.isPending ? 'Opening…' : 'Resume'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={closeQueue.isPending}
                      onClick={() => { setError(null); closeQueue.mutate(r.id); }}
                    >
                      Stop here
                    </Button>
                  </div>
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
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Unknock runs — the removals, listed beside the relabels because from an admin's point
          of view they are the same act at different depths. */}
      {unknockRuns.length > 0 && (
        <Card className="mt-6">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-fg">Removed entries</h2>
          <ul>
            {unknockRuns.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 last:border-0">
                <div className="min-w-0 text-sm text-fg">
                  <span className="font-medium">
                    {(r.counts?.entriesRemoved || 0).toLocaleString()}{' '}
                    {(r.counts?.entriesRemoved || 0) === 1 ? 'entry' : 'entries'} unknocked
                  </span>
                  <div className="mt-0.5 text-xs text-fg-muted">
                    {(r.counts?.doorsAffected || 0).toLocaleString()} {(r.counts?.doorsAffected || 0) === 1 ? 'door' : 'doors'}
                    {(r.counts?.responsesArchived || 0) > 0
                      ? ` · ${(r.counts.responsesArchived || 0).toLocaleString()} answers archived`
                      : ''}
                    {r.by ? ` · ${r.by}` : ''} · {formatInTz(r.createdAt, tz)}
                    {r.status === 'reverted' && (r.counts?.rowsNotRestored || 0) > 0
                      ? ` · ${r.counts.rowsNotRestored.toLocaleString()} not restored (re-knocked since)`
                      : ''}
                  </div>
                  {r.scopeSummary && (
                    <div className="mt-0.5 text-xs text-fg-subtle">
                      Filtered to: {r.scopeSummary}
                      {r.byIds ? ' · hand-picked rows' : ''}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {r.status === 'reverted' ? (
                    <Badge variant="neutral">Undone</Badge>
                  ) : r.status === 'pending' ? (
                    <Badge variant="neutral">Did not finish — nothing was removed</Badge>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={unknockRevert.isPending}
                      onClick={() => { setError(null); unknockRevert.mutate(r.id); }}
                    >
                      {unknockRevert.isPending ? 'Undoing…' : 'Undo'}
                    </Button>
                  )}
                </div>
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
                  {r.scopeSummary && (
                    <div className="mt-0.5 text-xs text-fg-subtle">
                      Filtered to: {r.scopeSummary}
                      {r.byIds ? ' · hand-picked rows' : ''}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setDetailRun({
                        type: 'reclassify',
                        id: r.id,
                        title: `${r.from === 'mixed' ? 'Several outcomes' : ACTION_LABELS[r.from]} → ${ACTION_LABELS[r.to]}`,
                        by: r.by,
                        createdAt: r.createdAt,
                      })
                    }
                  >
                    Details
                  </Button>
                  {r.revertedAt ? (
                    <Badge variant="neutral">Reverted</Badge>
                  ) : (
                    <Button variant="secondary" size="sm" disabled={revert.isPending} onClick={() => { setError(null); revert.mutate(r.id); }}>
                      {revert.isPending ? 'Reverting…' : 'Revert'}
                    </Button>
                  )}
                </div>
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
            {/* Keyed on THIS page's rows being ticked — `selected.size === entries.length`
                misfired whenever a cross-page selection happened to equal the page length —
                and offered whenever more rows match than are ticked. */}
            {!allMatching && !totalIsLowerBound && entries.length > 0 && entries.every((e) => selected.has(e.id)) && total > selected.size && (
              <button type="button" className="text-sm font-medium text-brand-accent hover:underline" onClick={() => setAllMatching(true)}>
                Select all {total.toLocaleString()} matching
              </button>
            )}
            <button type="button" className="text-sm text-fg-muted hover:underline" onClick={resetSelection}>Clear</button>
            {selectionSpans ? (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-sm text-fg-muted">
                  This selection mixes surveyed entries with door outcomes — relabeling works one
                  side at a time. Unknock can remove them together.
                </span>
                <Button
                  variant="danger"
                  disabled={unknockDryRun.isPending}
                  title="Remove these entries from the record entirely — the doors read unknocked again and the knocks leave every total"
                  onClick={() => { setError(null); unknockDryRun.mutate(); }}
                >
                  {unknockDryRun.isPending ? 'Checking…' : 'Unknock…'}
                </Button>
              </div>
            ) : (
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
              {/* Visually fenced off from the relabel controls: this one REMOVES the entries.
                  It has no target outcome — that is the point. */}
              <span className="mx-1 h-5 w-px bg-border" aria-hidden />
              <Button
                variant="danger"
                disabled={unknockDryRun.isPending}
                title="Remove these entries from the record entirely — the doors read unknocked again and the knocks leave every total"
                onClick={() => { setError(null); unknockDryRun.mutate(); }}
              >
                {unknockDryRun.isPending ? 'Checking…' : 'Unknock…'}
              </Button>
            </div>
            )}
          </div>
        </div>
      )}

      {detailRun && (
        <RunDetailModal campaignId={campaignId} run={detailRun} tz={tz} onClose={() => setDetailRun(null)} />
      )}

      {/* The unknock confirm — priced like every other change, but the copy has to carry more,
          because this one deletes: which totals move, whose answers are archived, what an issued
          invoice will say, and which doors will still show older entries afterwards. */}
      {unknockPreview && (
        <Modal
          onClose={() => setUnknockPreview(null)}
          title={`Unknock ${unknockPreview.entries.toLocaleString()} ${unknockPreview.entries === 1 ? 'entry' : 'entries'} across ${unknockPreview.doors.toLocaleString()} ${unknockPreview.doors === 1 ? 'door' : 'doors'}`}
          subtitle="Removes them from the record — the doors read unknocked again"
          size="lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setUnknockPreview(null)} disabled={unknockRun.isPending}>Cancel</Button>
              <Button variant="danger" onClick={() => unknockRun.mutate()} disabled={unknockRun.isPending}>
                {unknockRun.isPending ? 'Removing…' : 'Unknock entries'}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-fg">
            <span className="font-medium text-danger">These entries leave every total.</span> The
            doors go back to unknocked in their round, and a fresh knock there counts — and bills —
            as the first one. This is for entries that should never have existed; to keep the knock
            and only change what it says, use the outcome controls instead.
          </p>
          <div className="mb-3 rounded-card border border-border bg-sunken/40 px-3 py-1">
            <ImpactRow label="Knocks" before={unknockPreview.impact.before.knocks} after={unknockPreview.impact.after.knocks} />
            <ImpactRow label="Billable doors" before={unknockPreview.impact.before.billableDoors} after={unknockPreview.impact.after.billableDoors} />
            <ImpactRow label="Contact rate" before={unknockPreview.impact.before.contactRate} after={unknockPreview.impact.after.contactRate} suffix="%" />
            <ImpactRow label="Survey rate" before={unknockPreview.impact.before.connectionRate} after={unknockPreview.impact.after.connectionRate} suffix="%" />
            <ImpactRow label="Restricted doors" before={unknockPreview.impact.before.restrictedDoors} after={unknockPreview.impact.after.restrictedDoors} />
          </div>

          {unknockPreview.survey.responsesToArchive > 0 && (
            <div className="mb-3 rounded-card border border-border">
              <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                {unknockPreview.survey.responsesToArchive.toLocaleString()}{' '}
                {unknockPreview.survey.responsesToArchive === 1 ? 'answer' : 'answers'} archived — kept
                on each voter's record, restorable
              </div>
              <ul className="max-h-40 overflow-y-auto">
                {unknockPreview.survey.manifest.map((m) => (
                  <li key={m.voterId} className="flex items-baseline justify-between gap-3 border-b border-border px-3 py-1.5 text-sm last:border-0">
                    <span className="text-fg">{m.voterName}</span>
                    <span className="text-xs text-fg-muted">
                      {m.answerCount} {m.answerCount === 1 ? 'answer' : 'answers'} · {formatInTz(m.submittedAt, tz)}
                    </span>
                  </li>
                ))}
              </ul>
              {unknockPreview.survey.manifestTruncated && (
                <div className="px-3 py-2 text-xs text-fg-muted">
                  Showing {unknockPreview.survey.manifest.length} of {unknockPreview.survey.manifestTotal.toLocaleString()}.
                </div>
              )}
            </div>
          )}

          {unknockPreview.doorsStillRecorded > 0 && (
            <p className="mb-2 text-xs text-fg-muted">
              {unknockPreview.doorsStillRecorded.toLocaleString()} of these doors keep other entries
              (an older outcome, another canvasser's visit, or an office restricted mark) and will
              show that instead of unknocked.
            </p>
          )}
          {unknockPreview.heldByRuns > 0 && (
            <p className="mb-2 text-xs text-fg-muted">
              {unknockPreview.heldByRuns.toLocaleString()} matching{' '}
              {unknockPreview.heldByRuns === 1 ? 'entry is' : 'entries are'} held by earlier
              correction runs and not included — revert those runs first to unknock them too.
            </p>
          )}
          <p className="mt-2 text-xs text-fg-muted">
            Canvasser totals shrink by these entries. A past month whose invoice was already issued
            will show a drift warning rather than silently changing, and published client reports
            keep the numbers they were published with. Undoable from this page; a door re-knocked
            for real in the meantime keeps its new entry.
          </p>
        </Modal>
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
          subtitle={`These answers will be recorded for every voter at ${(composing.doorCount ?? selectionCount).toLocaleString()} ${(composing.doorCount ?? selectionCount) === 1 ? 'door' : 'doors'}`}
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
      {walking && (
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
