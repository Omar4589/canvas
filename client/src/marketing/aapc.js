// The AAPC Election Post-Mortem (Nov 17, 2026). Its page, /aapc, came down after the event (the owner,
// 2026-11-20): the address now redirects to the homepage (server/src/app.js RETIRED_PAGES), and the
// homepage banner, the date switch that timed the banner and the page's lines, and the booking form
// only /aapc used are gone with it. What's left is history: the console's Website page marks the event
// day on its visits chart (components/website/TrafficTab.jsx), and still names the visits and demo
// requests the page and its banner brought in (lib/siteTraffic.js). For a page like it next year, start
// from docs/MARKETING_SITE.md → "Adding a prerendered page" and this file's git history.
export const AAPC = {
  day: '2026-11-17', // the event itself — the Website page marks it on its visits chart
};
