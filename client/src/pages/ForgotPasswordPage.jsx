import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Logo from '../components/Logo.jsx';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = 'Reset your password — Doorline';
    // Keep the reset flow out of the index — nothing here is a real landing page and
    // the reset URLs carry one-time tokens. Injected on mount, removed on unmount so it
    // never leaks onto the rest of the SPA.
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
    setSubmitting(true);
    try {
      // Public endpoint — carry no stale token/org header. Always 200 for a well-formed
      // email, whether or not the account exists (the confirmation copy below matches).
      await api('/auth/forgot-password', {
        method: 'POST',
        body: { email: email.trim() },
        public: true,
      });
      setDone(true);
    } catch (err) {
      if (err.status === 429) {
        setError('Too many requests — please wait a few minutes and try again.');
      } else if (err.status === 400) {
        setError('Please enter a valid email address.');
      } else {
        setError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-sunken px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <Logo size={40} />
          <p className="mt-3 text-sm text-fg-muted">
            {done ? 'Check your email.' : 'Reset your password.'}
          </p>
        </div>

        {done ? (
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <p className="text-sm text-fg">
              If an account exists for that address, we've emailed a reset link. Follow
              it to set a new password.
            </p>
            <Link
              to="/login"
              className="mt-5 block text-center text-sm font-semibold text-brand-accent hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            className="rounded-xl border border-border bg-card p-6 shadow-sm"
          >
            <p className="text-sm text-fg-muted">
              Enter the email address for your account and we'll send you a link to set a
              new password.
            </p>

            <label className="mt-4 block text-xs font-semibold text-fg-muted">
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              required
              className="mt-1 w-full rounded-md border border-border-strong bg-card px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />

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
              {submitting ? 'Sending…' : 'Send reset link'}
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
