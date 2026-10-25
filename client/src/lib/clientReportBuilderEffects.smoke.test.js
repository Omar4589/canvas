import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import { settingsOf as settingsOfDoc } from '../components/clientReports/autoSave.js';

// The report builder's EFFECTS, run — what renderToString never does (the doorOutcomesEffects pattern).
// The builder's auto-save, its leaving guard, its build polling and its "start the first numbers"
// all live in effects (the page's and lib hooks'), so this bundles the real page with `useEffect`
// recorded rather than run, renders it, runs each recorded effect, and reads the polling options
// off its queries. Then it drives the real hooks the page mounts: 800 ms of quiet → one targeted
// PATCH; the leave guard holds the browser's beforeunload while dirty; and leaving with a change still
// pending sends it with fetch keepalive (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G3, §C5).

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-cr-effects-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const CID = '6a0000000000000000000001';
const RID = '6a00000000000000000000aa';
const RID_NEW = '6a00000000000000000000bb';
const breakdowns = [
  { questionKey: 'support', questionLabel: 'Support for Smith?', type: 'single_choice', options: [{ option: 'Yes', count: 3, percent: 60 }, { option: 'No', count: 2, percent: 40 }] },
  { questionKey: 'recall', questionLabel: 'Back the recall?', type: 'single_choice', options: [] },
  { questionKey: 'sign', questionLabel: 'Yard sign?', type: 'multiple_choice', options: [] },
];
const report = (over = {}) => ({
  _id: RID,
  campaignId: CID,
  campaignType: 'survey',
  status: 'draft',
  title: 'Week 3',
  weekStart: '2026-10-13',
  weekEnd: '2026-10-19',
  timeZone: 'America/New_York',
  rangeEndUtc: '2026-10-20T04:00:00Z',
  scope: { kind: 'campaign', label: 'Whole campaign' },
  seriesId: '6a00000000000000000000cc',
  observations: [{ heading: 'Voter intent', body: 'Warm' }],
  supportQuestionKey: 'support',
  visibility: { visibleQuestionKeys: ['support', 'recall', 'sign'], mapAnswerKeys: ['support'], showMap: true, mapMode: 'pins', areaSize: 'small', visibleTags: [], showGoal: false },
  snapshotId: '6a00000000000000000000dd',
  snapshotInputs: { showMap: true, mapMode: 'pins', areaSize: 'small', mapKeys: ['support'], questionDeps: [['sign', ['recall']]], coordinatorIds: [] },
  statsComputedAt: '2026-10-20T13:14:00Z',
  editVersion: 4,
  stats: { cumulative: { totals: { doorsKnocked: 5 }, contactBreakdown: {}, surveyBreakdowns: breakdowns, tagBreakdowns: [] }, period: { totals: {} } },
  build: { status: 'idle' },
  ...over,
});
const checks = {
  periodNotOver: false,
  numbersAsOf: '2026-10-20T13:14:00Z',
  numbersStale: true,
  arrivedDuringBuild: 0,
  openMockFlags: 2,
  provenance: { cumulative: null, period: null },
  copiedNotesUnreviewed: false,
  copiedFrom: null,
  hiddenParentCharts: [],
  hiddenTagSources: [],
  areaWithoutAnswers: [],
  conditionsUnknown: false,
  earlierTotals: null,
  earlierReportsRefreshed: 0,
  links: { usable: 0, labels: [], reason: 'no_link' },
  team: null,
};

