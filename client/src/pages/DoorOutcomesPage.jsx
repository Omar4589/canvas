import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
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
import { isAnswerable } from '../lib/surveyRunner.js';
import SurveyAnswerComposer from '../components/outcomes/SurveyAnswerComposer.jsx';
import SurveyConvertModal from '../components/outcomes/SurveyConvertModal.jsx';
import RemoveAnswersModal from '../components/outcomes/RemoveAnswersModal.jsx';
import QueueWalkthrough from '../components/outcomes/QueueWalkthrough.jsx';
import ConversionRunCard from '../components/outcomes/ConversionRunCard.jsx';
import RunDetailModal from '../components/outcomes/RunDetailModal.jsx';
import AnswerEditForm from '../components/outcomes/AnswerEditForm.jsx';
import AnswerEditReviewModal from '../components/outcomes/AnswerEditReviewModal.jsx';
import AnswerEditWalkthrough from '../components/outcomes/AnswerEditWalkthrough.jsx';
import AnswerEditRunCard, { ACTION_LABEL as EDIT_ACTION_LABEL } from '../components/outcomes/AnswerEditRunCard.jsx';
import { useAnswerEditRunPoll, gaveUp } from '../lib/useAnswerEditRunPoll.js';
import { planFromForm, runState, picksLine, attentionBadge, isAnswerEditSettled } from '../lib/answerEditPlan.js';
// `editAtWork`, never `editBusy`: this page's own `editBusy` (a request in flight) shadowed the import across the
// whole component, and the watch called a boolean — the page threw on every mount (code review of 12b56fa).
import {
  conversionBusy, editBusy as editAtWork, conversionListInterval, editListInterval, landedSince, nextToFollow, cardLandsIt,
  sameConversionState, sameEditState, refusedAsBusy,
} from '../lib/changeWatch.js';
import { useCurrentCampaign } from '../lib/useCurrentCampaign.js';
import { isOutcomeEnabled, outcomeInUse } from '../lib/outcomeToggles.js';
import { CampaignLoading, CampaignMissing } from '../components/campaigns/CampaignGate.jsx';

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

