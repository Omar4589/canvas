import { useEffect, useState } from 'react';
import { loadCurrentUser, loadMemberships, loadActiveOrgId } from './cache';

// The signed-in console user's role label for headers/back-links: "Team Lead" for a lead,
// "Admin" for org admins and super-admins. The admin surface used to hardcode "Admin",
// which read wrong on a team-lead account (screenshot bug, item D9).
export function useConsoleRoleLabel() {
  const [label, setLabel] = useState('Admin');
  useEffect(() => {
    let mounted = true;
    Promise.all([loadCurrentUser(), loadMemberships(), loadActiveOrgId()]).then(([u, ms, orgId]) => {
      if (!mounted) return;
      const m = (ms || []).find((x) => x.organizationId === orgId);
      setLabel(!u?.isSuperAdmin && m?.role === 'lead' ? 'Team Lead' : 'Admin');
    });
    return () => {
      mounted = false;
    };
  }, []);
  return label;
}

// Raw role for capability gating on screens ('lead' | 'admin' | 'super').
export function useConsoleRole() {
  const [role, setRole] = useState(undefined);
  useEffect(() => {
    let mounted = true;
    Promise.all([loadCurrentUser(), loadMemberships(), loadActiveOrgId()]).then(([u, ms, orgId]) => {
      if (!mounted) return;
      if (u?.isSuperAdmin) return setRole('super');
      const m = (ms || []).find((x) => x.organizationId === orgId);
      setRole(m?.role === 'lead' ? 'lead' : 'admin');
    });
    return () => {
      mounted = false;
    };
  }, []);
  return role;
}
