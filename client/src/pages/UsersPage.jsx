import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import UserProfileModal from '../components/UserProfileModal.jsx';
import { tempPasswordProblem } from '../lib/validators.js';
import {
  Card,
  Button,
  Badge,
  Avatar,
  DataTable,
  EmptyState,
  SkeletonRows,
  Input,
  PhoneInput,
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
  managedCampaignIds: [],
};

const ROLE_LABEL = { admin: 'Admin', lead: 'Team lead', canvasser: 'Canvasser' };

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

// A small on/off switch for an admin's billing access. Stops row-click so
// flipping the switch doesn't also open the member's profile modal.
function BillingToggle({ on, pending, onToggle, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Billing access for ${label}`}
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 ${
        on ? 'bg-brand-600' : 'bg-border-strong'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          on ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export default function UsersPage() {
  const qc = useQueryClient();
  const { canViewBilling } = useAuth();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('return'); // set when arriving from a campaign's setup flow
  const { data, isLoading } = useQuery({
    queryKey: ['memberships'],
    queryFn: () => api('/admin/memberships'),
  });
  // Campaigns to grant a team lead (their managed set).
  const campaignsQ = useQuery({ queryKey: ['admin', 'campaigns'], queryFn: () => api('/admin/campaigns') });
  const campaigns = campaignsQ.data?.campaigns || [];

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [emailLookup, setEmailLookup] = useState(false);
  const [formError, setFormError] = useState('');
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

  // Grant/revoke an admin's access to the org's Billing page. Server enforces that
  // the caller is themselves a billing admin (or super); we only surface the control
  // when the current user can view billing.
  const saveBilling = useMutation({
    mutationFn: ({ userId, billingAccess }) =>
      api(`/admin/memberships/${userId}`, { method: 'PATCH', body: { billingAccess } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memberships'] }),
  });

  const members = data?.members || [];
  const selectedMember = selectedUserId
    ? members.find((m) => m.user.id === selectedUserId) || null
    : null;

  // Active admins + team leads in this org — the eligible coordinators.
  const coordinators = useMemo(
    () => members.filter((m) => (m.role === 'admin' || m.role === 'lead') && m.user.isActive && m.isActive),
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
    if (form.role === 'lead') body.managedCampaignIds = form.managedCampaignIds;
    if (!emailLookup) {
      // A new account: check the relaxed temp-password rule before the round-trip.
      const problem = tempPasswordProblem(form.password);
      if (problem) {
        setFormError(problem);
        return;
      }
      body.firstName = form.firstName;
      body.lastName = form.lastName;
      body.phone = form.phone;
      body.password = form.password;
    }
    setFormError('');
    addMember.mutate(body);
  }

  function toggleFormCampaign(id, checked) {
    setForm((s) => ({
      ...s,
      managedCampaignIds: checked
        ? [...new Set([...s.managedCampaignIds, id])]
        : s.managedCampaignIds.filter((x) => x !== id),
    }));
  }

  const labelCls = 'block text-xs font-medium text-fg';
  // Table column count — the optional Billing-access column shifts the empty-state colSpans.
  const colCount = canViewBilling ? 6 : 5;

  return (
    <div>
      {returnTo && (
        <Link to={returnTo} className="mb-3 inline-block text-sm font-medium text-brand-accent hover:underline">
          ‹ Back to setup
        </Link>
      )}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Users</h1>
          <p className="text-sm text-fg-muted">
            Members of this organization — the canvassers you assign books to. (Voter records live under Voters.)
          </p>
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
              <input
                type="checkbox"
                checked={emailLookup}
                onChange={(e) => {
                  setEmailLookup(e.target.checked);
                  setFormError('');
                }}
              />
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
              <option value="lead">Team lead</option>
              <option value="admin">Admin</option>
            </Select>
          </div>
          {form.role === 'lead' && (
            <div className="md:col-span-3 rounded-md border border-border bg-sunken p-3">
              <label className={labelCls}>Campaigns this lead manages</label>
              <p className="mt-0.5 text-xs text-fg-muted">
                A team lead fully runs the campaigns you check here — and only those.
              </p>
              <div className="mt-2 max-h-44 space-y-1 overflow-auto rounded border border-border-strong bg-card p-2">
                {campaigns.length === 0 && (
                  <p className="px-1 py-2 text-xs text-fg-muted">No campaigns yet — create one first.</p>
                )}
                {campaigns.map((c) => {
                  const id = String(c._id);
                  return (
                    <label key={id} className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-sm text-fg">
                      <input
                        type="checkbox"
                        checked={form.managedCampaignIds.includes(id)}
                        onChange={(e) => toggleFormCampaign(id, e.target.checked)}
                      />
                      <span className="truncate">
                        {c.name}
                        {c.isActive === false ? ' · Archived' : ''}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
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
              {coordinators.map((m) => (
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
                <PhoneInput
                  value={form.phone}
                  onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div className="md:col-span-3">
                <label className={labelCls}>Temporary password <span className="text-fg-subtle">(min 8 characters — they set their own at first sign-in)</span></label>
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
            {(formError || addMember.error) && (
              <span className="ml-3 text-sm text-danger">{formError || addMember.error.message}</span>
            )}
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
          <option value="lead">Team leads</option>
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
          {coordinators.map((m) => (
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

      {/* A refused billing-access change (notably LAST_BILLING_ADMIN — the org can't be left with
          no billing admin) surfaces here. The toggle itself is server-data-driven, so it snaps
          back on its own; this is the "why". Clears on the next toggle attempt (mutate resets). */}
      {saveBilling.isError && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-3 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger"
        >
          <span className="flex-1">{saveBilling.error.message}</span>
          <button
            type="button"
            onClick={() => saveBilling.reset()}
            className="shrink-0 font-semibold hover:opacity-70"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

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
              {canViewBilling && <th className="px-4 py-2.5">Billing access</th>}
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
                  <Badge variant={m.role === 'admin' ? 'brand' : m.role === 'lead' ? 'info' : 'neutral'}>
                    {ROLE_LABEL[m.role] || 'Canvasser'}
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
                {canViewBilling && (
                  <td className="px-4 py-3">
                    {m.role === 'admin' ? (
                      <BillingToggle
                        on={!!m.billingAccess}
                        pending={saveBilling.isPending && saveBilling.variables?.userId === u.id}
                        onToggle={() => saveBilling.mutate({ userId: u.id, billingAccess: !m.billingAccess })}
                        label={`${u.firstName} ${u.lastName}`}
                      />
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-3 text-right text-fg-subtle transition-colors group-hover:text-fg-muted">
                  <IconChevronRight className="ml-auto" />
                </td>
              </tr>
            );
          })}
          {!members.length && (
            <tr>
              <td colSpan={colCount}>
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
              <td colSpan={colCount} className="px-4 py-14 text-center text-sm text-fg-muted">
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
