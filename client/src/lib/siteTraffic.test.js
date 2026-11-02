import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNELS,
  axisStep,
  busiestDay,
  channelParts,
  chartTop,
  compareLine,
  dayLabel,
  deviceLine,
  deviceShareLine,
  hourCoverage,
  hourLabel,
  hourSpan,
  pageLabel,
  percent,
  perVisits,
  requestsText,
  shareRows,
  shortDayLabel,
  tagLabel,
  topChannel,
  totals,
  visitsText,
  weekdayName,
} from './siteTraffic.js';

// The Website page's Traffic tab: its words and its sums (lib/siteTraffic.js). The page itself is drawn in
// websiteTrafficRender.smoke.test.js.

const day = (d, fields = {}) => ({
  day: d,
  visits: 0,
  channels: { direct: 0, search: 0, social: 0, other: 0, tagged: 0 },
  moves: 0,
  appPage: 0,
  devices: { phone: 0, tablet: 0, computer: 0 },
  hours: Array(24).fill(0),
  demoRequests: 0,
  ...fields,
});

test("the channels are the server's, in its order", () => {
  assert.deepEqual(
    CHANNELS.map((c) => c.key),
    ['direct', 'search', 'social', 'other', 'tagged']
  );
  assert.equal(CHANNELS[0].label, 'QR code & direct');
});

test('dates are calendar dates, never shifted by the viewer’s zone; hours read like a clock', () => {
  assert.equal(dayLabel('2026-11-17'), 'Tue, Nov 17');
  assert.equal(dayLabel('2026-11-17', { weekday: false }), 'Nov 17');
  assert.equal(shortDayLabel('2026-11-17'), 'Tue 17');
  assert.equal(weekdayName('2026-11-17'), 'Tuesday');
  assert.deepEqual([0, 9, 12, 14, 23].map(hourLabel), ['12 AM', '9 AM', '12 PM', '2 PM', '11 PM']);
  assert.deepEqual([0, 11, 12, 14, 23].map(hourSpan), ['12–1 AM', '11 AM–12 PM', '12–1 PM', '2–3 PM', '11 PM–12 AM']);
});

test('pages, counts and shares in plain words', () => {
  assert.equal(pageLabel('/'), 'Homepage');
  assert.equal(pageLabel('/aapc'), 'AAPC page');
  assert.equal(pageLabel('/app'), 'Canvasser app page');
  assert.equal(pageLabel(null), 'Not recorded');
  assert.equal(tagLabel('home-banner'), 'The homepage’s AAPC banner', 'our own banner, by name');
  assert.equal(tagLabel('linkedin-post'), 'linkedin-post');
  assert.equal(visitsText(1), '1 visit');
  assert.equal(visitsText(1234), '1,234 visits');
  assert.equal(requestsText(1), '1 demo request');
  assert.equal(requestsText(0), '0 demo requests');
  assert.equal(percent(71, 100), '71%');
  assert.equal(percent(1, 3), '33%');
  assert.equal(percent(0, 0), null, 'nothing to divide');
});

test('totals add up every day row; the top channel and the busiest day', () => {
  const days = [
    day('2026-11-16', { visits: 4, channels: { direct: 3, search: 1, social: 0, other: 0, tagged: 0 }, moves: 2, appPage: 1, devices: { phone: 3, tablet: 0, computer: 1 }, demoRequests: 1 }),
    day('2026-11-17', { visits: 9, channels: { direct: 5, search: 0, social: 4, other: 0, tagged: 0 }, moves: 1, devices: { phone: 6, tablet: 1, computer: 2 } }),
    day('2026-11-18', { visits: 9, channels: { direct: 4, search: 5, social: 0, other: 0, tagged: 0 } }),
  ];
  const t = totals(days);
  assert.equal(t.visits, 22);
  assert.equal(t.moves, 3);
  assert.equal(t.appPage, 1);
  assert.equal(t.demoRequests, 1);
  assert.deepEqual(t.channels, { direct: 12, search: 6, social: 4, other: 0, tagged: 0 });
  assert.deepEqual(t.devices, { phone: 9, computer: 3, tablet: 1 });
  assert.deepEqual(topChannel(t.channels), { key: 'direct', label: 'QR code & direct', count: 12 });
  assert.deepEqual(topChannel({ direct: 2, search: 2 }), { key: 'direct', label: 'QR code & direct', count: 2 }, 'a tie goes to the earlier channel');
  assert.equal(topChannel({}), null);
  assert.deepEqual(busiestDay(days), { day: '2026-11-18', visits: 9 }, 'the latest wins a tie');
  assert.equal(busiestDay([day('2026-11-16')]), null);
  assert.equal(totals().visits, 0);
});

