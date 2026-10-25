import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// The client-report integration fixes, rendered (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G3, §H2, §O4):
// the hub's and the admin list's second figure follow the campaign type the report froze, never a
// guess from the totals; "Before you publish" names a hidden written parent by its own words; the
// builder's preview map gets the client page's period wording and a reload on MAP_UPDATED; and the
// coordinator-change confirm names the client-report teams whose numbers move.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-cr-integration-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const CID = '6a0000000000000000000001';
const RID = '6a00000000000000000000aa';
const SNAP = '6a00000000000000000000dd';

const build = async () => {
  writeFileSync(join(dir, 'authStub.jsx'), `export const useAuth = () => ({ isOrgAdmin: true, isSuperAdmin: false, user: { id: 'u1' }, homePath: '/' });`);
  // The preview map, recorded rather than drawn: the builder's props are what is under test.
  writeFileSync(
    join(dir, 'mapStub.jsx'),
    `export default function MapStub(props) { globalThis.__mapProps.push(props); return <div data-map-stub="">{props.emptyText}</div>; }`
  );
  // The builder's preview query answers at once (renderToString renders once); every other query is real.
  writeFileSync(
    join(dir, 'queryShim.js'),
    `export * from '@tanstack/react-query';
import * as Q from '@tanstack/react-query';
export const useQuery = (opts, ...rest) => {
  const real = Q.useQuery(opts, ...rest);
  if (opts.queryKey[1] === 'client-report-preview' && globalThis.__preview) {
    return { ...real, data: globalThis.__preview, isFetching: false, isPlaceholderData: false, isError: false };
  }
  return real;
};`
  );
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientReportBuilderPage from '${join(here, '../pages/ClientReportBuilderPage.jsx')}';
import ClientReportsPage from '${join(here, '../pages/ClientReportsPage.jsx')}';
import PublicReportListPage from '${join(here, '../pages/PublicReportListPage.jsx')}';
import BeforePublish from '${join(here, '../components/clientReports/BeforePublish.jsx')}';
import CoordinatorConfirm from '${join(here, '../components/CoordinatorConfirm.jsx')}';
import { deriveReportSections } from '${join(here, './reportDerive.js')}';

globalThis.__mapProps = [];
globalThis.fetch = () => new Promise(() => {});
const store = new Map([['canvass.token', 'tok'], ['canvass.activeOrgId', 'org1']]);
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = {
  location: { origin: 'https://doorline.app', pathname: '/' },
  addEventListener() {},
  removeEventListener() {},
  // Wide: the builder shows its preview column beside the settings.
  matchMedia: (q) => ({ matches: /min-width: 1280px/.test(q), addEventListener() {}, removeEventListener() {} }),
  confirm: () => true,
};
globalThis.document = globalThis.document || { body: { style: {} }, activeElement: null, addEventListener() {}, removeEventListener() {} };

export const newQc = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
const wrap = (qc, node, path = '/') => renderToString(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>{node}</MemoryRouter></QueryClientProvider>);

export const builder = (qc, { reportDoc, checks, shaped }) => {
  globalThis.__mapProps = [];
  globalThis.__preview = { report: shaped, survey: { questions: [] } };
  qc.setQueryData(['admin', 'campaigns'], { campaigns: [{ _id: '${CID}', name: 'Ward 3', type: 'survey', isActive: true, timeZone: 'America/New_York' }] });
  qc.setQueryData(['admin', 'client-report', '${RID}'], { report: reportDoc, campaignName: 'Ward 3', orgName: 'Fox Bryant', seriesLabel: 'Whole campaign', openMockFlags: 0, build: { status: 'idle', live: false }, checks });
  qc.setQueryData(['admin', 'client-report-shares', '${CID}'], { shares: [] });
  qc.setQueryData(['admin', 'branding'], { hasLogo: false });
  const html = wrap(qc, <Routes><Route path="/campaigns/:campaignId/reports/:id" element={<ClientReportBuilderPage />} /></Routes>, '/campaigns/${CID}/reports/${RID}');
  return { html, mapProps: globalThis.__mapProps.slice() };
};
export const sectionsOf = (r) => deriveReportSections(r);
export const before = (props) => wrap(newQc(), <BeforePublish tz="America/New_York" labelOf={(k) => k} copiedReviewed={false} onCopiedReviewed={() => {}} busy={false} shares={[]} {...props} />);
export const confirm = (qc, props) =>
  wrap(qc, <CoordinatorConfirm isLoading={false} error={null} subjectName="Ann Crewone" busy={false} onCancel={() => {}} onConfirm={() => {}} {...props} />);
export const hub = (data) =>
  wrap(
    newQc(),
    <Routes>
      <Route element={<Outlet context={{ token: 'T', hub: data, hubQ: { data, isLoading: false, error: null, refetch() {} } }} />}>
        <Route path="/r/:token" element={<PublicReportListPage />} />
      </Route>
    </Routes>,
    '/r/T'
  );
export const list = (reports) => {
  const qc = newQc();
  qc.setQueryData(['admin', 'campaigns'], { campaigns: [{ _id: '${CID}', name: 'Ward 3', type: 'survey', isActive: true, timeZone: 'America/New_York' }] });
  qc.setQueryData(['admin', 'client-reports', '${CID}'], { reports });
  qc.setQueryData(['admin', 'client-report-series', '${CID}'], { series: [], crews: [], teamsReady: true });
  qc.setQueryData(['admin', 'client-report-shares', '${CID}'], { shares: [] });
  qc.setQueryData(['admin', 'efforts', '${CID}'], { efforts: [] });
  qc.setQueryData(['admin', 'branding'], { hasLogo: false });
  return wrap(qc, <Routes><Route path="/campaigns/:campaignId/reports" element={<ClientReportsPage />} /></Routes>, '/campaigns/${CID}/reports');
};
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
        name: 'stubs',
        setup(b) {
          b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
          b.onResolve({ filter: /components\/ClientReportMap\.jsx$/ }, () => ({ path: join(dir, 'mapStub.jsx') }));
          b.onResolve({ filter: /^@tanstack\/react-query$/ }, (a) => (/ClientReportBuilderPage\.jsx$/.test(a.importer) ? { path: join(dir, 'queryShim.js') } : undefined));
          b.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'css-stub' }));
          b.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: '', loader: 'js' }));
        },
      },
    ],
  });
  return import(pathToFileURL(out).href);
};
const m = await build();
const text = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const breakdowns = [
  { questionKey: 'support', questionLabel: 'Support for Smith?', type: 'single_choice', options: [{ option: 'Yes', count: 3, percent: 60 }, { option: 'No', count: 2, percent: 40 }] },
  { questionKey: 'issues', questionLabel: 'Top issues', type: 'multiple_choice', options: [{ option: 'Roads', count: 2, percent: 100 }] },
];
const reportDoc = {
  _id: RID,
  campaignId: CID,
  campaignType: 'survey',
  status: 'draft',
  title: '',
  weekStart: '2026-10-13',
  weekEnd: '2026-10-19',
  timeZone: 'America/New_York',
  rangeEndUtc: '2026-10-20T04:00:00Z',
  scope: { kind: 'campaign', label: 'Whole campaign' },
  seriesId: '6a00000000000000000000cc',
  observations: [],
  supportQuestionKey: null,
  visibility: { visibleQuestionKeys: ['support', 'issues'], mapAnswerKeys: ['support'], showMap: true, mapMode: 'pins', areaSize: 'small', visibleTags: [], showGoal: false },
  snapshotId: SNAP,
  snapshotInputs: { showMap: true, mapMode: 'pins', areaSize: 'small', mapKeys: ['support'], questionDeps: [], coordinatorIds: [] },
  statsComputedAt: '2026-10-20T13:14:00Z',
  editVersion: 1,
  stats: { cumulative: { totals: { doorsKnocked: 5, surveysTaken: 3 }, contactBreakdown: {}, surveyBreakdowns: breakdowns, tagBreakdowns: [] }, period: { totals: { doorsKnocked: 2 } } },
  build: { status: 'idle' },
};
const checks = {
  periodNotOver: false,
  numbersAsOf: '2026-10-20T13:14:00Z',
  numbersStale: false,
  arrivedDuringBuild: 0,
  openMockFlags: 0,
  provenance: { cumulative: null, period: null },
  copiedNotesUnreviewed: false,
  copiedFrom: null,
  hiddenParentCharts: [],
  hiddenTagSources: [],
  areaWithoutAnswers: [],
  areaNarrowedBy: [],
  conditionsUnknown: false,
  earlierTotals: null,
  earlierReportRefreshed: null,
  earlierReportsRefreshed: 0,
  links: { usable: 0, labels: [], reason: 'no_link' },
  team: null,
};
// What POST /:id/preview answers: the client's shape (services/reports/clientReportView.js).
const shaped = {
  id: RID,
  campaignType: 'survey',
  title: '',
  effortName: null,
  scope: { kind: 'campaign', label: 'Whole campaign', seriesKey: 'k1', seriesLabel: 'Whole campaign' },
  weekStart: '2026-10-13',
  weekEnd: '2026-10-19',
  timeZone: 'America/New_York',
  status: 'draft',
  publishedOn: null,
  editedOn: null,
  refreshedOn: null,
  numbersThrough: null,
  observations: [],
  supportQuestionKey: null,
  stats: {
    cumulative: { totals: { doorsKnocked: 5, surveysTaken: 3 }, contactBreakdown: {}, surveyBreakdowns: breakdowns, tagBreakdowns: [] },
    period: { totals: { doorsKnocked: 2 }, contactBreakdown: {}, surveyBreakdowns: [], tagBreakdowns: [] },
  },
  goal: null,
  visibility: { showMap: true, mapMode: 'pins', areaSize: null },
  mapPointCount: 0,
  areaCellCount: 0,
  earlierTotals: null,
  nav: null,
};

