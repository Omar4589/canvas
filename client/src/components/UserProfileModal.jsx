import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import PasswordInput from './PasswordInput.jsx';
import { useAuth, useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';

const ACTION_LABEL = {
  survey_submitted: 'Surveyed',
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  lit_dropped: 'Lit dropped',
};

const ACTION_DOT_CLS = {
  survey_submitted: 'bg-green-500',
  not_home: 'bg-blue-500',
  wrong_address: 'bg-red-500',
  lit_dropped: 'bg-purple-500',
};

const inputCls =
  'w-full rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30';

function initials(first, last) {
  return ((first?.[0] || '') + (last?.[0] || '')).toUpperCase() || '?';
}

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatRelative(d) {
  if (!d) return 'Never';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const ms = Date.now() - date.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return formatDate(d);
}

function metersToMiles(m) {
  return ((m || 0) * 0.000621371).toFixed(1);
}

function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-fg-muted">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-border bg-sunken p-3">
      <div className="text-2xl font-semibold text-fg tabular-nums">
        {value}
      </div>
      <div className="text-xs text-fg-muted">{label}</div>
    </div>
  );
}

export default function UserProfileModal({ membership, onClose }) {
  const qc = useQueryClient();
  const orgTz = useOrgTimeZone();
  const { user: currentUser, isSuperAdmin } = useAuth();
  const user = membership.user;
  const isSelf = currentUser?.id === user?.id;
  const membershipActive = !!membership.isActive;
  // The login email is shared across every org this user belongs to, so a plain
  // org admin can't change it for a multi-org user — only the user or a super-admin.
  const emailLocked = !!user.isMultiOrg && !isSuperAdmin && !isSelf;

  const [form, setForm] = useState({
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    email: user.email || '',
    phone: user.phone || '',
    role: membership.role || 'canvasser',
  });

  useEffect(() => {
    setForm({
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || '',
      phone: user.phone || '',
      role: membership.role || 'canvasser',
    });
  }, [
    user.id,
    user.firstName,
    user.lastName,
    user.email,
    user.phone,
    membership.role,
  ]);

  const [showResetPw, setShowResetPw] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [coordinatorId, setCoordinatorId] = useState(membership.coordinatorId || '');
  const [clientCampaignIds, setClientCampaignIds] = useState(
    (membership.clientCampaignIds || []).map(String)
  );

  useEffect(() => {
    setCoordinatorId(membership.coordinatorId || '');
  }, [membership.coordinatorId]);

  useEffect(() => {
    setClientCampaignIds((membership.clientCampaignIds || []).map(String));
  }, [membership.clientCampaignIds]);

  function flash(type, text) {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 4000);
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const statsQ = useQuery({
    queryKey: ['admin', 'membership-stats', user.id, tz],
    queryFn: () =>
      api(`/admin/memberships/${user.id}/stats?tz=${encodeURIComponent(tz)}`),
    enabled: !!user.id,
  });

  const activityQ = useQuery({
    queryKey: ['admin', 'membership-recent-activity', user.id],
    queryFn: () => api(`/admin/memberships/${user.id}/recent-activity?limit=20`),
    enabled: !!user.id,
  });

  // Org roster (cached, shared with the Users page) → the eligible coordinators
  // are the active admins in this org, excluding this member themselves.
  const orgQ = useQuery({ queryKey: ['memberships'], queryFn: () => api('/admin/memberships') });
  const admins = (orgQ.data?.members || []).filter(
    (m) => m.role === 'admin' && m.user.isActive && m.isActive && m.user.id !== user.id
  );

  // Campaigns in this org — the access list a client can be granted.
  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
    enabled: membership.role === 'client',
  });
  const campaigns = campaignsQ.data?.campaigns || [];

  const saveCampaigns = useMutation({
    mutationFn: (ids) =>
      api(`/admin/memberships/${user.id}/campaigns`, {
        method: 'PATCH',
        body: { clientCampaignIds: ids },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships'] });
      flash('success', 'Campaign access updated.');
    },
    onError: (err) => {
      setClientCampaignIds((membership.clientCampaignIds || []).map(String)); // revert
      flash('error', err.message);
    },
  });

  const saveProfile = useMutation({
    mutationFn: (body) =>
      api(`/admin/memberships/${user.id}/user`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships'] });
      flash('success', 'Profile updated.');
    },
    onError: (err) => flash('error', err.message),
  });

  const saveRole = useMutation({
    mutationFn: (role) =>
      api(`/admin/memberships/${user.id}`, { method: 'PATCH', body: { role } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships'] });
      flash('success', 'Role updated.');
    },
    onError: (err) => flash('error', err.message),
  });

  const saveCoordinator = useMutation({
    mutationFn: (cid) =>
      api(`/admin/memberships/${user.id}`, {
        method: 'PATCH',
        body: { coordinatorId: cid || null },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships'] });
      flash('success', 'Coordinator updated.');
    },
    onError: (err) => {
      setCoordinatorId(membership.coordinatorId || ''); // revert on failure
      flash('error', err.message);
    },
  });

  function onChangeCoordinator(e) {
    const val = e.target.value;
    setCoordinatorId(val);
    saveCoordinator.mutate(val);
  }

  const resetPw = useMutation({
    mutationFn: (password) =>
      api(`/admin/memberships/${user.id}/password`, {
        method: 'PATCH',
        body: { password },
      }),
    onSuccess: () => {
      setShowResetPw(false);
      setNewPassword('');
      flash('success', 'Password reset.');
    },
    onError: (err) => flash('error', err.message),
  });

  const toggleActive = useMutation({
    mutationFn: () =>
      api(
        `/admin/memberships/${user.id}/${membershipActive ? 'deactivate' : 'reactivate'}`,
        { method: 'PATCH' }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships'] });
      flash('success', membershipActive ? 'Membership deactivated.' : 'Membership reactivated.');
    },
    onError: (err) => flash('error', err.message),
  });

  const removeFromOrg = useMutation({
    mutationFn: () => api(`/admin/memberships/${user.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships'] });
      onClose();
    },
    onError: (err) => flash('error', err.message),
  });

  const isProfileDirty =
    form.firstName !== (user.firstName || '') ||
    form.lastName !== (user.lastName || '') ||
    (!emailLocked && form.email !== (user.email || '')) ||
    form.phone !== (user.phone || '');

  const isRoleDirty = form.role !== (membership.role || 'canvasser');

  function onSaveProfile(e) {
    e.preventDefault();
    if (!isProfileDirty) return;
    const body = {};
    if (form.firstName !== user.firstName) body.firstName = form.firstName;
    if (form.lastName !== user.lastName) body.lastName = form.lastName;
    if (!emailLocked && form.email !== user.email) body.email = form.email;
    if (form.phone !== (user.phone || '')) body.phone = form.phone;
    saveProfile.mutate(body);
  }

  function onSaveRole() {
    if (!isRoleDirty) return;
    saveRole.mutate(form.role);
  }

  function onResetPw(e) {
    e.preventDefault();
    if (newPassword.length < 8) return;
    resetPw.mutate(newPassword);
  }

  function onToggleActive() {
    const verb = membershipActive ? 'deactivate' : 'reactivate';
    if (window.confirm(`Are you sure you want to ${verb} this membership for ${user.email}?`)) {
      toggleActive.mutate();
    }
  }

  function onRemove() {
    if (
      window.confirm(
        `Remove ${user.email} from this organization? This also removes their campaign assignments here.`
      )
    ) {
      removeFromOrg.mutate();
    }
  }

  const stats = statsQ.data;

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-overlay/40 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-tint text-lg font-bold text-brand-accent">
              {initials(user.firstName, user.lastName)}
            </div>
            <div className="min-w-0">
              <div className="text-lg font-semibold text-fg">
                {user.firstName} {user.lastName}
              </div>
              <div className="truncate text-sm text-fg-muted">{user.email}</div>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    membership.role === 'admin'
                      ? 'bg-brand-tint text-brand-accent'
                      : membership.role === 'client'
                      ? 'bg-info-tint text-info-fg'
                      : 'bg-sunken text-fg-muted'
                  }`}
                >
                  {membership.role === 'admin'
                    ? 'Admin'
                    : membership.role === 'client'
                    ? 'Client'
                    : 'Canvasser'}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    membershipActive && user.isActive
                      ? 'bg-success-tint text-success'
                      : 'bg-sunken text-fg-muted'
                  }`}
                >
                  {membershipActive && user.isActive ? 'Active' : 'Inactive'}
                </span>
                {user.isSuperAdmin && (
                  <span className="rounded-full bg-warning-tint px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-warning-fg">
                    super admin
                  </span>
                )}
                <span className="text-xs text-fg-muted">
                  Joined org {membership.addedAt ? formatInTz(membership.addedAt, orgTz, { month: 'short', day: 'numeric', year: 'numeric' }, false) : '—'}
                </span>
                <span className="text-xs text-fg-subtle">·</span>
                <span className="text-xs text-fg-muted">
                  Last seen {formatRelative(user.lastLoginAt)}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-fg-subtle hover:bg-sunken hover:text-fg-muted"
            aria-label="Close"
          >
            <svg width="22" height="22" viewBox="0 0 20 20" fill="currentColor">
              <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 101.06 1.06L10 11.06l4.72 4.72a.75.75 0 101.06-1.06L11.06 10l4.72-4.72a.75.75 0 00-1.06-1.06L10 8.94 5.28 4.22z" />
            </svg>
          </button>
        </div>

        {feedback && (
          <div
            className={`px-6 py-2 text-sm ${
              feedback.type === 'success'
                ? 'bg-success-tint text-green-800'
                : 'bg-danger-tint text-danger'
            }`}
          >
            {feedback.text}
          </div>
        )}

        <form
          onSubmit={onSaveProfile}
          className="border-b border-border px-6 py-5"
        >
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Profile
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <input
                value={form.firstName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, firstName: e.target.value }))
                }
                required
                className={inputCls}
              />
            </Field>
            <Field label="Last name">
              <input
                value={form.lastName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, lastName: e.target.value }))
                }
                required
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Email" className="mt-3">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
              disabled={emailLocked}
              className={`${inputCls.replace(' bg-card', '')} ${
                emailLocked ? 'cursor-not-allowed bg-sunken text-fg-muted' : 'bg-card'
              }`}
            />
            {emailLocked && (
              <p className="mt-1 text-xs italic text-fg-muted">
                This user belongs to multiple organizations; their login email can
                only be changed by the user or a super-admin.
              </p>
            )}
          </Field>
          <Field label="Phone" className="mt-3">
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="Optional"
              className={inputCls}
            />
          </Field>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={!isProfileDirty || saveProfile.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {saveProfile.isPending ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </form>

        <div className="border-b border-border px-6 py-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Role in this org
          </h3>
          {isSelf ? (
            <div className="rounded-md border border-border bg-sunken px-3 py-2 text-sm italic text-fg-muted">
              You can&apos;t change your own role. Ask another admin.
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex flex-1 gap-2">
                {['canvasser', 'admin', 'client'].map((r) => (
                  <label
                    key={r}
                    className={`flex flex-1 cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm ${
                      form.role === r
                        ? 'border-brand-600 bg-brand-tint font-semibold text-brand-accent'
                        : 'border-border-strong text-fg-muted hover:bg-sunken'
                    }`}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={r}
                      checked={form.role === r}
                      onChange={() => setForm((f) => ({ ...f, role: r }))}
                      className="sr-only"
                    />
                    {r === 'admin' ? 'Admin' : r === 'client' ? 'Client' : 'Canvasser'}
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={onSaveRole}
                disabled={!isRoleDirty || saveRole.isPending}
                className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
              >
                {saveRole.isPending ? 'Saving…' : 'Save role'}
              </button>
            </div>
          )}
        </div>

        {membership.role !== 'client' && (
          <div className="border-b border-border px-6 py-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Coordinator
            </h3>
            <select
              value={coordinatorId}
              onChange={onChangeCoordinator}
              disabled={saveCoordinator.isPending}
              className={`${inputCls} disabled:opacity-60`}
            >
              <option value="">— No coordinator —</option>
              {admins.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.firstName} {m.user.lastName}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-fg-muted">
              The admin who oversees this member. Saved immediately.
            </p>
          </div>
        )}

        {membership.role === 'client' && (
          <div className="border-b border-border px-6 py-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Campaign access
            </h3>
            <div className="flex flex-wrap gap-3">
              {campaigns.length === 0 && (
                <span className="text-sm text-fg-muted">No campaigns in this org yet.</span>
              )}
              {campaigns.map((c) => {
                const id = String(c._id);
                const checked = clientCampaignIds.includes(id);
                return (
                  <label key={id} className="flex items-center gap-2 text-sm text-fg">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={saveCampaigns.isPending}
                      onChange={() => {
                        const next = checked
                          ? clientCampaignIds.filter((x) => x !== id)
                          : [...clientCampaignIds, id];
                        setClientCampaignIds(next);
                        saveCampaigns.mutate(next);
                      }}
                    />
                    {c.name}
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-fg-muted">
              The client sees published reports for these campaigns. Saved immediately.
            </p>
          </div>
        )}

        <div className="border-b border-border px-6 py-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Activity (in this org)
          </h3>
          {statsQ.isLoading ? (
            <div className="text-sm text-fg-muted">Loading…</div>
          ) : statsQ.error ? (
            <div className="text-sm text-danger">
              Error: {statsQ.error.message}
            </div>
          ) : stats ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="Doors knocked"
                  value={(stats.doorsKnocked ?? 0).toLocaleString()}
                />
                <Stat
                  label="Surveys"
                  value={(stats.surveysSubmitted ?? 0).toLocaleString()}
                />
                <Stat
                  label="Lit drops"
                  value={(stats.litDropped ?? 0).toLocaleString()}
                />
                <Stat
                  label="Miles walked"
                  value={metersToMiles(stats.distanceMeters)}
                />
              </div>
              <div className="mt-3 text-xs text-fg-muted">
                {stats.campaignsWorked || 0}{' '}
                {stats.campaignsWorked === 1 ? 'campaign' : 'campaigns'} worked
                {stats.lastActivityAt && (
                  <> · Last activity {formatRelative(stats.lastActivityAt)}</>
                )}
              </div>
            </>
          ) : null}
        </div>

        <div className="border-b border-border px-6 py-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Recent activity
            </h3>
            <Link
              to="/map"
              className="text-xs font-semibold text-brand-accent hover:underline"
              onClick={onClose}
            >
              View on map →
            </Link>
          </div>
          {activityQ.isLoading ? (
            <div className="text-sm text-fg-muted">Loading…</div>
          ) : activityQ.error ? (
            <div className="text-sm text-danger">
              Error: {activityQ.error.message}
            </div>
          ) : !activityQ.data?.activities?.length ? (
            <div className="rounded-md border border-dashed border-border bg-sunken px-4 py-6 text-center text-sm text-fg-muted">
              No activity yet.
            </div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
              {activityQ.data.activities.map((a) => (
                <li
                  key={a.id}
                  className="flex items-start gap-3 bg-card px-3 py-2 text-sm"
                >
                  <span
                    className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                      ACTION_DOT_CLS[a.actionType] || 'bg-gray-400'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-fg">
                      {ACTION_LABEL[a.actionType] || a.actionType}
                    </div>
                    <div className="truncate text-xs text-fg-muted">
                      {a.household
                        ? `${a.household.addressLine1}${
                            a.household.city ? ', ' + a.household.city : ''
                          }`
                        : 'Address unavailable'}
                      {a.campaign?.name && (
                        <>
                          {' '}
                          <span className="text-fg-subtle">·</span>{' '}
                          {a.campaign.name}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-fg-muted">
                    {formatRelative(a.timestamp)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-6 py-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Account
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowResetPw((s) => !s)}
              className="rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-sunken"
            >
              {showResetPw ? 'Cancel' : 'Set temporary password'}
            </button>
            {!isSelf && (
              <>
                <button
                  type="button"
                  onClick={onToggleActive}
                  disabled={toggleActive.isPending}
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                    membershipActive
                      ? 'border-danger/30 bg-danger-tint text-danger hover:bg-danger-tint'
                      : 'border-success/30 bg-success-tint text-success hover:bg-success-tint'
                  }`}
                >
                  {membershipActive ? 'Deactivate membership' : 'Reactivate membership'}
                </button>
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={removeFromOrg.isPending}
                  className="rounded-md border border-danger/40 px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-tint disabled:opacity-50"
                >
                  Remove from org
                </button>
              </>
            )}
          </div>
          {showResetPw && (
            <form
              onSubmit={onResetPw}
              className="mt-4 rounded-md bg-sunken p-4"
            >
              <label className="block text-xs font-medium text-fg-muted">
                Temporary password (min 8 chars)
              </label>
              <p className="mt-1 text-xs text-fg-muted">
                The user will be required to choose a new password the next time
                they log in.
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <div className="min-w-[240px] flex-1">
                  <PasswordInput
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={resetPw.isPending || newPassword.length < 8}
                  className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
                >
                  {resetPw.isPending ? 'Saving…' : 'Set password'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