// `persistRefs`: the page's (and its hooks') refs outlive one renderToString, so a second render is the
// SAME page a moment later — what "the build finishes while the page is open" needs (ADMINUX-4).
// `staleTime`: the query client's; 0 is the app's own (a cached report is stale until fetched again).
// `extra`: more of GET /:id's answer (liveInputs); `campaign`: the campaign list row; `preview`: what
// POST /:id/preview answers, with the preview map recorded instead of drawn; `wide`: 1280 px and up.
// `storage`: localStorage entries the browser already holds (a copy kept on this device).
const build = async ({
  reportDoc,
  build: buildView = { status: 'idle', live: false },
  persistRefs = false,
  path = null,
  staleTime = 'Infinity',
  extra = {},
  campaign = {},
  preview = null,
  wide = false,
  storage = {},
}) => {
  writeFileSync(join(dir, 'authStub.jsx'), `export const useAuth = () => ({ isOrgAdmin: true, isSuperAdmin: false, user: { id: 'u1' }, homePath: '/' });`);
  writeFileSync(join(dir, 'mapStub.jsx'), `export default function MapStub(props) { globalThis.__mapProps.push(props); return <div data-map-stub="" />; }`);
  writeFileSync(join(dir, 'reactShim.js'), `export * from 'react';
import * as R from 'react';
export default R;
export const useEffect = (fn) => { globalThis.__effects.push(fn); };
export const useRef = (init) => {
  const store = globalThis.__refStore;
  if (!store) return R.useRef(init);
  const i = store.i++;
  if (!(i in store.refs)) store.refs[i] = { current: init };
  return store.refs[i];
};`);
  // Where the page navigates, recorded (the router's own navigate is a no-op outside a browser).
  writeFileSync(join(dir, 'routerShim.js'), `export * from 'react-router-dom';
import * as RR from 'react-router-dom';
export const useNavigate = () => {
  RR.useNavigate();
  return (to, opts) => globalThis.__navigations.push({ to, opts: opts || null });
};`);
  writeFileSync(join(dir, 'queryShim.js'), `export * from '@tanstack/react-query';
import * as Q from '@tanstack/react-query';
export const useQuery = (opts, ...rest) => {
  globalThis.__queries.push(opts);
  const real = Q.useQuery(opts, ...rest);
  // The preview answers at once when a test hands one over (renderToString renders once).
  if (opts.queryKey[1] === 'client-report-preview' && globalThis.__preview) {
    return { ...real, data: globalThis.__preview, isFetching: false, isPlaceholderData: false, isError: false };
  }
  return real;
};`);
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientReportBuilderPage from '${join(here, '../pages/ClientReportBuilderPage.jsx')}';
import { useAutoSave, useLeaveGuard } from '${join(here, '../components/clientReports/hooks.js')}';
import { settingsOf } from '${join(here, '../components/clientReports/autoSave.js')}';
export { errorText } from '${join(here, '../components/clientReports/parts.jsx')}';

// The browser, as far as these effects reach it.
globalThis.__effects = [];
globalThis.__queries = [];
globalThis.__fetches = [];
globalThis.__navigations = [];
globalThis.__mapProps = [];
globalThis.__preview = ${preview ? JSON.stringify({ report: preview, survey: { questions: [] } }) : 'null'};
globalThis.__listeners = { add: [], remove: [] };
globalThis.__refStore = ${persistRefs ? '{ i: 0, refs: [] }' : 'null'};
// A test can answer a request itself (a 404 from the build poll, say); otherwise the defaults below.
globalThis.__answer = null;
const store = new Map([['canvass.token', 'tok'], ['canvass.activeOrgId', 'org1'], ...${JSON.stringify(Object.entries(storage))}]);
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = {
  location: { origin: 'https://doorline.app', pathname: '/campaigns/${CID}/reports/x' },
  addEventListener: (type, fn) => globalThis.__listeners.add.push({ type, fn }),
  removeEventListener: (type, fn) => globalThis.__listeners.remove.push({ type, fn }),
  matchMedia: (q) => ({ matches: ${wide ? '/min-width: 1280px/.test(q)' : 'false'}, addEventListener: (t, fn) => globalThis.__listeners.add.push({ type: 'mq:' + t, fn }), removeEventListener: (t, fn) => globalThis.__listeners.remove.push({ type: 'mq:' + t, fn }) }),
  confirm: () => true,
};
globalThis.fetch = (url, init = {}) => {
  globalThis.__fetches.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, keepalive: !!init.keepalive, headers: init.headers || {} });
  const own = globalThis.__answer?.(url, init);
  if (own) return Promise.resolve({ ok: own.status < 400, status: own.status, text: async () => JSON.stringify(own.body) });
  if ((init.method || 'GET') === 'PATCH' && !init.keepalive) {
    const sent = JSON.parse(init.body);
    return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ report: { _id: '${RID}', editVersion: 5, title: sent.title, visibility: {} }, build: { status: 'idle' } }) });
  }
  return new Promise(() => {});
};

