import { test } from 'node:test';
import assert from 'node:assert';
import { countsAsVisit, visitSource, visitDay } from '../src/services/site/siteVisits.js';

// The first-party visit counter's rules (services/site/siteVisits.js): what counts as a visit, and how
// a visit's source is named. Pure functions over a request-shaped object — no database.
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
  assert.strictEqual(visitSource(req({ headers: { 'sec-fetch-site': 'cross-site', referer: 'https://www.google.com/' } })), 'google.com');
  assert.strictEqual(visitSource(req({ headers: { 'sec-fetch-site': 'none' } })), 'direct', 'typed, bookmarked or scanned');
});

test("the day is the owner's (Central) calendar day", () => {
  // 03:30 UTC on Nov 18 is still Nov 17 in Chicago (UTC−6 in November).
  assert.strictEqual(visitDay(new Date('2026-11-18T03:30:00Z')), '2026-11-17');
  assert.strictEqual(visitDay(new Date('2026-11-18T06:30:00Z')), '2026-11-18');
});
