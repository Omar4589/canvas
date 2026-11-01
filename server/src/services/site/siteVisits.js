import { SiteVisitDay } from '../../models/SiteVisitDay.js';
import { SOURCE_PATTERN } from './demoOptions.js';

// First-party daily visit counts for the public marketing pages (models/SiteVisitDay.js). Counted as
// the page's HTML is served, server-side only: no cookie, no script, no stored IP address. A visit is a
// page load, so reloads count; the filters below drop what is plainly not a person reading the page.

// The owner's own clock, so "a day" matches the day he means (the other owner-facing console reports
// use the same zone).
export const OWNER_TIME_ZONE = 'America/Chicago';

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: OWNER_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** YYYY-MM-DD of `now` in OWNER_TIME_ZONE. */
export const visitDay = (now = new Date()) => dayFormat.format(now);

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
 * has a valid one, else the referring site's host without "www." (only the host is ever kept), else
 * "direct" — which is what a scan of the printed ad's untagged QR code looks like.
 */
export const visitSource = (req) => {
  const src = typeof req.query?.src === 'string' ? req.query.src.trim().toLowerCase() : '';
  if (src && SOURCE_PATTERN.test(src)) return src;
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

/**
 * Count this request against `path` if it is a visit. Fire-and-forget: the page is never held up for
 * a counter, and a failed write (no database, a hiccup) only loses one count.
 */
export const countVisit = (req, path, now = new Date()) => {
  if (!countsAsVisit(req)) return;
  SiteVisitDay.updateOne(
    { day: visitDay(now), path, source: visitSource(req) },
    { $inc: { count: 1 } },
    { upsert: true }
  ).catch(() => {});
};
