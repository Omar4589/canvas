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
  // People is break-glass-only server-side (the whole persons router is requireBreakGlass) — don't
  // advertise a nav item that walls a support-tier super with a 403.
  { to: '/super-admin/people', label: 'People', breakGlassOnly: true },
  { to: '/super-admin/imports', label: 'Imports' },
  { to: '/super-admin/access', label: 'Support access' },
  { to: '/super-admin/emails', label: 'Emails' },
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
  { to: '/integrations', label: 'Integrations' },
  { to: '/billing', label: 'Billing' },
];

// The campaign nav grew to 18 items, past what one flat list can carry — grouped by what the
// admin is DOING: configuring the campaign (Setup), running the field operation (Field),
// checking the work's integrity (Quality), reading what came back (Results), and producing
// things that leave the app (Deliverables). `group` keys into CAMPAIGN_NAV_GROUPS below;
// Home carries none and renders ungrouped at the top. Item order INSIDE each group preserves
// the old flat order on purpose — the grouping adds structure without moving muscle memory.
// BottomNav ignores `group` (its tab bar + More sheet stay flat by design).
export const CAMPAIGN_NAV_GROUPS = [
  { key: 'setup', label: 'Setup' },
  { key: 'field', label: 'Field' },
  { key: 'quality', label: 'Quality' },
  { key: 'results', label: 'Results' },
  { key: 'deliverables', label: 'Deliverables' },
];

export const CAMPAIGN_NAV = [
  { slug: '', label: 'Home', icon: '/admin' },
  { slug: 'survey', label: 'Survey', icon: '/surveys', group: 'setup' },
  // What the canvasser app offers at the door (outcome toggles today, more later). It also
  // carries a small Reclassification card as a shortcut; the full entry-editing surface is the
  // Door Outcomes page in the Quality group.
  { slug: 'customize', label: 'App Customization', icon: '/customize', group: 'setup' },
  { slug: 'import', label: 'Voter Import', icon: '/import', group: 'setup' },
  { slug: 'efforts', label: 'Walk Lists', icon: '/efforts', group: 'setup' },
  { slug: 'walklists', label: 'Saved Searches', icon: '/walklists', group: 'setup' },
  { slug: 'turfs', label: 'Turf Cutting', icon: '/turfs', group: 'setup' },
  { slug: 'team', label: 'Team', icon: '/users', group: 'field' },
  { slug: 'timeline', label: 'Timeline', icon: '/timeline', group: 'field' },
  { slug: 'map', label: 'Map', icon: '/map', group: 'field' },
  { slug: 'audit', label: 'Audit', icon: '/audit', group: 'quality' },
  { slug: 'overlaps', label: 'Overlaps', icon: '/overlaps', group: 'quality' },
  { slug: 'notes', label: 'Notes', icon: '/notes', group: 'quality' },
  { slug: 'explorer', label: 'Survey Explorer', icon: '/surveys', group: 'results' },
  { slug: 'early-voting', label: 'Early Voting', icon: '/early-voting', group: 'results' },
  { slug: 'reports', label: 'Client Reports', icon: '/admin/client-reports', group: 'deliverables' },
  { slug: 'exports', label: 'Exports', icon: '/exports', group: 'deliverables' },
  // Down here with the other occasional outputs rather than next to Turf Cutting: printing paper
  // packets is a rare fallback, not a step in the normal cut-and-walk flow (owner call).
  { slug: 'packets', label: 'Print Packets', icon: '/packets', group: 'deliverables' },
];
