import {
  loadCurrentUser,
  loadMemberships,
  loadActiveOrgId,
} from './cache';

/**
 * One-shot helper: load user + memberships + activeOrgId from cache and derive
 * the role flags screens use to gate UI affordances. Call from useEffect on
 * any screen that needs to know whether the current viewer is an admin.
 */
export async function loadRoleContext() {
  const [user, memberships, activeOrgId] = await Promise.all([
    loadCurrentUser(),
    loadMemberships(),
    loadActiveOrgId(),
  ]);
  const activeMembership =
    (memberships || []).find((m) => m.organizationId === activeOrgId) || null;
  const isSuperAdmin = !!user?.isSuperAdmin;
  const isOrgAdmin = isSuperAdmin || activeMembership?.role === 'admin';
  return {
    user: user || null,
    memberships: memberships || [],
    activeOrgId: activeOrgId || null,
    activeMembership,
    isSuperAdmin,
    isOrgAdmin,
  };
}
