// Shared navigation data — plain data, no imports (keeps it free of circular deps).

export const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/map', label: 'Map' },
  { to: '/turfs', label: 'Turf Cutting' },
  { to: '/passes', label: 'Passes' },
  { to: '/walklists', label: 'Walk Lists' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/import', label: 'CSV Import' },
  { to: '/early-voting', label: 'Early Voting' },
  { to: '/users', label: 'Users' },
  { to: '/voters', label: 'Voters' },
  { to: '/surveys', label: 'Surveys' },
];

export const SUPER_NAV = [
  { to: '/super-admin', label: 'Control Room' },
  { to: '/super-admin/users', label: 'All Users' },
  { to: '/organizations', label: 'Organizations' },
  { to: '/queues', label: 'Jobs' },
];
