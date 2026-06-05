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
        <h1 className="text-2xl font-semibold text-fg">All users</h1>
        <p className="text-sm text-fg-muted">
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
          className="flex-1 min-w-[220px] rounded-md border border-border-strong px-3 py-2 text-sm focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-md border border-border-strong bg-card px-3 py-2 text-sm focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <option value="all">All</option>
          <option value="super">Super admins</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <span className="text-xs text-fg-muted">
          {visible.length} of {users.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Memberships</th>
              <th className="px-4 py-3 text-left">Last login</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {usersQ.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-fg-muted">
                  Loading…
                </td>
              </tr>
            )}
            {visible.map((u) => {
              const isSelf = u.id === currentUser?.id;
              return (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-medium text-fg">
                    {u.firstName} {u.lastName}
                    {u.isSuperAdmin && (
                      <span className="ml-2 rounded-full bg-warning-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-fg">
                        super
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{u.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        u.isActive
                          ? 'rounded-full bg-success-tint px-2 py-0.5 text-xs font-medium text-success'
                          : 'rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted'
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
                                ? 'rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand-accent'
                                : 'rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted'
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
                      <span className="text-xs text-fg-subtle">none</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-fg-muted">
                    {formatRelative(u.lastLoginAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => promoteMut.mutate(u.id)}
                      disabled={isSelf || promoteMut.isPending}
                      className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                        u.isSuperAdmin
                          ? 'border-warning/30 bg-warning-tint text-warning-fg hover:bg-warning-tint'
                          : 'border-border bg-card text-fg-muted hover:bg-sunken'
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
                <td colSpan={6} className="px-4 py-8 text-center text-fg-muted">
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
