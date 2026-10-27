import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useCurrentCampaign } from '../lib/useCurrentCampaign.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { formatInTz } from '../lib/datetime.js';
import { shiftDays } from '../lib/datePresets.js';
import { deriveReportSections } from '../lib/reportDerive.js';
import { Badge, Button, Card, Segmented, Skeleton } from '../components/ui/index.js';
import NextStepBanner from '../components/NextStepBanner.jsx';
import ClientReportView, { ClientReportHeading } from '../components/ClientReportView.jsx';
import ClientReportMap from '../components/ClientReportMap.jsx';
import ReportSettings from '../components/clientReports/ReportSettings.jsx';
import BeforePublish, { PublishedChecks } from '../components/clientReports/BeforePublish.jsx';
import PublishDialog from '../components/clientReports/PublishDialog.jsx';
import RefreshDialog from '../components/clientReports/RefreshDialog.jsx';
import ShareDialog from '../components/clientReports/ShareDialog.jsx';
import TeamChangedCard from '../components/clientReports/TeamChangedCard.jsx';
import TeamDialog from '../components/clientReports/TeamDialog.jsx';
import { fetchLogoDataUrl, useLogoUrl } from '../components/clientReports/BrandingCard.jsx';
import { BuildStatus, ConfirmDialog, ErrorBanner, ProgressBar, REREAD_CODES } from '../components/clientReports/parts.jsx';
import { buildStateOf, displayStatusOf, isLiveBuild } from '../components/clientReports/buildState.js';
import {
  changedFields,
  conflictWords,
  diffSettings,
  fieldsText,
  hasLocalChanges,
  mergeSettings,
  saveLabel,
  sendableObservations,
  settingsOf,
} from '../components/clientReports/autoSave.js';
import {
  closeUnderDeps,
  coherentMapKeys,
  depsMapOf,
  rowsFor,
  setHeadline,
  showAll,
  showNone,
  toggleChart,
  toggleMap,
} from '../components/clientReports/questionRules.js';
import { formatDayOf, formatPeriod } from '../components/clientReports/reportDates.js';
import { linksFor, opensLine, singleLinksOf, takeDownLinksText, usableLinks } from '../components/clientReports/linkState.js';
import { messageReportOf } from '../components/clientReports/copyMessage.js';
import { statusOf } from '../components/clientReports/ReportRow.jsx';
import {
  brandingKey,
  buildKey,
  historyKey,
  readUnsent,
  reportKey,
  reportsKey,
  seriesKey,
  sharesKey,
  useAutoSave,
  useBuildPoll,
  useLeaveGuard,
  useMediaQuery,
  writeUnsent,
} from '../components/clientReports/hooks.js';

// The report builder (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G3-§G6; how reports work:
// docs/CLIENT_PORTAL.md).
//
// A DRAFT auto-saves 800 ms after the last change, field by field (§C5: preview used to show the last
// save, and nothing guarded unsaved work). The preview is the server's own shaping of the ON-SCREEN
// settings (POST /:id/preview), rendered with the client's components, so it is exactly what the
// client will see. Its numbers build on the worker — "Numbers as of 9:14 am · Recompute" — and
// Publish freezes the snapshot that was previewed, with the editVersion previewed.
//
// What the screen shows, and Publish freezes, is exactly one version of the report (ADMINUX-1). The
// screen is seeded only from a copy fetched after the page opened; it tracks the editVersion it
// reflects (the seed's, then each of its own saves), and Publish sends that — never a version learned
// from a later re-read. Every save is pinned to that version too (contract C8): a draft's auto-save,
// the way out, a published report's Update (the version at Edit, or at the last merge). A save the
// report moved under is refused with the report as it stands, and so is every re-read checked (a
// save's answer, coming back to the tab): the page merges three ways — what the screen was built on,
// theirs, yours (mergeSettings: key lists member by member, so a chart hidden elsewhere stays hidden
// unless you tick that very chart again; sections by content) — and sends only your changes again.
// Where you both changed the same thing, it asks. Draft saves say they are draft saves (C5), so a
// report someone publishes meanwhile refuses them, and your change becomes an unsent edit of the
// published report rather than going live unconfirmed (ADMINUX-2).
//
// A PUBLISHED report changes only through Edit (words and removals, numbers frozen; Switch to areas
// builds in the background) or Refresh numbers (a before-and-after, applied by hand). Take down hides
// it, Put back up shows it again, unchanged.
//
// Leaving: there is no data router (<BrowserRouter>, so no useBlocker). The builder guards its own
// links (flushing a pending save first), flushes on unmount with fetch keepalive, and holds the
// browser's beforeunload while a save is pending or failed. An unsent edit of a published report, and
// a draft change the way out may not land (P-3), are kept on this device (hooks.js) and offered back.

// What the live snapshot was built with: the server's liveInputs (GET /:id, contract C4) — what the
// client's page is actually served from. For a report from before snapshots that is the follow-ups of
// every survey with answers in the campaign, failing closed (LEGACY-2), so the question table, the
// Refresh dialog and the map ticks agree with the client's page.
const liveFrom = (li) =>
  li && typeof li === 'object'
    ? {
        showMap: li.showMap === true,
        mapMode: li.mapMode === 'area' ? 'area' : 'pins',
        areaSize: li.areaSize === 'large' ? 'large' : 'small',
        mapKeys: Array.isArray(li.mapKeys) ? li.mapKeys.map(String) : [],
        questionDeps: Array.isArray(li.questionDeps) ? li.questionDeps : [],
      }
    : null;

// Only for an answer without liveInputs (a server from before contract C4): the same reading from the
// report alone — a report from before snapshots stands on its own settings and is a pins report.
const liveOf = (report) => {
  const si = report?.snapshotInputs;
  if (si && typeof si === 'object') {
    return {
      showMap: si.showMap === true,
      mapMode: si.mapMode === 'area' ? 'area' : 'pins',
      areaSize: si.areaSize === 'large' ? 'large' : 'small',
      mapKeys: Array.isArray(si.mapKeys) ? si.mapKeys.map(String) : [],
      questionDeps: Array.isArray(si.questionDeps) ? si.questionDeps : [],
    };
  }
  const v = report?.visibility || {};
  return { showMap: v.showMap !== false, mapMode: 'pins', areaSize: 'small', mapKeys: [...(v.mapAnswerKeys || [])], questionDeps: [] };
};

// The preview overlay: the on-screen settings as POST /:id/preview reads them.
const overlayOf = (s) =>
  s && {
    title: s.title,
    observations: sendableObservations(s.observations),
    supportQuestionKey: s.supportQuestionKey || null,
    visibility: { ...s.visibility },
  };

const TEAM_KINDS = new Set(['team', 'team_walk_list']);

