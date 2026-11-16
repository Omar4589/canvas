// The facts the marketing pages state, kept in one place so the homepage and /aapc can't disagree.
// Each one is checked before it changes — docs/MARKETING_SITE.md says how.

// Platform totals for the numbers strip. Read with `npm run migrate:platform-stats` (a read-only dry run
// from the Heroku Run console): its "Would set the LIVE bucket to" line counts customer organizations
// only. The printed AAPC ad says 95,000+ door knocks and 23,000+ surveys, so a refresh must never
// publish lower than that. "Door knocks", never "doors knocked" (the ad's wording). Three numbers, all
// work done: voter records came out on Nov 2 (records loaded aren't work, and read badly to a buyer who
// cares about data). Exact counts since the owner's post-Election-Day numbers: change the numbers and
// `asOf` together (the strip adds the plus). The labels stay the printed ad's ("door knocks logged",
// "surveys taken"). Never an organizations count (the owner, Nov 16). Campaigns are the LIVE line's too:
// the Control Room's lifetime 27 on Nov 16 added 5 deleted campaigns that never knocked a door.
export const PLATFORM_TOTALS = {
  asOf: 'Nov 16, 2026',
  items: [
    { value: '126,978', label: 'door knocks logged' },
    { value: '29,847', label: 'surveys taken' },
    { value: '22', label: 'campaigns' },
  ],
};

// The public sample report: the demo campaign's report link, pinned so its address never changes
// (SEED_DEMO_SHARE_TOKEN), and its password, printed beside every link to it. Null until the owner
// has pinned the link in Share; the pages then fall back to "See how it works". Always /r/<token>,
// never a report's own URL: Rebuild demo day gives the report a new id each time.
export const SAMPLE_REPORT = {
  url: null,
  password: null,
};
