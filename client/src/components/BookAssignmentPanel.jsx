import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

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
}) {
  const qc = useQueryClient();
  const single = books.length === 1;
  const turfIds = books.map((b) => String(b._id));
  const totalDoors = books.reduce((s, b) => s + (b.eligibleDoorCount ?? b.doorCount ?? 0), 0);

  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(() => new Set()); // multi-book mode
  const [mode, setMode] = useState('distribute');
  const [replace, setReplace] = useState(false);

  const membersQ = useQuery({ queryKey: ['memberships'], queryFn: () => api('/admin/memberships') });
  const members = (membersQ.data?.members || []).filter((m) => m.user.isActive && m.isActive);
  const filtered = members.filter((m) => {
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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['turf-pass-assignments', campaignId, passId] });
    qc.invalidateQueries({ queryKey: ['turf-assignments'] });
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
    <div className="absolute left-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-80 flex-col rounded-xl border border-gray-200 bg-white shadow-xl">
      <div className="flex items-start justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">
            {books.length} book{books.length === 1 ? '' : 's'} selected
          </div>
          <div className="text-xs text-gray-500">{totalDoors.toLocaleString()} doors</div>
        </div>
        <button onClick={onClear} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Clear selection">✕</button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <div className="mb-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Assigned{single ? '' : ' across selection'}
          </div>
          {union.length === 0 ? (
            <p className="text-xs text-gray-400">No one assigned yet.</p>
          ) : (
            <ul className="space-y-1">
              {union.map((e) => (
                <li key={e.user.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[9px] font-semibold text-brand-700">
                      {initials(e.user)}
                    </span>
                    <span className="truncate text-gray-800">{e.user.firstName} {e.user.lastName}</span>
                    {!single && <span className="shrink-0 text-[10px] text-gray-400">in {e.inBooks.size}/{books.length}</span>}
                  </span>
                  <button
                    onClick={() => (single ? toggleSingle(e.user.id) : unassignEverywhere(e))}
                    disabled={busy}
                    className="shrink-0 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                  >
                    Unassign
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-gray-100 pt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {single ? 'People' : 'Add people'}
          </div>

          {!single && (
            <div className="mb-2 flex rounded-md border border-gray-300 p-0.5 text-[11px]">
              {[{ key: 'distribute', label: 'Distribute' }, { key: 'everyone', label: 'Everyone' }].map((o) => (
                <button
                  key={o.key}
                  onClick={() => setMode(o.key)}
                  className={['flex-1 rounded px-2 py-1 font-medium transition-colors', mode === o.key ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-50'].join(' ')}
                >
                  {o.label}
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
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            />
            {single
              ? filtered.some((m) => !assignedSet.has(m.user.id)) && (
                  <button onClick={assignAllShownSingle} disabled={busy} className="shrink-0 rounded-md border border-brand-200 bg-brand-50 px-2 py-1.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-50">
                    Assign all
                  </button>
                )
              : (
                <button onClick={selectAllShown} className="shrink-0 rounded-md border border-gray-300 px-2 py-1.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50">
                  Select all
                </button>
              )}
          </div>

          {membersQ.isLoading ? (
            <div className="py-6 text-center text-xs text-gray-500">Loading…</div>
          ) : !members.length ? (
            <div className="rounded border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">
              No members in this org yet.
            </div>
          ) : (
            <ul className="max-h-56 divide-y divide-gray-100 overflow-auto rounded-md border border-gray-200">
              {filtered.map((m) => {
                const u = m.user;
                if (single) {
                  const on = assignedSet.has(u.id);
                  return (
                    <li key={u.id} className="flex items-center justify-between px-2.5 py-1.5 text-sm">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-medium text-gray-900">{u.firstName} {u.lastName}</span>
                        {m.role === 'admin' && <span className="rounded bg-gray-100 px-1 text-[9px] font-semibold uppercase text-gray-500">admin</span>}
                      </span>
                      <button
                        onClick={() => toggleSingle(u.id)}
                        disabled={busy}
                        className={(on ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' : 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100') + ' shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50'}
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
                      className={['flex w-full items-center justify-between px-2.5 py-1.5 text-left text-sm', on ? 'bg-brand-50' : 'hover:bg-gray-50'].join(' ')}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className={['flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px]', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-300'].join(' ')}>{on ? '✓' : ''}</span>
                        <span className="truncate font-medium text-gray-900">{u.firstName} {u.lastName}</span>
                        {m.role === 'admin' && <span className="rounded bg-gray-100 px-1 text-[9px] font-semibold uppercase text-gray-500">admin</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
              {!filtered.length && <li className="px-2.5 py-2 text-center text-xs text-gray-500">No matches.</li>}
            </ul>
          )}

          {!single && (
            <>
              <label className="mt-2 flex items-center gap-2 text-[11px] text-gray-600">
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
              <p className="mt-1 text-[11px] text-gray-500">
                {picked.size === 0
                  ? 'Pick people to assign.'
                  : mode === 'distribute'
                  ? `Split ${books.length} books across ${picked.size} ${picked.size === 1 ? 'person' : 'people'} (round-robin).`
                  : `Everyone (${picked.size}) on every book.`}
              </p>
            </>
          )}
        </div>
      </div>

      {books.length >= 2 && (
        <div className="border-t border-gray-100 px-4 py-2">
          <button
            onClick={onMerge}
            disabled={mergePending}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Merge {books.length} books into one
          </button>
        </div>
      )}
    </div>
  );
}
