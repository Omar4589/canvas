import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';

export default function OrgSwitcher() {
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
                  onClick={() => pick(m.organizationId)}
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
