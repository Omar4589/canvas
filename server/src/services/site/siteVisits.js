import { SiteVisitDay } from '../../models/SiteVisitDay.js';
import { SiteVisitHour } from '../../models/SiteVisitHour.js';
import { SOURCE_PATTERN } from './demoOptions.js';

// First-party visit counts for the public pages (models/SiteVisitDay.js, models/SiteVisitHour.js). Counted
// as the page's HTML is served, server-side only: no cookie, no script, no stored IP address or user agent.
// A visit is a page load, so reloads count; the filters below drop what is plainly not a person reading the
// page.

// The owner's own clock, so "a day" matches the day he means (the other owner-facing console reports
// use the same zone).
export const OWNER_TIME_ZONE = 'America/Chicago';

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: OWNER_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
// h23: midnight is hour 0, never 24.
const hourFormat = new Intl.DateTimeFormat('en-US', { timeZone: OWNER_TIME_ZONE, hour: 'numeric', hourCycle: 'h23' });

/** YYYY-MM-DD of `now` in OWNER_TIME_ZONE. */
export const visitDay = (now = new Date()) => dayFormat.format(now);

/** The hour of `now` in OWNER_TIME_ZONE, 0–23. The hour a fall-back repeats holds both. */
export const visitHour = (now = new Date()) => Number(hourFormat.format(now)) % 24;

// The canvasser app page (client/public/app.html). Counted, but reported on a line of its own: the people
// who open it are mostly canvassers a customer sent there, not prospects.
export const APP_PAGE = '/app';

// ?src= tags our own pages put on links to each other: the homepage's AAPC banner links
// /aapc?src=home-banner (client/src/marketing/aapc.js; siteVisits.test.js pins the two together). A visit
// carrying one is a move between our pages, like "internal" — never an arrival.
export const OWN_PAGE_TAGS = new Set(['home-banner']);

// Crawlers, link unfurlers, uptime monitors and scripted fetches. Deliberately broad: a missed bot
// inflates the count, a missed person costs one. A request with no user agent at all is a script.
const BOT_PATTERN = /bot|crawl|spider|slurp|scrape|preview|facebookexternalhit|embedly|whatsapp|telegram|monitor|uptime|pingdom|lighthouse|headless|curl|wget|python|node-fetch|axios|go-http|java\/|okhttp|libwww/i;

/** Should this request count as a visit? GET only, wants HTML, not a prefetch, not a bot. */
export const countsAsVisit = (req) => {
  if (req.method !== 'GET') return false;
  const ua = req.get('user-agent') || '';
  if (!ua || BOT_PATTERN.test(ua)) return false;
  // Speculative loads (link prefetch, Chrome's prerender) aren't a person on the page yet.
  const purpose = `${req.get('sec-purpose') || ''} ${req.get('purpose') || ''} ${req.get('x-moz') || ''}`;
  if (/prefetch|prerender/i.test(purpose)) return false;
  const accept = req.get('accept') || '';
  return accept === '' || accept.includes('text/html') || accept.includes('*/*');
};

/**
 * Where the visit came from, as a short label: the page's own ?src= tag (home-banner, qr, …) when it
 * has a valid one, else "internal" for a move between our own pages, else the referring site's host
 * without "www." (only the host is ever kept), else "direct" — which is what a scan of the printed
 * ad's untagged QR code looks like.
 */
export const visitSource = (req) => {
  const src = typeof req.query?.src === 'string' ? req.query.src.trim().toLowerCase() : '';
  const site = req.get('sec-fetch-site');
  // "direct" and "internal" are this function's own labels: a tag spelled the same would be misfiled.
  if (src && SOURCE_PATTERN.test(src) && src !== 'direct' && src !== 'internal') {
    // One of our own pages' tags marks a move only when it came from our pages: the banner's /aapc address,
    // copied and sent on, brings arrivals like any other link. A browser too old to say keeps the tag.
    if (!OWN_PAGE_TAGS.has(src) || !site || site === 'same-origin') return src;
  }
  // A move between our own pages (/aapc → the homepage's #proof) is not an arrival. The pages send no
  // Referer at all (index.html's no-referrer meta), so without this it would read as "direct" — the
  // bucket that stands for QR scans. Browsers send Sec-Fetch-Site whatever the referrer policy.
  if (site === 'same-origin') return 'internal';
  const ref = req.get('referer') || '';
  if (ref) {
    try {
      const host = new URL(ref).hostname.replace(/^www\./, '').toLowerCase();
      const own = (req.hostname || '').replace(/^www\./, '').toLowerCase();
      if (host && host !== own) return host.slice(0, 60);
    } catch {
      // an unparseable Referer is no source at all
    }
  }
  return 'direct';
};