test('demo requests against visits: about 1 for every N, never without both', () => {
  assert.equal(perVisits(1330, 14), 'About 1 for every 95 visits');
  assert.equal(perVisits(3, 5), 'About 1 for every visit', 'more requests than counted visits');
  assert.equal(perVisits(100, 0), null);
  assert.equal(perVisits(0, 2), null);
});

test('today against an earlier day: by this time when its hours were all counted, else the whole day', () => {
  assert.equal(compareLine('yesterday', { visits: 120, byNow: 96 }, 142), 'By this time yesterday: 96 (+46)');
  assert.equal(compareLine('last Tuesday', { visits: 120, byNow: 150 }, 142), 'By this time last Tuesday: 150 (−8)');
  assert.equal(compareLine('yesterday', { visits: 120, byNow: 142 }, 142), 'By this time yesterday: 142 (the same)');
  assert.equal(compareLine('yesterday', { visits: 120, byNow: null }, 142), 'Yesterday, all day: 120');
  assert.equal(compareLine('last Tuesday', { visits: 98, byNow: null }, 5), 'Last Tuesday, all day: 98');
  assert.equal(compareLine('yesterday', null, 5), null);
});

test('devices and channels as lines, leaving out what had none', () => {
  assert.equal(deviceLine({ phone: 101, tablet: 2, computer: 39 }), 'Phones 101 · Computers 39 · Tablets 2');
  assert.equal(deviceLine({ phone: 0, tablet: 0, computer: 3 }), 'Computers 3');
  assert.equal(deviceLine({ phone: 0, tablet: 0, computer: 0 }), null);
  assert.equal(deviceShareLine({ phone: 71, tablet: 2, computer: 27 }), 'Phones 71% · Computers 27% · Tablets 2%');
  assert.deepEqual(
    channelParts({ direct: 2, search: 0, social: 5, other: 1, tagged: 0 }).map((c) => c.label),
    ['Social media', 'QR code & direct', 'Other websites']
  );
});

test('hour coverage: none before counting by the hour began, partial on its first day, whole after', () => {
  assert.equal(hourCoverage('2026-11-02', '2026-11-03'), 'none');
  assert.equal(hourCoverage('2026-11-03', '2026-11-03'), 'partial');
  assert.equal(hourCoverage('2026-11-04', '2026-11-03'), 'whole');
  assert.equal(hourCoverage('2026-11-04', null), 'none', 'no hour counted yet');
});

test('share rows: biggest first, empty ones left out, each a share of the total', () => {
  const rows = shareRows(
    [
      { key: 'a', count: 1 },
      { key: 'b', count: 0 },
      { key: 'c', count: 3 },
    ],
    4
  );
  assert.deepEqual(
    rows.map((r) => [r.key, r.share]),
    [
      ['c', 0.75],
      ['a', 0.25],
    ]
  );
  assert.deepEqual(shareRows([{ key: 'a', count: 2 }], 0)[0].share, 0);
});

test('the chart’s top line: round, even, at least the peak; axis labels thin out with the range', () => {
  assert.deepEqual([0, 1, 3, 5, 7, 9, 10, 11, 13, 142, 512, 999, 1000].map(chartTop), [0, 2, 4, 6, 8, 10, 10, 20, 20, 200, 600, 1000, 1000]);
  assert.deepEqual([7, 30, 31, 90].map(axisStep), [1, 7, 7, 14]);
});
