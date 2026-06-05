import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import PasswordInput from '../components/PasswordInput.jsx';
import UserProfileModal from '../components/UserProfileModal.jsx';

const FORM_INPUT_CLS =
  'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600';

const FILTER_INPUT_CLS =
  'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600';

// --- Premium-restyle preview tokens/helpers (presentation only) ---
// Soft, low-spread elevation (the Stripe/Linear card look) via inline values so this
// preview stays self-contained — no tailwind.config or shared-file changes to revert.
const CARD = 'rounded-xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.06)]';
const SELECT_CLS =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:border-gray-400 focus:border-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/20';

function initials(u) {
  return ((u?.firstName?.[0] || '') + (u?.lastName?.[0] || '')).toUpperCase() || '?';
}
function Avatar({ user, sm }) {
  const size = sm ? 'h-6 w-6 text-[10px]' : 'h-9 w-9 text-xs';
  return (
    <span className={`inline-flex ${size} shrink-0 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-700 ring-1 ring-brand-100`}>
      {initials(user)}
    </span>
  );
}
function IconSearch(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function IconChevron(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
function SkeletonRows() {
  return (
    <div className="divide-y divide-gray-100">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <div className="h-9 w-9 animate-pulse rounded-full bg-gray-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-40 animate-pulse rounded bg-gray-100" />
            <div className="h-2.5 w-56 animate-pulse rounded bg-gray-50" />
          </div>
          <div className="h-5 w-16 animate-pulse rounded-full bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  password: '',
  role: 'canvasser',
  coordinatorId: '',
};

const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
  { value: 'recent-joined', label: 'Recently joined' },
  { value: 'recent-active', label: 'Recently active' },
];

function compareName(a, b, dir) {
  // Sort by the displayed "First Last" order so the list reads alphabetically.
  const an = `${a.user.firstName} ${a.user.lastName}`.toLowerCase();
  const bn = `${b.user.firstName} ${b.user.lastName}`.toLowerCase();
  if (an < bn) return dir === 'asc' ? -1 : 1;
  if (an > bn) return dir === 'asc' ? 1 : -1;
  return 0;
}

function compareDate(a, b, key) {
  const av = a[key] ? new Date(a[key]).getTime() : 0;
  const bv = b[key] ? new Date(b[key]).getTime() : 0;
  if (av === 0 && bv === 0) return 0;
  if (av === 0) return 1;
  if (bv === 0) return -1;
  return bv - av;
}

export default function UsersPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['memberships'],
    queryFn: () => api('/admin/memberships'),
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [emailLookup, setEmailLookup] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(null);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [coordinatorFilter, setCoordinatorFilter] = useState('all');
  const [sortMode, setSortMode] = useState('name-asc');

  const addMember = useMutation({
    mutationFn: (body) => api('/admin/memberships', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEmailLookup(false);
    },
    onError: (err) => {
      // The email already exists globally — nudge the admin toward the link path.
      if (err.data?.code === 'EMAIL_EXISTS_USE_LINK') setEmailLookup(true);
    },
  });

  const members = data?.members || [];
  const selectedMember = selectedUserId
    ? members.find((m) => m.user.id === selectedUserId) || null
    : null;

  // Active admins in this org — the eligible coordinators.
  const admins = useMemo(
    () => members.filter((m) => m.role === 'admin' && m.user.isActive && m.isActive),
    [members]
  );
  // userId → "First Last", for rendering a coordinatorId as a name.
  const nameByUserId = useMemo(
    () => new Map(members.map((m) => [m.user.id, `${m.user.firstName} ${m.user.lastName}`])),
    [members]
  );
  const coordinatorName = (id) => (id && nameByUserId.get(id)) || null;

  const visibleMembers = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = members.filter((m) => {
      if (roleFilter !== 'all' && m.role !== roleFilter) return false;
      const active = m.isActive && m.user.isActive;
      if (statusFilter === 'active' && !active) return false;
      if (statusFilter === 'inactive' && active) return false;
      if (coordinatorFilter === 'none' && m.coordinatorId) return false;
      if (
        coordinatorFilter !== 'all' &&
        coordinatorFilter !== 'none' &&
        m.coordinatorId !== coordinatorFilter
      )
        return false;
      if (term) {
        const hay = `${m.user.firstName} ${m.user.lastName} ${m.user.email}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    list = list.slice();
    if (sortMode === 'name-asc') list.sort((a, b) => compareName(a, b, 'asc'));
    else if (sortMode === 'name-desc') list.sort((a, b) => compareName(a, b, 'desc'));
    else if (sortMode === 'recent-joined')
      list.sort((a, b) => compareDate(a, b, 'addedAt'));
    else if (sortMode === 'recent-active')
      list.sort((a, b) =>
        compareDate(
          { lastLoginAt: a.user.lastLoginAt },
          { lastLoginAt: b.user.lastLoginAt },
          'lastLoginAt'
        )
      );
    return list;
  }, [members, search, roleFilter, statusFilter, coordinatorFilter, sortMode]);

  function onSubmit(e) {
    e.preventDefault();
    const body = {
      email: form.email.trim(),
      role: form.role,
      linkExisting: emailLookup,
      coordinatorId: form.coordinatorId || null,
    };
    if (!emailLookup) {
      body.firstName = form.firstName;
      body.lastName = form.lastName;
      body.phone = form.phone;
      body.password = form.password;
    }
    addMember.mutate(body);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Users</h1>
          <p className="text-sm text-gray-500">Members of this organization.</p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.08)] transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30"
        >
          {!showForm && <span className="text-base leading-none">+</span>}
          {showForm ? 'Cancel' : 'Add member'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={onSubmit}
          className={`mb-6 grid grid-cols-1 gap-4 ${CARD} p-5 md:grid-cols-3`}
        >
          <div className="md:col-span-3 flex items-center gap-2 text-xs">
            <label className="inline-flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={emailLookup}
                onChange={(e) => setEmailLookup(e.target.checked)}
              />
              <span className="text-gray-700">
                Existing user (by email — link them to this org)
              </span>
            </label>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
              required
              className={FORM_INPUT_CLS}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">Role</label>
            <select
              value={form.role}
              onChange={(e) => setForm((s) => ({ ...s, role: e.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            >
              <option value="canvasser">Canvasser</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-gray-700">
              Coordinator <span className="text-gray-400">(optional)</span>
            </label>
            <select
              value={form.coordinatorId}
              onChange={(e) => setForm((s) => ({ ...s, coordinatorId: e.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            >
              <option value="">— None —</option>
              {admins.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.firstName} {m.user.lastName}
                </option>
              ))}
            </select>
          </div>

          {!emailLookup && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700">
                  First name
                </label>
                <input
                  value={form.firstName}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, firstName: e.target.value }))
                  }
                  required
                  className={FORM_INPUT_CLS}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">
                  Last name
                </label>
                <input
                  value={form.lastName}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, lastName: e.target.value }))
                  }
                  required
                  className={FORM_INPUT_CLS}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">
                  Phone <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, phone: e.target.value }))
                  }
                  className={FORM_INPUT_CLS}
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-xs font-medium text-gray-700">
                  Initial password
                </label>
                <div className="mt-1">
                  <PasswordInput
                    value={form.password}
                    onChange={(e) =>
                      setForm((s) => ({ ...s, password: e.target.value }))
                    }
                    required
                    autoComplete="new-password"
                  />
                </div>
              </div>
            </>
          )}

          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={addMember.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
            >
              {addMember.isPending
                ? 'Adding…'
                : emailLookup
                ? 'Link existing user'
                : 'Create + add'}
            </button>
            {addMember.error && (
              <span className="ml-3 text-sm text-red-600">
                {addMember.error.message}
              </span>
            )}
          </div>
        </form>
      )}

      <div className={`mb-4 flex flex-wrap items-center gap-2.5 ${CARD} p-2.5`}>
        <div className="relative min-w-[220px] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <IconSearch />
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-400 focus:border-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/20"
          />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className={SELECT_CLS}>
          <option value="all">All roles</option>
          <option value="admin">Admins</option>
          <option value="canvasser">Canvassers</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={SELECT_CLS}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select value={coordinatorFilter} onChange={(e) => setCoordinatorFilter(e.target.value)} className={SELECT_CLS}>
          <option value="all">All coordinators</option>
          <option value="none">No coordinator</option>
          {admins.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.firstName} {m.user.lastName}
            </option>
          ))}
        </select>
        <select value={sortMode} onChange={(e) => setSortMode(e.target.value)} className={SELECT_CLS}>
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <span className="ml-auto rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium tabular-nums text-gray-600">
          {visibleMembers.length} of {members.length}
        </span>
      </div>

      {isLoading ? (
        <div className={`overflow-hidden ${CARD}`}>
          <SkeletonRows />
        </div>
      ) : (
        <div className={`overflow-hidden ${CARD}`}>
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50/90 backdrop-blur">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-2.5">Member</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Coordinator</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="w-8 px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleMembers.map((m) => {
                const u = m.user;
                const active = m.isActive && u.isActive;
                const coord = coordinatorName(m.coordinatorId);
                return (
                  <tr
                    key={m.membershipId}
                    onClick={() => setSelectedUserId(u.id)}
                    className="group cursor-pointer transition-colors hover:bg-gray-50/70"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar user={u} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-medium text-gray-900">
                            <span className="truncate">{u.firstName} {u.lastName}</span>
                            {u.isSuperAdmin && (
                              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-amber-100">
                                super
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-gray-500">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          m.role === 'admin'
                            ? 'inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-100'
                            : 'inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600'
                        }
                      >
                        {m.role === 'admin' ? 'Admin' : 'Canvasser'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {coord ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Avatar user={{ firstName: coord.split(' ')[0], lastName: coord.split(' ').slice(1).join(' ') }} sm />
                          <span className="truncate">{coord}</span>
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          active
                            ? 'inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-100'
                            : 'inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500'
                        }
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-gray-400'}`} />
                        {active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300 transition-colors group-hover:text-gray-500">
                      <IconChevron className="ml-auto" />
                    </td>
                  </tr>
                );
              })}
              {!members.length && (
                <tr>
                  <td colSpan="5" className="px-4 py-14 text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                    </div>
                    <div className="text-sm font-medium text-gray-900">No members yet</div>
                    <div className="mt-1 text-sm text-gray-500">Click <strong>Add member</strong> to start.</div>
                  </td>
                </tr>
              )}
              {members.length > 0 && !visibleMembers.length && (
                <tr>
                  <td colSpan="5" className="px-4 py-14 text-center text-sm text-gray-500">
                    No members match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedMember && (
        <UserProfileModal
          membership={selectedMember}
          onClose={() => setSelectedUserId(null)}
        />
      )}
    </div>
  );
}
