import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import Logo from './Logo.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/map', label: 'Map' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/import', label: 'CSV Import' },
  { to: '/users', label: 'Users' },
  { to: '/surveys', label: 'Surveys' },
];

const SUPER_NAV = [
  { to: '/super-admin', label: 'Control Room' },
  { to: '/super-admin/users', label: 'All Users' },
  { to: '/organizations', label: 'Organizations' },
];

function navClass({ isActive }) {
  return [
    'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-brand-600 text-white shadow-sm'
      : 'text-gray-700 hover:bg-brand-50 hover:text-brand-700',
  ].join(' ');
}

function OrgSwitcher() {
  const { memberships, activeOrgId, switchOrg, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [allOrgs, setAllOrgs] = useState([]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    api('/super-admin/organizations')
      .then((res) => setAllOrgs(res.organizations || []))
      .catch(() => setAllOrgs([]));
  }, [isSuperAdmin]);

  const list = useMemo(() => {
    if (isSuperAdmin) {
      return allOrgs.map((o) => ({
        organizationId: o.id,
        organizationName: o.name,
        role: 'super_admin',
      }));
    }
    return memberships;
  }, [isSuperAdmin, allOrgs, memberships]);

  const active = list.find((m) => m.organizationId === activeOrgId);

  function pick(orgId) {
    switchOrg(orgId);
    setOpen(false);
    qc.clear();
  }

  function pickPlatform() {
    switchOrg(null);
    setOpen(false);
    qc.clear();
    navigate('/super-admin');
  }

  if (list.length === 0 && !isSuperAdmin) return null;

  return (
    <div className="relative mb-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-left text-sm hover:border-brand-300"
      >
        <span className="truncate">
          <span className="block text-[10px] uppercase tracking-wide text-gray-500">
            Organization
          </span>
          <span className="block truncate font-medium text-gray-900">
            {active?.organizationName || 'Select…'}
          </span>
        </span>
        <span className="ml-2 text-gray-400">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-md border border-gray-200 bg-white shadow-lg">
          {isSuperAdmin && (
            <div className="border-b border-gray-100 px-1 py-1">
              <button
                onClick={pickPlatform}
                className={[
                  'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm',
                  !activeOrgId
                    ? 'bg-brand-50 font-semibold text-brand-700'
                    : 'hover:bg-gray-50',
                ].join(' ')}
              >
                <span>🌐 Platform view</span>
                <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">
                  all orgs
                </span>
              </button>
            </div>
          )}
          <ul className="max-h-72 overflow-auto py-1">
            {list.map((m) => (
              <li key={m.organizationId}>
                <button
                  onClick={() => pick(m.organizationId)}
                  className={[
                    'flex w-full items-center justify-between px-3 py-2 text-left text-sm',
                    m.organizationId === activeOrgId
                      ? 'bg-brand-50 text-brand-700'
                      : 'hover:bg-gray-50',
                  ].join(' ')}
                >
                  <span className="truncate">{m.organizationName}</span>
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">
                    {m.role}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {isSuperAdmin && (
            <div className="border-t border-gray-100 px-1 py-1">
              <button
                onClick={() => {
                  setOpen(false);
                  navigate('/organizations');
                }}
                className="block w-full rounded px-2 py-1.5 text-left text-xs text-brand-600 hover:bg-brand-50"
              >
                Manage organizations →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout, isSuperAdmin } = useAuth();
  const location = useLocation();
  const isFullBleed = location.pathname === '/map';
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <aside className="flex w-60 flex-col border-r border-gray-200 bg-white px-4 py-5">
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
      <main className={isFullBleed ? 'flex-1 overflow-hidden' : 'flex-1 overflow-auto p-6'}>
        <Outlet />
      </main>
    </div>
  );
}
