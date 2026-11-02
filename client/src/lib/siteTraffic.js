// The Website page's Traffic tab: its words and its arithmetic, kept out of the components so a test can pin
// them (siteTraffic.test.js). The numbers come from GET /super-admin/website/traffic
// (server/src/routes/superAdmin/website.js): page loads counted on our own server, with no cookie and no
// stored IP address, where a "visit" is an arrival — a move between our own pages is not one.

export const RANGES = [7, 30, 90];

// The server's channels (services/site/siteVisits.js → CHANNELS), in its order, in the owner's words.
export const CHANNELS = [
  { key: 'direct', label: 'QR code & direct', hint: 'QR scans, typed or saved addresses, links in emails and texts' },
  { key: 'search', label: 'Search & AI', hint: 'Google, Bing, DuckDuckGo, ChatGPT and the like' },
  { key: 'social', label: 'Social media', hint: 'LinkedIn, Facebook, X and the like' },
  { key: 'other', label: 'Other websites', hint: 'A link on any other site' },
  { key: 'tagged', label: 'Tagged links', hint: 'Links shared with a ?src= tag on them' },
];

export const DEVICES = [
  { key: 'phone', label: 'Phones' },
  { key: 'computer', label: 'Computers' },
  { key: 'tablet', label: 'Tablets' },
];

export const channelLabel = (key) => CHANNELS.find((c) => c.key === key)?.label || key;

// Tags our own pages put on their links (the server's OWN_PAGE_TAGS), by name, for a demo request that came
// through one. Any other tag is a link someone shared, shown as itself.
const OWN_TAG_LABELS = { 'home-banner': 'The homepage’s AAPC banner' };
export const tagLabel = (tag) => OWN_TAG_LABELS[tag] || tag;

export const pageLabel = (path) =>
  ({ '/': 'Homepage', '/aapc': 'AAPC page', '/app': 'Canvasser app page' })[path] || path || 'Not recorded';

export const fmt = (n) => (n ?? 0).toLocaleString('en-US');

export const visitsText = (n) => `${fmt(n)} ${n === 1 ? 'visit' : 'visits'}`;

export const requestsText = (n) => `${fmt(n)} demo ${n === 1 ? 'request' : 'requests'}`;

/** "71%" — or null when there is nothing to divide. */
export const percent = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : null);

// A calendar date, never shifted by the viewer's time zone: "2026-11-17" is Nov 17 everywhere.
const asDate = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

