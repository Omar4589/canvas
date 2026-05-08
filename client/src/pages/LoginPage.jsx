import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { getActiveOrgId } from '../api/client.js';
import PasswordInput from '../components/PasswordInput.jsx';
import Logo from '../components/Logo.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await login(email, password);
      const adminMemberships = (res.memberships || []).filter((m) => m.role === 'admin');
      const canAccessConsole = res.user.isSuperAdmin || adminMemberships.length > 0;
      if (!canAccessConsole) {
        setError('You need an admin role on at least one organization to use the dashboard.');
        return;
      }
      const memberships = res.memberships || [];
      if (res.user.isSuperAdmin) {
        const savedOrgId = getActiveOrgId();
        navigate(savedOrgId ? '/' : '/super-admin', { replace: true });
        return;
      }
      if (memberships.length > 1) {
        navigate('/select-org', { replace: true });
        return;
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <Logo size={40} />
          <p className="mt-3 text-sm text-gray-500">
            Door-to-door canvassing made easy.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <label className="block text-xs font-semibold text-gray-700">
            Email address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            required
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
          />

          <label className="mt-4 block text-xs font-semibold text-gray-700">
            Password
          </label>
          <div className="mt-1">
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
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
