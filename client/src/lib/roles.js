// The ONE definition of "this membership role can use the web console".
//
// The console is by design an ADMIN + TEAM-LEAD surface: a canvasser has "no console"
// (docs/ROLES.md) — they knock doors in the mobile app. Every place that LISTS an org,
// AUTO-SELECTS an org, or GUARDS an org-scoped route reads this. Never inline
// `role === 'admin' || role === 'lead'` again: the bug this file exists to prevent was two
// org lists (SelectOrgPage, OrgSwitcher) that forgot the filter and handed a `canvasser`
// role to homePathForRole(), which mapped it to the admin-only /admin — a Forbidden screen
// with no way back.
//
// Super admin is NOT a membership role — it's a global boolean on User — so it is
// deliberately absent here. Callers pass `isSuperAdmin` separately (see consoleHomePath).
export const CONSOLE_ROLES = ['admin', 'lead'];

export function isConsoleRole(role) {
  return CONSOLE_ROLES.includes(role);
}

// The memberships whose org this user can actually OPEN in the console.
export function consoleMemberships(memberships = []) {
  return memberships.filter((m) => isConsoleRole(m.role));
}

// The memberships the console can't do anything with — rendered as the muted "No console
// access" section on the org picker, so a user who is an admin in one org and a canvasser
// in another sees BOTH and understands why only one is clickable.
export function nonConsoleMemberships(memberships = []) {
  return memberships.filter((m) => !isConsoleRole(m.role));
}

// The org to enter automatically at sign-in: ONLY when the user has console access to
// exactly one. An admin-in-A / canvasser-in-B user has one console org (A), so the picker
// is skipped and they land straight in A. A canvasser-only user has none → null, and
// postAuthPath() (lib/homePath.js) routes them to /select-org, which explains the split and
// links the mobile app. The old rule keyed off
// `memberships.length === 1`, which happily auto-selected a canvasser org and dead-ended.
export function autoSelectOrgId(memberships = []) {
  const consoles = consoleMemberships(memberships);
  return consoles.length === 1 ? consoles[0].organizationId : null;
}

// What sign-in should set as the active org. Same as autoSelectOrgId EXCEPT for a super admin,
// who always gets null: their home is the platform Control Room, not a customer's console.
//
// Two reasons this is a rule and not a preference. First, the clients disagreed — mobile has
// always cleared the org on login and refused this auto-pick (app/login.jsx), while web skipped
// the whole block for super admins, so a remembered org id survived every login and silently
// decided the landing page. Same account, same action, different destination per client.
// Second, web's key outlived a session: logout() cleared it but an EXPIRED session didn't, so
// "Sign Out then log in" and "session expired then log in" landed in different places.
//
// Note this cannot be expressed by dropping the isSuperAdmin guard at the call site and letting
// autoSelectOrgId run: a super admin who is also an admin of exactly ONE org would still be
// auto-entered — precisely the behavior being removed.
//
// Scope: sign-in only. Session RESTORE (AuthContext's /auth/me effect) deliberately leaves the
// stored org alone, so reloading a tab keeps you where you were. Typing your password starts you
// at your home; reloading does not.
export function activeOrgIdForLogin(user, memberships = []) {
  if (user?.isSuperAdmin) return null;
  return autoSelectOrgId(memberships);
}
