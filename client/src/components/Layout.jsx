import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Logo from './Logo.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/map', label: 'Map' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/import', label: 'CSV Import' },
  { to: '/users', label: 'Users' },
  { to: '/surveys', label: 'Surveys' },
];

function navClass({ isActive }) {
  return [
    'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-brand-600 text-white shadow-sm'
      : 'text-gray-700 hover:bg-brand-50 hover:text-brand-700',
  ].join(' ');
}

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const isFullBleed = location.pathname === '/map';
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <aside className="flex w-60 flex-col border-r border-gray-200 bg-white px-4 py-5">
        <div className="mb-1 px-1">
          <Logo size={26} />
        </div>
        <div className="mb-6 px-1 text-xs text-gray-500">Admin console</div>

        <nav className="flex-1 space-y-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={navClass}>
              {n.label}
            </NavLink>
          ))}
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
      <main className={isFullBleed ? 'flex-1 overflow-hidden' : 'flex-1 overflow-auto p-6'}>
        <Outlet />
      </main>
    </div>
  );
}