export const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: ${staleTime} } } });
qc.setQueryData(['admin', 'campaigns'], { campaigns: [${JSON.stringify({ _id: CID, name: 'Ward 3', type: 'survey', isActive: true, timeZone: 'America/New_York', ...campaign })}] });
qc.setQueryData(['admin', 'client-report', '${reportDoc._id}'], ${JSON.stringify({ report: reportDoc, campaignName: 'Ward 3', orgName: 'Fox Bryant', seriesLabel: 'Whole campaign', openMockFlags: 2, build: buildView, checks, ...extra })});
qc.setQueryData(['admin', 'client-report-shares', '${CID}'], { shares: [] });
qc.setQueryData(['admin', 'branding'], { hasLogo: false });
const page = () => renderToString(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['${path || `/campaigns/${CID}/reports/${reportDoc._id}`}']}><Routes><Route path="/campaigns/:campaignId/reports/:id" element={<ClientReportBuilderPage />} /></Routes></MemoryRouter></QueryClientProvider>);
export const html = page();
export const pageEffects = globalThis.__effects.splice(0);
export const pageQueries = globalThis.__queries.splice(0);
// The same page again, a moment later (its refs kept, with persistRefs): what it renders, and its effects.
export const rerender = () => {
  if (globalThis.__refStore) globalThis.__refStore.i = 0;
  globalThis.__effects = [];
  globalThis.__queries = [];
  const out = page();
  return { html: out, effects: globalThis.__effects.splice(0), queries: globalThis.__queries.splice(0) };
};
export const navigations = () => globalThis.__navigations;
export const mapProps = () => globalThis.__mapProps;
export const answer = (fn) => {
  globalThis.__answer = fn;
};

// The hooks the page mounts, on their own: the saver and the leave guard. \`version\`: the editVersion
// the screen reflects, as the page hands it (contract C8); \`elsewhere\` records a CHANGED_ELSEWHERE.
globalThis.__elsewhere = [];
function Harness({ dirty, version }) {
  const { saver } = useAutoSave({
    reportId: '${RID}',
    versionOf: version == null ? undefined : () => version,
    onChangedElsewhere: (r) => globalThis.__elsewhere.push(r),
  });
  useLeaveGuard(dirty);
  globalThis.__saver = saver;
  return <span>harness</span>;
}
export const renderHarness = (dirty, version = null) => {
  globalThis.__effects = [];
  renderToString(<QueryClientProvider client={qc}><Harness dirty={dirty} version={version} /></QueryClientProvider>);
  return { effects: globalThis.__effects.splice(0), saver: globalThis.__saver };
};
export const elsewhere = () => globalThis.__elsewhere;
export const stored = (k) => localStorage.getItem(k);
export const base = settingsOf(${JSON.stringify(reportDoc)});
export const fetches = () => globalThis.__fetches;
export const listeners = () => globalThis.__listeners;
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
          // The page's and the Client Reports hooks' own React and react-query: everything else keeps the real ones.
          const mine = (importer) => /ClientReportBuilderPage\.jsx$|clientReports[\\/]hooks\.js$/.test(importer);
          b.onResolve({ filter: /^react$/ }, (a) => (mine(a.importer) ? { path: join(dir, 'reactShim.js') } : undefined));
          b.onResolve({ filter: /^@tanstack\/react-query$/ }, (a) => (mine(a.importer) ? { path: join(dir, 'queryShim.js') } : undefined));
          b.onResolve({ filter: /^react-router-dom$/ }, (a) => (/ClientReportBuilderPage\.jsx$/.test(a.importer) ? { path: join(dir, 'routerShim.js') } : undefined));
          b.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'css-stub' }));
          b.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: '', loader: 'js' }));
        },
      },
    ],
  });
  return import(pathToFileURL(out).href);
};
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const text = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('the builder renders the draft at once, and every one of its effects runs and cleans up after itself', async () => {
  const m = await build({ reportDoc: report() });
  const t = text(m.html);
  assert.ok(t.includes('Oct 13 – Oct 19'), 'the builder, not a skeleton: the report was cached when it opened');
  for (const s of ['Before you publish', 'Survey questions', 'Publish…', 'All changes saved', 'Recompute']) assert.ok(t.includes(s), s);
  assert.ok(t.includes('Asked only on some paths through “Back the recall?” — mapping it shows who took that path.'), 'the follow-up row');
  assert.ok(t.includes('2 unreviewed mock-GPS flags'), 'Before you publish reads the checks');
  assert.ok(m.pageEffects.length >= 8, `the page's and its hooks' effects were recorded: ${m.pageEffects.length}`);

  const cleanups = [];
  for (const fn of m.pageEffects) {
    const c = fn(); // a throw here is the crash this test exists for
    if (typeof c === 'function') cleanups.push(c);
  }
  await tick();
  assert.ok(!m.fetches().some((f) => /\/recompute$/.test(f.url)), 'a draft that has numbers does not rebuild on open');
  assert.ok(!m.listeners().add.some((l) => l.type === 'beforeunload'), 'nothing unsaved: no leave prompt');
  cleanups.forEach((c) => c());
  const { add, remove } = m.listeners();
  for (const l of add) assert.ok(remove.some((r) => r.type === l.type && r.fn === l.fn), `a ${l.type} listener is removed on unmount`);
  assert.ok(!m.fetches().some((f) => f.keepalive), 'nothing pending, nothing sent on the way out');
});

