import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useCurrentCampaign } from '../lib/useCurrentCampaign.js';
import { CampaignLoading, CampaignMissing } from '../components/campaigns/CampaignGate.jsx';
import { Button, Card, IconChevronDown, IconChevronRight, Skeleton, Tabs } from '../components/ui/index.js';
import ReportRow, { deleteWarning } from '../components/clientReports/ReportRow.jsx';
import RetiredLinksCard from '../components/clientReports/RetiredLinksCard.jsx';
import BrandingCard from '../components/clientReports/BrandingCard.jsx';
import NewReportDialog from '../components/clientReports/NewReportDialog.jsx';
import TeamDialog from '../components/clientReports/TeamDialog.jsx';
import HistoryDrawer from '../components/clientReports/HistoryDrawer.jsx';
import ShareDialog from '../components/clientReports/ShareDialog.jsx';
import HowItWorks, { useHowItWorks } from '../components/clientReports/HowItWorks.jsx';
import { HOW_IT_WORKS_LINK, INTRO } from '../components/clientReports/howItWorksCopy.js';
import { ConfirmDialog, ErrorBanner } from '../components/clientReports/parts.jsx';
import { teamChangedKey } from '../components/clientReports/TeamChangedCard.jsx';
import { buildKey, historyKey, reportKey, reportsKey, seriesKey, sharesKey } from '../components/clientReports/hooks.js';
import { formatPeriod, gapsAbove, todayIn } from '../components/clientReports/reportDates.js';
import { linksFor, takeDownLinksText } from '../components/clientReports/linkState.js';
import { messageReportOf } from '../components/clientReports/copyMessage.js';

// The campaign's Client Reports tab (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G1; how it works:
// docs/CLIENT_PORTAL.md). Reports are grouped into the tabs your client sees — the whole campaign,
// each team, each walk list — newest first, with a gap line between two reports that leave days
// uncovered. Beside them: the report branding (below `lg` it stacks under the reports). History opens
// the tab's own History drawer, which the campaign's general History and the phone never show.
//
// docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md: the header says what the page is for in one line, ending in
// How it works, which brings back the guide (§B) at the top of the reports card until that person
// presses Got it. Next report refused NEXT_GAP_TOO_LONG opens New report with the suggested dates picked
// (§C); so does a link to this page carrying ?new=1&seriesId=&weekStart=&weekEnd= (contract K10 —
// nothing in the app sends it yet: the builder has no Next button, and a row's Next opens the dialog
// itself), and the page then drops those params.
//
// docs/PROPOSAL_CLIENT_REPORT_LINKS.md §D3 — one link per report, and Archive:
//   · Each report's link lives with its report: Share on its row, and the row's link line. The Client
//     links panel is gone. Old links to all your reports sit in their own card ABOVE the reports, at
//     every width, only while the campaign has any (RetiredLinksCard, worded by the switch).
//   · A tab lists its reports that aren't archived, then Archived (N), folded. The newest report of each
//     kind is never folded: archived, it stays in the list, marked Archived, with Unarchive — that's
//     where Next report lives. Gap lines are worked out over ALL the tab's reports, archived ones too,
//     so an archived report still covers its days, and each is drawn with the row it sits above. The
//     tab counts reports that aren't archived. Archive says where the report went, with Undo.
//   · Take down and Delete say what happens to the report's own link (ReportRow's words).

const NEW_REPORT_PARAMS = ['new', 'seriesId', 'weekStart', 'weekEnd'];
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');

// New report's Covers for a series row: its team, its walk list, or the whole campaign.
const scopeOfSeries = (s) => ({
  teamId: s?.kind === 'team' ? s.id : s?.kind === 'team_walk_list' ? s.teamSeriesId || null : null,
  effortId: s?.kind === 'walk_list' || s?.kind === 'team_walk_list' ? s.effortId || null : null,
});

const KIND_ORDER = { campaign: 0, team: 1, team_walk_list: 1, walk_list: 2 };

