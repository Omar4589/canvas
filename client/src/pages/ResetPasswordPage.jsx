import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import PasswordInput from '../components/PasswordInput.jsx';
import PasswordRequirements from '../components/PasswordRequirements.jsx';
import { isStrongPassword, passwordProblem } from '../lib/validators.js';
import Logo from '../components/Logo.jsx';

// Serves BOTH password resets (forgot-password link) and first-time invite / set-password
// links, so the copy stays neutral — never "you forgot your password".
export default function ResetPasswordPage() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    document.title = 'Set a new password — Doorline';
    // Reset/invite URLs carry a one-time token — keep them out of the index. Injected on
    // mount, removed on unmount so it never leaks onto the rest of the SPA.
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!isStrongPassword(newPassword)) {
      setError(passwordProblem(newPassword));
      return;
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      // Public endpoint — no token/org header. A weak password 400 does NOT consume the
      // token, so the user can fix it inline and resubmit against the same link.
      await api('/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword },
        public: true,
      });
      navigate('/login', { state: { resetSuccess: true } });
    } catch (err) {
      if (err.code === 'RESET_INVALID') {
        setInvalid(true);
        return;
      }
      // Weak-password (Zod-style) 400 — surface the message and keep the form usable.
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
            Set a new password
          </p>
        </div>

        {invalid ? (
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
              This link is invalid or has expired.
            </div>
            <p className="mt-4 text-sm text-fg-muted">
              Reset links can only be used once and expire after a while. Request a fresh
              one to continue.
            </p>
            <Link
              to="/forgot-password"
              className="mt-5 block text-center text-sm font-semibold text-brand-accent hover:underline"
            >
              Request a new link
            </Link>
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            className="rounded-xl border border-border bg-card p-6 shadow-sm"
          >
            <label className="block text-xs font-semibold text-fg-muted">
              New password
            </label>
            <div className="mt-1">
              <PasswordInput
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <PasswordRequirements password={newPassword} />

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

            <Link
              to="/login"
              className="mt-4 block text-center text-sm font-semibold text-brand-accent hover:underline"
            >
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