test('the build is polled only while it is live: every 3 s queued or running, 15 s waiting, never idle', async () => {
  const m = await build({ reportDoc: report() });
  const poll = m.pageQueries.find((o) => JSON.stringify(o.queryKey) === JSON.stringify(['admin', 'client-report-build', RID]));
  assert.ok(poll, 'the build poll is mounted');
  assert.equal(poll.enabled, false, 'an idle build is not polled');
  const every = (status) => poll.refetchInterval({ state: { data: { status } } });
  assert.equal(every('running'), 3000);
  assert.equal(every('queued'), 3000);
  assert.equal(every('waiting'), 15000);
  assert.equal(every('ready'), false);
  assert.equal(every('failed'), false);
  // The preview asks the server to shape what is ON SCREEN (a POST overlay), not the last save.
  const preview = m.pageQueries.find((o) => o.queryKey[1] === 'client-report-preview');
  assert.ok(preview && preview.queryKey.includes('6a00000000000000000000dd'), 'keyed on the live snapshot it previews');
});

test('a draft with no numbers starts building when opened — once', async () => {
  const m = await build({ reportDoc: report({ _id: RID_NEW, snapshotId: null, snapshotInputs: null, statsComputedAt: null, stats: {} }), build: { status: 'idle', live: false } });
  // Below 1280 px the builder opens on its settings tab, which says why there are no questions yet.
  assert.ok(text(m.html).includes('No numbers yet'));
  assert.ok(text(m.html).includes('The survey questions appear here once the numbers are built.'));
  for (const fn of m.pageEffects) fn();
  // The claim waits on the saver's flush first; poll rather than guess how long a loaded machine takes.
  const recomputes = () => m.fetches().filter((f) => f.url === `/api/admin/client-reports/${RID_NEW}/recompute`);
  for (let i = 0; i < 100 && !recomputes().length; i += 1) await tick(20);
  await tick(50);
  const calls = recomputes();
  assert.equal(calls.length, 1, 'one recompute claimed');
  assert.equal(calls[0].method, 'POST');
});

test('a draft whose first numbers finish while the page is open never claims a second build (ADMINUX-4)', async () => {
  const queued = { status: 'queued', live: true, kind: 'recompute', startedAt: '2026-10-20T13:00:00Z', jobId: 'j1' };
  const m = await build({
    reportDoc: report({ _id: RID_NEW, snapshotId: null, snapshotInputs: null, statsComputedAt: null, stats: {}, build: queued }),
    build: queued,
    persistRefs: true,
  });
  const recomputes = () => m.fetches().filter((f) => f.url === `/api/admin/client-reports/${RID_NEW}/recompute`);
  for (const fn of m.pageEffects) fn();
  await tick(100);
  assert.equal(recomputes().length, 0, 'opened while its first numbers build: nothing claimed');
  // The poll sees the build finish a moment before the re-read brings its numbers: the same page, its
  // report still without a snapshot, its build idle.
  m.qc.setQueryData(['admin', 'client-report-build', RID_NEW], { status: 'idle' }, { updatedAt: Date.now() + 60000 });
  const again = m.rerender();
  assert.ok(text(again.html).includes('Oct 13 – Oct 19'), 'the same builder, a moment later');
  for (const fn of again.effects) fn();
  for (let i = 0; i < 25 && !recomputes().length; i += 1) await tick(20);
  assert.equal(recomputes().length, 0, 'the finished build is not followed by a second one');
});

test('auto-save: nothing before 800 ms of quiet, then one targeted PATCH; leaving with a change pending sends it with keepalive', async () => {
  const m = await build({ reportDoc: report() });
  const h = m.renderHarness(false);
  const cleanups = h.effects.map((fn) => fn()).filter((c) => typeof c === 'function');
  h.saver.reset(m.base);
  const before = m.fetches().length;
  h.saver.update({ ...m.base, title: 'Week 3 (final)' });
  await tick(400);
  assert.equal(m.fetches().length, before, 'nothing yet');
  await tick(600);
  const patches = m.fetches().filter((f) => f.method === 'PATCH' && !f.keepalive);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].url, `/api/admin/client-reports/${RID}`);
  // Only the field that changed — and that this is a DRAFT save (contract C5): a report published
  // meanwhile refuses it instead of taking half-written text live.
  assert.deepEqual(patches[0].body, { title: 'Week 3 (final)', ifStatus: 'draft' }, 'only the field that changed');
  assert.equal(patches[0].headers.Authorization, 'Bearer tok');
  await tick();
  assert.equal(h.saver.state.dirty, false, 'saved');

  // A change still waiting when the page goes leaves with keepalive, with the session's headers.
  h.saver.update({ ...m.base, title: 'Week 3 (final)', supportQuestionKey: 'recall' });
  cleanups.forEach((c) => c());
  const kept = m.fetches().filter((f) => f.keepalive);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].method, 'PATCH');
  assert.deepEqual(kept[0].body, { supportQuestionKey: 'recall', ifStatus: 'draft' }, 'the way out is a draft save too');
  assert.equal(kept[0].headers['X-Org-Id'], 'org1');
  await tick(1000);
  assert.equal(m.fetches().filter((f) => f.method === 'PATCH' && !f.keepalive).length, 1, 'and no timer fires after the page is gone');
});

