// Where a signed-in console user lands. Org admins & super admins get the org Overview
// (/admin); team leads are campaign-scoped and have no Overview, so they land on their
// Campaigns list (/campaigns). Mirrors the server console split (admin/super vs lead) and
// the App.jsx guards (requireOrgAdmin vs requireConsoleUser). Keep this the ONE source of
// truth for post-auth landing so a lead is never dumped on /admin.
export function homePathForRole(role) {
  return role === 'lead' ? '/campaigns' : '/admin';
}

// Where an authenticated user should land — the ONE source of truth shared by the
// post-login navigation AND the /login redirect-if-already-authenticated guard, so the
// two can never drift. Returns a path, or `null` when the user has no console access (a
// canvasser), in which case the caller shows the "you need an admin/lead role" message.
// Mirrors the branches the login submit used to inline: owe-a-password-change first, then
// super admins (console if an org is active, else the platform picker), then multi-org
// users (org picker), then a single-org console user's role home.
export function resolveHomePath({ user, memberships = [], activeOrgId } = {}) {
  if (!user) return null;
  if (user.mustChangePassword) return '/change-password';
  if (user.isSuperAdmin) return activeOrgId ? '/admin' : '/super-admin';
  const consoleMemberships = memberships.filter((m) => m.role === 'admin' || m.role === 'lead');
  if (consoleMemberships.length === 0) return null; // canvasser — no console access
  if (memberships.length > 1) return '/select-org';
  return homePathForRole(memberships[0]?.role);
}
