import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Logo from './Logo.jsx';
import { NAV, SUPER_NAV } from './navItems.js';
import OrgSwitcher from './OrgSwitcher.jsx';
import BottomNav from './BottomNav.jsx';

function navClass({ isActive }) {
  return [
    'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-brand-600 text-white shadow-sm'
      : 'text-gray-700 hover:bg-brand-50 hover:text-brand-700',
  ].join(' ');
}

export default function Layout() {
  const { user, logout, isSuperAdmin } = useAuth();
  const location = useLocation();
  const isFullBleed = location.pathname === '/map' || location.pathname === '/queues';
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <aside className="hidden md:flex w-60 flex-col border-r border-gray-200 bg-white px-4 py-5">
        <div className="mb-1 px-1">
          <Logo size={26} />
        </div>
        <div className="mb-4 px-1 text-xs text-gray-500">
          Admin console{isSuperAdmin && <span className="ml-1 text-brand-600">· super</span>}
        </div>

        <OrgSwitcher />

        <nav className="flex-1 space-y-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={navClass}>
              {n.label}
            </NavLink>
          ))}
          {isSuperAdmin && (
            <>
              <div className="mt-3 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                Platform
              </div>
              {SUPER_NAV.map((n) => (
                <NavLink key={n.to} to={n.to} className={navClass}>
                  {n.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="mt-4 border-t border-gray-200 pt-4">
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
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