test('the builder’s preview map: the client page’s period wording, and MAP_UPDATED reloads the report and its preview', async () => {
  const qc = m.newQc();
  const { html, mapProps } = m.builder(qc, { reportDoc, checks, shaped });
  assert.equal(mapProps.length, 1, 'the preview map rendered');
  const props = mapProps[0];
  const expected = m.sectionsOf(shaped).mapEmptyText;
  assert.equal(expected, 'No mapped doors for this week.');
  assert.equal(props.emptyText, expected, 'the same empty line the client reads');
  assert.ok(text(html).includes('No mapped doors for this week.'));
  assert.equal(props.mapPath, `/admin/client-reports/${RID}/preview/map`);
  assert.equal(typeof props.onUpdated, 'function', 'a 409 MAP_UPDATED has somewhere to go');
  props.onUpdated();
  assert.equal(qc.getQueryState(['admin', 'client-report', RID]).isInvalidated, true, 'the report reloads (its snapshot moved)');
  const previews = qc.getQueryCache().findAll({ queryKey: ['admin', 'client-report-preview', RID] });
  assert.ok(previews.length > 0 && previews.every((q) => q.state.isInvalidated), 'and so does its preview');
});

test('Before you publish names a hidden parent by its words and type — a written one as “a written answer to …”', () => {
  const t = (hiddenParentCharts) => text(m.before({ checks: { ...checks, hiddenParentCharts }, report: reportDoc }));
  const written = t([{ key: 'issues', label: 'Top issues', parents: [{ key: 'notes', label: 'Anything else?', type: 'text' }] }]);
  assert.ok(written.includes('“Top issues” chart: it’s asked only after a written answer to “Anything else?”, so its total shows how many gave one.'), written);
  assert.ok(!written.includes('notes'), 'never the internal key');
  const choice = t([{ key: 'issues', label: 'Top issues', parents: [{ key: 'support', label: 'Support for Smith?', type: 'single_choice' }] }]);
  assert.ok(choice.includes('“Top issues” chart: it’s asked only on some paths through “Support for Smith?”, which you’ve hidden — its total shows how many took that path.'));
  const gone = t([{ key: 'issues', label: 'Top issues', parents: [{ key: 'old_q', label: 'old_q', type: null }] }]);
  assert.ok(gone.includes('some paths through an earlier answer'), gone);
  assert.ok(!gone.includes('old_q'), 'a question the survey no longer has is never named by its key');
});

