import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import { consoleHomePath } from '../lib/homePath.js';
import { consoleMemberships } from '../lib/roles.js';

export default function OrgSwitcher() {
  const { memberships, activeOrgId, switchOrg, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  // Super admins pick from ALL orgs. Shares the SAME query key as OrganizationsPage's list, so a
  // create/deactivate/delete there (each invalidates ['super-admin','organizations']) refreshes
  // this switcher automatically — the old one-shot useEffect fetch never updated without a reload.
  const orgsQ = useQuery({
    queryKey: ['super-admin', 'organizations'],
    queryFn: () => api('/super-admin/organizations'),
    enabled: isSuperAdmin,
  });
  const allOrgs = orgsQ.data?.organizations || [];

  const list = useMemo(() => {
    if (isSuperAdmin) {
      return allOrgs.map((o) => ({
        organizationId: o.id,
        organizationName: o.name,
        role: 'super_admin',
      }));
    }
    // Only orgs this user can actually OPEN. Listing a canvasser membership here made it
    // clickable, and picking it dropped the user on an admin URL they'd be Forbidden from.
    return consoleMemberships(memberships);
  }, [isSuperAdmin, allOrgs, memberships]);

  const active = list.find((m) => m.organizationId === activeOrgId);

  // Switching orgs must drop the previous org's cached data — but KEEP the platform-level org list
  // (org-agnostic), so the switcher itself doesn't blank + refetch on every switch.
  function resetOrgScopedCache() {
    qc.removeQueries({
      predicate: (q) => !(q.queryKey?.[0] === 'super-admin' && q.queryKey?.[1] === 'organizations'),
    });
  }

  function pick(orgId, role) {
    switchOrg(orgId);
    setOpen(false);
    resetOrgScopedCache();
    // ALWAYS land on the new org's role home. The old pick() didn't navigate at all, so the
    // URL survived the switch — and a URL is org-scoped:
    //   • admin-org → lead-org while sitting on /users → an admin-only URL in an org where
    //     you're only a lead → Forbidden.
    //   • admin-org → admin-org while sitting on /campaigns/<A's id>/turfs → a campaign id
    //     that doesn't exist in the new org → "Campaign not found".
    // Going home on every switch fixes both classes at once.
    const home = consoleHomePath({ isSuperAdmin, role, hasActiveOrg: true }) || '/select-org';
    navigate(home, { replace: true });
  }

  function pickPlatform() {
    switchOrg(null);
    setOpen(false);
    resetOrgScopedCache();
    navigate('/super-admin');
  }

  if (list.length === 0 && !isSuperAdmin) return null;

  return (
    <div className="relative mb-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left text-sm hover:border-brand-accent/40"
      >
        <span className="truncate">
          <span className="block text-[10px] uppercase tracking-wide text-fg-muted">
            Organization
          </span>
          <span className="block truncate font-medium text-fg">
            {active?.organizationName || 'Select…'}
          </span>
        </span>
        <span className="ml-2 text-fg-subtle">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-md border border-border bg-card shadow-lg">
          {isSuperAdmin && (
            <div className="border-b border-border px-1 py-1">
              <button
                onClick={pickPlatform}
                className={[
                  'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm',
                  !activeOrgId
                    ? 'bg-brand-tint font-semibold text-brand-accent'
                    : 'hover:bg-sunken',
                ].join(' ')}
              >
                <span>🌐 Platform view</span>
                <span className="ml-2 text-[10px] uppercase tracking-wide text-fg-subtle">
                  all orgs
                </span>
              </button>
            </div>
          )}
          <ul className="max-h-72 overflow-auto py-1">
            {list.map((m) => (
              <li key={m.organizationId}>
                <button
                  onClick={() => pick(m.organizationId, m.role)}
                  className={[
                    'flex w-full items-center justify-between px-3 py-2 text-left text-sm',
                    m.organizationId === activeOrgId
                      ? 'bg-brand-tint text-brand-accent'
                      : 'hover:bg-sunken',
                  ].join(' ')}
                >
                  <span className="truncate">{m.organizationName}</span>
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-fg-subtle">
                    {m.role}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {isSuperAdmin && (
            <div className="border-t border-border px-1 py-1">
              <button
                onClick={() => {
                  setOpen(false);
                  navigate('/organizations');
                }}
                className="block w-full rounded px-2 py-1.5 text-left text-xs text-brand-accent hover:bg-brand-tint"
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
