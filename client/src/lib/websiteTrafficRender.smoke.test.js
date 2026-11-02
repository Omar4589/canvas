import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke tests for the super-admin Website page's Traffic tab (components/website/TrafficTab.jsx) and
// the page around it (pages/SuperAdminWebsitePage.jsx): the Today tiles, the two charts, the four panels,
// the empty and not-yet-counted states, and both tabs. renderToString EXECUTES each component body, so an
// import, ordering or JSX mistake fails here rather than on the owner's screen. The words and sums are
// lib/siteTraffic.js (siteTraffic.test.js).

const here = fileURLToPath(new URL('.', import.meta.url));

const render = async (entry) => {
  const dir = mkdtempSync(join(here, '../../.smoke-'));
  try {
    writeFileSync(join(dir, 'entry.jsx'), entry(here));
    const out = join(dir, 'bundle.mjs');
    await esbuild.build({
      entryPoints: [join(dir, 'entry.jsx')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile: out,
      jsx: 'automatic',
      logLevel: 'silent',
      packages: 'external',
    });
    const { html } = await import(pathToFileURL(out).href);
    return html.replaceAll('<!-- -->', '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const text = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');

// Thirty days ending on the AAPC day, Tuesday Nov 17, 2026, at 2 PM — hours counted from Nov 3.
const DAYS = [];
for (let i = 29; i >= 0; i -= 1) {
  const d = new Date(Date.UTC(2026, 10, 17 - i)).toISOString().slice(0, 10);
  DAYS.push({
    day: d,
    visits: 0,
    channels: { direct: 0, search: 0, social: 0, other: 0, tagged: 0 },
    moves: 0,
    appPage: 0,
    devices: { phone: 0, tablet: 0, computer: 0 },
    hours: Array(24).fill(0),
    demoRequests: 0,
  });
}
const at = (d) => DAYS.find((x) => x.day === d);
Object.assign(at('2026-11-02'), { visits: 20, channels: { direct: 20, search: 0, social: 0, other: 0, tagged: 0 } });
Object.assign(at('2026-11-03'), { visits: 30, channels: { direct: 30, search: 0, social: 0, other: 0, tagged: 0 }, hours: [...Array(12).fill(0), 10, ...Array(11).fill(0)], devices: { phone: 10, tablet: 0, computer: 0 } });
Object.assign(at('2026-11-10'), { visits: 98, channels: { direct: 60, search: 30, social: 8, other: 0, tagged: 0 }, demoRequests: 1 });
Object.assign(at('2026-11-16'), { visits: 120, channels: { direct: 70, search: 40, social: 10, other: 0, tagged: 0 } });
Object.assign(at('2026-11-17'), {
  visits: 142,
  channels: { direct: 88, search: 20, social: 12, other: 6, tagged: 16 },
  moves: 34,
  appPage: 77,
  devices: { phone: 101, tablet: 2, computer: 39 },
  hours: [2, 0, 0, 0, 0, 0, 1, 3, 9, 14, 30, 22, 18, 25, 18, ...Array(9).fill(0)],
  demoRequests: 3,
});
const FIXTURE = {
  today: {
    day: '2026-11-17',
    hour: 14,
    yesterday: { day: '2026-11-16', visits: 120, byNow: 96 },
    lastWeek: { day: '2026-11-10', visits: 98, byNow: 91 },
  },
  hoursSince: '2026-11-03',
  days: DAYS,
  sources: [
    { source: 'google.com', count: 90, channel: 'search' },
    { source: 'linkedin-post', count: 16, channel: 'tagged' },
    { source: 'l.facebook.com', count: 30, channel: 'social' },
  ],
  pages: [{ path: '/', count: 330 }, { path: '/aapc', count: 80 }],
  movesTo: [{ path: '/aapc', count: 20 }, { path: '/', count: 14 }],
  demoRequests: {
    total: 4,
    heardAbout: [{ answer: 'AAPC event', count: 3 }, { answer: null, count: 1 }],
    pages: [{ page: '/aapc', count: 3 }, { page: '/', count: 1 }],
    tags: [{ source: 'home-banner', count: 2 }, { source: 'linkedin-post', count: 1 }],
  },
};

const view = (props) =>
  render(
    (h) => `import React from 'react';
    import { renderToString } from 'react-dom/server';
    import { TrafficView } from '${join(h, '../components/website/TrafficTab.jsx')}';
    const props = ${JSON.stringify(props)};
    export const html = renderToString(<TrafficView onDays={() => {}} onPick={() => {}} onShowRequests={() => {}} {...props} />);`
  );

test('Today: visits against yesterday and last week by this time, demo requests, phones, the top way in', async () => {
  const t = text(await view({ data: FIXTURE, days: 30, picked: null, open: 3 }));
  assert.match(t, /Today · Central time/);
  assert.match(t, /Visits today i 142 By this time yesterday: 96 \(\+46\) By this time last Tuesday: 91 \(\+51\)/, 'with an (i) that explains it');
  assert.match(t, /Demo requests today 3 3 open in all Open the list/);
  assert.match(t, /On phones 71% Phones 101 · Computers 39 · Tablets 2/);
  assert.match(t, /Top way in QR code & direct 88 of 142 visits/);
});

test('the charts: visits per day with the AAPC line and request days, and today by the hour', async () => {
  const html = await view({ data: FIXTURE, days: 30, picked: null, open: 3 });
  const t = text(html);
  assert.match(t, /Visits per day 410 visits · 4 demo requests · busiest Tue, Nov 17 \(142\)/);
  assert.match(t, /AAPC, Nov 17/, 'the legend names the line');
  assert.match(html, /aria-label="Tue, Nov 17 · today, 142 visits, 3 demo requests, QR code &amp; direct: 88, Search &amp; AI: 20, Tagged links: 16, Social media: 12, Other websites: 6"/);
  assert.match(html, /aria-pressed="true"[^>]*aria-label="Tue, Nov 17 · today|aria-label="Tue, Nov 17 · today[^"]*"[^>]*aria-pressed="true"/, 'today is the picked day');
  assert.equal((html.match(/aria-pressed="/g) || []).length, 30, 'a column per day, each a button');
  assert.equal((html.match(/tabindex="0"/g) || []).length, 2, 'one Tab stop per chart');
  assert.match(t, /Today by the hour 142 visits · 3 demo requests · Central time/);
  assert.match(html, /aria-label="2–3 PM, 18 visits"/);
  assert.match(html, /aria-label="3–4 PM, Not yet"/, 'a later hour today is not a zero');
  assert.match(t, /How they got here: QR code & direct 88 · Search & AI 20 · Tagged links 16 · Social media 12 · Other websites 6/);
  assert.match(t, /On: Phones 71% · Computers 27% · Tablets 1%/);
  assert.doesNotMatch(t, /Back to today/);
});

test('the four panels: channels and top sites, landing pages and moves, devices, and what it turned into', async () => {
  const t = text(await view({ data: FIXTURE, days: 30, picked: null, open: 3 }));
  assert.match(t, /How they got here Last 30 days QR code & direct 268 65%/);
  assert.match(t, /QR scans, typed or saved addresses, links in emails and texts/);
  assert.match(t, /Top sites and tags google\.com · Search & AI 90 linkedin-post · Tagged links 16 l\.facebook\.com · Social media 30/);
  assert.match(t, /Where they landed Last 30 days — the page each visit started on Homepage 330 80% AAPC page 80 20%/);
  assert.match(t, /Moves between our pages: 34 \(AAPC page 20 · Homepage 14\)\. These are people already on the site/);
  assert.match(t, /Canvasser app page: 77 visits — mostly canvassers a customer sent there, so not counted above\. Counted from Tue, Nov 3 on\./);
  assert.match(t, /Phones and computers Last 30 days Phones 111 73%/);
  assert.match(t, /Counted from Tue, Nov 3 on\. An iPad usually counts as a computer/);
  assert.match(t, /What it turned into Last 30 days See the requests 4 demo requests About 1 for every 103 visits/);
  assert.match(t, /How they heard about us AAPC event 3 75% Didn’t say 1 25%/);
  assert.match(t, /Sent from AAPC page 3 75% Homepage 1 25%/);
  assert.match(t, /Through our banner or a tagged link The homepage’s AAPC banner 2 50% linkedin-post 1 25%/);
  assert.match(t, /How this is counted: .*no cookies, no stored IP addresses or browser details/);
});

test('a picked day: its hours, the day hours began partway through, and a day before they were counted', async () => {
  const past = text(await view({ data: FIXTURE, days: 30, picked: '2026-11-03', open: 3 }));
  assert.match(past, /Tue, Nov 3 by the hour 30 visits · 0 demo requests · Central time Back to today/);
  assert.match(past, /Counting by the hour began partway through this day, so the hours add up to less than its visits/);
  const before = text(await view({ data: FIXTURE, days: 30, picked: '2026-11-02', open: 3 }));
  assert.match(before, /Mon, Nov 2 by the hour 20 visits/);
  assert.match(before, /Visits are counted by the hour from Tue, Nov 3 on\./);
  assert.doesNotMatch(before, /On: /, 'no device split for a day that has none');
  const gone = text(await view({ data: FIXTURE, days: 30, picked: '2026-09-01', open: 3 }));
  assert.match(gone, /Today by the hour/, 'a picked day outside the range falls back to today');
});

test('nothing yet: zeros, no requests, no hours counted at all', async () => {
  const empty = {
    ...FIXTURE,
    hoursSince: null,
    today: { ...FIXTURE.today, yesterday: { day: '2026-11-16', visits: 0, byNow: null }, lastWeek: { day: '2026-11-10', visits: 0, byNow: null } },
    days: DAYS.map((d) => ({ ...d, visits: 0, moves: 0, appPage: 0, demoRequests: 0, channels: { direct: 0, search: 0, social: 0, other: 0, tagged: 0 }, devices: { phone: 0, tablet: 0, computer: 0 }, hours: Array(24).fill(0) })),
    sources: [],
    pages: [],
    movesTo: [],
    demoRequests: { total: 0, heardAbout: [], pages: [], tags: [] },
  };
  const t = text(await view({ data: empty, days: 30, picked: null, open: 0 }));
  assert.match(t, /Visits today i 0 Yesterday, all day: 0 Last Tuesday, all day: 0/);
  assert.match(t, /Demo requests today 0 None open/);
  assert.doesNotMatch(t, /Open the list/);
  assert.match(t, /On phones — No visits yet today/);
  assert.match(t, /Top way in — No visits yet today/);
  assert.match(t, /No visits in this period\./);
  assert.match(t, /Visits are counted by the hour from the next one on\./);
  assert.match(t, /No visits from another site or a tagged link in the last 30 days\./);
  assert.match(t, /Counted from the next visit on\./);
  assert.match(t, /0 demo requests No one sent the demo form in the last 30 days\./);
  assert.doesNotMatch(t, /See the requests/);
  assert.doesNotMatch(t, /Counted from Tue/, 'no counted-from date before anything was counted by the hour');
});

test('the table: every number by day, with a dash — not a zero — where a day was counted before devices were', async () => {
  const html = await render(
    (h) => `import React from 'react';
    import { renderToString } from 'react-dom/server';
    import { DayTable } from '${join(h, '../components/website/TrafficTab.jsx')}';
    export const html = renderToString(<DayTable days={${JSON.stringify(DAYS)}} hoursSince="2026-11-03" />);`
  );
  const t = text(html);
  assert.match(t, /Day Visits Demo requests QR code & direct Search & AI Social media Other websites Tagged links Phones Computers Tablets Moves App page/);
  assert.match(t, /Tue, Nov 17 142 3 88 20 12 6 16 101 39 2 34 77/, 'newest first');
  assert.match(t, /Tue, Nov 3 30 0 30 0 0 0 0 10 0 0 0 0/, 'the first day with devices');
  assert.match(t, /Mon, Nov 2 20 0 20 0 0 0 0 — — — 0 —/, 'before devices and the app page were counted');
});

const page = (url, seed) =>
  render(
    (h) => `import React from 'react';
    import { renderToString } from 'react-dom/server';
    import { MemoryRouter, Routes, Route } from 'react-router-dom';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import SuperAdminWebsitePage from '${join(h, '../pages/SuperAdminWebsitePage.jsx')}';
    globalThis.fetch = () => new Promise(() => {});
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    for (const [key, data] of ${JSON.stringify(seed)}) qc.setQueryData(key, data);
    export const html = renderToString(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[${JSON.stringify(url)}]}>
          <Routes><Route path="/super-admin/website" element={<SuperAdminWebsitePage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );`
  );

test('the page: Traffic first, with the open count on the Demo requests tab; ?tab=requests opens the list', async () => {
  const seed = [
    [['super-admin-website', 'traffic', 30], FIXTURE],
    [['super-admin-website', 'demo-requests', 'open-count'], { total: 3, open: 3, requests: [] }],
  ];
  const traffic = await page('/super-admin/website', seed);
  const t = text(traffic);
  assert.match(t, /Website How doorline\.app is doing: how many visits it gets/);
  assert.match(traffic, /role="tab"[^>]*aria-selected="true"[^>]*>Traffic</);
  assert.match(t, /Demo requests 3/, 'the tab carries the open count');
  assert.match(t, /Live · updated/);
  assert.match(t, /Visits today i 142/);

  const requests = await page('/super-admin/website?tab=requests', [
    ...seed,
    [
      ['super-admin-website', 'demo-requests', 'open', 0],
      {
        total: 1,
        open: 1,
        requests: [{ id: 'r1', createdAt: '2026-11-17T15:00:00Z', name: 'Dana Reyes', email: 'dana@reyesfield.com', organization: 'Reyes Field Co.', heardAbout: 'AAPC event', page: '/aapc', source: 'aapc', emailOutcome: 'sent', handledAt: null }],
      },
    ],
  ]);
  const r = text(requests);
  assert.match(requests, /role="tab"[^>]*aria-selected="true"[^>]*>Demo requests/);
  assert.match(r, /Dana Reyes · Reyes Field Co\./);
  assert.match(r, /Sent from: \/aapc src=aapc/);
  assert.doesNotMatch(r, /Visits today/);
});
