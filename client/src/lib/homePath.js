// Where a signed-in console user lands. Org admins & super admins get the org Overview
// (/admin); team leads are campaign-scoped and have no Overview, so they land on their
// Campaigns list (/campaigns). Mirrors the server console split (admin/super vs lead) and
// the App.jsx guards (requireOrgAdmin vs requireConsoleUser). Keep this the ONE source of
// truth for post-auth landing so a lead is never dumped on /admin.
export function homePathForRole(role) {
  return role === 'lead' ? '/campaigns' : '/admin';
}
