import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Modal, Select } from '../ui/index.js';
import { ErrorBanner, errorText } from './parts.jsx';
import { formatPeriod, periodDays, todayIn, daysBetween } from './reportDates.js';
import { allTimeChoice, dateChoices, dayLabel, duplicateText, periodLabel, totalsSentence, weekName, weekNudge } from './newReportChoices.js';
import { seriesKey } from './hooks.js';
import { quotedNames } from './TeamDialog.jsx';
import { periodPhrase } from '../../lib/reportDerive.js';
import { walkListLabel, walkListOptions } from '../../lib/walkListOptions.js';

// New report (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G2, §F4, §F10). Covers the whole campaign or a
// team (one or more crews under a name the client reads), optionally only one walk list. Creating
// claims the first build at once, so the builder opens on "Building the first numbers…".
//
// The dates (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §C) are a radio list with dates: what comes after
// the tab's last report in the organization's report week — or, with no report yet, Last week (This
// week for a campaign whose first doors were knocked this week) — then Last week, This week, not over
// yet, and Pick dates (newReportChoices.js words each one). Under them, the organization's week: an
// admin can Change it (PATCH /admin/client-reports/settings, contract K2), a lead reads who sets it. A
// tab whose weeks run on another weekday gets the nudge: Move this tab (its catch-up first), or, for an
// admin, use the tab's weeks for the whole organization. Opened with dates (`initial.dates` — Next
// report's NEXT_GAP_TOO_LONG, the ?new=1 link of contract K10, Continue) it selects the choice with those
// dates, else Pick dates with them; Next's refusal also hands over its sentence (`initial.notice`), shown
// at the top of the dates. Above the choices, one line says what the dates decide (SIMPLIFY §M): the
// totals run from the campaign's first door through the last day picked, for the tab named, and the first
// day only decides what shows as new — the "up to a date" a report already is.
//
// The dates come from the series picker read AGAIN each time the dialog opens (code review WEEK-1): its
// today, the organization's week and whether doors were knocked before this week. The page's copy can
// be a day old (a page left open over midnight) or from before another admin changed the week, and the
// dates would then disagree with Next report's. Until that answer is here the dates wait; while the
// dialog stays open past the campaign's midnight they are read again.
//
// Refusals it answers in place:
//   · WALK_LIST_LABEL_HAS_NAME — a walk list's name matches a canvasser's: "Name your client sees",
//     prefilled, and "This is a place, not a person" (resent with confirmLabel);
//   · TEAM_ATTRIBUTION_NOT_READY — "A team" can't be used yet, and says why;
//   · SERIES_ENDED — the team has ended: Continue it, or pick another. An ended team picked up front
//     (New report from its tab) says the same before Create, never "No team yet" (ADMINUX-10).
//     Continue hands over to the team picker (`onContinueTeam` — Continue re-validates the crews,
//     §O4), which hands back here with the team, the dates and the title as they were;
//   · REPORT_EXISTS (SIMPLIFY §E) — the tab already has a report for these dates: Open the draft (or
//     Open it), or Make a second one (the request Create sent, again, with allowDuplicate — the dates
//     stay as they were while the prompt names them). An archived one says "— it’s archived." and adds
//     Unarchive, which brings it back into the list right here (docs/PROPOSAL_CLIENT_REPORT_LINKS.md
//     Part 1 §4); the note under Make a second one says each report gets its own link (Part 1 §6);
//   · `existing: true` on a 200 — two people pressed Create at once and the database let one draft in:
//     "<name> made the <tab> report for <dates> a moment ago — you're both in it.", with Open it; the
//     form stays as it was when Create was pressed (code review WEEK-2 — the list gains the draft, and
//     the dates worked out again would jump to the next period). When the draft that got in is this
//     person's own (`userId`, a press in another tab), it simply opens.

const box = 'h-4 w-4 accent-brand-accent disabled:cursor-not-allowed disabled:opacity-40';
const crewName = (name) => `${name || 'Unknown user'}’s crew`;
// The weekday select, Monday first (0 Sunday … 6 Saturday).
const WEEK_STARTS = [1, 2, 3, 4, 5, 6, 0];
const sameDates = (a, b) => !!a && !!b && a.weekStart === b.weekStart && a.weekEnd === b.weekEnd;
// The tab's last report, which the first choice follows: the newest end; of two that end the same day,
// the one made last (createdAt — on a row without it, the time inside its id), then the higher id. The
// read-only count `npm run report:tab-weeks` orders the same way, so both name one report.
const madeAt = (r) => (r.createdAt ? Date.parse(r.createdAt) : parseInt(String(r.id || '').slice(0, 8), 16) * 1000) || 0;
const byId = (a, b) => (String(a.id) < String(b.id) ? 1 : String(a.id) > String(b.id) ? -1 : 0);
const newestFirst = (a, b) => (a.weekEnd < b.weekEnd ? 1 : a.weekEnd > b.weekEnd ? -1 : 0) || madeAt(b) - madeAt(a) || byId(a, b);