/** "Tue, Nov 17" (or "Nov 17" without the weekday). */
export const dayLabel = (day, { weekday = true } = {}) =>
  asDate(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC', ...(weekday ? { weekday: 'short' } : {}) });

/** "Tue 17" — an axis label for a week of days. */
export const shortDayLabel = (day) => `${asDate(day).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${asDate(day).getUTCDate()}`;

/** "Tuesday". */
export const weekdayName = (day) => asDate(day).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

/** "12 AM", "9 AM", "12 PM", "2 PM". */
export const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;

/** "2–3 PM", "11 AM–12 PM", "11 PM–12 AM". */
export const hourSpan = (h) => {
  const next = (h + 1) % 24;
  const sameHalf = h < 12 === next < 12 && next !== 0;
  return sameHalf ? `${h % 12 === 0 ? 12 : h % 12}–${hourLabel(next)}` : `${hourLabel(h)}–${hourLabel(next)}`;
};

const blankChannels = () => Object.fromEntries(CHANNELS.map((c) => [c.key, 0]));
const blankDevices = () => Object.fromEntries(DEVICES.map((d) => [d.key, 0]));

/** Everything a list of day rows adds up to. */
export const totals = (days = []) => {
  const t = { visits: 0, moves: 0, appPage: 0, demoRequests: 0, channels: blankChannels(), devices: blankDevices() };
  for (const d of days) {
    t.visits += d.visits || 0;
    t.moves += d.moves || 0;
    t.appPage += d.appPage || 0;
    t.demoRequests += d.demoRequests || 0;
    for (const k of Object.keys(t.channels)) t.channels[k] += d.channels?.[k] || 0;
    for (const k of Object.keys(t.devices)) t.devices[k] += d.devices?.[k] || 0;
  }
  return t;
};

/** The total of a { key: count } object. */
export const sumCounts = (obj = {}) => Object.values(obj).reduce((a, b) => a + (b || 0), 0);

/** The channel most visits came through: { key, label, count } — null when there were none. A tie goes to the earlier channel. */
export const topChannel = (channels = {}) => {
  let best = null;
  for (const c of CHANNELS) {
    const n = channels[c.key] || 0;
    if (n > 0 && (!best || n > best.count)) best = { key: c.key, label: c.label, count: n };
  }
  return best;
};

/** The day with the most visits: { day, visits } — null when every day had none. The latest wins a tie. */
export const busiestDay = (days = []) =>
  days.reduce((best, d) => (d.visits > 0 && (!best || d.visits >= best.visits) ? { day: d.day, visits: d.visits } : best), null);

/** "About 1 for every 95 visits" — null without both. */
export const perVisits = (visits, requests) => {
  if (!(requests > 0 && visits > 0)) return null;
  const every = Math.max(1, Math.round(visits / requests));
  return every === 1 ? 'About 1 for every visit' : `About 1 for every ${fmt(every)} visits`;
};

/**
 * The Today tile's comparison line for one earlier day (`name` as it reads mid-sentence: "yesterday", "last
 * Tuesday"): what it had by this time of day when its hours were all counted (`byNow`, the server's), with
 * today's difference, else its whole-day total.
 */
export const compareLine = (name, cmp, todayVisits) => {
  if (!cmp) return null;
  if (cmp.byNow == null) return `${name[0].toUpperCase()}${name.slice(1)}, all day: ${fmt(cmp.visits)}`;
  const diff = todayVisits - cmp.byNow;
  const signed = diff > 0 ? `+${fmt(diff)}` : diff < 0 ? `−${fmt(-diff)}` : 'the same';
  return `By this time ${name}: ${fmt(cmp.byNow)} (${signed})`;
};

/** "Phones 101 · Computers 39 · Tablets 2", leaving out the kinds with none — null when there are none at all. */
export const deviceLine = (devices = {}) => {
  const parts = DEVICES.filter((d) => devices[d.key] > 0).map((d) => `${d.label} ${fmt(devices[d.key])}`);
  return parts.length ? parts.join(' · ') : null;
};

/** "Phones 71% · Computers 27% · Tablets 2%", leaving out the kinds with none — null when there are none at all. */
export const deviceShareLine = (devices = {}) => {
  const total = sumCounts(devices);
  const parts = DEVICES.filter((d) => devices[d.key] > 0).map((d) => `${d.label} ${percent(devices[d.key], total)}`);
  return parts.length ? parts.join(' · ') : null;
};

/** The day's channels, biggest first, leaving out the ones with none. */
export const channelParts = (channels = {}) =>
  CHANNELS.filter((c) => channels[c.key] > 0)
    .map((c) => ({ key: c.key, label: c.label, count: channels[c.key] }))
    .sort((a, b) => b.count - a.count);

/**
 * What the hour chart can say about `day`: 'none' before hour-by-hour counting began, 'partial' on the day
 * it began (partway through), 'whole' after. `hoursSince` is the first day with hourly counts, or null.
 */
export const hourCoverage = (day, hoursSince) => (!hoursSince || day < hoursSince ? 'none' : day === hoursSince ? 'partial' : 'whole');

/** The share rows for a set of counts: [{ key, label, count, share }] biggest first, with share of `total`. */
export const shareRows = (entries, total) =>
  entries
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((e) => ({ ...e, share: total > 0 ? e.count / total : 0 }));

/**
 * The column chart's top line: the smallest round number at least `peak`, and even, so its halfway line
 * is a whole number too (2, 4, 6, 8, 10, 20, 30 … 60, 80, 100, 200 …). 0 for an empty chart.
 */
export const chartTop = (peak) => {
  if (!(peak > 0)) return 0;
  const p = 10 ** Math.floor(Math.log10(peak));
  return [1, 2, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((t) => t >= peak && t % 2 === 0) || 20 * p;
};

/** Which columns get an axis label: every one up to 7 days, else every 7th (14th past a month) counting back from the newest. */
export const axisStep = (n) => (n <= 7 ? 1 : n <= 31 ? 7 : 14);
