// The demo form's optional selects — what the dialog offers (DemoRequest.jsx). The server keeps an
// identical copy, the only values it accepts (server/src/services/site/demoOptions.js), pinned to this
// file by server/test/demoOptionsMirror.test.js. Plain data, no JSX, so Node can load it. The stored
// value is the label itself.

export const ROLES = ['Canvassing firm', 'Consulting firm', 'Campaign', 'Party or committee', 'Advocacy group', 'Other'];

// Shown as "Just me" and "2–10 canvassers" … — the value is the bare range.
export const TEAM_SIZES = ['Just me', '2–10', '11–50', '51–200', '200+'];

// The printed AAPC ad's QR code carries no tracking tag, so this is the only way to tie a request from
// someone who scanned it back to the ad.
export const HEARD_ABOUT = ['AAPC event', 'Referral', 'Search', 'Other'];

// /aapc only. "At AAPC" is offered through the event day (marketing/aapc.js decides).
export const WHEN_AT_AAPC = 'At AAPC, Nov 17';
export const WHEN_AFTER = 'After the event';
export const WHEN = [WHEN_AT_AAPC, WHEN_AFTER];

// A ?src= tag: short, lowercase, letters, digits and dashes (home-banner, aapc, qr). Anything else is
// dropped rather than stored.
export const SOURCE_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
