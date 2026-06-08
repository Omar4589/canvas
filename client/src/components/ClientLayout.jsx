import { useEffect } from 'react';
import { Outlet, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../lib/useTheme.js';
import Logo from './Logo.jsx';
import { IconSun, IconMoon } from './ui/icons.jsx';
import IconButton from './ui/IconButton.jsx';

// Slim shell for the read-only client (candidate) portal — no admin nav, just a header with
// the theme toggle and sign-out, and the report content below.
export default function ClientLayout() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();

  useEffect(() => {
    document.title = 'Campaign Reports';
  }, []);

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/client" className="flex items-center gap-2">
            <Logo size={24} />
            <span className="text-sm font-semibold text-fg">Campaign Reports</span>
          </Link>
          <div className="flex items-center gap-3">
            <IconButton label="Toggle theme" onClick={toggle}>
              {dark ? <IconSun /> : <IconMoon />}
            </IconButton>
            <div className="text-right">
              <div className="hidden text-xs font-medium text-fg sm:block">
                {user?.firstName} {user?.lastName}
              </div>
              <button onClick={logout} className="text-xs font-semibold text-brand-accent hover:underline">
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
