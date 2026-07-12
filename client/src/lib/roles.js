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
// is skipped and they land straight in A. A canvasser-only user has none → null, and the
// caller shows "you need an admin or team-lead role". The old rule keyed off
// `memberships.length === 1`, which happily auto-selected a canvasser org and dead-ended.
export function autoSelectOrgId(memberships = []) {
  const consoles = consoleMemberships(memberships);
  return consoles.length === 1 ? consoles[0].organizationId : null;
}