test('the coordinator-change confirm names the client-report teams whose numbers move — only when doors move', () => {
  const qc = m.newQc();
  const preview = { from: { id: 'c-dee', name: 'Dee Lead' }, to: { id: 'c-sam', name: 'Sam Lead' }, doors: 12, surveys: 3, subjectRunsCrew: false };
  qc.setQueryData(['admin', 'client-report-affected-teams', CID, 'c-dee,c-sam'], {
    teams: [{ seriesId: 's1', label: 'Paid team' }, { seriesId: 's2', label: 'Volunteer team' }],
  });
  const both = text(m.confirm(qc, { preview, campaignId: CID, subjectId: 'u-ann' }));
  assert.ok(both.includes('Move 12 doors and 3 surveys from Dee Lead ’s team to Sam Lead ’s team?'), both);
  assert.ok(both.includes('This also changes the numbers in the Paid team and Volunteer team client reports.'), both);

  // "No team" on one side: the person's own crew's team is asked about too (a lead's unstamped doors).
  qc.setQueryData(['admin', 'client-report-affected-teams', CID, 'c-sam,u-ann'], { teams: [{ seriesId: 's1', label: 'Paid team' }] });
  const one = text(m.confirm(qc, { preview: { ...preview, from: null }, campaignId: CID, subjectId: 'u-ann' }));
  assert.ok(one.includes('This also changes the numbers in the Paid team client report.'), one);

  // Nothing moves: no line, whatever is cached.
  const none = text(m.confirm(qc, { preview: { ...preview, doors: 0, surveys: 0 }, campaignId: CID, subjectId: 'u-ann' }));
  assert.ok(!none.includes('client report'), none);
  // Without the campaign (an older caller), the confirm is exactly what it was.
  assert.ok(!text(m.confirm(m.newQc(), { preview })).includes('client report'));
});