// The tabs: one per series that has reports, plus every active team (so a team made a moment ago
// shows before its first report). A report from before series groups by its opaque key.
const tabsOf = (reports, series) => {
  const byId = new Map(series.map((s) => [s.id, s]));
  const tabs = new Map();
  for (const r of reports) {
    const key = r.seriesId || r.seriesKey;
    if (!tabs.has(key)) {
      const s = r.seriesId ? byId.get(r.seriesId) : null;
      tabs.set(key, {
        key,
        series: s || null,
        label: s?.label || r.seriesLabel || r.scope?.label || r.effortName || 'Whole campaign',
        kind: s?.kind || r.scope?.kind || (r.effortName ? 'walk_list' : 'campaign'),
        ended: !!s?.ended,
        reports: [],
      });
    }
    tabs.get(key).reports.push(r);
  }
  for (const s of series) {
    if (s.kind === 'team' && !s.ended && !tabs.has(s.id)) tabs.set(s.id, { key: s.id, series: s, label: s.label, kind: 'team', ended: false, reports: [] });
  }
  return [...tabs.values()].sort((a, b) => (KIND_ORDER[a.kind] ?? 3) - (KIND_ORDER[b.kind] ?? 3) || a.label.localeCompare(b.label));
};

/**
 * A tab's reports, as the list shows them (§D3): `listed` — every report that isn't archived, and the
 * newest of each kind whatever it is; `folded` — the rest of the archived ones, under Archived (N).
 * `newest` holds the ids of the newest dated report and the newest all-time one (the list comes newest
 * first, as the server sends it).
 */
const foldOf = (reports = []) => {
  const newest = new Set([false, true].map((allTime) => reports.find((r) => !!r.allTime === allTime)?.id).filter(Boolean));
  return {
    newest,
    listed: reports.filter((r) => !r.archivedAt || newest.has(r.id)),
    folded: reports.filter((r) => r.archivedAt && !newest.has(r.id)),
  };
};

// One row action (Next, Take down, Delete, Cancel, Retry…): a mutation that marks which row's which
// button is busy, and clears the page's error banner when it starts.
const useRowAction = (kind, fn, { setBusy, setError }) =>
  useMutation({
    mutationFn: ({ row, ...rest }) => fn(row, rest),
    onMutate: ({ row }) => {
      setBusy({ id: row.id, kind });
      setError(null);
    },
    onSettled: () => setBusy(null),
  });