test('the leave guard holds the browser’s beforeunload while dirty, and lets go when the page does', async () => {
  const m = await build({ reportDoc: report() });
  const h = m.renderHarness(true);
  const cleanups = h.effects.map((fn) => fn()).filter((c) => typeof c === 'function');
  const guard = m.listeners().add.find((l) => l.type === 'beforeunload');
  assert.ok(guard, 'registered while dirty');
  let prevented = false;
  const e = { preventDefault: () => (prevented = true), returnValue: undefined };
  guard.fn(e);
  assert.equal(prevented, true);
  assert.equal(e.returnValue, '', 'the legacy returnValue too, for older browsers');
  cleanups.forEach((c) => c());
  assert.ok(m.listeners().remove.some((l) => l.type === 'beforeunload' && l.fn === guard.fn), 'removed on unmount');
});

test('a cached copy from an earlier visit never seeds the screen: the builder waits for a fresh one (ADMINUX-1)', async () => {
  // The app's own staleTime (0): the report cached by an earlier visit is stale until fetched again —
  // it can predate a change made since, even this page's own last save on the way out.
  const m = await build({ reportDoc: report(), staleTime: 0 });
  const t = text(m.html);
  assert.ok(!t.includes('Publish…') && !t.includes('Oct 13 – Oct 19'), 'a skeleton, not the stale settings');
  for (const fn of m.pageEffects) fn();
  await tick(50);
  assert.ok(!m.fetches().some((f) => f.method === 'PATCH' || /\/recompute$/.test(f.url)), 'nothing is saved or built from it');
});

test('another campaign’s report under this campaign’s URL shows nothing and goes back to this campaign’s list (ADMINUX-5)', async () => {
  const m = await build({ reportDoc: report({ campaignId: '6a0000000000000000000009' }) });
  const t = text(m.html);
  assert.ok(!t.includes('Oct 13 – Oct 19') && !t.includes('Copy message') && !t.includes('Publish…'), 'none of that campaign’s report on this campaign’s page');
  for (const fn of m.pageEffects) fn();
  assert.deepEqual(m.navigations(), [{ to: `/campaigns/${CID}/reports`, opts: { replace: true } }]);
});

test('the build poll stops on 404 and 403 (a 404 re-reads the report, so the page says it is gone) and backs off on other errors (ADMINUX-7)', async () => {
  const m = await build({ reportDoc: report() });
  const poll = m.pageQueries.find((o) => JSON.stringify(o.queryKey) === JSON.stringify(['admin', 'client-report-build', RID]));
  const failed = (status) => ({ state: { status: 'error', error: { status }, data: { status: 'queued' } } });
  assert.equal(poll.refetchInterval(failed(404)), false, 'deleted: no more polls');
  assert.equal(poll.refetchInterval(failed(403)), false, 'no longer yours: no more polls');

  let answer = { status: 500, body: { error: 'Boom' } };
  m.answer((url) => (/\/build$/.test(url) ? answer : null));
  const signal = new AbortController().signal;
  await assert.rejects(poll.queryFn({ signal }));
  const once = poll.refetchInterval(failed(500));
  await assert.rejects(poll.queryFn({ signal }));
  const twice = poll.refetchInterval(failed(500));
  assert.ok(once > 3000 && twice > once && twice <= 60000, `backs off: ${once} ms, then ${twice} ms`);
  for (let i = 0; i < 6; i += 1) await assert.rejects(poll.queryFn({ signal }));
  assert.equal(poll.refetchInterval(failed(500)), 60000, 'never longer than a minute');
  answer = { status: 200, body: { build: { status: 'running', progress: 10 } } };
  await poll.queryFn({ signal });
  assert.equal(poll.refetchInterval({ state: { status: 'success', data: { status: 'running' } } }), 3000, 'back to every 3 s once a poll answers');

  answer = { status: 404, body: { error: 'Report not found', code: 'REPORT_NOT_FOUND' } };
  assert.equal(m.qc.getQueryState(['admin', 'client-report', RID]).isInvalidated, false);
  await assert.rejects(poll.queryFn({ signal }), (e) => e.status === 404);
  assert.equal(m.qc.getQueryState(['admin', 'client-report', RID]).isInvalidated, true, 'the report is re-read: "Report not found"');
});

