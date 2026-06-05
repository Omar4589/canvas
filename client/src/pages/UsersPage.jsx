import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import PasswordInput from '../components/PasswordInput.jsx';
import UserProfileModal from '../components/UserProfileModal.jsx';
import {
  Card,
  Button,
  Badge,
  Avatar,
  DataTable,
  EmptyState,
  SkeletonRows,
  Input,
  Select,
  IconSearch,
  IconChevronRight,
  IconUsers,
} from '../components/ui';

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
    else if (sortMode === 'recent-joined') list.sort((a, b) => compareDate(a, b, 'addedAt'));
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

  const labelCls = 'block text-xs font-medium text-fg';

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Users</h1>
          <p className="text-sm text-fg-muted">Members of this organization.</p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)}>
          {!showForm && <span className="text-base leading-none">+</span>}
          {showForm ? 'Cancel' : 'Add member'}
        </Button>
      </div>

      {showForm && (
        <Card as="form" onSubmit={onSubmit} className="mb-6 grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
          <div className="md:col-span-3 flex items-center gap-2 text-xs">
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={emailLookup} onChange={(e) => setEmailLookup(e.target.checked)} />
              <span className="text-fg-muted">Existing user (by email — link them to this org)</span>
            </label>
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>Email</label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
              required
              className="mt-1"
            />
          </div>
          <div>
            <label className={labelCls}>Role</label>
            <Select
              value={form.role}
              onChange={(e) => setForm((s) => ({ ...s, role: e.target.value }))}
              className="mt-1 w-full"
            >
              <option value="canvasser">Canvasser</option>
              <option value="admin">Admin</option>
            </Select>
          </div>
          <div className="md:col-span-3">
            <label className={labelCls}>
              Coordinator <span className="text-fg-subtle">(optional)</span>
            </label>
            <Select
              value={form.coordinatorId}
              onChange={(e) => setForm((s) => ({ ...s, coordinatorId: e.target.value }))}
              className="mt-1 w-full"
            >
              <option value="">— None —</option>
              {admins.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.firstName} {m.user.lastName}
                </option>
              ))}
            </Select>
          </div>

          {!emailLookup && (
            <>
              <div>
                <label className={labelCls}>First name</label>
                <Input
                  value={form.firstName}
                  onChange={(e) => setForm((s) => ({ ...s, firstName: e.target.value }))}
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <label className={labelCls}>Last name</label>
                <Input
                  value={form.lastName}
                  onChange={(e) => setForm((s) => ({ ...s, lastName: e.target.value }))}
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <label className={labelCls}>
                  Phone <span className="text-fg-subtle">(optional)</span>
                </label>
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div className="md:col-span-3">
                <label className={labelCls}>Initial password</label>
                <div className="mt-1">
                  <PasswordInput
                    value={form.password}
                    onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))}
                    required
                    autoComplete="new-password"
                  />
                </div>
              </div>
            </>
          )}

          <div className="md:col-span-3">
            <Button type="submit" loading={addMember.isPending}>
              {emailLookup ? 'Link existing user' : 'Create + add'}
            </Button>
            {addMember.error && <span className="ml-3 text-sm text-danger">{addMember.error.message}</span>}
          </div>
        </Card>
      )}

      <Card className="mb-4 flex flex-wrap items-center gap-2.5 p-2.5">
        <div className="min-w-[220px] flex-1">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            leadingIcon={<IconSearch size={16} />}
          />
        </div>
        <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="all">All roles</option>
          <option value="admin">Admins</option>
          <option value="canvasser">Canvassers</option>
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Select value={coordinatorFilter} onChange={(e) => setCoordinatorFilter(e.target.value)}>
          <option value="all">All coordinators</option>
          <option value="none">No coordinator</option>
          {admins.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.firstName} {m.user.lastName}
            </option>
          ))}
        </Select>
        <Select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <span className="ml-auto rounded-full bg-sunken px-2.5 py-1 text-xs font-medium tabular-nums text-fg-muted">
          {visibleMembers.length} of {members.length}
        </span>
      </Card>

      {isLoading ? (
        <Card className="overflow-hidden">
          <SkeletonRows />
        </Card>
      ) : (
        <DataTable
          head={
            <>
              <th className="px-4 py-2.5">Member</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Coordinator</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="w-8 px-4 py-2.5"></th>
            </>
          }
        >
          {visibleMembers.map((m) => {
            const u = m.user;
            const active = m.isActive && u.isActive;
            const coord = coordinatorName(m.coordinatorId);
            return (
              <tr
                key={m.membershipId}
                onClick={() => setSelectedUserId(u.id)}
                className="group cursor-pointer transition-colors hover:bg-sunken/60"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar user={u} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-medium text-fg">
                        <span className="truncate">{u.firstName} {u.lastName}</span>
                        {u.isSuperAdmin && (
                          <Badge variant="warning" className="uppercase tracking-wide">super</Badge>
                        )}
                      </div>
                      <div className="truncate text-xs text-fg-muted">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={m.role === 'admin' ? 'brand' : 'neutral'}>
                    {m.role === 'admin' ? 'Admin' : 'Canvasser'}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-fg-muted">
                  {coord ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Avatar
                        user={{ firstName: coord.split(' ')[0], lastName: coord.split(' ').slice(1).join(' ') }}
                        size="sm"
                      />
                      <span className="truncate">{coord}</span>
                    </span>
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={active ? 'success' : 'neutral'} dot>
                    {active ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right text-fg-subtle transition-colors group-hover:text-fg-muted">
                  <IconChevronRight className="ml-auto" />
                </td>
              </tr>
            );
          })}
          {!members.length && (
            <tr>
              <td colSpan="5">
                <EmptyState
                  icon={<IconUsers size={22} />}
                  title="No members yet"
                  hint={<>Click <strong>Add member</strong> to start.</>}
                />
              </td>
            </tr>
          )}
          {members.length > 0 && !visibleMembers.length && (
            <tr>
              <td colSpan="5" className="px-4 py-14 text-center text-sm text-fg-muted">
                No members match your filters.
              </td>
            </tr>
          )}
        </DataTable>
      )}

      {selectedMember && (
        <UserProfileModal membership={selectedMember} onClose={() => setSelectedUserId(null)} />
      )}
    </div>
  );
}
