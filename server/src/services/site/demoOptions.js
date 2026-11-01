// The demo form's optional selects and the ?src= tag shape — the only values POST /api/demo-request
// accepts. A server copy of client/src/marketing/demoOptions.js (the dialog's lists): production server
// code never imports from client/, so the two are kept identical by server/test/demoOptionsMirror.test.js.

export const ROLES = ['Canvassing firm', 'Consulting firm', 'Campaign', 'Party or committee', 'Advocacy group', 'Other'];

export const TEAM_SIZES = ['Just me', '2–10', '11–50', '51–200', '200+'];

export const HEARD_ABOUT = ['AAPC event', 'Referral', 'Search', 'Other'];

export const WHEN_AT_AAPC = 'At AAPC, Nov 17';
export const WHEN_AFTER = 'After the event';
export const WHEN = [WHEN_AT_AAPC, WHEN_AFTER];

export const SOURCE_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