test('the builder reads what the client is served from the server’s liveInputs, not its own guess (contract C4, LEGACY-2)', async () => {
  // A report from before snapshots: no snapshotInputs. Its own settings know nothing of follow-ups;
  // the server's liveInputs carry them (failing closed).
  const legacy = report({ snapshotInputs: null });
  const guessed = text((await build({ reportDoc: legacy })).html);
  assert.ok(!guessed.includes('Asked only on some paths through “Back the recall?”'), 'without liveInputs: no follow-up known');
  const m = await build({
    reportDoc: legacy,
    extra: { liveInputs: { showMap: true, mapMode: 'pins', areaSize: 'small', mapKeys: ['support'], questionDeps: [['sign', ['recall']]] } },
  });
  assert.ok(text(m.html).includes('Asked only on some paths through “Back the recall?” — mapping it shows who took that path.'), 'the server’s follow-ups drive the table');
});

test('a door goal set after the numbers were built says so, with what rebuilds them (contract C6, NUM-5)', async () => {
  const draft = text((await build({ reportDoc: report(), campaign: { doorGoal: 5000 } })).html);
  assert.ok(draft.includes('Your door goal was set after these numbers were built. Recompute them to show it. Recompute'), draft.slice(draft.indexOf('Door goal'), draft.indexOf('Door goal') + 260));
  const none = text((await build({ reportDoc: report() })).html);
  assert.ok(none.includes('This campaign has no door goal set. Add one from the Campaigns page, then recompute.'));
  const pub = text((await build({ reportDoc: report({ status: 'published', publishedAt: '2026-10-20T14:00:00Z' }), campaign: { doorGoal: 5000 } })).html);
  assert.ok(pub.includes('Your door goal was set after these numbers were built. Refresh numbers to show it. Refresh numbers'), 'published: Refresh numbers');
  const m = await build({ reportDoc: report() });
  assert.equal(m.errorText({ code: 'GOAL_AFTER_BUILD', message: 'Your door goal was set after these numbers were built. Recompute them — or Refresh numbers, on a published report — to show it.' }), 'Your door goal was set after these numbers were built. Recompute them — or Refresh numbers, on a published report — to show it.', 'the refusal reads as the server words it');
});

test('the preview map is handed the preview’s map version, so a new one fetches the map again (contract C7)', async () => {
  const shaped = {
    id: RID,
    campaignType: 'survey',
    title: 'Week 3',
    scope: { kind: 'campaign', label: 'Whole campaign' },
    weekStart: '2026-10-13',
    weekEnd: '2026-10-19',
    timeZone: 'America/New_York',
    status: 'draft',
    observations: [],
    stats: { cumulative: { totals: { doorsKnocked: 5 }, contactBreakdown: {}, surveyBreakdowns: [], tagBreakdowns: [] }, period: { totals: {}, contactBreakdown: {}, surveyBreakdowns: [], tagBreakdowns: [] } },
    visibility: { showMap: true, mapMode: 'pins', areaSize: null, mapVersion: 'mv-1' },
    mapPointCount: 3,
    areaCellCount: 0,
  };
  const m = await build({ reportDoc: report(), preview: shaped, wide: true });
  assert.equal(m.mapProps().length, 1, 'the preview map rendered');
  assert.equal(m.mapProps()[0].mapVersion, 'mv-1');
  const old = await build({ reportDoc: report(), preview: { ...shaped, visibility: { showMap: true, mapMode: 'pins', areaSize: null } }, wide: true });
  assert.equal(old.mapProps()[0].mapVersion, null, 'a payload without one: null');
});

