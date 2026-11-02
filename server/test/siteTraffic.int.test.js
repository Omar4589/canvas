import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import mongoose from 'mongoose';

// The website's traffic, end to end: a page serve (app.js) → services/site/siteVisits.js →
// models/SiteVisitDay.js + models/SiteVisitHour.js → GET /super-admin/website/traffic. The promises this pins:
//   · a person's page load counts once, by day, page and source — and an arrival also by hour and kind of
//     device, in a row that names neither the page nor the source;
//   · a move between our pages (internal, or a click on the homepage's banner) and a load of the canvasser
//     app page are counted, but are never arrivals: no hour row, and not in the Traffic tab's visits;
//   · bots and the .html twin's redirect are never counted;
//   · the Traffic tab's numbers — visits by channel, moves, the app page, hours and devices; today against
//     yesterday and last week by this hour, only where that day's hours were all counted; the range's
//     sources, landing pages and moves; demo requests by day, answer, page and tag — split rows summed;
//   · super-admins only.
//
// Serves the REAL production page routes from a fixture dist, like staticPages.int.test.js — so NODE_ENV
// and CLIENT_DIST are set before app.js is imported.
//
//   npm run test:int -- test/siteTraffic.int.test.js
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'doorline-traffic-'));
fs.writeFileSync(path.join(fixture, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>');
fs.writeFileSync(path.join(fixture, 'app.html'), '<!doctype html><html><body><h1>APP-PAGE</h1></body></html>');
fs.mkdirSync(path.join(fixture, '.prerendered'));
fs.writeFileSync(path.join(fixture, '.prerendered', 'index.html'), '<!doctype html><html><body><h1>HOME</h1></body></html>');
fs.writeFileSync(path.join(fixture, '.prerendered', 'aapc.html'), '<!doctype html><html><body><h1>AAPC</h1></body></html>');

process.env.NODE_ENV = 'production';
process.env.CLIENT_DIST = fixture;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-site-traffic';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { User } = await import('../src/models/User.js');
const { DemoRequest } = await import('../src/models/DemoRequest.js');
const { SiteVisitDay } = await import('../src/models/SiteVisitDay.js');
const { SiteVisitHour } = await import('../src/models/SiteVisitHour.js');
const { visitDay, visitHour, syncSiteVisitIndexes } = await import('../src/services/site/siteVisits.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const daysBefore = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [User, DemoRequest, SiteVisitDay, SiteVisitHour]) await M.deleteMany({});
  // What server.js does at boot: the by-the-hour rows get their unique index before the first serve.
  await syncSiteVisitIndexes('test');
  const superU = await User.create({ firstName: 'Sue', lastName: 'X', email: 'sue@t.co', passwordHash: 'x', isActive: true, isSuperAdmin: true });
  const plainU = await User.create({ firstName: 'Pat', lastName: 'X', email: 'pat@t.co', passwordHash: 'x', isActive: true });
  Object.assign(ctx, { sup: { token: signUserToken(superU) }, plain: { token: signUserToken(plainU) } });
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  if (URI) await mongoose.disconnect();
  fs.rmSync(fixture, { recursive: true, force: true });
});

const page = async (url, headers) => {
  const res = await fetch(`${base}${url}`, { headers: { accept: 'text/html', ...headers }, redirect: 'manual' });
  await res.text();
  return res.status;
};

const traffic = async (query, token = ctx.sup.token) => {
  const res = await fetch(`${base}/api/super-admin/website/traffic${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, json: res.status === 200 ? await res.json() : null };
};

// The counter never holds the page up, so its writes may land just after the response: wait for them.
const settle = async (want) => {
  for (let i = 0; i < 60; i += 1) {
    const [day] = await SiteVisitDay.aggregate([{ $group: { _id: null, n: { $sum: '$count' } } }]);
    if ((day?.n || 0) >= want) return;
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('page loads count by day, page and source — and arrivals by hour and device, in rows naming neither', { skip }, async () => {
  const t0 = new Date();
  assert.strictEqual(await page('/', { 'user-agent': IPHONE }), 200, 'a QR scan: direct, on a phone');
  assert.strictEqual(await page('/?src=qr', { 'user-agent': WINDOWS }), 200, 'a tagged link, on a computer');
  assert.strictEqual(await page('/', { 'user-agent': WINDOWS, referer: 'https://www.google.com/' }), 200, 'from a search');
  assert.strictEqual(await page('/aapc?src=home-banner', { 'user-agent': IPHONE, 'sec-fetch-site': 'same-origin' }), 200, 'the banner: a move');
  assert.strictEqual(await page('/', { 'user-agent': IPHONE, 'sec-fetch-site': 'same-origin' }), 200, 'back to the homepage: a move');
  assert.strictEqual(await page('/app', { 'user-agent': IPHONE }), 200, 'the canvasser app page');
  assert.strictEqual(await page('/', { 'user-agent': 'Googlebot/2.1' }), 200, 'a crawler');
  assert.strictEqual(await page('/app.html', { 'user-agent': IPHONE }), 301, 'the .html twin redirects');
  await settle(6);
  await new Promise((r) => setTimeout(r, 150)); // anything stray would have landed by now
  const t1 = new Date();

  const days = await SiteVisitDay.find({}).lean();
  const key = (r) => `${r.path} ${r.source}`;
  assert.deepStrictEqual(
    Object.fromEntries(days.map((r) => [key(r), r.count])),
    { '/ direct': 1, '/ qr': 1, '/ google.com': 1, '/aapc home-banner': 1, '/ internal': 1, '/app direct': 1 },
    'one count per page load; the crawler and the redirect are not counted'
  );
  assert.ok(days.every((r) => [visitDay(t0), visitDay(t1)].includes(r.day)), "the owner's day");

  const hours = await SiteVisitHour.find({}).lean();
  const byDevice = {};
  for (const r of hours) byDevice[r.device] = (byDevice[r.device] || 0) + r.count;
  assert.deepStrictEqual(byDevice, { phone: 1, computer: 2 }, 'the three arrivals only — no move, no app page');
  for (const r of hours) {
    assert.ok([visitHour(t0), visitHour(t1)].includes(r.hour), "the owner's hour");
    assert.deepStrictEqual(Object.keys(r).filter((k) => !['_id', '__v'].includes(k)).sort(), ['count', 'day', 'device', 'hour'], 'no page, no source');
  }
  const indexes = await SiteVisitHour.collection.indexes();
  assert.ok(indexes.some((i) => i.unique && JSON.stringify(i.key) === JSON.stringify({ day: 1, hour: 1, device: 1 })), 'the boot sync built the unique index');
});

test('the Traffic tab: visits by channel, moves, the app page, hours, devices, today against yesterday and last week', { skip }, async () => {
  for (const M of [DemoRequest, SiteVisitDay, SiteVisitHour]) await M.deleteMany({});
  const now = new Date();
  const today = visitDay(now);
  const yesterday = daysBefore(today, 1);
  const lastWeek = daysBefore(today, 7);
  // Split rows, as two racing first visits leave before a unique index exists — production's state for
  // SiteVisitDay until migrate:build-indexes runs. Drop the index the tests built to get there.
  await SiteVisitDay.collection.dropIndex('day_1_path_1_source_1').catch(() => {});
  await SiteVisitDay.collection.insertMany([
    { day: today, path: '/', source: 'direct', count: 5 },
    { day: today, path: '/', source: 'direct', count: 2 },
    { day: today, path: '/', source: 'google.com', count: 3 },
    { day: today, path: '/', source: 'l.facebook.com', count: 1 },
    { day: today, path: '/aapc', source: 'linkedin-post', count: 2 },
    { day: today, path: '/aapc', source: 'home-banner', count: 4 },
    { day: today, path: '/', source: 'internal', count: 3 },
    { day: today, path: '/app', source: 'direct', count: 6 },
    { day: today, path: '/app', source: 'internal', count: 1 },
    { day: yesterday, path: '/', source: 'direct', count: 10 },
    { day: yesterday, path: '/', source: 'nytimes.com', count: 2 },
    { day: lastWeek, path: '/', source: 'direct', count: 7 },
    { day: daysBefore(today, 40), path: '/', source: 'direct', count: 99 },
  ]);
  // Yesterday around this hour: 5 the hour before, 60 in this hour (shared out by the minute), 7 the hour
  // after (not yet "by this time").
  const H = visitHour(now);
  await SiteVisitHour.collection.insertMany([
    { day: today, hour: 0, device: 'phone', count: 8 },
    { day: today, hour: 0, device: 'computer', count: 4 },
    { day: today, hour: 0, device: 'tablet', count: 1 },
    { day: yesterday, hour: H, device: 'phone', count: 60 },
    ...(H > 0 ? [{ day: yesterday, hour: H - 1, device: 'computer', count: 5 }] : []),
    ...(H < 23 ? [{ day: yesterday, hour: H + 1, device: 'phone', count: 7 }] : []),
    // The first day with hours: counting began partway through it.
    { day: lastWeek, hour: 0, device: 'phone', count: 7 },
  ]);
  const DAY = 86_400_000;
  // Straight into the collection, so createdAt is exactly the instant given.
  const request = (at, fields) =>
    DemoRequest.collection.insertOne({
      name: 'N',
      email: 'n@x.co',
      organization: 'O',
      heardAbout: null,
      page: null,
      source: null,
      handledAt: null,
      expiresAt: new Date(now.getTime() + 700 * DAY),
      ...fields,
      createdAt: at,
      updatedAt: at,
    });
  await request(now, { heardAbout: 'AAPC event', page: '/aapc', source: 'aapc' });
  await request(now, { heardAbout: 'Search', page: '/', handledAt: now });
  await request(new Date(now.getTime() - DAY), { page: '/', source: 'linkedin-post' });
  await request(new Date(now.getTime() - 40 * DAY), { heardAbout: 'Referral', page: '/' });

  const intoHour = (d) => (d.getUTCMinutes() * 60 + d.getUTCSeconds()) / 3600;
  const t0 = new Date();
  const res = await traffic('?days=30');
  const t1 = new Date();
  const sameHour = visitHour(t0) === H && visitHour(t1) === H && res.json?.today?.hour === H;
  assert.strictEqual(res.status, 200);
  const t = res.json;
  assert.strictEqual(t.days.length, 30);
  assert.strictEqual(t.days[29].day, today, 'oldest first, ending today');
  assert.ok(t.days.every((d) => d.day >= daysBefore(today, 29)));

  const last = t.days[29];
  assert.strictEqual(last.visits, 13, 'arrivals on the marketing pages, split rows summed');
  assert.deepStrictEqual(last.channels, { direct: 7, search: 3, social: 1, other: 0, tagged: 2 });
  assert.strictEqual(last.moves, 8, 'internal, the banner, and a move to the app page');
  assert.strictEqual(last.appPage, 6);
  assert.deepStrictEqual(last.devices, { phone: 8, tablet: 1, computer: 4 });
  assert.strictEqual(last.hours.length, 24);
  assert.strictEqual(last.hours[0], 13);
  const yRow = t.days.find((d) => d.day === yesterday);
  assert.deepStrictEqual([yRow.visits, yRow.channels.direct, yRow.channels.other], [12, 10, 2]);

  assert.strictEqual(t.hoursSince, lastWeek);
  assert.strictEqual(t.today.day, today);
  assert.deepStrictEqual(t.today.lastWeek, { day: lastWeek, visits: 7, byNow: null }, 'its hours were not all counted');
  assert.strictEqual(t.today.yesterday.day, yesterday);
  assert.strictEqual(t.today.yesterday.visits, 12);
  if (sameHour) {
    const before = H > 0 ? 5 : 0;
    const { byNow } = t.today.yesterday;
    assert.ok(
      byNow >= before + Math.round(60 * intoHour(t0)) && byNow <= before + Math.round(60 * intoHour(t1)),
      `the hours before this one, plus this hour's share by the minute (got ${byNow})`
    );
  }

  assert.deepStrictEqual(t.sources, [
    { source: 'google.com', count: 3, channel: 'search' },
    { source: 'linkedin-post', count: 2, channel: 'tagged' },
    { source: 'nytimes.com', count: 2, channel: 'other' },
    { source: 'l.facebook.com', count: 1, channel: 'social' },
  ]);
  assert.deepStrictEqual(t.pages, [{ path: '/', count: 30 }, { path: '/aapc', count: 2 }]);
  assert.deepStrictEqual(t.movesTo, [{ path: '/aapc', count: 4 }, { path: '/', count: 3 }, { path: '/app', count: 1 }]);

  const dr = t.demoRequests;
  assert.strictEqual(dr.total, 3, 'the range only');
  assert.deepStrictEqual(dr.heardAbout, [{ answer: 'AAPC event', count: 1 }, { answer: 'Search', count: 1 }, { answer: null, count: 1 }]);
  assert.deepStrictEqual(dr.pages, [{ page: '/', count: 2 }, { page: '/aapc', count: 1 }]);
  assert.deepStrictEqual(dr.tags, [{ source: 'linkedin-post', count: 1 }], "/aapc's own aapc is the page, not a tag");
  const perDay = Object.fromEntries(t.days.filter((d) => d.demoRequests).map((d) => [d.day, d.demoRequests]));
  const expected = {};
  for (const at of [now, now, new Date(now.getTime() - DAY)]) expected[visitDay(at)] = (expected[visitDay(at)] || 0) + 1;
  assert.deepStrictEqual(perDay, expected, "each on the owner's calendar day");

  const week = await traffic('?days=3');
  assert.strictEqual(week.json.days.length, 3);
  assert.strictEqual(week.json.today.lastWeek.visits, 7, 'the comparison days are read whatever the range');
  assert.strictEqual(week.json.demoRequests.total, expected[today] + (expected[yesterday] || 0) + (expected[daysBefore(today, 2)] || 0));
  assert.strictEqual((await traffic('?days=0')).status, 400);
});

test('only super-admins read the traffic', { skip }, async () => {
  assert.strictEqual((await traffic('', null)).status, 401);
  assert.strictEqual((await traffic('', ctx.plain.token)).status, 403);
  const res = await traffic('');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.days.length, 30, 'thirty days by default');
});
