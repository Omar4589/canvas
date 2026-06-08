import { useEffect, useRef, useState } from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../lib/useTheme.js';
import Logo from './Logo.jsx';
import { IconSun, IconMoon } from './ui/icons.jsx';
import IconButton from './ui/IconButton.jsx';
import { Avatar } from './ui/Avatar.jsx';

// Slim shell for the read-only client (candidate) portal. Brand + org name on the left; theme
// toggle + an avatar account menu (Account settings / Sign out) on the right.
export default function ClientLayout() {
  const { user, logout, activeMembership } = useAuth();
  const { dark, toggle } = useTheme();
  const navigate = useNavigate();
  const orgName = activeMembership?.organizationName;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    document.title = 'Campaign Reports';
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function onDoc(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const itemCls = 'block w-full rounded-md px-3 py-2 text-left text-sm text-fg transition-colors hover:bg-sunken';

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/client" className="flex items-center gap-2.5">
            <Logo size={24} />
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-fg">Campaign Reports</span>
              {orgName && <span className="text-xs text-fg-muted">{orgName}</span>}
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <IconButton label="Toggle theme" onClick={toggle}>
              {dark ? <IconSun /> : <IconMoon />}
            </IconButton>

            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center rounded-full p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Account menu"
              >
                <Avatar user={user} size="md" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full z-40 mt-1.5 w-60 animate-pop-in rounded-lg border border-border bg-raised p-1 shadow-popover">
                  <div className="px-3 py-2">
                    {orgName && (
                      <div className="truncate text-xs font-medium text-brand-accent">{orgName}</div>
                    )}
                    <div className="truncate text-sm font-medium text-fg">
                      {user?.firstName} {user?.lastName}
                    </div>
                    <div className="truncate text-xs text-fg-muted">{user?.email}</div>
                  </div>
                  <div className="my-1 border-t border-border" />
                  <button
                    type="button"
                    className={itemCls}
                    onClick={() => {
                      setMenuOpen(false);
                      navigate('/client/profile');
                    }}
                  >
                    Account settings
                  </button>
                  <button
                    type="button"
                    className={itemCls}
                    onClick={() => {
                      setMenuOpen(false);
                      logout();
                    }}
                  >
                    Sign out
                  </button>
                </div>
              )}
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
