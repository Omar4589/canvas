import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import PasswordInput from './PasswordInput.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

const inputCls =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600';

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
      <label className="block text-xs font-medium text-gray-700">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="text-2xl font-semibold text-gray-900 tabular-nums">
        {value}
      </div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

export default function UserProfileModal({ user, onClose }) {
  const qc = useQueryClient();
  const { user: currentUser } = useAuth();
  const isSelf = currentUser?.id === user?.id;

  const [form, setForm] = useState({
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    email: user.email || '',
    phone: user.phone || '',
    role: user.role || 'user',
  });

  // Reset form when prop user changes (e.g., after a successful save the
  // parent's `users` list re-renders with a refreshed user object).
  useEffect(() => {
    setForm({
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || '',
      phone: user.phone || '',
      role: user.role || 'user',
    });
  }, [
    user.id,
    user.firstName,
    user.lastName,
    user.email,
    user.phone,
    user.role,
  ]);

  const [showResetPw, setShowResetPw] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [feedback, setFeedback] = useState(null);

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
    queryKey: ['admin', 'user-stats', user.id, tz],
    queryFn: () =>
      api(`/admin/users/${user.id}/stats?tz=${encodeURIComponent(tz)}`),
    enabled: !!user.id,
  });

  const saveProfile = useMutation({
    mutationFn: (body) =>
      api(`/admin/users/${user.id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      flash('success', 'Profile updated.');
    },
    onError: (err) => flash('error', err.message),
  });

  const resetPw = useMutation({
    mutationFn: (password) =>
      api(`/admin/users/${user.id}/password`, {
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
        `/admin/users/${user.id}/${user.isActive ? 'deactivate' : 'reactivate'}`,
        { method: 'PATCH' }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      flash('success', user.isActive ? 'User deactivated.' : 'User reactivated.');
    },
    onError: (err) => flash('error', err.message),
  });

  const isDirty =
    form.firstName !== (user.firstName || '') ||
    form.lastName !== (user.lastName || '') ||
    form.email !== (user.email || '') ||
    form.phone !== (user.phone || '') ||
    form.role !== (user.role || 'user');

  function onSave(e) {
    e.preventDefault();
    if (!isDirty) return;
    const body = {};
    if (form.firstName !== user.firstName) body.firstName = form.firstName;
    if (form.lastName !== user.lastName) body.lastName = form.lastName;
    if (form.email !== user.email) body.email = form.email;
    if (form.phone !== (user.phone || '')) body.phone = form.phone;
    if (form.role !== user.role) body.role = form.role;
    saveProfile.mutate(body);
  }

  function onResetPw(e) {
    e.preventDefault();
    if (newPassword.length < 8) return;
    resetPw.mutate(newPassword);
  }

  function onToggleActive() {
    const verb = user.isActive ? 'deactivate' : 'reactivate';
    if (window.confirm(`Are you sure you want to ${verb} ${user.email}?`)) {
      toggleActive.mutate();
    }
  }

  const stats = statsQ.data;

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-5">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-50 text-lg font-bold text-brand-700">
              {initials(user.firstName, user.lastName)}
            </div>
            <div className="min-w-0">
              <div className="text-lg font-semibold text-gray-900">
                {user.firstName} {user.lastName}
              </div>
              <div className="truncate text-sm text-gray-500">{user.email}</div>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    user.role === 'admin'
                      ? 'bg-brand-50 text-brand-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {user.role === 'admin' ? 'Admin' : 'Canvasser'}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    user.isActive
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {user.isActive ? 'Active' : 'Inactive'}
                </span>
                <span className="text-xs text-gray-500">
                  Member since {formatDate(user.createdAt)}
                </span>
                <span className="text-xs text-gray-400">·</span>
                <span className="text-xs text-gray-500">
                  Last seen {formatRelative(user.lastLoginAt)}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <svg width="22" height="22" viewBox="0 0 20 20" fill="currentColor">
              <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 101.06 1.06L10 11.06l4.72 4.72a.75.75 0 101.06-1.06L11.06 10l4.72-4.72a.75.75 0 00-1.06-1.06L10 8.94 5.28 4.22z" />
            </svg>
          </button>
        </div>

        {/* Inline feedback banner */}
        {feedback && (
          <div
            className={`px-6 py-2 text-sm ${
              feedback.type === 'success'
                ? 'bg-green-50 text-green-800'
                : 'bg-red-50 text-red-700'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {/* Profile form */}
        <form
          onSubmit={onSave}
          className="border-b border-gray-200 px-6 py-5"
        >
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
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
              className={inputCls}
            />
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
          <Field label="Role" className="mt-3">
            {isSelf ? (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm italic text-gray-500">
                You can&apos;t change your own role. Ask another admin.
              </div>
            ) : (
              <div className="flex gap-2">
                {['user', 'admin'].map((r) => (
                  <label
                    key={r}
                    className={`flex flex-1 cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm ${
                      form.role === r
                        ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
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
                    {r === 'admin' ? 'Admin' : 'Canvasser'}
                  </label>
                ))}
              </div>
            )}
          </Field>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={!isDirty || saveProfile.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {saveProfile.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>

        {/* Activity stats */}
        <div className="border-b border-gray-200 px-6 py-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Activity (lifetime)
          </h3>
          {statsQ.isLoading ? (
            <div className="text-sm text-gray-500">Loading…</div>
          ) : statsQ.error ? (
            <div className="text-sm text-red-600">
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
              <div className="mt-3 text-xs text-gray-500">
                {stats.campaignsWorked || 0}{' '}
                {stats.campaignsWorked === 1 ? 'campaign' : 'campaigns'} worked
                {stats.lastActivityAt && (
                  <> · Last activity {formatRelative(stats.lastActivityAt)}</>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Account actions */}
        <div className="px-6 py-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Account
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowResetPw((s) => !s)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              {showResetPw ? 'Cancel reset' : 'Reset password'}
            </button>
            {!isSelf && (
              <button
                type="button"
                onClick={onToggleActive}
                disabled={toggleActive.isPending}
                className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                  user.isActive
                    ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                    : 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                }`}
              >
                {user.isActive ? 'Deactivate' : 'Reactivate'}
              </button>
            )}
          </div>
          {showResetPw && (
            <form
              onSubmit={onResetPw}
              className="mt-4 rounded-md bg-gray-50 p-4"
            >
              <label className="block text-xs font-medium text-gray-700">
                New password (min 8 chars)
              </label>
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
                  {resetPw.isPending ? 'Saving…' : 'Save password'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
