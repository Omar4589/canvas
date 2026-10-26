import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// The client pages' EFFECTS, run — what renderToString never does (the doorOutcomesEffects recipe):
// the layout's own <title> and noindex meta handed back on unmount, the logo fetched with the token
// in a header and its blob URL revoked, the storage listener removed, a legacy open link unlocked;
// "Keep me signed in", the one error handler and "Sign out on this device" driven through the
// layout's own session store and re-rendered; the report page's once-a-day "opened" ping; the map's
// phone listener and error reporting; and a link to one report — the hub page handing over to its
// report with <Navigate replace> (recorded here: renderToString never runs Navigate's own effect),
// and a report gone sending the hub to be read again.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-public-effects-'));
after(() => rmSync(dir, { recursive: true, force: true }));

// ── A minimal browser ─────────────────────────────────────────────────────────────────────────
const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
};
globalThis.localStorage = memStorage();
globalThis.sessionStorage = memStorage();
const head = { children: [], appendChild(el) { el.parent = this; this.children.push(el); } };
globalThis.document = {
  title: 'Doorline',
  head,
  createElement: (tagName) => ({
    tagName,
    remove() {
      const i = this.parent ? this.parent.children.indexOf(this) : -1;
      if (i >= 0) this.parent.children.splice(i, 1);
    },
  }),
};
const listeners = { storage: new Set() };
const mq = { matches: false, handlers: new Set(), addEventListener(_, fn) { this.handlers.add(fn); }, removeEventListener(_, fn) { this.handlers.delete(fn); } };
globalThis.window = {
  location: { pathname: '/r/x', assign() {} },
  addEventListener: (type, fn) => (listeners[type] ||= new Set()).add(fn),
  removeEventListener: (type, fn) => listeners[type]?.delete(fn),
  dispatchEvent: () => true,
  matchMedia: () => mq,
};
const blobUrls = { made: [], revoked: [] };
const realCreate = URL.createObjectURL;
URL.createObjectURL = (blob) => {
  const url = realCreate(blob);
  blobUrls.made.push(url);
  return url;
};
URL.revokeObjectURL = (url) => blobUrls.revoked.push(url);

let calls = [];
let route = () => ({ status: 200, body: {} });
globalThis.fetch = (url, init = {}) => {
  calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
  const r = route(url, init);
  return Promise.resolve({
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    text: () => Promise.resolve(r.body == null ? '' : JSON.stringify(r.body)),
    blob: () => Promise.resolve(r.blob || new Blob([])),
  });
};

const tick = () => new Promise((r) => setTimeout(r, 15));

const build = async () => {
  writeFileSync(
    join(dir, 'reactShim.js'),
    `export * from 'react';
import * as R from 'react';
export default R;
export const useEffect = (fn) => { globalThis.__effects.push(fn); };`
  );
  writeFileSync(
    join(dir, 'routerShim.js'),
    `export * from 'react-router-dom';
export const Navigate = (props) => { globalThis.__navigates.push(props); return null; };`
  );
  writeFileSync(
    join(dir, 'mapboxStub.js'),
    `class FakeMap { constructor(o) { globalThis.__maps.push(this); this.o = o; } addControl() {} on() {} once() {} off() {} remove() { this.removed = true; } resize() {} getCanvas() { return { style: {} }; } setCooperativeGestures(v) { this.coop = v; } getSource() { return null; } getLayer() { return null; } }
export default { Map: FakeMap, NavigationControl: class {}, LngLatBounds: class {}, accessToken: null };`
  );
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PublicReportLayout from '${join(here, '../components/PublicReportLayout.jsx')}';
import PublicReportListPage from '${join(here, '../pages/PublicReportListPage.jsx')}';
import PublicReportDetailPage from '${join(here, '../pages/PublicReportDetailPage.jsx')}';
import ClientReportMap from '${join(here, '../components/ClientReportMap.jsx')}';
export { getShareSession } from '${join(here, './shareSession.js')}';
globalThis.__effects = [];
globalThis.__maps = [];
globalThis.__navigates = [];
// gcTime: Infinity — with a \`window\` defined, TanStack Query thinks it's in a browser and would keep
// the process alive on five-minute GC timers. retryOnMount: false lets a seeded error render as one.
export const newQc = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity, retryOnMount: false } } });
const run = (node, qc) => {
  globalThis.__effects = [];
  globalThis.__navigates = [];
  const html = renderToString(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
  return { html, effects: globalThis.__effects, navigates: globalThis.__navigates };
};
export const layout = (qc, path) =>
  run(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<PublicReportLayout />}>
          <Route path="/r/:token" element={<PublicReportListPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
    qc
  );
export const detail = (qc, ctx, path) =>
  run(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Outlet context={ctx} />}>
          <Route path="/r/:token/reports/:reportId" element={<PublicReportDetailPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
    qc
  );
export const list = (qc, ctx, path) =>
  run(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Outlet context={ctx} />}>
          <Route path="/r/:token" element={<PublicReportListPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
    qc
  );
export const map = (qc, props) => run(<ClientReportMap {...props} />, qc);
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
          b.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'css-stub' }));
          b.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: '', loader: 'js' }));
          b.onResolve({ filter: /mapboxInit\.js$/ }, () => ({ path: join(dir, 'mapboxStub.js') }));
          // The hub page's <Navigate> is recorded; every other import of the router is the real one.
          b.onResolve({ filter: /^react-router-dom$/ }, (a) =>
            /PublicReportListPage\.jsx$/.test(a.importer) ? { path: join(dir, 'routerShim.js') } : undefined
          );
          // Only these files' own effects are recorded; everything they import keeps the real ones.
          b.onResolve({ filter: /^react$/ }, (a) =>
            /(PublicReportLayout|PublicReportDetailPage|ClientReportMap)\.jsx$/.test(a.importer) ? { path: join(dir, 'reactShim.js') } : undefined
          );
        },
      },
    ],
  });
  return import(pathToFileURL(out).href);
};
const m = await build();

