import { test } from 'node:test';
import assert from 'node:assert';
import { countsAsVisit, visitSource, visitDay, visitHour, deviceOf, channelOf, CHANNELS, OWN_PAGE_TAGS } from '../src/services/site/siteVisits.js';
import { AAPC } from '../../client/src/marketing/aapc.js';

// The first-party visit counter's rules (services/site/siteVisits.js): what counts as a visit, how a
// visit's source is named and grouped into a channel, and its hour and kind of device. Pure functions
// over a request-shaped object — no database.
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const req = ({ method = 'GET', headers = {}, query = {}, hostname = 'doorline.app' } = {}) => {
  const h = Object.fromEntries(Object.entries({ 'user-agent': PHONE, accept: 'text/html,application/xhtml+xml', ...headers }).map(([k, v]) => [k.toLowerCase(), v]));
  return { method, query, hostname, get: (name) => h[name.toLowerCase()] };
};

test('a person loading the page counts; bots, scripts, prefetches and HEAD do not', () => {
  assert.strictEqual(countsAsVisit(req()), true);
  assert.strictEqual(countsAsVisit(req({ method: 'HEAD' })), false);
  for (const ua of ['Googlebot/2.1', 'curl/8.4.0', 'python-requests/2.31', 'Mozilla/5.0 HeadlessChrome/131', 'facebookexternalhit/1.1', '']) {
    assert.strictEqual(countsAsVisit(req({ headers: { 'user-agent': ua } })), false, ua || '(no user agent)');
  }
  assert.strictEqual(countsAsVisit(req({ headers: { 'sec-purpose': 'prefetch;prerender' } })), false, 'Chrome prerender');
  assert.strictEqual(countsAsVisit(req({ headers: { purpose: 'prefetch' } })), false, 'link prefetch');
  assert.strictEqual(countsAsVisit(req({ headers: { accept: 'application/json' } })), false, 'not asking for a page');
});

test("a visit's source: its own ?src= tag, else internal, else the referring site's host, else direct", () => {
  assert.strictEqual(visitSource(req({ query: { src: 'Home-Banner' } })), 'home-banner');
  assert.strictEqual(visitSource(req({ query: { src: 'qr' }, headers: { referer: 'https://www.google.com/' } })), 'qr', 'the tag outranks the referrer');
  assert.strictEqual(visitSource(req({ headers: { referer: 'https://www.google.com/search?q=doorline' } })), 'google.com', 'host only — never the query');
  assert.strictEqual(visitSource(req({ headers: { referer: 'https://doorline.app/app' } })), 'direct', 'our own pages are not a source');
  assert.strictEqual(visitSource(req({ query: { src: '<script>' } })), 'direct', 'a malformed tag is ignored');
  assert.strictEqual(visitSource(req({ headers: { referer: 'not a url' } })), 'direct');
  assert.strictEqual(visitSource(req()), 'direct', 'an untagged QR scan');
  // A move from one of our pages to another (/aapc → the homepage) is not an arrival: no Referer is
  // sent (no-referrer meta), but Sec-Fetch-Site says same-origin. A tag still outranks it.
  assert.strictEqual(visitSource(req({ headers: { 'sec-fetch-site': 'same-origin' } })), 'internal');
  assert.strictEqual(visitSource(req({ query: { src: 'home-banner' }, headers: { 'sec-fetch-site': 'same-origin' } })), 'home-banner', 'the banner link keeps its tag');
  // The banner's /aapc address copied and sent on is an arrival like any other link — not one of our moves.
  assert.strictEqual(visitSource(req({ query: { src: 'home-banner' }, headers: { 'sec-fetch-site': 'none' } })), 'direct', 'pasted or opened from a text');
  assert.strictEqual(
    visitSource(req({ query: { src: 'home-banner' }, headers: { 'sec-fetch-site': 'cross-site', referer: 'https://www.linkedin.com/' } })),
    'linkedin.com'
  );
  assert.strictEqual(visitSource(req({ query: { src: 'qr' }, headers: { 'sec-fetch-site': 'none' } })), 'qr', 'any other tag counts wherever it came from');
  assert.strictEqual(visitSource(req({ headers: { 'sec-fetch-site': 'cross-site', referer: 'https://www.google.com/' } })), 'google.com');
  assert.strictEqual(visitSource(req({ headers: { 'sec-fetch-site': 'none' } })), 'direct', 'typed, bookmarked or scanned');
  // A tag spelled like one of the labels would be misfiled as a QR scan or a move: it is ignored.
  assert.strictEqual(visitSource(req({ query: { src: 'direct' }, headers: { referer: 'https://www.google.com/' } })), 'google.com');
  assert.strictEqual(visitSource(req({ query: { src: 'internal' } })), 'direct');
});

