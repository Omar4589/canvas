import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Logo, { LogoMark } from './Logo.jsx';
import { NAV, SUPER_NAV } from './navItems.js';
import { navIcon, IconSignOut, IconChevron } from './navIcons.jsx';
import OrgSwitcher from './OrgSwitcher.jsx';
import BottomNav from './BottomNav.jsx';
import AddedToOrgBanner from './AddedToOrgBanner.jsx';

function navClass(collapsed) {
  return ({ isActive }) =>
    [
      'flex items-center gap-3 rounded-md text-sm font-medium transition-colors',
      collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2',
      isActive
        ? 'bg-brand-600 text-white shadow-sm'
        : 'text-gray-700 hover:bg-brand-50 hover:text-brand-700',
    ].join(' ');
}

export default function Layout() {
  const { user, logout, isSuperAdmin } = useAuth();
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
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <aside
        className={[
          'hidden md:flex flex-col border-r border-gray-200 bg-white py-5 transition-all duration-200',
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
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? 'Expand' : 'Collapse'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <span className={collapsed ? 'block rotate-180' : 'block'}>
              <IconChevron />
            </span>
          </button>
        </div>

        {!collapsed && (
          <div className="mb-4 px-1 text-xs text-gray-500 shrink-0">
            Admin console{isSuperAdmin && <span className="ml-1 text-brand-600">· super</span>}
          </div>
        )}

        {!collapsed && (
          <div className="shrink-0">
            <OrgSwitcher />
          </div>
        )}

        <nav className="flex-1 min-h-0 overflow-y-auto space-y-1">
          {NAV.map((n) => {
            const Icon = navIcon(n.to);
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                title={collapsed ? n.label : undefined}
                className={navClass(collapsed)}
              >
                <Icon size={20} />
                {!collapsed && <span>{n.label}</span>}
              </NavLink>
            );
          })}
          {isSuperAdmin && (
            <>
              {collapsed ? (
                <div className="my-2 border-t border-gray-200" />
              ) : (
                <div className="mt-3 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  Platform
                </div>
              )}
              {SUPER_NAV.map((n) => {
                const Icon = navIcon(n.to);
                return (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    title={collapsed ? n.label : undefined}
                    className={navClass(collapsed)}
                  >
                    <Icon size={20} />
                    {!collapsed && <span>{n.label}</span>}
                  </NavLink>
                );
              })}
            </>
          )}
        </nav>

        <div
          className={[
            'mt-4 border-t border-gray-200 pt-4 shrink-0',
            collapsed ? 'flex justify-center' : '',
          ].join(' ')}
        >
          {collapsed ? (
            <button
              type="button"
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
              className="rounded-md p-2 text-brand-600 hover:bg-brand-50 hover:text-brand-700"
            >
              <IconSignOut size={20} />
            </button>
          ) : (
            <>
              <div className="truncate text-sm font-medium text-gray-900">
                {user?.firstName} {user?.lastName}
              </div>
              <div className="truncate text-xs text-gray-500">{user?.email}</div>
              <button
                onClick={logout}
                className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700"
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="md:hidden flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-2">
          <Logo size={22} />
          <span className="text-xs text-gray-500">
            Admin console{isSuperAdmin && <span className="ml-1 text-brand-600">· super</span>}
          </span>
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
