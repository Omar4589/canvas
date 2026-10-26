import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// The client's pages, rendered (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §H1-§H4): the gate's states
// and its neutrality (nothing about the campaign before the password), the dead-end notices, the
// area legend's "No answers to show", the report's notes and period wording, the hub, and the
// layout once signed in.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-public-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const MINUS = '−';

const build = async () => {
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PublicReportLayout, { ShareGate, ShareNotice } from '${join(here, '../components/PublicReportLayout.jsx')}';
import PublicReportListPage from '${join(here, '../pages/PublicReportListPage.jsx')}';
import PublicReportDetailPage from '${join(here, '../pages/PublicReportDetailPage.jsx')}';
import ClientReportView, { ClientReportHeading } from '${join(here, '../components/ClientReportView.jsx')}';
import StatCard from '${join(here, '../components/StatCard.jsx')}';
import { AreaLegend } from '${join(here, '../components/ClientReportMap.jsx')}';
import { decodeAreas, areaLegend } from '${join(here, './reportMapData.js')}';
globalThis.fetch = () => new Promise(() => {});
const qcNew = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
const wrap = (node, qc = qcNew()) => renderToString(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
export const gate = (props) => wrap(<ShareGate {...props} />);
export const notice = (props) => wrap(<ShareNotice {...props} />);
export const legend = (payload, shade) => wrap(<AreaLegend legend={areaLegend(decodeAreas(payload), shade)} />);
export const view = (report) => wrap(<><ClientReportHeading report={report} /><ClientReportView report={report} /></>);
export const card = (props) => wrap(<StatCard {...props} />);
// A page under the layout's Outlet context, as the real routes give it.
export const page = (which, ctx, path, qc = qcNew()) =>
  wrap(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Outlet context={ctx} />}>
          <Route path="/r/:token" element={<PublicReportListPage />} />
          <Route path="/r/:token/reports/:reportId" element={<PublicReportDetailPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
    qc
  );
export const layout = (path, seed) => {
  const qc = qcNew();
  for (const [key, data] of seed) qc.setQueryData(key, data);
  return wrap(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<PublicReportLayout />}>
          <Route path="/r/:token" element={<PublicReportListPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
    qc
  );
};
export { qcNew };
`
  );
  const out = join(dir, `bundle-${Math.random().toString(36).slice(2)}.mjs`);
  await esbuild.build({
    entryPoints: [join(dir, 'entry.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    jsx: 'automatic',
    logLevel: 'silent',
    packages: 'external',
    plugins: [
      {
        name: 'stub-css',
        setup(b) {
          b.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'css-stub' }));
          b.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: '', loader: 'js' }));
        },
      },
    ],
  });
  return import(pathToFileURL(out).href);
};
const m = await build();

test('the gate: neutral, with keep-me-signed-in, and each way back to it says why', () => {
  const fresh = m.gate({});
  assert.match(fresh, /A report has been shared with you\./);
  assert.match(fresh, /Enter the password you were given\./);
  assert.match(fresh, /Keep me signed in on this device/);
  assert.match(fresh, /type="password"/);
  assert.match(fresh, /View report/);
  assert.doesNotMatch(fresh, /may have changed/);

  assert.match(m.gate({ reason: 'changed' }), /This link needs its password\. If it no longer works, ask the person who sent it — it may have changed\./);
  assert.match(m.gate({ reason: 'signed-out' }), /You&#x27;ve signed out on this device\./);
  const locked = m.gate({ error: 'This link is locked after too many wrong passwords. Try again later, or ask the person who sent it.' });
  assert.match(locked, /role="alert"[^>]*>This link is locked after too many wrong passwords/);
  assert.doesNotMatch(m.gate({ requiresPassword: false, reason: 'changed' }), /type="password"/, 'an open link has no password box');
});

test('the dead ends say what happened and what to do', () => {
  const gone = m.notice({ kind: 'link-gone' });
  assert.match(gone, /This link isn&#x27;t available\./);
  assert.match(gone, /It may have been replaced or switched off — ask the person who sent it\./);
  assert.match(m.notice({ kind: 'expired', message: 'This report link has expired. Ask your campaign contact for a new one.' }), /This report link has expired\. Ask your campaign contact for a new one\./);
  assert.match(m.notice({ kind: 'expired' }), /Ask the person who sent it to renew it\./);
  assert.match(m.notice({ kind: 'retry', onRetry: () => {} }), /Couldn&#x27;t load the report\.[\s\S]*Try again/);
});

const hex = (lng, lat) => [[lng, lat], [lng + 0.01, lat], [lng + 0.01, lat + 0.01], [lng, lat]];
const areas = {
  areaSize: 'large',
  questions: [{ key: 'support', label: 'Support for Smith?', type: 'single_choice', options: ['Yes', 'No'] }],
  cells: [
    { h3: 'a', boundary: hex(-84.4, 33.6), doors: 38, byStatus: { surveyed: 38 }, answers: [{ questionKey: 'support', n: 20, options: [{ option: 'Yes', count: 12 }, { option: 'No', count: 8 }] }] },
    { h3: 'b', boundary: hex(-84.3, 33.7), doors: 3, byStatus: { not_home: 3 }, answers: [] },
  ],
};

test('the area legend: doors reached by default; an answer\'s share with "No answers to show" in its own style', () => {
  const doors = m.legend(areas, { kind: 'doors' });
  assert.match(doors, /Doors reached in each area/);
  assert.doesNotMatch(doors, /No answers to show/);
  const share = m.legend(areas, { kind: 'answer', questionKey: 'support', option: 'Yes' });
  assert.match(share, /Share who answered “Yes”/);
  assert.match(share, /Support for Smith\? — of the homes in each area that answered it/);
  assert.match(share, /80–100%/);
  assert.match(share, /repeating-linear-gradient[^"]*"[^>]*><\/span>No answers to show/, 'a hatched swatch, not a ramp colour');
});

const baseReport = (extra = {}) => ({
  id: 'r1',
  campaignType: 'survey',
  title: '',
  weekStart: '2026-10-13',
  weekEnd: '2026-10-26',
  publishedOn: '2026-10-27',
  editedOn: '2026-10-28',
  numbersThrough: '2026-10-25',
  scope: { kind: 'team', label: 'Paid team', seriesKey: 'kT', seriesLabel: 'Paid team' },
  supportQuestionKey: 'support',
  earlierTotals: { changes: [{ card: 'doorsKnocked', delta: -20 }], since: { weekStart: '2026-09-29', weekEnd: '2026-10-12' } },
  visibility: { showMap: false, mapMode: null, areaSize: null },
  nav: { olderId: 'r0', newerId: null },
  observations: [],
  stats: {
    cumulative: {
      totals: { doorsKnocked: 3412, surveysTaken: 1980, surveyedVoters: 1702, connectionRate: 58 },
      contactBreakdown: { surveyed: 2000, not_home: 1412 },
      surveyBreakdowns: [{ questionKey: 'support', questionLabel: 'Support for Smith?', type: 'multiple_choice', options: [{ option: 'Yes', count: 30 }, { option: 'No', count: 12 }] }],
      tagBreakdowns: [],
    },
    period: { totals: { doorsKnocked: 812, surveysTaken: 0 } },
  },
  ...extra,
});

test('a report reads its period, its dates, its scope and its notes', () => {
  const html = m.view(baseReport());
  assert.match(html, /\+812 in these 14 days/);
  assert.match(html, /No new surveys in these 14 days/);
  assert.match(html, /Team: Paid team/);
  assert.match(html, /Published Oct 27 · Edited Oct 28/);
  assert.match(html, /Numbers as of Oct 25 — the period was still running\./);
  assert.ok(html.includes(`Earlier totals were updated by ${MINUS}20 doors since the Sep 29 – Oct 12 report.`));
  assert.match(html, /A home both teams visited counts in each team&#x27;s report\./);
  assert.match(html, /42 selections/, 'the multiple-choice headline counts its own picks');
  assert.doesNotMatch(html, /this week/);
  const campaign = m.view(baseReport({ scope: { kind: 'campaign', label: 'Whole campaign', seriesKey: 'kC' }, earlierTotals: null, numbersThrough: null }));
  assert.doesNotMatch(campaign, /both teams/);
  assert.doesNotMatch(campaign, /Earlier totals/);
  assert.doesNotMatch(campaign, /Numbers as of/);
});

test('the "+N" pill wears text-success-fg on the tint; StatCard\'s default look is untouched', () => {
  assert.match(m.card({ label: 'Doors', value: '1', delta: '+3 this week', deltaTone: 'up' }), /bg-success-tint text-success-fg/);
  const plain = m.card({ label: 'Doors', value: '1', hint: 'x' });
  assert.doesNotMatch(plain, /success/);
});

const row = (id, kind, seriesKey, label, weekStart, weekEnd, doors, delta, extra = {}) => ({
  id,
  title: '',
  weekStart,
  weekEnd,
  scope: { kind, label, seriesKey, seriesLabel: label },
  publishedOn: weekEnd,
  editedOn: null,
  refreshedOn: null,
  numbersThrough: null,
  headline: { cumulative: { doorsKnocked: doors, surveysTaken: Math.round(doors / 2) }, period: { doorsKnocked: delta, surveysTaken: 5 } },
  ...extra,
});

test('the hub: tabs per series, the latest report, the trend with its first and last values, every report newest first', () => {
  const hub = {
    campaignName: 'Fall 2026',
    orgName: 'Fox Bryant',
    hasLogo: false,
    reports: [
      row('c3', 'campaign', 'kC', 'Whole campaign', '2026-10-13', '2026-10-19', 3412, 412, { editedOn: '2026-10-21' }),
      row('t1', 'team', 'kT', 'Paid team', '2026-10-13', '2026-10-19', 900, 90),
      row('c2', 'campaign', 'kC', 'Whole campaign', '2026-10-06', '2026-10-12', 3000, 380),
      row('c1', 'campaign', 'kC', 'Whole campaign', '2026-09-29', '2026-10-05', 2104, 300),
    ],
  };
  const ctx = { token: 'T', hub, hubQ: { data: hub, isLoading: false, error: null, refetch() {} } };
  const html = m.page('list', ctx, '/r/T');
  assert.match(html, /Weekly reports/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /Whole campaign/);
  assert.match(html, /Paid team/);
  assert.match(html, /Latest · Oct 13 – Oct 19, 2026 · Whole campaign/);
  assert.match(html, /Edited Oct 21/);
  assert.match(html, /The \+ figures are for Oct 13 – Oct 19\./);
  assert.match(html, /aria-label="Doors knocked in each report: from 2,104 in the Sep 29 – Oct 5 report to 3,412 in the Oct 13 – Oct 19 report, across 3 reports\."/);
  assert.match(html, /bg-success-tint px-1\.5 py-0\.5 text-xs font-medium text-success-fg">\+412/);
  assert.ok(html.indexOf('/r/T/reports/c3') < html.indexOf('/r/T/reports/c2') && html.indexOf('/r/T/reports/c2') < html.indexOf('/r/T/reports/c1'), 'newest first');
  assert.doesNotMatch(html, /reports\/t1/, 'another tab\'s report stays in its own tab');

  const teamTab = m.page('list', ctx, '/r/T?tab=kT');
  assert.match(teamTab, /Latest · Oct 13 – Oct 19, 2026 · Team: Paid team/);
  assert.doesNotMatch(teamTab, /Doors knocked in each report/, 'one report, no trend');

  const empty = { ...hub, reports: [] };
  assert.match(m.page('list', { token: 'T', hub: empty, hubQ: { data: empty, isLoading: false, error: null } }, '/r/T'), /No reports are available on this link right now\./);
});

test('the report page: All reports returns to its tab, Older and Newer within the series, a PDF button', () => {
  const qc = m.qcNew();
  const report = baseReport();
  qc.setQueryData(['share', 'T', 'jwt', 'report', 'r1'], { report, survey: { questions: [] } });
  const ctx = { token: 'T', accessToken: 'jwt', session: { get: () => new Promise(() => {}), handleError: () => ({}) }, hub: { campaignName: 'Fall 2026' }, logo: { url: null, blob: null } };
  const html = m.page('detail', ctx, '/r/T/reports/r1', qc);
  assert.match(html, /href="\/r\/T\?tab=kT"[^>]*>‹ All reports/);
  assert.match(html, /href="\/r\/T\/reports\/r0"[^>]*>‹ Older/);
  assert.match(html, /aria-disabled="true"[^>]*>Newer ›/);
  assert.match(html, /Download PDF/);
  assert.match(html, /Numbers as of Oct 25/);
});

test('the report page hands its map version to the map: a re-fetched report with a new one loads the map again (C7)', () => {
  const ctx = { token: 'T', accessToken: 'jwt', session: { get: () => new Promise(() => {}), handleError: () => ({}) }, hub: null, logo: { url: null, blob: null } };
  const render = (mapVersion) => {
    const qc = m.qcNew();
    const report = baseReport({ visibility: { showMap: true, mapMode: 'pins', areaSize: null, mapVersion } });
    qc.setQueryData(['share', 'T', 'jwt', 'report', 'r1'], { report, survey: { questions: [] } });
    qc.setQueryData(['mapbox-token', '/share/T/mapbox-token', 'jwt'], { isReady: true, token: 'pk.test' });
    // What the page fetched under version v7.
    qc.setQueryData(['client-report-map', '/share/T/reports/r1/map', 'jwt', 'v7'], {
      mode: 'pins', snapshotKey: 'k7', statusKeys: ['surveyed'], lng: [-84.3, -84.31], lat: [33.7, 33.71], status: [0, 0], questions: [], answers: {}, extent: null,
    });
    return m.page('detail', ctx, '/r/T/reports/r1', qc);
  };
  const v7 = render('v7');
  assert.match(v7, /Where we/);
  assert.match(v7, /2 of 2 doors/, 'the payload under the report\'s own version');
  const v8 = render('v8');
  assert.match(v8, /Loading doors…/, 'a new version is a new map fetch, not the old payload');
  assert.doesNotMatch(v8, /2 of 2 doors/);
});

test('the layout: the gate shows nothing about the campaign; signed in, the header names it and offers Sign out', () => {
  // No token stored: the gate — even with the hub's names sitting in the cache.
  const gateHtml = m.layout('/r/GATE-TOKEN', [
    [['share-meta', 'GATE-TOKEN'], { requiresPassword: true }],
    [['share', 'GATE-TOKEN', null, 'reports'], { campaignName: 'Secret Campaign', orgName: 'Secret Org', hasLogo: false, reports: [] }],
  ]);
  assert.match(gateHtml, /A report has been shared with you\./);
  assert.doesNotMatch(gateHtml, /Secret Campaign|Secret Org/);
  assert.match(gateHtml, /Powered by/);
  assert.match(gateHtml, /theme-light/);

  globalThis.sessionStorage = {
    getItem: (k) => (k === 'doorline.share.IN-TOKEN' ? 'jwt-in' : null),
    setItem() {},
    removeItem() {},
  };
  try {
    const inHtml = m.layout('/r/IN-TOKEN', [
      [['share-meta', 'IN-TOKEN'], { requiresPassword: true }],
      [['share', 'IN-TOKEN', 'jwt-in', 'reports'], { campaignName: 'Fall 2026', orgName: 'Fox Bryant', hasLogo: false, reports: [] }],
    ]);
    assert.match(inHtml, /Fall 2026/);
    assert.match(inHtml, /Fox Bryant/);
    assert.match(inHtml, /Sign out on this device/);
    assert.match(inHtml, /No reports are available on this link right now\./);
  } finally {
    delete globalThis.sessionStorage;
  }
});

// ── Links to all your reports stay exactly as they were (PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D) ──
// The hub, a report and the taken-down card on an all-reports link, rendered and compared byte for
// byte with what these pages rendered before one-report links existed (captured 2026-10-25) — both
// as the server answers now (`single: false`) and as it answered before (no `single` at all).
// Regenerate only for an intended change to these pages:
//   UPDATE_PUBLIC_REPORT_SNAPSHOT=1 node --test src/lib/publicReportRender.smoke.test.js
const SNAPSHOT = new URL('./publicReportAllLinks.snapshot.json', import.meta.url);

const snapshotReport = () =>
  baseReport({
    weekStart: '2026-10-13',
    weekEnd: '2026-10-19',
    publishedOn: '2026-10-20',
    editedOn: null,
    refreshedOn: '2026-10-22',
    numbersThrough: null,
    scope: { kind: 'campaign', label: 'Whole campaign', seriesKey: 'kC', seriesLabel: 'Whole campaign' },
    earlierTotals: {
      changes: [
        { card: 'doorsKnocked', delta: -120 },
        { card: 'surveysTaken', delta: 3 },
      ],
      since: { weekStart: '2026-10-06', weekEnd: '2026-10-12' },
    },
    nav: { olderId: 'r0', newerId: 'r2' },
    goal: { target: 10000, deadline: '2026-11-03', done: 3412, remaining: 6588, percent: 34 },
    observations: [{ heading: 'Turnout', body: 'Most doors on Elm St asked about the bridge.\nTwo asked for yard signs.' }],
    stats: {
      cumulative: {
        totals: { doorsKnocked: 3412, surveysTaken: 1980, surveyedVoters: 1702, connectionRate: 58 },
        contactBreakdown: { surveyed: 2000, refused: 300, not_home: 1012, no_soliciting: 40, wrong_address: 60 },
        surveyBreakdowns: [
          { questionKey: 'support', questionLabel: 'Support for Smith?', type: 'single_choice', options: [{ option: 'Strong support', count: 30 }, { option: 'Undecided', count: 12 }, { option: 'Oppose', count: 8 }] },
          { questionKey: 'issues', questionLabel: 'Top issues', type: 'multiple_choice', options: [{ option: 'Schools', count: 20 }, { option: 'Roads', count: 9 }] },
        ],
        tagBreakdowns: [{ tag: 'Supporter', identifiedVoters: 400, currentVoters: 380 }],
      },
      period: { totals: { doorsKnocked: 412, surveysTaken: 40, surveyedVoters: 38 } },
    },
  });

// A report taken down: its read answers 404 REPORT_NOT_FOUND (seeded as an error that renders as one).
const goneQc = (id) => {
  const qc = m.qcNew();
  qc.setQueryDefaults(['share', 'T', 'jwt', 'report', id], { retryOnMount: false });
  const err = Object.assign(new Error('This report was taken down or removed.'), { status: 404, code: 'REPORT_NOT_FOUND' });
  qc.getQueryCache().build(qc, { queryKey: ['share', 'T', 'jwt', 'report', id] }).setState({ status: 'error', error: err, fetchStatus: 'idle', data: undefined });
  return qc;
};

// `single`: undefined renders today's payloads; false renders the same payloads as the server now
// sends them for a link to all your reports.
const allReportsPages = (single) => {
  const flag = single === undefined ? {} : { single };
  const hub = {
    campaignName: 'Fall 2026',
    orgName: 'Fox Bryant',
    hasLogo: false,
    reports: [
      row('c3', 'campaign', 'kC', 'Whole campaign', '2026-10-13', '2026-10-19', 3412, 412, { editedOn: '2026-10-21', title: 'Final push' }),
      row('t1', 'team', 'kT', 'Paid team', '2026-10-13', '2026-10-19', 900, 90, { numbersThrough: '2026-10-18' }),
      row('c2', 'campaign', 'kC', 'Whole campaign', '2026-10-06', '2026-10-12', 3000, 380, { refreshedOn: '2026-10-14' }),
      row('c1', 'campaign', 'kC', 'Whole campaign', '2026-09-29', '2026-10-05', 2104, 300),
    ],
    ...flag,
  };
  const listCtx = (h) => ({ token: 'T', hub: h, hubQ: { data: h, isLoading: false, error: null, refetch() {} } });
  const empty = { ...hub, reports: [] };

  const session = { get: () => new Promise(() => {}), handleError: () => ({}) };
  const detailCtx = { token: 'T', accessToken: 'jwt', session, hub, hubQ: { data: hub, isLoading: false, error: null }, logo: { url: null, blob: null } };
  const shown = m.qcNew();
  shown.setQueryData(['share', 'T', 'jwt', 'report', 'r1'], { report: snapshotReport(), survey: { questions: [] }, ...flag });

  return {
    hub: m.page('list', listCtx(hub), '/r/T'),
    hubTeamTab: m.page('list', listCtx(hub), '/r/T?tab=kT'),
    hubEmpty: m.page('list', listCtx(empty), '/r/T'),
    report: m.page('detail', detailCtx, '/r/T/reports/r1', shown),
    reportGone: m.page('detail', detailCtx, '/r/T/reports/r1', goneQc('r1')),
  };
};

test('a link to all your reports: the hub, a report and the taken-down card render exactly as before', () => {
  if (process.env.UPDATE_PUBLIC_REPORT_SNAPSHOT === '1') {
    const pages = allReportsPages(undefined);
    const note =
      'Rendered HTML of the client pages on a link to all your reports, captured before one-report links (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D). Compared byte for byte by publicReportRender.smoke.test.js; regenerate only for an intended change to these pages.';
    writeFileSync(SNAPSHOT, `${JSON.stringify({ _note: note, ...pages }, null, 2)}\n`);
  }
  const saved = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  for (const single of [undefined, false]) {
    const pages = allReportsPages(single);
    for (const [name, html] of Object.entries(pages)) {
      assert.equal(html, saved[name], `${name} (single: ${single}) is unchanged`);
    }
  }
  // What the snapshot holds, so a regenerated one can't quietly lose it.
  assert.match(saved.hub, /Latest · Oct 13 – Oct 19, 2026 · Whole campaign/);
  assert.match(saved.report, /href="\/r\/T\?tab=kC"[^>]*>‹ All reports/);
  assert.match(saved.report, /href="\/r\/T\/reports\/r0"[^>]*>‹ Older/);
  assert.match(saved.report, /href="\/r\/T\/reports\/r2"[^>]*>Newer ›/);
  assert.ok(saved.report.includes(`Earlier totals were updated by ${MINUS}120 doors and +3 surveys since the Oct 6 – Oct 12 report.`));
  assert.doesNotMatch(saved.report, /This link opens this report only/);
  assert.match(saved.reportGone, /This report was taken down or removed(<!-- -->)? —[\s\S]*href="\/r\/T"[^>]*>see all reports/);
  assert.match(saved.hubEmpty, /No reports are available on this link right now\./);
});

// ── A link to one report (PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D) ─────────────────────────────────
const singleHub = (extra = {}) => ({
  campaignName: 'Fall 2026',
  orgName: 'Fox Bryant',
  hasLogo: false,
  single: true,
  reportId: 'r9',
  gone: false,
  reports: [row('r9', 'campaign', 'kC', 'Whole campaign', '2026-10-19', '2026-10-25', 3412, 412)],
  ...extra,
});
const oneReport = () => ({
  ...snapshotReport(),
  id: 'r9',
  weekStart: '2026-10-19',
  weekEnd: '2026-10-25',
  nav: null,
  earlierTotals: { changes: [{ card: 'doorsKnocked', delta: -120 }], since: null, before: '2026-10-19' },
});
const pending = { data: undefined, isLoading: true, error: null };
const detailCtxOf = (hub, hubQ = { data: hub, isLoading: false, error: null }) => ({
  token: 'T',
  accessToken: 'jwt',
  session: { get: () => new Promise(() => {}), handleError: () => ({}) },
  hub,
  hubQ,
  logo: { url: null, blob: null },
});

test('a link to one report: the hub opens the report in its place, or says it is gone — never a list', () => {
  const listCtxOf = (hub) => ({ token: 'T', hub, hubQ: { data: hub, isLoading: false, error: null, refetch() {} } });
  // With its row: <Navigate replace> draws nothing (publicReportEffects follows where it goes).
  assert.equal(m.page('list', listCtxOf(singleHub()), '/r/T'), '');
  for (const hub of [singleHub({ gone: true, reports: [] }), singleHub({ reports: [] }), singleHub({ gone: true })]) {
    const html = m.page('list', listCtxOf(hub), '/r/T?tab=kC');
    assert.match(html, /This report was taken down or removed\. Ask the person who sent it\./);
    assert.doesNotMatch(html, /see all reports|No reports are available|Latest|reports\/r9|tablist/);
  }
});

test('a link to one report: its page points at no other report, says so, and words earlier totals without one', () => {
  const qc = m.qcNew();
  qc.setQueryData(['share', 'T', 'jwt', 'report', 'r9'], { report: oneReport(), survey: { questions: [] }, single: true });
  const html = m.page('detail', detailCtxOf(singleHub()), '/r/T/reports/r9', qc);
  assert.doesNotMatch(html, /All reports|Older|Newer/);
  assert.match(html, /<p class="mt-1 text-xs text-fg-muted">This link opens this report only\.<\/p>/);
  assert.ok(html.includes(`Totals from before Oct 19 were updated by ${MINUS}120 doors after they were first reported.`));
  assert.doesNotMatch(html, /Earlier totals|since the/);
  assert.match(html, /Week of Oct 19/);
  assert.match(html, /Download PDF/);
  assert.match(html, /Canvasser observations/, 'the report itself reads as on any link');
  // Opened straight from the message's link, the report's own answer is enough before the hub's.
  assert.equal(m.page('detail', detailCtxOf(null, pending), '/r/T/reports/r9', qc), html);
});

test('a link to one report, taken down — or given another report\'s id: ask the person who sent it, no "see all reports"', () => {
  // Its own report taken down; another report's id while its own is still up.
  for (const hub of [singleHub({ gone: true, reports: [] }), singleHub()]) {
    const html = m.page('detail', detailCtxOf(hub), '/r/T/reports/r1', goneQc('r1'));
    assert.match(html, /This report was taken down or removed\. Ask the person who sent it\./);
    assert.doesNotMatch(html, /see all reports|href="\/r\/T"/);
  }
  // Before the hub has said which kind of link this is: neither way out, a moment's Loading….
  const waiting = m.page('detail', detailCtxOf(null, pending), '/r/T/reports/r1', goneQc('r1'));
  assert.match(waiting, /Loading…/);
  assert.doesNotMatch(waiting, /taken down/);
  // A hub that couldn't load: the all-reports way out, whose page offers Try again.
  const failed = m.page('detail', detailCtxOf(null, { data: undefined, isLoading: false, error: new Error('offline') }), '/r/T/reports/r1', goneQc('r1'));
  assert.match(failed, /see all reports/);
});
