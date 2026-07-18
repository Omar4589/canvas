import { useState, useEffect } from 'react';
import { Navigate, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { getActiveOrgId } from '../api/client.js';
import { resolveHomePath } from '../lib/homePath.js';
import PasswordInput from '../components/PasswordInput.jsx';
import Logo from '../components/Logo.jsx';

export default function LoginPage() {
  const { login, user, loading, memberships, activeOrgId } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Sign in — Doorline';
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await login(email, password);
      const dest = resolveHomePath({
        user: res.user,
        memberships: res.memberships || [],
        activeOrgId: getActiveOrgId(),
      });
      if (!dest) {
        setError('You need an admin or team-lead role on at least one organization to use the dashboard.');
        return;
      }
      // Restore a deep link (stashed by ProtectedRoute) only when landing on the user's
      // actual home — never skip the change-password / org-picker / super-admin routes.
      const from = location.state?.from?.pathname;
      const restore = from && (dest === '/admin' || dest === '/campaigns');
      navigate(restore ? from : dest, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Already signed in? Don't show the login form — send them where they belong. A
  // logged-out visitor has no token, so `loading` is already false and the form shows
  // immediately; only a token-bearing visitor briefly waits on the /auth/me check.
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-fg-muted">Loading…</div>
    );
  }
  if (user) {
    const dest = resolveHomePath({ user, memberships, activeOrgId });
    // Canvassers (no console access → null) fall through to the form.
    if (dest) return <Navigate to={dest} replace />;
  }

  return (
    <div className="flex h-screen items-center justify-center bg-sunken px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <Logo size={40} />
          <p className="mt-3 text-sm text-fg-muted">
            Door-to-door canvassing made easy.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-xl border border-border bg-card p-6 shadow-sm"
        >
          {/* One-time note after a completed reset (navigate('/login', { state: { resetSuccess } })).
              Router state clears on the next navigation, so it never reappears on a manual visit. */}
          {location.state?.resetSuccess && (
            <div className="mb-4 rounded-md border border-success/30 bg-success-tint px-3 py-2 text-sm text-success">
              Password updated — sign in with your new password.
            </div>
          )}

          <label className="block text-xs font-semibold text-fg-muted">
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

          <div className="mt-4 flex items-baseline justify-between">
            <label className="block text-xs font-semibold text-fg-muted">
              Password
            </label>
            <Link
              to="/forgot-password"
              className="text-xs font-semibold text-brand-accent hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <div className="mt-1">
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
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
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
