import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

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
    'block rounded px-3 py-2 text-sm',
    isActive ? 'bg-brand-600 text-white' : 'text-gray-700 hover:bg-gray-100',
  ].join(' ');
}

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  // The map page manages its own scroll/padding so it can take the full content area.
  const isFullBleed = location.pathname === '/map';
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-56 border-r border-gray-200 bg-white p-4 flex flex-col">
        <div className="mb-6">
          <div className="text-lg font-semibold">Canvass Admin</div>
          <div className="text-xs text-gray-500">Internal tool</div>
        </div>
        <nav className="space-y-1 flex-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={navClass}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 border-t border-gray-200 pt-3 text-sm">
          <div className="text-gray-700 truncate">
            {user?.firstName} {user?.lastName}
          </div>
          <div className="text-xs text-gray-500 truncate">{user?.email}</div>
          <button
            onClick={logout}
            className="mt-2 text-xs text-brand-600 hover:underline"
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
