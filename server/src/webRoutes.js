// The first URL segment of every client-side route in client/src/App.jsx.
//
// The SPA fallback in app.js serves index.html ONLY for these segments; every other top-level
// path gets a real HTTP 404 (client/public/404.html). Before this list existed, `/wp-admin`
// returned the React shell with a 200 and then silently redirected to the homepage — a soft 404
// that told crawlers (and users following a dead emailed link) that a junk URL was a real page.
//
// KEEP IN SYNC WITH client/src/App.jsx. server/test/webRoutes.test.js parses App.jsx and fails
// if the two diverge in either direction — a missing segment here 404s a real page in
// production, silently, and only in production.
//
// NOT in here, and deliberately so:
//   · /privacy, /terms, /delete-account — committed static documents (client/public/*.html),
//     served by explicit routes in app.js BEFORE this fallback is consulted;
//   · /assets, /favicon.ico, /og-image.png, /robots.txt, /sitemap.xml, *.html files —
//     real files, served by express.static before the fallback;
//   · /admin/queues (Bull Board) — a server-side router mounted before the static block.
//     ('admin' is still listed, for the React /admin console route.)
export const WEB_SEGMENTS = new Set([
  '', // "/" — the landing page
  'login',
  'forgot-password', // public: request a reset link
  'reset-password', // public: /reset-password/:token — emailed reset + invite links must NEVER 404
  'r', // public client-report hub; /r/:token links are emailed — must NEVER 404
  'change-password',
  'select-org',
  'campaigns',
  // Back-compat redirect routes for URLs still in the wild — they must keep resolving.
  'dashboard',
  'efforts',
  'turfs',
  'passes',
  'walklists',
  'import',
  'map',
  'early-voting',
  'admin', // /admin, /admin/client-reports, /admin/duplicate-surveys (React console routes)
  'queues',
  'users',
  'voters',
  'surveys',
  'tags',
  'integrations', // /integrations — the org-admin FbTime (measured hours) page
  'billing',
  'profile',
  'help',
  'super-admin',
  'organizations',
]);