const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const andList = (xs) => (xs.length <= 1 ? xs[0] || '' : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// The sentences about a change made elsewhere, under the header (ADMINUX-1, ADMINUX-2, ADMINUX-11).
// `what` names the fields that changed there ("the title and the map questions"); `lost` says what of
// yours the merge couldn't keep (VERIFY2-6), and `none` that nothing of yours was left to keep.
const noticeOf = ({ key, what = '', edit = false, when = '', lost = '', none = false }) => {
  if (key === 'picked') return { tone: 'info', title: 'Picked up changes made elsewhere.', text: `${what ? `${capFirst(what)} changed. ` : ''}This screen now shows the latest saved version.` };
  if (key === 'kept') {
    const there = what ? `${capFirst(what)} changed there` : 'Something changed there';
    if (lost && none) return { tone: 'warning', title: 'Picked up changes made elsewhere.', text: `${there}, so ${lost}.` };
    const yours = edit ? 'your edit is kept on top' : 'your changes are kept on top';
    return { tone: lost ? 'warning' : 'info', title: 'Picked up changes made elsewhere.', text: `${what ? `${there}; ` : ''}${yours}${lost ? `, except that ${lost}` : ''}.` };
  }
  // An Update the report moved under (C8): merged, then sent again — only your changes.
  if (key === 'updatedOnTop') {
    return {
      tone: lost ? 'warning' : 'info',
      title: 'Picked up changes made elsewhere.',
      text: `${what ? `${capFirst(what)} changed there first; ` : ''}your update went on top, so both are kept${lost ? ` — except that ${lost}` : ''}.`,
    };
  }
  if (key === 'alreadyThere') return { tone: 'info', title: 'Picked up changes made elsewhere.', text: 'Your change had already been made there, so there was nothing more to update.' };
  // The switch to areas this page started has committed (VERIFY2-3): yours, not a change made elsewhere.
  if (key === 'switchReady') return { tone: 'success', title: 'Your switch to areas is ready.', text: edit ? 'Your edit is still open, as you left it.' : '' };
  // Edit (or Restore) with an unsent edit kept on this device (CONCUR-2).
  if (key === 'restored') return { tone: 'info', title: 'Your unsent edit is open.', text: `From ${when}, kept on this device. Update report sends it; Cancel edit throws it away.` };
  if (key === 'publishedElsewhere') return { tone: 'info', title: 'Published elsewhere.', text: 'Someone published this report while you had it open, so it now shows as published.' };
  // Contract C5's sentence.
  if (key === 'publishedWhileEditing') {
    return { tone: 'warning', title: null, text: 'Someone published this report while you were editing. Your change hasn’t gone to the client — review it, then press Update to send it.' };
  }
  if (key === 'stillSaving') return { tone: 'info', title: 'Still saving your latest change.', text: 'Press Publish… again in a moment.' };
  return null;
};

const ClientReportBuilderPage = () => {
  const { campaignId, id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { isOrgAdmin } = useAuth();
  const { campaign } = useCurrentCampaign(campaignId);
  const wide = useMediaQuery('(min-width: 1280px)');
  const [pane, setPane] = useState('settings');

  const reportQ = useQuery({
    queryKey: reportKey(id),
    queryFn: ({ signal }) => api(`/admin/client-reports/${id}`, { signal }),
    retry: (count, err) => err?.status !== 404 && count < 1,
    // Back from another tab or window, the report is re-read, so a change made there shows here
    // (ADMINUX-3) — as History's drawer does.
    refetchOnWindowFocus: true,
  });
  const data = reportQ.data;
  const report = data?.report || null;
  // A copy that may seed the screen (ADMINUX-1): fetched after this page opened, or one the query
  // client counts as fresh. The report query keeps react-query's default staleTime of 0, so a copy
  // cached by an earlier visit is always fetched again first — it can predate a change made since,
  // even this page's own last save on the way out (sent with keepalive, never written to the cache).
  const fresh = !!report && !reportQ.isError && (reportQ.isFetchedAfterMount || !reportQ.isStale);
  // Another campaign's report under this campaign's URL (the sidebar's switcher keeps the rest of the
  // path): never shown beside this campaign's links and message — back to this campaign's reports
  // (ADMINUX-5).
  const wrongCampaign = !!report && !!campaignId && String(report.campaignId) !== String(campaignId);
  const tz = report?.timeZone || campaign?.timeZone || 'America/New_York';
  const draftMode = report?.status === 'draft';
  const published = report?.status === 'published';
  const shown = published && !report?.takenDownAt;
  const scopeKind = report?.scope?.kind || (report?.effortId ? 'walk_list' : 'campaign');
  const isTeam = TEAM_KINDS.has(scopeKind);

  const sharesQ = useQuery({
    queryKey: sharesKey(campaignId),
    queryFn: () => api(`/admin/client-reports/shares?campaignId=${campaignId}`),
    enabled: !!campaignId,
  });
  const shares = sharesQ.data?.shares || [];
  const seriesQ = useQuery({
    queryKey: seriesKey(campaignId),
    queryFn: () => api(`/admin/client-reports/series?campaignId=${campaignId}`),
    enabled: !!campaignId && isTeam,
  });
  const brandingQ = useQuery({ queryKey: brandingKey, queryFn: () => api('/admin/branding'), retry: false });
  const logoUrl = useLogoUrl(brandingQ.data?.hasLogo ? String(brandingQ.data.updatedAt || 'logo') : null);

  const invalidate = (alsoPreview = true) => {
    qc.invalidateQueries({ queryKey: reportKey(id) });
    if (alsoPreview) qc.invalidateQueries({ queryKey: ['admin', 'client-report-preview', id] });
    qc.invalidateQueries({ queryKey: reportsKey(campaignId) });
    qc.invalidateQueries({ queryKey: historyKey(campaignId) });
  };
  // When the report's own copy of the build arrived. A save writes the fresh report into the cache
  // (bumping its timestamp) but keeps the same build object, which must not outrank a newer poll.
  const buildSource = useRef({ build: null, at: 0 });
  if (data?.build !== buildSource.current.build) buildSource.current = { build: data?.build, at: reportQ.dataUpdatedAt };
  const { build } = useBuildPoll({ reportId: id, build: data?.build, sourceUpdatedAt: buildSource.current.at, onSettled: () => invalidate() });
  const buildState = buildStateOf(build, { hasSnapshot: !!report?.snapshotId });

  // ── The settings on screen ──────────────────────────────────────────────────────────────────
  // Seeded once per report (the route keeps this page mounted from one report to the next), from a
  // fresh copy only (ADMINUX-1) — at mount when the cache already counts as fresh, otherwise during the
  // render in which the fetch lands, so that frame is the builder rather than a skeleton.
  const seedable = fresh && !wrongCampaign;
  const [settings, setSettings] = useState(() => (seedable ? settingsOf(report) : null));
  const [seededId, setSeededId] = useState(() => (seedable ? id : null));
  const [editing, setEditing] = useState(false); // a published report's Edit
  // What the open edit started from: the published report's settings when Edit (or Restore) was
  // pressed, or at the last merge. Update sends only what changed from it, pinned to its version.
  const [editBase, setEditBase] = useState(null);
  const editVer = useRef(0); // editBase's editVersion (contract C8)
  const setEdit = (base, version = 0) => {
    editVer.current = base ? version : 0;
    setEditBase(base);
  };
  const [removedNotes, setRemovedNotes] = useState({});
  const [banner, setBanner] = useState(null); // { title, error } — every action reports here
  const [notice, setNotice] = useState(null); // { key, what } — a change made elsewhere (noticeOf)
  // You both changed the same thing: { conflicts } (mergeSettings') until you keep yours or take theirs.
  const [elsewhere, setElsewhere] = useState(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [justPublished, setJustPublished] = useState(false);
  if (seedable && seededId !== id) {
    setSeededId(id);
    setSettings(settingsOf(report));
    setEditing(false);
    setEditBase(null);
    setRemovedNotes({});
    setBanner(null);
    setNotice(null);
    setElsewhere(null);
    setPublishOpen(false);
    setJustPublished(false);
  }
  const seeded = seededId === id && !!settings;

  // The editVersion the screen reflects (ADMINUX-1): the seed's, then each of this page's own saves.
  // Every draft save is pinned to it (C8) and Publish sends exactly it. `mode` is what the screen was
  // seeded as (a draft turning published under it is "published elsewhere" — unless this page
  // published it).
  const screen = useRef({ id: null, version: 0, mode: null });

  const { saver, state: saveState } = useAutoSave({
    reportId: id,
    versionOf: () => screen.current.version,
    onSaved: (saved, body, version) => {
      // A save pinned to the screen's version that landed moved it by exactly one: the screen now
      // reflects that version, whatever the answer carries — a newer copy (someone wrote right after)
      // is caught up by the check below.
      if (String(saved?._id) === screen.current.id) {
        if (Number.isInteger(version) && version === screen.current.version) screen.current.version = version + 1;
        else if (!Number.isInteger(version) && (saved?.editVersion ?? 0) === screen.current.version + 1) screen.current.version = saved.editVersion;
      }
      qc.setQueryData(reportKey(id), (old) => (old ? { ...old, report: saved } : old));
      // "Before you publish" reads what the report shows; a title or a note never changes it.
      if (body?.visibility || body?.supportQuestionKey !== undefined || body?.copiedNotesReviewed !== undefined) {
        qc.invalidateQueries({ queryKey: reportKey(id) });
      }
    },
    onAdopt: (next, { dropped }) => {
      setSettings(next);
      if (dropped?.length) {
        setRemovedNotes((m) => ({
          ...m,
          ...Object.fromEntries(dropped.map((k) => [k, 'Taken off the map — it can go there only with the question it follows.'])),
        }));
      }
    },
    // A save the report moved under (C8): the report as it stands goes into the cache, and the check
    // below merges against it — then the parked saver sends what is still yours.
    onChangedElsewhere: (current) => {
      if (current) qc.setQueryData(reportKey(id), (old) => (old ? { ...old, report: current } : old));
      invalidate();
    },
  });

  // The seed's other half: the saver starts from the same settings, and the screen's version and mode
  // from the copy that seeded it.
  useEffect(() => {
    if (!seeded || !report || screen.current.id === id) return;
    screen.current = { id, version: report.editVersion ?? 0, mode: report.status };
    saver.reset(settings);
  }, [seeded, id, report, settings, saver]);

  // Shown settings: a draft and an open edit show the screen's; a published report otherwise shows
  // what it holds (an Apply or a finished switch to areas moves it).
  const view = useMemo(() => (report && settings ? (draftMode || editing ? settings : settingsOf(report)) : null), [report, settings, draftMode, editing]);
  const unsentDiff = editing && editBase && settings ? diffSettings(editBase, settings) : null;

  // ── What is kept on this device ─────────────────────────────────────────────────────────────
  // An open edit's changes, with the settings and version it started from, so restoring it later puts
  // only YOUR changes back on top of whatever the report holds by then (the same merge as any change
  // made elsewhere). Written only once the edit has a change, so pressing Edit never deletes a copy
  // kept earlier (CONCUR-2); deleted by Update, Cancel edit, Discard it — or by undoing every change
  // of this edit yourself.
  const [unsentTick, setUnsentTick] = useState(0);
  const copyOwned = useRef(false); // this edit wrote the copy
  useEffect(() => {
    if (!published || !editing) return;
    if (unsentDiff) {
      writeUnsent(id, { settings, base: editBase, version: editVer.current, at: Date.now() });
      copyOwned.current = true;
    } else if (copyOwned.current) {
      writeUnsent(id, null);
      copyOwned.current = false;
    }
  }, [published, editing, unsentDiff, settings, editBase, id]);
  // The copy, while no edit is open: an unsent edit of a published report, or a draft change the way
  // out may not have landed (P-3).
  const stored = useMemo(() => (!editing ? readUnsent(id) : null), [editing, id, unsentTick]); // eslint-disable-line react-hooks/exhaustive-deps
  // Did its changes land? Judged by the same merge restoring it would run, against a copy of the
  // report at least as new as the one it was made against (an older cached copy never decides).
  const storedLanded = useMemo(() => {
    if (!stored?.settings || !report || !seeded) return false;
    if (Number.isInteger(stored.version) && (report.editVersion ?? 0) < stored.version) return false;
    const theirs = settingsOf(report);
    const { merged, conflicts } = mergeSettings(stored.base || theirs, theirs, stored.settings);
    return !conflicts.length && !changedFields(theirs, merged).length;
  }, [stored, report, seeded]);
  const restorable = stored?.settings && report && seeded && !storedLanded ? stored : null;
  // A copy whose every change is already on the report has nothing left to give back.
  useEffect(() => {
    if (!stored || !storedLanded) return;
    writeUnsent(id, null);
    setUnsentTick((t) => t + 1);
  }, [stored, storedLanded, id]);

  useLeaveGuard(draftMode ? saveState.dirty : !!unsentDiff);

  // "Saved · just now" ages while you look at it.
  const [, setClock] = useState(0);
  useEffect(() => {
    if (saveState.status !== 'saved') return undefined;
    const t = setInterval(() => setClock((c) => c + 1), 30000);
    return () => clearInterval(t);
  }, [saveState.status]);

  // ── Changes ────────────────────────────────────────────────────────────────────────────────────
  const breakdowns = useMemo(() => report?.stats?.cumulative?.surveyBreakdowns || [], [report]);
  const live = useMemo(() => liveFrom(data?.liveInputs) || liveOf(report), [data?.liveInputs, report]);
  const served = !!report && report.visibility?.showMap !== false && live.showMap;
  const deps = useMemo(() => depsMapOf(live.questionDeps, report?.build?.inputs?.questionDeps), [live, report]);
  const editable = !!report && (draftMode || editing) && !elsewhere;

  // ── Changes made elsewhere (ADMINUX-1, ADMINUX-2, contract C8) ────────────────────────────────
  // A merge's map ticks are tidied (only charted questions, follow-ups with their parents) unless the
  // latest version itself wasn't tidy (an old report): never a removal nobody asked for.
  const tidy = (merged, theirs) => (diffSettings(theirs, coherentMapKeys(theirs, deps)) ? merged : coherentMapKeys(merged, deps));
  const sameConflicts = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
  // The merge, tidied, and what of yours it couldn't keep (VERIFY2-6): a map tick the tidy-up took
  // off (its chart hidden there, or a question it follows taken off the map there) and a new order of
  // the sections that gave way to theirs. Each is named — never "kept on top" while one wasn't.
  const mergeOn = (base, theirs, mine, opts) => {
    const { merged, conflicts, lost } = mergeSettings(base, theirs, mine, opts);
    const next = tidy(merged, theirs);
    const had = new Set(base?.visibility?.mapAnswerKeys || []);
    const ticked = new Set(mine?.visibility?.mapAnswerKeys || []);
    const stays = new Set(next.visibility.mapAnswerKeys || []);
    const shown = new Set(next.visibility.visibleQuestionKeys || []);
    const dropped = (merged.visibility.mapAnswerKeys || []).filter((k) => ticked.has(k) && !had.has(k) && !stays.has(k));
    const losses = { parent: dropped.filter((k) => shown.has(k)), chart: dropped.filter((k) => !shown.has(k)), order: lost.some((l) => l.kind === 'order') };
    return { next, conflicts, losses };
  };
  const lostWords = ({ parent, chart, order }) => {
    const q = (keys) => andList(keys.map((k) => `“${labelOf(k)}”`));
    return [
      parent.length ? `${q(parent)} came off the map — ${parent.length === 1 ? 'it can go there only with the question it follows' : 'they can go there only with the questions they follow'}` : null,
      chart.length ? `${q(chart)} came off the map — ${chart.length === 1 ? 'its chart was' : 'their charts were'} hidden there` : null,
      order ? 'your new order of the sections couldn’t be kept' : null,
    ]
      .filter(Boolean)
      .join(', and ');
  };
  // The question table says it under each question, as it does for the server's own tidy-up.
  const noteLosses = ({ parent, chart }) => {
    if (!parent.length && !chart.length) return;
    setRemovedNotes((m) => ({
      ...m,
      ...Object.fromEntries(parent.map((k) => [k, 'Taken off the map — it can go there only with the question it follows.'])),
      ...Object.fromEntries(chart.map((k) => [k, 'Taken off the map — its chart was hidden somewhere else.'])),
    }));
  };
  // A switch to areas THIS page started (VERIFY2-3): when it commits under an open edit, the map view
  // it moves is yours, not a change made elsewhere. Returns what moved without it, and whether it was.
  const ownRemap = useRef(false);
  const withoutOwnSwitch = (moved, theirs) => {
    const vis = moved?.visibility;
    if (!ownRemap.current || theirs?.visibility?.mapMode !== 'area' || !vis || (!('mapMode' in vis) && !('areaSize' in vis))) return { named: moved, switched: false };
    ownRemap.current = false;
    const { mapMode, areaSize, ...rest } = vis; // eslint-disable-line no-unused-vars
    const named = { ...moved, visibility: rest };
    if (!Object.keys(rest).length) delete named.visibility;
    return { named: Object.keys(named).length ? named : null, switched: true };
  };
  // An Update the report moved under (409 CHANGED_ELSEWHERE): the check below merges, then sends it
  // again — only your changes, pinned to the new version — or asks. `mergedFirst` names what changed
  // there, for the sentence once the Update lands.
  const afterMerge = useRef(false);
  const mergedFirst = useRef(null);
  // Every re-read — a save's answer or refusal, coming back to this tab, a finished build — is checked
  // against what the screen was built on, three ways (mergeSettings). Nothing of yours unsaved: the
  // screen catches up and says so. Yours and theirs in different places (a list member, a section,
  // another field): both kept, and it says so. Both of you changed the same thing: yours stays exactly
  // as typed, nothing is sent, and you choose (resolveElsewhere) — the question follows the report
  // if it moves again meanwhile.
  useEffect(() => {
    if (!seeded || !report || screen.current.id !== id) return;
    const s = screen.current;
    const st = saver.state;
    const theirs = settingsOf(report);
    const v = report.editVersion ?? 0;
    // Someone published the draft on screen (contract C5).
    if (s.mode === 'draft' && report.status !== 'draft') {
      if (st.busy) return; // its answer — saved, or refused STATUS_CHANGED — runs this again
      const base = st.base;
      const baseVersion = s.version;
      s.mode = report.status;
      s.version = v;
      const unsaved = hasLocalChanges(base, settings);
      saver.reset(theirs); // nothing more goes out as a draft save
      setElsewhere(null);
      setPublishOpen(false);
      setRemovedNotes({});
      if (!unsaved) {
        setSettings(theirs);
        setNotice({ key: 'publishedElsewhere' });
        return;
      }
      // Your change becomes an unsent edit of the published report, kept on this device too — merged
      // onto what was published like any change made elsewhere: both kept, or (you both changed the
      // same thing) the edit opens on what it was made against, and asks.
      copyOwned.current = false;
      const { next: kept, conflicts, losses } = mergeOn(base, theirs, settings);
      if (conflicts.length) {
        writeUnsent(id, { settings, base, version: baseVersion, at: Date.now() });
        setEdit(base, baseVersion);
      } else {
        writeUnsent(id, { settings: kept, base: theirs, version: v, at: Date.now() });
        setEdit(theirs, v);
        setSettings(kept);
        noteLosses(losses);
      }
      setEditing(true);
      setNotice({ key: 'publishedWhileEditing' });
      return;
    }
    if (draftMode) {
      if (v <= s.version || st.busy) return; // nothing newer, or a save's answer is on its way
      const base = st.base;
      const moved = diffSettings(base, theirs);
      if (!moved) {
        // The version moved, nothing the screen shows did (or the other side put its change back
        // while you were asked): carry on — rebase ends any hold, so anything pending goes (VERIFY2-1).
        s.version = v;
        saver.rebase(theirs, settings);
        if (elsewhere) setElsewhere(null);
        return;
      }
      if (!hasLocalChanges(base, settings)) {
        s.version = v;
        saver.rebase(theirs, theirs);
        setSettings(theirs);
        setRemovedNotes({});
        setElsewhere(null);
        setNotice({ key: 'picked', what: fieldsText(moved) });
        return;
      }
      const { next, conflicts, losses } = mergeOn(base, theirs, settings);
      if (!conflicts.length) {
        // Each side changed different things: both are kept, nothing to choose — yours go next. What
        // of yours couldn't be kept is named (VERIFY2-6).
        s.version = v;
        setSettings(next);
        saver.rebase(theirs, next);
        if (st.held) saver.release();
        setElsewhere(null);
        noteLosses(losses);
        setNotice({ key: 'kept', what: fieldsText(moved), lost: lostWords(losses), none: !hasLocalChanges(theirs, next) });
        return;
      }
      if (!st.held) saver.hold();
      if (!sameConflicts(elsewhere?.conflicts, conflicts)) setElsewhere({ conflicts });
      return;
    }
    if (editing && editBase) {
      // A published report's open edit: the report moved under it (an edit, an Apply, a finished
      // switch to areas). An older cached copy than the one the edit last merged is no news.
      if (v < editVer.current) return;
      const resend = afterMerge.current;
      const moved = diffSettings(editBase, theirs);
      if (!moved) {
        // The same settings at a later version: the edit carries on from it.
        editVer.current = v;
        if (elsewhere) setElsewhere(null);
        if (resend) {
          afterMerge.current = false;
          const body = diffSettings(editBase, settings);
          if (body) updateM.mutate(body);
          else setConfirmUpdate(false);
        }
        return;
      }
      // The commit of a switch to areas this page started is yours, not news from elsewhere (VERIFY2-3).
      const { named, switched } = withoutOwnSwitch(moved, theirs);
      const what = named ? fieldsText(named) : '';
      if (!hasLocalChanges(editBase, settings)) {
        setEdit(theirs, v);
        setSettings(theirs);
        setElsewhere(null);
        setNotice(what ? { key: 'picked', what } : switched ? { key: 'switchReady', edit: true } : null);
        if (resend) {
          afterMerge.current = false;
          setConfirmUpdate(false);
        }
        return;
      }
      const { next, conflicts, losses } = mergeOn(editBase, theirs, settings);
      if (!conflicts.length) {
        setSettings(next);
        setEdit(theirs, v);
        setElsewhere(null);
        noteLosses(losses);
        const lost = lostWords(losses);
        if (!resend) {
          if (what || lost) setNotice({ key: 'kept', what, edit: true, lost, none: !hasLocalChanges(theirs, next) });
          else if (switched) setNotice({ key: 'switchReady', edit: true });
          return;
        }
        afterMerge.current = false;
        const body = diffSettings(theirs, next);
        if (body) {
          mergedFirst.current = what || lost ? { what, lost } : switched ? { switched } : null;
          updateM.mutate(body);
        } else {
          // Nothing of yours left to send: already made there — or, said so, not kept.
          setConfirmUpdate(false);
          setEditing(false);
          setEdit(null);
          writeUnsent(id, null);
          setNotice(lost ? { key: 'kept', what, lost, none: true } : { key: 'alreadyThere' });
        }
        return;
      }
      if (resend) {
        afterMerge.current = false;
        setConfirmUpdate(false);
      }
      if (!sameConflicts(elsewhere?.conflicts, conflicts)) setElsewhere({ conflicts });
    }
    // saveState: the saver settling re-runs this (its `busy` is read live above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeded, id, report, settings, saveState, elsewhere, draftMode, editing, editBase, saver]);

  // The switch to areas this page started stops being "ours" once it has ended with no edit open to
  // fold it into — committed, failed or cancelled (VERIFY2-3).
  useEffect(() => {
    if (!ownRemap.current || editing || !report) return;
    const b = report.build;
    if (!(b?.kind === 'remap' && ['queued', 'waiting', 'running'].includes(b.status))) ownRemap.current = false;
  }, [report, editing]);

  // The answer, for what you both changed: yours, or theirs. Anything else either of you changed is
  // kept either way; read against the latest copy (it may have moved again while you decided).
  const resolveElsewhere = (yours) => {
    if (!report) return;
    const theirs = settingsOf(report);
    const v = report.editVersion ?? 0;
    const base = draftMode ? saver.state.base : editBase;
    if (base) {
      const { next, losses } = mergeOn(base, theirs, settings, { prefer: yours ? 'mine' : 'theirs' });
      noteLosses(losses);
      if (draftMode) {
        screen.current.version = v;
        setSettings(next);
        saver.rebase(theirs, next);
        saver.release();
      } else if (editing) {
        setSettings(next);
        setEdit(theirs, v);
      }
    }
    setElsewhere(null);
    setNotice(null);
  };

  const change = (next) => {
    setSettings(next);
    if (draftMode) saver.update(next);
  };
  const noteRemoved = (key, removed, labelOf) => {
    setRemovedNotes((m) => {
      const out = { ...m };
      delete out[key];
      if (removed.length) {
        out[key] = `${removed.map((k) => `“${labelOf(k)}”`).join(' and ')} came off the map too — ${removed.length === 1 ? 'it follows' : 'they follow'} this question.`;
      }
      return out;
    });
  };
  const labelOf = (k) => breakdowns.find((b) => b.questionKey === k)?.questionLabel || k;
  const rows = view
    ? rowsFor({ breakdowns, settings: view, deps, published, liveMapKeys: published ? (served ? live.mapKeys : []) : null })
    : [];

  // ── Actions ────────────────────────────────────────────────────────────────────────────────────
  // A refusal that means the report moved under this page (ADMINUX-3): re-read the report, its build
  // and its preview, so the page shows what changed — and the error, marked `reread`, says so
  // (parts.jsx errorText) instead of a "try again" that could never work.
  const rereadOn = (err) => {
    if (!err || !(err.status === 404 || REREAD_CODES.has(err.code))) return;
    err.reread = true;
    qc.invalidateQueries({ queryKey: buildKey(id) });
    invalidate();
  };
  const fail = (title) => (e) => {
    rereadOn(e);
    setBanner({ title, error: e });
  };
  const recomputeM = useMutation({
    mutationFn: async () => {
      // The claim freezes the SAVED settings as the build's target, so they must land first.
      const heldError = () => new Error('This report was changed somewhere else — choose which version to keep first.');
      if (draftMode && saver.state.held) throw heldError();
      if (draftMode && !(await saver.flush())) {
        // A merge that has to ask stops the flush too (C8): say that, not "didn't save".
        throw saver.state.held ? heldError() : Object.assign(new Error('Your latest change didn’t save — retry it, then recompute.'), { code: 'SAVE_FAILED' });
      }
      return api(`/admin/client-reports/${id}/recompute`, { method: 'POST' });
    },
    onSuccess: (res) => {
      setBanner(null);
      if (res?.build) qc.setQueryData(buildKey(id), res.build);
      invalidate(false);
    },
    onError: fail('Couldn’t recompute.'),
  });
  const cancelM = useMutation({
    mutationFn: () => api(`/admin/client-reports/${id}/build/cancel`, { method: 'POST' }),
    onSuccess: () => {
      qc.setQueryData(buildKey(id), { status: 'idle' });
      invalidate(false);
    },
    onError: fail('Couldn’t cancel the build.'),
  });

  // A draft with no numbers (new, or from before builds moved to the worker) starts building when
  // opened — once per report, and never over a build that is live, ready or failed. Judged ONCE, the
  // first time the report is on screen (ADMINUX-4): a report that arrives with numbers or with any
  // build that isn't idle is handled then, so a build finishing while the page is open — the poll
  // sees idle a moment before the re-read brings its numbers — never claims a second one.
  const autoStarted = useRef(null);
  useEffect(() => {
    if (!seeded || !report || autoStarted.current === id) return;
    autoStarted.current = id;
    if (report.status !== 'draft' || report.snapshotId || displayStatusOf(build) !== 'idle') return;
    recomputeM.mutate();
  }, [seeded, id, report, build, recomputeM]);

  const publishM = useMutation({
    mutationFn: () =>
      api(`/admin/client-reports/${id}/publish`, {
        method: 'POST',
        // Always both: the snapshot the preview showed, and the edit version the SCREEN reflects (§F3,
        // ADMINUX-1) — never one learned from a later re-read. If either moved, the server refuses
        // (SNAPSHOT_CHANGED, SAVING) and the re-read brings the screen up to date first.
        body: { snapshotId: report?.snapshotId ? String(report.snapshotId) : null, editVersion: screen.current.version },
      }),
    onSuccess: (res) => {
      screen.current.mode = res.report?.status || 'published'; // published HERE: not "published elsewhere"
      setPublishOpen(false);
      setJustPublished(true);
      qc.setQueryData(reportKey(id), (old) => (old ? { ...old, report: res.report } : old));
      qc.setQueryData(buildKey(id), { status: 'idle' });
      invalidate();
    },
    onError: rereadOn,
  });
  const openPublish = async () => {
    setBanner(null);
    setNotice((n) => (n?.key === 'stillSaving' ? null : n));
    publishM.reset();
    if (await saver.flush()) {
      setPublishOpen(true);
      return;
    }
    // Only a real failure reads as one (ADMINUX-11): the flush keeps sending while you type, so what
    // is left is a refused save — or the "changed somewhere else" question, which says what to do.
    const st = saver.state;
    if (st.held) return;
    if (st.status === 'error') setBanner({ title: 'Your latest change didn’t save.', error: st.error || new Error('Retry the save, then publish.') });
    else setNotice({ key: 'stillSaving' });
  };

  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const updateM = useMutation({
    // ifStatus (contract C5): an Update only ever lands on a report that is still published; and only
    // on the version the edit was built on (C8), so it never writes over a change made elsewhere.
    mutationFn: (body) => api(`/admin/client-reports/${id}`, { method: 'PATCH', body: { ...body, ifStatus: 'published', ifEditVersion: editVer.current } }),
    onSuccess: (res) => {
      const first = mergedFirst.current;
      mergedFirst.current = null;
      // A switch to areas this Update starts is this page's own (VERIFY2-3): its commit isn't news.
      if (res.build?.kind === 'remap' && isLiveBuild(res.build)) ownRemap.current = true;
      setConfirmUpdate(false);
      setEditing(false);
      setEdit(null);
      setNotice(first?.what || first?.lost ? { key: 'updatedOnTop', what: first.what, lost: first.lost } : first?.switched ? { key: 'switchReady' } : null);
      writeUnsent(id, null);
      setSettings(settingsOf(res.report));
      qc.setQueryData(reportKey(id), (old) => (old ? { ...old, report: res.report } : old));
      if (res.build && isLiveBuild(res.build)) qc.setQueryData(buildKey(id), res.build);
      invalidate();
    },
    onError: (err) => {
      // The report moved since the edit's version (C8): the report as it stands goes into the cache,
      // and the changed-elsewhere check merges and sends your changes again — or asks.
      if (err?.code === 'CHANGED_ELSEWHERE' && err.data?.report) {
        afterMerge.current = true;
        qc.setQueryData(reportKey(id), (old) => (old ? { ...old, report: err.data.report } : old));
        invalidate();
        return;
      }
      mergedFirst.current = null;
      rereadOn(err);
    },
  });
  // Retry a switch to areas that failed or stalled (ADMINUX-6): its own request, never Update's, so an
  // edit open beside it — and the copy of it this device keeps — stays exactly as it was. Pinned to the
  // version this page shows (C8): moved meanwhile, it re-reads and says so.
  const remapRetryM = useMutation({
    mutationFn: () =>
      api(`/admin/client-reports/${id}`, {
        method: 'PATCH',
        body: {
          visibility: { mapMode: 'area', areaSize: report?.build?.inputs?.areaSize === 'large' ? 'large' : 'small' },
          ifStatus: 'published',
          ifEditVersion: report?.editVersion ?? 0,
        },
      }),
    onSuccess: (res) => {
      setBanner(null);
      if (res.build?.kind === 'remap' && isLiveBuild(res.build)) ownRemap.current = true; // VERIFY2-3
      qc.setQueryData(reportKey(id), (old) => (old ? { ...old, report: res.report } : old));
      if (res.build && isLiveBuild(res.build)) qc.setQueryData(buildKey(id), res.build);
      invalidate();
    },
    onError: fail('Couldn’t start the switch to areas again.'),
  });
  const [confirmMapOff, setConfirmMapOff] = useState(false);
  const [confirmAreas, setConfirmAreas] = useState(null); // the area size picked
  const [confirmTakeDown, setConfirmTakeDown] = useState(false);
  const takeDownM = useMutation({
    mutationFn: () => api(`/admin/client-reports/${id}/take-down`, { method: 'POST' }),
    onSuccess: () => {
      setConfirmTakeDown(false);
      invalidate();
    },
    onError: rereadOn,
  });
  const putBackUpM = useMutation({
    mutationFn: () => api(`/admin/client-reports/${id}/put-back-up`, { method: 'POST' }),
    onSuccess: () => invalidate(),
    onError: fail('Couldn’t put the report back up.'),
  });

  // Refresh numbers.
  const [refreshOpen, setRefreshOpen] = useState(false);
  const refreshM = useMutation({
    mutationFn: (body) => api(`/admin/client-reports/${id}/refresh`, { method: 'POST', body }),
    onSuccess: (res) => {
      if (res?.build) qc.setQueryData(buildKey(id), res.build);
      invalidate(false);
    },
    onError: rereadOn,
  });
  const applyM = useMutation({
    mutationFn: () => api(`/admin/client-reports/${id}/refresh/apply`, { method: 'POST', body: { snapshotId: build?.snapshotId || null } }),
    onSuccess: (res) => {
      setRefreshOpen(false);
      qc.setQueryData(reportKey(id), (old) => (old ? { ...old, report: res.report } : old));
      qc.setQueryData(buildKey(id), { status: 'idle' });
      invalidate();
    },
    onError: rereadOn,
  });
  const discardM = useMutation({
    mutationFn: () => api(`/admin/client-reports/${id}/refresh/discard`, { method: 'POST', body: { snapshotId: build?.snapshotId || null } }),
    onSuccess: () => {
      qc.setQueryData(buildKey(id), { status: 'idle' });
      invalidate(false);
    },
    onError: rereadOn,
  });

  // A draft save refused because the report was published meanwhile (contract C5) or deleted: re-read
  // it. The check above then turns your change into an unsent edit of the published report, or the
  // page says the report is gone.
  const saveErr = saveState.status === 'error' ? saveState.error : null;
  useEffect(() => {
    if (saveErr && (saveErr.code === 'STATUS_CHANGED' || saveErr.status === 404)) invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveErr]);

  useEffect(() => {
    if (wrongCampaign) navigate(`/campaigns/${campaignId}/reports`, { replace: true });
  }, [wrongCampaign, campaignId, navigate]);
  // ?review=1 (a row's "Review") opens the before-and-after once it is ready.
  const reviewParam = params.get('review') === '1';
  const aheadParam = params.get('ahead') === '1';
  const dismissAhead = () =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('ahead');
      return next;
    }, { replace: true });
  useEffect(() => {
    if (!reviewParam || displayStatusOf(build) !== 'ready') return;
    setRefreshOpen(true);
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('review');
      return next;
    }, { replace: true });
  }, [reviewParam, build, setParams]);

  const [shareOpen, setShareOpen] = useState(false);
  const [team, setTeam] = useState(null); // { series, initialEnding }
  const [pdfBusy, setPdfBusy] = useState(false);

  // ── The preview: the server's shaping of what is on screen ───────────────────────────────────
  const overlay = useMemo(() => overlayOf(view), [view]);
  const debounced = useDebouncedValue(overlay, 350);
  const overlayKey = JSON.stringify(debounced || null);
  const previewQ = useQuery({
    queryKey: ['admin', 'client-report-preview', id, report?.snapshotId ? String(report.snapshotId) : null, overlayKey],
    queryFn: ({ signal }) => api(`/admin/client-reports/${id}/preview`, { method: 'POST', body: debounced, signal }),
    enabled: !!report && !!debounced,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const shaped = previewQ.data?.report || null;
  const previewFresh = !!shaped && !previewQ.isFetching && !previewQ.isPlaceholderData && JSON.stringify(overlay || null) === overlayKey;
  // The map's empty line, worded for the period exactly as the client's page words it.
  const mapEmptyText = useMemo(() => (shaped ? deriveReportSections(shaped).mapEmptyText : undefined), [shaped]);

  // ── Leaving ─────────────────────────────────────────────────────────────────────────────────────
  const backTo = `/campaigns/${campaignId}/reports${report?.seriesId ? `?tab=${report.seriesId}` : ''}`;
  // Nothing is saved until you choose (the way out can't save it either: it is pinned to the version
  // you both changed, C8), so it stays on this device and is offered back (P-3).
  const HELD_LEAVE = 'This report was changed somewhere else while you were editing, so your change isn’t saved yet. Leave anyway? It stays on this device — you can restore it when you come back.';
  const leave = async (to) => {
    if (draftMode && saver.state.held) {
      if (!window.confirm(HELD_LEAVE)) return;
    } else if (draftMode) {
      // The flush waits out a merge with a change made elsewhere; it stops only to ask, or on a failure.
      const ok = await saver.flush();
      if (!ok && !window.confirm(saver.state.held ? HELD_LEAVE : 'Your last change didn’t save. Leave anyway?')) return;
    } else if (unsentDiff && !window.confirm('Leave without updating the report? Your edit stays on this device — you can restore it when you come back.')) {
      return;
    }
    navigate(to);
  };

  // ── Edit, and what is kept on this device ─────────────────────────────────────────────────────
  // Edit opens the unsent edit kept here when there is one (CONCUR-2), on the settings and version it
  // was made against: the changed-elsewhere check then merges it onto the report as it stands.
  const openEdit = (copy = null) => {
    copyOwned.current = false;
    afterMerge.current = false;
    mergedFirst.current = null;
    if (copy?.settings) {
      const ownBase = !!copy.base;
      setEdit(ownBase ? copy.base : settingsOf(report), ownBase ? (Number.isInteger(copy.version) ? copy.version : 0) : report.editVersion ?? 0);
      setSettings(copy.settings);
      setNotice({ key: 'restored', when: formatInTz(copy.at, tz) });
    } else {
      setEdit(settingsOf(report), report.editVersion ?? 0);
      setSettings(settingsOf(report));
      setNotice(null);
    }
    setRemovedNotes({});
    setEditing(true);
  };
  const cancelEdit = () => {
    setConfirmCancel(false);
    setEditing(false);
    setEdit(null);
    setSettings(settingsOf(report));
    writeUnsent(id, null);
    copyOwned.current = false;
    afterMerge.current = false;
    mergedFirst.current = null;
    setRemovedNotes({});
    setElsewhere(null);
    setNotice(null);
  };
  const discardCopy = () => {
    writeUnsent(id, null);
    setUnsentTick((t) => t + 1);
  };
  // A draft change the way out may not have landed (P-3): the screen becomes the copy, on the settings
  // and version it was made against; the changed-elsewhere check merges it onto the report as it
  // stands and auto-save sends it — or asks, when you both changed the same thing.
  const restoreDraftCopy = (copy) => {
    screen.current.version = Number.isInteger(copy.version) ? copy.version : 0;
    saver.rebase(copy.base || settingsOf(report), copy.settings);
    setSettings(copy.settings);
    setRemovedNotes({});
    setNotice(null);
    discardCopy();
  };

  // The not-found page: a report that's gone (404 — from here, or the build poll's re-read, ADMINUX-7)
  // or no longer yours (403), or one that never loaded fresh. A later re-read that fails otherwise
  // keeps the builder — and what is typed in it — on screen. Another campaign's report shows nothing
  // while the page goes back to this campaign's list.
  const gone = reportQ.isError && (reportQ.error?.status === 404 || reportQ.error?.status === 403);
  if (!wrongCampaign && (gone || (reportQ.isError && !seeded) || (!reportQ.isPending && !report))) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 py-10 text-center">
        <h1 className="text-xl font-semibold text-fg">{reportQ.error?.status === 404 ? 'Report not found' : 'Couldn’t load this report'}</h1>
        <p className="text-sm text-fg-muted">{reportQ.error?.status === 404 ? 'It may have been deleted.' : reportQ.error?.message}</p>
        <Button variant="secondary" onClick={() => navigate(`/campaigns/${campaignId}/reports`)}>
          All reports
        </Button>
      </div>
    );
  }
  if (wrongCampaign || !seeded) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-4 w-96 opacity-60" />
        <Skeleton className="h-72 w-full opacity-60" />
      </div>
    );
  }

  const checks = data.checks || null;
  const status = statusOf(report);
  const scopeName = data.seriesLabel || report.scope?.label || report.effortName || 'Whole campaign';
  const scopeText = scopeKind === 'campaign' ? 'Whole campaign' : scopeKind === 'walk_list' ? `Walk list: ${scopeName}` : `Team: ${scopeName}`;
  // A draft with no snapshot has no numbers, whatever an older field says.
  const numbersAsOf = report.snapshotId || published ? checks?.numbersAsOf || report.statsComputedAt || report.publishedAt || null : null;
  // Opened via which link: named once the links list is here (never "a deleted link" while it loads).
  const opens = published && sharesQ.data ? opensLine(report, shares) : '';
  const notes = [
    report.contentEditedAt ? `Edited ${formatDayOf(report.contentEditedAt, tz)}` : null,
    report.numbersRefreshedAt ? `Numbers refreshed ${formatDayOf(report.numbersRefreshedAt, tz)}` : null,
  ].filter(Boolean);
  const live2 = displayStatusOf(build);
  const buildLive = ['queued', 'waiting', 'running'].includes(live2);
  const mockAuditHref = `/campaigns/${campaignId}/audit?reason=mock_gps&status=open&from=${shiftDays(report.weekEnd, -61)}&to=${report.weekEnd}`;
  // The campaign has a door goal the numbers predate (contract C6, NUM-5): say so, with what rebuilds
  // them, rather than "no door goal set".
  const goalAfterBuild = !report.effortId && !isTeam && !(draftMode && !report.snapshotId) && !report.goalSnapshot?.target && Number(campaign?.doorGoal) > 0;
  const goalReason = report.effortId
    ? 'Door goals are campaign-wide, so they can’t be shown on a walk-list report.'
    : isTeam
      ? 'Door goals are campaign-wide, so they can’t be shown on a team report.'
      : draftMode && !report.snapshotId
        ? 'Available once the numbers are built.'
        : goalAfterBuild
          ? `Your door goal was set after these numbers were built. ${draftMode ? 'Recompute them' : 'Refresh numbers'} to show it.`
          : `This campaign has no door goal set. Add one from the Campaigns page, then ${draftMode ? 'recompute' : 'refresh the numbers'}.`;

  // A draft whose map settings add to what its numbers were built with: the map preview is older.
  const mapStale = (() => {
    if (!draftMode || !report.snapshotId || !view.visibility.showMap) return null;
    const v = view.visibility;
    const keys = closeUnderDeps(v.mapAnswerKeys.filter((k) => v.visibleQuestionKeys.includes(k)), deps);
    const adds =
      !live.showMap || v.mapMode !== live.mapMode || (v.mapMode === 'area' && v.areaSize !== live.areaSize) || keys.some((k) => !live.mapKeys.includes(k));
    return adds ? `Map preview is from ${formatInTz(numbersAsOf, tz)}, before your map changes —` : null;
  })();

  const teamSeriesId = buildState?.teamChanged ? buildState.seriesId : null;
  const teamRow = (seriesQ.data?.series || []).find((s) => s.id === teamSeriesId) || null;
  // The links list, or null until it has loaded: Before you publish and the Publish confirm then read
  // the checks' count instead.
  const linkList = sharesQ.isSuccess ? shares : null;
  // Can a link open it (WALK-5)? Only the links that can open THIS report count — the links to all
  // your reports and this report's own, never another report's (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md
  // §D, contract K8): the list once loaded, else what the checks counted (the server counts the same).
  const hasUsableLink = linkList ? usableLinks(linksFor(linkList, id)).length > 0 : (checks?.links?.usable ?? 0) > 0;
  // Take down names this report's own links (§D): they show "taken down" until it is put back up.
  const takeDownLinks = takeDownLinksText(singleLinksOf(shares, id));
  const elsewhereWords = elsewhere ? conflictWords(elsewhere.conflicts, { labelOf, theirs: settingsOf(report) }) : null;
  // An Update that only switches to areas isn't seen "right away" (WALK-8).
  const switchOnly =
    !!unsentDiff && Object.keys(unsentDiff).every((k) => k === 'visibility') && Object.keys(unsentDiff.visibility || {}).every((k) => k === 'mapMode' || k === 'areaSize');
  // The single-choice questions on the map — the ones a switch to areas may show no answers by area for (WALK-7).
  const areaCandidates = rows.filter((r) => r.map && r.type === 'single_choice').map((r) => r.label);

  const downloadPdf = async () => {
    if (!shaped) return;
    setPdfBusy(true);
    try {
      const { generateReportPdf } = await import('../lib/reportPdf.js');
      const logoDataUrl = brandingQ.data?.hasLogo ? await fetchLogoDataUrl() : null;
      await generateReportPdf(shaped, { campaignName: data.campaignName, orgName: data.orgName, logoDataUrl });
    } catch (err) {
      console.error('PDF export failed', err);
      setBanner({ title: 'Couldn’t build the PDF.', error: err });
    } finally {
      setPdfBusy(false);
    }
  };

  // ── The two columns ──────────────────────────────────────────────────────────────────────────
  const settingsColumn = (
    <div className="space-y-6">
      {published && !editing && (
        <p className="rounded-md border border-border bg-sunken/60 px-3 py-2 text-xs text-fg-muted">
          Published reports change only through Edit (the words and what is shown; the numbers stay frozen) or Refresh numbers.
        </p>
      )}
      {editing && (
        <NextStepBanner tone="info" title="Editing.">
          Your client sees nothing until you press Update report. The numbers stay frozen.
        </NextStepBanner>
      )}
      {/* After publishing, the checks that can still matter (P-2): Before you publish shows on drafts only. */}
      {published && (
        <PublishedChecks checks={checks} report={report} onRefresh={editing ? null : () => setRefreshOpen(true)} busy={buildLive || refreshM.isPending} />
      )}
      {draftMode && (
        <BeforePublish
          checks={checks}
          report={report}
          shares={linkList}
          labelOf={labelOf}
          tz={tz}
          busy={recomputeM.isPending || buildLive}
          onRecompute={() => recomputeM.mutate()}
          onReviewMocks={() => leave(mockAuditHref)}
          copiedReviewed={settings.copiedNotesReviewed}
          onCopiedReviewed={(v) => change({ ...settings, copiedNotesReviewed: v })}
        />
      )}
      <ReportSettings
        report={report}
        settings={view}
        rows={rows}
        removedNotes={removedNotes}
        editable={editable}
        published={published}
        live={live}
        served={served}
        mapStale={mapStale}
        goalReason={goalReason}
        goalAfterBuild={goalAfterBuild}
        recomputeBusy={recomputeM.isPending || buildLive}
        onRecompute={draftMode ? () => recomputeM.mutate() : null}
        onRefreshFor={published && !editing ? () => setRefreshOpen(true) : null}
        onChange={change}
        onToggleChart={(key) => {
          const r = toggleChart(settings, key, deps);
          change(r.settings);
          noteRemoved(key, r.removedFromMap.filter((k) => k !== key), labelOf);
        }}
        onToggleMap={(key) => {
          const r = toggleMap(settings, key, deps);
          change(r.settings);
          noteRemoved(key, r.removedFromMap, labelOf);
        }}
        onHeadline={(key) => change(setHeadline(settings, key))}
        onShowAll={() => change(showAll(settings, breakdowns))}
        onShowNone={() => change(showNone(settings))}
        onMapOff={() => (published ? setConfirmMapOff(true) : change({ ...settings, visibility: { ...settings.visibility, showMap: false } }))}
        onAreas={(size) => {
          // Already switching (not yet sent): just the size. Otherwise the switch asks first.
          if (settings.visibility.mapMode === 'area') change({ ...settings, visibility: { ...settings.visibility, areaSize: size } });
          else setConfirmAreas(size);
        }}
      />
      {editing && (
        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-border bg-card py-3">
          {/* With changes, it asks first: Cancel edit throws them away — and the copy kept on this device. */}
          <Button variant="secondary" onClick={() => (unsentDiff ? setConfirmCancel(true) : cancelEdit())}>
            Cancel edit
          </Button>
          <Button
            disabled={!unsentDiff || !!elsewhere}
            title={elsewhere ? 'This report was changed somewhere else — choose which version to keep first.' : undefined}
            onClick={() => setConfirmUpdate(true)}
          >
            Update report
          </Button>
        </div>
      )}
    </div>
  );

  const previewColumn = (
    <section className="space-y-4" aria-label="Preview of what your client sees">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Preview — exactly what your client sees</h2>
        <Button size="sm" variant="secondary" loading={pdfBusy} disabled={!shaped} onClick={downloadPdf}>
          Download PDF
        </Button>
      </div>
      {!report.snapshotId && !published ? (
        <Card className="p-6 text-center">
          {buildState && ['queued', 'waiting', 'running'].includes(buildState.status) ? (
            <>
              <p className="text-sm font-medium text-fg">Building the first numbers…</p>
              <p className="mt-1 text-xs text-fg-muted">You can leave this page — they keep building. The preview appears when they’re ready.</p>
            </>
          ) : buildState && ['failed', 'stalled'].includes(buildState.status) ? (
            <p className="text-sm text-fg-muted">The first numbers couldn’t be built — see above to try again.</p>
          ) : (
            <p className="text-sm text-fg-muted">No numbers yet — Recompute builds them.</p>
          )}
          {buildState?.progress != null && (
            <div className="mx-auto mt-3 max-w-xs">
              <ProgressBar value={buildState.progress} label="Building the first numbers" />
            </div>
          )}
        </Card>
      ) : previewQ.isError && !shaped ? (
        <ErrorBanner title="Couldn’t build the preview." error={previewQ.error} />
      ) : !shaped ? (
        <Skeleton className="h-72 w-full opacity-60" />
      ) : (
        <div className={`space-y-6 transition-opacity ${previewQ.isFetching ? 'opacity-70' : ''}`} aria-busy={previewQ.isFetching}>
          {/* The client page's header (logo, campaign · organization), then the report as they read it. */}
          <div className="flex items-center gap-3 border-b border-border pb-3">
            {logoUrl && <img src={logoUrl} alt="" className="h-10 max-w-[10rem] object-contain" />}
            <div className="min-w-0 text-sm font-medium text-fg">
              {data.campaignName}
              {data.orgName ? <span className="text-fg-muted"> · {data.orgName}</span> : null}
            </div>
          </div>
          <ClientReportHeading report={shaped} />
          <ClientReportView report={shaped} />
          {shaped.visibility?.showMap && (
            <section>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">Where we’ve been</h3>
              <ClientReportMap
                mapPath={`/admin/client-reports/${id}/preview/map`}
                doorsPath={`/admin/client-reports/${id}/preview/map/doors`}
                areasPath={`/admin/client-reports/${id}/preview/areas`}
                tokenPath="/admin/config/mapbox-token"
                survey={previewQ.data?.survey}
                campaignType={shaped.campaignType}
                mapMode={shaped.visibility?.mapMode || 'pins'}
                // The map's own version (contract C7): when the re-read preview carries a new one, the
                // map fetches again at once, as the client's page does.
                mapVersion={shaped.visibility?.mapVersion ?? null}
                emptyText={mapEmptyText}
                // A 409 MAP_UPDATED (new numbers applied, or a switch to areas committed): reload the
                // report and its preview, as the client's page reloads its report.
                onUpdated={() => invalidate()}
              />
            </section>
          )}
        </div>
      )}
    </section>
  );

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      {/* Header */}
      <div className="space-y-2">
        <button type="button" onClick={() => leave(backTo)} className="text-xs font-semibold text-brand-accent hover:underline">
          ‹ All reports
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-fg">
                {report.allTime ? `All time · ${formatPeriod(report.weekStart, report.weekEnd)}` : formatPeriod(report.weekStart, report.weekEnd)}
              </h1>
              <Badge variant={status.variant} dot>
                {[status.label, ...notes].join(' · ')}
              </Badge>
              <span className="text-sm text-fg-muted">{scopeText}</span>
            </div>
            {report.title && <div className="mt-0.5 text-sm text-fg-muted">{report.title}</div>}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
              {numbersAsOf ? <span>Numbers as of {formatInTz(numbersAsOf, tz)}</span> : <span>No numbers yet</span>}
              {draftMode && (
                <>
                  <span aria-hidden="true">·</span>
                  <button type="button" className="font-semibold text-brand-accent hover:underline disabled:opacity-50" disabled={recomputeM.isPending || buildLive} onClick={() => recomputeM.mutate()}>
                    Recompute
                  </button>
                </>
              )}
              {opens && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{opens}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {draftMode && (
              <>
                <span className={`text-xs ${saveState.status === 'error' ? 'text-danger-fg' : 'text-fg-muted'}`} aria-live="polite">
                  {saveLabel(saveState)}
                  {saveState.status === 'error' && (
                    <>
                      {' — '}
                      <button type="button" className="font-semibold underline underline-offset-2" onClick={() => saver.retry()}>
                        Retry
                      </button>
                    </>
                  )}
                </span>
                <Button
                  onClick={openPublish}
                  disabled={!report.snapshotId || !!elsewhere}
                  title={
                    !report.snapshotId
                      ? 'Publish is ready once the first numbers are built.'
                      : elsewhere
                        ? 'This report was changed somewhere else — choose which version to keep first.'
                        : undefined
                  }
                >
                  Publish…
                </Button>
              </>
            )}
            {published && (
              <>
                {!editing && (
                  <Button variant="secondary" onClick={() => openEdit(restorable)}>
                    Edit
                  </Button>
                )}
                <Button variant="secondary" disabled={editing} title={editing ? 'Finish or cancel the edit first.' : undefined} onClick={() => setRefreshOpen(true)}>
                  Refresh numbers
                </Button>
                {/* Share replaces Copy message (§D): the message, the link it uses — and Make a link, so it
                    is never held for want of one. It waits for the links list, so it never says that no
                    link opens the report before the list is in. */}
                {shown && (
                  <Button
                    variant="secondary"
                    disabled={editing || sharesQ.isPending}
                    title={editing ? 'Finish or cancel the edit first.' : undefined}
                    onClick={() => setShareOpen(true)}
                  >
                    Share
                  </Button>
                )}
                {shown ? (
                  <Button variant="danger" disabled={editing} onClick={() => setConfirmTakeDown(true)}>
                    Take down
                  </Button>
                ) : (
                  <Button variant="secondary" disabled={editing} loading={putBackUpM.isPending} onClick={() => putBackUpM.mutate()}>
                    Put back up
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Banners: every action's error, and the states worth a sentence. */}
      {banner && <ErrorBanner title={banner.title} error={banner.error} onDismiss={() => setBanner(null)} />}
      {elsewhere && (
        // Only what you both changed is named, and Keep mine says exactly what it replaces (C8).
        <NextStepBanner tone="warning" title="This report was changed somewhere else while you were editing.">
          You both changed {elsewhereWords.what || 'the same thing'}{draftMode ? ', and nothing more is saved until you choose' : ''}:{' '}
          <button type="button" className="font-semibold underline underline-offset-2 hover:opacity-80" onClick={() => resolveElsewhere(true)}>
            Keep mine
          </button>
          {elsewhereWords.replaces ? ` (it replaces ${elsewhereWords.replaces})` : ''} or{' '}
          <button type="button" className="font-semibold underline underline-offset-2 hover:opacity-80" onClick={() => resolveElsewhere(false)}>
            Use theirs
          </button>
          . Anything else either of you changed is kept.
        </NextStepBanner>
      )}
      {notice && noticeOf(notice) && (
        <NextStepBanner tone={noticeOf(notice).tone} title={noticeOf(notice).title} action={{ label: 'Got it', onClick: () => setNotice(null) }}>
          {noticeOf(notice).text}
        </NextStepBanner>
      )}
      {aheadParam && draftMode && (
        <NextStepBanner tone="warning" title="This period hasn’t started yet." action={{ label: 'Got it', onClick: dismissAhead }}>
          It starts {formatPeriod(report.weekStart)}, so its numbers stay empty until then. Recompute once it’s under way.
        </NextStepBanner>
      )}
      {draftMode && saveState.status === 'error' && <ErrorBanner title="Couldn’t save your latest change." error={saveState.error} />}
      {justPublished && shown && (hasUsableLink ? (
        <NextStepBanner tone="success" title="Published." action={linkList ? { label: 'Copy the message for your client', onClick: () => setShareOpen(true) } : null}>
          Your client can see it now.
        </NextStepBanner>
      ) : (
        // No link can open THIS report yet (WALK-5; §D — links to other reports don't count): say what
        // is missing, not "your client can see it". Share makes the link, here.
        <NextStepBanner
          tone="success"
          title="Published — create a link so your client can open it."
          action={sharesQ.isPending ? null : { label: 'Share', onClick: () => setShareOpen(true) }}
        />
      ))}
      {published && report.takenDownAt && (
        <NextStepBanner tone="warning" title={`Taken down ${formatDayOf(report.takenDownAt, tz)}.`}>
          Your client can’t see it. It stays exactly as it was; Put back up shows it again with its original publish date.
        </NextStepBanner>
      )}
      {restorable && published && !editing && (
        // Your changes go back on top of whatever the report holds now (it may have moved since).
        <NextStepBanner tone="info" title="You have an unsent edit." action={{ label: 'Restore your unsent edit', onClick: () => openEdit(restorable) }}>
          From {formatInTz(restorable.at, tz)}, kept on this device.{' '}
          <button type="button" className="underline underline-offset-2" onClick={discardCopy}>
            Discard it
          </button>
        </NextStepBanner>
      )}
      {restorable && draftMode && !elsewhere && (
        // A draft change the way out may not have landed (P-3). Restored onto a screen with nothing
        // unsaved, so it merges cleanly with what the report holds now.
        <NextStepBanner tone="warning" title="A change you made didn’t save before you left.">
          From {formatInTz(restorable.at, tz)}, kept on this device.{' '}
          <button
            type="button"
            className="font-semibold underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
            disabled={saveState.dirty}
            title={saveState.dirty ? 'Wait for your latest change to save first.' : undefined}
            onClick={() => restoreDraftCopy(restorable)}
          >
            Restore it
          </button>{' '}
          or{' '}
          <button type="button" className="underline underline-offset-2" onClick={discardCopy}>
            discard it
          </button>
          .
        </NextStepBanner>
      )}
      {buildState && !buildState.teamChanged && (
        <BuildStatus
          state={
            buildState.status === 'ready' && build?.result?.statsComputedAt
              ? { ...buildState, detail: `Built ${formatInTz(build.result.statsComputedAt, tz)} — nothing changes for your client until you apply them.` }
              : buildState
          }
          busy={cancelM.isPending ? 'cancel' : recomputeM.isPending || refreshM.isPending || remapRetryM.isPending ? 'retry' : null}
          onCancel={() => cancelM.mutate()}
          onRetry={() => {
            if (build?.kind === 'refresh') return setRefreshOpen(true);
            if (build?.kind === 'remap') return remapRetryM.mutate();
            return recomputeM.mutate();
          }}
          onReview={() => setRefreshOpen(true)}
        />
      )}
      {buildState?.teamChanged && (
        <TeamChangedCard
          campaignId={campaignId}
          reportId={id}
          teamSeriesId={teamSeriesId}
          teamLabel={teamRow?.label || scopeName}
          onResolved={(b) => {
            if (b) qc.setQueryData(buildKey(id), b);
            qc.invalidateQueries({ queryKey: seriesKey(campaignId) });
            qc.invalidateQueries({ queryKey: ['admin', 'client-report-team-changed'] });
            invalidate(false);
          }}
          // Once the team's row is known. An ended team is never offered End again (ADMINUX-10): its
          // Change crews is TeamDialog's Continue.
          onChangeCrews={teamRow ? () => setTeam({ series: teamRow }) : undefined}
          onEnd={teamRow && !teamRow.ended ? () => setTeam({ series: teamRow, initialEnding: true }) : undefined}
        />
      )}

      {wide ? (
        <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-start gap-6">
          <Card className="p-4">{settingsColumn}</Card>
          <Card className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto p-4">{previewColumn}</Card>
        </div>
      ) : (
        <div className="space-y-3">
          <Segmented
            options={[
              { value: 'settings', label: draftMode || editing ? 'Settings' : 'Report' },
              { value: 'preview', label: 'Preview' },
            ]}
            value={pane}
            onChange={setPane}
          />
          <Card className="p-4">{pane === 'settings' ? settingsColumn : previewColumn}</Card>
        </div>
      )}

      {/* Dialogs */}
      {publishOpen && draftMode && (
        <PublishDialog
          report={report}
          checks={checks}
          build={build}
          shares={linkList}
          tz={tz}
          previewFresh={previewFresh}
          mapStale={!!mapStale}
          busy={publishM.isPending}
          error={publishM.error}
          onClose={() => setPublishOpen(false)}
          onPublish={() => publishM.mutate()}
          onRecompute={() => {
            setPublishOpen(false);
            recomputeM.mutate();
          }}
        />
      )}
      {refreshOpen && (
        <RefreshDialog
          report={report}
          build={build}
          live={live}
          served={served}
          breakdowns={breakdowns}
          visibleKeys={report.visibility?.visibleQuestionKeys || []}
          deps={deps}
          campaignType={report.campaignType || campaign?.type}
          tz={tz}
          busy={refreshM.isPending || applyM.isPending || discardM.isPending}
          error={refreshM.error || applyM.error || discardM.error}
          onClose={() => {
            refreshM.reset();
            applyM.reset();
            discardM.reset();
            setRefreshOpen(false);
          }}
          onStart={(body) => refreshM.mutate(body)}
          onApply={() => applyM.mutate()}
          onDiscard={() => discardM.mutate(undefined, { onSuccess: () => setRefreshOpen(false) })}
          onRebuild={() => discardM.mutate()}
          onCancelBuild={() => cancelM.mutate()}
        />
      )}
      {shareOpen && shown && (
        <ShareDialog
          report={{ ...messageReportOf(shaped ? { ...shaped, seriesLabel: data.seriesLabel } : { ...report, id: String(report._id), seriesLabel: data.seriesLabel }), campaignType: report.campaignType || campaign?.type }}
          // Null until the links list is here (code review LINK-3): Share then waits, or says it failed.
          shares={sharesQ.data ? shares : null}
          linksError={sharesQ.error}
          campaignId={campaignId}
          tz={tz}
          isAdmin={isOrgAdmin}
          onClose={() => setShareOpen(false)}
          // A link made here: the list (the banner, the header's opens and Take down read it) and History.
          onLinksChanged={() => {
            qc.invalidateQueries({ queryKey: sharesKey(campaignId) });
            qc.invalidateQueries({ queryKey: historyKey(campaignId) });
          }}
        />
      )}
      {confirmUpdate && unsentDiff && (
        <ConfirmDialog
          title="Update the report?"
          confirmLabel="Update report"
          busy={updateM.isPending}
          // A version refusal (C8) isn't shown: the page merges and sends your changes again, or asks.
          error={updateM.error?.code === 'CHANGED_ELSEWHERE' ? null : updateM.error}
          onClose={() => setConfirmUpdate(false)}
          onConfirm={() => updateM.mutate(unsentDiff)}
        >
          {/* A switch to areas alone isn't seen "right away" — the areas sentence below says when (WALK-8). */}
          {switchOnly ? (
            !shown && <p>The report is taken down, so your client sees the areas when you put it back up.</p>
          ) : shown ? (
            <p>Your client sees the change right away, marked “Edited {formatDayOf(new Date(), tz)}”. The numbers stay as they were.</p>
          ) : (
            <p>The report is taken down, so your client sees the change when you put it back up. The numbers stay as they were.</p>
          )}
          {(unsentDiff.title !== undefined || unsentDiff.observations !== undefined) && <p>Team leads on this campaign can see the earlier text in History.</p>}
          {unsentDiff.visibility?.showMap === false && <p className="text-warning-fg">This deletes the frozen map; turning it back on rebuilds every number.</p>}
          {unsentDiff.visibility?.mapMode === 'area' && (
            <p>Your client keeps seeing exact doors until the areas are ready. Going back to exact doors later means refreshing the numbers.</p>
          )}
        </ConfirmDialog>
      )}
      {confirmMapOff && (
        <ConfirmDialog
          title="Turn off the map?"
          confirmLabel="Turn off the map"
          danger
          onClose={() => setConfirmMapOff(false)}
          onConfirm={() => {
            setConfirmMapOff(false);
            change({ ...settings, visibility: { ...settings.visibility, showMap: false } });
          }}
        >
          <p>This deletes the frozen map when you update the report; turning it back on rebuilds every number with Refresh numbers.</p>
        </ConfirmDialog>
      )}
      {confirmAreas && (
        <ConfirmDialog
          title="Switch to areas?"
          confirmLabel="Switch to areas"
          onClose={() => setConfirmAreas(null)}
          onConfirm={() => {
            change({ ...settings, visibility: { ...settings.visibility, mapMode: 'area', areaSize: confirmAreas === 'large' ? 'large' : 'small' } });
            setConfirmAreas(null);
          }}
        >
          <p>Your client keeps seeing exact doors until the areas are ready. Going back to exact doors later means refreshing the numbers.</p>
          {/* WALK-7: a single-choice map question may show no answers by area — say so before the switch. */}
          {areaCandidates.length > 0 && (
            <p>
              {areaCandidates.length === 1
                ? `“${areaCandidates[0]}” shows answers area by area only when every area has at least five answers to it — otherwise your client sees just its chart. Once the areas are ready, this page says if it doesn’t.`
                : `${andList(areaCandidates.map((l) => `“${l}”`))} show answers area by area only when every area has at least five answers to them — otherwise your client sees just their charts. Once the areas are ready, this page says which ones don’t.`}
            </p>
          )}
          <p className="text-xs">It starts when you press Update report, and builds in the background.</p>
        </ConfirmDialog>
      )}
      {confirmCancel && (
        <ConfirmDialog title="Throw away your edit?" confirmLabel="Throw it away" danger onClose={() => setConfirmCancel(false)} onConfirm={cancelEdit}>
          <p>Nothing you changed reaches your client, and the copy kept on this device is deleted.</p>
        </ConfirmDialog>
      )}
      {confirmTakeDown && (
        <ConfirmDialog
          title="Take down this report?"
          confirmLabel="Take down"
          busy={takeDownM.isPending}
          error={takeDownM.error}
          onClose={() => setConfirmTakeDown(false)}
          onConfirm={() => takeDownM.mutate()}
        >
          <p>Your client stops seeing it. It stays exactly as it was — numbers, map and publish date — and Put back up shows it again.</p>
          {takeDownLinks && <p>{takeDownLinks}</p>}
          <p>Any build or new numbers waiting for review are cancelled.</p>
        </ConfirmDialog>
      )}
      {team?.series && (
        <TeamDialog
          mode="edit"
          campaignId={campaignId}
          series={team.series}
          picker={seriesQ.data}
          openDrafts={draftMode ? 1 : 0}
          initialEnding={!!team.initialEnding}
          onClose={() => setTeam(null)}
          // Returned so the dialog stays busy until the team list is fresh (TeamDialog's mutation
          // waits on it): the card under it never shows the team as it was — an ended team still
          // ended after Continue, say.
          onSaved={() => {
            invalidate(false);
            return Promise.all([
              qc.invalidateQueries({ queryKey: seriesKey(campaignId) }),
              qc.invalidateQueries({ queryKey: ['admin', 'client-report-team-changed'] }),
            ]).then(() => setTeam(null));
          }}
          onEnded={(_s, { deletedDrafts } = {}) => {
            setTeam(null);
            qc.invalidateQueries({ queryKey: seriesKey(campaignId) });
            invalidate();
            if (deletedDrafts) navigate(`/campaigns/${campaignId}/reports`);
          }}
        />
      )}
    </div>
  );
};

export default ClientReportBuilderPage;