// The series a scope belongs to, among GET /series rows, or null when it doesn't exist yet.
const seriesForScope = (series, { teamId, effortId }) => {
  if (teamId && effortId) return series.find((s) => s.kind === 'team_walk_list' && s.teamSeriesId === teamId && s.effortId === effortId) || null;
  if (teamId) return series.find((s) => s.id === teamId) || null;
  if (effortId) return series.find((s) => s.kind === 'walk_list' && s.effortId === effortId && !s.ended) || null;
  return series.find((s) => s.kind === 'campaign' && !s.ended) || null;
};

const NewReportDialog = ({
  campaignId,
  campaignTz,
  reports = [],
  seriesData,
  efforts = [],
  initial = {},
  isAdmin = false,
  userId = null,
  onClose,
  onCreated,
  onOpenReport,
  onReportsChanged,
  onWeekChanged,
  onNewTeam,
  onContinueTeam,
}) => {
  // The series picker, read again now (WEEK-1, above). An answer counts once it arrived after the dialog
  // opened; it lands in the page's own cache entry (seriesKey), so the page's tabs follow it too.
  const [openedAt] = useState(() => Date.now());
  const pickerQ = useQuery({
    queryKey: seriesKey(campaignId),
    queryFn: () => api(`/admin/client-reports/series?campaignId=${campaignId}`),
    enabled: !!campaignId,
    refetchOnMount: 'always',
  });
  const fresh = pickerQ.data && pickerQ.dataUpdatedAt >= openedAt ? pickerQ.data : null;
  const pickerFailed = !fresh && pickerQ.isError && pickerQ.errorUpdatedAt >= openedAt;
  const picker = fresh || seriesData;
  const series = picker?.series || [];
  const teamsReady = picker?.teamsReady !== false;
  const teams = series.filter((s) => s.kind === 'team' && !s.ended);
  const [covers, setCovers] = useState(initial.teamId && teamsReady ? 'team' : 'campaign');
  const [teamPick, setTeamId] = useState(initial.teamId || '');
  const [oneWalkList, setOneWalkList] = useState(!!initial.effortId);
  const [effortPick, setEffortId] = useState(initial.effortId || '');
  // The team and the walk list picked — else the first of each, from the lists as they are NOW: both can
  // arrive or change after the dialog opened (the walk lists load beside it, the picker is read again),
  // and a pick fixed at open would leave a select showing one the request doesn't send. The first walk
  // list is the first open one (walkListOptions lists archived ones last), or the first if all are.
  const teamId = teamPick || teams[0]?.id || '';
  const effortId = effortPick || walkListOptions(efforts)[0]?._id || '';
  const [title, setTitle] = useState(initial.title || '');
  // The picked date choice ('first' | 'last' | 'this' | 'move' | 'pick'); null until the operator picks
  // one — then `initial.dates` decide (below). Pick dates' two days, kept across Continue.
  const [choice, setChoice] = useState(initial.choice || null);
  const [pick, setPick] = useState(initial.dates || null);
  // Pick dates' first day half typed: a date input reads '' then, as when it is empty, and empty means all
  // time (§N) — so a half-typed day holds Create instead of quietly making an all-time report (code review).
  // React fires onChange only when the value changes, and typing into an EMPTY date input leaves it '' until
  // the day is whole: so the box is read on every key and on blur too, and once more as Create is pressed.
  const [firstDayHalf, setFirstDayHalf] = useState(false);
  const firstDayRef = useRef(null);
  const readFirstDay = (e) => setFirstDayHalf(!!e.currentTarget?.validity?.badInput);
  const [moveAsked, setMoveAsked] = useState(false); // Move this tab was pressed
  const [weekStartsOn, setWeekStartsOn] = useState(null); // the organization's week, once changed here
  const [weekEdit, setWeekEdit] = useState(null); // the weekday Change is showing, while it is open
  const [labelPrompt, setLabelPrompt] = useState(null); // { names, label, combined }
  const [clientLabel, setClientLabel] = useState('');
  const [placeConfirmed, setPlaceConfirmed] = useState(false);
  const [ended, setEnded] = useState(null); // { seriesId }
  const [duplicate, setDuplicate] = useState(null); // REPORT_EXISTS: { reportId, status, takenDown, weekStart, weekEnd, scopeLabel, facts }
  const [joined, setJoined] = useState(null); // a 200 existing: { report, createdByName, facts }
  const [error, setError] = useState(null);
  const pressedFacts = useRef(null); // the dates' facts when Create was last pressed (WEEK-2)
  const pressedBody = useRef(null); // the request Create last sent: Make a second one sends it again (VER-1)
  // The boxes Create's answer puts up (code review round 2, FRESH-1): the walk list's name, an ended team,
  // the duplicate prompt, the race note, a refusal in words.
  const labelBoxRef = useRef(null);
  const endedBoxRef = useRef(null);
  const duplicateBoxRef = useRef(null);
  const joinedBoxRef = useRef(null);
  const errorBoxRef = useRef(null);
  // Keyboard focus never drops to <body> when what it was on goes (code review WEEK-4, FRESH-1): the
  // weekday select takes it when Change opens the panel; Change gets it back when the panel closes (Save,
  // Cancel) or the nudge sets the organization's week; a box Create's answer puts up is scrolled into
  // view and its first control takes it. A new object each time; focus only, nothing to stop.
  const [focusTo, setFocusTo] = useState(null); // { at: 'select' | 'change' | 'label' | 'ended' | 'duplicate' | 'joined' | 'error' }
  const changeRef = useRef(null);
  const weekPanelRef = useRef(null);
  useEffect(() => {
    if (!focusTo) return;
    const box = { label: labelBoxRef, ended: endedBoxRef, duplicate: duplicateBoxRef, joined: joinedBoxRef, error: errorBoxRef }[focusTo.at]?.current;
    if (box) {
      box.scrollIntoView?.({ block: 'nearest' });
      // The race note has no control of its own: Open it, in the footer, takes the focus as it appears.
      const first = box.querySelector('button:not([disabled]), input:not([disabled])') || (box.hasAttribute('tabindex') ? box : null);
      first?.focus({ preventScroll: true });
      return;
    }
    const el = focusTo.at === 'select' ? weekPanelRef.current?.querySelector('select') : focusTo.at === 'change' ? changeRef.current : null;
    el?.focus();
  }, [focusTo]);

  const scope = { teamId: covers === 'team' ? teamId : null, effortId: oneWalkList ? effortId : null };
  const scopeSeries = seriesForScope(series, scope);
  const team = covers === 'team' ? teams.find((t) => t.id === teamId) || null : null;
  // An ended team picked up front (New report from its tab) — or named by SERIES_ENDED — gets the
  // Continue box, never "No team yet" with Create held and no reason (ADMINUX-10).
  const pickedEnded = covers === 'team' && !team ? series.find((s) => s.kind === 'team' && s.ended && s.id === teamId) || null : null;
  const endedId = ended?.seriesId || pickedEnded?.id || null;
  const endedSeries = endedId ? series.find((s) => s.id === endedId) || null : null;
  // The campaign zone's civil today and the organization's report week, from the series picker read as
  // the dialog opened (contract K3); an older answer without them reads as today here and Monday –
  // Sunday. Until that answer is here they only fill choices nobody sees (`datesReady`).
  const datesReady = !!fresh;
  const today = fresh?.today || todayIn(campaignTz);
  const s = weekStartsOn ?? fresh?.weekStartsOn ?? 1;
  const knockedBeforeThisWeek = fresh?.knockedBeforeThisWeek !== false;

  // Still open when the campaign's day ends: read the dates again (checked once a minute; the timer
  // goes with the dialog).
  const answeredToday = fresh?.today || null;
  const refetchPicker = pickerQ.refetch;
  useEffect(() => {
    if (!answeredToday) return undefined;
    const timer = setInterval(() => {
      if (todayIn(campaignTz) > answeredToday) refetchPicker();
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, [answeredToday, campaignTz, refetchPicker]);

  // The tab's last DATED report: an all-time one (Latest progress, SIMPLIFY §N) runs on no weekday rhythm,
  // so it never decides what comes next, nor the week nudge.
  const lastReport = useMemo(() => {
    if (!scopeSeries) return null;
    return reports.filter((r) => r.seriesId === scopeSeries.id && !r.allTime).sort(newestFirst)[0] || null;
  }, [reports, scopeSeries]);
  const last = lastReport ? { weekStart: lastReport.weekStart, weekEnd: lastReport.weekEnd } : null;
  // While the race note or the duplicate prompt names the dates, they stay as they were when Create was
  // pressed (WEEK-2): the list can gain that report meanwhile, and the choices would move past it.
  const facts = joined?.facts || duplicate?.facts || { last, s, today, knockedBeforeThisWeek };
  const dated = dateChoices(facts).choices;
  const nudge = weekNudge(facts);
  // Move this tab: its catch-up joins the list after the first choice — or, when it is a choice already
  // (last week, after a long gap), that one, naming the days no report covers.
  const moveTarget = nudge ? dated.find((c) => sameDates(c, nudge.move)) || null : null;
  const datedChoices =
    moveAsked && nudge
      ? moveTarget
        ? dated.map((c) => (c === moveTarget ? { ...c, skipped: c.skipped || nudge.move.skipped } : c))
        : [dated[0], nudge.move, ...dated.slice(1)]
      : dated;
  // Latest progress (§N) comes second whatever comes first — after Move this tab's catch-up when that was
  // added — and is never the one picked on opening.
  const lead = moveAsked && nudge && !moveTarget ? 2 : 1;
  const choices = [...datedChoices.slice(0, lead), allTimeChoice(facts.today), ...datedChoices.slice(lead)];
  const wanted = choice ?? (initial.dates ? choices.find((c) => sameDates(c, initial.dates))?.key || 'pick' : 'first');
  const current = wanted === 'pick' || choices.some((c) => c.key === wanted) ? wanted : 'first';
  const chosen = current === 'pick' ? null : choices.find((c) => c.key === current);
  const pickDates = pick || { weekStart: choices[0].weekStart, weekEnd: choices[0].weekEnd };
  const period = chosen ? { weekStart: chosen.weekStart, weekEnd: chosen.weekEnd } : pickDates;
  // All time (§N): Latest progress, or Pick dates with no first day — everything up to the last day. The
  // server sets where it starts (the campaign's first knock), so only the last day goes with it.
  const allTime = chosen ? !!chosen.allTime : !pickDates.weekStart && !firstDayHalf;
  const days = allTime ? null : periodDays(period.weekStart, period.weekEnd);
  const badRange = !period.weekEnd || (!allTime && (!period.weekStart || daysBetween(period.weekStart, period.weekEnd) < 0));
  // The picked dates' own note, shown under the choice it is about (code review WEEK-3): dates that start
  // after today stay empty until then (the builder says so too, ?ahead=1); dates that run past today
  // aren't over (This week's own label already says so, and Latest progress's says "through today").
  const periodNote = badRange
    ? null
    : !allTime && daysBetween(facts.today, period.weekStart) > 0
      ? `Starts ${dayLabel(period.weekStart, facts.today)} — its numbers stay empty until then.`
      : chosen?.kind !== 'this_week' && chosen?.kind !== 'all_time' && daysBetween(facts.today, period.weekEnd) >= 0
        ? 'This period isn’t over yet — you can build it now and refresh it later.'
        : null;
  const scopeTeam = team || pickedEnded;
  // The tab's own name, as its tab reads ("Whole campaign", "Paid team").
  const scopeLabel = scopeSeries?.label || (scopeTeam ? `${scopeTeam.label}${oneWalkList ? ` · ${efforts.find((e) => String(e._id) === String(effortId))?.name || 'walk list'}` : ''}` : oneWalkList ? efforts.find((e) => String(e._id) === String(effortId))?.name || 'Walk list' : 'Whole campaign');
  // What the dates decide (SIMPLIFY §M): the totals run from the campaign's first door through the last day
  // picked, for what the report covers, named once its team or walk list is picked.
  const wholeCampaign = covers === 'campaign' && !oneWalkList;
  const coversPicked = covers === 'team' ? !!scopeTeam && (!oneWalkList || !!effortId) : !!effortId;
  const totalsLine = totalsSentence({
    wholeCampaign,
    label: !wholeCampaign && coversPicked ? scopeLabel : '',
    phrase: periodPhrase(period.weekStart, period.weekEnd).phrase,
    allTime,
    through: chosen?.kind === 'all_time' ? 'today' : period.weekEnd ? dayLabel(period.weekEnd, facts.today) : null,
  });

  const create = useMutation({
    // The request is the one worked out when Create was pressed (submit, below) — never re-read from a
    // later screen, whose dates may have moved on by the time it is sent.
    mutationFn: (body) => api('/admin/client-reports', { method: 'POST', body }),
    onSuccess: (res) => {
      // Two Creates of these dates at once: the database let one draft in (§E) — this one lost, and the
      // answer is the one that won. Made by someone else: say so here (the list gains it now). Made by
      // this same person a moment ago (a second tab, a double click): it is theirs — just open it.
      if (res?.existing) {
        if (userId && String(res.report?.createdBy || '') === String(userId)) {
          onCreated(res);
          return;
        }
        // The dates stay as they were when Create was pressed: the list gains the draft that won, and
        // the choices worked out from it would jump to the period after it (WEEK-2).
        setJoined({ report: res.report, createdByName: res.createdByName || null, facts: pressedFacts.current || facts });
        setFocusTo({ at: 'joined' });
        onReportsChanged?.();
        return;
      }
      onCreated(res);
    },
    // Each answer's box is brought into view with its first control focused (FRESH-1).
    onError: (e, body) => {
      setError(e);
      if (e.code === 'WALK_LIST_LABEL_HAS_NAME') {
        setLabelPrompt({ names: e.data?.names || [], label: e.data?.label || '', combined: !!body?.teamSeriesId });
        setClientLabel(e.data?.label || '');
        setPlaceConfirmed(false);
        setFocusTo({ at: 'label' });
      } else if (e.code === 'SERIES_ENDED') {
        setEnded({ seriesId: e.data?.seriesId || body?.teamSeriesId });
        setFocusTo({ at: 'ended' });
      } else if (e.code === 'REPORT_EXISTS') {
        setDuplicate({ ...(e.data || {}), facts: pressedFacts.current });
        setFocusTo({ at: 'duplicate' });
      } else {
        setFocusTo({ at: 'error' });
      }
    },
  });
  // The organization's report week (K2: admins only). A new week re-suggests the dates.
  const weekM = useMutation({
    mutationFn: (weekStart) => api('/admin/client-reports/settings', { method: 'PATCH', body: { weekStartsOn: weekStart } }),
    onSuccess: (res, weekStart) => {
      const next = Number.isInteger(res?.weekStartsOn) ? res.weekStartsOn : weekStart;
      setWeekStartsOn(next);
      setWeekEdit(null);
      setMoveAsked(false);
      if (current !== 'pick') setChoice('first');
      // The panel's Save, or the nudge's button, is gone now: Change takes the focus (WEEK-4).
      setFocusTo({ at: 'change' });
      onWeekChanged?.(next);
    },
  });
  // Unarchive, from the duplicate prompt (docs/PROPOSAL_CLIENT_REPORT_LINKS.md Part 1 §4): the report that
  // holds these dates comes back into its tab's list, and the prompt then reads as it does for any report
  // of these dates — Unarchive gone, so the keyboard goes back to the prompt's first button.
  const unarchive = useMutation({
    mutationFn: (reportId) => api(`/admin/client-reports/${reportId}/unarchive`, { method: 'POST' }),
    onSuccess: (_res, reportId) => {
      setDuplicate((d) => (d && d.reportId === reportId ? { ...d, archivedAt: null } : d));
      setFocusTo({ at: 'duplicate' });
      onReportsChanged?.();
    },
  });
  // Continue goes through the team picker (TeamDialog's continue mode), which re-validates the crews
  // the way Change crews does and answers each refusal there; this dialog reopens on the team after.
  const canContinue = !!onContinueTeam && endedSeries?.kind === 'team';

  const submit = (more = {}) => {
    setError(null);
    setDuplicate(null);
    if (badRange || !datesReady) return;
    if (current === 'pick' && firstDayRef.current?.validity?.badInput) {
      setFirstDayHalf(true);
      return;
    }
    const extra = { ...more };
    if (labelPrompt) {
      if (!labelPrompt.combined && clientLabel.trim() && clientLabel.trim() !== labelPrompt.label) extra.seriesLabel = clientLabel.trim();
      if (placeConfirmed) extra.confirmLabel = true;
    }
    pressedFacts.current = facts;
    pressedBody.current = {
      campaignId,
      // An all-time report sends only its last day; the server sets where it starts (§N).
      ...(allTime ? { allTime: true } : { weekStart: period.weekStart }),
      weekEnd: period.weekEnd,
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(scope.teamId ? { teamSeriesId: scope.teamId } : {}),
      ...(scope.effortId ? { effortId: String(scope.effortId) } : {}),
      ...extra,
    };
    create.mutate(pressedBody.current);
  };
  // Make a second one: the request the duplicate prompt answered, sent again with allowDuplicate — never
  // the form as it stands now, which may have moved on (code review round 2, VER-1).
  const makeSecond = () => {
    if (!pressedBody.current) return;
    setError(null);
    setDuplicate(null);
    create.mutate({ ...pressedBody.current, allowDuplicate: true });
  };
  const resetPrompts = () => {
    setLabelPrompt(null);
    setEnded(null);
    setDuplicate(null);
    setError(null);
  };
  // Typing a title or your own dates after "you already have this report" takes the prompt away, as picking
  // another date choice does: Make a second one resends what was pressed, so an edit made under the prompt
  // would otherwise be dropped without a word. Create then asks again with what's on screen.
  const editAfterPrompt = (apply) => {
    if (duplicate) setDuplicate(null);
    apply();
  };
  // A new scope (or week) suggests its own dates: back to the first choice.
  const resetDates = () => {
    setChoice('first');
    setPick(null);
    setFirstDayHalf(false);
    setMoveAsked(false);
  };
  // Pick dates starts from the dates picked a moment ago.
  const pickChoice = (key) => {
    if (key === 'pick' && !pick) setPick(period);
    setFirstDayHalf(false);
    setChoice(key);
    resetPrompts();
  };
  const moveTab = () => {
    setMoveAsked(true);
    setChoice(moveTarget ? moveTarget.key : 'move');
    resetPrompts();
  };
  const busy = create.isPending;

  return (
    <Modal
      size="lg"
      title="New report"
      onClose={busy ? undefined : onClose}
      closable={!busy}
      footer={
        joined ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            {/* Create draft has gone: the keyboard lands on what can be done now (FRESH-1). */}
            <Button autoFocus onClick={() => onOpenReport(String(joined.report?._id || joined.report?.id || ''))}>
              Open it
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              disabled={!datesReady || badRange || (covers === 'team' && !team) || (oneWalkList && !effortId) || !!endedId || !!duplicate}
              onClick={() => submit()}
            >
              Create draft
            </Button>
          </>
        )
      }
    >
      {/* While Create is on its way, and after the race note, the form stays as it was, and still (WEEK-2,
          code review round 2 VER-1): what it answers is about the dates and tab pressed. */}
      <fieldset disabled={!!joined || busy} className="min-w-0 space-y-5 text-sm">
        <fieldset>
          <legend className="text-xs font-medium text-fg-muted">Covers</legend>
          <label className="mt-1.5 flex items-center gap-2 text-fg">
            <input type="radio" className={box} checked={covers === 'campaign'} onChange={() => { setCovers('campaign'); resetDates(); resetPrompts(); }} />
            Whole campaign
          </label>
          <div className="mt-1.5">
            <label className={`flex flex-wrap items-center gap-2 ${teamsReady ? 'text-fg' : 'text-fg-subtle'}`}>
              <input type="radio" className={box} disabled={!teamsReady} checked={covers === 'team'} onChange={() => { setCovers('team'); resetDates(); resetPrompts(); }} />
              A team
              {teamsReady && covers === 'team' && (teams.length > 0 || pickedEnded) && (
                <Select value={teamId} onChange={(e) => { setTeamId(e.target.value); resetDates(); resetPrompts(); }} className="py-1 text-sm">
                  {pickedEnded && <option value={pickedEnded.id}>{pickedEnded.label} (ended)</option>}
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              )}
              {teamsReady && (
                <button type="button" className="text-xs font-semibold text-brand-accent hover:underline disabled:cursor-not-allowed disabled:opacity-40" onClick={onNewTeam}>
                  + New team
                </button>
              )}
            </label>
            {!teamsReady && (
              <p className="ml-6 mt-0.5 text-xs text-fg-muted">Team reports need team attribution, which this organization doesn’t have yet.</p>
            )}
            {teamsReady && covers === 'team' && !teams.length && !pickedEnded && <p className="ml-6 mt-0.5 text-xs text-fg-muted">No team yet — make one with New team.</p>}
            {team && (
              <p className="ml-6 mt-0.5 text-xs text-fg-muted">
                Crews: {[...(team.coordinators || []).map((c) => crewName(c.name)), ...(team.pastCoordinators || []).map((c) => `${crewName(c.name)} (past doors)`)].join(', ') || 'none'}
                . A home both teams visited counts in each team’s report.
              </p>
            )}
          </div>
          <div className="mt-2">
            <label className={`flex flex-wrap items-center gap-2 ${efforts.length ? 'text-fg' : 'text-fg-subtle'}`}>
              <input type="checkbox" className={box} disabled={!efforts.length} checked={oneWalkList} onChange={(e) => { setOneWalkList(e.target.checked); resetDates(); resetPrompts(); }} />
              Only one walk list
              {oneWalkList && (
                <Select value={effortId} onChange={(e) => { setEffortId(e.target.value); resetDates(); resetPrompts(); }} className="py-1 text-sm">
                  {walkListOptions(efforts).map((ef) => (
                    <option key={ef._id} value={ef._id}>
                      {walkListLabel(ef)}
                    </option>
                  ))}
                </Select>
              )}
            </label>
            {oneWalkList && <p className="ml-6 mt-0.5 text-xs text-fg-muted">The walk list’s name appears on your client’s report.</p>}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-xs font-medium text-fg-muted">Dates</legend>
          {/* Opened by Next report's NEXT_GAP_TOO_LONG: the server's own sentence says why (FRESH-3). */}
          {initial.notice && <p className="mt-1.5 rounded-md border border-info/30 bg-info-tint px-3 py-2 text-xs text-info-fg">{initial.notice}</p>}
          {/* The dates wait for the series picker read as the dialog opened (WEEK-1) — never a stale guess. */}
          {!datesReady &&
            (pickerFailed ? (
              <div className="mt-1.5 space-y-2">
                <ErrorBanner title="Couldn’t load the dates." error={pickerQ.error} />
                <Button size="sm" variant="secondary" onClick={() => pickerQ.refetch()}>
                  Try again
                </Button>
              </div>
            ) : (
              <p className="mt-1.5 text-fg-muted" role="status">
                Loading the dates…
              </p>
            ))}
          {datesReady && (
            <>
              <p className="mt-1.5 text-xs text-fg-muted">{totalsLine}</p>
              {choices.map((c) => (
                <div key={c.key} className="mt-1.5">
                  <label className="flex items-start gap-2 text-fg">
                    <input type="radio" name="report-dates" className={`mt-0.5 shrink-0 ${box}`} checked={current === c.key} onChange={() => pickChoice(c.key)} />
                    <span>
                      {c.head}
                      {c.tail && <span className="text-fg-muted"> {c.tail}</span>}
                    </span>
                  </label>
                  {c.skipped && <p className="ml-6 mt-0.5 text-xs text-warning-fg">No report covers {periodLabel(c.skipped.start, c.skipped.end, facts.today)}.</p>}
                  {current === c.key && periodNote && <p className="ml-6 mt-0.5 text-xs text-fg-muted">{periodNote}</p>}
                </div>
              ))}
              <div className="mt-1.5">
                <label className="flex items-start gap-2 text-fg">
                  <input type="radio" name="report-dates" className={`mt-0.5 shrink-0 ${box}`} checked={current === 'pick'} onChange={() => pickChoice('pick')} />
                  Pick dates
                </label>
                {current === 'pick' && (
                  <div className="ml-6 mt-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        aria-label="First day (optional)"
                        ref={firstDayRef}
                        onKeyUp={readFirstDay}
                        onBlur={readFirstDay}
                        value={period.weekStart || ''}
                        onChange={(e) =>
                          editAfterPrompt(() => {
                            setPick({ ...period, weekStart: e.target.value });
                            setFirstDayHalf(!!e.target.validity?.badInput);
                          })
                        }
                        className="rounded-lg border border-border-strong bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <span className="text-fg-muted">–</span>
                      <input
                        type="date"
                        aria-label="Last day"
                        value={period.weekEnd}
                        onChange={(e) => editAfterPrompt(() => setPick({ ...period, weekEnd: e.target.value }))}
                        className="rounded-lg border border-border-strong bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      {!badRange && <span className="text-xs text-fg-muted">{allTime ? 'All time' : `${days} ${days === 1 ? 'day' : 'days'}`}</span>}
                    </div>
                    {badRange && (
                      <p className="mt-1 text-xs text-danger-fg">
                        {firstDayHalf
                          ? 'Finish the first day, or clear it to count everything up to the last day.'
                          : period.weekEnd
                            ? 'The first day must be on or before the last day.'
                            : 'Pick a last day.'}
                      </p>
                    )}
                    {/* §N: no first day = all time, everything up to the last day. */}
                    <p className="mt-1 text-xs text-fg-muted">Leave the first day empty to count everything up to the last day.</p>
                    {periodNote && <p className="mt-1 text-xs text-fg-muted">{periodNote}</p>}
                  </div>
                )}
              </div>

              {nudge && (
                <div className="mt-3 rounded-md border border-warning/30 bg-warning-tint px-3 py-2.5 text-xs text-warning-fg">
                  <p>
                    Your last {scopeLabel} report ran {nudge.tabWeek}. Your organization’s report weeks run {nudge.orgWeek}.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" disabled={weekM.isPending} onClick={moveTab}>
                      Move this tab to {nudge.orgWeek} weeks
                    </Button>
                    {isAdmin && (
                      <Button size="sm" variant="secondary" loading={weekM.isPending && weekM.variables === nudge.tabDay} onClick={() => weekM.mutate(nudge.tabDay)}>
                        Use {nudge.tabWeek} weeks for the whole organization
                      </Button>
                    )}
                  </div>
                  {!isAdmin && <p className="mt-2">Ask an admin to change the organization’s week, or pick dates.</p>}
                </div>
              )}

              {isAdmin && weekEdit != null ? (
                <div ref={weekPanelRef} className="mt-3 space-y-2 rounded-md border border-border bg-sunken/60 p-3 text-xs text-fg-muted">
                  <label className="flex flex-wrap items-center gap-2">
                    Report weeks run
                    <Select value={weekEdit} onChange={(e) => setWeekEdit(Number(e.target.value))} className="py-1 text-sm" aria-label="Report weeks run">
                      {WEEK_STARTS.map((d) => (
                        <option key={d} value={d}>
                          {weekName(d)}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <p>This sets the dates new reports suggest, for every campaign in your organization. Reports you’ve already made keep their dates.</p>
                  <div className="flex gap-2">
                    <Button size="sm" loading={weekM.isPending} onClick={() => weekM.mutate(weekEdit)}>
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={weekM.isPending}
                      onClick={() => {
                        setWeekEdit(null);
                        setFocusTo({ at: 'change' });
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-fg-muted">
                  Report weeks run {weekName(s)} for your organization
                  {isAdmin ? (
                    <>
                      .{' '}
                      <button
                        ref={changeRef}
                        type="button"
                        className="font-semibold text-brand-accent hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => {
                          setWeekEdit(s);
                          setFocusTo({ at: 'select' });
                        }}
                      >
                        Change
                      </button>
                    </>
                  ) : (
                    ' (set by an admin).'
                  )}
                </p>
              )}
            </>
          )}
          {weekM.error && (
            <div className="mt-2">
              <ErrorBanner title="Couldn’t change the report week." error={weekM.error} />
            </div>
          )}
        </fieldset>

        {/* What Create answered sits right under the dates it is about — scrolled into view, its first
            button focused (code review FRESH-1): under Title it opened out of sight, and focus fell to
            <body> as Create draft went pale. */}
        {labelPrompt && (
          <div ref={labelBoxRef} role="alert" className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2.5 text-xs text-warning-fg">
            <p>
              The walk list’s name matches a canvasser on this campaign
              {labelPrompt.names.length ? ` (${quotedNames(labelPrompt.names)})` : ''}. Your client reads this name.
            </p>
            {!labelPrompt.combined && (
              <label className="mt-2 block">
                <span className="font-medium">Name your client sees</span>
                <input
                  value={clientLabel}
                  onChange={(e) => setClientLabel(e.target.value)}
                  maxLength={60}
                  className="mt-1 w-full rounded-lg border border-border-strong bg-card px-3 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none"
                />
              </label>
            )}
            <label className="mt-2 flex items-center gap-2 font-medium">
              <input type="checkbox" className={box} checked={placeConfirmed} onChange={(e) => setPlaceConfirmed(e.target.checked)} />
              This is a place, not a person
            </label>
          </div>
        )}
        {endedId && (
          <div ref={endedBoxRef} role="alert" className="rounded-md border border-info/30 bg-info-tint px-3 py-2.5 text-xs text-info-fg">
            <p>
              {endedSeries?.label ? `“${endedSeries.label}”` : 'That team'} has ended. Continue it to start a new report
              {teams.some((t) => t.id !== endedId) ? ', or pick another team' : ''}.
            </p>
            {canContinue && (
              // The dates go along as they were: the picked choice, or Pick dates' days.
              <Button size="sm" className="mt-2" onClick={() => onContinueTeam(endedId, { title, choice: current === 'pick' ? null : current, dates: current === 'pick' ? period : null })}>
                Continue the team
              </Button>
            )}
          </div>
        )}
        {duplicate && (
          <div ref={duplicateBoxRef} role="alert" className="rounded-md border border-info/30 bg-info-tint px-3 py-2.5 text-xs text-info-fg">
            <p>{duplicateText(duplicate, { today, scopeLabel })}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" disabled={!duplicate.reportId} onClick={() => onOpenReport(duplicate.reportId)}>
                {duplicate.status === 'draft' ? 'Open the draft' : 'Open it'}
              </Button>
              {duplicate.archivedAt && (
                <Button size="sm" variant="secondary" disabled={!duplicate.reportId} loading={unarchive.isPending} onClick={() => unarchive.mutate(duplicate.reportId)}>
                  Unarchive
                </Button>
              )}
              <Button size="sm" variant="secondary" disabled={unarchive.isPending} onClick={makeSecond}>
                Make a second one
              </Button>
            </div>
            {unarchive.error && unarchive.variables === duplicate.reportId && <p className="mt-1.5 text-danger-fg">Couldn’t unarchive it. {errorText(unarchive.error)}</p>}
            {/* Each report has its own link (docs/PROPOSAL_CLIENT_REPORT_LINKS.md Part 1 §6); a taken-down
                one stays hidden until it is put back up (FRESH-5). */}
            <p className="mt-1.5">
              {duplicate.takenDown
                ? 'The taken-down one stays hidden until you put it back up. The new one gets its own link once it’s published.'
                : 'Each one gets its own link once it’s published.'}
            </p>
          </div>
        )}
        {joined && (
          // The report's own tab name, as the server answered it — not the form's.
          <div ref={joinedBoxRef} role="status" className="rounded-md border border-info/30 bg-info-tint px-3 py-2.5 text-xs text-info-fg">
            {joined.createdByName || 'Someone else'} made the {joined.report?.scope?.label || scopeLabel} report for{' '}
            {periodLabel(joined.report?.weekStart || period.weekStart, joined.report?.weekEnd || period.weekEnd, facts.today)} a moment ago — you’re both in it.
          </div>
        )}
        {error && !labelPrompt && !ended && !duplicate && !joined && (
          <div ref={errorBoxRef} tabIndex={-1} className="focus:outline-none">
            <ErrorBanner title="Couldn’t create the draft." error={error} />
          </div>
        )}

        <label className="block">
          <span className="text-xs font-medium text-fg-muted">Title (optional)</span>
          <input
            value={title}
            onChange={(e) => editAfterPrompt(() => setTitle(e.target.value))}
            maxLength={200}
            placeholder={datesReady ? (allTime ? 'All time' : formatPeriod(period.weekStart, period.weekEnd)) : ''}
            className="mt-1 w-full rounded-lg border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
      </fieldset>
    </Modal>
  );
};

export default NewReportDialog;