const ClientReportsPage = () => {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { isOrgAdmin, user } = useAuth();
  const { campaign, resolving, notFound } = useCurrentCampaign(campaignId);
  const tz = campaign?.timeZone || 'America/New_York';
  const guide = useHowItWorks(user?.id);
  const [guideFocus, setGuideFocus] = useState(0); // bumped by How it works: bring the guide into view
  // Got it takes the guide away: the keyboard goes to How it works, which brings it back (FRESH-4).
  const howItWorksRef = useRef(null);
  const dismissGuide = () => {
    guide.dismiss();
    howItWorksRef.current?.focus();
  };

  const reportsQ = useQuery({
    queryKey: reportsKey(campaignId),
    queryFn: () => api(`/admin/client-reports?campaignId=${campaignId}`),
    enabled: !!campaignId,
  });
  const seriesQ = useQuery({
    queryKey: seriesKey(campaignId),
    queryFn: () => api(`/admin/client-reports/series?campaignId=${campaignId}`),
    enabled: !!campaignId,
  });
  // The campaign's links (contract K1), on the key Share and the old-links card read too, so a row's
  // link line, Share and the card never disagree — with the switch (old links to all your reports
  // turned off for everyone) and whether this person is Doorline staff under a support grant.
  const sharesQ = useQuery({
    queryKey: sharesKey(campaignId),
    queryFn: () => api(`/admin/client-reports/shares?campaignId=${campaignId}`),
    enabled: !!campaignId,
  });
  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId,
  });

  const reports = useMemo(() => reportsQ.data?.reports || [], [reportsQ.data]);
  const series = useMemo(() => seriesQ.data?.series || [], [seriesQ.data]);
  const shares = sharesQ.data?.shares || [];
  // Null until the links list is here: no row says anything about its link meanwhile.
  const linkList = sharesQ.data ? shares : null;
  const allReportsRetired = !!sharesQ.data?.allReportsRetired;
  const staffUnderGrant = !!sharesQ.data?.staffUnderGrant;
  const efforts = effortsQ.data?.efforts || [];
  const tabs = useMemo(() => tabsOf(reports, series), [reports, series]);
  const wanted = params.get('tab');
  const active = tabs.find((t) => t.key === wanted) || tabs.find((t) => t.kind === 'campaign') || tabs[0] || null;
  // The days the tab's dated reports skipped, each above the report they follow (reportDates.js
  // gapsAbove) — over every report of the tab, archived ones too: an archived report still covers its
  // days, so folding it away never makes a "not covered" line appear.
  const gaps = gapsAbove(active?.reports || []);
  const fold = foldOf(active?.reports || []);
  const reportsById = useMemo(() => new Map(reports.map((r) => [r.id, r])), [reports]);

  const [newReport, setNewReport] = useState(null); // { initial } while the dialog is open
  const [team, setTeam] = useState(null); // { mode, series, initialEnding, back } — back: reopen New report
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareFor, setShareFor] = useState(null); // the row whose Share is open
  const [confirm, setConfirm] = useState(null); // { kind: 'delete' | 'takeDown', row }
  const [eraseToo, setEraseToo] = useState(false);
  const [busy, setBusy] = useState(null); // { id, kind } — which row's which action is running
  const [error, setError] = useState(null);
  const [openFolds, setOpenFolds] = useState(() => new Set()); // the tabs whose Archived (N) is open
  const [archivedNote, setArchivedNote] = useState(null); // { id } — the report Archive just folded away
  // Where the keyboard goes after Archive and Unarchive (code review CC-6): the button pressed folds away
  // or moves with its row, and the focus would drop to <body>. Archive hands it to its line's Undo;
  // Unarchive — Undo's too — to the report's row, back in the list: its Archive, or Open on the newest of
  // its kind, which has none (ReportRow marks both). A new object each time; focus only, nothing to stop.
  const [focusTo, setFocusTo] = useState(null); // { at: 'undo' } | { at: 'row', id }
  const undoRef = useRef(null);
  const panelRef = useRef(null);
  // The reports card's heading, which takes the keyboard when the old-links card above it goes with its
  // last link's Delete (code review V2-1; RetiredLinksCard hands it over).
  const reportsHeadingRef = useRef(null);

  const refresh = (reportId) => {
    qc.invalidateQueries({ queryKey: reportsKey(campaignId) });
    qc.invalidateQueries({ queryKey: historyKey(campaignId) });
    if (reportId) qc.invalidateQueries({ queryKey: reportKey(reportId) });
  };
  const refreshSeries = () => {
    qc.invalidateQueries({ queryKey: seriesKey(campaignId) });
    qc.invalidateQueries({ queryKey: ['admin', 'client-report-team-changed'] });
  };
  const marks = { setBusy, setError };
  const nextM = useRowAction('next', (row) => api(`/admin/client-reports/${row.id}/next`, { method: 'POST' }), marks);
  const takeDownM = useRowAction('takeDown', (row) => api(`/admin/client-reports/${row.id}/take-down`, { method: 'POST' }), marks);
  const putBackUpM = useRowAction('putBackUp', (row) => api(`/admin/client-reports/${row.id}/put-back-up`, { method: 'POST' }), marks);
  // An admin may erase the report's earlier text from History in the same act (§O8).
  const deleteM = useRowAction('delete', (row, { erase }) => api(`/admin/client-reports/${row.id}${erase ? '?eraseHistory=1' : ''}`, { method: 'DELETE' }), marks);
  const cancelM = useRowAction('cancel', (row) => api(`/admin/client-reports/${row.id}/build/cancel`, { method: 'POST' }), marks);
  const retryM = useRowAction('retry', (row) => api(`/admin/client-reports/${row.id}/recompute`, { method: 'POST' }), marks);
  // Archive and Unarchive (contract K7): each a compare-and-set on the server, so a repeat changes nothing.
  const archiveM = useRowAction('archive', (row) => api(`/admin/client-reports/${row.id}/archive`, { method: 'POST' }), marks);
  const unarchiveM = useRowAction('unarchive', (row) => api(`/admin/client-reports/${row.id}/unarchive`, { method: 'POST' }), marks);

  const openReport = (row, { review = false } = {}) => navigate(`/campaigns/${campaignId}/reports/${row.id}${review ? '?review=1' : ''}`);
  const fail = (title) => (e) => setError({ title, error: e });
  const refreshShares = () => {
    qc.invalidateQueries({ queryKey: sharesKey(campaignId) });
    qc.invalidateQueries({ queryKey: historyKey(campaignId) });
  };
  // The list as it stands after Archive or Unarchive, at once — the fold and its count move with the
  // press; the list read again follows.
  const markArchived = (id, archivedAt) =>
    qc.setQueryData(reportsKey(campaignId), (d) => (d?.reports ? { ...d, reports: d.reports.map((r) => (r.id === id ? { ...r, archivedAt } : r)) } : d));
  const archive = (row) =>
    archiveM.mutate(
      { row },
      {
        onSuccess: (res) => {
          markArchived(row.id, res?.report?.archivedAt || new Date().toISOString());
          setArchivedNote({ id: row.id });
          setFocusTo({ at: 'undo' });
          refresh(row.id);
        },
        onError: fail('Couldn’t archive the report.'),
      }
    );
  const unarchive = (row) =>
    unarchiveM.mutate(
      { row },
      {
        onSuccess: () => {
          markArchived(row.id, null);
          setArchivedNote((x) => (x?.id === row.id ? null : x));
          setFocusTo({ at: 'row', id: row.id });
          refresh(row.id);
        },
        onError: fail('Couldn’t unarchive the report.'),
      }
    );

  // Contract K10: ?new=1&seriesId=&weekStart=&weekEnd= opens New report on that series' tab with those
  // dates picked (a link made for it — no page in the app sends one yet), once the series list is here;
  // then the params go, so a reload or Back doesn't open it again. Sets state only — nothing to stop.
  const seriesData = seriesQ.data;
  useEffect(() => {
    if (params.get('new') !== '1' || !seriesData) return;
    const seriesId = params.get('seriesId');
    const row = seriesId ? (seriesData.series || []).find((x) => x.id === seriesId) || null : null;
    const weekStart = params.get('weekStart');
    const weekEnd = params.get('weekEnd');
    setNewReport({ initial: { ...scopeOfSeries(row), ...(isDay(weekStart) && isDay(weekEnd) ? { dates: { weekStart, weekEnd } } : {}) } });
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        NEW_REPORT_PARAMS.forEach((k) => next.delete(k));
        if (row) next.set('tab', row.id);
        return next;
      },
      { replace: true }
    );
  }, [params, seriesData, setParams]);

  // Archive's and Unarchive's focus (above), once the screen that follows them is drawn.
  useEffect(() => {
    if (!focusTo) return;
    if (focusTo.at === 'undo') {
      undoRef.current?.focus();
      return;
    }
    const rowEl = panelRef.current?.querySelector(`[data-report-row="${focusTo.id}"]`);
    (rowEl?.querySelector('[data-row-action="archive"]') || rowEl?.querySelector('[data-row-action="open"]'))?.focus();
  }, [focusTo]);

  if (resolving) return <CampaignLoading />;
  if (notFound) return <CampaignMissing />;

  const listUpdatedAt = reportsQ.dataUpdatedAt;
  // Take down says what happens to the report's own link (§D2): it shows "taken down" until it's back up.
  const takeDownLine = confirm?.kind === 'takeDown' ? takeDownLinksText(linksFor(linkList, confirm.row.id)) : '';
  const openDraftsOf = (teamId) => {
    const ids = new Set([teamId, ...series.filter((s) => s.teamSeriesId === teamId).map((s) => s.id)]);
    return reports.filter((r) => r.status === 'draft' && ids.has(r.seriesId)).length;
  };
  const teamRowOf = (id) => series.find((s) => s.id === id) || null;
  const tabTeam = active?.kind === 'team' ? active.series : active?.kind === 'team_walk_list' ? teamRowOf(active.series?.teamSeriesId) : null;
  const initialScope = active
    ? {
        teamId: active.kind === 'team' ? active.series?.id : active.kind === 'team_walk_list' ? active.series?.teamSeriesId : null,
        effortId: active.kind === 'walk_list' || active.kind === 'team_walk_list' ? active.series?.effortId || null : null,
      }
    : {};
  const foldOpen = !!active && openFolds.has(active.key);
  const toggleFold = (key) =>
    setOpenFolds((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // Archive's line stays while the report it folded away is in this tab's Archived (N).
  const noted = archivedNote && fold.folded.some((r) => r.id === archivedNote.id) ? reportsById.get(archivedNote.id) : null;
  // Every report of the tab archived: say where they went — once some are folded away to open.
  const allArchived = !!active && active.reports.length > 0 && active.reports.every((r) => r.archivedAt) && fold.folded.length > 0;
  // Share reads the report as it stands in the list (taken down meanwhile, it says so).
  const shareRow = shareFor ? reportsById.get(shareFor.id) || shareFor : null;

  const renderRow = (row) => {
    // The days the tab's dated reports skipped, above the report they follow (gapsAbove).
    const gap = gaps.get(row.id) || null;
    // Next report sits on the newest report of each kind (§N): the tab's newest dated report, and its
    // newest all-time one unless that already runs through today (Refresh numbers). Archive never does.
    const newestOfKind = fold.newest.has(row.id);
    const isLatest = newestOfKind && !(row.allTime && row.weekEnd >= todayIn(row.timeZone));
    return (
      <Fragment key={row.id}>
        {gap && (
          <li className="py-2 text-center text-xs text-fg-subtle" aria-label="Gap between reports">
            ── {formatPeriod(gap.start, gap.end)} not covered by any report ──
          </li>
        )}
        <ReportRow
          row={row}
          campaignId={campaignId}
          campaignType={row.campaignType || campaign?.type}
          listUpdatedAt={listUpdatedAt}
          isLatest={isLatest}
          newestOfKind={newestOfKind}
          seriesEnded={active.ended}
          teamLabel={tabTeam?.label || active.label}
          // Null until the links list is here, so a row never says "No link of its own yet" while it loads.
          shares={linkList}
          allReportsRetired={allReportsRetired}
          tz={tz}
          busy={busy}
          onOpen={openReport}
          onNext={(r) =>
            nextM.mutate(
              { row: r },
              {
                onSuccess: (res) => {
                  refresh();
                  // Next warns when the new period starts after today (§F10); the builder says so. Next
                  // onto a report that's archived lands there too, and the builder says it's archived.
                  const ahead = (res.warnings || []).includes('STARTS_AFTER_TODAY');
                  navigate(`/campaigns/${campaignId}/reports/${res.report._id}${ahead ? '?ahead=1' : ''}`);
                },
                onError: (e) => {
                  // A catch-up past 14 days is never made in one click (SIMPLIFY §C): New
                  // report opens on this tab with the suggested dates picked, naming the gap.
                  if (e.code === 'NEXT_GAP_TOO_LONG' && e.data?.suggested) {
                    // The server's sentence says why, at the top of the dates (FRESH-3).
                    setNewReport({ initial: { ...initialScope, dates: e.data.suggested, notice: e.data.error || e.message || null } });
                    return;
                  }
                  fail('Couldn’t start the next report.')(e);
                },
              }
            )
          }
          onShare={(r) => setShareFor(r)}
          onArchive={archive}
          onUnarchive={unarchive}
          onTakeDown={(r) => setConfirm({ kind: 'takeDown', row: r })}
          onPutBackUp={(r) => putBackUpM.mutate({ row: r }, { onSuccess: () => refresh(r.id), onError: fail('Couldn’t put the report back up.') })}
          onDelete={(r) => {
            setEraseToo(false);
            setConfirm({ kind: 'delete', row: r });
          }}
          onCancelBuild={(r) =>
            cancelM.mutate(
              { row: r },
              {
                onSuccess: () => {
                  qc.setQueryData(buildKey(r.id), { status: 'idle' });
                  refresh(r.id);
                },
                onError: fail('Couldn’t cancel the build.'),
              }
            )
          }
          onRetry={(r, build) => {
            // A draft's numbers retry here; a refresh or a switch to areas retries in the builder,
            // where its choices live.
            if (build?.kind && build.kind !== 'recompute') return openReport(r);
            retryM.mutate(
              { row: r },
              {
                onSuccess: (res) => {
                  if (res?.build) qc.setQueryData(buildKey(r.id), res.build);
                  refresh(r.id);
                },
                onError: fail('Couldn’t start the build again.'),
              }
            );
            return undefined;
          }}
          onSettled={(id) => refresh(id)}
          onTeamResolved={(id) => {
            qc.removeQueries({ queryKey: buildKey(id) });
            refreshSeries();
            refresh(id);
          }}
          onChangeCrews={(id) => setTeam({ mode: 'edit', series: teamRowOf(id) })}
          onEndTeam={(id) => setTeam({ mode: 'edit', series: teamRowOf(id), initialEnding: true })}
        />
      </Fragment>
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-fg">Client Reports</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">
            {INTRO}{' '}
            <button
              ref={howItWorksRef}
              type="button"
              className="font-semibold text-brand-accent hover:underline"
              onClick={() => {
                guide.reopen();
                setGuideFocus((n) => n + 1);
              }}
            >
              {HOW_IT_WORKS_LINK}
            </button>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setNewReport({ initial: initialScope })} disabled={!seriesQ.data}>
            New report
          </Button>
          <Button variant="secondary" onClick={() => setHistoryOpen(true)}>
            History
          </Button>
        </div>
      </div>

      {error && <ErrorBanner title={error.title} error={error.error} onDismiss={() => setError(null)} />}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          {/* Old links to all your reports, above the reports at every width — nothing when there are none. */}
          <RetiredLinksCard
            campaignId={campaignId}
            tz={tz}
            shares={shares}
            allReportsRetired={allReportsRetired}
            staffUnderGrant={staffUnderGrant}
            onChanged={refreshShares}
            afterRef={reportsHeadingRef}
          />
          <Card className="min-w-0 p-4">
            <h2 ref={reportsHeadingRef} tabIndex={-1} className="sr-only">
              Reports
            </h2>
            {/* The guide sits above the tabs; on an empty page it stands where "No reports yet" would. */}
            {guide.open && <HowItWorks onDismiss={dismissGuide} focusAt={guideFocus} />}
            {reportsQ.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            ) : reportsQ.isError ? (
              <ErrorBanner title="Couldn’t load the reports." error={reportsQ.error} />
            ) : tabs.length === 0 ? (
              guide.open ? null : (
                <div className="py-8 text-center">
                  <p className="text-sm font-medium text-fg">No reports yet.</p>
                  <p className="mt-1 text-sm text-fg-muted">Create a draft for a period — its numbers build in the background, and you publish when it looks right.</p>
                  <Button className="mt-4" onClick={() => setNewReport({ initial: {} })} disabled={!seriesQ.data}>
                    New report
                  </Button>
                </div>
              )
            ) : (
              <>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <Tabs
                    label="Report tabs"
                    className="min-w-0 flex-1"
                    value={active?.key}
                    onChange={(key) => setParams((p) => {
                      const next = new URLSearchParams(p);
                      next.set('tab', key);
                      return next;
                    }, { replace: true })}
                    // The count is the reports in the list: archived ones aren't counted.
                    tabs={tabs.map((t) => ({ key: t.key, label: t.ended ? `${t.label} (ended)` : t.label, count: t.reports.filter((r) => !r.archivedAt).length }))}
                  />
                  {tabTeam && !tabTeam.ended && (
                    <Button size="sm" variant="secondary" className="mb-1.5" onClick={() => setTeam({ mode: 'edit', series: tabTeam })}>
                      Edit team
                    </Button>
                  )}
                  {/* An ended team's tab offers Continue, never End again (ADMINUX-10). */}
                  {tabTeam?.ended && (
                    <Button size="sm" variant="secondary" className="mb-1.5" onClick={() => setTeam({ mode: 'continue', series: tabTeam })}>
                      Continue this team
                    </Button>
                  )}
                  {active?.kind === 'walk_list' && active.series && !active.ended && (
                    <Button size="sm" variant="secondary" className="mb-1.5" onClick={() => setTeam({ mode: 'rename', series: active.series })}>
                      Rename
                    </Button>
                  )}
                </div>
                {active && active.reports.length === 0 && (
                  <p className="py-6 text-sm text-fg-muted">No reports for {active.label} yet. New report starts one.</p>
                )}
                {allArchived && <p className="pt-4 text-sm text-fg-muted">Every report here is archived — open Archived below, or press New report.</p>}
                {noted && (
                  <div role="status" className="mt-3 flex items-start gap-3 text-xs text-success-fg">
                    <span className="flex-1">
                      Archived — it’s under Archived ({fold.folded.length}) at the bottom.{' '}
                      <button ref={undoRef} type="button" onClick={() => unarchive(noted)} disabled={unarchiveM.isPending} className="font-semibold underline disabled:opacity-60">
                        {unarchiveM.isPending && busy?.id === noted.id ? 'Undoing…' : 'Undo'}
                      </button>
                    </span>
                    <button type="button" onClick={() => setArchivedNote(null)} className="shrink-0 font-semibold hover:opacity-70" aria-label="Dismiss">
                      ×
                    </button>
                  </div>
                )}
                {active && (
                  <div ref={panelRef} id={`panel-${active.key}`} role="tabpanel" aria-labelledby={`tab-${active.key}`}>
                    <ul className="divide-y divide-border">{fold.listed.map(renderRow)}</ul>
                    {fold.folded.length > 0 && (
                      <div className="border-t border-border pt-3">
                        <button
                          type="button"
                          className="flex items-center gap-1 text-xs font-semibold text-fg-muted hover:text-fg"
                          aria-expanded={foldOpen}
                          aria-controls={`archived-${active.key}`}
                          onClick={() => toggleFold(active.key)}
                        >
                          {foldOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                          Archived ({fold.folded.length})
                        </button>
                        {foldOpen && (
                          <ul id={`archived-${active.key}`} className="divide-y divide-border">
                            {fold.folded.map(renderRow)}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <BrandingCard isAdmin={isOrgAdmin} />
        </div>
      </div>

      {newReport && (
        <NewReportDialog
          campaignId={campaignId}
          campaignTz={tz}
          reports={reports}
          seriesData={seriesQ.data}
          efforts={efforts}
          initial={newReport.initial}
          isAdmin={isOrgAdmin}
          userId={user?.id || null}
          onClose={() => setNewReport(null)}
          // The tab already has a report for these dates (REPORT_EXISTS), or someone made it a moment ago.
          onOpenReport={(id) => {
            setNewReport(null);
            refresh();
            refreshSeries();
            navigate(`/campaigns/${campaignId}/reports/${id}`);
          }}
          onReportsChanged={() => {
            refresh();
            refreshSeries();
          }}
          // The organization's report week changed: every campaign's series picker carries it (K3).
          onWeekChanged={(weekStartsOn) => {
            qc.setQueryData(seriesKey(campaignId), (d) => (d ? { ...d, weekStartsOn } : d));
            qc.invalidateQueries({ queryKey: ['admin', 'client-report-series'] });
          }}
          onNewTeam={() => {
            // One dialog at a time: New team replaces New report, and hands back to it with the team picked.
            setNewReport(null);
            setTeam({ mode: 'new', series: null, back: newReport.initial });
          }}
          onContinueTeam={(teamId, carry) => {
            // The same hand-off for an ended team: Continue's picker, then back to New report on the
            // team, with the dates and title as they were (ADMINUX-10).
            const row = teamRowOf(teamId);
            if (!row) return refreshSeries();
            setNewReport(null);
            setTeam({ mode: 'continue', series: row, back: { ...newReport.initial, ...carry, teamId } });
            return undefined;
          }}
          onCreated={(res) => {
            setNewReport(null);
            refresh();
            refreshSeries();
            // Dates that start after today: POST / warns as Next does (STARTS_AFTER_TODAY), and the
            // builder says the numbers stay empty until then.
            const ahead = (res.warnings || []).includes('STARTS_AFTER_TODAY');
            navigate(`/campaigns/${campaignId}/reports/${res.report._id}${ahead ? '?ahead=1' : ''}`);
          }}
        />
      )}
      {team && (
        <TeamDialog
          key={`${team.mode}:${team.series?.id || 'new'}`}
          mode={team.mode}
          campaignId={campaignId}
          series={team.series}
          picker={seriesQ.data}
          openDrafts={team.series ? openDraftsOf(team.series.id) : 0}
          initialEnding={!!team.initialEnding}
          onClose={() => {
            if (team.back) setNewReport({ initial: team.back });
            setTeam(null);
          }}
          onSaved={(saved) => {
            const id = saved?._id || saved?.id;
            const back = team.back;
            refresh();
            // The dialog stays busy until the team list is fresh (its mutation awaits this promise), so
            // New report reopens on the new or continued team — never a stale "No team yet" or "has
            // ended" — and an ended tab never flashes Continue after it.
            return Promise.all([
              qc.invalidateQueries({ queryKey: seriesKey(campaignId) }),
              qc.invalidateQueries({ queryKey: ['admin', 'client-report-team-changed'] }),
            ]).then(() => {
              if (back) setNewReport({ initial: { ...back, teamId: id ? String(id) : back.teamId } });
              setTeam(null);
            });
          }}
          onEnded={() => {
            setTeam(null);
            refreshSeries();
            refresh();
          }}
        />
      )}
      {historyOpen && (
        <HistoryDrawer
          campaignId={campaignId}
          tz={tz}
          isAdmin={isOrgAdmin}
          reportsById={reportsById}
          onClose={() => setHistoryOpen(false)}
          onReportChanged={(id) => refresh(id)}
        />
      )}
      {shareRow && (
        <ShareDialog
          // The report as Share needs it (contract K12): its message fields, and whether the client can
          // see it — Share stays on a taken-down report to manage its link, with the message held.
          report={{
            ...messageReportOf(shareRow),
            campaignType: shareRow.campaignType || campaign?.type,
            status: shareRow.status,
            takenDownAt: shareRow.takenDownAt || null,
          }}
          // Null until the links list is here: Share waits for it rather than offer a link it may not need.
          shares={linkList}
          allReportsRetired={allReportsRetired}
          staffUnderGrant={staffUnderGrant}
          linksError={sharesQ.error}
          campaignId={campaignId}
          tz={tz}
          onClose={() => setShareFor(null)}
          onLinksChanged={refreshShares}
          // Create found the report taken down or deleted somewhere else (code review V2-2): the list is
          // read again, so Share shows it taken down — and its row offers Put back up — or its row goes.
          onReportChanged={() => refresh(shareRow.id)}
        />
      )}
      {confirm?.kind === 'takeDown' && (
        <ConfirmDialog
          title="Take down this report?"
          confirmLabel="Take down"
          busy={takeDownM.isPending}
          error={takeDownM.error}
          onClose={() => setConfirm(null)}
          onConfirm={() =>
            takeDownM.mutate(
              { row: confirm.row },
              {
                onSuccess: () => {
                  setConfirm(null);
                  refresh(confirm.row.id);
                },
              }
            )
          }
        >
          <p>Your client stops seeing it. It stays exactly as it was — numbers, map and publish date — and Put back up shows it again.</p>
          {takeDownLine && <p>{takeDownLine}</p>}
          <p>Any build or new numbers waiting for review are cancelled.</p>
        </ConfirmDialog>
      )}
      {confirm?.kind === 'delete' && (
        <ConfirmDialog
          title={confirm.row.status === 'draft' ? 'Delete this draft?' : 'Delete this report?'}
          confirmLabel="Delete"
          danger
          busy={deleteM.isPending}
          error={deleteM.error}
          onClose={() => setConfirm(null)}
          onConfirm={() =>
            deleteM.mutate(
              { row: confirm.row, erase: eraseToo },
              {
                onSuccess: () => {
                  setConfirm(null);
                  qc.removeQueries({ queryKey: reportKey(confirm.row.id) });
                  setArchivedNote((x) => (x?.id === confirm.row.id ? null : x));
                  refresh();
                  // Its link went with it (§D "Cascade") — the server's word, not this list's.
                  if (confirm.row.status === 'published') refreshShares();
                },
              }
            )
          }
        >
          {deleteWarning({ row: confirm.row, shares: linkList, allReportsRetired }).map((line) => (
            <p key={line.text} className={line.tone === 'danger' ? 'text-danger-fg' : undefined}>
              {line.text}
            </p>
          ))}
          {isOrgAdmin && confirm.row.status === 'published' && (
            <label className="flex items-start gap-2 text-fg">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-accent" checked={eraseToo} onChange={(e) => setEraseToo(e.target.checked)} />
              <span>Also erase its earlier text from History (the text of past edits that team leads can read).</span>
            </label>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
};

export default ClientReportsPage;