// not_target is the off-by-default outcome: its filter chip shows only on a campaign that has used
// it, and it is a "Change to" target only where the server would accept it (isOutcomeEnabled).
const OUTCOMES = ['not_home', 'wrong_address', 'refused', 'not_target', 'no_soliciting', 'restricted'];
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
  const { isOrgAdmin } = useAuth();
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
  // The page banner, brought into view when it says something new: a refusal of a button far down the
  // page (a run's Undo, Stop here) landed thousands of pixels above it and looked like nothing (round 5).
  const errorRef = useRef(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!error) return undefined;
    const frame = requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    return () => cancelAnimationFrame(frame);
  }, [error]);
  // Surveyed direction state. `composing` holds the resolved template while the admin picks
  // answers; `activeRun` is the run being watched (bulk) or walked (queue).
  const [composing, setComposing] = useState(null);
  const [vals, setVals] = useState({});
  const [otherTexts, setOtherTexts] = useState({});
  const [activeRunId, setActiveRunId] = useState(null);
  const [walking, setWalking] = useState(null);
  const [queueTemplate, setQueueTemplate] = useState(null);
  const [detailRun, setDetailRun] = useState(null); // the run whose itemized history is open
  // Edit answers… (docs/PROPOSAL_SURVEY_ANSWER_EDITS.md). `editDry` is the form's dry run, `editForm`
  // its per-question choices, `editPreview` the priced review; `editWalk` a one-person session.
  const [editDry, setEditDry] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editMode, setEditMode] = useState('bulk');
  const [editPreview, setEditPreview] = useState(null);
  const [editError, setEditError] = useState(null);
  const [activeEditRunId, setActiveEditRunId] = useState(null);
  const [editWalk, setEditWalk] = useState(null);

  const { campaign: current, campaignsQ, resolving, notFound } = useCurrentCampaign(campaignId);
  // One mounted page serves every campaign (the switcher re-renders it with a new id), and a
  // mutation's callbacks are the LATEST render's — an onSuccess reading `campaignId` gets the campaign
  // switched TO. So every write carries the campaign it was started on (`vars.campaignId`) and the
  // body it priced, its mutationFn reads only those, and a reply touches this page's state only while
  // the page is still on that campaign (`stillOn`; the CampaignSurveyBuilderPage idiom — round 3: a
  // late reply cleared the next campaign's selection, and a confirm wrote whatever was selected by then).
  const campaignRef = useRef(campaignId);
  campaignRef.current = campaignId;
  const stillOn = (id) => String(campaignRef.current) === String(id);
  const tz = current?.timeZone || orgTz;
  // Which off-by-default outcomes Doorline has released — the server's rule for a "Change to"
  // target needs it, and only the campaigns response carries it.
  const optInAvailable = campaignsQ.data?.optInOutcomesAvailable || [];
  const notTargetInUse = outcomeInUse(current, 'not_target');
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
    setEditDry(null);
    setEditForm({});
    setEditError(null);
    setEditPreview(null);
    setEditWalk(null);
    setActiveEditRunId(null);
    // The other cards, the walkthroughs and the Details modal belong to the campaign we're leaving too.
    setActiveRunId(null);
    setWalking(null);
    setQueueTemplate(null);
    setDetailRun(null);
  }
  // After a write lands: this page's state resets only if it is still on the campaign the write was
  // for; that campaign's lists are refetched either way.
  const afterWrite = (cid = campaignId) => {
    if (stillOn(cid)) {
      setPreview(null);
      resetSelection();
    }
    refetchAfterWrite(cid);
  };
  // After this page's own Undo, Revert or Stop here lands: what it moved is refetched, and a review priced
  // before it finished closes with a word — the selection stays (round 7: afterWrite closed a review opened
  // while the request ran, with no word, and cleared the selection). `at` is the server's finish time.
  // With no server time (a failure whose reply carries no run) every open review closes, and nothing is
  // remembered as the finish — remembered, it refused every review after it until a reload (round 8).
  const afterOwnUndo = (cid, at) => {
    refetchAfterWrite(cid);
    if (stillOn(cid)) closeStaleReviews(at || Infinity, { remember: !!at });
  };
  // Another change holding the campaign that this page never saw — another admin's, another tab's, or one
  // started while no list was being read — is read whenever the page hears of it: the Edit answers form
  // saying one is running (editOpen), or any change refused for one (below). The lists' watch then shows it
  // (code review of 12b56fa: the lists were read only while they already held a moving run, so a change
  // started elsewhere never showed, and Check again changed nothing).
  const readChangeListsAgain = (cid = campaignId) => {
    for (const k of ['survey-conversions', 'answer-edits', 'unknock']) qc.invalidateQueries({ queryKey: ['admin', 'campaigns', cid, k] });
  };
  useEffect(
    () =>
      qc.getMutationCache().subscribe((event) => {
        if (event?.type !== 'updated' || event.action?.type !== 'error' || !refusedAsBusy(event.action.error)) return;
        readChangeListsAgain(event.mutation?.state?.variables?.campaignId || campaignId);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, campaignId]
  );
  // The lists and numbers a write moved, refetched — and nothing on the page touched.
  const refetchAfterWrite = (cid = campaignId) => {
    qc.invalidateQueries({ queryKey: ['admin', 'outcome-entries', cid] });
    qc.invalidateQueries({ queryKey: ['admin', 'campaigns', cid, 'reclassify'] });
    // Door statuses and every derived number moved — let the rest of the console refetch.
    qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
    qc.invalidateQueries({ queryKey: ['reports'] });
  };

  // The bulk answer set, empty rows dropped — partial entry is legal, but an unanswered question
  // should not be stored as a blank row on every voter. Statements are read-aloud script and never
  // post a row.
  const composedAnswers = () =>
    dropEmptyAnswers(
      buildAnswers((composing?.questions || []).filter((q) => !q.retired && isAnswerable(q)), vals, otherTexts)
    );
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

  // Conversion runs live beside the reclassify runs in "Past changes". One still running — this admin's,
  // another's, or one left running when the page was closed — is watched until it lands, so its row moves
  // on its own (2026-10-21: the list never polled, and its row stayed as the page loaded it).
  const convRunsQ = useQuery({
    queryKey: ['admin', 'campaigns', campaignId, 'survey-conversions'],
    queryFn: () => api(`/admin/campaigns/${campaignId}/survey-conversions`),
    enabled: !!campaignId && isOrgAdmin,
    refetchInterval: (q) => (gaveUp(q) ? false : conversionListInterval(q.state.data?.runs)),
  });
  const convRuns = convRunsQ.data?.runs || [];
  const { run: liveRun, stopped: convPollStopped } = useConversionRunPoll({ campaignId, runId: activeRunId });

  // A finished (or failed) run refetches the same things a reclassify does — and only that: the admin
  // may be in the middle of their next change by now, and resetting the page closed its preview and
  // cleared its selection (code review round 4).
  const prevStatus = liveRun?.status;
  useEffect(() => {
    if (!['completed', 'failed', 'reverted', 'revert_failed'].includes(prevStatus)) return;
    refetchAfterWrite();
    closeStaleReviews(finishedAt(liveRun));
    // Re-running it on an unchanged status is the bug to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevStatus]);
  // The list's own watch: a run it saw at work that has landed — card or no card — refetches what it moved
  // and closes reviews priced before it, as the card's landing does; and one still at work with no card up
  // gets its card back — a change left running when the page was closed, or another admin's (2026-10-21:
  // neither came back, and the row kept the state the page loaded with). A card dismissed stays dismissed.
  // Both halves are plain functions (lib/changeWatch.js). A run the live card lands itself — its copy still at
  // work, or already showing that landing — is left to the card's own effect above, never handled twice (code
  // review of 12b56fa: both refetched; then a card showing its run settled earlier skipped that run's next
  // landing, and nothing refetched).
  const busyConvs = useRef({ cid: null, ids: new Set() });
  const dismissedConvs = useRef(new Set());
  useEffect(() => {
    const was = busyConvs.current;
    busyConvs.current = { cid: campaignId, ids: new Set(convRuns.filter(conversionBusy).map((r) => r.id)) };
    if (was.cid !== campaignId) return;
    const card = convPollStopped ? null : liveRun;
    const landed = landedSince(was.ids, convRuns, conversionBusy, { skip: (r) => cardLandsIt(card, r, { busy: conversionBusy, same: sameConversionState }) });
    if (!landed.length) return;
    refetchAfterWrite(campaignId);
    closeStaleReviews(Math.max(...landed.map(finishedAt)));
    // Reads this render's campaign, card and reviews; re-running on every list change is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convRunsQ.data, campaignId]);
  // ...and the follow, on its own: also when a card closes or its run settles — a settled card gives way to a
  // run at work, or follows its own run again when the list shows it at work (nextToFollow).
  useEffect(() => {
    if (walking) return;
    const next = nextToFollow({ runs: convRuns, busy: conversionBusy, dismissed: dismissedConvs.current, cardId: activeRunId, card: liveRun });
    // Its own run: the card reads it again — never the list's copy, which can be older than its own.
    if (next?.refresh) qc.invalidateQueries({ queryKey: ['survey-conversion', campaignId, next.run.id] });
    else if (next) followConvRun(next.run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convRunsQ.data, campaignId, activeRunId, walking, liveRun?.status, liveRun?.updatedAt]);

  const convBody = (extra = {}) => ({
    direction,
    to: direction === 'to_survey' ? SURVEYED : target,
    ...selectionBody(),
    ...extra,
  });

  // Step 1 of the Surveyed direction: resolve the ONE template these doors use. A selection
  // spanning two surveys is refused here rather than written under whichever came first.
  const loadTemplate = useMutation({
    mutationFn: ({ campaignId: cid, body: b }) =>
      api(`/admin/campaigns/${cid}/survey-conversions/template`, {
        method: 'POST',
        body: b,
      }),
    onSuccess: (d, v) => {
      if (!stillOn(v.campaignId)) return;
      // Carry the resolved DOOR count with the template: the modal's subtitle says "doors", and
      // selectionCount is an ENTRY count — 12 entries can be 9 doors (two rounds at one address),
      // and the dry-run modal that follows uses the server's real doors, so the two disagreed.
      // `sent` is the selection the answers are composed for; the review and the write use it.
      setComposing({ ...d.template, doorCount: d.doors, sent: v });
      setVals({});
      setOtherTexts({});
    },
    onError: (e, v) => stillOn(v.campaignId) && setError(e.message),
  });

  // The review prices a body; its Confirm sends that same body (`preview.sent`), never the selection
  // as it stands at the click.
  const convDryRun = useMutation({
    mutationFn: ({ campaignId: cid, body: b }) =>
      api(`/admin/campaigns/${cid}/survey-conversions`, { method: 'POST', body: { ...b, dryRun: true } }),
    onSuccess: (d, v) => stillOn(v.campaignId) && openReview(d, () => setPreview({ ...d, sent: v })),
    onError: (e, v) => stillOn(v.campaignId) && setError(e.message),
  });
  // The forward review's body: the selection the answers were composed for, with those answers.
  const composedConvBody = () => ({ ...composing.sent.body, direction: 'to_survey', to: SURVEYED, answers: composedAnswers() });

  const convRun = useMutation({
    mutationFn: ({ campaignId: cid, body: b, mode }) =>
      api(`/admin/campaigns/${cid}/survey-conversions`, { method: 'POST', body: { ...b, mode } }),
    onSuccess: (d, v) => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns', v.campaignId, 'survey-conversions'] });
      if (!stillOn(v.campaignId)) return;
      setPreview(null);
      setComposing(null);
      resetSelection();
      setActiveRunId(d.run.id);
    },
    onError: (e, v) => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns', v.campaignId, 'survey-conversions'] });
      if (!stillOn(v.campaignId)) return;
      // A 503 still created the run — surface the message, and show its card to pick it up from.
      setError(e.message);
      setPreview(null);
      if (e.data?.run?.id) followConvRun(e.data.run);
    },
  });

  // ONE call: the creating POST resolves the template itself (refusing a mixed-template selection)
  // and returns the session ready to walk — doorsRemaining and the survey together. A separate
  // /template call here would also be subtly wrong: it resolves from the SELECTION, while the run
  // freezes its own, and the two must never diverge mid-session.
  const startQueue = useMutation({
    mutationFn: ({ campaignId: cid, body: b }) =>
      api(`/admin/campaigns/${cid}/survey-conversions`, { method: 'POST', body: b }),
    onSuccess: (d, v) => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns', v.campaignId, 'survey-conversions'] });
      // Opened after a campaign switch: it waits in that campaign's list as Unfinished.
      if (!stillOn(v.campaignId)) return;
      setQueueTemplate(d.run.template || null);
      setWalking(d.run);
      resetSelection();
    },
    onError: (e, v) => stillOn(v.campaignId) && setError(e.message),
  });

  const closeQueue = useMutation({
    mutationFn: ({ campaignId: cid, runId }) => api(`/admin/campaigns/${cid}/survey-conversions/${runId}/close`, { method: 'POST' }),
    onSuccess: (d, v) => {
      followConvRun(d.run);
      afterOwnUndo(v.campaignId, finishedAt(d.run));
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns', v.campaignId, 'survey-conversions'] });
    },
    onError: (e, v) => stillOn(v.campaignId) && setError(e.message),
  });

  // Re-enter an unfinished door-by-door session. The GET carries both halves — the remaining doors
  // (derived from what's already saved, so it is right no matter how the session ended) and the
  // survey the run froze at creation.
  const resumeQueue = useMutation({
    mutationFn: ({ campaignId: cid, runId }) => api(`/admin/campaigns/${cid}/survey-conversions/${runId}`),
    onSuccess: ({ run }, v) => {
      if (!stillOn(v.campaignId)) return;
      if (!run.doorsRemaining?.length) {
        // Nothing left — it was finished but never closed. Close it rather than opening an empty
        // walkthrough the admin would have to dismiss.
        return closeQueue.mutate({ campaignId: v.campaignId, runId: run.id });
      }
      setQueueTemplate(run.template || null);
      setWalking(run);
    },
    onError: (e, v) => stillOn(v.campaignId) && setError(e.message),
  });

  // A card watching a run must see what an action on THAT run just did: setting the same id again
  // changes no query key, and its cached copy is settled, so polling would never restart. Seeding
  // the cache with the response's run (pending, reverting…) restarts it.
  // A reply that lands after the admin switched campaigns is the other campaign's: never shown here.
  // A poll already in flight is cancelled first: answering after the seed, it painted the run as it
  // was BEFORE the action — settled, so the card stopped polling on a stale state (round 3).
  const followConvRun = async (run) => {
    if (!run?.id || (run.campaignId && run.campaignId !== String(campaignId))) return;
    const key = ['survey-conversion', campaignId, run.id];
    await qc.cancelQueries({ queryKey: key });
    qc.setQueryData(key, { run });
    setActiveRunId(run.id);
  };
  // Watch a run whose latest state only the server has (a door-by-door session just closed or left):
  // its cached copy is the settled `open` one, so it is asked for again.
  const watchConvRun = (runId) => {
    if (!runId) return;
    qc.invalidateQueries({ queryKey: ['survey-conversion', campaignId, runId] });
    setActiveRunId(runId);
  };
  const convRevert = useMutation({
    mutationFn: ({ campaignId: cid, runId }) =>
      api(`/admin/campaigns/${cid}/survey-conversions/${runId}/revert`, { method: 'POST' }),
    onSuccess: (d, v) => {
      if (d.run) followConvRun(d.run);
      else if (stillOn(v.campaignId)) setActiveRunId(null);
      afterOwnUndo(v.campaignId, finishedAt(d.run));
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns', v.campaignId, 'survey-conversions'] });
    },
    onError: (e, v) => {
      if (stillOn(v.campaignId)) setError(e.message);
      // An undo that stopped part-way changed some doors: show its card (Retry undo) and the
      // fresh list rather than the state from before the click.
      if (e.data?.run?.id) followConvRun(e.data.run);
      if (e.code === 'REVERT_FAILED') {
        afterOwnUndo(v.campaignId, finishedAt(e.data?.run));
        qc.invalidateQueries({ queryKey: ['admin', 'campaigns', v.campaignId, 'survey-conversions'] });
      }
    },
  });

  const convResume = useMutation({
    mutationFn: ({ campaignId: cid, runId }) =>
      api(`/admin/campaigns/${cid}/survey-conversions/${runId}/resume`, { method: 'POST' }),
    onSuccess: (d, v) => {
      followConvRun(d.run);
      // Its row reads Working again now, not Stopped (it offers Pick up too since 2026-10-21).
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns', v.campaignId, 'survey-conversions'] });
    },
    onError: (e, v) => stillOn(v.campaignId) && setError(e.message),
  });

  // ---- Edit answers… -------------------------------------------------------------------------
  // The run list rides beside the conversions under "Survey answer changes"; the live card polls
  // one run until it settles, then everything a change of answers moves is refetched.
  const editRunsQ = useQuery({
    queryKey: ['admin', 'campaigns', campaignId, 'answer-edits'],
    queryFn: () => api(`/admin/campaigns/${campaignId}/answer-edits`),
    enabled: !!campaignId && isOrgAdmin,
    // Watched while one is still moving, as the conversions are (above) — slowly while the only ones at work
    // wait on the worker or stopped responding (lib/changeWatch.js).
    refetchInterval: (q) => (gaveUp(q) ? false : editListInterval(q.state.data?.runs)),
  });
  const editRuns = editRunsQ.data?.runs || [];
  const { run: liveEditRun, settled: editSettled, stopped: editPollStopped } = useAnswerEditRunPoll({ campaignId, runId: activeEditRunId });
  const afterEdit = (cid = campaignId) => {
    qc.invalidateQueries({ queryKey: ['admin', 'campaigns', cid, 'answer-edits'] });
    qc.invalidateQueries({ queryKey: ['admin', 'outcome-entries', cid] });
    qc.invalidateQueries({ queryKey: ['reports'] });
  };
  // The live card watching a run must see what an action on THAT run just did: setting the same id
  // again changes no query key, and its cached copy is settled, so polling would never restart.
  // Seeding the cache with the response's run (pending, undoing…) restarts it.
  // A reply that lands after a campaign switch is the other campaign's, never shown here. A reply
  // that is already settled is asked for once more: its undo names come with their words only on
  // a read, never on an action's reply.
  // A poll already in flight is cancelled first (followConvRun).
  const followEditRun = async (run) => {
    if (!run?.id || (run.campaignId && run.campaignId !== String(campaignId))) return;
    const key = ['answer-edit', campaignId, run.id];
    await qc.cancelQueries({ queryKey: key });
    qc.setQueryData(key, { run });
    if (isAnswerEditSettled(run)) qc.invalidateQueries({ queryKey: key });
    setActiveEditRunId(run.id);
  };
  // The list's own watch, as the conversions' (above): a change it saw moving that has settled refetches what
  // it moved, and one still moving with no card up gets its card back.
  const busyEdits = useRef({ cid: null, ids: new Set() });
  const dismissedEdits = useRef(new Set());
  useEffect(() => {
    const was = busyEdits.current;
    busyEdits.current = { cid: campaignId, ids: new Set(editRuns.filter(editAtWork).map((r) => r.id)) };
    if (was.cid !== campaignId) return;
    const card = editPollStopped ? null : liveEditRun;
    if (landedSince(was.ids, editRuns, editAtWork, { skip: (r) => cardLandsIt(card, r, { busy: editAtWork, same: sameEditState }) }).length) {
      afterEdit(campaignId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRunsQ.data, campaignId]);
  useEffect(() => {
    if (editWalk) return;
    const next = nextToFollow({ runs: editRuns, busy: editAtWork, dismissed: dismissedEdits.current, cardId: activeEditRunId, card: liveEditRun });
    if (next?.refresh) qc.invalidateQueries({ queryKey: ['answer-edit', campaignId, next.run.id] });
    else if (next) followEditRun(next.run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRunsQ.data, campaignId, activeEditRunId, editWalk, liveEditRun?.status, liveEditRun?.undo?.status]);
  const editSettledKey = liveEditRun ? `${liveEditRun.id}:${liveEditRun.status}:${liveEditRun.undo?.status}:${editSettled}` : null;
  useEffect(() => {
    if (editSettledKey && editSettled) afterEdit();
    // afterEdit only invalidates caches; re-running it for an unchanged state is the bug to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSettledKey]);

  // The form's selection is the one it opened on (`editDry.sent`): switching its survey, Check again,
  // the review, the write and Start all send that, never the selection as it stands at the click —
  // and the write sends the plan its review priced (`editPreview.sent.plan`), never the form re-read
  // (round 3: a plan changed while Review was loading was priced as one thing and written as another).
  const editsUrl = (cid) => `/admin/campaigns/${cid}/answer-edits`;
  // Opens the form, switches its survey, or (keepForm) refreshes its counts after a stale review.
  const editOpen = useMutation({
    mutationFn: ({ campaignId: cid, selection, surveyTemplateId = null }) =>
      api(editsUrl(cid), {
        method: 'POST',
        body: { ...selection, dryRun: true, ...(surveyTemplateId ? { surveyTemplateId } : {}) },
      }),
    // The form's words go first, so the same refusal pressed again is brought into view again (round 8).
    onMutate: (v) => {
      if (stillOn(v.campaignId) && editDry) setEditError(null);
    },
    onSuccess: (d, { campaignId: cid, selection, keepForm = false, notice = null }) => {
      // The form says another change is running — Check again included: read the lists, so that change
      // shows (its card, or its row) even when this page never saw it start.
      if (d.blocked) readChangeListsAgain(cid);
      if (!stillOn(cid)) return;
      setEditDry({ ...d, sent: { campaignId: cid, selection } });
      if (!keepForm) setEditForm({});
      setEditError(notice);
    },
    // With the form already open the page banner is behind it — the form shows the error.
    onError: (e, v) => stillOn(v.campaignId) && (editDry ? setEditError(e.message) : setError(e.message)),
  });
  const openEdit = () => editOpen.mutate({ campaignId, selection: selectionBody() });
  const reopenEdit = (extra = {}) => editOpen.mutate({ ...editDry.sent, surveyTemplateId: editDry.template?.id, ...extra });
  const editReview = useMutation({
    mutationFn: ({ campaignId: cid, selection, surveyTemplateId, plan }) =>
      api(editsUrl(cid), { method: 'POST', body: { ...selection, dryRun: true, surveyTemplateId, plan } }),
    onMutate: (v) => {
      if (stillOn(v.campaignId)) setEditError(null);
    },
    // Only onto the form it was priced from: away and back to this campaign while it loaded, the
    // form is gone (or a new one is open), and the review opened over a reset page (round 4).
    onSuccess: (d, v) => {
      // A review told another change is running reads the lists too, as the form does (code review of 12b56fa).
      if (d.blocked) readChangeListsAgain(v.campaignId);
      if (!stillOn(v.campaignId) || editDry?.sent?.selection !== v.selection) return;
      setEditError(null);
      setEditPreview({ ...d, sent: v });
    },
    onError: (e, v) => stillOn(v.campaignId) && editDry?.sent?.selection === v.selection && setEditError(e.message),
  });
  const editCreate = useMutation({
    mutationFn: ({ campaignId: cid, selection, surveyTemplateId, plan, digest, asOf, templateVersion }) =>
      api(editsUrl(cid), { method: 'POST', body: { ...selection, surveyTemplateId, plan, digest, asOf, templateVersion } }),
    onSuccess: (d, v) => {
      afterEdit(v.campaignId);
      if (!stillOn(v.campaignId)) return;
      setEditPreview(null);
      setEditDry(null);
      resetSelection();
      followEditRun(d.run);
    },
    onError: (e, v) => {
      afterEdit(v.campaignId);
      if (!stillOn(v.campaignId)) return;
      setEditPreview(null);
      if (e.data?.run?.id) {
        // A 503 still created the run: its card offers Pick up, and the page banner says why.
        setEditDry(null);
        followEditRun(e.data.run);
        setError(e.message);
        return;
      }
      // Nothing was written (a stale review, another change running, a plan error): back on the
      // form with the server's words — the page banner would sit behind it. With the form gone, the
      // banner (round 4: a refusal there said nothing at all).
      if (editDry) setEditError(e.message);
      else setError(e.message);
    },
  });
  const confirmEdit = () =>
    editCreate.mutate({
      ...editPreview.sent,
      surveyTemplateId: editPreview.template.id,
      digest: editPreview.digest,
      asOf: editPreview.asOf,
      templateVersion: editPreview.template.version,
    });
  const editStartQueue = useMutation({
    mutationFn: ({ campaignId: cid, selection, surveyTemplateId, digest, asOf, templateVersion }) =>
      api(editsUrl(cid), { method: 'POST', body: { ...selection, mode: 'queue', surveyTemplateId, digest, asOf, templateVersion } }),
    onSuccess: (d, v) => {
      afterEdit(v.campaignId);
      // Opened after a campaign switch: it waits in that campaign's list as Unfinished.
      if (!stillOn(v.campaignId)) return;
      setEditDry(null);
      resetSelection();
      setEditWalk({ run: d.run, current: d.current });
    },
    onError: (e, v) => {
      if (!stillOn(v.campaignId)) return;
      // A session has no review step to go back to, so a stale count is refreshed in place.
      if (e.code === 'REVIEW_STALE' && editDry) {
        reopenEdit({ keepForm: true, notice: 'Something changed since you opened this — the counts are refreshed. Press Start again.' });
        return;
      }
      setEditError(e.message);
    },
  });
  const startEditQueue = () =>
    editStartQueue.mutate({
      ...editDry.sent,
      surveyTemplateId: editDry.template.id,
      digest: editDry.digest,
      asOf: editDry.asOf,
      templateVersion: editDry.template.version,
    });
  const editResumeQueue = useMutation({
    mutationFn: ({ campaignId: cid, runId }) => api(`${editsUrl(cid)}/${runId}`),
    onSuccess: ({ run: r }, v) => {
      if (!stillOn(v.campaignId)) return;
      // Stopped meanwhile (another tab, another admin): show it as it is, never an empty session.
      if (r.status !== 'open') {
        followEditRun(r);
        afterEdit();
        setError('That session was already stopped.');
        return;
      }
      setEditWalk({ run: r, current: r.current || null });
    },
    onError: (e, v) => {
      afterEdit(v.campaignId);
      if (stillOn(v.campaignId)) setError(e.message);
    },
  });
  // Close, Pick up and Undo answer with the run they changed.
  const editRunActionDone = (d, v) => {
    followEditRun(d.run);
    afterEdit(v.campaignId);
  };
  const editRunActionFailed = (e, v) => {
    if (e.data?.run?.id) followEditRun(e.data.run);
    if (stillOn(v.campaignId)) setError(e.message);
    afterEdit(v.campaignId);
  };
  const editClose = useMutation({
    mutationFn: ({ campaignId: cid, runId }) => api(`${editsUrl(cid)}/${runId}/close`, { method: 'POST' }),
    onSuccess: editRunActionDone,
    onError: editRunActionFailed,
  });
  const editPickUp = useMutation({
    mutationFn: ({ campaignId: cid, runId }) => api(`${editsUrl(cid)}/${runId}/resume`, { method: 'POST' }),
    onSuccess: editRunActionDone,
    onError: editRunActionFailed,
  });
  const editUndo = useMutation({
    mutationFn: ({ campaignId: cid, runId }) => api(`${editsUrl(cid)}/${runId}/revert`, { method: 'POST' }),
    onSuccess: editRunActionDone,
    onError: editRunActionFailed,
  });
  const editBusy =
    editOpen.isPending || editReview.isPending || editCreate.isPending || editStartQueue.isPending || editResumeQueue.isPending ||
    editClose.isPending || editPickUp.isPending || editUndo.isPending;
  // One owner for what each run-state button does (lib/answerEditPlan.js runState names them).
  const onEditAction = (action, r) => {
    setError(null);
    if (action === 'details') {
      setDetailRun({ type: 'answerEdit', id: r.id, title: `Answers edited · ${r.planSummary || ''}`, by: r.by, createdAt: r.createdAt, samples: r.samples, samplesTotal: r.samplesTotal });
    } else if (action === 'undo' || action === 'undoAgain' || action === 'retryUndo' || action === 'undoLanded' || action === 'startAgainUndo') {
      editUndo.mutate({ campaignId, runId: r.id });
    } else if (action === 'pickUp' || action === 'startAgain') {
      editPickUp.mutate({ campaignId, runId: r.id });
    } else if (action === 'resume') {
      editResumeQueue.mutate({ campaignId, runId: r.id });
    } else if (action === 'stopHere') {
      editClose.mutate({ campaignId, runId: r.id });
    }
  };

  // Priced, then written with the body that was priced (`preview.sent`).
  const dryRun = useMutation({
    mutationFn: ({ campaignId: cid, body: b }) => api(`/admin/campaigns/${cid}/reclassify-outcomes`, { method: 'POST', body: { ...b, dryRun: true } }),
    onSuccess: (d, v) => stillOn(v.campaignId) && openReview(d, () => setPreview({ ...d, sent: v })),
    onError: (e, v) => stillOn(v.campaignId) && setError(e.message),
  });
  const run = useMutation({
    mutationFn: ({ campaignId: cid, body: b }) => api(`/admin/campaigns/${cid}/reclassify-outcomes`, { method: 'POST', body: b }),
    onSuccess: (d, v) => afterWrite(v.campaignId),
    onError: (e, v) => {
      if (!stillOn(v.campaignId)) return;
      setError(e.message);
      setPreview(null);
    },
  });
  const revert = useMutation({
    mutationFn: ({ campaignId: cid, runId }) => api(`/admin/campaigns/${cid}/reclassify-outcomes/revert`, { method: 'POST', body: { runId } }),
    onSuccess: (d, v) => afterOwnUndo(v.campaignId, Date.parse(d?.revertedAt || '') || 0),
    onError: (e, v) => stillOn(v.campaignId) && setError(e.message),
  });

  // UNKNOCK — the fourth act, and the only one that REMOVES entries. No target outcome, its own
  // preview state (the reclassify `preview` renders a different modal family).
  const unknockRunsQ = useQuery({
    queryKey: ['admin', 'campaigns', campaignId, 'unknock'],
    queryFn: () => api(`/admin/campaigns/${campaignId}/unknock-entries`),
    enabled: !!campaignId && isOrgAdmin,
    // An unknock still removing or being undone (a large one runs for a while, can outlast its request,
    // and another admin's shows here too) is watched until it lands, so its Undo — or Undone — appears
    // without a reload; a refused read (the campaign gone, the admin demoted) stops the watch (round 5).
    refetchInterval: (q) => (!gaveUp(q) && (q.state.data?.runs || []).some((r) => r.removing || r.undoing) ? 3000 : false),
  });
  const unknockRuns = unknockRunsQ.data?.runs || [];
  // When one lands — removing or undoing no more, this admin's or another's — what it moved is
  // refetched and a review priced before it closes, as when a watched conversion finishes; the
  // selection stays (round 6: resetting the page here closed another review with no word and cleared
  // the selection, the round-4 conversion bug). One this page's own request already handled is skipped,
  // and a campaign switch lands nothing.
  const busyUnknocks = useRef({ cid: null, ids: new Set() });
  const landedHere = useRef(new Set());
  useEffect(() => {
    const now = new Set(unknockRuns.filter((r) => r.removing || r.undoing).map((r) => r.id));
    const was = busyUnknocks.current;
    busyUnknocks.current = { cid: campaignId, ids: now };
    if (was.cid !== campaignId) {
      // Another campaign's landings handled here are that campaign's: kept, one could skip a run's later
      // landing when the page came back (round 8).
      landedHere.current.clear();
      return;
    }
    const landed = [];
    for (const r of unknockRuns) {
      if (!was.ids.has(r.id) || now.has(r.id)) continue;
      // One this page's own request handled lands once, then is forgotten — the same run's next landing
      // (its Undo outliving its request) is the watch's to handle (round 7: kept for good, it was skipped,
      // and the page stayed as it was with "may still be working" up).
      if (landedHere.current.delete(r.id)) continue;
      landed.push(r);
    }
    if (!landed.length) return;
    setError((m) => (m === STILL_WORKING ? null : m));
    refetchAfterWrite(campaignId);
    closeStaleReviews(Math.max(...landed.map(finishedAt)));
    // Reads this render's campaign and reviews; re-running on every runs change is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unknockRunsQ.data, campaignId]);
  // A request that ended before the change did (the connection dropped, the router's 30 s cut) may
  // still be working on the server — say so, and where to look, instead of "Request failed: 503". One
  // the server answered with its own error stopped there: say that, and what finishes it (round 6).
  // Only the server's own word that the change stopped part-way says so; any other answer from it came
  // before the change began, or isn't about it (round 7: every JSON 5xx read "stopped part-way").
  const unknockFailedWords = (e, act) => {
    if (e?.status && e.status < 500) return e.message;
    if (e?.code === 'UNDO_STOPPED') return 'The undo stopped part-way. Press Retry undo on its row under Removed entries to finish it.';
    if (e?.code === 'UNKNOCK_STOPPED') return 'The unknock stopped before it finished. Its row under Removed entries shows what it did.';
    if (e?.code === 'UNKNOCK_NOT_STARTED') return e.message;
    if (typeof e?.data?.error === 'string') {
      return `The server couldn't finish that (${e.message}). If any of it ran, its row under Removed entries says where it stands.`;
    }
    return STILL_WORKING;
  };
  // A landing this request handles is skipped by the watch above — only when the watch saw the run busy,
  // so it lands there once (round 7).
  const afterUnknock = (cid, d, { own = false } = {}) => {
    if (d?.run?.id && busyUnknocks.current.ids.has(d.run.id)) landedHere.current.add(d.run.id);
    if (stillOn(cid)) setUnknockPreview(null);
    if (own) afterOwnUndo(cid, finishedAt(d?.run));
    else afterWrite(cid);
    qc.invalidateQueries({ queryKey: ['admin', 'campaigns', cid, 'unknock'] });
  };
  // Priced, then written with the body that was priced (`unknockPreview.sent`): an unknock written
  // from the selection at the click removed whatever was selected by then (round 3).
  const unknockDryRun = useMutation({
    mutationFn: ({ campaignId: cid, body: b }) =>
      api(`/admin/campaigns/${cid}/unknock-entries`, { method: 'POST', body: { ...b, dryRun: true } }),
    onSuccess: (d, v) => stillOn(v.campaignId) && openReview(d, () => setUnknockPreview({ ...d, sent: v })),
    onError: (e, v) => stillOn(v.campaignId) && setError(e.message),
  });
  const unknockRun = useMutation({
    mutationFn: ({ campaignId: cid, body: b }) => api(`/admin/campaigns/${cid}/unknock-entries`, { method: 'POST', body: b }),
    onSuccess: (d, v) => afterUnknock(v.campaignId, d),
    onError: (e, v) => {
      // The request can end before the removal does (a connection drop, the router's time limit): the
      // run list shows it as Removing… until it finishes, and its Undo after (round 4). The ticked rows
      // go — pressed again, they started a second strike on the rows the first was removing (round 6).
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns', v.campaignId, 'unknock'] });
      const notStarted = e?.code === 'UNKNOCK_NOT_STARTED';
      if (stillOn(v.campaignId)) {
        setError(unknockFailedWords(e, 'unknock'));
        setUnknockPreview(null);
        if ((!e?.status || e.status >= 500) && !notStarted) resetSelection();
      }
      // What it removed before it stopped (or may still be removing) moved the table and the numbers too —
      // and a review priced while it ran closes, as on a landing (round 8).
      if (e?.code === 'UNKNOCK_STOPPED') afterOwnUndo(v.campaignId, finishedAt(e.data?.run));
      else if ((!e?.status || e.status >= 500) && !notStarted) refetchAfterWrite(v.campaignId);
    },
  });
  const unknockRevert = useMutation({
    mutationFn: ({ campaignId: cid, runId }) => api(`/admin/campaigns/${cid}/unknock-entries/revert`, { method: 'POST', body: { runId } }),
    onSuccess: (d, v) => afterUnknock(v.campaignId, d, { own: true }),
    onError: (e, v) => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns', v.campaignId, 'unknock'] });
      if (stillOn(v.campaignId)) setError(unknockFailedWords(e, 'undo'));
      if (e?.code === 'UNDO_STOPPED') afterOwnUndo(v.campaignId, finishedAt(e.data?.run));
      else if (!e?.status || e.status >= 500) refetchAfterWrite(v.campaignId);
    },
  });

  // A review priced before a change on this campaign finished showed numbers that change has since
  // moved, and those writes check nothing stale: it closes, the selection stays, so pressing the button
  // again prices it fresh (round 5) — only one priced BEFORE the finish, by the server's clock on both
  // sides, and never one whose own Confirm is still writing; one still being priced closes as it
  // arrives (round 6: it closed reviews priced after the finish and the one writing, and missed the
  // one in flight).
  const STALE_REVIEW = 'A change just finished on this campaign, so the review closed — press the button again to see the new numbers.';
  const lastFinish = useRef({ cid: null, at: 0 });
  // The run's last write — an undo that stopped part-way never touches its forward `completedAt` (round 7).
  const finishedAt = (r) => Date.parse(r?.updatedAt || r?.revertedAt || r?.completedAt || '') || 0;
  const STILL_WORKING = 'The server may still be working on it — the row under Removed entries shows where it stands.';
  // A review from a server that didn't stamp it (before this build) closes as before.
  const pricedBefore = (p, at) => !!p && (!p.asOf || Date.parse(p.asOf) < at);
  const closeStaleReviews = (at, { remember = true } = {}) => {
    if (!at) return;
    if (remember && (lastFinish.current.cid !== campaignId || at > lastFinish.current.at)) lastFinish.current = { cid: campaignId, at };
    let closed = false;
    if (pricedBefore(preview, at) && !run.isPending && !convRun.isPending) {
      setPreview(null);
      closed = true;
    }
    if (pricedBefore(unknockPreview, at) && !unknockRun.isPending) {
      setUnknockPreview(null);
      closed = true;
    }
    // Beside whatever the banner already says (a failed undo's words stay — round 7).
    if (closed) setError((m) => (m && m !== STALE_REVIEW ? `${m} ${STALE_REVIEW}` : STALE_REVIEW));
  };
  const openReview = (d, open) => {
    const seen = lastFinish.current;
    if (seen.cid === campaignId && seen.at && d?.asOf && Date.parse(d.asOf) < seen.at) setError(STALE_REVIEW);
    else open();
  };

  // The "Survey answer changes" card lists conversions and answer edits together, newest first.
  const changeRows = [
    ...editRuns.map((r) => ({ k: 'edit', r })),
    ...convRuns.map((r) => ({ k: 'conv', r })),
  ].sort((a, b) => new Date(b.r.createdAt) - new Date(a.r.createdAt));
  const renderEditRow = (r) => {
    const st = runState(r);
    const line = picksLine(r);
    return (
      <li key={`edit-${r.id}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 last:border-0">
        <div className="min-w-0 text-sm text-fg">
          <span className="font-medium">Answers edited{r.planSummary ? ` · ${r.planSummary}` : ''}</span>
          <div className="mt-0.5 text-xs text-fg-muted">
            {st.label}
            {line ? ` · ${line}` : ''}
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
          {st.tone === 'danger' && <Badge variant="danger">{attentionBadge(st)}</Badge>}
          {st.actions.map((a) => (
            <Button key={a} variant="secondary" size="sm" disabled={editBusy} onClick={() => onEditAction(a, r)}>
              {EDIT_ACTION_LABEL[a] || a}
            </Button>
          ))}
        </div>
      </li>
    );
  };

  if (resolving) return <CampaignLoading />;
  if (notFound) return <CampaignMissing />;
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
            other dated page puts it here. It must never render before the campaign's timezone is
            known, or a click on "Today" in the first frame resolves the ORG's today instead of the
            campaign's; the resolving guard above is what guarantees that (`current` is non-null by
            here, so `tz` is the campaign's), which is why there is no second check on it. */}
        <DateRangeSelector value={dateRange} onChange={(next) => applyFilter(() => setDateRange(next))} tz={tz} />
      </div>

      {/* Filters */}
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {SOURCES.filter((k) => k !== 'not_target' || notTargetInUse).map((k) => {
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
        <div ref={errorRef} className="mb-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{error}</div>
      )}

      {/* The change at work, or the last one's result, above the table: seen the moment it's confirmed,
          not below every list on the page (2026-10-21). */}
      {((liveEditRun && !editWalk) || (liveRun && !walking)) && (
        <div className="mb-4">
          {/* An answer edit in flight, or the result of the last one. */}
          {liveEditRun && !editWalk && (
            <AnswerEditRunCard
              run={liveEditRun}
              busy={editBusy}
              stopped={editPollStopped}
              onAction={onEditAction}
              onDismiss={() => { dismissedEdits.current.add(liveEditRun.id); setActiveEditRunId(null); }}
            />
          )}
          {/* A run in flight, or the result of the last one. */}
          {liveRun && !walking && (
            <ConversionRunCard
              run={liveRun}
              stopped={convPollStopped}
              busy={convRevert.isPending || convResume.isPending}
              onRevert={() => { setError(null); convRevert.mutate({ campaignId, runId: liveRun.id }); }}
              onResume={() => { setError(null); convResume.mutate({ campaignId, runId: liveRun.id }); }}
              onDismiss={() => { dismissedConvs.current.add(liveRun.id); setActiveRunId(null); }}
            />
          )}
        </div>
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
                  {/* Queued on a phone without signal and synced later. The evidence an admin needs
                      to review entries an offline phone recorded after an outcome was switched off. */}
                  {e.wasOfflineSubmission && (
                    <Badge variant="neutral" className="ml-1.5" title="Recorded without a connection and synced later">
                      Offline
                    </Badge>
                  )}
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
                          // Neutral for every action: Review removal and Unknock say in their own
                          // review that the visit's other answers go too; Edit answers leaves them.
                          <div className="mt-0.5 text-xs text-fg-muted" title={(e.survey.otherNames || []).join(', ')}>
                            {e.survey.voters - e.survey.matchedVoters} other
                            {e.survey.voters - e.survey.matchedVoters === 1 ? '' : 's'} surveyed at this visit, not matched
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
      {changeRows.length > 0 && (
        <Card className="mt-6">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-fg">Survey answer changes</h2>
          <ul>
            {changeRows.map(({ k, r }) => k === 'edit' ? renderEditRow(r) : (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 last:border-0">
                <div className="min-w-0 text-sm text-fg">
                  <span className="font-medium">
                    {r.direction === 'to_survey'
                      ? `${(r.sources || []).map((x) => ACTION_LABELS[x] || x).join(', ') || 'Door entries'} → Surveyed`
                      : `Surveyed → ${ACTION_LABELS[r.to] || r.to}`}
                  </span>
                  <div className="mt-0.5 text-xs text-fg-muted">
                    {/* "Surveys", not "answers": an answer is one reply now (Edit answers changes
                        those), and these runs record or remove whole surveys. */}
                    {r.direction === 'to_survey'
                      ? `${(r.counts?.responsesCreated || 0).toLocaleString()} ${(r.counts?.responsesCreated || 0) === 1 ? 'survey' : 'surveys'} recorded`
                      : `${(r.counts?.responsesArchived || 0).toLocaleString()} ${(r.counts?.responsesArchived || 0) === 1 ? 'survey' : 'surveys'} removed`}
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
                ) : r.status === 'reverting' ? (
                  <Badge variant="neutral">Undoing…</Badge>
                ) : r.status === 'running' ? (
                  // At work: where it has got to, and no Undo — the server refuses one while it runs (2026-10-21).
                  // The list watches it until it lands.
                  <Badge variant="info">
                    {r.progress?.phase === 'recomputing'
                      ? 'Updating totals…'
                      : `Working · ${(r.progress?.doorsDone || 0).toLocaleString()} of ${(r.progress?.doorsTotal || 0).toLocaleString()} doors`}
                  </Badge>
                ) : r.status === 'pending' ? (
                  // Queued, not begun: its Undo still cancels it — the job then finds nothing to claim (code
                  // review of 12b56fa: the row had lost it).
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="info">Waiting to start</Badge>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={convRevert.isPending}
                      onClick={() => { setError(null); convRevert.mutate({ campaignId, runId: r.id }); }}
                    >
                      Undo
                    </Button>
                  </div>
                ) : r.status === 'failed' ? (
                  // Stopped part-way: what landed is correct — pick up where it stopped, or undo it, as its card
                  // offers; one at a time, as on the card.
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="danger">Stopped</Badge>
                    <Button
                      size="sm"
                      disabled={convResume.isPending || convRevert.isPending}
                      onClick={() => { setError(null); convResume.mutate({ campaignId, runId: r.id }); }}
                    >
                      Pick up where it stopped
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={convResume.isPending || convRevert.isPending}
                      onClick={() => { setError(null); convRevert.mutate({ campaignId, runId: r.id }); }}
                    >
                      Undo
                    </Button>
                  </div>
                ) : r.status === 'revert_failed' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="danger">Undo stopped</Badge>
                    <Button
                      size="sm"
                      disabled={convRevert.isPending}
                      onClick={() => { setError(null); convRevert.mutate({ campaignId, runId: r.id }); }}
                    >
                      Retry undo
                    </Button>
                  </div>
                ) : r.status === 'open' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Steps of the session's entries — a door two canvassers recorded is two (code review of 12b56fa). */}
                    <Badge variant="neutral">
                      {`Unfinished — ${(r.progress?.doorsDone || 0).toLocaleString()} of ${(r.counts?.entriesTargeted || r.progress?.doorsTotal || 0).toLocaleString()} done`}
                    </Badge>
                    <Button
                      size="sm"
                      disabled={resumeQueue.isPending}
                      onClick={() => { setError(null); resumeQueue.mutate({ campaignId, runId: r.id }); }}
                    >
                      {resumeQueue.isPending ? 'Opening…' : 'Resume'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={closeQueue.isPending}
                      onClick={() => { setError(null); closeQueue.mutate({ campaignId, runId: r.id }); }}
                    >
                      Stop here
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={convRevert.isPending}
                    onClick={() => { setError(null); convRevert.mutate({ campaignId, runId: r.id }); }}
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
                    {r.status === 'pending' || (r.status === 'reverted' && !(r.strikeFinished ?? !!r.completedAt)) ? (
                      // Until it finishes — or if it never did, undone or not — the count is what was
                      // selected, not what came off (rounds 5 and 6).
                      <>
                        {(r.frozenRows ?? r.counts?.entriesRemoved ?? 0).toLocaleString()}{' '}
                        {(r.frozenRows ?? r.counts?.entriesRemoved ?? 0) === 1 ? 'entry' : 'entries'} selected
                      </>
                    ) : (
                      <>
                        {(r.counts?.entriesRemoved || 0).toLocaleString()}{' '}
                        {(r.counts?.entriesRemoved || 0) === 1 ? 'entry' : 'entries'} unknocked
                      </>
                    )}
                  </span>
                  <div className="mt-0.5 text-xs text-fg-muted">
                    {(r.counts?.doorsAffected || 0).toLocaleString()} {(r.counts?.doorsAffected || 0) === 1 ? 'door' : 'doors'}
                    {(r.counts?.responsesArchived || 0) > 0
                      ? ` · ${(r.counts.responsesArchived || 0).toLocaleString()} answers archived`
                      : ''}
                    {r.by ? ` · ${r.by}` : ''} · {formatInTz(r.createdAt, tz)}
                    {r.status === 'reverted' && (r.counts?.rowsNotRestored || 0) > 0
                      ? ` · ${r.counts.rowsNotRestored.toLocaleString()} ${r.counts.rowsNotRestored === 1 ? 'entry' : 'entries'} not put back`
                      : ''}
                    {/* The answers too — an undo that put back no answers said nothing (round 6). */}
                    {r.status === 'reverted' && (r.counts?.responsesNotRestored || 0) > 0
                      ? ` · ${r.counts.responsesNotRestored.toLocaleString()} ${r.counts.responsesNotRestored === 1 ? 'survey' : 'surveys'} not put back`
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
                  ) : r.undoing ? (
                    <Badge variant="info">{`Undoing…${r.progress?.phase === 'undoing' && r.progress.pct > 0 ? ` ${r.progress.pct}%` : ''}`}</Badge>
                  ) : r.removing ? (
                    // How far it has got (2026-10-21) — once there is anything to say: a small one is done before
                    // it would read more than 0%.
                    <Badge variant="info">{`Removing…${r.progress?.phase === 'removing' && r.progress.pct > 0 ? ` ${r.progress.pct}%` : ''}`}</Badge>
                  ) : r.status === 'pending' && !r.stoppedPartWay ? (
                    <Badge variant="neutral">Did not finish — nothing was removed</Badge>
                  ) : (
                    <>
                    {r.undoStopped ? (
                      // An undo that began and stopped: what it put back so far stays, and this finishes
                      // it (round 6 — the row read as if it had never been undone).
                      <Badge variant="danger">Undo stopped part-way</Badge>
                    ) : (
                      r.stoppedPartWay && <Badge variant="danger">Stopped part-way</Badge>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={unknockRevert.isPending}
                      onClick={() => { setError(null); unknockRevert.mutate({ campaignId, runId: r.id }); }}
                    >
                      {/* Only the row pressed reads Undoing… (2026-10-21: every row did). */}
                      {unknockRevert.isPending && unknockRevert.variables?.runId === r.id ? 'Undoing…' : r.undoStopped ? 'Retry undo' : 'Undo'}
                    </Button>
                    </>
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
                    <Button variant="secondary" size="sm" disabled={revert.isPending} onClick={() => { setError(null); revert.mutate({ campaignId, runId: r.id }); }}>
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
                  onClick={() => { setError(null); unknockDryRun.mutate({ campaignId, body: selectionBody() }); }}
                >
                  {unknockDryRun.isPending ? 'Checking…' : 'Unknock…'}
                </Button>
              </div>
            ) : (
            <div className="ml-auto flex items-center gap-2">
              {/* Edit answers… first, quiet and fenced off: it changes ANSWERS on surveys that stay
                  surveyed, where everything after the divider changes or removes the entry itself. */}
              {selectionHasSurveyed && isSurveyCampaign && (
                <>
                  <Button
                    variant="secondary"
                    disabled={editOpen.isPending}
                    title="Change, clear or take out answers on these surveys — the knocks and the Surveyed status stay"
                    onClick={() => { setError(null); openEdit(); }}
                  >
                    {editOpen.isPending ? 'Loading…' : 'Edit answers…'}
                  </Button>
                  <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                </>
              )}
              <span className="text-sm text-fg-muted">Change to</span>
              <Select value={target} onChange={(e) => setTarget(e.target.value)} className="w-44">
                {OUTCOMES.filter((o) => isOutcomeEnabled(current, o, optInAvailable)).map((o) => (
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
                    onClick={() => { setError(null); loadTemplate.mutate({ campaignId, body: selectionBody() }); }}
                  >
                    {loadTemplate.isPending ? 'Loading survey…' : 'Enter answers'}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={startQueue.isPending}
                    onClick={() => { setError(null); startQueue.mutate({ campaignId, body: convBody({ mode: 'queue' }) }); }}
                  >
                    {startQueue.isPending ? 'Starting…' : 'Door by door'}
                  </Button>
                </>
              ) : direction === 'from_survey' ? (
                <Button
                  variant="danger"
                  disabled={convDryRun.isPending}
                  onClick={() => { setError(null); convDryRun.mutate({ campaignId, body: convBody() }); }}
                >
                  {convDryRun.isPending ? 'Checking…' : 'Review removal'}
                </Button>
              ) : (
                <Button disabled={dryRun.isPending} onClick={() => { setError(null); dryRun.mutate({ campaignId, body: body() }); }}>
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
                onClick={() => { setError(null); unknockDryRun.mutate({ campaignId, body: selectionBody() }); }}
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
              <Button variant="danger" onClick={() => unknockRun.mutate(unknockPreview.sent)} disabled={unknockRun.isPending}>
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

      {editDry && !editPreview && (
        <AnswerEditForm
          dry={editDry}
          answerFilters={answerActive ? answerFilters : []}
          form={editForm}
          setForm={setEditForm}
          mode={editMode}
          setMode={setEditMode}
          busy={editReview.isPending || editStartQueue.isPending || editOpen.isPending}
          error={editError}
          onCancel={() => { setEditDry(null); setEditError(null); }}
          onReview={() =>
            editReview.mutate({ ...editDry.sent, surveyTemplateId: editDry.template.id, plan: planFromForm(editDry.questions, editForm) })
          }
          onStart={startEditQueue}
          onChooseSurvey={(id) => reopenEdit({ surveyTemplateId: id })}
          onCheckAgain={() => reopenEdit({ keepForm: true })}
        />
      )}
      {editPreview && (
        <AnswerEditReviewModal
          preview={editPreview}
          tz={tz}
          busy={editCreate.isPending}
          onBack={() => setEditPreview(null)}
          onConfirm={confirmEdit}
        />
      )}
      {editWalk && (
        <AnswerEditWalkthrough
          campaignId={campaignId}
          run={editWalk.run}
          initial={editWalk.current}
          tz={tz}
          onFinishLater={() => { setEditWalk(null); afterEdit(); }}
          onStopped={(r) => { setEditWalk(null); followEditRun(r); afterEdit(); }}
          onClosedElsewhere={(message) => { setEditWalk(null); afterEdit(); setError(message); }}
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
                onClick={() => { setError(null); convDryRun.mutate({ campaignId, body: composedConvBody() }); }}
              >
                {convDryRun.isPending ? 'Checking…' : 'Review changes'}
              </Button>
            </>
          }
        >
          {/* The page's banner sits behind this modal: a refusal of Review changes shows here too (round 6). */}
          {error && <div className="mb-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{error}</div>}
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
          onConfirm={() => convRun.mutate({ ...preview.sent, mode: 'bulk' })}
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
          onConfirm={() => convRun.mutate({ ...preview.sent, mode: 'bulk' })}
        />
      )}

      {/* Door-by-door desk entry. */}
      {walking && (
        <QueueWalkthrough
          campaignId={campaignId}
          run={walking}
          template={queueTemplate}
          onDone={() => { setWalking(null); setQueueTemplate(null); watchConvRun(walking.id); afterWrite(); }}
          onCancel={() => { setWalking(null); setQueueTemplate(null); watchConvRun(walking.id); afterWrite(); }}
          onClosedElsewhere={(message) => { setWalking(null); setQueueTemplate(null); watchConvRun(walking.id); afterWrite(); setError(message); }}
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
              <Button variant={preview.rateNeutral ? 'primary' : 'danger'} onClick={() => run.mutate(preview.sent)} disabled={run.isPending}>
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
