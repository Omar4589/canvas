import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../lib/useTheme.js';
import Logo, { LogoMark } from './Logo.jsx';
import { NAV, SUPER_NAV, NAV_GROUPS } from './navItems.js';
import { navIcon, IconSignOut, IconChevron } from './navIcons.jsx';
import { IconSun, IconMoon } from './ui/icons.jsx';
import IconButton from './ui/IconButton.jsx';
import OrgSwitcher from './OrgSwitcher.jsx';
import BottomNav from './BottomNav.jsx';
import AddedToOrgBanner from './AddedToOrgBanner.jsx';

function navClass(collapsed) {
  return ({ isActive }) =>
    [
      'flex items-center gap-3 rounded-md text-sm font-medium transition-colors',
      collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2',
      isActive
        ? 'bg-brand-600 text-white shadow-card'
        : 'text-fg-muted hover:bg-brand-tint hover:text-brand-tint-fg',
    ].join(' ');
}

function NavItem({ n, collapsed }) {
  const Icon = navIcon(n.to);
  return (
    <NavLink
      to={n.to}
      end={n.end}
      title={collapsed ? n.label : undefined}
      className={navClass(collapsed)}
    >
      <Icon size={20} />
      {!collapsed && <span>{n.label}</span>}
    </NavLink>
  );
}

const GROUP_HEADER = 'mt-3 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle';

function ThemeToggle({ collapsed, dark, toggle }) {
  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={[
        'flex items-center gap-3 rounded-md text-sm font-medium text-fg-muted transition-colors hover:bg-sunken hover:text-fg',
        collapsed ? 'justify-center p-2' : 'w-full px-3 py-2',
      ].join(' ')}
    >
      {dark ? <IconSun /> : <IconMoon />}
      {!collapsed && <span>{dark ? 'Light mode' : 'Dark mode'}</span>}
    </button>
  );
}

export default function Layout() {
  const { user, logout, isSuperAdmin } = useAuth();
  const { dark, toggle: toggleTheme } = useTheme();
  const location = useLocation();
  const isFullBleed = location.pathname === '/map' || location.pathname === '/queues';

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebarCollapsed') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  // The static index.html title is marketing copy for the public landing page;
  // reset it to the console title once we're inside the authenticated app.
  useEffect(() => {
    document.title = 'Doorline Admin';
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <aside
        className={[
          'hidden md:flex flex-col border-r border-border bg-card py-5 transition-all duration-200',
          collapsed ? 'w-16 px-2' : 'w-60 px-4',
        ].join(' ')}
      >
        <div
          className={[
            'shrink-0',
            collapsed ? 'mb-4 flex flex-col items-center gap-2' : 'mb-1 flex items-center justify-between px-1',
          ].join(' ')}
        >
          {collapsed ? <LogoMark size={26} /> : <Logo size={26} />}
          <IconButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            variant="subtle"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
          >
            <span className={collapsed ? 'block rotate-180' : 'block'}>
              <IconChevron />
            </span>
          </IconButton>
        </div>

        {!collapsed && (
          <div className="mb-4 px-1 text-xs text-fg-muted shrink-0">
            Admin console{isSuperAdmin && <span className="ml-1 text-brand-accent">· super</span>}
          </div>
        )}

        {!collapsed && (
          <div className="shrink-0">
            <OrgSwitcher />
          </div>
        )}

        <nav className="flex-1 min-h-0 overflow-y-auto space-y-1">
          {NAV.filter((n) => !n.group).map((n) => (
            <NavItem key={n.to} n={n} collapsed={collapsed} />
          ))}
          {NAV_GROUPS.map((group) => {
            const items = NAV.filter((n) => n.group === group);
            if (!items.length) return null;
            return (
              <div key={group} className="space-y-1">
                {collapsed ? (
                  <div className="my-2 border-t border-border" />
                ) : (
                  <div className={GROUP_HEADER}>{group}</div>
                )}
                {items.map((n) => (
                  <NavItem key={n.to} n={n} collapsed={collapsed} />
                ))}
              </div>
            );
          })}
          {isSuperAdmin && (
            <>
              {collapsed ? (
                <div className="my-2 border-t border-border" />
              ) : (
                <div className={GROUP_HEADER}>Platform</div>
              )}
              {SUPER_NAV.map((n) => (
                <NavItem key={n.to} n={n} collapsed={collapsed} />
              ))}
            </>
          )}
        </nav>

        <div
          className={[
            'mt-4 border-t border-border pt-3 shrink-0',
            collapsed ? 'flex flex-col items-center gap-1' : '',
          ].join(' ')}
        >
          <ThemeToggle collapsed={collapsed} dark={dark} toggle={toggleTheme} />
          {collapsed ? (
            <IconButton label="Sign out" onClick={logout} className="text-brand-accent hover:bg-brand-tint hover:text-brand-hover">
              <IconSignOut size={20} />
            </IconButton>
          ) : (
            <div className="mt-2 px-1">
              <NavLink to="/profile" className="block rounded-md py-0.5 hover:text-brand-accent">
                <div className="truncate text-sm font-medium text-fg">
                  {user?.firstName} {user?.lastName}
                </div>
                <div className="truncate text-xs text-fg-muted">{user?.email}</div>
              </NavLink>
              <button
                onClick={logout}
                className="mt-2 text-xs font-semibold text-brand-accent hover:text-brand-hover"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="md:hidden flex items-center gap-2 border-b border-border bg-card px-4 py-2">
          <Logo size={22} />
          <span className="text-xs text-fg-muted">
            Admin console{isSuperAdmin && <span className="ml-1 text-brand-accent">· super</span>}
          </span>
          <IconButton label="Toggle theme" onClick={toggleTheme} className="ml-auto">
            {dark ? <IconSun /> : <IconMoon />}
          </IconButton>
        </div>
        <main className={isFullBleed ? 'flex-1 overflow-hidden' : 'flex-1 overflow-auto p-6 pb-20 md:pb-6'}>
          {!isFullBleed && <AddedToOrgBanner />}
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
