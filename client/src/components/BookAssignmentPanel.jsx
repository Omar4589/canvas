import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useCampaignTeam } from '../lib/useCampaignTeam.js';

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
  crewLoad,
  onClear,
  onMerge,
  mergePending,
}) {
  const qc = useQueryClient();
  const single = books.length === 1;
  // Only published (accepted) books can be assigned — re-cutting would wipe drafts.
  const draftSelected = books.some((b) => b.status && b.status !== 'published');
  const turfIds = books.map((b) => String(b._id));
  const totalDoors = books.reduce((s, b) => s + (b.eligibleDoorCount ?? b.doorCount ?? 0), 0);

  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(() => new Set()); // multi-book mode
  const [mode, setMode] = useState('distribute');
  const [replace, setReplace] = useState(false);
  const [teamFilter, setTeamFilter] = useState('all'); // 'all' | coordinatorId | 'none'

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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['turf-pass-assignments', campaignId, passId] });
    qc.invalidateQueries({ queryKey: ['turf-assignments'] });
    // Self-assign may have added the admin to the roster — refresh the candidate list.
    qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', campaignId] });
  };

  const assignOne = useMutation({
    mutationFn: (userIds) =>
      api(`/admin/campaigns/${campaignId}/turfs/${turfIds[0]}/assignments`, { method: 'POST', body: { userIds } }),
    onSuccess: invalidate,
  });
  const unassignFrom = useMutation({
    mutationFn: ({ turfId, userId }) =>
      api(`/admin/campaigns/${campaignId}/turfs/${turfId}/assignments/${userId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  const bulk = useMutation({
    mutationFn: () =>
      api(`/admin/campaigns/${campaignId}/turfs/assign-bulk`, {
        method: 'POST',
        body: { turfIds, userIds: [...picked], mode, replace },
      }),
    onSuccess: () => { setPicked(new Set()); setReplace(false); invalidate(); },
  });

  const busy = assignOne.isPending || unassignFrom.isPending || bulk.isPending;

  function toggleSingle(userId) {
    if (assignedSet.has(userId)) unassignFrom.mutate({ turfId: turfIds[0], userId });
    else assignOne.mutate([userId]);
  }
  function unassignEverywhere(entry) {
    for (const tid of entry.inBooks) unassignFrom.mutate({ turfId: tid, userId: entry.user.id });
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
    <div className="absolute left-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-80 flex-col rounded-xl border border-border bg-card shadow-xl">
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-fg">
            {books.length} book{books.length === 1 ? '' : 's'} selected
          </div>
          <div className="text-xs text-fg-muted">{totalDoors.toLocaleString()} doors</div>
        </div>
        <button onClick={onClear} className="rounded p-1 text-fg-subtle hover:bg-sunken hover:text-fg-muted" aria-label="Clear selection">✕</button>
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

        {crewLoad && crewLoad.length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Crew load · this pass</div>
            <ul className="space-y-0.5 text-xs">
              {crewLoad.map((c) => (
                <li key={c.user.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-fg">{c.user.firstName} {c.user.lastName}</span>
                  <span className="shrink-0 text-fg-muted">{c.books} bk · {c.doors.toLocaleString()} dr</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {books.length >= 2 && (
        <div className="border-t border-border px-4 py-2">
          <button
            onClick={onMerge}
            disabled={mergePending}
            className="w-full rounded-md border border-border-strong px-3 py-1.5 text-xs font-semibold text-fg-muted hover:bg-sunken disabled:opacity-50"
          >
            Merge {books.length} books into one
          </button>
        </div>
      )}
    </div>
  );
}
