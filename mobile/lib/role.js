import {
  loadCurrentUser,
  loadMemberships,
  loadActiveOrgId,
} from './cache';

// Which membership roles reach the admin experience at all. Mirrors the web
// (client/src/lib/roles.js) and the server (services/authz/campaignManagement.js's
// isConsoleUser). A team lead is a campaign-scoped admin: they get the admin tab, scoped
// server-side to the campaigns granted to them.
const CONSOLE_ROLES = ['admin', 'lead'];

export function isConsoleRole(role) {
  return CONSOLE_ROLES.includes(role);
}

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
  // isOrgAdmin EXCLUDES 'lead' on purpose — it means "unscoped org authority" (billing,
  // org-wide users). isConsoleUser INCLUDES 'lead' — it means "may see the admin app at
  // all". Gating the canvasser drawer's "Admin dashboard" row on isOrgAdmin meant a team
  // lead who tapped "Switch to canvass mode" had NO way back to the admin tab short of
  // restarting the app — even though admin/_layout.jsx and app/index.jsx both admit leads.
  // Keep the two flags distinct and pick the right one per affordance.
  const isOrgAdmin = isSuperAdmin || activeMembership?.role === 'admin';
  const isLead = !isOrgAdmin && activeMembership?.role === 'lead';
  const isConsoleUser = isOrgAdmin || isLead;
  return {
    user: user || null,
    memberships: memberships || [],
    activeOrgId: activeOrgId || null,
    activeMembership,
    isSuperAdmin,
    isOrgAdmin,
    isLead,
    isConsoleUser,
  };
}
