import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getActiveOrgId } from '../api/client.js';
import { Button, EmptyState, IconCheck } from '../components/ui/index.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import {
  buildRosterRows,
  filterRosterRows,
  linkCandidates,
  resolveSelection,
  rosterCounts,
  sortRosterRows,
  suggestedPairs,
} from '../lib/fbtimeRoster.js';
import { invalidateLinkCaches, runLinkBatch, runUnlinkBatch } from '../lib/fbtimeBulk.js';
import ConnectCard from '../components/integrations/ConnectCard.jsx';
import StatusStrip from '../components/integrations/StatusStrip.jsx';
import IntegrationSettingsModal from '../components/integrations/IntegrationSettingsModal.jsx';
import RosterToolbar from '../components/integrations/RosterToolbar.jsx';
import RosterTable from '../components/integrations/RosterTable.jsx';
import LinkPickerModal from '../components/integrations/LinkPickerModal.jsx';
import SuggestionsModal from '../components/integrations/SuggestionsModal.jsx';
import BulkLinkBar from '../components/integrations/BulkLinkBar.jsx';
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
  const [batch, setBatch] = useState(null); // { busy, progress, results, undo }

  const statusQ = useQuery({
    queryKey: ['admin', 'integrations', 'fbtime', orgId],
    queryFn: () => api('/admin/integrations/fbtime'),
    enabled: Boolean(orgId),
  });
  const connected = Boolean(statusQ.data?.connected);

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
  const unlinkMut = useMutation({
    mutationFn: (userId) =>
      api(`/admin/integrations/fbtime/links/${userId}`, { method: 'DELETE' }),
    onSuccess: invalidateLinks,
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
  // provider's whole roster.
  const runBatch = async (items, runner, undoItems) => {
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
    setSelected(new Set());
    setBatch({ busy: false, progress: { done, total: items.length }, results, undo: undoItems });
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

  const bulkUnlink = (rows) =>
    runBatch(
      rows.map((r) => ({ key: r.key, userId: r.userId })),
      runUnlinkBatch,
      // Captured BEFORE the writes — after the refetch there is no way to tell
      // which links we removed.
      rows.map((r) => ({
        key: r.key,
        userId: r.userId,
        fbtimePersonId: r.fbtimePersonId,
        fbtimeName: r.fbtimeName,
        fbtimeEmail: r.fbtimeEmail,
      }))
    );

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
        <ConnectCard configured={data.configured} onDone={invalidateAll} />
      )}

      {data && data.connected && (
        <>
          <StatusStrip
            data={data}
            onChanged={invalidateAll}
            onOpenSettings={() => setSettingsOpen(true)}
          />

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
            <div className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-card px-4 py-2.5 text-sm shadow-card">
              <IconCheck size={16} className="text-success-fg" />
              <span className="text-fg">
                {batch.results.ok.length} updated
                {batch.results.failed.length ? ` · ${batch.results.failed.length} failed` : ''}
              </span>
              {batch.results.failed.length > 0 && (
                <span className="text-xs text-danger">{batch.results.failed[0].message}</span>
              )}
              {batch.undo && batch.results.ok.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const items = batch.undo.filter((u) => batch.results.ok.includes(u.key));
                    runBatch(items, runLinkBatch, null);
                  }}
                >
                  Undo
                </Button>
              )}
              <button
                type="button"
                onClick={() => setBatch(null)}
                className="ml-auto text-xs text-fg-muted underline underline-offset-2 hover:text-fg"
              >
                Dismiss
              </button>
            </div>
          )}

          {(linkMut.error || unlinkMut.error) && (
            <p className="text-xs text-danger">
              {(linkMut.error || unlinkMut.error).message}
            </p>
          )}

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
            onLink={(row) =>
              setPickerTarget({ side: row.fbtimePersonId ? 'doorline' : 'fbtime', row })
            }
            onUnlink={(row) => {
              markBusy([row.key], true);
              unlinkMut.mutate(row.userId, {
                onSettled: () => markBusy([row.key], false),
              });
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

          <RecentActivity />
        </>
      )}

      <BulkLinkBar
        selected={selectedRows}
        linkable={linkable}
        unlinkable={unlinkable}
        busy={Boolean(batch?.busy)}
        progress={batch?.progress}
        onLink={bulkLink}
        onUnlink={bulkUnlink}
        onClear={() => setSelected(new Set())}
      />

      {settingsOpen && data?.connected && (
        <IntegrationSettingsModal
          data={data}
          onChanged={invalidateAll}
          onClose={() => setSettingsOpen(false)}
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
