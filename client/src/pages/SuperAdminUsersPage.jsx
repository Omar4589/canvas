import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Pager from '../components/Pager.jsx';
import LockoutPanel from '../components/LockoutPanel.jsx';
import { formatDate, formatRelative } from '../lib/dates.js';

const LIMIT = 25;

// Filter chips → server query params. Server-side now: the browser never holds the full user base.
const FILTERS = [
  { key: 'all', label: 'All', params: {} },
  { key: 'super', label: 'Super admins', params: { super: '1' } },
  { key: 'active', label: 'Active', params: { active: '1' } },
  { key: 'inactive', label: 'Inactive', params: { active: '0' } },
  { key: 'deleted', label: 'Deleted', params: { deleted: '1' } },
  { key: 'tempPassword', label: 'Temp password', params: { tempPassword: '1' } },
  { key: 'orphan', label: 'No memberships', params: { orphan: '1' } },
];

export default function SuperAdminUsersPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const isBreakGlass = currentUser?.platformRole === 'break_glass';

  const [searchText, setSearchText] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [skip, setSkip] = useState(0);
  // Server-side sort — the page only ever holds 25 rows, so a client-side sort would reorder
  // the visible page while the list stayed unsorted. 'name' is the server default; it is
  // omitted from the query string (the OrganizationsPage convention) to keep URLs clean.
  const [sort, setSort] = useState('name');
  const [expandedId, setExpandedId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const params = new URLSearchParams({ limit: String(LIMIT), skip: String(skip) });
  if (q) params.set('q', q);
  if (sort !== 'name') params.set('sort', sort);
  for (const [k, v] of Object.entries(FILTERS.find((f) => f.key === filter)?.params || {})) {
    params.set(k, v);
  }
  const usersQ = useQuery({
    // `sort` must live in the key, or React Query serves the previous ordering from cache.
    queryKey: ['super-admin', 'users', 'table', q, filter, skip, sort],
    queryFn: () => api(`/super-admin/users?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['super-admin', 'users'] });

  // Promote/demote is break-glass-gated server-side; the button is hidden for support-tier supers
  // and any refusal (e.g. last-break-glass guard) surfaces instead of being swallowed.
  const promoteMut = useMutation({
    mutationFn: (userId) => api(`/super-admin/users/${userId}/promote`, { method: 'POST' }),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) => setActionError(err.message),
  });

  const roleMut = useMutation({
    mutationFn: ({ userId, platformRole }) =>
      api(`/super-admin/users/${userId}/platform-role`, { method: 'PATCH', body: { platformRole } }),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) => setActionError(err.message),
  });

  const users = usersQ.data?.users || [];
  const total = usersQ.data?.total || 0;
  const deletedCount = usersQ.data?.deletedCount || 0;

  function submitSearch(e) {
    e.preventDefault();
    setSkip(0);
    setQ(searchText.trim());
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-fg">All users</h1>
        <p className="text-sm text-fg-muted">
          Every user across every organization. Expand a row for lockout state, platform role, and
          account details.
        </p>
      </div>

      <form onSubmit={submitSearch} className="mb-2 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search name or email…"
          className="flex-1 min-w-[220px] rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          Search
        </button>
        <span className="text-xs text-fg-muted">
          {/* Tombstoned accounts are counted separately so they never inflate the headline. */}
          {filter === 'deleted'
            ? `${total} deleted account${total === 1 ? '' : 's'}`
            : `${(total - deletedCount).toLocaleString()} account${total - deletedCount === 1 ? '' : 's'}${deletedCount ? ` · ${deletedCount} deleted` : ''}`}
        </span>
      </form>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => { setSkip(0); setFilter(f.key); }}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              filter === f.key ? 'bg-brand-accent text-white' : 'bg-sunken text-fg-muted hover:text-fg'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {actionError}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              {/* Sortable headers drive the SERVER sort param (OrganizationsPage pattern) — one
                  fixed direction per column, ▾ marks the active one. Status/Memberships aren't
                  sortable: memberships are joined per page AFTER the window is chosen. Three
                  clocks, labeled apart: typing a password, using the app at all, and knocking
                  doors — the third lives in the expanded row and can't be sorted for the same
                  per-page reason. */}
              {[
                { key: 'name', label: 'Name', sortable: true },
                { key: 'email', label: 'Email', sortable: true },
                { key: 'status', label: 'Status' },
                { key: 'memberships', label: 'Memberships' },
                { key: 'lastLogin', label: 'Last login', sortable: true },
                { key: 'lastSeen', label: 'Last active', sortable: true },
                { key: 'created', label: 'Created', sortable: true },
              ].map((c) => (
                <th key={c.key} className="px-4 py-3 text-left">
                  {c.sortable ? (
                    <button
                      type="button"
                      onClick={() => { setSkip(0); setSort(c.key); }}
                      className={`uppercase tracking-wide hover:text-fg ${sort === c.key ? 'text-fg' : ''}`}
                    >
                      {c.label}
                      {sort === c.key && ' ▾'}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {usersQ.isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-fg-muted">
                  Loading…
                </td>
              </tr>
            )}
            {users.map((u) => {
              const isSelf = u.id === currentUser?.id;
              const expanded = expandedId === u.id;
              return [
                <tr key={u.id} className={expanded ? 'bg-sunken/50' : ''}>
                  <td className="px-4 py-3 font-medium text-fg">
                    <Link
                      to={`/super-admin/users/${u.id}`}
                      className="underline decoration-dotted underline-offset-2 hover:text-brand-accent"
                    >
                      {u.firstName} {u.lastName}
                    </Link>
                    {u.isSuperAdmin && (
                      <span className="ml-2 rounded-full bg-warning-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-fg">
                        {u.platformRole === 'break_glass' ? 'break-glass' : 'support'}
                      </span>
                    )}
                    {u.deletedAt && (
                      <span className="ml-2 rounded-full bg-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                        deleted
                      </span>
                    )}
                    {u.mustChangePassword && !u.deletedAt && (
                      <span className="ml-2 rounded-full bg-info-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-info-fg">
                        temp pw
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
                          <button
                            key={m.organizationId}
                            onClick={() => navigate(`/organizations?billing=${m.organizationId}`)}
                            title={`Open ${m.organizationName}'s billing panel`}
                            className={
                              m.role === 'admin'
                                ? 'rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand-accent hover:opacity-80'
                                : 'rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted hover:text-fg'
                            }
                          >
                            {m.organizationName}
                            <span className="ml-1 text-[10px] uppercase tracking-wide opacity-75">
                              {m.role}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-fg-subtle">none</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-fg-muted" title="Last time this account signed in with a password. Sessions last 30 days, so a daily user can still read weeks old.">
                    {formatRelative(u.lastLoginAt)}
                  </td>
                  {/* Em-dash, not "Never": before this account's first request after the feature
                      shipped, lastSeenAt is simply not recorded yet — "Never" would be false. */}
                  <td className="px-4 py-3 text-xs text-fg-muted" title="Last authenticated request from this account, on any surface. Recorded at most every 15 minutes.">
                    {formatRelative(u.lastSeenAt, { never: '—' })}
                  </td>
                  {/* Visible on purpose: creation order WAS the old default sort, and with no
                      column showing it the list read as random. */}
                  <td className="px-4 py-3 text-xs text-fg-muted whitespace-nowrap">
                    {formatDate(u.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setExpandedId(expanded ? null : u.id)}
                      className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-fg-muted transition-colors hover:bg-sunken"
                    >
                      {expanded ? 'Close' : 'Details'}
                    </button>
                  </td>
                </tr>,
                expanded && (
                  <tr key={`${u.id}-detail`} className="bg-sunken/50">
                    <td colSpan={8} className="px-4 pb-4">
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-fg-muted">
                        <span>Phone: {u.phone || '—'}</span>
                        <span>Joined: {formatDate(u.createdAt)}</span>
                        <span title="Most recent door knocked by this account. Only canvassers ever have one.">
                          Last canvassed: {formatRelative(u.lastActivityAt, { never: '—' })}
                        </span>
                        {u.deletedAt && <span>Deleted: {formatDate(u.deletedAt)}</span>}
                        {u.deletionLocked && <span className="font-medium">Deletion-locked (reviewer demo account)</span>}
                      </div>
                      <div className="mt-2">
                        <LockoutPanel user={u} />
                      </div>
                      {isBreakGlass && !u.deletedAt && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
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
                          {u.isSuperAdmin && (
                            <>
                              <span className="text-xs text-fg-subtle">Platform role:</span>
                              <select
                                value={u.platformRole || 'support'}
                                onChange={(e) => roleMut.mutate({ userId: u.id, platformRole: e.target.value })}
                                disabled={roleMut.isPending}
                                className="rounded border border-border-strong bg-card px-2 py-1 text-xs text-fg focus:border-brand-accent focus:outline-none"
                                title="support = day-to-day operations; break-glass = destructive actions (org delete, promotions) and everyone's sessions"
                              >
                                <option value="support">support</option>
                                <option value="break_glass">break-glass</option>
                              </select>
                            </>
                          )}
                        </div>
                      )}
                      {!isBreakGlass && u.isSuperAdmin && (
                        <p className="mt-2 text-xs text-fg-subtle">
                          Changing super-admin status or platform role requires the break-glass role.
                        </p>
                      )}
                    </td>
                  </tr>
                ),
              ];
            })}
            {!usersQ.isLoading && users.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-fg-muted">
                  No users match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager skip={skip} limit={LIMIT} total={total} onChange={setSkip} className="mt-3" />
    </div>
  );
}
