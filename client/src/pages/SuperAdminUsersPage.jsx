import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString();
}

function formatRelative(d) {
  if (!d) return 'Never';
  const date = new Date(d);
  const ms = Date.now() - date.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return formatDate(d);
}

export default function SuperAdminUsersPage() {
  const qc = useQueryClient();
  const { user: currentUser } = useAuth();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const usersQ = useQuery({
    queryKey: ['super-admin', 'users'],
    queryFn: () => api('/super-admin/users'),
  });

  const promoteMut = useMutation({
    mutationFn: (userId) =>
      api(`/super-admin/users/${userId}/promote`, { method: 'POST' }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['super-admin', 'users'] }),
  });

  const users = usersQ.data?.users || [];

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((u) => {
      if (filter === 'super' && !u.isSuperAdmin) return false;
      if (filter === 'inactive' && u.isActive) return false;
      if (filter === 'active' && !u.isActive) return false;
      if (term) {
        const hay = `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [users, search, filter]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-gray-900">All users</h1>
        <p className="text-sm text-gray-500">
          Every user across every organization. Click a row to see their org memberships;
          toggle the super-admin flag with the button on the right.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
          className="flex-1 min-w-[220px] rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
        >
          <option value="all">All</option>
          <option value="super">Super admins</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <span className="text-xs text-gray-500">
          {visible.length} of {users.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Memberships</th>
              <th className="px-4 py-3 text-left">Last login</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {usersQ.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {visible.map((u) => {
              const isSelf = u.id === currentUser?.id;
              return (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {u.firstName} {u.lastName}
                    {u.isSuperAdmin && (
                      <span className="ml-2 rounded-full bg-yellow-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-700">
                        super
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{u.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        u.isActive
                          ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700'
                          : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500'
                      }
                    >
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.memberships?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {u.memberships.map((m) => (
                          <span
                            key={m.organizationId}
                            className={
                              m.role === 'admin'
                                ? 'rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700'
                                : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700'
                            }
                          >
                            {m.organizationName}
                            <span className="ml-1 text-[10px] uppercase tracking-wide opacity-75">
                              {m.role}
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">none</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {formatRelative(u.lastLoginAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => promoteMut.mutate(u.id)}
                      disabled={isSelf || promoteMut.isPending}
                      className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                        u.isSuperAdmin
                          ? 'border-yellow-200 bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                      title={isSelf ? "You can't change your own super-admin flag" : ''}
                    >
                      {u.isSuperAdmin ? 'Remove super' : 'Make super'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!usersQ.isLoading && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No users match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