const hubRow = (id, campaignType, cumulative, extra = {}) => ({
  id,
  campaignType,
  title: '',
  weekStart: '2026-10-13',
  weekEnd: '2026-10-19',
  scope: { kind: 'campaign', label: 'Whole campaign', seriesKey: 'kC', seriesLabel: 'Whole campaign' },
  publishedOn: '2026-10-19',
  editedOn: null,
  refreshedOn: null,
  numbersThrough: null,
  headline: { cumulative, period: {} },
  ...extra,
});

test('the hub’s second figure follows the campaign type the report froze, never the totals', () => {
  const base = { campaignName: 'Fall', orgName: 'Fox Bryant', hasLogo: false };
  // A lit-drop campaign whose totals carry a survey (the old guess would have said surveys).
  const lit = text(m.hub({ ...base, reports: [hubRow('r1', 'lit_drop', { doorsKnocked: 40, litKnocks: 30, surveysTaken: 2 })] }));
  assert.ok(lit.includes('Lit dropped'), lit);
  assert.ok(!lit.includes('Surveys taken'));
  // A survey campaign whose doors so far were all lit drops (the old guess would have said lit).
  const survey = text(m.hub({ ...base, reports: [hubRow('r2', 'survey', { doorsKnocked: 40, litKnocks: 30, surveysTaken: 0 })] }));
  assert.ok(survey.includes('Surveys taken'), survey);
  assert.ok(!survey.includes('Lit dropped'));
  // Reports from before the field fall back to the totals.
  const legacy = text(m.hub({ ...base, reports: [hubRow('r3', null, { doorsKnocked: 40, litKnocks: 30, surveysTaken: 0 })] }));
  assert.ok(legacy.includes('Lit dropped'));
});

test('the admin list reads each row’s own campaign type, the campaign’s only for a report from before it', () => {
  const row = (id, campaignType, weekStart, weekEnd) => ({
    id,
    campaignId: CID,
    campaignType,
    title: '',
    effortName: null,
    seriesId: null,
    seriesKey: 'kC',
    scope: { kind: 'campaign', label: 'Whole campaign' },
    weekStart,
    weekEnd,
    timeZone: 'America/New_York',
    status: 'published',
    takenDownAt: null,
    hasSnapshot: true,
    build: { status: 'idle' },
    headline: { cumulative: { doorsKnocked: 40, litKnocks: 30, surveysTaken: 2 }, period: { doorsKnocked: 4, litKnocks: 3, surveysTaken: 1 } },
  });
  const t = text(m.list([row('a', 'lit_drop', '2026-10-13', '2026-10-19'), row('b', null, '2026-10-06', '2026-10-12')]));
  assert.ok(t.includes('40 doors (+4) · 30 lit dropped (+3)'), 'the row that froze lit_drop');
  assert.ok(t.includes('40 doors (+4) · 2 surveys (+1)'), 'the older row falls back to the campaign’s type (survey)');
});
