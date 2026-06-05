import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

export default function TurfAssignmentsModal({ campaignId, turf, onClose }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const base = `/admin/campaigns/${campaignId}/turfs/${turf._id}/assignments`;

  const membersQ = useQuery({ queryKey: ['memberships'], queryFn: () => api('/admin/memberships') });
  const assignmentsQ = useQuery({ queryKey: ['turf-assignments', turf._id], queryFn: () => api(base) });

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const assignedSet = useMemo(
    () => new Set((assignmentsQ.data?.assignments || []).map((a) => String(a.userId?._id || a.userId))),
    [assignmentsQ.data]
  );
  const invalidate = () => qc.invalidateQueries({ queryKey: ['turf-assignments', turf._id] });
  const assignMut = useMutation({ mutationFn: (userIds) => api(base, { method: 'POST', body: { userIds } }), onSuccess: invalidate });
  const unassignMut = useMutation({ mutationFn: (userId) => api(`${base}/${userId}`, { method: 'DELETE' }), onSuccess: invalidate });

  // Anyone active in the org can be assigned a book — admins canvass too.
  const members = (membersQ.data?.members || []).filter((m) => m.user.isActive && m.isActive);
  const filtered = members.filter((m) => {
    if (!search.trim()) return true;
    const hay = `${m.user.firstName} ${m.user.lastName} ${m.user.email}`.toLowerCase();
    return hay.includes(search.trim().toLowerCase());
  });
  const unassignedVisible = filtered.filter((m) => !assignedSet.has(m.user.id));

  function toggle(userId) {
    if (assignedSet.has(userId)) unassignMut.mutate(userId);
    else assignMut.mutate([userId]);
  }
  function assignAllVisible() {
    const ids = unassignedVisible.map((m) => m.user.id);
    if (ids.length) assignMut.mutate(ids);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Assign people</h2>
            <p className="text-sm text-gray-500">
              Book: <span className="font-medium">{turf.name}</span> · {turf.eligibleDoorCount ?? turf.doorCount} doors
            </p>
            <p className="mt-1 text-xs text-gray-500">Multiple people can share a book. Admins can be assigned too.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
            <svg width="22" height="22" viewBox="0 0 20 20" fill="currentColor">
              <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 101.06 1.06L10 11.06l4.72 4.72a.75.75 0 101.06-1.06L11.06 10l4.72-4.72a.75.75 0 00-1.06-1.06L10 8.94 5.28 4.22z" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4">
          <div className="mb-3 flex items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people…"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            />
            {unassignedVisible.length > 0 && (
              <button
                onClick={assignAllVisible}
                disabled={assignMut.isPending}
                className="shrink-0 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-50"
              >
                Assign all{search.trim() ? ' shown' : ''} ({unassignedVisible.length})
              </button>
            )}
          </div>
          {membersQ.isLoading || assignmentsQ.isLoading ? (
            <div className="py-8 text-center text-sm text-gray-500">Loading…</div>
          ) : members.length === 0 ? (
            <div className="rounded border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
              No members in this org yet. Add one from the Users page.
            </div>
          ) : (
            <ul className="max-h-80 divide-y divide-gray-100 overflow-auto rounded-md border border-gray-200">
              {filtered.map((m) => {
                const u = m.user;
                const assigned = assignedSet.has(u.id);
                return (
                  <li key={u.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{u.firstName} {u.lastName}</span>
                        {m.role === 'admin' && (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">admin</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{u.email}</div>
                    </div>
                    <button
                      onClick={() => toggle(u.id)}
                      disabled={assignMut.isPending || unassignMut.isPending}
                      className={assigned
                        ? 'rounded-md border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50'
                        : 'rounded-md border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-50'}
                    >
                      {assigned ? 'Unassign' : 'Assign'}
                    </button>
                  </li>
                );
              })}
              {!filtered.length && <li className="px-3 py-3 text-center text-sm text-gray-500">No matches.</li>}
            </ul>
          )}
        </div>

        <div className="border-t border-gray-100 px-6 py-3 text-right">
          <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Done</button>
        </div>
      </div>
    </div>
  );
}