const runAll = (effects) => effects.map((fn) => fn()).filter((c) => typeof c === 'function');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  calls = [];
  route = () => ({ status: 200, body: {} });
  head.children.length = 0;
  document.title = 'Doorline';
  blobUrls.made.length = 0;
  blobUrls.revoked.length = 0;
});

test('the layout\'s effects: title and noindex handed back, logo by header and revoked, storage listener removed', async () => {
  sessionStorage.setItem('doorline.share.TA', 'jwt-a');
  route = (url) => (url === '/api/share/TA/logo' ? { status: 200, blob: new Blob(['png-bytes'], { type: 'image/png' }) } : { status: 200, body: {} });
  const qc = m.newQc();
  qc.setQueryData(['share-meta', 'TA'], { requiresPassword: true });
  qc.setQueryData(['share', 'TA', 'jwt-a', 'reports'], { campaignName: 'Fall 2026', orgName: 'Fox Bryant', hasLogo: true, reports: [] });
  const { html, effects } = m.layout(qc, '/r/TA');
  assert.match(html, /Fall 2026/);
  assert.ok(effects.length >= 6, `the layout's effects were recorded: ${effects.length}`);
  const cleanups = runAll(effects); // a throw here is a crash on mount
  assert.equal(document.title, 'Fall 2026 · Reports');
  assert.equal(head.children.filter((t) => t.name === 'robots' && t.content === 'noindex, nofollow').length, 1);
  assert.equal(listeners.storage.size, 1);
  const logoCall = calls.find((c) => c.url === '/api/share/TA/logo');
  assert.ok(logoCall, 'the logo was fetched');
  assert.equal(logoCall.init.headers['X-Share-Token'], 'jwt-a', 'the token rides a header');
  assert.doesNotMatch(logoCall.url, /jwt-a/, 'never the URL');
  await tick();
  assert.equal(blobUrls.made.length, 1, 'shown as a blob URL');

  cleanups.forEach((c) => c());
  assert.equal(document.title, 'Doorline', 'the title is handed back');
  assert.equal(head.children.length, 0, 'the meta is removed');
  assert.equal(listeners.storage.size, 0);
  assert.deepEqual(blobUrls.revoked, blobUrls.made, 'the blob URL is revoked');
  assert.equal(logoCall.init.signal.aborted, true);
});

