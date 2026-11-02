// The facts the marketing pages state, kept in one place so the homepage and /aapc can't disagree.
// Each one is checked before it changes — docs/MARKETING_SITE.md says how.

// Platform totals for the numbers strip. Read with `npm run migrate:platform-stats` (a read-only dry run
// from the Heroku Run console): its "Would set the LIVE bucket to" line counts customer organizations
// only. The printed AAPC ad says 95,000+ door knocks and 23,000+ surveys, so a refresh must never
// publish lower than that. "Door knocks", never "doors knocked" (the ad's wording).
export const PLATFORM_TOTALS = {
  asOf: 'Nov 1, 2026',
  items: [
    { value: '120,000+', label: 'door knocks logged' },
    { value: '28,000+', label: 'surveys taken' },
    { value: '27', label: 'campaigns' },
    { value: '739,000+', label: 'voter records' },
  ],
};

// Client names shown on the site — each only with the client's written OK. Fox Bryant is listed as a
// client only, never as who built or owns Doorline (the owner's addendum, Nov 1, 2026).
export const CLIENTS = ['Fox Bryant'];

// The public sample report: the demo campaign's report link, pinned so its address never changes
// (SEED_DEMO_SHARE_TOKEN), and its password, printed beside every link to it. Null until the owner
// has pinned the link in Share; the pages then fall back to "See how it works". Always /r/<token>,
// never a report's own URL: Rebuild demo day gives the report a new id each time.
export const SAMPLE_REPORT = {
  url: null,
  password: null,
};
