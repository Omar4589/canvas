import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getActiveOrgId } from '../api/client.js';
import { IconCheck } from '../components/ui/index.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import {
  asksLinkQuestion,
  buildRosterRows,
  cantRelink,
  filterRosterRows,
  linkCandidates,
  resolveSelection,
  rosterCounts,
  sortRosterRows,
  suggestedPairs,
  unlinkQuestion,
} from '../lib/fbtimeRoster.js';
import { invalidateLinkCaches, runLinkBatch, runUnlinkBatch } from '../lib/fbtimeBulk.js';
import { doorsPollInterval, showDoorsCard } from '../lib/fbtimeDoors.js';
import ConnectCard from '../components/integrations/ConnectCard.jsx';
import StatusStrip from '../components/integrations/StatusStrip.jsx';
import DoorCountsCard from '../components/integrations/DoorCountsCard.jsx';
import IntegrationSettingsModal from '../components/integrations/IntegrationSettingsModal.jsx';
import RosterToolbar from '../components/integrations/RosterToolbar.jsx';
import RosterTable from '../components/integrations/RosterTable.jsx';
import LinkPickerModal from '../components/integrations/LinkPickerModal.jsx';
import SuggestionsModal from '../components/integrations/SuggestionsModal.jsx';
import BulkLinkBar from '../components/integrations/BulkLinkBar.jsx';
import BatchBanner from '../components/integrations/BatchBanner.jsx';
import UnlinkModal from '../components/integrations/UnlinkModal.jsx';
import { ClearSentModal, StopCountingModal } from '../components/integrations/DoorCountModals.jsx';
import RecentActivity from '../components/integrations/RecentActivity.jsx';

// The FbTime integration: connect the org's time-tracking so doors-per-hour
// divides by measured hours instead of the first-to-last-knock estimate.
// Admin-only (routed inside the orgAdmin RoleGate). The API key is pasted here
// once, validated against FbTime, and never displayed again — the server stores
// it sealed and returns only the prefix.
//
// The mapping table is TWO-SIDED: a row can come from either roster, or both.
// The old page listed FbTime people only, so a Doorline canvasser with no FbTime
// match — the person whose hours never arrive — appeared nowhere on the screen
// that exists to fix exactly that. All folding, filtering and ordering lives in
// lib/fbtimeRoster.js so it can be tested without a browser.
//
// Door counts to FbTime (the one thing the connection sends) get their own card
// under the status bar; the server's `doors` block is the one owner of what it
// shows (lib/fbtimeDoors.js says what the screen still decides).

const EMPTY_FILTERS = { term: '', campaignId: '', status: 'all', includeInactive: false };

