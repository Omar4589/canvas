import { useEffect, useRef, useState } from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../lib/useTheme.js';
import Logo from './Logo.jsx';
import { IconSun, IconMoon } from './ui/icons.jsx';
import IconButton from './ui/IconButton.jsx';

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

function ChevronDown({ open }) {
  return (
    <svg width="14" height="14" {...svgProps} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width="16" height="16" {...svgProps} className="shrink-0">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V15z" />
    </svg>
  );
}
function SignOutIcon() {
  return (
    <svg width="16" height="16" {...svgProps} className="shrink-0">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

// Slim shell for the read-only client (candidate) portal. Brand + org name on the left; theme
// toggle + a name/email account dropdown (Settings / Sign out) on the right.
export default function ClientLayout() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const navigate = useNavigate();
  const { activeMembership } = useAuth();
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

  const itemCls =
    'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-fg transition-colors hover:bg-sunken';

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
                className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span className="hidden flex-col items-end leading-tight sm:flex">
                  <span className="text-sm font-medium text-fg">
                    {user?.firstName} {user?.lastName}
                  </span>
                  <span className="text-xs text-fg-muted">{user?.email}</span>
                </span>
                <ChevronDown open={menuOpen} />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full z-40 mt-1.5 w-56 animate-pop-in rounded-lg border border-border bg-raised p-1 shadow-popover">
                  {/* On small screens the trigger hides the name/email, so repeat it here. */}
                  <div className="px-3 py-2 sm:hidden">
                    <div className="truncate text-sm font-medium text-fg">
                      {user?.firstName} {user?.lastName}
                    </div>
                    <div className="truncate text-xs text-fg-muted">{user?.email}</div>
                  </div>
                  <div className="border-t border-border sm:hidden" />
                  <button
                    type="button"
                    className={itemCls}
                    onClick={() => {
                      setMenuOpen(false);
                      navigate('/client/profile');
                    }}
                  >
                    <GearIcon />
                    Settings
                  </button>
                  <button
                    type="button"
                    className={itemCls}
                    onClick={() => {
                      setMenuOpen(false);
                      logout();
                    }}
                  >
                    <SignOutIcon />
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