test('channels: QR and direct (with email and texts), search and AI, social, other websites, tagged links — and moves are not arrivals', () => {
  assert.deepStrictEqual(CHANNELS, ['direct', 'search', 'social', 'other', 'tagged']);
  const cases = {
    direct: 'direct',
    internal: null,
    'home-banner': null,
    qr: 'tagged',
    'linkedin-post': 'tagged',
    'google.com': 'search',
    'google.co.uk': 'search',
    'google.de': 'search',
    'bing.com': 'search',
    'duckduckgo.com': 'search',
    'search.yahoo.com': 'search',
    'yahoo.com': 'search',
    'chatgpt.com': 'search',
    'perplexity.ai': 'search',
    'gemini.google.com': 'search',
    'com.google.android.googlequicksearchbox': 'search',
    'mail.google.com': 'direct',
    'outlook.live.com': 'direct',
    'com.google.android.gm': 'direct',
    'com.google.android.apps.messaging': 'direct',
    'com.whatsapp': 'direct',
    'facebook.com': 'social',
    'l.facebook.com': 'social',
    'm.facebook.com': 'social',
    'lnkd.in': 'social',
    'linkedin.com': 'social',
    't.co': 'social',
    'x.com': 'social',
    'truthsocial.com': 'social',
    'com.linkedin.android': 'social',
    'nytimes.com': 'other',
    'aapc.org': 'other',
    'notfacebook.com': 'other',
  };
  for (const [source, channel] of Object.entries(cases)) assert.strictEqual(channelOf(source), channel, source);
  assert.strictEqual(channelOf(''), null);
});

test("the homepage banner's tag is one of our own: a click on it is a move, not an arrival", () => {
  const tag = new URL(AAPC.bannerHref, 'https://doorline.app').searchParams.get('src');
  assert.ok(tag, 'the banner link carries a tag');
  assert.ok(OWN_PAGE_TAGS.has(tag), `${tag} is listed in OWN_PAGE_TAGS`);
});

test('the kind of device: phone, tablet or computer, from the browser’s own description', () => {
  const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const OLD_IPAD = 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1';
  const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const device = (ua, headers = {}) => deviceOf(req({ headers: { 'user-agent': ua, ...headers } }));
  assert.strictEqual(device(PHONE), 'phone', 'iPhone');
  assert.strictEqual(device(ANDROID_PHONE), 'phone');
  assert.strictEqual(device(ANDROID_TABLET), 'tablet', 'Android without "Mobile"');
  assert.strictEqual(device(OLD_IPAD), 'tablet');
  assert.strictEqual(device(MAC_SAFARI), 'computer', 'and so is a new iPad, whose Safari says Mac');
  assert.strictEqual(device(WINDOWS), 'computer');
  assert.strictEqual(device(WINDOWS, { 'sec-ch-ua-mobile': '?1' }), 'phone', 'Chrome says so outright');
  assert.strictEqual(device(ANDROID_TABLET, { 'sec-ch-ua-mobile': '?0' }), 'tablet');
});

test("the day is the owner's (Central) calendar day", () => {
  // 03:30 UTC on Nov 18 is still Nov 17 in Chicago (UTC−6 in November).
  assert.strictEqual(visitDay(new Date('2026-11-18T03:30:00Z')), '2026-11-17');
  assert.strictEqual(visitDay(new Date('2026-11-18T06:30:00Z')), '2026-11-18');
});

test("the hour is the owner's (Central) hour, 0 to 23", () => {
  assert.strictEqual(visitHour(new Date('2026-11-18T05:30:00Z')), 23, '11:30 PM on Nov 17');
  assert.strictEqual(visitHour(new Date('2026-11-18T06:00:00Z')), 0, 'midnight is 0, never 24');
  assert.strictEqual(visitHour(new Date('2026-11-17T20:15:00Z')), 14);
  // Daylight saving ended at 2 AM on Nov 1, 2026: 1 AM came twice, and both count as hour 1.
  assert.strictEqual(visitHour(new Date('2026-11-01T06:30:00Z')), 1, '1:30 AM CDT');
  assert.strictEqual(visitHour(new Date('2026-11-01T07:30:00Z')), 1, '1:30 AM CST');
});
