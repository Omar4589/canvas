// Shared navigation data — plain data, no imports (keeps it free of circular deps).

// `primary: true` marks the items that appear in the mobile bottom tab bar; the
// rest fall into its "More" sheet. BottomNav derives both lists from this array
// (single source of truth) instead of re-declaring them.
//
// `group` clusters items by WORKFLOW PHASE so the sidebar reads as a sequence
// (build a campaign → run the field → report → manage) instead of a flat tool
// list. Items with no `group` are the top "home" anchor (Dashboard). NAV_GROUPS
// fixes the render order; Layout/BottomNav iterate it and skip empty groups.
export const NAV_GROUPS = ['Setup', 'Field Ops', 'Reporting', 'Manage'];

export const NAV = [
  { to: '/admin', label: 'Dashboard', end: true, primary: true },
  // Setup — the cold-start build chain, roughly in order.
  { to: '/campaigns', label: 'Campaigns', primary: true, group: 'Setup' },
  { to: '/surveys', label: 'Surveys', group: 'Setup' },
  { to: '/import', label: 'CSV Import', group: 'Setup' },
  { to: '/walklists', label: 'Walk Lists', group: 'Setup' },
  { to: '/efforts', label: 'Efforts', group: 'Setup' },
  { to: '/turfs', label: 'Turf Cutting', group: 'Setup' },
  { to: '/passes', label: 'Passes', group: 'Setup' },
  // Field Ops — monitor active canvassing.
  { to: '/map', label: 'Map', primary: true, group: 'Field Ops' },
  { to: '/voters', label: 'Voters', group: 'Field Ops' },
  { to: '/early-voting', label: 'Early Voting', group: 'Field Ops' },
  // Reporting — external-facing outputs.
  { to: '/admin/client-reports', label: 'Client Reports', group: 'Reporting' },
  // Manage — people + maintenance.
  { to: '/users', label: 'Users', primary: true, group: 'Manage' },
  { to: '/admin/duplicate-surveys', label: 'Duplicate Surveys', group: 'Manage' },
];

export const SUPER_NAV = [
  { to: '/super-admin', label: 'Control Room' },
  { to: '/super-admin/users', label: 'All Users' },
  { to: '/organizations', label: 'Organizations' },
  { to: '/queues', label: 'Jobs' },
];