// The Website page groups sources into channels. A search engine on any of its country sites (google.com,
// google.co.uk, bing.com …) — its own address only, so mail.google.com is "another website".
const SEARCH_ENGINES = /^(google|bing|yahoo|duckduckgo|ecosia|startpage|qwant|yandex|baidu|naver|kagi)\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;
// AI assistants that link to their sources answer the questions search used to; they count as search. And
// the Android apps that name themselves as the referrer (android-app://com.google.android.googlequicksearchbox).
const SEARCH_HOSTS = [
  'chatgpt.com',
  'openai.com',
  'perplexity.ai',
  'claude.ai',
  'gemini.google.com',
  'copilot.microsoft.com',
  'search.brave.com',
  'search.yahoo.com',
  'search.aol.com',
  'you.com',
  'meta.ai',
  'com.google.android.googlequicksearchbox',
];
// Social networks and their link shorteners (t.co, lnkd.in) and apps; a host matches its subdomains too
// (l.facebook.com, m.facebook.com).
const SOCIAL_HOSTS = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  'linkedin.com',
  'lnkd.in',
  'x.com',
  't.co',
  'twitter.com',
  'threads.net',
  'bsky.app',
  'reddit.com',
  'youtube.com',
  'tiktok.com',
  'nextdoor.com',
  'pinterest.com',
  'truthsocial.com',
  'rumble.com',
  'gettr.com',
  'gab.com',
  'com.facebook.katana',
  'com.linkedin.android',
  'com.twitter.android',
];
// Email and messaging: webmail sites, and the Android mail and messaging apps that name themselves as the
// referrer (android-app://com.google.android.gm). A link in an email or a text is "direct" — the Website
// page's "QR code & direct" says so — like the same link opened from an app that sends no referrer at all.
const DIRECT_HOSTS = [
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'mail.yahoo.com',
  'mail.aol.com',
  'mail.proton.me',
  'com.google.android.gm',
  'com.microsoft.office.outlook',
  'com.yahoo.mobile.client.android.mail',
  'com.samsung.android.email.provider',
  'ch.protonmail.android',
  'com.google.android.apps.messaging',
  'com.samsung.android.messaging',
  'com.whatsapp',
  'org.telegram.messenger',
  'org.thoughtcrime.securesms',
  'com.facebook.orca',
  'com.slack',
  'com.microsoft.teams',
];
const hostIn = (host, list) => list.some((h) => host === h || host.endsWith(`.${h}`));

/** The channels, in the order the Website page lists them. */
export const CHANNELS = ['direct', 'search', 'social', 'other', 'tagged'];

/**
 * The channel a stored source falls in: 'direct', 'search', 'social', 'other' (another website) or 'tagged'
 * (a ?src= tag) — or null for a move between our own pages, which is not an arrival at all.
 */
export const channelOf = (source) => {
  if (!source || source === 'internal' || OWN_PAGE_TAGS.has(source)) return null;
  if (source === 'direct') return 'direct';
  // No tag has a dot (SOURCE_PATTERN); every referring host does.
  if (!source.includes('.')) return 'tagged';
  if (hostIn(source, DIRECT_HOSTS)) return 'direct';
  if (SEARCH_ENGINES.test(source) || hostIn(source, SEARCH_HOSTS)) return 'search';
  if (hostIn(source, SOCIAL_HOSTS)) return 'social';
  return 'other';
};

/** Phone, tablet or computer, from the browser's own description of itself — read here, never stored. */
export const deviceOf = (req) => {
  // Chrome and Edge say outright whether they are on a phone.
  if (req.get('sec-ch-ua-mobile') === '?1') return 'phone';
  const ua = req.get('user-agent') || '';
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone|Opera Mini|BlackBerry/i.test(ua)) return 'phone';
  // Including an iPad: its Safari describes itself as a Mac.
  return 'computer';
};

/**
 * Count this request against `path` if it is a visit: the day, page and source, and — for an arrival on a
 * marketing page — the hour and kind of device, in their own rows. Fire-and-forget: the page is never held
 * up for a counter, and a failed write (no database, a hiccup) only loses one count. The promise it returns
 * settles once both writes have, and never rejects (tests wait on it; the page never does).
 */
export const countVisit = (req, path, now = new Date()) => {
  if (!countsAsVisit(req)) return Promise.resolve();
  const day = visitDay(now);
  const source = visitSource(req);
  const writes = [SiteVisitDay.updateOne({ day, path, source }, { $inc: { count: 1 } }, { upsert: true }).catch(() => {})];
  if (path !== APP_PAGE && channelOf(source)) {
    writes.push(
      SiteVisitHour.updateOne(
        { day, hour: visitHour(now), device: deviceOf(req) },
        { $inc: { count: 1 } },
        { upsert: true }
      ).catch(() => {})
    );
  }
  return Promise.all(writes);
};

/**
 * Build SiteVisitHour's index before the first visit can write a row (production autoIndex is off; the
 * syncRefusedUploadIndexes pattern). SiteVisitDay keeps its migrate:build-indexes step: its reader sums
 * split rows, and a unique build fails on any it already holds. Idempotent; a failure is logged, never fatal.
 */
export const syncSiteVisitIndexes = async (tag = 'boot') => {
  await SiteVisitHour.syncIndexes().catch((e) => console.error(`[${tag}] SiteVisitHour.syncIndexes failed`, e?.message || e));
};
