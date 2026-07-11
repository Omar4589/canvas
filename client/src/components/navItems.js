// Shared navigation data — plain data, no imports (keeps it free of circular deps).
//
// The admin nav is TWO-LEVEL (campaign drill-in). ORG_NAV shows at the top level
// (not inside a campaign); CAMPAIGN_NAV shows when drilled into /campaigns/:id — its
// `slug` is appended to /campaigns/:campaignId/ (home = the campaign root → Dashboard).
// `icon` is the navIcons key. Both the desktop sidebar (Layout) and the mobile
// BottomNav derive from these two lists + SUPER_NAV.

export const SUPER_NAV = [
  { to: '/super-admin', label: 'Control Room' },
  { to: '/super-admin/users', label: 'All Users' },
  { to: '/super-admin/people', label: 'People' },
  { to: '/super-admin/imports', label: 'Imports' },
  { to: '/organizations', label: 'Organizations' },
  { to: '/queues', label: 'Jobs' },
];

// `leadVisible` marks the top-level items a team lead sees. A lead is a campaign-scoped
// admin: they get Campaigns (their granted campaigns), but not the org-wide Overview,
// survey/tag libraries, Voters, or Users administration.
export const ORG_NAV = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/campaigns', label: 'Campaigns', leadVisible: true },
  { to: '/surveys', label: 'Surveys' },
  { to: '/tags', label: 'Tags' },
  { to: '/voters', label: 'Voters' },
  { to: '/users', label: 'Users' },
  { to: '/admin/duplicate-surveys', label: 'Duplicate Surveys' },
  { to: '/billing', label: 'Billing' },
];

export const CAMPAIGN_NAV = [
  { slug: '', label: 'Home', icon: '/admin' },
  { slug: 'survey', label: 'Survey', icon: '/surveys' },
  { slug: 'import', label: 'Voter Import', icon: '/import' },
  { slug: 'efforts', label: 'Walk Lists', icon: '/efforts' },
  { slug: 'walklists', label: 'Saved Searches', icon: '/walklists' },
  { slug: 'turfs', label: 'Turf Cutting', icon: '/turfs' },
  { slug: 'team', label: 'Team', icon: '/users' },
  { slug: 'timeline', label: 'Timeline', icon: '/timeline' },
  { slug: 'map', label: 'Map', icon: '/map' },
  { slug: 'audit', label: 'Audit', icon: '/audit' },
  { slug: 'notes', label: 'Notes', icon: '/notes' },
  { slug: 'early-voting', label: 'Early Voting', icon: '/early-voting' },
  { slug: 'reports', label: 'Client Reports', icon: '/admin/client-reports' },
];
