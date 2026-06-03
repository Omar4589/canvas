import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { NAV, SUPER_NAV } from './navItems.js';
import { IconDashboard, IconPin, IconFlag, IconUser } from './navIcons.jsx';
import OrgSwitcher from './OrgSwitcher.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import Logo from './Logo.jsx';

// Routes that live in the primary tab bar — everything else goes in the More sheet.
const PRIMARY_PATHS = ['/', '/map', '/campaigns', '/users'];

const PRIMARY = [
  { to: '/', label: 'Dashboard', end: true, icon: IconDashboard },
  { to: '/map', label: 'Map', icon: IconPin },
  { to: '/campaigns', label: 'Campaigns', icon: IconFlag },
  { to: '/users', label: 'Users', icon: IconUser },
];

function IconMore() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function tabClass({ isActive }) {
  return [
    'flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-medium',
    isActive ? 'text-brand-600' : 'text-gray-500',
  ].join(' ');
}

function sheetLinkClass({ isActive }) {
  return [
    'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-brand-600 text-white shadow-sm'
      : 'text-gray-700 hover:bg-brand-50 hover:text-brand-700',
  ].join(' ');
}

export default function BottomNav() {
  const { user, logout, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const moreItems = NAV.filter((n) => !PRIMARY_PATHS.includes(n.to));

  function close() {
    setOpen(false);
  }

  return (
    <>
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 flex border-t border-gray-200 bg-white py-1">
        {PRIMARY.map((n) => {
          const Icon = n.icon;
          return (
            <NavLink key={n.to} to={n.to} end={n.end} className={tabClass}>
              <Icon />
              <span>{n.label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={[
            'flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-medium',
            open ? 'text-brand-600' : 'text-gray-500',
          ].join(' ')}
        >
          <IconMore />
          <span>More</span>
        </button>
      </nav>

      {open && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={close} aria-hidden="true" />
          <div className="absolute bottom-0 inset-x-0 max-h-[80vh] overflow-auto rounded-t-2xl bg-white p-4 pb-20">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Logo size={22} />
                <span className="text-sm font-semibold text-gray-700">Menu</span>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close menu"
                className="rounded-md p-1 text-gray-500 hover:bg-gray-100"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <div className="space-y-1">
              {moreItems.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={sheetLinkClass} onClick={close}>
                  {n.label}
                </NavLink>
              ))}
            </div>

            {isSuperAdmin && (
              <>
                <div className="mt-4 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  Platform
                </div>
                <div className="space-y-1">
                  {SUPER_NAV.map((n) => (
                    <NavLink key={n.to} to={n.to} className={sheetLinkClass} onClick={close}>
                      {n.label}
                    </NavLink>
                  ))}
                </div>
              </>
            )}

            <div className="mt-4">
              <OrgSwitcher />
            </div>

            <div className="mt-2 border-t border-gray-200 pt-4">
              <div className="truncate text-sm font-medium text-gray-900">
                {user?.firstName} {user?.lastName}
              </div>
              <div className="truncate text-xs text-gray-500">{user?.email}</div>
              <button
                onClick={() => {
                  close();
                  logout();
                }}
                className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
