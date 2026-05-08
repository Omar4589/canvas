import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import PasswordInput from '../components/PasswordInput.jsx';
import UserProfileModal from '../components/UserProfileModal.jsx';

const FORM_INPUT_CLS =
  'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600';

const FILTER_INPUT_CLS =
  'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600';

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  password: '',
  role: 'canvasser',
};

const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
  { value: 'recent-joined', label: 'Recently joined' },
  { value: 'recent-active', label: 'Recently active' },
];

function compareName(a, b, dir) {
  const an = `${a.user.lastName} ${a.user.firstName}`.toLowerCase();
  const bn = `${b.user.lastName} ${b.user.firstName}`.toLowerCase();
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
  const [sortMode, setSortMode] = useState('name-asc');

  const addMember = useMutation({
    mutationFn: (body) => api('/admin/memberships', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEmailLookup(false);
    },
  });

  const members = data?.members || [];
  const selectedMember = selectedUserId
    ? members.find((m) => m.user.id === selectedUserId) || null
    : null;

  const visibleMembers = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = members.filter((m) => {
      if (roleFilter !== 'all' && m.role !== roleFilter) return false;
      const active = m.isActive && m.user.isActive;
      if (statusFilter === 'active' && !active) return false;
      if (statusFilter === 'inactive' && active) return false;
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
  }, [members, search, roleFilter, statusFilter, sortMode]);

  function onSubmit(e) {
    e.preventDefault();
    const body = {
      email: form.email.trim(),
      role: form.role,
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
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-xs text-gray-500">Members of this organization.</p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
        >
          {showForm ? 'Cancel' : 'Add member'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={onSubmit}
          className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-5 md:grid-cols-3"
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

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
          className={`${FILTER_INPUT_CLS} flex-1 min-w-[220px]`}
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className={FILTER_INPUT_CLS}
        >
          <option value="all">All roles</option>
          <option value="admin">Admins</option>
          <option value="canvasser">Canvassers</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={FILTER_INPUT_CLS}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value)}
          className={FILTER_INPUT_CLS}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-500">
          {visibleMembers.length} of {members.length}
        </span>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-left">Role</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="w-8 px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visibleMembers.map((m) => {
                const u = m.user;
                const active = m.isActive && u.isActive;
                return (
                  <tr
                    key={m.membershipId}
                    onClick={() => setSelectedUserId(u.id)}
                    className="cursor-pointer border-t border-gray-100 transition-colors hover:bg-gray-50"
                  >
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
                          m.role === 'admin'
                            ? 'rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700'
                            : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700'
                        }
                      >
                        {m.role === 'admin' ? 'Admin' : 'Canvasser'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          active
                            ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700'
                            : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500'
                        }
                      >
                        {active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-lg leading-none text-gray-400">
                      ›
                    </td>
                  </tr>
                );
              })}
              {!members.length && (
                <tr>
                  <td colSpan="5" className="px-4 py-10 text-center text-gray-500">
                    No members yet. Click <strong>Add member</strong> to start.
                  </td>
                </tr>
              )}
              {members.length > 0 && !visibleMembers.length && (
                <tr>
                  <td colSpan="5" className="px-4 py-10 text-center text-gray-500">
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
