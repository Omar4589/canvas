import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

// Assign many selected books to many people in one go.
//   Distribute = round-robin (split the books evenly across the crew, one per book)
//   Everyone   = put every selected person on every selected book
export default function BulkAssignModal({ campaignId, turfIds, onClose }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [mode, setMode] = useState('distribute');
  const [replace, setReplace] = useState(false);

  const membersQ = useQuery({ queryKey: ['memberships'], queryFn: () => api('/admin/memberships') });

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const members = (membersQ.data?.members || []).filter((m) => m.user.isActive && m.isActive);
  const filtered = members.filter((m) => {
    if (!search.trim()) return true;
    const hay = `${m.user.firstName} ${m.user.lastName} ${m.user.email}`.toLowerCase();
    return hay.includes(search.trim().toLowerCase());
  });

  const assignMut = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/turfs/assign-bulk`, {
      method: 'POST',
      body: { turfIds, userIds: [...selected], mode, replace },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['turf-pass-assignments'] });
      qc.invalidateQueries({ queryKey: ['turf-assignments'] });
      qc.invalidateQueries({ queryKey: ['turfs'] });
      onClose();
    },
  });

  function toggle(id) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectAllVisible() {
    setSelected((s) => { const n = new Set(s); filtered.forEach((m) => n.add(m.user.id)); return n; });
  }

  const bookCount = turfIds.length;
  const userCount = selected.size;
  const summary = userCount === 0
    ? 'Pick people to assign'
    : mode === 'distribute'
      ? `Split ${bookCount} book${bookCount === 1 ? '' : 's'} across ${userCount} ${userCount === 1 ? 'person' : 'people'} (round-robin)`
      : `Put all ${userCount} ${userCount === 1 ? 'person' : 'people'} on every one of the ${bookCount} book${bookCount === 1 ? '' : 's'}`;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Assign {bookCount} book{bookCount === 1 ? '' : 's'}</h2>
            <p className="mt-1 text-xs text-gray-500">Pick people, choose how to spread the books, then Apply. Admins can be assigned too.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
            <svg width="22" height="22" viewBox="0 0 20 20" fill="currentColor"><path d="M5.28 4.22a.75.75 0 00-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 101.06 1.06L10 11.06l4.72 4.72a.75.75 0 101.06-1.06L11.06 10l4.72-4.72a.75.75 0 00-1.06-1.06L10 8.94 5.28 4.22z" /></svg>
          </button>
        </div>

        <div className="px-6 py-4">
          <div className="mb-3 flex rounded-md border border-gray-300 p-0.5 text-xs">
            {[
              { key: 'distribute', label: 'Distribute evenly' },
              { key: 'everyone', label: 'Everyone on every book' },
            ].map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setMode(o.key)}
                className={['flex-1 rounded px-2 py-1.5 font-medium transition-colors', mode === o.key ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-50'].join(' ')}
              >
                {o.label}
              </button>
            ))}
          </div>

          <div className="mb-3 flex items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people…"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            />
            <button onClick={selectAllVisible} className="shrink-0 rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
              Select all{search.trim() ? ' shown' : ''}
            </button>
          </div>

          {membersQ.isLoading ? (
            <div className="py-8 text-center text-sm text-gray-500">Loading…</div>
          ) : members.length === 0 ? (
            <div className="rounded border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
              No members in this org yet. Add one from the Users page.
            </div>
          ) : (
            <ul className="max-h-72 divide-y divide-gray-100 overflow-auto rounded-md border border-gray-200">
              {filtered.map((m) => {
                const u = m.user;
                const on = selected.has(u.id);
                return (
                  <li key={u.id}>
                    <button
                      onClick={() => toggle(u.id)}
                      className={['flex w-full items-center justify-between px-3 py-2 text-left text-sm', on ? 'bg-brand-50' : 'hover:bg-gray-50'].join(' ')}
                    >
                      <span className="flex items-center gap-2">
                        <span className={['flex h-4 w-4 items-center justify-center rounded border text-[10px]', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-300'].join(' ')}>{on ? '✓' : ''}</span>
                        <span className="font-medium text-gray-900">{u.firstName} {u.lastName}</span>
                        {m.role === 'admin' && (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">admin</span>
                        )}
                      </span>
                      <span className="text-xs text-gray-500">{u.email}</span>
                    </button>
                  </li>
                );
              })}
              {!filtered.length && <li className="px-3 py-3 text-center text-sm text-gray-500">No matches.</li>}
            </ul>
          )}

          <label className="mt-3 flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            Replace current assignments on these books first
          </label>
          <p className="mt-2 text-xs text-gray-500">{summary}.</p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-3">
          <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => assignMut.mutate()}
            disabled={!selected.size || assignMut.isPending}
            className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {assignMut.isPending ? 'Assigning…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