test('C8: every save is pinned to the screen’s version — the way out too, after a copy is kept on this device (P-3)', async () => {
  const m = await build({ reportDoc: report() });
  const h = m.renderHarness(false, 4);
  const cleanups = h.effects.map((fn) => fn()).filter((c) => typeof c === 'function');
  h.saver.reset(m.base);
  h.saver.update({ ...m.base, title: 'Pinned' });
  await tick(1000);
  const patch = m.fetches().filter((f) => f.method === 'PATCH' && !f.keepalive);
  assert.deepEqual(patch[0].body, { title: 'Pinned', ifStatus: 'draft', ifEditVersion: 4 });
  await tick();
  h.saver.update({ ...m.base, title: 'Pinned', supportQuestionKey: 'recall' });
  assert.equal(m.stored(`doorline.clientReport.unsentEdit.${RID}`), null, 'nothing kept while the page is open');
  cleanups.forEach((c) => c());
  const kept = JSON.parse(m.stored(`doorline.clientReport.unsentEdit.${RID}`));
  assert.equal(kept.settings.supportQuestionKey, 'recall', 'the change, kept on this device first');
  assert.equal(kept.version, 4, 'with the version it was made against');
  assert.equal(kept.base.title, 'Pinned', 'and what the server held then');
  const out = m.fetches().filter((f) => f.keepalive);
  assert.deepEqual(out[0].body, { supportQuestionKey: 'recall', ifStatus: 'draft', ifEditVersion: 4 }, 'the keepalive is pinned too');
});

test('C8: a save refused CHANGED_ELSEWHERE hands the report back and parks the saver — never "Couldn’t save"', async () => {
  const m = await build({ reportDoc: report() });
  const current = { ...report(), editVersion: 6, title: 'Theirs' };
  m.answer((url, init) => ((init.method || 'GET') === 'PATCH' && !init.keepalive ? { status: 409, body: { code: 'CHANGED_ELSEWHERE', error: 'This report was changed somewhere else — this page now shows the latest version.', editVersion: 6, report: current } } : null));
  const h = m.renderHarness(false, 4);
  h.effects.map((fn) => fn());
  h.saver.reset(m.base);
  h.saver.update({ ...m.base, title: 'Mine' });
  await tick(1000);
  assert.equal(m.elsewhere().length, 1);
  assert.equal(m.elsewhere()[0].title, 'Theirs', 'the report as it stands, for the merge');
  assert.equal(h.saver.state.parked, true);
  assert.equal(h.saver.state.status, 'pending');
});

test('a published report names what is still worth a look (P-2), and an unsent edit kept on this device is offered (CONCUR-2)', async () => {
  const pub = report({ status: 'published', publishedAt: '2026-10-20T14:00:00Z', editVersion: 7 });
  const copy = { settings: { ...settingsOfDoc(pub), title: 'Kept title' }, base: settingsOfDoc(pub), version: 7, at: '2026-10-21T13:00:00Z' };
  const m = await build({
    reportDoc: pub,
    extra: {
      checks: {
        ...checks,
        conditionsUnknown: true,
        earlierReportRefreshed: { weekStart: '2026-10-06', weekEnd: '2026-10-12' },
        areaWithoutAnswers: [{ key: 'support', label: 'Support for Smith?' }],
      },
    },
    storage: { [`doorline.clientReport.unsentEdit.${RID}`]: JSON.stringify(copy) },
  });
  const t = text(m.html);
  assert.ok(t.includes('Worth a look'));
  assert.ok(t.includes('“Support for Smith?” shows no answers by area: some area has fewer than five answers to it, so your client sees only its overall chart. Large areas (with Refresh numbers) usually fix it.'));
  assert.ok(t.includes('earlier version of your survey'));
  assert.ok(t.includes('The Oct 6 – Oct 12 report’s numbers were refreshed after these were built, so this report’s “earlier totals” line is hidden. Refresh numbers to compare again. Refresh numbers'), t.slice(t.indexOf('Worth a look'), t.indexOf('Worth a look') + 600));
  assert.ok(t.includes('You have an unsent edit.') && t.includes('Restore your unsent edit'), 'the copy is offered');
  for (const fn of m.pageEffects) fn();
  assert.ok(m.stored(`doorline.clientReport.unsentEdit.${RID}`), 'and opening the page deletes nothing');
});

test('P-3: a draft change the way out didn’t land is offered back; one that landed is cleared', async () => {
  const doc = report({ editVersion: 5 });
  const base = settingsOfDoc(report({ editVersion: 4 }));
  const notLanded = { settings: { ...base, title: 'Typed on the way out' }, base, version: 4, at: '2026-10-21T13:00:00Z' };
  let m = await build({ reportDoc: doc, storage: { [`doorline.clientReport.unsentEdit.${RID}`]: JSON.stringify(notLanded) } });
  assert.ok(text(m.html).includes('A change you made didn’t save before you left.'));
  assert.ok(text(m.html).includes('Restore it'));
  // The keepalive landed: the report already holds the change — nothing to offer, and the copy goes.
  m = await build({ reportDoc: report({ editVersion: 5, title: 'Typed on the way out' }), storage: { [`doorline.clientReport.unsentEdit.${RID}`]: JSON.stringify(notLanded) } });
  assert.ok(!text(m.html).includes('didn’t save before you left'));
  for (const fn of m.pageEffects) fn();
  assert.equal(m.stored(`doorline.clientReport.unsentEdit.${RID}`), null, 'a copy whose change landed is cleared');
});

