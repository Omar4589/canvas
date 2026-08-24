import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useCampaignTeam } from '../lib/useCampaignTeam.js';
import { IconSpinner } from './ui/icons.jsx';

// Floating panel over the turf map: assign canvassers to the currently-selected
// book(s) — from either the list or the map. One book → instant per-person
// toggle (per-book endpoints); many books → distribute / everyone bulk assign.
// "Who's already assigned" is derived from the pass-level assignments already
// loaded by TurfsPage (no extra fetch).
function initials(u) {
  return ((u.firstName?.[0] || '') + (u.lastName?.[0] || '')).toUpperCase() || '?';
}

export default function BookAssignmentPanel({
  campaignId,
  passId,
  books,
  assignedByTurf,
  onClear,
  onMerge,
  mergePending,
  onRestrict,
  onUnrestrict,
  restrictPending,
  // "Move doors to…" — the page owns the target dialog (MoveTargetModal) and the merge;
  // presentational here, same contract as onMerge/onRestrict. Optional: absent, no button.
  onMoveDoors = null,
  movePending = false,
}) {
  const qc = useQueryClient();
  const single = books.length === 1;
  // Only published (accepted) books can be assigned — re-cutting would wipe drafts.
  const draftSelected = books.some((b) => b.status && b.status !== 'published');
  const turfIds = books.map((b) => String(b._id));
  const turfKey = turfIds.join(',');
  const totalDoors = books.reduce((s, b) => s + (b.eligibleDoorCount ?? b.doorCount ?? 0), 0);

  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(() => new Set()); // multi-book mode
  const [mode, setMode] = useState('distribute');
  const [replace, setReplace] = useState(false);
  const [teamFilter, setTeamFilter] = useState('all'); // 'all' | coordinatorId | 'none'
  const [confirmClear, setConfirmClear] = useState(false); // two-tap gate on "unassign everyone"
  const [unassignErr, setUnassignErr] = useState(null);

  // Assignable = the campaign team (+ you, so admins can self-assign) — not the whole org.
  const { members, isLoading: membersLoading } = useCampaignTeam(campaignId);
  const memberById = useMemo(() => new Map(members.map((m) => [String(m.user.id), m.user])), [members]);
  // Crews present on this campaign = the distinct coordinators (team leads), + a "No team" bucket.
  const teams = useMemo(() => {
    const byId = new Map();
    let hasNoTeam = false;
    for (const m of members) {
      if (m.user.coordinatorId) byId.set(m.user.coordinatorId, m.user.coordinatorName || 'Team');
      else hasNoTeam = true;
    }
    return { list: [...byId.entries()].map(([id, name]) => ({ id, name })), hasNoTeam };
  }, [members]);
  const filtered = members.filter((m) => {
    if (teamFilter === 'none' && m.user.coordinatorId) return false;
    if (teamFilter !== 'all' && teamFilter !== 'none' && m.user.coordinatorId !== teamFilter) return false;
    if (!search.trim()) return true;
    const hay = `${m.user.firstName} ${m.user.lastName} ${m.user.email}`.toLowerCase();
    return hay.includes(search.trim().toLowerCase());
  });

  // Union of who's already assigned across the selected books, with coverage.
  const union = useMemo(() => {
    const m = new Map();
    for (const b of books) {
      const tid = String(b._id);
      for (const u of assignedByTurf.get(tid) || []) {
        const e = m.get(u.id) || { user: u, inBooks: new Set() };
        e.inBooks.add(tid);
        m.set(u.id, e);
      }
    }
    return [...m.values()];
  }, [books, assignedByTurf]);
  const assignedSet = useMemo(() => new Set(union.map((e) => e.user.id)), [union]);
  // Distinct crews among the already-assigned people → a "mixed crews" heads-up.
  const mixedCrews = useMemo(() => {
    const s = new Set();
    for (const e of union) s.add(memberById.get(String(e.user.id))?.coordinatorId || 'none');
    return s.size > 1;
  }, [union, memberById]);

  const asgKey = ['turf-pass-assignments', campaignId, passId];
  const [savedAt, setSavedAt] = useState(0);
  useEffect(() => {
    if (!savedAt) return undefined;
    const t = setTimeout(() => setSavedAt(0), 1800);
    return () => clearTimeout(t);
  }, [savedAt]);
  const flashSaved = () => setSavedAt(Date.now());
  // The panel is reused across selections, so a staged confirm must never survive one —
  // otherwise the second tap clears books the admin never armed.
  useEffect(() => {
    setConfirmClear(false);
    setUnassignErr(null);
  }, [turfKey]);

  // Refetch the assignment set (+ the modal's) after any write. The team roster is refreshed
  // only after an ASSIGN (a self-assign can add the admin) — and never blocks the UI, since
  // the optimistic cache edits below already show the change.
  const settle = () => {
    qc.invalidateQueries({ queryKey: asgKey });
    qc.invalidateQueries({ queryKey: ['turf-assignments'] });
  };
  const rollback = (_e, _v, ctx) => { if (ctx && 'prev' in ctx) qc.setQueryData(asgKey, ctx.prev); };
  const userRow = (uid) => {
    const u = memberById.get(String(uid));
    return { id: String(uid), firstName: u?.firstName || '', lastName: u?.lastName || '' };
  };
  const setRows = (fn) => qc.setQueryData(asgKey, (old) => ({ ...(old || {}), assignments: fn(old?.assignments || []) }));

  const assignOne = useMutation({
    mutationFn: (userIds) =>
      api(`/admin/campaigns/${campaignId}/turfs/${turfIds[0]}/assignments`, { method: 'POST', body: { userIds } }),
    onMutate: async (userIds) => {
      await qc.cancelQueries({ queryKey: asgKey });
      const prev = qc.getQueryData(asgKey);
      setRows((rows) => {
        const have = new Set(rows.filter((r) => String(r.turfId) === turfIds[0]).map((r) => String(r.user.id)));
        const add = userIds.filter((uid) => !have.has(String(uid))).map((uid) => ({ turfId: turfIds[0], user: userRow(uid) }));
        return [...rows, ...add];
      });
      return { prev };
    },
    onError: rollback,
    onSuccess: () => { flashSaved(); qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', campaignId] }); },
    onSettled: settle,
  });
  const unassignFrom = useMutation({
    mutationFn: ({ turfId, userId }) =>
      api(`/admin/campaigns/${campaignId}/turfs/${turfId}/assignments/${userId}`, { method: 'DELETE' }),
    onMutate: async ({ turfId, userId }) => {
      await qc.cancelQueries({ queryKey: asgKey });
      const prev = qc.getQueryData(asgKey);
      setRows((rows) => rows.filter((r) => !(String(r.turfId) === String(turfId) && String(r.user.id) === String(userId))));
      return { prev };
    },
    onError: rollback,
    onSuccess: flashSaved,
    onSettled: settle,
  });
  // One request to drop people from MANY books (was N sequential DELETEs). Two callers:
  // a named person (`userIds`), or everyone holding the selection (`allInPass`).
  const unassignBulk = useMutation({
    mutationFn: async ({ turfIds: tids, userIds, allInPass }) => {
      // "Everyone" resolves its user list from the SERVER rather than the cached union:
      // this query has no refetchInterval and refetchOnWindowFocus is off, so a panel left
      // open can be hours stale and would silently leave the newest assignee on the books.
      // The pass-wide set is safe to send because the server pins the blast radius to the
      // turfs — it re-scopes turfIds by campaign, then deletes the turf × user cross
      // product, so a wider user list can only ever match books we already selected.
      let uids = userIds;
      if (allInPass) {
        const fresh = await api(`/admin/campaigns/${campaignId}/turfs/assignments?passId=${passId}`);
        uids = [...new Set((fresh.assignments || []).map((a) => String(a.user.id)))];
        if (!uids.length) return { deleted: 0 }; // nobody in the round; the endpoint would 400
      }
      return api(`/admin/campaigns/${campaignId}/turfs/unassign-bulk`, {
        method: 'POST',
        body: { turfIds: tids, userIds: uids },
      });
    },
    onMutate: async ({ turfIds: tids, userIds, allInPass }) => {
      await qc.cancelQueries({ queryKey: asgKey });
      const prev = qc.getQueryData(asgKey);
      const tset = new Set(tids.map(String));
      // "Everyone" drops by turf alone: narrowing by the union we just refused to trust
      // would leave a freshly-assigned row on screen after the server removed it.
      const uset = allInPass ? null : new Set(userIds.map(String));
      setRows((rows) =>
        rows.filter((r) => !(tset.has(String(r.turfId)) && (!uset || uset.has(String(r.user.id)))))
      );
      return { prev };
    },
    onError: (err, vars, ctx) => {
      rollback(err, vars, ctx);
      // The panel has no other error surface, and this page never gates on an archived
      // campaign — so a 409 (or a 402 on a suspended org) would otherwise vanish.
      setUnassignErr(err?.message || 'Could not unassign.');
    },
    onSuccess: () => {
      setUnassignErr(null);
      flashSaved();
    },
    onSettled: settle,
  });
  const bulk = useMutation({
    mutationFn: () =>
      api(`/admin/campaigns/${campaignId}/turfs/assign-bulk`, {
        method: 'POST',
        body: { turfIds, userIds: [...picked], mode, replace },
      }),
    onSuccess: () => {
      setPicked(new Set());
      setReplace(false);
      flashSaved();
      settle();
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', campaignId] });
    },
  });

  const busy = assignOne.isPending || unassignFrom.isPending || unassignBulk.isPending || bulk.isPending;

  function toggleSingle(userId) {
    if (assignedSet.has(userId)) unassignFrom.mutate({ turfId: turfIds[0], userId });
    else assignOne.mutate([userId]);
  }
  function unassignEverywhere(entry) {
    unassignBulk.mutate({ turfIds: [...entry.inBooks], userIds: [entry.user.id] });
  }
  function unassignAll() {
    setConfirmClear(false);
    unassignBulk.mutate({ turfIds, allInPass: true });
  }
  function assignAllShownSingle() {
    const ids = filtered.filter((m) => !assignedSet.has(m.user.id)).map((m) => m.user.id);
    if (ids.length) assignOne.mutate(ids);
  }
  function togglePick(id) {
    setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectAllShown() {
    setPicked((s) => { const n = new Set(s); filtered.forEach((m) => n.add(m.user.id)); return n; });
  }

  return (
    // top-16, not top-3: the map's top-left control cluster (restore-panel, fullscreen, the
    // "Select doors" pill) owns the first row, and this panel used to paint straight over it.
    <div className="absolute left-3 top-16 z-10 flex max-h-[calc(100%-4.75rem)] w-80 flex-col rounded-xl border border-border bg-card shadow-xl">
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-fg">
            {books.length} book{books.length === 1 ? '' : 's'} selected
          </div>
          <div className="text-xs text-fg-muted">{totalDoors.toLocaleString()} doors</div>
        </div>
        <div className="flex items-center gap-2">
          {savedAt ? (
            <span className="rounded-full bg-success-tint px-2 py-0.5 text-[10px] font-semibold text-success">Saved ✓</span>
          ) : busy ? (
            <IconSpinner size={14} />
          ) : null}
          <button onClick={onClear} className="rounded p-1 text-fg-subtle hover:bg-sunken hover:text-fg-muted" aria-label="Clear selection">✕</button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <div className="mb-3">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
            Assigned{single ? '' : ' across selection'}
            {mixedCrews && (
              <span className="rounded bg-warning-tint px-1 py-0.5 text-[9px] font-semibold normal-case text-warning-fg">mixed crews</span>
            )}
          </div>
          {union.length === 0 ? (
            <p className="text-xs text-fg-subtle">No one assigned yet.</p>
          ) : (
            <ul className="space-y-1">
              {union.map((e) => (
                <li key={e.user.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[9px] font-semibold text-brand-accent">
                      {initials(e.user)}
                    </span>
                    <span className="truncate text-fg">{e.user.firstName} {e.user.lastName}</span>
                    {memberById.get(String(e.user.id))?.coordinatorName && (
                      <span className="shrink-0 text-[10px] text-fg-subtle">· {memberById.get(String(e.user.id)).coordinatorName}</span>
                    )}
                    {!single && <span className="shrink-0 text-[10px] text-fg-subtle">in {e.inBooks.size}/{books.length}</span>}
                  </span>
                  <button
                    onClick={() => (single ? toggleSingle(e.user.id) : unassignEverywhere(e))}
                    disabled={busy}
                    className="shrink-0 rounded-md border border-danger/30 bg-danger-tint px-2 py-0.5 text-[11px] font-semibold text-danger hover:bg-danger-tint disabled:opacity-50"
                  >
                    Unassign
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* Clear the whole selection at once. Only past one person — with a single
              assignee the per-row Unassign above already is this button. */}
          {union.length > 1 &&
            (confirmClear ? (
              <div className="mt-2 rounded-lg border border-danger/30 bg-danger-tint px-2.5 py-2">
                <p className="text-xs font-medium text-danger-fg">
                  Take all {union.length} people off{' '}
                  {books.length === 1 ? 'this book' : `these ${books.length} books`}?
                </p>
                <p className="mt-1 text-[11px] text-fg-muted">
                  The books go back in the pool, so you can hand them to someone else. This doesn't
                  remove anyone from the campaign team.
                </p>
                <p className="mt-1 text-[11px] text-fg-muted">
                  <strong className="font-medium text-fg">Their work is kept.</strong> Every door
                  they knocked still counts. Anyone out canvassing right now keeps these books on
                  their phone until their app reloads the campaign.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={unassignAll}
                    disabled={busy}
                    className="rounded-md border border-danger/30 bg-danger-tint px-2 py-0.5 text-[11px] font-semibold text-danger hover:bg-danger-tint disabled:opacity-50"
                  >
                    Yes, unassign everyone
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="rounded-md border border-border-strong px-2 py-0.5 text-[11px] font-medium text-fg-muted hover:bg-sunken"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                disabled={busy}
                className="mt-1.5 text-[11px] font-semibold text-danger hover:underline disabled:opacity-50"
              >
                Unassign all ({union.length})
              </button>
            ))}
          {unassignErr && <p className="mt-1.5 text-[11px] text-danger-fg">{unassignErr}</p>}
        </div>

        <div className="border-t border-border pt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
            {single ? 'People' : 'Add people'}
          </div>

          {draftSelected ? (
            <p className="rounded-md border border-warning/30 bg-warning-tint px-2.5 py-2 text-xs text-warning-fg">
              Accept these books first to assign canvassers.
            </p>
          ) : (
            <>
          {!single && (
            <div className="mb-2 flex rounded-md border border-border-strong p-0.5 text-[11px]">
              {[{ key: 'distribute', label: 'Even books' }, { key: 'balance', label: 'Even doors' }, { key: 'everyone', label: 'Everyone' }].map((o) => (
                <button
                  key={o.key}
                  onClick={() => setMode(o.key)}
                  className={['flex-1 rounded px-2 py-1 font-medium transition-colors', mode === o.key ? 'bg-brand-600 text-white' : 'text-fg-muted hover:bg-sunken'].join(' ')}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}

          {teams.list.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1">
              {[{ id: 'all', name: 'All' }, ...teams.list, ...(teams.hasNoTeam ? [{ id: 'none', name: 'No team' }] : [])].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTeamFilter(t.id)}
                  className={[
                    'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                    teamFilter === t.id ? 'border-brand-accent bg-brand-tint text-brand-accent' : 'border-border-strong text-fg-muted hover:bg-sunken',
                  ].join(' ')}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}

          <div className="mb-2 flex items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people…"
              className="w-full rounded-md border border-border-strong bg-card px-2 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            {single
              ? filtered.some((m) => !assignedSet.has(m.user.id)) && (
                  <button onClick={assignAllShownSingle} disabled={busy} className="shrink-0 rounded-md border border-brand-accent/30 bg-brand-tint px-2 py-1.5 text-[11px] font-semibold text-brand-accent hover:bg-brand-tint disabled:opacity-50">
                    Assign all
                  </button>
                )
              : (
                <button onClick={selectAllShown} className="shrink-0 rounded-md border border-border-strong px-2 py-1.5 text-[11px] font-medium text-fg-muted hover:bg-sunken">
                  Select all
                </button>
              )}
          </div>

          {membersLoading ? (
            <div className="py-6 text-center text-xs text-fg-muted">Loading…</div>
          ) : (
            <ul className="max-h-56 divide-y divide-border overflow-auto rounded-md border border-border">
              {filtered.map((m) => {
                const u = m.user;
                if (single) {
                  const on = assignedSet.has(u.id);
                  return (
                    <li key={u.id} className="flex items-center justify-between px-2.5 py-1.5 text-sm">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-medium text-fg">{u.firstName} {u.lastName}</span>
                        {m.role === 'admin' && <span className="rounded bg-sunken px-1 text-[9px] font-semibold uppercase text-fg-muted">admin</span>}
                        {u.isSelf && <span className="rounded bg-brand-tint px-1 text-[9px] font-semibold uppercase text-brand-accent">you</span>}
                        {u.coordinatorName && <span className="truncate text-[10px] text-fg-subtle">· {u.coordinatorName}</span>}
                      </span>
                      <button
                        onClick={() => toggleSingle(u.id)}
                        disabled={busy}
                        className={(on ? 'border-danger/30 bg-danger-tint text-danger hover:bg-danger-tint' : 'border-brand-accent/30 bg-brand-tint text-brand-accent hover:bg-brand-tint') + ' shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50'}
                      >
                        {on ? 'Unassign' : 'Assign'}
                      </button>
                    </li>
                  );
                }
                const on = picked.has(u.id);
                return (
                  <li key={u.id}>
                    <button
                      onClick={() => togglePick(u.id)}
                      className={['flex w-full items-center justify-between px-2.5 py-1.5 text-left text-sm', on ? 'bg-brand-tint' : 'hover:bg-sunken'].join(' ')}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className={['flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px]', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-border-strong'].join(' ')}>{on ? '✓' : ''}</span>
                        <span className="truncate font-medium text-fg">{u.firstName} {u.lastName}</span>
                        {m.role === 'admin' && <span className="rounded bg-sunken px-1 text-[9px] font-semibold uppercase text-fg-muted">admin</span>}
                        {u.isSelf && <span className="rounded bg-brand-tint px-1 text-[9px] font-semibold uppercase text-brand-accent">you</span>}
                        {u.coordinatorName && <span className="truncate text-[10px] text-fg-subtle">· {u.coordinatorName}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
              {!filtered.length && <li className="px-2.5 py-2 text-center text-xs text-fg-muted">No matches.</li>}
            </ul>
          )}

          <Link
            to={`/campaigns/${campaignId}/team`}
            className="mt-2 inline-block text-[11px] font-medium text-brand-accent hover:underline"
          >
            ＋ Add someone to the team →
          </Link>

          {/* For a volunteer who won't be using the app — the studio opens with this book
              already picked. */}
          {turfIds?.length > 0 && (
            <Link
              to={`/campaigns/${campaignId}/packets?turfIds=${turfIds.join(',')}`}
              className="mt-1 block text-[11px] font-medium text-brand-accent hover:underline"
            >
              🖨 Print this book on paper →
            </Link>
          )}

          {!single && (
            <>
              <label className="mt-2 flex items-center gap-2 text-[11px] text-fg-muted">
                <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                Replace current assignments first
              </label>
              <button
                onClick={() => bulk.mutate()}
                disabled={!picked.size || bulk.isPending}
                className="mt-2 w-full rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {bulk.isPending ? 'Assigning…' : `Apply to ${books.length} books`}
              </button>
              <p className="mt-1 text-[11px] text-fg-muted">
                {picked.size === 0
                  ? 'Pick people to assign.'
                  : mode === 'distribute'
                  ? `Even BOOK count: split ${books.length} books across ${picked.size} ${picked.size === 1 ? 'person' : 'people'} (round-robin).`
                  : mode === 'balance'
                  ? `Even DOOR count: spread the doors across ${picked.size} ${picked.size === 1 ? 'person' : 'people'} (biggest books first).`
                  : `Everyone (${picked.size}) on every book.`}
              </p>
            </>
          )}
            </>
          )}
        </div>
      </div>

      {(books.length >= 2 || onMoveDoors) && (
        <div className="space-y-1.5 border-t border-border px-4 py-2">
          {books.length >= 2 && (
            <button
              onClick={onMerge}
              disabled={mergePending}
              className="w-full rounded-md border border-border-strong px-3 py-1.5 text-xs font-semibold text-fg-muted hover:bg-sunken disabled:opacity-50"
            >
              Merge {books.length} books into one
            </button>
          )}
          {onMoveDoors && (
            <button
              onClick={onMoveDoors}
              disabled={movePending}
              className="w-full rounded-md border border-border-strong px-3 py-1.5 text-xs font-semibold text-fg-muted hover:bg-sunken disabled:opacity-50"
            >
              Move doors to… ({totalDoors.toLocaleString()} {totalDoors === 1 ? 'door' : 'doors'})
            </button>
          )}
        </div>
      )}

      {/* Bulk restricted — a whole gated community in one action. Published
          books only (same gate as assignment). Skip rules live in the confirm
          dialog TurfsPage opens. */}
      {!draftSelected && onRestrict && (
        <div className="space-y-1.5 border-t border-border px-4 py-2">
          <button
            onClick={onRestrict}
            disabled={restrictPending}
            className="w-full rounded-md border border-border-strong px-3 py-1.5 text-xs font-semibold text-fg-muted hover:bg-sunken disabled:opacity-50"
          >
            Mark {single ? 'book' : `${books.length} books`} restricted… ({totalDoors.toLocaleString()} doors)
          </button>
          {books.reduce((s, b) => s + (b.bulkRestrictedCount || 0), 0) > 0 && (
            <button
              onClick={onUnrestrict}
              disabled={restrictPending}
              className="w-full rounded-md border border-border-strong px-3 py-1.5 text-xs font-semibold text-fg-muted hover:bg-sunken disabled:opacity-50"
            >
              Unmark restricted ({books.reduce((s, b) => s + (b.bulkRestrictedCount || 0), 0)} desk marks)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