test('a legacy open link is unlocked on mount, with no password', async () => {
  route = (url) => (url === '/api/share/TB/unlock' ? { status: 200, body: { accessToken: 'jwt-b' } } : { status: 200, body: {} });
  const qc = m.newQc();
  qc.setQueryData(['share-meta', 'TB'], { requiresPassword: false });
  const { html, effects } = m.layout(qc, '/r/TB');
  assert.match(html, /Loading…/);
  runAll(effects);
  await tick();
  const unlock = calls.find((c) => c.url === '/api/share/TB/unlock');
  assert.deepEqual(unlock.body, { remember: false });
  assert.equal(sessionStorage.getItem('doorline.share.TB'), 'jwt-b');
  assert.equal(m.getShareSession('TB').getSnapshot().accessToken, 'jwt-b');
});

test('keep me signed in, the one error handler, and sign out — through the layout\'s own store', async () => {
  const qc = m.newQc();
  qc.setQueryData(['share-meta', 'TC'], { requiresPassword: true });
  let r = m.layout(qc, '/r/TC');
  assert.match(r.html, /A report has been shared with you\./);
  assert.doesNotMatch(r.html, /Fall 2026/);
  const session = m.getShareSession('TC');

  // Keep me signed in → localStorage; the header names the campaign.
  route = (url) => (url.endsWith('/unlock') ? { status: 200, body: { accessToken: 'jwt-c' } } : { status: 200, body: {} });
  await session.unlock({ password: 'correct horse battery', remember: true });
  assert.equal(localStorage.getItem('doorline.share.TC'), 'jwt-c');
  assert.equal(sessionStorage.getItem('doorline.share.TC'), null);
  qc.setQueryData(['share', 'TC', 'jwt-c', 'reports'], { campaignName: 'Fall 2026', orgName: 'Fox Bryant', hasLogo: false, reports: [] });
  r = m.layout(qc, '/r/TC');
  assert.match(r.html, /Fall 2026/);
  assert.match(r.html, /Sign out on this device/);

  // A 401 on any share read: the token goes, the gate says it may have changed, the cache forgets.
  route = () => ({ status: 401, body: { error: 'Password required', code: 'password-required' } });
  await assert.rejects(session.get('/reports'));
  r = m.layout(qc, '/r/TC');
  assert.match(r.html, /it may have changed/);
  assert.equal(localStorage.getItem('doorline.share.TC'), null);
  runAll(r.effects);
  assert.equal(qc.getQueryData(['share', 'TC', 'jwt-c', 'reports']), undefined, 'what was read with the dropped token is forgotten');
  assert.equal(qc.getQueryState(['share-meta', 'TC']).isInvalidated, true, 'and the link is asked again');

  // Sign out on this device.
  route = (url) => (url.endsWith('/unlock') ? { status: 200, body: { accessToken: 'jwt-c2' } } : { status: 200, body: {} });
  await session.unlock({ password: 'correct horse battery', remember: false });
  assert.equal(sessionStorage.getItem('doorline.share.TC'), 'jwt-c2');
  session.signOut();
  r = m.layout(qc, '/r/TC');
  assert.match(r.html, /You&#x27;ve signed out on this device\./);
  assert.equal(sessionStorage.getItem('doorline.share.TC'), null);
  assert.equal(localStorage.getItem('doorline.share.TC'), null);

  // A link that was replaced: the page says so.
  await session.unlock({ password: 'correct horse battery', remember: true });
  route = () => ({ status: 404, body: { error: 'This report link is not available.', code: 'SHARE_NOT_FOUND' } });
  await assert.rejects(session.get('/reports/abc'));
  r = m.layout(qc, '/r/TC');
  assert.match(r.html, /This link isn&#x27;t available\./);
  assert.equal(localStorage.getItem('doorline.share.TC'), null);
});

const report = {
  id: 'r1',
  campaignType: 'survey',
  weekStart: '2026-10-13',
  weekEnd: '2026-10-19',
  publishedOn: '2026-10-20',
  scope: { kind: 'campaign', label: 'Whole campaign', seriesKey: 'kC' },
  visibility: { showMap: false },
  nav: { olderId: null, newerId: null },
  observations: [],
  stats: { cumulative: { totals: { doorsKnocked: 10 }, contactBreakdown: {}, surveyBreakdowns: [] }, period: { totals: { doorsKnocked: 2 } } },
};

test('the report page pings "opened" once per day, naming a Doorline sign-in if there is one', async () => {
  localStorage.setItem('canvass.token', 'console-jwt');
  const qc = m.newQc();
  qc.setQueryData(['share', 'TD', 'jwt-d', 'report', 'r1'], { report, survey: { questions: [] } });
  const ctx = { token: 'TD', accessToken: 'jwt-d', session: { get: () => new Promise(() => {}), handleError: () => ({}) }, hub: null, logo: { url: null, blob: null } };
  route = () => ({ status: 204, body: null });
  let r = m.detail(qc, ctx, '/r/TD/reports/r1');
  assert.match(r.html, /Week of/);
  const cleanups = runAll(r.effects);
  const ping = calls.find((c) => c.url === '/api/share/TD/reports/r1/opened');
  assert.ok(ping, 'pinged');
  assert.equal(ping.init.method, 'POST');
  assert.equal(ping.init.headers['X-Share-Token'], 'jwt-d');
  assert.equal(ping.init.headers.Authorization, 'Bearer console-jwt');
  assert.equal(ping.init.headers['X-Org-Id'], undefined);
  await tick();
  assert.match(localStorage.getItem('doorline.share.opened.TD'), /"reports":\["r1"\]/);
  cleanups.forEach((c) => c());
  assert.equal(ping.init.signal.aborted, true, 'the cleanup aborts it');

  calls = [];
  r = m.detail(qc, ctx, '/r/TD/reports/r1');
  runAll(r.effects);
  assert.equal(calls.filter((c) => c.url.endsWith('/opened')).length, 0, 'not again today');
});

test('the map: its phone listener comes and goes, and a "no map" answer reaches the page', () => {
  const qc = m.newQc();
  qc.setQueryData(['mapbox-token', '/share/TE/mapbox-token', 'jwt-e'], { isReady: true, token: 'pk.test' });
  const err = Object.assign(new Error('This report has no map.'), { status: 404, code: 'MAP_NOT_SHARED' });
  const q = qc.getQueryCache().build(qc, { queryKey: ['client-report-map', '/share/TE/reports/r1/map', 'jwt-e', 'v1'] });
  q.setState({ status: 'error', error: err, fetchStatus: 'idle', data: undefined });
  const heard = [];
  const props = {
    mapPath: '/share/TE/reports/r1/map',
    tokenPath: '/share/TE/mapbox-token',
    mapVersion: 'v1',
    requestOpts: { public: true, shareToken: 'jwt-e' },
    onError: (e) => heard.push(e.code),
  };
  const r = m.map(qc, props);
  assert.match(r.html, /This report has no map\./);
  const cleanups = runAll(r.effects);
  assert.deepEqual(heard, ['MAP_NOT_SHARED']);
  assert.equal(mq.handlers.size, 1, 'listening for the phone breakpoint');
  cleanups.forEach((c) => c());
  assert.equal(mq.handlers.size, 0, 'and not after');

  q.setState({ status: 'error', error: Object.assign(new Error('updated'), { status: 409, code: 'MAP_UPDATED' }) });
  assert.match(m.map(qc, props).html, /This report was just updated — reload\.[\s\S]*Reload/);
});

test('the map on a phone: two-finger panning from the start, filters behind a button', () => {
  mq.matches = true;
  try {
    const qc = m.newQc();
    qc.setQueryData(['mapbox-token', '/admin/config/mapbox-token', null], { isReady: true, token: 'pk.test' });
    qc.setQueryData(['client-report-map', '/admin/client-reports/r1/preview/map', null, null], {
      mode: 'pins',
      snapshotKey: 'k',
      statusKeys: ['surveyed'],
      lng: [-84.3],
      lat: [33.7],
      status: [0],
      questions: [],
      answers: {},
      extent: null,
    });
    const r = m.map(qc, { mapPath: '/admin/client-reports/r1/preview/map', campaignType: 'survey' });
    assert.match(r.html, /1 of 1 doors/);
    assert.match(r.html, /Filters/);
    assert.doesNotMatch(r.html, /<aside/, 'no side column on a phone');
    assert.match(r.html, /height:60vh/);
  } finally {
    mq.matches = false;
  }
});

// ── A link to one report (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D) ───────────────────────────
const hubRow = { id: 'r9', title: '', weekStart: '2026-10-19', weekEnd: '2026-10-25', scope: { kind: 'campaign', label: 'Whole campaign', seriesKey: 'kC' }, headline: { cumulative: { doorsKnocked: 10 }, period: { doorsKnocked: 2 } } };
const singleHub = (extra = {}) => ({ campaignName: 'Fall 2026', orgName: 'Fox Bryant', hasLogo: false, single: true, reportId: 'r9', gone: false, reports: [hubRow], ...extra });
const listCtx = (hub) => ({ token: 'TS', hub, hubQ: { data: hub, isLoading: false, error: null, refetch() {} } });

test('a link to one report: the browser tab says “Report”; a link to all your reports keeps “Reports”', () => {
  sessionStorage.setItem('doorline.share.TT', 'jwt-t');
  const qc = m.newQc();
  qc.setQueryData(['share-meta', 'TT'], { requiresPassword: true });
  qc.setQueryData(['share', 'TT', 'jwt-t', 'reports'], singleHub());
  let cleanups = runAll(m.layout(qc, '/r/TT').effects);
  assert.equal(document.title, 'Fall 2026 · Report');
  cleanups.forEach((c) => c());
  assert.equal(document.title, 'Doorline', 'handed back');
  qc.setQueryData(['share', 'TT', 'jwt-t', 'reports'], { ...singleHub(), single: false, reportId: undefined, gone: undefined });
  cleanups = runAll(m.layout(qc, '/r/TT').effects);
  assert.equal(document.title, 'Fall 2026 · Reports');
  cleanups.forEach((c) => c());
});

test('a link to one report: the hub page opens its report in its place, replacing itself in the history', () => {
  const qc = m.newQc();
  let r = m.list(qc, listCtx(singleHub()), '/r/TS');
  assert.equal(r.html, '');
  assert.deepEqual(r.navigates, [{ replace: true, to: '/r/TS/reports/r9' }]);
  // Taken down or removed: it says so and goes nowhere.
  r = m.list(qc, listCtx(singleHub({ gone: true, reports: [] })), '/r/TS');
  assert.deepEqual(r.navigates, []);
  assert.match(r.html, /This report was taken down or removed\. Ask the person who sent it\./);
  // A link to all your reports stays on its hub.
  const all = { campaignName: 'Fall 2026', orgName: 'Fox Bryant', hasLogo: false, single: false, reports: [hubRow] };
  r = m.list(qc, listCtx(all), '/r/TS');
  assert.deepEqual(r.navigates, []);
  assert.match(r.html, /Latest · Oct 19 – Oct 25, 2026 · Whole campaign/);
});

test('a link to one report: a report gone sends the hub to be read again; a shown one pings "opened" as on any link', async () => {
  const session = { get: () => new Promise(() => {}), handleError: () => ({}) };
  const ctx = (hub) => ({ token: 'TS', accessToken: 'jwt-s', session, hub, hubQ: { data: hub, isLoading: false, error: null }, logo: { url: null, blob: null } });

  const qc = m.newQc();
  qc.setQueryData(['share', 'TS', 'jwt-s', 'reports'], singleHub());
  const err = Object.assign(new Error('This report was taken down or removed.'), { status: 404, code: 'REPORT_NOT_FOUND' });
  qc.getQueryCache().build(qc, { queryKey: ['share', 'TS', 'jwt-s', 'report', 'r9'] }).setState({ status: 'error', error: err, fetchStatus: 'idle', data: undefined });
  let r = m.detail(qc, ctx(singleHub()), '/r/TS/reports/r9');
  assert.match(r.html, /This report was taken down or removed\. Ask the person who sent it\./);
  assert.doesNotMatch(r.html, /see all reports/);
  runAll(r.effects);
  assert.equal(qc.getQueryState(['share', 'TS', 'jwt-s', 'reports']).isInvalidated, true, 'the hub is asked again, and learns `gone`');

  const shown = m.newQc();
  shown.setQueryData(['share', 'TS', 'jwt-s', 'report', 'r9'], { report: { ...report, id: 'r9', nav: null }, survey: { questions: [] }, single: true });
  route = () => ({ status: 204, body: null });
  r = m.detail(shown, ctx(singleHub()), '/r/TS/reports/r9');
  assert.match(r.html, /This link opens this report only\./);
  const cleanups = runAll(r.effects);
  const ping = calls.find((c) => c.url === '/api/share/TS/reports/r9/opened');
  assert.ok(ping, 'pinged');
  assert.equal(ping.init.headers['X-Share-Token'], 'jwt-s');
  await tick();
  cleanups.forEach((c) => c());
  assert.equal(ping.init.signal.aborted, true, 'the cleanup aborts it');
});