test('VERIFY2-2: the copy the way out kept is taken back once the server took the keepalive — kept when it was refused', async () => {
  for (const [status, kept] of [[200, false], [409, true]]) {
    const m = await build({ reportDoc: report() });
    m.answer((url, init) => (init.keepalive ? { status, body: status === 200 ? { report: { _id: RID } } : { code: 'CHANGED_ELSEWHERE' } } : null));
    const h = m.renderHarness(false, 4);
    const cleanups = h.effects.map((fn) => fn()).filter((c) => typeof c === 'function');
    h.saver.reset(m.base);
    h.saver.update({ ...m.base, title: 'Typed, then left' });
    cleanups.forEach((c) => c());
    assert.ok(m.stored(`doorline.clientReport.unsentEdit.${RID}`), 'kept before the keepalive left');
    await tick(30);
    assert.equal(!!m.stored(`doorline.clientReport.unsentEdit.${RID}`), kept, `${status}: ${kept ? 'refused — offered next time' : 'saved — nothing to offer later'}`);
  }
});

test('VERIFY2-4 / VERIFY2-5: no large-areas advice on numbers already in large areas; the copied-notes tick is pointed at on drafts only', async () => {
  const areaChecks = { ...checks, areaWithoutAnswers: [{ key: 'support', label: 'Support for Smith?' }] };
  const pub = (size) =>
    report({ status: 'published', publishedAt: '2026-10-20T14:00:00Z', snapshotInputs: { showMap: true, mapMode: 'area', areaSize: size, mapKeys: ['support'], questionDeps: [], coordinatorIds: [] } });
  const small = text((await build({ reportDoc: pub('small'), extra: { checks: areaChecks } })).html);
  assert.ok(small.includes('so your client sees only its overall chart. Large areas (with Refresh numbers) usually fix it.'));
  const large = text((await build({ reportDoc: pub('large'), extra: { checks: areaChecks } })).html);
  assert.ok(large.includes('so your client sees only its overall chart.') && !large.includes('Large areas (with Refresh numbers) usually fix it.'), 'already large: no advice');
  const draftLarge = text((await build({ reportDoc: report({ snapshotInputs: { showMap: true, mapMode: 'area', areaSize: 'large', mapKeys: ['support'], questionDeps: [], coordinatorIds: [] } }), extra: { checks: areaChecks } })).html);
  assert.ok(draftLarge.includes('so the report shows only its overall chart.') && !draftLarge.includes('Large areas usually fix it.'));
  // Copied notes never reviewed: the draft points at Before you publish; a published report can't.
  const copied = { copiedFrom: { reportId: 'r0', weekStart: '2026-10-06', weekEnd: '2026-10-12' }, copiedNotesReviewed: false };
  assert.ok(text((await build({ reportDoc: report(copied) })).html).includes('under Before you publish'));
  assert.ok(!text((await build({ reportDoc: report({ ...copied, status: 'published', publishedAt: '2026-10-20T14:00:00Z' }) })).html).includes('under Before you publish'));
});

test('a refusal the builder re-read for says what the page now shows, never "try again" (ADMINUX-3)', async () => {
  const m = await build({ reportDoc: report() });
  const said = (code) => m.errorText({ code, reread: true, message: 'server words' });
  assert.match(said('SAVING'), /now shows the latest version/);
  assert.match(said('SNAPSHOT_CHANGED'), /the preview now shows them/);
  assert.match(said('STATUS_CHANGED'), /this page now shows it as it stands/);
  assert.match(said('NOTHING_TO_APPLY'), /now shows where things stand/);
  assert.match(said('NOTHING_TO_CANCEL'), /now shows where it stands/);
  for (const code of ['SAVING', 'SNAPSHOT_CHANGED', 'STATUS_CHANGED', 'NOTHING_TO_APPLY', 'NOTHING_TO_DISCARD', 'NOTHING_TO_CANCEL', 'ALREADY_PUBLISHED']) {
    assert.doesNotMatch(said(code), /try again|reload|in a moment/i, code);
  }
  // A page that doesn't re-read (the list) keeps the plainer words.
  assert.equal(m.errorText({ code: 'STATUS_CHANGED' }), 'This report was just published or changed — reload it.');
});
