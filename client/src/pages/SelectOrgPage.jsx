import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import Logo from '../components/Logo.jsx';

export default function SelectOrgPage() {
  const { user, memberships, isSuperAdmin, switchOrg, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  const [allOrgs, setAllOrgs] = useState([]);
  const [loadingOrgs, setLoadingOrgs] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    setLoadingOrgs(true);
    api('/super-admin/organizations')
      .then((res) => setAllOrgs(res.organizations || []))
      .catch(() => setAllOrgs([]))
      .finally(() => setLoadingOrgs(false));
  }, [isSuperAdmin]);

  function pick(orgId) {
    switchOrg(orgId);
    navigate(from === '/select-org' ? '/' : from, { replace: true });
  }

  function pickPlatform() {
    switchOrg(null);
    navigate('/super-admin', { replace: true });
  }

  const items = isSuperAdmin
    ? allOrgs.map((o) => ({
        organizationId: o.id,
        organizationName: o.name,
        role: 'super_admin',
        isActive: o.isActive,
      }))
    : memberships.map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organizationName,
        role: m.role,
        isActive: true,
      }));

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <Logo size={32} />
          <h1 className="mt-3 text-lg font-semibold text-gray-900">Choose an organization</h1>
          <p className="mt-1 text-sm text-gray-500">
            Hi {user?.firstName}. Pick the org you want to work in.
          </p>
        </div>

        {isSuperAdmin && (
          <button
            onClick={pickPlatform}
            className="mb-3 flex w-full items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-left text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100"
          >
            <span>🌐 Platform view</span>
            <span className="text-[10px] uppercase tracking-wide text-brand-700/70">
              all orgs
            </span>
          </button>
        )}

        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          {loadingOrgs && (
            <div className="px-3 py-2 text-sm text-gray-500">Loading orgs…</div>
          )}
          {!loadingOrgs && items.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500">
              {isSuperAdmin
                ? 'No organizations exist yet. Create one to get started.'
                : 'You are not a member of any organization yet.'}
            </div>
          )}
          <ul className="divide-y divide-gray-100">
            {items.map((m) => (
              <li key={m.organizationId}>
                <button
                  onClick={() => pick(m.organizationId)}
                  className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-brand-50"
                  disabled={!m.isActive}
                >
                  <span className="text-sm font-medium text-gray-900">
                    {m.organizationName}
                    {!m.isActive && (
                      <span className="ml-2 text-xs text-gray-400">(inactive)</span>
                    )}
                  </span>
                  <span className="text-xs uppercase tracking-wide text-gray-500">
                    {m.role}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4 text-center">
          <button
            onClick={() => {
              logout();
              navigate('/login', { replace: true });
            }}
            className="text-xs font-semibold text-gray-500 hover:text-gray-700"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
