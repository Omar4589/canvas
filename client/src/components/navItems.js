// Shared navigation data — plain data, no imports (keeps it free of circular deps).

// `primary: true` marks the items that appear in the mobile bottom tab bar; the
// rest fall into its "More" sheet. BottomNav derives both lists from this array
// (single source of truth) instead of re-declaring them.
export const NAV = [
  { to: '/admin', label: 'Dashboard', end: true, primary: true },
  { to: '/map', label: 'Map', primary: true },
  { to: '/efforts', label: 'Efforts' },
  { to: '/turfs', label: 'Turf Cutting' },
  { to: '/passes', label: 'Rounds' },
  { to: '/walklists', label: 'Walk Lists' },
  { to: '/campaigns', label: 'Campaigns', primary: true },
  { to: '/import', label: 'CSV Import' },
  { to: '/early-voting', label: 'Early Voting' },
  { to: '/users', label: 'Users', primary: true },
  { to: '/voters', label: 'Voters' },
  { to: '/surveys', label: 'Surveys' },
];

export const SUPER_NAV = [
  { to: '/super-admin', label: 'Control Room' },
  { to: '/super-admin/users', label: 'All Users' },
  { to: '/organizations', label: 'Organizations' },
  { to: '/queues', label: 'Jobs' },
];
