import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { getActiveOrgId, setActiveOrgId } from '../api/client.js';
import PasswordInput from '../components/PasswordInput.jsx';
import Logo from '../components/Logo.jsx';

export default function ChangePasswordPage() {
  const { user, mustChangePassword, changePassword } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Set a new password — Doorline';
  }, []);

  // If a user lands here without owing a change (e.g. navigated manually), send
  // them on their way.
  useEffect(() => {
    if (user && !mustChangePassword) navigate('/admin', { replace: true });
  }, [user, mustChangePassword, navigate]);

  function routeOnward(res) {
    const memberships = res.memberships || [];
    if (res.user.isSuperAdmin) {
      navigate(getActiveOrgId() ? '/admin' : '/super-admin', { replace: true });
      return;
    }
    if (memberships.length > 1) {
      navigate('/select-org', { replace: true });
      return;
    }
    if (memberships.length === 1) {
      setActiveOrgId(memberships[0].organizationId);
    }
    navigate('/admin', { replace: true });
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await changePassword(currentPassword, newPassword);
      routeOnward(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-sunken px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <Logo size={40} />
          <p className="mt-3 text-center text-sm text-fg-muted">
            For security, set a new password before continuing.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-xl border border-border bg-card p-6 shadow-sm"
        >
          <label className="block text-xs font-semibold text-fg-muted">
            Current (temporary) password
          </label>
          <div className="mt-1">
            <PasswordInput
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <label className="mt-4 block text-xs font-semibold text-fg-muted">
            New password (min 8 chars)
          </label>
          <div className="mt-1">
            <PasswordInput
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <label className="mt-4 block text-xs font-semibold text-fg-muted">
            Confirm new password
          </label>
          <div className="mt-1">
            <PasswordInput
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-5 w-full rounded-md bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Set new password'}
          </button>
        </form>
      </div>
    </div>
  );
}