export default function IntegrationsPage() {
  const orgId = getActiveOrgId();
  const qc = useQueryClient();

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState({ key: 'status', dir: 'asc' });
  const [selected, setSelected] = useState(() => new Set());
  const [busyKeys, setBusyKeys] = useState(() => new Set());
  const [pickerTarget, setPickerTarget] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const [batch, setBatch] = useState(null); // { busy, progress, results, undo, cleared, undoSkipped }
  const [unlinkAsk, setUnlinkAsk] = useState(null); // { rows, fromRow } awaiting "Was the link right?"
  const [stopTarget, setStopTarget] = useState(null); // { row, kept } — Stop counting
  const [clearTarget, setClearTarget] = useState(null); // a row — clear what Doorline sent for it

  const statusQ = useQuery({
    queryKey: ['admin', 'integrations', 'fbtime', orgId],
    queryFn: () => api('/admin/integrations/fbtime'),
    enabled: Boolean(orgId),
    // While the first send or a clear runs, so the door-count card sees it finish.
    // React Query stops the interval itself once the state settles or the page unmounts.
    refetchInterval: (query) => doorsPollInterval(query.state.data),
  });
  const connected = Boolean(statusQ.data?.connected);
  const doors = statusQ.data?.doors || null;

  const peopleQ = useQuery({
    queryKey: ['admin', 'integrations', 'fbtime', 'people', orgId],
    queryFn: () => api('/admin/integrations/fbtime/people'),
    enabled: Boolean(orgId) && connected,
  });

  // Its own query on purpose. This one pages the provider's /shifts, so it must
  // never be able to delay or fail the roster the table cannot render without —
  // a failure here costs an em-dash in one column. retry:false because a
  // degraded response is a 200, and a real failure should not be hammered.
  const projectsQ = useQuery({
    queryKey: ['admin', 'integrations', 'fbtime', 'projects', orgId],
    queryFn: () => api('/admin/integrations/fbtime/projects'),
    enabled: Boolean(orgId) && connected,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const membersQ = useQuery({
    queryKey: ['admin', 'integrations', 'org-users', orgId],
    queryFn: () => api('/admin/memberships'),
    enabled: Boolean(orgId) && connected,
  });

  // Shared cache key with UsersPage — campaign names come free.
  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    enabled: Boolean(orgId) && connected,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'integrations'] });
    // Every hours figure on the report surfaces can shift with the connection.
    qc.invalidateQueries({ queryKey: ['reports'] });
  };
  const invalidateLinks = () => invalidateLinkCaches(qc, orgId);

  const linkMut = useMutation({
    mutationFn: ({ userId, fbtimePersonId, fbtimeName, fbtimeEmail }) =>
      api('/admin/integrations/fbtime/links', {
        method: 'POST',
        body: { userId, fbtimePersonId, fbtimeName, fbtimeEmail },
      }),
    onSuccess: () => {
      setPickerTarget(null);
      invalidateLinks();
    },
  });

  // Stop counting a kept earlier account — its shifts re-resolve, so hours move.
  const stopMut = useMutation({
    mutationFn: ({ fbtimePersonId, userId }) =>
      api(`/admin/integrations/fbtime/kept/${fbtimePersonId}/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setStopTarget(null);
      invalidateLinks();
    },
  });

  // "Clear the numbers Doorline sent for <person>" — recorded here, run by the worker.
  const clearPersonMut = useMutation({
    mutationFn: (fbtimePersonId) =>
      api('/admin/integrations/fbtime/doors', { method: 'PATCH', body: { clearPerson: fbtimePersonId } }),
    onSuccess: () => {
      setClearTarget(null);
      invalidateLinks();
    },
  });

  const debouncedTerm = useDebouncedValue(filters.term, 150);

  const { rows: allRows } = useMemo(
    () =>
      buildRosterRows({
        people: peopleQ.data?.people,
        suggestions: peopleQ.data?.suggestions,
        orphanLinks: peopleQ.data?.orphanLinks,
        ghostPersonIds: peopleQ.data?.ghostPersonIds,
        members: membersQ.data?.members,
        campaigns: campaignsQ.data?.campaigns,
        projects: projectsQ.data?.projects,
      }),
    [peopleQ.data, membersQ.data, campaignsQ.data, projectsQ.data]
  );

  const visibleRows = useMemo(
    () =>
      sortRosterRows(
        filterRosterRows(allRows, { ...filters, term: debouncedTerm }),
        sort
      ),
    [allRows, filters, debouncedTerm, sort]
  );

  const counts = useMemo(() => rosterCounts(allRows, visibleRows), [allRows, visibleRows]);
  const { pairs, skippedConflicts } = useMemo(() => suggestedPairs(allRows), [allRows]);
  // Recent activity names an FbTime person off the same rows the table renders.
  const fbtimeNames = useMemo(
    () => new Map(allRows.filter((r) => r.fbtimePersonId).map((r) => [r.fbtimePersonId, r.fbtimeName])),
    [allRows]
  );
  const candidates = useMemo(
    () => linkCandidates(allRows, pickerTarget, { includeInactive: filters.includeInactive }),
    [allRows, pickerTarget, filters.includeInactive]
  );

  // Always selected ∩ visible: narrowing the search must never leave an
  // off-screen row armed for a destructive action.
  const selectedRows = useMemo(() => resolveSelection(selected, visibleRows), [selected, visibleRows]);
  const linkable = selectedRows.filter((r) => r.kind === 'needs-link' && r.suggestedUserId);
  const unlinkable = selectedRows.filter((r) => ['linked', 'orphan'].includes(r.kind));

  const toggle = (key) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleAll = (rows) =>
    setSelected((prev) => {
      const allOn = rows.length > 0 && rows.every((r) => prev.has(r.key));
      const next = new Set(prev);
      rows.forEach((r) => (allOn ? next.delete(r.key) : next.add(r.key)));
      return next;
    });

  const markBusy = (keys, on) =>
    setBusyKeys((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
      return next;
    });

  // One invalidation at the end, never per item: each refetch re-pulls the
  // provider's whole roster. A bulk action clears the whole selection; a ROW's
  // action (a one-item batch, so it gets the banner and Undo too) drops only its
  // own key, leaving whatever else was ticked alone.
  const runBatch = async (items, runner, undoItems, { onlyItemsSelection = false, rows = [] } = {}) => {
    setBatch({ busy: true, progress: { done: 0, total: items.length }, results: null });
    markBusy(items.map((i) => i.key), true);
    let done = 0;
    const results = await runner(items, {
      onSettled: (key) => {
        done += 1;
        markBusy([key], false);
        setBatch((b) => (b ? { ...b, progress: { done, total: items.length } } : b));
      },
    });
    invalidateLinks();
    if (onlyItemsSelection) {
      setSelected((prev) => {
        const next = new Set(prev);
        items.forEach((i) => next.delete(i.key));
        return next;
      });
    } else {
      setSelected(new Set());
    }
    const unlinked = rows.filter((r) => results.ok.includes(r.key));
    setBatch({
      busy: false,
      progress: { done, total: items.length },
      results,
      undo: undoItems,
      // Undoable unlinks that started a clear ("clear" is the server's answer — false
      // when Doorline never sent for that person), and unlinks Undo can't reverse.
      cleared: unlinked.filter((r) => !cantRelink(r) && results.responses?.[r.key]?.clear).length,
      undoSkipped: unlinked.filter(cantRelink).length,
    });
    return results;
  };

  const bulkLink = (rows) =>
    runBatch(
      rows.map((r) => ({
        key: r.key,
        userId: r.suggestedUserId,
        fbtimePersonId: r.fbtimePersonId,
        fbtimeName: r.fbtimeName,
        fbtimeEmail: r.fbtimeEmail,
      })),
      runLinkBatch,
      null
    );

  // `choice` is the answer to "Was the link right?" ('keep' | 'clear'). It goes ONLY
  // on the rows the question was about; every other row is a plain unlink.
  const unlinkRows = (rows, choice = null, { fromRow = false } = {}) =>
    runBatch(
      rows.map((r) => ({
        key: r.key,
        userId: r.userId,
        doors: choice && asksLinkQuestion(r) ? choice : undefined,
      })),
      runUnlinkBatch,
      // Captured BEFORE the writes — after the refetch there is no way to tell
      // which links we removed. A deleted account or a member who left can never
      // be linked again, so Undo leaves them out rather than fail on each.
      rows
        .filter((r) => !cantRelink(r))
        .map((r) => ({
          key: r.key,
          userId: r.userId,
          fbtimePersonId: r.fbtimePersonId,
          fbtimeName: r.fbtimeName,
          fbtimeEmail: r.fbtimeEmail,
        })),
      { onlyItemsSelection: fromRow, rows }
    );

  // A row's Unlink: the question when it changes something, otherwise straight away
  // (as it always was — and now with Undo, since it runs as a one-item batch).
  const unlinkRow = (row) => {
    if (asksLinkQuestion(row)) setUnlinkAsk({ rows: [row], fromRow: true });
    else unlinkRows([row], null, { fromRow: true });
  };

  const applySuggestions = async (subset, { all }) => {
    // When nothing was unticked this is exactly what the blind auto-match does —
    // one round trip, and ONE 'auto-matched' audit row with a count instead of N.
    if (all && subset.length === pairs.length) {
      setBatch({ busy: true, progress: { done: 0, total: subset.length }, results: null });
      try {
        await api('/admin/integrations/fbtime/links/auto', { method: 'POST' });
        setBatch({ busy: false, results: { ok: subset.map((p) => p.key), failed: [] } });
      } catch (err) {
        setBatch({
          busy: false,
          results: { ok: [], failed: subset.map((p) => ({ key: p.key, message: err.message })) },
        });
      }
      invalidateLinks();
      return;
    }
    await runBatch(subset, runLinkBatch, null);
  };

  const data = statusQ.data;
  const anyLoading = peopleQ.isLoading || membersQ.isLoading;
  const emptyHint = !filters.includeInactive && counts.inactiveHidden > 0
    ? `No one matches these filters. ${counts.inactiveHidden} inactive ${
        counts.inactiveHidden === 1 ? 'person is' : 'people are'
      } hidden.`
    : 'No one matches these filters.';

  return (
    <div className="space-y-4 pb-24">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Integrations</h1>
        <p className="text-sm text-fg-muted">
          Connect outside tools your organization already uses.
        </p>
      </div>

      {statusQ.isLoading && <p className="text-sm text-fg-muted">Loading…</p>}
      {statusQ.error && (
        <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
          {statusQ.error.message}
        </div>
      )}

      {data && !data.connected && (
        <ConnectCard
          configured={data.configured}
          doorsAvailable={Boolean(data.doorsAvailable)}
          onDone={invalidateAll}
        />
      )}

      {data && data.connected && (
        <>
          <StatusStrip
            data={data}
            onChanged={invalidateAll}
            onOpenSettings={() => setSettingsOpen(true)}
          />

          {showDoorsCard(doors) && (
            <DoorCountsCard data={data} onOpenSettings={() => setSettingsOpen(true)} />
          )}

          <RosterToolbar
            filters={filters}
            onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
            campaigns={campaignsQ.data?.campaigns || []}
            counts={counts}
            sort={sort}
            onSortChange={setSort}
            suggestionCount={suggestDismissed ? 0 : pairs.length}
            onReviewSuggestions={() => {
              setBatch(null);
              setSuggestOpen(true);
            }}
            onDismissSuggestions={() => setSuggestDismissed(true)}
            projectsDegraded={Boolean(projectsQ.data?.degraded || projectsQ.error)}
            onRetryProjects={() => projectsQ.refetch()}
          />

          {batch && !batch.busy && batch.results && !suggestOpen && (
            <BatchBanner
              batch={batch}
              onUndo={(items) => runBatch(items, runLinkBatch, null)}
              onDismiss={() => setBatch(null)}
            />
          )}

          {linkMut.error && <p className="text-xs text-danger">{linkMut.error.message}</p>}

          <RosterTable
            rows={visibleRows}
            totalRows={allRows.length}
            isLoading={anyLoading}
            sort={sort}
            onSortChange={setSort}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            busyKeys={busyKeys}
            projectsLoading={projectsQ.isLoading}
            emptyHint={emptyHint}
            syncLabel={doors?.enabled ? 'Sync now' : 'Refresh hours'}
            doorsAvailable={Boolean(doors?.available)}
            onLink={(row) =>
              setPickerTarget({ side: row.fbtimePersonId ? 'doorline' : 'fbtime', row })
            }
            onUnlink={unlinkRow}
            onStopCounting={(row, kept) => {
              stopMut.reset();
              setStopTarget({ row, kept });
            }}
            onClearSent={(row) => {
              clearPersonMut.reset();
              setClearTarget(row);
            }}
          />

          {peopleQ.error && (
            <p className="text-xs text-danger">{peopleQ.error.message}</p>
          )}

          {allRows.length > 0 && counts.needsLink === 0 && (
            <p className="rounded-card border border-success/20 bg-success-tint px-4 py-2 text-sm text-success-fg">
              <IconCheck size={14} className="mr-1 inline-block align-[-2px]" />
              Everyone in FbTime is linked to a Doorline person.
            </p>
          )}

          <RecentActivity personName={(id) => fbtimeNames.get(id) || null} />
        </>
      )}

      <BulkLinkBar
        selected={selectedRows}
        linkable={linkable}
        unlinkable={unlinkable}
        busy={Boolean(batch?.busy)}
        progress={batch?.progress}
        onLink={bulkLink}
        // The inline confirm stays only for selections the question isn't about.
        askBeforeUnlink={unlinkQuestion(unlinkable).ask}
        onAskUnlink={(rows) => setUnlinkAsk({ rows, fromRow: false })}
        onUnlink={(rows) => unlinkRows(rows)}
        onClear={() => setSelected(new Set())}
      />

      {settingsOpen && data?.connected && (
        <IntegrationSettingsModal
          data={data}
          onChanged={invalidateAll}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {unlinkAsk && (
        <UnlinkModal
          rows={unlinkAsk.rows}
          doorsAvailable={Boolean(doors?.available)}
          onConfirm={(choice) => {
            const { rows, fromRow } = unlinkAsk;
            setUnlinkAsk(null);
            unlinkRows(rows, choice, { fromRow });
          }}
          onClose={() => setUnlinkAsk(null)}
        />
      )}

      {stopTarget && (
        <StopCountingModal
          row={stopTarget.row}
          kept={stopTarget.kept}
          doorsOn={Boolean(doors?.enabled)}
          pending={stopMut.isPending}
          error={stopMut.error}
          onConfirm={() =>
            stopMut.mutate({ fbtimePersonId: stopTarget.row.fbtimePersonId, userId: stopTarget.kept.userId })
          }
          onClose={() => setStopTarget(null)}
        />
      )}

      {clearTarget && (
        <ClearSentModal
          name={clearTarget.fbtimeName || 'this FbTime person'}
          pending={clearPersonMut.isPending}
          error={clearPersonMut.error}
          onConfirm={() => clearPersonMut.mutate(clearTarget.fbtimePersonId)}
          onClose={() => setClearTarget(null)}
        />
      )}

      {pickerTarget && (
        <LinkPickerModal
          target={pickerTarget}
          candidates={candidates}
          pending={linkMut.isPending}
          error={linkMut.error}
          onPick={(id) => {
            const { side, row } = pickerTarget;
            const other = allRows.find((r) => (side === 'doorline' ? r.userId : r.fbtimePersonId) === id);
            linkMut.mutate(
              side === 'doorline'
                ? {
                    userId: id,
                    fbtimePersonId: row.fbtimePersonId,
                    fbtimeName: row.fbtimeName,
                    fbtimeEmail: row.fbtimeEmail,
                  }
                : {
                    userId: row.userId,
                    fbtimePersonId: id,
                    fbtimeName: other?.fbtimeName,
                    fbtimeEmail: other?.fbtimeEmail,
                  }
            );
          }}
          onClose={() => {
            linkMut.reset();
            setPickerTarget(null);
          }}
        />
      )}

      {suggestOpen && (
        <SuggestionsModal
          pairs={pairs}
          skippedConflicts={skippedConflicts}
          busy={Boolean(batch?.busy)}
          progress={batch?.progress}
          results={batch?.results}
          onApply={applySuggestions}
          onClose={() => {
            setSuggestOpen(false);
            setBatch(null);
          }}
        />
      )}
    </div>
  );
}
