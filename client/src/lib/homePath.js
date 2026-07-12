import { consoleMemberships, isConsoleRole } from './roles.js';

// Where each console ROLE lands. Org admins & super admins get the org Overview (/admin);
// team leads are campaign-scoped and have no Overview, so they land on their Campaigns list
// (/campaigns). Mirrors the server console split (admin/super vs lead) and the App.jsx
// guards. Keep this the ONE source of truth for post-auth landing so a lead is never dumped
// on /admin.
//
// A role with no console home — a canvasser, or an absent/unknown role — returns **null**,
// NOT /admin. The old `role === 'lead' ? '/campaigns' : '/admin'` silently mapped a
// canvasser to the admin-only /admin, which is the whole reason this file was rewritten.
// Callers MUST handle null: it means "this user has no home in this org", and the right
// answer is always a redirect to /select-org — never a Forbidden screen.
const ROLE_HOME = { admin: '/admin', lead: '/campaigns' };

export function homePathForRole(role) {
  return ROLE_HOME[role] || null;
}

// The landing path for a user who is (or is about to be) INSIDE an org. Super admins are
// org-agnostic — Overview when an org is active, the platform picker when one isn't — so
// they can't be expressed as a membership role and are passed separately. Both org lists
// build super-admin rows with a synthetic role of 'super_admin', which homePathForRole
// deliberately does not know about; they call THIS instead.
//
// Returns null only for a non-super user with no console role in that org.
export function consoleHomePath({ isSuperAdmin = false, role, hasActiveOrg = false } = {}) {
  if (isSuperAdmin) return hasActiveOrg ? '/admin' : '/super-admin';
  return homePathForRole(role);
}

// Where an authenticated user should land — the ONE source of truth shared by the
// post-login navigation AND the /login redirect-if-already-authenticated guard, so the two
// can never drift. Returns `null` when the user has no console access anywhere (a
// canvasser), in which case the caller shows the "you need an admin/lead role" message.
//
// Order: owe-a-password-change → super admin → the ACTIVE console org (if any) → the ONE
// console org (skip the picker entirely) → the picker. Counting CONSOLE memberships rather
// than all memberships is what lets an admin-in-A / canvasser-in-B user skip the picker:
// they only have one org they can actually run from the console.
export function resolveHomePath({ user, memberships = [], activeOrgId } = {}) {
  if (!user) return null;
  if (user.mustChangePassword) return '/change-password';
  if (user.isSuperAdmin) return activeOrgId ? '/admin' : '/super-admin';

  const consoles = consoleMemberships(memberships);
  if (consoles.length === 0) return null; // canvasser-only — no console access

  // A remembered org we can actually use wins. A remembered org we CAN'T use (stale id,
  // demoted since) is ignored here and cleared by AuthContext's self-heal effect.
  const active = consoles.find((m) => m.organizationId === activeOrgId);
  if (active) return homePathForRole(active.role);

  if (consoles.length === 1) return homePathForRole(consoles[0].role);
  return '/select-org';
}

export { isConsoleRole };
