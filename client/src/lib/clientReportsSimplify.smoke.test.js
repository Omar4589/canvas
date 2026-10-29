import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import { formatDayOf, todayIn } from '../components/clientReports/reportDates.js';

// The Client Reports "simpler start", clicked through (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §B–§E):
// the guide (Got it, How it works, storage that fails, the phone lines), New report's dated choices with
// the organization's week (Change, the nudge, Move this tab, admins and leads), the duplicate prompt and
// the race note, and the list page's own wiring: Next refused NEXT_GAP_TOO_LONG and the ?new=1 link
// (contract K10). Since docs/PROPOSAL_CLIENT_REPORT_LINKS.md (one link per report, Archive): the
// duplicate prompt's archived report with Unarchive, and the list page's Archived (N) fold — the newest of
// each kind never folded, gap lines over every report, Archive's line with Undo — its row link line, what
// it hands Share and the old-links card, and the Take down / Delete confirms. Share and the old-links card
// are their own components' to test (C1's suites): here they are stand-ins that record what the page
// hands them.
//
// renderToString renders once and runs no effect, so — the clientReportBuilderEffects pattern, taken one
// step further — the modules under test get their own hooks: state and refs that outlive one render (the
// next render is the same screen a moment later), effects recorded for the test to run, every handler
// recorded with its words (a test "clicks" by the words on the button), and every mutation recorded so a
// test can answer the request and render again.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-cr-simplify-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const CID = '6a0000000000000000000001';
const C = (f) => join(here, '../components/clientReports', f);
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
// The modules whose hooks the harness holds, by file name → their store. Their handlers are recorded
// too, and so are those of the row and the shared confirm (their own hooks stay React's).
const SHIMMED = { 'ClientReportsPage.jsx': 'page', 'NewReportDialog.jsx': 'newReport', 'HowItWorks.jsx': 'guide' };
const HANDLERS_ONLY = new Set(['ReportRow.jsx', 'parts.jsx']);

const storeOf = (name) => `const st = () => {
  const h = globalThis.__h;
  return h.stores[${JSON.stringify(name)}] || (h.stores[${JSON.stringify(name)}] = { slots: [], i: 0, mutations: [], mi: 0 });
};`;
const reactShim = (name) => `export * from 'react';
import * as R from 'react';
export default R;
${storeOf(name)}
export const useState = (init) => {
  const s = st();
  const i = s.i++;
  if (!(i in s.slots)) s.slots[i] = typeof init === 'function' ? init() : init;
  return [s.slots[i], (v) => { s.slots[i] = typeof v === 'function' ? v(s.slots[i]) : v; }];
};
export const useRef = (init) => {
  const s = st();
  const i = s.i++;
  if (!(i in s.slots)) s.slots[i] = { current: init };
  return s.slots[i];
};
export const useMemo = (fn) => fn();
export const useCallback = (fn) => fn;
export const useEffect = (fn) => { globalThis.__h.effects.push({ module: ${JSON.stringify(name)}, fn }); };`;
const queryShim = (name) => `export * from '@tanstack/react-query';
${storeOf(name)}
export const useMutation = (opts) => {
  const s = st();
  const i = s.mi++;
  const m = s.mutations[i] || (s.mutations[i] = { calls: [], isPending: false, error: null, variables: undefined });
  m.opts = opts;
  return {
    isPending: m.isPending,
    error: m.error,
    variables: m.variables,
    mutate: (variables, callbacks) => {
      m.calls.push({ variables, callbacks });
      Object.assign(m, { isPending: true, error: null, variables });
      globalThis.__h.last = m;
    },
    reset: () => Object.assign(m, { isPending: false, error: null }),
  };
};`;
// Every element with a handler (any on… function), with its words; a label (or any wrapper) names the
// input inside it.
const jsxShim = `export * from 'react/jsx-runtime';
import * as J from 'react/jsx-runtime';
const seen = new WeakMap();
const words = (c) => (c == null || typeof c === 'boolean' ? '' : Array.isArray(c) ? c.map(words).join('') : typeof c === 'object' ? words(c.props?.children) : String(c));
const squash = (t) => t.replace(/\\s+/g, ' ').trim();
const kids = (c) => (Array.isArray(c) ? c.flatMap(kids) : c && typeof c === 'object' ? [c] : []);
const record = (type, props, el) => {
  const h = globalThis.__h;
  if (!h || !props) return el;
  if (Object.keys(props).some((k) => /^on[A-Z]/.test(k) && typeof props[k] === 'function')) {
    const r = { type: typeof type === 'string' ? type : type.name || 'component', props, text: squash(words(props.children)), label: '' };
    h.handlers.push(r);
    seen.set(el, r);
  }
  for (const k of kids(props.children)) {
    const r = seen.get(k);
    if (r && !r.label) r.label = squash(words(props.children));
  }
  return el;
};
export const jsx = (type, props, key) => record(type, props, J.jsx(type, props, key));
export const jsxs = (type, props, key) => record(type, props, J.jsxs(type, props, key));`;
// The list page's router: where it navigates, and its search params, held by the harness.
const routerShim = `export * from 'react-router-dom';
export const useNavigate = () => (to, opts) => globalThis.__h.navigations.push({ to, opts: opts || null });
export const useSearchParams = () => {
  const h = globalThis.__h;
  const set = (next, opts) => {
    const v = typeof next === 'function' ? next(new URLSearchParams(h.search)) : next;
    h.search = new URLSearchParams(v).toString();
    h.setParams.push({ search: h.search, opts: opts || null });
  };
  return [new URLSearchParams(h.search), set];
};`;

let mod;
const load = async () => {
  if (mod) return mod;
  for (const name of Object.values(SHIMMED)) {
    writeFileSync(join(dir, `react-${name}.js`), reactShim(name));
    writeFileSync(join(dir, `query-${name}.js`), queryShim(name));
  }
  writeFileSync(join(dir, 'jsx.js'), jsxShim);
  writeFileSync(join(dir, 'router.js'), routerShim);
  writeFileSync(join(dir, 'auth.jsx'), `export const useAuth = () => globalThis.__h.auth;`);
  writeFileSync(join(dir, 'portal.js'), `export * from 'react-dom';\nexport const createPortal = (children) => children;`);
  // Share and the old-links card, as the page hands them their props (their own suites test them).
  writeFileSync(join(dir, 'shareStub.jsx'), `const ShareDialog = (props) => { globalThis.__h.shareProps.push(props); return <div data-share-stub="">Share dialog</div>; };\nexport default ShareDialog;`);
  writeFileSync(join(dir, 'retiredStub.jsx'), `const RetiredLinksCard = (props) => { globalThis.__h.retiredProps.push(props); return <div data-retired-stub="">Old links card</div>; };\nexport default RetiredLinksCard;`);
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientReportsPage from '${join(here, '../pages/ClientReportsPage.jsx')}';
import NewReportDialog from '${C('NewReportDialog.jsx')}';
import HowItWorks from '${C('HowItWorks.jsx')}';

// The browser, as far as these screens reach it. Storage can be made to fail (a private window).
const store = new Map();
const guard = () => { if (globalThis.__h?.storageBroken) throw new Error('SecurityError: storage is blocked'); };
globalThis.localStorage = {
  getItem: (k) => { guard(); return store.has(k) ? store.get(k) : null; },
  setItem: (k, v) => { guard(); store.set(k, String(v)); },
  removeItem: (k) => { guard(); store.delete(k); },
};
export const storage = store;
globalThis.window = { location: { origin: 'https://doorline.app', pathname: '/' }, addEventListener() {}, removeEventListener() {} };
globalThis.document = { body: { style: {} }, activeElement: null, addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (t) => { globalThis.__h.copied.push(t); } } } });
globalThis.fetch = (url, init = {}) => {
  globalThis.__h.fetches.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
  return new Promise(() => {});
};

// A new screen: nothing held, nothing recorded.
export const fresh = ({ search = '', auth = { isOrgAdmin: true, user: { id: 'u1' } }, storageBroken = false } = {}) => {
  globalThis.__h = { stores: {}, effects: [], handlers: [], last: null, fetches: [], copied: [], navigations: [], setParams: [], shareProps: [], retiredProps: [], search, auth, storageBroken };
  return globalThis.__h;
};
export const h = () => globalThis.__h;
let current = null;
export const rerender = () => {
  const s = globalThis.__h;
  for (const st of Object.values(s.stores)) {
    st.i = 0;
    st.mi = 0;
  }
  s.effects = [];
  s.handlers = [];
  return renderToString(current());
};
const show = (el) => {
  current = el;
  return rerender();
};
export const newQc = (seed = []) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  for (const [k, v] of seed) qc.setQueryData(k, v);
  return qc;
};
const wrap = (qc, el, path = '/') => <QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>{el}</MemoryRouter></QueryClientProvider>;
export const page = (qc) => show(() => wrap(qc, <Routes><Route path="/campaigns/:campaignId/reports" element={<ClientReportsPage />} /></Routes>, '/campaigns/${CID}/reports'));
// New report reads the series picker again as it opens (code review WEEK-1) and shows its dates only
// from an answer that came after: its first screen waits, then \`seriesData\` lands as that answer —
// unless the test holds it (\`hold\`) to look at the wait.
export const newReport = ({ hold = false, ...props }, qc = newQc()) => {
  const html = show(() => wrap(qc, <NewReportDialog campaignId="${CID}" campaignTz="America/New_York" reports={[]} efforts={[]} onClose={() => {}} onCreated={() => {}} onNewTeam={() => {}} onContinueTeam={() => {}} {...props} />));
  if (hold || !props.seriesData) return html;
  qc.setQueryData(['admin', 'client-report-series', '${CID}'], props.seriesData);
  return rerender();
};
export const guide = (props) => show(() => wrap(newQc(), <HowItWorks onDismiss={() => {}} {...props} />));
`
  );
  const out = join(dir, 'bundle.mjs');
  const fileOf = (importer) => String(importer).split(/[\\/]/).pop();
  const nameOf = (importer) => SHIMMED[fileOf(importer)] || null;
  const recorded = (importer) => !!nameOf(importer) || HANDLERS_ONLY.has(fileOf(importer));
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
        name: 'harness',
        setup(b) {
          b.onResolve({ filter: /^react$/ }, (a) => (nameOf(a.importer) ? { path: join(dir, `react-${nameOf(a.importer)}.js`) } : undefined));
          b.onResolve({ filter: /^react\/jsx-runtime$/ }, (a) => (recorded(a.importer) ? { path: join(dir, 'jsx.js') } : undefined));
          b.onResolve({ filter: /^@tanstack\/react-query$/ }, (a) => (nameOf(a.importer) ? { path: join(dir, `query-${nameOf(a.importer)}.js`) } : undefined));
          b.onResolve({ filter: /^react-router-dom$/ }, (a) => (nameOf(a.importer) === 'page' ? { path: join(dir, 'router.js') } : undefined));
          b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'auth.jsx') }));
          b.onResolve({ filter: /clientReports\/ShareDialog\.jsx$/ }, () => ({ path: join(dir, 'shareStub.jsx') }));
          b.onResolve({ filter: /clientReports\/RetiredLinksCard\.jsx$/ }, () => ({ path: join(dir, 'retiredStub.jsx') }));
          // Overlay and Popover portal into document.body; render them in place for the server renderer.
          b.onResolve({ filter: /^react-dom$/ }, (a) => (/Overlay\.jsx$|Popover\.jsx$/.test(a.importer) ? { path: join(dir, 'portal.js') } : undefined));
        },
      },
    ],
  });
  mod = await import(pathToFileURL(out).href);
  return mod;
};

// ── Reading and driving a screen ──────────────────────────────────────────────────────────────────
// renderToString escapes quotes; read the text the way a person would.
const text = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
// The line above New report's date choices (SIMPLIFY §M), as a whole-campaign tab reads it; the example
// follows the dates picked, in the client's cards' words.
const TOTALS_LINE = (phrase = 'this week') =>
  `Your report shows totals for the whole campaign, from its first door through the last day you pick. The first day only decides what shows as new, like “+412 ${phrase}”.`;
const handlerFor = (m, pick, what) => {
  const r = m.h().handlers.filter(pick).pop();
  assert.ok(r, `${what} on the screen`);
  return r;
};
/** Presses the button (or link) whose words are `words` — never a disabled one — then renders the screen again. */
const click = (m, words) => {
  const r = handlerFor(m, (x) => x.props.onClick && x.text === words, `a “${words}” button`);
  assert.ok(!r.props.disabled && !r.props.loading, `“${words}” can be pressed`);
  r.props.onClick({ preventDefault() {}, stopPropagation() {} });
  return m.rerender();
};
/** Calls a handler a component was handed (`ReportRow`'s onTakeDown, say) — a menu the server render keeps closed. */
const handed = (m, component, prop, ...args) => {
  handlerFor(m, (x) => x.type.startsWith(component) && typeof x.props[prop] === 'function', `a ${component} with ${prop}`).props[prop](...args);
  return m.rerender();
};
/** Picks the radio whose label starts with `words`. */
const choose = (m, words) => {
  handlerFor(m, (x) => x.props.onChange && x.props.type === 'radio' && x.label.startsWith(words), `a radio “${words}…”`).props.onChange({ target: { checked: true } });
  return m.rerender();
};
/** Types into the field with this placeholder or aria-label. */
const fill = (m, name, value) => {
  handlerFor(m, (x) => x.props.onChange && (x.props.placeholder === name || x.props['aria-label'] === name), `a field “${name}”`).props.onChange({ target: { value } });
  return m.rerender();
};
/** Answers the request the last press made (an Error refuses it), and renders again. */
const settle = async (m, outcome) => {
  const req = m.h().last;
  assert.ok(req, 'a request was made');
  const { variables, callbacks } = req.calls[req.calls.length - 1];
  req.isPending = false;
  if (outcome instanceof Error) {
    req.error = outcome;
    req.opts.onError?.(outcome, variables);
    callbacks?.onError?.(outcome, variables);
  } else {
    await req.opts.onSuccess?.(outcome, variables);
    await callbacks?.onSuccess?.(outcome, variables);
  }
  return m.rerender();
};
const refusal = (code, data = {}) => Object.assign(new Error(data.error || code), { code, status: 409, data: { code, ...data } });
// The <input type="radio"> tags of one group, and which is ticked.
const ticks = (html, name) => [...html.matchAll(new RegExp(`<input type="radio" name="${name}"[^>]*>`, 'g'))].map((x) => /\schecked=""/.test(x[0]));
const disabledButton = (html, words) => {
  const at = html.indexOf(`>${words}</button>`);
  assert.ok(at > -1, `a “${words}” button`);
  const tag = html.slice(html.lastIndexOf('<button', at), html.indexOf('>', html.lastIndexOf('<button', at)) + 1);
  return /\sdisabled=""/.test(tag);
};

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────────
const NOW = Date.now();
const link = (over = {}) => ({
  id: 'l1',
  campaignId: CID,
  token: 'tokCandidate1',
  label: 'Candidate',
  isActive: true,
  hasPassword: true,
  expiresAt: iso(NOW + 60 * DAY),
  lifetimeEndsAt: iso(NOW + 300 * DAY),
  passwordMeetsRule: true,
  lock: { locked: false, until: null },
  failures: { last24h: 0, last7d: 0, total: 0 },
  reportId: null,
  report: null,
  ...over,
});
const R1 = { id: 'r1', weekStart: '2026-10-19', weekEnd: '2026-10-25', scopeLabel: 'Whole campaign', takenDown: false, seriesId: 'sc' };
// `link()` is an old link to all your reports (reportId null); a report's own link has no label (§C2).
const ownLink = (over = {}) => link({ id: 'o1', token: 'tokOwn0000001', label: '', reportId: 'r1', report: R1, createdAt: iso(NOW - DAY), ...over });
const elsewhere = link({ id: 'd2', token: 'tokDonor00002', label: '', reportId: 'r0', report: { id: 'r0', weekStart: '2026-10-12', weekEnd: '2026-10-18', scopeLabel: 'Whole campaign', takenDown: false, seriesId: 'sc' } });
const picker = (over = {}) => ({
  teamsReady: true,
  weekStartsOn: 1,
  today: '2026-10-26', // a Monday
  knockedBeforeThisWeek: true,
  series: [{ id: 'sc', kind: 'campaign', label: 'Whole campaign', ended: false }],
  crews: [],
  formerCrews: [],
  noCrewCanvassers: 0,
  ...over,
});
const row = (over = {}) => ({
  id: 'r1',
  campaignId: CID,
  campaignType: 'survey',
  seriesId: 'sc',
  seriesKey: 'sc',
  seriesLabel: 'Whole campaign',
  scope: { kind: 'campaign', label: 'Whole campaign' },
  weekStart: '2026-10-19',
  weekEnd: '2026-10-25',
  timeZone: 'America/New_York',
  status: 'published',
  takenDownAt: null,
  hasSnapshot: true,
  publishedAt: '2026-10-26T14:00:00Z',
  build: { status: 'idle' },
  headline: { cumulative: { doorsKnocked: 3412, surveysTaken: 1980 }, period: { doorsKnocked: 412, surveysTaken: 260 } },
  ...over,
});
// `series: null`: the series picker hasn't answered yet; `shares: null`: nor the links list (contract K1:
// the rows, the switch for old links to all your reports, and whether this is staff under a grant).
const pageQc = (m, { reports = [row()], shares = [], series = picker(), allReportsRetired = false, staffUnderGrant = false } = {}) =>
  m.newQc([
    [['admin', 'campaigns'], { campaigns: [{ _id: CID, name: 'Ward 3', type: 'survey', isActive: true, timeZone: 'America/New_York' }] }],
    [['admin', 'client-reports', CID], { reports }],
    ...(series ? [[['admin', 'client-report-series', CID], series]] : []),
    ...(shares ? [[['admin', 'client-report-shares', CID], { shares, allReportsRetired, staffUnderGrant }]] : []),
    [['admin', 'efforts', CID], { efforts: [] }],
    [['admin', 'branding'], { hasLogo: false }],
  ]);
const GUIDE_KEY = 'doorline.clientReports.howItWorks.u1';
const SERIES_KEY = ['admin', 'client-report-series', CID];
// New report, opened from the page, reads the series picker again (WEEK-1): its answer arrives.
const landPicker = (m, qc, data = picker()) => {
  qc.setQueryData(SERIES_KEY, data);
  return m.rerender();
};

// ── The guide (§B) ────────────────────────────────────────────────────────────────────────────────

test('the guide: the header line ends in How it works; the guide sits above the tabs until Got it, which this person’s browser keeps', async () => {
  const m = await load();
  m.storage.clear();
  m.fresh();
  const qc = pageQc(m);
  let html = m.page(qc);
  let t = text(html);
  assert.ok(
    t.includes('Make reports for your client here. Each one shows the campaign’s running totals and what was added in the dates you pick. Share it with a link and its password, or download a PDF. How it works'),
    'the one-line description, ending in How it works'
  );
  assert.ok(html.indexOf('How client reports work') < html.indexOf('role="tablist"'), 'the guide sits above the tabs');
  // Step 3 since one link per report (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §D6): Share makes the link, and the
  // password carries over week to week.
  for (const s of [
    'Make a report — press New report and pick the dates, usually Last week.',
    'Check it, then publish — the preview is exactly what your client will see.',
    'Share it — Share makes the report’s link and a message to paste into your email or text. Next week’s link keeps this week’s password, so you send a password only the first time, or after you change it. Or open the report and press Download PDF.',
  ]) {
    assert.ok(t.includes(s), s);
  }
  assert.ok(html.includes('href="/help/client-reports"') && t.includes('More in the Help Center →'), 'the Help Center’s guide');
  // Below 640 px: the short lines, and no Help line (the Help link and the long steps hide there).
  assert.match(html, /<ol class="[^"]*sm:hidden[^"]*"><li>Make a report — usually Last week; then Next report each week\.<\/li><li>Check the preview, then publish\.<\/li><li>Share its link; send the password the first time\.<\/li><\/ol>/);
  assert.match(html, /<ol class="[^"]*hidden[^"]*sm:block[^"]*"><li>/);
  assert.match(html, /<a class="hidden [^"]*sm:inline[^"]*" href="\/help\/client-reports">/);
  // Got it: gone, and kept in this browser, per person — the next visit doesn't show it either.
  t = text(click(m, 'Got it'));
  assert.ok(!t.includes('How client reports work'));
  assert.equal(m.storage.get(GUIDE_KEY), '1');
  m.fresh();
  assert.ok(!text(m.page(pageQc(m))).includes('How client reports work'), 'a new visit remembers');
  m.fresh({ auth: { isOrgAdmin: true, user: { id: 'u2' } } });
  assert.ok(text(m.page(pageQc(m))).includes('How client reports work'), 'another person sees it');
  // How it works brings it back, and keeps it until Got it again.
  m.fresh();
  m.page(pageQc(m));
  t = text(click(m, 'How it works'));
  assert.ok(t.includes('How client reports work'));
  assert.equal(m.storage.has(GUIDE_KEY), false);
  // Its focus effect runs (bringing the guide into view) and leaves nothing behind.
  for (const e of m.h().effects.filter((x) => x.module === 'guide')) assert.equal(typeof e.fn(), 'undefined');
});

test('the guide: storage that can’t be read or written shows it, and Got it still hides it for this visit; an empty page shows it instead of “No reports yet”', async () => {
  const m = await load();
  m.storage.clear();
  m.fresh({ storageBroken: true });
  let t = text(m.page(pageQc(m, { reports: [] })));
  assert.ok(t.includes('How client reports work'), 'shown when storage throws');
  assert.ok(!t.includes('No reports yet.'), 'on an empty page the guide stands where “No reports yet” would');
  t = text(click(m, 'Got it'));
  assert.ok(!t.includes('How client reports work'), 'hidden for this visit, nothing thrown');
  assert.ok(t.includes('No reports yet.'), 'and the empty page says so again');
  m.fresh({ storageBroken: true });
  assert.ok(text(m.page(pageQc(m, { reports: [] }))).includes('How client reports work'), 'a private window simply shows it again');
});

test('the guide alone: brought into view and focused when How it works asks; nothing on first show', async () => {
  const m = await load();
  m.fresh();
  m.guide({ focusAt: 0 });
  const [first] = m.h().effects.filter((x) => x.module === 'guide');
  const calls = [];
  m.h().stores.guide.slots[0].current = { scrollIntoView: (o) => calls.push(['scroll', o]), focus: () => calls.push(['focus']) };
  first.fn();
  assert.deepEqual(calls, [], 'not on its own');
  m.guide({ focusAt: 1 });
  m.h().effects.filter((x) => x.module === 'guide')[0].fn();
  assert.deepEqual(calls, [['scroll', { block: 'nearest' }], ['focus']]);
});

// ── New report (§C, §E) ───────────────────────────────────────────────────────────────────────────

const wedTue = [{ id: 'rw', seriesId: 'sc', weekStart: '2026-10-14', weekEnd: '2026-10-20', status: 'published' }];

test('New report: the dated choices, the first picked; an admin’s week line with Change; a Wednesday tab’s nudge with both ways out', async () => {
  const m = await load();
  m.fresh();
  const html = m.newReport({ seriesData: picker(), reports: wedTue, isAdmin: true });
  const t = text(html);
  // The first choice ends after today: kept, and said right under it — never under Pick dates (WEEK-3).
  assert.ok(
    t.includes(
      `Dates ${TOTALS_LINE()} Oct 21 – Oct 27 — the week after your last report This period isn’t over yet — you can build it now and refresh it later. Latest progress · all time, through today Last week · Oct 19 – Oct 25 This week, not over yet · Oct 26 – Nov 1 — refresh it once the week ends Pick dates`
    ),
    'the choices, in order'
  );
  assert.deepEqual(ticks(html, 'report-dates'), [true, false, false, false, false]);
  assert.equal((t.match(/isn’t over yet/g) || []).length, 1, 'said once');
  assert.ok(t.includes('Your last Whole campaign report ran Wednesday – Tuesday. Your organization’s report weeks run Monday – Sunday.'));
  assert.ok(t.includes('Move this tab to Monday – Sunday weeks') && t.includes('Use Wednesday – Tuesday weeks for the whole organization'));
  assert.ok(!t.includes('Ask an admin'));
  assert.ok(t.includes('Report weeks run Monday – Sunday for your organization. Change'));
});

test('New report: Move this tab picks the catch-up first; Create sends its dates', async () => {
  const m = await load();
  m.fresh();
  m.newReport({ seriesData: picker(), reports: wedTue, isAdmin: true });
  const html = click(m, 'Move this tab to Monday – Sunday weeks');
  const t = text(html);
  assert.ok(t.includes('Oct 21 – Oct 27 — the week after your last report Oct 21 – Oct 25 · 5 days — from the day after your last report to the end of last week, so your next report covers a full Monday – Sunday week Latest progress · all time, through today Last week'));
  assert.deepEqual(ticks(html, 'report-dates'), [false, true, false, false, false, false], 'the catch-up, after the first choice, picked');
  click(m, 'Create draft');
  const req = m.h().last;
  // The request is worked out as Create is pressed, and sent as it was.
  assert.deepEqual(req.calls[0].variables, { campaignId: CID, weekStart: '2026-10-21', weekEnd: '2026-10-25' });
  req.opts.mutationFn(req.calls[0].variables);
  const sent = m.h().fetches.pop();
  assert.equal(sent.url, '/api/admin/client-reports');
  assert.deepEqual(sent.body, { campaignId: CID, weekStart: '2026-10-21', weekEnd: '2026-10-25' });
});

test('New report: an admin uses the tab’s weeks for the whole organization — the nudge goes, the dates follow', async () => {
  const m = await load();
  m.fresh();
  const changed = [];
  m.newReport({ seriesData: picker(), reports: wedTue, isAdmin: true, onWeekChanged: (s) => changed.push(s) });
  click(m, 'Use Wednesday – Tuesday weeks for the whole organization');
  const req = m.h().last;
  assert.equal(req.calls[0].variables, 3);
  req.opts.mutationFn(3);
  assert.deepEqual(m.h().fetches.pop(), { url: '/api/admin/client-reports/settings', method: 'PATCH', body: { weekStartsOn: 3 } });
  const t = text(await settle(m, { weekStartsOn: 3 }));
  assert.deepEqual(changed, [3], 'the page hears of it (every campaign’s picker carries the week)');
  assert.ok(!t.includes('Your last Whole campaign report ran'), 'the tab matches now: no nudge');
  assert.ok(t.includes('Report weeks run Wednesday – Tuesday for your organization. Change'));
  assert.ok(t.includes('Last week · Oct 21 – Oct 27') || t.includes('Oct 21 – Oct 27 — the week after your last report'));
});

test('New report: Change shows the weekday select with what it changes; Save sets the organization’s week, Cancel doesn’t', async () => {
  const m = await load();
  m.fresh();
  m.newReport({ seriesData: picker(), reports: [], isAdmin: true });
  let html = click(m, 'Change');
  let t = text(html);
  assert.ok(t.includes('This sets the dates new reports suggest, for every campaign in your organization. Reports you’ve already made keep their dates.'));
  assert.match(html, /<option value="1" selected="">Monday – Sunday<\/option>/);
  for (const w of ['Tuesday – Monday', 'Wednesday – Tuesday', 'Thursday – Wednesday', 'Friday – Thursday', 'Saturday – Friday', 'Sunday – Saturday']) assert.ok(t.includes(w), w);
  t = text(click(m, 'Cancel'));
  assert.ok(t.includes('Report weeks run Monday – Sunday for your organization. Change') && m.h().last === null, 'Cancel: nothing sent');
  click(m, 'Change');
  fill(m, 'Report weeks run', '0');
  click(m, 'Save');
  assert.equal(m.h().last.calls[0].variables, 0);
  html = await settle(m, { weekStartsOn: 0 });
  t = text(html);
  assert.ok(t.includes('Report weeks run Sunday – Saturday for your organization. Change'));
  assert.ok(t.includes('Last week · Oct 18 – Oct 24'), 'the presets follow the new week');
  // A refusal says so, under the line.
  click(m, 'Change');
  click(m, 'Save');
  assert.ok(text(await settle(m, Object.assign(new Error('Only an organization admin can change this.'), { code: 'FORBIDDEN_ROLE', status: 403 }))).includes('Couldn’t change the report week. Only an organization admin can change this.'));
});

test('New report for a lead: the week is read, never changed; the nudge asks an admin', async () => {
  const m = await load();
  m.fresh({ auth: { isOrgAdmin: false, user: { id: 'u9' } } });
  const t = text(m.newReport({ seriesData: picker(), reports: wedTue, isAdmin: false }));
  assert.ok(t.includes('Report weeks run Monday – Sunday for your organization (set by an admin).'));
  assert.ok(!/\bChange\b/.test(t));
  assert.ok(t.includes('Move this tab to Monday – Sunday weeks'), 'a lead can still move the tab');
  assert.ok(!t.includes('for the whole organization'));
  assert.ok(t.includes('Ask an admin to change the organization’s week, or pick dates.'));
});

test('New report: dates it was opened with pick their choice — or Pick dates with them (Next’s NEXT_GAP_TOO_LONG, contract K10)', async () => {
  const m = await load();
  m.fresh();
  let html = m.newReport({ seriesData: picker(), reports: [], initial: { dates: { weekStart: '2026-10-26', weekEnd: '2026-11-01' } } });
  assert.deepEqual(ticks(html, 'report-dates'), [false, false, true, false], 'This week, the choice with those dates');
  assert.ok(!text(html).includes('This period isn’t over yet'), 'This week says it itself');
  m.fresh();
  html = m.newReport({ seriesData: picker(), reports: [], initial: { dates: { weekStart: '2026-10-05', weekEnd: '2026-10-11' } } });
  assert.deepEqual(ticks(html, 'report-dates'), [false, false, false, true], 'no choice has them: Pick dates');
  assert.ok(html.includes('value="2026-10-05"') && html.includes('value="2026-10-11"') && text(html).includes('7 days'));
  // Pick dates starts from the dates picked a moment ago, and says when they make no sense.
  m.fresh();
  m.newReport({ seriesData: picker(), reports: [] });
  html = choose(m, 'Pick dates');
  assert.ok(html.includes('value="2026-10-19"') && html.includes('value="2026-10-25"'), 'from Last week');
  html = fill(m, 'First day (optional)', '2026-10-30');
  assert.ok(text(html).includes('The first day must be on or before the last day.'));
  assert.equal(disabledButton(html, 'Create draft'), true);
});

test('New report says what the dates decide: totals from the campaign’s first door through the last day picked, for the tab it names (SIMPLIFY §M)', async () => {
  const m = await load();
  m.fresh();
  // The whole campaign, a week: the example in the client's own words, "+412 this week".
  let t = text(m.newReport({ seriesData: picker(), reports: [] }));
  assert.ok(t.includes(`Dates ${TOTALS_LINE()} Last week · Oct 19 – Oct 25`), t);
  // A team (the paid crew): named as its tab reads, its totals since the campaign's first door.
  const paid = { id: 't1', kind: 'team', label: 'Paid team', ended: false, coordinators: [], pastCoordinators: [] };
  const series = [{ id: 'sc', kind: 'campaign', label: 'Whole campaign', ended: false }, paid];
  m.fresh();
  t = text(m.newReport({ seriesData: picker({ series }), reports: [], initial: { teamId: 't1' } }));
  assert.ok(
    t.includes('Dates Your report shows totals for Paid team, from the campaign’s first door through the last day you pick. The first day only decides what shows as new, like “+412 this week”. Last week'),
    t
  );
  // Two weeks picked: the example follows them.
  m.fresh();
  t = text(m.newReport({ seriesData: picker({ series }), reports: [], initial: { teamId: 't1', dates: { weekStart: '2026-10-12', weekEnd: '2026-10-25' } } }));
  assert.ok(t.includes('totals for Paid team, from the campaign’s first door through the last day you pick. The first day only decides what shows as new, like “+412 in these 14 days”.'), t);
  // One walk list on the whole campaign: named by the walk list.
  m.fresh();
  t = text(m.newReport({ seriesData: picker(), reports: [], efforts: [{ _id: 'e1', name: 'Smith Street' }], initial: { effortId: 'e1' } }));
  assert.ok(t.includes('Your report shows totals for Smith Street, from the campaign’s first door through the last day you pick.'), t);
  // A team chosen before there is one: no name to give yet.
  m.fresh();
  t = text(m.newReport({ seriesData: picker(), reports: [], initial: { teamId: 'gone' } }));
  assert.ok(t.includes('No team yet — make one with New team.'), t);
  assert.ok(t.includes('Your report shows totals from the campaign’s first door through the last day you pick.'), t);
});

test('New report: Latest progress (SIMPLIFY §N) — all time through today, or Pick dates with no first day; Create sends only the last day', async () => {
  const m = await load();
  m.fresh();
  let html = m.newReport({ seriesData: picker(), reports: [] });
  // Second, never picked on opening.
  assert.ok(text(html).includes('Last week · Oct 19 – Oct 25 Latest progress · all time, through today This week, not over yet'));
  assert.deepEqual(ticks(html, 'report-dates'), [true, false, false, false]);
  html = choose(m, 'Latest progress');
  let t = text(html);
  assert.ok(t.includes('Your report shows totals for the whole campaign, from its first door through today, with no “+412 this week” figures.'), t);
  assert.ok(!t.includes('isn’t over yet'), 'its label says “through today” itself');
  assert.ok(html.includes('placeholder="All time"'), 'the title the client reads when there is none');
  click(m, 'Create draft');
  assert.deepEqual(m.h().last.calls.at(-1).variables, { campaignId: CID, allTime: true, weekEnd: '2026-10-26' }, 'only its last day: the server sets where it starts');
  // Pick dates starts from the dates picked a moment ago: no first day, through today.
  m.fresh();
  m.newReport({ seriesData: picker(), reports: [] });
  choose(m, 'Latest progress');
  html = choose(m, 'Pick dates');
  t = text(html);
  assert.match(html, /aria-label="First day \(optional\)"[^>]*value=""/, 'no first day');
  assert.ok(t.includes('All time Leave the first day empty to count everything up to the last day.'), t);
  // Everything up to a day: no first day, a last day.
  html = fill(m, 'Last day', '2026-10-18');
  t = text(html);
  assert.ok(t.includes('Your report shows totals for the whole campaign, from its first door through Oct 18, with no “+412 this week” figures.'), t);
  click(m, 'Create draft');
  assert.deepEqual(m.h().last.calls.at(-1).variables, { campaignId: CID, allTime: true, weekEnd: '2026-10-18' });
  // A first day typed in makes it a dated report again.
  m.fresh();
  m.newReport({ seriesData: picker(), reports: [] });
  choose(m, 'Pick dates');
  fill(m, 'First day (optional)', '');
  t = text(fill(m, 'Last day', '2026-10-18'));
  assert.ok(t.includes('All time'), 'emptied: all time');
  t = text(fill(m, 'First day (optional)', '2026-10-12'));
  assert.ok(t.includes('7 days') && t.includes('The first day only decides what shows as new, like “+412 this week”.'), t);
  click(m, 'Create draft');
  assert.deepEqual(m.h().last.calls.at(-1).variables, { campaignId: CID, weekStart: '2026-10-12', weekEnd: '2026-10-18' });
  // No last day at all: held, and said.
  fill(m, 'First day (optional)', '');
  html = fill(m, 'Last day', '');
  assert.ok(text(html).includes('Pick a last day.'));
  assert.equal(disabledButton(html, 'Create draft'), true);
  // A half-typed first day reads '' as an empty one does, but the input flags it: held, never all time.
  fill(m, 'Last day', '2026-10-18');
  handlerFor(m, (x) => x.props['aria-label'] === 'First day (optional)', 'the first day').props.onChange({ target: { value: '', validity: { badInput: true } } });
  html = m.rerender();
  t = text(html);
  assert.ok(t.includes('Finish the first day, or clear it to count everything up to the last day.'), t);
  assert.ok(!t.includes('with no “+412 this week” figures'), 'not all time');
  assert.equal(disabledButton(html, 'Create draft'), true);
  // Cleared: all time again.
  t = text(fill(m, 'First day (optional)', ''));
  assert.ok(t.includes('through Oct 18, with no “+412 this week” figures.') && !t.includes('Finish the first day'), t);
  // Typing into an EMPTY first day fires no onChange (it reads '' until the day is whole): every key is read.
  const firstDay = () => handlerFor(m, (x) => x.props['aria-label'] === 'First day (optional)', 'the first day').props;
  firstDay().onKeyUp({ currentTarget: { validity: { badInput: true } } });
  html = m.rerender();
  assert.ok(text(html).includes('Finish the first day, or clear it to count everything up to the last day.'));
  assert.equal(disabledButton(html, 'Create draft'), true);
  // Every segment cleared again: the key that empties it says so, and it is all time once more.
  firstDay().onKeyUp({ currentTarget: { validity: { badInput: false } } });
  t = text(m.rerender());
  assert.ok(!t.includes('Finish the first day') && t.includes('with no “+412 this week” figures.'), t);
  firstDay().onBlur({ currentTarget: { validity: { badInput: true } } });
  assert.ok(text(m.rerender()).includes('Finish the first day'), 'on leaving the box too');
});

test('New report: the tab’s all-time reports never decide what comes next, nor the week nudge (SIMPLIFY §N)', async () => {
  const m = await load();
  // The tab's newest report is an all-time one ending on a Wednesday; its newest dated one ran Oct 12 – Oct 18.
  const allTime = { id: 'ra', seriesId: 'sc', weekStart: '2026-09-16', weekEnd: '2026-10-21', allTime: true, status: 'published', createdAt: '2026-10-21T20:00:00Z' };
  const dated = { id: 'rd', seriesId: 'sc', weekStart: '2026-10-12', weekEnd: '2026-10-18', status: 'published', createdAt: '2026-10-19T10:00:00Z' };
  m.fresh();
  let t = text(m.newReport({ seriesData: picker(), reports: [allTime, dated] }));
  assert.ok(t.includes(`Dates ${TOTALS_LINE()} Last week · Oct 19 – Oct 25 — the week after your last report Latest progress`), t);
  assert.ok(!t.includes('Your last Whole campaign report ran'), 'no nudge from the all-time report’s weekdays');
  // A tab with only all-time reports reads as a tab with none.
  m.fresh();
  t = text(m.newReport({ seriesData: picker(), reports: [allTime] }));
  assert.ok(t.includes(`Dates ${TOTALS_LINE()} Last week · Oct 19 – Oct 25 Latest progress`), t);
  assert.ok(!t.includes('after your last report'));
});

test('the reports list: an all-time report reads “All time · …”, gap lines skip it, and Next sits on the newest report of each kind (SIMPLIFY §N)', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  // Newest last day first, as the server lists them. Dates far from any clock: 2020, and 2099 below.
  const reports = [
    row({ id: 'ra', weekStart: '2020-01-06', weekEnd: '2020-03-11', allTime: true }),
    row({ id: 'rw', weekStart: '2020-02-24', weekEnd: '2020-03-01' }),
    row({ id: 'rv', weekStart: '2020-02-10', weekEnd: '2020-02-16' }),
  ];
  m.fresh();
  let html = m.page(pageQc(m, { reports }));
  let t = text(html);
  assert.match(t, /All time · Jan 6 – Mar 11/);
  assert.equal((html.match(/Next report<\/button>/g) || []).length, 2, 'on the all-time report and on the newest dated one');
  // The one gap is between the two dated reports; the all-time one covers every day up to its last.
  assert.equal((t.match(/not covered by any report/g) || []).length, 1, t);
  assert.match(t, /Feb 17 – Feb 23(, 2020)? not covered by any report/);
  // An all-time report that already runs through today offers no Next (Refresh numbers does that).
  m.fresh();
  html = m.page(pageQc(m, { reports: [row({ id: 'rf', weekStart: '2020-01-06', weekEnd: '2099-12-31', allTime: true }), ...reports.slice(1)] }));
  assert.equal((html.match(/Next report<\/button>/g) || []).length, 1, 'only the dated one');
});

test('New report: a new campaign’s first report starts at This week, not over yet', async () => {
  const m = await load();
  m.fresh();
  const html = m.newReport({ seriesData: picker({ knockedBeforeThisWeek: false }), reports: [] });
  assert.ok(text(html).includes(`Dates ${TOTALS_LINE()} This week, not over yet · Oct 26 – Nov 1 — refresh it once the week ends Latest progress · all time, through today Last week · Oct 19 – Oct 25 Pick dates`));
  assert.deepEqual(ticks(html, 'report-dates'), [true, false, false, false]);
});

test('New report: the tab already has these dates — Open the draft, or Make a second one (SIMPLIFY §E)', async () => {
  const m = await load();
  m.fresh();
  const opened = [];
  const reports = [];
  const qc = m.newQc();
  m.newReport({ seriesData: picker(), reports, onOpenReport: (id) => opened.push(id) }, qc);
  click(m, 'Create draft');
  let html = await settle(m, refusal('REPORT_EXISTS', { reportId: 'rX', status: 'draft', takenDown: false, weekStart: '2026-10-19', weekEnd: '2026-10-25', scopeLabel: 'Whole campaign' }));
  let t = text(html);
  assert.ok(t.includes('You already have a draft Whole campaign report for Oct 19 – Oct 25. Open the draft Make a second one Each one gets its own link once it’s published.'));
  assert.ok(!t.includes('Couldn’t create the draft.'), 'a prompt, not an error');
  assert.equal(disabledButton(html, 'Create draft'), true, 'not the same request again');
  // The list gains that draft while the prompt is up: the dates it names stay picked (WEEK-2).
  reports.push({ id: 'rX', seriesId: 'sc', weekStart: '2026-10-19', weekEnd: '2026-10-25', status: 'draft' });
  html = landPicker(m, qc);
  assert.ok(text(html).includes(`Dates ${TOTALS_LINE()} Last week · Oct 19 – Oct 25`));
  assert.deepEqual(ticks(html, 'report-dates'), [true, false, false, false]);
  click(m, 'Open the draft');
  assert.deepEqual(opened, ['rX']);
  click(m, 'Make a second one');
  assert.deepEqual(m.h().last.calls.at(-1).variables, { campaignId: CID, weekStart: '2026-10-19', weekEnd: '2026-10-25', allowDuplicate: true }, 'a second report of the same dates');
  // Published, or taken down: Open it.
  m.fresh();
  m.newReport({ seriesData: picker(), reports: [] });
  click(m, 'Create draft');
  t = text(await settle(m, refusal('REPORT_EXISTS', { reportId: 'rY', status: 'published', takenDown: false, weekStart: '2026-10-19', weekEnd: '2026-10-25', scopeLabel: 'Whole campaign' })));
  assert.ok(t.includes('You already published a Whole campaign report for Oct 19 – Oct 25. To bring its numbers up to date, open it and press Refresh numbers. Open it Make a second one'));
  m.fresh();
  m.newReport({ seriesData: picker(), reports: [] });
  click(m, 'Create draft');
  t = text(await settle(m, refusal('REPORT_EXISTS', { reportId: 'rZ', status: 'published', takenDown: true, weekStart: '2026-10-19', weekEnd: '2026-10-25', scopeLabel: 'Whole campaign' })));
  assert.ok(t.includes('You already published a Whole campaign report for Oct 19 – Oct 25, taken down. Open it Make a second one'));
  // Picking other dates clears it.
  t = text(choose(m, 'This week, not over yet'));
  assert.ok(!t.includes('You already published'));
  // So does typing a title (or your own dates) under it: Make a second one resends what was pressed, so an edit
  // left under the prompt would be dropped without a word — instead the prompt goes and Create asks again.
  m.fresh();
  m.newReport({ seriesData: picker(), reports: [] });
  click(m, 'Create draft');
  t = text(await settle(m, refusal('REPORT_EXISTS', { reportId: 'rX', status: 'draft', takenDown: false, weekStart: '2026-10-19', weekEnd: '2026-10-25', scopeLabel: 'Whole campaign' })));
  assert.ok(t.includes('You already have a draft'));
  t = text(fill(m, 'Oct 19 – Oct 25', 'Board copy'));
  assert.ok(!t.includes('You already have a draft'), 'a title typed under the prompt takes it away');
  assert.ok(!t.includes('Make a second one'));
});

test('New report: two people pressed Create at once — “Ada Admin made the Whole campaign report for Oct 19 – Oct 25 a moment ago — you’re both in it.”, with Open it (SIMPLIFY §E)', async () => {
  const m = await load();
  m.fresh();
  const opened = [];
  const created = [];
  let listChanged = 0;
  const reports = [];
  const qc = m.newQc();
  m.newReport({ seriesData: picker(), reports, userId: 'u1', onOpenReport: (id) => opened.push(id), onCreated: (r) => created.push(r), onReportsChanged: () => (listChanged += 1) }, qc);
  click(m, 'Create draft');
  const won = { _id: 'rW', id: 'rW', seriesId: 'sc', weekStart: '2026-10-19', weekEnd: '2026-10-25', status: 'draft', createdBy: 'u7' };
  let html = await settle(m, { report: won, build: { status: 'queued' }, existing: true, createdByName: 'Ada Admin' });
  let t = text(html);
  assert.ok(t.includes('Ada Admin made the Whole campaign report for Oct 19 – Oct 25 a moment ago — you’re both in it.'), 'it names the report');
  assert.deepEqual(created, [], 'not “created” — theirs won');
  assert.equal(listChanged, 1, 'the list gains it now');
  assert.ok(t.includes('Close') && t.includes('Open it') && !t.includes('Create draft'));
  // The list gains the draft that won, and the picker is read again: the dates stay as they were
  // (WEEK-2) — not the period after it — and the form is still.
  reports.push(won);
  html = landPicker(m, qc);
  t = text(html);
  assert.deepEqual(ticks(html, 'report-dates'), [true, false, false, false], 'the same choice, still picked');
  assert.ok(t.includes(`Dates ${TOTALS_LINE()} Last week · Oct 19 – Oct 25 Latest progress · all time, through today This week, not over yet · Oct 26 – Nov 1`), 'never the week after it');
  assert.ok(!t.includes('Oct 26 – Nov 1 — the week after your last report'));
  assert.match(html, /^[^]*?<fieldset disabled="" class="min-w-0 space-y-5 text-sm">/, 'the form is still');
  click(m, 'Open it');
  assert.deepEqual(opened, ['rW']);
  // A plain create still goes straight to the builder.
  m.fresh();
  m.newReport({ seriesData: picker(), reports: [], onCreated: (r) => created.push(r) });
  click(m, 'Create draft');
  await settle(m, { report: { _id: 'rN' }, build: { status: 'queued' } });
  assert.equal(created.length, 1);
  // The draft that got in is this person's own (a press in another tab): no "you're both in it" — it opens.
  m.fresh();
  m.newReport({ seriesData: picker(), reports: [], userId: 'u1', onCreated: (r) => created.push(r), onReportsChanged: () => (listChanged += 1) });
  click(m, 'Create draft');
  const own = text(await settle(m, { report: { _id: 'rM', createdBy: 'u1' }, build: { status: 'queued' }, existing: true, createdByName: 'Ada Admin' }));
  assert.equal(created.at(-1).report._id, 'rM');
  assert.ok(!own.includes('a moment ago'));
  assert.equal(listChanged, 1, 'not the someone-else path: onCreated refreshes the lists, as after any create');
});

// ── New report after code review round 1 (WEEK-1 … WEEK-4, item 8) ──────────────────────────────────

test('New report: a refusal about what it covers reads the request as it was sent — a walk list named like a canvasser, an ended team', async () => {
  const m = await load();
  const efforts = [{ _id: 'e1', name: 'Smith Street' }];
  const paid = { id: 't1', kind: 'team', label: 'Paid team', ended: false, coordinators: [], pastCoordinators: [] };
  const withTeam = picker({ series: [{ id: 'sc', kind: 'campaign', label: 'Whole campaign', ended: false }, paid] });
  // A walk list alone: its client-facing name can be changed here, and the resend carries it.
  m.fresh();
  m.newReport({ seriesData: picker(), reports: [], efforts, initial: { effortId: 'e1' } });
  click(m, 'Create draft');
  assert.deepEqual(m.h().last.calls.at(-1).variables, { campaignId: CID, weekStart: '2026-10-19', weekEnd: '2026-10-25', effortId: 'e1' });
  let t = text(await settle(m, refusal('WALK_LIST_LABEL_HAS_NAME', { names: ['Smith'], label: 'Smith Street' })));
  assert.ok(t.includes('The walk list’s name matches a canvasser on this campaign (“Smith”). Your client reads this name.') && t.includes('Name your client sees'));
  handlerFor(m, (x) => x.props.onChange && x.label === 'Name your client sees', 'the name field').props.onChange({ target: { value: 'North end' } });
  handlerFor(m, (x) => x.props.type === 'checkbox' && x.label === 'This is a place, not a person', 'the place checkbox').props.onChange({ target: { checked: true } });
  m.rerender();
  click(m, 'Create draft');
  assert.deepEqual(m.h().last.calls.at(-1).variables, { campaignId: CID, weekStart: '2026-10-19', weekEnd: '2026-10-25', effortId: 'e1', seriesLabel: 'North end', confirmLabel: true });
  // A team's walk list: the name is the team's to give, so only the checkbox.
  m.fresh();
  m.newReport({ seriesData: withTeam, reports: [], efforts, initial: { teamId: 't1', effortId: 'e1' } });
  click(m, 'Create draft');
  assert.equal(m.h().last.calls.at(-1).variables.teamSeriesId, 't1');
  t = text(await settle(m, refusal('WALK_LIST_LABEL_HAS_NAME', { names: ['Smith'], label: 'Smith Street' })));
  assert.ok(t.includes('This is a place, not a person') && !t.includes('Name your client sees'));
  // The team ended meanwhile: Continue, on the team the request named.
  m.fresh();
  m.newReport({ seriesData: withTeam, reports: [], initial: { teamId: 't1' } });
  click(m, 'Create draft');
  t = text(await settle(m, refusal('SERIES_ENDED')));
  assert.ok(t.includes('“Paid team” has ended. Continue it to start a new report.') && t.includes('Continue the team'), t);
});

test('New report reads the series picker again as it opens: the dates wait for that answer and follow it — never the page’s older copy (WEEK-1)', async () => {
  const m = await load();
  m.fresh();
  const qc = m.newQc();
  // The page's copy: read Sunday evening, before another admin moved the week to Wednesday – Tuesday.
  const stale = picker({ today: '2026-10-25' });
  qc.setQueryData(SERIES_KEY, stale, { updatedAt: Date.now() - 60 * 60 * 1000 });
  let html = m.newReport({ seriesData: stale, reports: [], isAdmin: true, hold: true }, qc);
  let t = text(html);
  assert.ok(t.includes('Dates Loading the dates…'), 'the dates wait');
  assert.deepEqual(ticks(html, 'report-dates'), [], 'no choice from the old answer');
  assert.ok(!t.includes('Report weeks run'), 'nor its week');
  assert.match(html, /<input maxLength="200" placeholder="" class=/, 'nor a title guessed from them');
  assert.equal(disabledButton(html, 'Create draft'), true, 'and Create waits with them');
  // The answer read now: Monday, Wednesday – Tuesday weeks.
  html = landPicker(m, qc, picker({ today: '2026-10-26', weekStartsOn: 3 }));
  t = text(html);
  assert.ok(t.includes(`Dates ${TOTALS_LINE()} Last week · Oct 14 – Oct 20 Latest progress · all time, through today This week, not over yet · Oct 21 – Oct 27 — refresh it once the week ends Pick dates`), t);
  assert.ok(t.includes('Report weeks run Wednesday – Tuesday for your organization. Change'));
  assert.equal(disabledButton(html, 'Create draft'), false);

  // The read fails: it says so, with Try again — still never the old answer's dates.
  m.fresh();
  const failing = m.newQc();
  failing.setQueryData(SERIES_KEY, stale, { updatedAt: Date.now() - 60 * 60 * 1000 });
  m.newReport({ seriesData: stale, reports: [], hold: true }, failing);
  failing.getQueryCache().find({ queryKey: SERIES_KEY }).setState({ status: 'error', error: Object.assign(new Error('Service unavailable.'), { status: 503 }), errorUpdatedAt: Date.now(), fetchStatus: 'idle' });
  html = m.rerender();
  t = text(html);
  assert.ok(t.includes('Couldn’t load the dates. Service unavailable.'), t);
  assert.deepEqual(ticks(html, 'report-dates'), []);
  assert.equal(disabledButton(html, 'Create draft'), true);
  const before = m.h().fetches.length;
  click(m, 'Try again');
  assert.deepEqual(m.h().fetches.slice(before).map((f) => f.url), [`/api/admin/client-reports/series?campaignId=${CID}`], 'read again');
});

test('New report left open past the campaign’s midnight reads the dates again; its once-a-minute check stops with it (WEEK-1)', async () => {
  const m = await load();
  const timers = [];
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  globalThis.setInterval = (fn, ms) => timers.push({ fn, ms, cleared: false });
  globalThis.clearInterval = (id) => {
    if (timers[id - 1]) timers[id - 1].cleared = true;
  };
  const mount = () => m.h().effects.filter((e) => e.module === 'newReport').map((e) => e.fn()).filter((c) => typeof c === 'function');
  const seriesReads = () => m.h().fetches.filter((f) => f.url === `/api/admin/client-reports/series?campaignId=${CID}`).length;
  try {
    // The answer's day is long past (the campaign's clock moved on while the dialog sat open).
    m.fresh();
    m.newReport({ seriesData: picker({ today: '2020-01-06' }), reports: [] });
    let cleanups = mount();
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 60 * 1000, 'checked once a minute');
    timers[0].fn();
    assert.equal(seriesReads(), 1, 'read again');
    cleanups.forEach((c) => c());
    assert.equal(timers[0].cleared, true, 'the check stops with the dialog');
    // Still the same day: nothing is read.
    m.fresh();
    m.newReport({ seriesData: picker({ today: todayIn('America/New_York') }), reports: [] });
    cleanups = mount();
    timers.at(-1).fn();
    assert.equal(seriesReads(), 0);
    cleanups.forEach((c) => c());
    assert.equal(timers.at(-1).cleared, true);
  } finally {
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
  }
});

test('New report: dates that start after today say their numbers stay empty until then, under the choice they are about (WEEK-3)', async () => {
  const m = await load();
  m.fresh();
  // A Tuesday – Monday tab whose last report ends today, Monday Oct 26: the next one starts tomorrow.
  const tueMon = [{ id: 'rt', seriesId: 'sc', weekStart: '2026-10-20', weekEnd: '2026-10-26', status: 'published' }];
  let t = text(m.newReport({ seriesData: picker(), reports: tueMon }));
  assert.ok(t.includes(`Dates ${TOTALS_LINE()} Oct 27 – Nov 2 — the week after your last report Starts Oct 27 — its numbers stay empty until then. Latest progress · all time, through today Last week · Oct 19 – Oct 25`), t);
  assert.ok(!t.includes('isn’t over yet'), 'it hasn’t started — not “isn’t over yet”');
  // Pick dates: the note follows the dates picked, under them.
  t = text(choose(m, 'Pick dates'));
  assert.ok(t.includes('Pick dates – 7 days Leave the first day empty to count everything up to the last day. Starts Oct 27 — its numbers stay empty until then.'), t);
  assert.equal((t.match(/Starts Oct 27/g) || []).length, 1, 'said once, under the choice picked');
  t = text(fill(m, 'First day (optional)', '2026-10-20'));
  assert.ok(t.includes('14 days Leave the first day empty to count everything up to the last day. This period isn’t over yet — you can build it now and refresh it later.'));
  assert.ok(!t.includes('Starts Oct'));
});

test('New report: the keyboard follows the week line — the weekday select when Change opens it, Change again after Cancel, Save or the nudge (WEEK-4)', async () => {
  const m = await load();
  m.fresh();
  m.newReport({ seriesData: picker(), reports: wedTue, isAdmin: true });
  // renderToString attaches no refs: stand-ins in the dialog's last two refs (Change, then the panel).
  const refs = m.h().stores.newReport.slots.filter((x) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === 1 && 'current' in x);
  const [changeRef, panelRef] = refs.slice(-2);
  const focused = [];
  changeRef.current = { focus: () => focused.push('Change') };
  panelRef.current = { querySelector: (sel) => (sel === 'select' ? { focus: () => focused.push('weekday select') } : null) };
  // Effects after each screen, as a browser runs them (the dialog's timer stopped again at once).
  const settleEffects = () => m.h().effects.filter((e) => e.module === 'newReport').map((e) => e.fn()).filter((c) => typeof c === 'function').forEach((c) => c());
  settleEffects();
  assert.deepEqual(focused, [], 'nothing on open');
  click(m, 'Change');
  settleEffects();
  assert.equal(focused.at(-1), 'weekday select');
  click(m, 'Cancel');
  settleEffects();
  assert.equal(focused.at(-1), 'Change');
  click(m, 'Change');
  fill(m, 'Report weeks run', '0');
  click(m, 'Save');
  await settle(m, { weekStartsOn: 0 });
  settleEffects();
  assert.equal(focused.at(-1), 'Change', 'after Save');
  // The nudge's organization-wide button goes away once the week matches: Change takes the focus.
  m.fresh();
  m.newReport({ seriesData: picker(), reports: wedTue, isAdmin: true });
  const [change2] = m.h().stores.newReport.slots.filter((x) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === 1 && 'current' in x).slice(-2);
  change2.current = { focus: () => focused.push('Change again') };
  click(m, 'Use Wednesday – Tuesday weeks for the whole organization');
  await settle(m, { weekStartsOn: 3 });
  settleEffects();
  assert.equal(focused.at(-1), 'Change again');
});

test('New report follows the tab’s newest report — of two ending the same day, the one made last, then the higher id (as report:tab-weeks counts)', async () => {
  const m = await load();
  // Two Tuesday – Monday reports ending Oct 19: one week, and two weeks made a day later.
  const week = { id: '6a0000000000000000000a01', seriesId: 'sc', weekStart: '2026-10-13', weekEnd: '2026-10-19', status: 'published', createdAt: '2026-10-20T10:00:00Z' };
  const fortnight = { id: '6a0000000000000000000a02', seriesId: 'sc', weekStart: '2026-10-06', weekEnd: '2026-10-19', status: 'published', createdAt: '2026-10-21T10:00:00Z' };
  for (const reports of [[week, fortnight], [fortnight, week]]) {
    m.fresh();
    assert.ok(text(m.newReport({ seriesData: picker(), reports })).includes(`Dates ${TOTALS_LINE('in these 14 days')} Oct 20 – Nov 2 · 2 weeks — the two weeks after your last report`), 'the one made last, whatever the list order');
  }
  // Made in the same instant (or rows without createdAt): the higher id.
  const sameTime = [
    { ...week, id: '6a0000000000000000000a09', createdAt: undefined },
    { ...fortnight, createdAt: undefined },
  ];
  for (const reports of [sameTime, [...sameTime].reverse()]) {
    m.fresh();
    assert.ok(text(m.newReport({ seriesData: picker(), reports })).includes(`Dates ${TOTALS_LINE()} Oct 20 – Oct 26 — the week after your last report`));
  }
});

// ── After code review round 2 (VER-1, VER-2, FRESH-1 … FRESH-8) ─────────────────────────────────────
// renderToString attaches no refs: a test puts stand-ins in a module's refs (found in its store, in the
// order they are declared) and runs the module's effects as a browser would, stopping what they start.
const refSlots = (m, store) => m.h().stores[store].slots.filter((x) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === 1 && 'current' in x);
const runEffects = (m, module) => m.h().effects.filter((e) => e.module === module).map((e) => e.fn()).filter((c) => typeof c === 'function').forEach((c) => c());
const box = (name, calls, { control = true, tabbable = false } = {}) => ({
  scrollIntoView: () => calls.push(`${name}: into view`),
  querySelector: () => (control ? { focus: () => calls.push(`${name}: its first control`) } : null),
  hasAttribute: (a) => a === 'tabindex' && tabbable,
  focus: () => calls.push(`${name}: itself`),
});
// New report's refs, from the last declared: the week panel, Change, then the boxes Create's answer puts
// up — the error, the race note, the duplicate prompt, the ended team, the walk list's name.
const reportBox = (m, which) => refSlots(m, 'newReport').at({ error: -3, joined: -4, duplicate: -5, ended: -6, label: -7 }[which]);

test('New report: Create on its way freezes the form; the duplicate prompt comes into view under the dates, its first button focused; Make a second one resends what was pressed (VER-1, FRESH-1, FRESH-5)', async () => {
  const m = await load();
  m.fresh();
  m.newReport({ seriesData: picker(), reports: [] });
  let html = click(m, 'Create draft');
  assert.match(html, /<fieldset disabled="" class="min-w-0 space-y-5 text-sm">/, 'nothing can change under a request on its way');
  const pressed = m.h().last.calls.at(-1).variables;
  assert.deepEqual(pressed, { campaignId: CID, weekStart: '2026-10-19', weekEnd: '2026-10-25' });
  html = await settle(m, refusal('REPORT_EXISTS', { reportId: 'rX', status: 'published', takenDown: true, weekStart: '2026-10-19', weekEnd: '2026-10-25', scopeLabel: 'Whole campaign' }));
  assert.doesNotMatch(html, /<fieldset disabled=""/, 'answered: the form is live again');
  const at = html.indexOf('role="alert"');
  assert.ok(at > html.indexOf('Pick dates') && at < html.indexOf('Title (optional)'), 'an alert, right under the dates — above Title');
  assert.ok(
    text(html).includes(
      'You already published a Whole campaign report for Oct 19 – Oct 25, taken down. Open it Make a second one The taken-down one stays hidden until you put it back up. The new one gets its own link once it’s published.'
    ),
    'a taken-down one stays hidden (FRESH-5); each report gets its own link (LINKS Part 1 §6)'
  );
  const calls = [];
  reportBox(m, 'duplicate').current = box('the duplicate prompt', calls);
  runEffects(m, 'newReport');
  assert.deepEqual(calls, ['the duplicate prompt: into view', 'the duplicate prompt: its first control']);
  // Make a second one sends exactly what was pressed. (Typing under the prompt takes it away instead — the
  // "the tab already has these dates" test — so an edit is never dropped without a word.)
  click(m, 'Make a second one');
  assert.deepEqual(m.h().last.calls.at(-1).variables, { ...pressed, allowDuplicate: true });
});

test('New report: a report of these dates that’s archived says so — “— it’s archived.” — with Open it and Unarchive, which brings it back right there (LINKS Part 1 §4)', async () => {
  const m = await load();
  m.fresh();
  const opened = [];
  let changed = 0;
  m.newReport({ seriesData: picker(), reports: [], onOpenReport: (id) => opened.push(id), onReportsChanged: () => (changed += 1) });
  click(m, 'Create draft');
  const exists = (over) => refusal('REPORT_EXISTS', { reportId: 'rA', status: 'published', takenDown: false, archivedAt: AT, weekStart: '2026-10-19', weekEnd: '2026-10-25', scopeLabel: 'Whole campaign', ...over });
  let html = await settle(m, exists());
  let t = text(html);
  assert.ok(t.includes('You already published a Whole campaign report for Oct 19 – Oct 25 — it’s archived. Open it Unarchive Make a second one Each one gets its own link once it’s published.'), t);
  assert.ok(!t.includes('Refresh numbers'), 'not sent off to a list it isn’t in');
  click(m, 'Open it');
  assert.deepEqual(opened, ['rA']);
  // Unarchive: the request, then the prompt reads as for any report of these dates; the list is read again.
  click(m, 'Unarchive');
  const req = m.h().last;
  assert.equal(req.calls.at(-1).variables, 'rA');
  req.opts.mutationFn('rA');
  assert.deepEqual(m.h().fetches.at(-1), { url: '/api/admin/client-reports/rA/unarchive', method: 'POST', body: null });
  html = await settle(m, { report: { _id: 'rA', archivedAt: null } });
  t = text(html);
  assert.ok(t.includes('You already published a Whole campaign report for Oct 19 – Oct 25. To bring its numbers up to date, open it and press Refresh numbers. Open it Make a second one'), t);
  assert.ok(!t.includes('Unarchive') && !t.includes('archived'));
  assert.equal(changed, 1, 'the page’s list follows');
  // Unarchive is gone, so the keyboard goes back to the prompt's first button.
  const calls = [];
  reportBox(m, 'duplicate').current = box('the duplicate prompt', calls);
  runEffects(m, 'newReport');
  assert.deepEqual(calls, ['the duplicate prompt: into view', 'the duplicate prompt: its first control']);
  // A draft, and a taken-down report, that are archived.
  m.fresh();
  m.newReport({ seriesData: picker(), reports: [] });
  click(m, 'Create draft');
  t = text(await settle(m, exists({ status: 'draft' })));
  assert.ok(t.includes('You already have a draft Whole campaign report for Oct 19 – Oct 25 — it’s archived. Open the draft Unarchive Make a second one Each one gets its own link once it’s published.'), t);
  m.fresh();
  m.newReport({ seriesData: picker(), reports: [] });
  click(m, 'Create draft');
  t = text(await settle(m, exists({ takenDown: true })));
  assert.ok(
    t.includes('You already published a Whole campaign report for Oct 19 – Oct 25, taken down — it’s archived. Open it Unarchive Make a second one The taken-down one stays hidden until you put it back up. The new one gets its own link once it’s published.'),
    t
  );
  // Unarchive refused: said under the buttons, and the prompt stays as it was.
  click(m, 'Unarchive');
  t = text(await settle(m, Object.assign(new Error('Report not found'), { status: 404, code: 'REPORT_NOT_FOUND' })));
  assert.ok(t.includes('Couldn’t unarchive it. Report not found') && t.includes('— it’s archived.'), t);
});

test('New report: the race note names the report’s own tab and comes into view, Open it takes the focus; a refusal in words, the walk list’s name and an ended team come into view too (VER-1, FRESH-1)', async () => {
  const m = await load();
  m.fresh();
  m.newReport({ seriesData: picker(), reports: [], userId: 'u1' });
  click(m, 'Create draft');
  // The form reads Whole campaign; the draft that won is the Paid team's (its own scope, as answered).
  const html = await settle(m, { report: { _id: 'rW', createdBy: 'u7', weekStart: '2026-10-19', weekEnd: '2026-10-25', scope: { kind: 'team', label: 'Paid team' } }, existing: true, createdByName: 'Ada Admin' });
  assert.ok(text(html).includes('Ada Admin made the Paid team report for Oct 19 – Oct 25 a moment ago — you’re both in it.'));
  assert.equal(m.h().handlers.filter((x) => x.text === 'Open it').pop().props.autoFocus, true, 'the footer’s Open it takes the focus as it appears');
  let calls = [];
  reportBox(m, 'joined').current = box('the race note', calls, { control: false });
  runEffects(m, 'newReport');
  assert.deepEqual(calls, ['the race note: into view'], 'brought into view; the focus stays on Open it');
  // A refusal in words: into view, and the box itself takes the focus (it has no control).
  m.fresh();
  m.newReport({ seriesData: picker(), reports: [] });
  click(m, 'Create draft');
  await settle(m, Object.assign(new Error('Something broke.'), { status: 500 }));
  calls = [];
  reportBox(m, 'error').current = box('the error', calls, { control: false, tabbable: true });
  runEffects(m, 'newReport');
  assert.deepEqual(calls, ['the error: into view', 'the error: itself']);
  // The walk list's name, and an ended team: into view, their first control focused.
  for (const [code, which] of [
    ['WALK_LIST_LABEL_HAS_NAME', 'label'],
    ['SERIES_ENDED', 'ended'],
  ]) {
    m.fresh();
    const paid = { id: 't1', kind: 'team', label: 'Paid team', ended: false, coordinators: [], pastCoordinators: [] };
    m.newReport({ seriesData: picker({ series: [{ id: 'sc', kind: 'campaign', label: 'Whole campaign', ended: false }, paid] }), reports: [], efforts: [{ _id: 'e1', name: 'Smith Street' }], initial: { teamId: 't1', effortId: which === 'label' ? 'e1' : undefined } });
    click(m, 'Create draft');
    await settle(m, refusal(code, { names: ['Smith'], label: 'Smith Street' }));
    calls = [];
    reportBox(m, which).current = box(which, calls);
    runEffects(m, 'newReport');
    assert.deepEqual(calls, [`${which}: into view`, `${which}: its first control`], code);
  }
});

test('the guide’s Got it hands the keyboard to How it works (FRESH-4)', async () => {
  const m = await load();
  m.storage.clear();
  m.fresh();
  m.page(pageQc(m));
  const focused = [];
  const [how] = refSlots(m, 'page');
  how.current = { focus: () => focused.push('How it works') };
  click(m, 'Got it');
  assert.deepEqual(focused, ['How it works']);
});

// ── The list page's wiring (§C, §D, K10; docs/PROPOSAL_CLIENT_REPORT_LINKS.md §D2, §D3, K1, K12) ────────────

test('the list page: Share on every published row — shown or taken down — hands Share the report as it stands, its links, the switch and who is asking (K12)', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  m.fresh();
  const down = row({ id: 'r0', weekStart: '2026-10-12', weekEnd: '2026-10-18', takenDownAt: '2026-10-22T14:00:00Z' });
  const draft = row({ id: 'rd', status: 'draft', weekStart: '2026-10-05', weekEnd: '2026-10-11', publishedAt: null, hasSnapshot: false });
  const qc = pageQc(m, { reports: [row(), down, draft], shares: [ownLink()], allReportsRetired: true, staffUnderGrant: true });
  const html = m.page(qc);
  assert.equal((html.match(/>Share<\/button>/g) || []).length, 2, 'both published reports — a draft has nothing to share');
  assert.ok(!text(html).includes('Copy message'));
  assert.equal(m.h().shareProps.length, 0, 'closed until asked');
  assert.ok(text(handed(m, 'ReportRow', 'onShare', down)).includes('Share dialog'));
  const props = m.h().shareProps.at(-1);
  assert.equal(props.report.id, 'r0');
  assert.equal(props.report.status, 'published');
  assert.equal(props.report.takenDownAt, '2026-10-22T14:00:00Z', 'Share holds the message on a taken-down report');
  assert.equal(props.report.seriesId, 'sc', 'its tab, for Same as your last link');
  assert.equal(props.report.campaignType, 'survey');
  assert.deepEqual(props.report.cumulative, { doorsKnocked: 3412, surveysTaken: 1980 });
  assert.deepEqual(props.shares.map((s) => s.id), ['o1']);
  assert.equal(props.allReportsRetired, true);
  assert.equal(props.staffUnderGrant, true);
  assert.equal(props.linksError, null);
  assert.equal(props.campaignId, CID);
  assert.equal(props.tz, 'America/New_York');
  // A link made or changed there: the links list and History are read again.
  const invalidated = [];
  const real = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = (f) => {
    invalidated.push(JSON.stringify(f?.queryKey));
    return real(f);
  };
  props.onLinksChanged();
  assert.ok(invalidated.includes(JSON.stringify(['admin', 'client-report-shares', CID])) && invalidated.includes(JSON.stringify(['admin', 'client-report-history', CID])), invalidated.join(' '));
  // Create found the report taken down or deleted somewhere else (code review V2-2): the reports list and
  // the report are read again, so Share shows it taken down — its row offering Put back up — or it goes.
  invalidated.length = 0;
  props.onReportChanged();
  assert.ok(invalidated.includes(JSON.stringify(['admin', 'client-reports', CID])) && invalidated.includes(JSON.stringify(['admin', 'client-report', 'r0'])), invalidated.join(' '));
  props.onClose();
  assert.ok(!text(m.rerender()).includes('Share dialog'), 'and it closes');
  // Share reads the report as the list has it now — taken down while Share was open, it says so.
  handed(m, 'ReportRow', 'onShare', row());
  qc.setQueryData(['admin', 'client-reports', CID], { reports: [row({ takenDownAt: '2026-10-27T14:00:00Z' }), down, draft] });
  m.rerender();
  assert.equal(m.h().shareProps.at(-1).report.takenDownAt, '2026-10-27T14:00:00Z');
});

test('the list page: before the links list is in, a row says nothing about its link and Share is handed none — then both follow the list (LINK-3)', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  m.fresh();
  const qc = pageQc(m, { reports: [row({ views: { byLink: { o1: { opens: 3 } } } })], shares: null });
  let t = text(m.page(qc));
  assert.ok(!/No link of its own|Link:/.test(t), t);
  assert.ok(t.includes('About 3 visits'), 'its visits are its own counts: no list needed');
  handed(m, 'ReportRow', 'onShare', row());
  assert.equal(m.h().shareProps.at(-1).shares, null, 'Share waits for the list');
  assert.deepEqual(m.h().retiredProps.at(-1).shares, [], 'the old-links card: nothing to show yet');
  qc.setQueryData(['admin', 'client-report-shares', CID], { shares: [ownLink()], allReportsRetired: false, staffUnderGrant: false });
  t = text(m.rerender());
  assert.deepEqual(m.h().shareProps.at(-1).shares.map((s) => s.id), ['o1']);
  assert.ok(t.includes(`Link: active · expires ${formatDayOf(ownLink().expiresAt, 'America/New_York')}`), t);
});

test('the list page: a row says how its own link is doing — expired says Share renews it, even beside a working link to another report; an old link to all your reports isn’t its link (LINK-2)', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  m.fresh();
  const gone = iso(NOW - DAY);
  let t = text(m.page(pageQc(m, { reports: [row()], shares: [ownLink({ expiresAt: gone }), elsewhere] })));
  assert.ok(t.includes(`Link expired ${formatDayOf(gone, 'America/New_York')} — Share to renew it.`), t);
  m.fresh();
  t = text(m.page(pageQc(m, { reports: [row()], shares: [link(), elsewhere] })));
  assert.ok(t.includes('No link of its own yet — Share makes one.'));
});

test('the list page: the old-links card sits above the reports, in the reports’ own column, with the links, the switch and who is asking — and the Client links panel is gone (K12)', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  m.fresh();
  const qc = pageQc(m, { reports: [row()], shares: [link(), ownLink()], allReportsRetired: true });
  const html = m.page(qc);
  const props = m.h().retiredProps.at(-1);
  assert.equal(props.campaignId, CID);
  assert.equal(props.tz, 'America/New_York');
  assert.deepEqual(props.shares.map((s) => s.id), ['l1', 'o1'], 'the whole list: the card picks the old links');
  assert.equal(props.allReportsRetired, true);
  assert.equal(props.staffUnderGrant, false);
  const card = html.indexOf('data-retired-stub');
  const reports = html.indexOf('>Reports</h2>');
  assert.ok(card > -1 && card < reports, 'above the reports card');
  // In the reports' column — before the reports card closes — not the side column beside it, so it sits
  // above the reports at every width.
  const column = html.lastIndexOf('<div class="min-w-0 space-y-5">', card);
  assert.ok(column > -1 && html.lastIndexOf('<div class="min-w-0 space-y-5">', reports) === column);
  assert.ok(!/Client links|\+ New link/.test(text(html)));
  const invalidated = [];
  const real = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = (f) => {
    invalidated.push(JSON.stringify(f?.queryKey));
    return real(f);
  };
  props.onChanged();
  assert.ok(invalidated.includes(JSON.stringify(['admin', 'client-report-shares', CID])) && invalidated.includes(JSON.stringify(['admin', 'client-report-history', CID])));
});

// ── Archive (docs/PROPOSAL_CLIENT_REPORT_LINKS.md Part 1 §4, §D3, contract K7) ──────────────────────────
const AT = '2026-10-27T14:00:00Z';
// The server render puts <!-- --> between neighbouring text and numbers: gone, the markup reads whole.
const flat = (html) => html.replace(/<!-- -->/g, '');
// The tab's count badge, as it reads.
const tabCount = (html) => {
  const at = html.indexOf('>', html.indexOf('role="tablist"')) + 1;
  return text(html.slice(at, html.indexOf('</div>', at))).trim();
};

test('Archive: archived reports fold under Archived (N) at the bottom of their tab, closed; the tab counts the rest; gap lines still count them (LINKS §D3)', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  m.fresh();
  // Newest first, as the server sends them. Dates far from any clock.
  const reports = [
    row({ id: 'ra', weekStart: '2020-03-02', weekEnd: '2020-03-08' }),
    // An archived report between two others still covers its days: no "not covered" line for them.
    row({ id: 'rb', weekStart: '2020-02-24', weekEnd: '2020-03-01', archivedAt: AT }),
    row({ id: 'rc', weekStart: '2020-02-17', weekEnd: '2020-02-23' }),
    // The days before this one's successor are a real gap: its line goes with it, into the fold.
    row({ id: 'rd', weekStart: '2020-02-03', weekEnd: '2020-02-09', archivedAt: AT }),
  ];
  let html = m.page(pageQc(m, { reports }));
  let t = text(html);
  assert.equal(tabCount(html), 'Whole campaign 2', 'archived reports aren’t counted');
  assert.ok(t.includes('Mar 2 – Mar 8') && t.includes('Feb 17 – Feb 23'));
  assert.ok(!t.includes('Feb 24 – Mar 1') && !t.includes('Feb 3 – Feb 9'), 'folded away');
  assert.ok(!t.includes('not covered by any report'), 'no false gap where an archived report sits');
  assert.match(flat(html), /aria-expanded="false"[^>]*>.*Archived \(2\)<\/button>/, 'folded, at the bottom');
  assert.ok(flat(html).indexOf('Archived (2)') > flat(html).indexOf('Feb 17 – Feb 23'));
  assert.ok(!t.includes('Every report here is archived'));
  html = click(m, 'Archived (2)');
  t = text(html);
  assert.match(flat(html), /aria-expanded="true"[^>]*>.*Archived \(2\)<\/button>/);
  assert.ok(t.indexOf('Archived (2)') < t.indexOf('Feb 24 – Mar 1') && t.indexOf('Feb 24 – Mar 1') < t.indexOf('Feb 3 – Feb 9'));
  assert.match(t, /Feb 10 – Feb 16(, 2020)? not covered by any report/, 'the gap line, with the row it sits above');
  assert.ok(t.indexOf('not covered by any report') > t.indexOf('Feb 24 – Mar 1') && t.indexOf('not covered by any report') < t.indexOf('Feb 3 – Feb 9'));
  assert.equal((html.match(/>Unarchive<\/button>/g) || []).length, 2, 'Unarchive on each');
  assert.equal((t.match(/Published Archived/g) || []).length, 2, 'each marked Archived');
});

test('Archive: the newest report of each kind is never folded — archived, it stays in the list marked Archived, with Next report and Unarchive (LINKS Part 1 §4)', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  m.fresh();
  const reports = [
    row({ id: 'rall', weekStart: '2020-01-06', weekEnd: '2020-03-11', allTime: true, archivedAt: AT }),
    row({ id: 'ra', weekStart: '2020-03-02', weekEnd: '2020-03-08', archivedAt: AT }),
    row({ id: 'rb', weekStart: '2020-02-24', weekEnd: '2020-03-01', archivedAt: AT }),
    row({ id: 'rc', weekStart: '2020-02-17', weekEnd: '2020-02-23' }),
  ];
  const html = m.page(pageQc(m, { reports }));
  const t = text(html);
  assert.ok(t.includes('All time · Jan 6 – Mar 11') && t.includes('Mar 2 – Mar 8'), 'the newest of each kind stays in the list');
  assert.ok(t.includes('Archived (1)') && !t.includes('Feb 24 – Mar 1'), 'only the rest fold away');
  assert.equal((html.match(/>Next report<\/button>/g) || []).length, 2, 'Next report stays where it lives');
  assert.equal((html.match(/>Unarchive<\/button>/g) || []).length, 2);
  assert.equal((html.match(/>Archive<\/button>/g) || []).length, 1, 'only on the older report that isn’t archived');
  assert.equal(tabCount(html), 'Whole campaign 1');
});

test('Archive: a tab whose reports are all archived says where they went — unless nothing is folded away', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  m.fresh();
  const ra = row({ id: 'ra', weekStart: '2020-03-02', weekEnd: '2020-03-08', archivedAt: AT });
  const rb = row({ id: 'rb', weekStart: '2020-02-24', weekEnd: '2020-03-01', archivedAt: AT });
  let html = m.page(pageQc(m, { reports: [ra, rb] }));
  assert.ok(text(html).includes('Every report here is archived — open Archived below, or press New report.'));
  assert.ok(text(html).includes('Mar 2 – Mar 8') && text(html).includes('Archived (1)'));
  assert.equal(tabCount(html), 'Whole campaign 0');
  // Only the newest, archived: it is the list — nothing below to open.
  m.fresh();
  html = m.page(pageQc(m, { reports: [ra] }));
  assert.ok(!text(html).includes('Every report here is archived') && !text(html).includes('Archived ('));
  assert.ok(text(html).includes('Published Archived'));
});

test('Archive: a report goes under Archived (N) at once, with a line saying so and Undo; Unarchive brings one back; a refusal reads in the page’s banner (K7)', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  m.fresh();
  const reports = [
    row({ id: 'ra', weekStart: '2020-03-02', weekEnd: '2020-03-08' }),
    row({ id: 'rb', weekStart: '2020-02-24', weekEnd: '2020-03-01' }),
    row({ id: 'rc', weekStart: '2020-02-17', weekEnd: '2020-02-23', archivedAt: AT }),
  ];
  const qc = pageQc(m, { reports });
  let html = m.page(qc);
  assert.equal((html.match(/>Archive<\/button>/g) || []).length, 1, 'on the older report only — the newest is where Next report lives');
  click(m, 'Archive');
  const req = m.h().last;
  assert.equal(req.calls.at(-1).variables.row.id, 'rb');
  req.opts.mutationFn(req.calls.at(-1).variables);
  assert.deepEqual(m.h().fetches.at(-1), { url: '/api/admin/client-reports/rb/archive', method: 'POST', body: null });
  html = await settle(m, { report: { _id: 'rb', archivedAt: '2026-10-28T14:00:00Z' } });
  let t = text(html);
  assert.ok(t.includes('Archived — it’s under Archived (2) at the bottom. Undo'), t);
  assert.match(flat(html), /role="status"[^>]*><span class="flex-1">Archived — it’s under Archived \(2\) at the bottom/);
  assert.ok(!t.includes('Feb 24 – Mar 1'), 'folded away at once — the list read again follows');
  assert.equal(tabCount(html), 'Whole campaign 1');
  // Undo: unarchived, back in the list, and the line goes.
  click(m, 'Undo');
  const undo = m.h().last;
  assert.equal(undo.calls.at(-1).variables.row.id, 'rb');
  undo.opts.mutationFn(undo.calls.at(-1).variables);
  assert.deepEqual(m.h().fetches.at(-1), { url: '/api/admin/client-reports/rb/unarchive', method: 'POST', body: null });
  t = text(await settle(m, { report: { _id: 'rb', archivedAt: null } }));
  assert.ok(!t.includes('Archived — it’s under') && t.includes('Feb 24 – Mar 1') && t.includes('Archived (1)'));
  // Unarchive on a folded report: back in the list.
  click(m, 'Archived (1)');
  click(m, 'Unarchive');
  assert.equal(m.h().last.calls.at(-1).variables.row.id, 'rc');
  t = text(await settle(m, { report: { _id: 'rc', archivedAt: null } }));
  assert.ok(!t.includes('Archived (') && t.includes('Feb 17 – Feb 23'));
  // A refusal: the page's banner says which action failed, and nothing moves.
  click(m, 'Archive');
  t = text(await settle(m, Object.assign(new Error('Report not found'), { status: 404, code: 'REPORT_NOT_FOUND' })));
  assert.ok(t.includes('Couldn’t archive the report. Report not found'), t);
  assert.ok(!t.includes('Archived — it’s under'));
});

test('Archive hands the keyboard to its line’s Undo; Unarchive — and Undo — to the report’s row, back in the list: its Archive, or Open on the newest of its kind (code review CC-6)', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  m.fresh();
  const reports = [
    // The newest of its kind, archived: in the list, with Unarchive and no Archive.
    row({ id: 'ra', weekStart: '2020-03-02', weekEnd: '2020-03-08', archivedAt: AT }),
    row({ id: 'rb', weekStart: '2020-02-24', weekEnd: '2020-03-01' }),
  ];
  let html = m.page(pageQc(m, { reports }));
  assert.match(html, /<li [^>]*data-report-row="rb"/, 'each row carries its report’s mark');
  // renderToString attaches no refs: stand-ins in the page's refs after How it works — Undo, then the tab
  // panel, which finds a row and its controls by their marks in the page as last drawn.
  const focused = [];
  const [, undo, panel] = refSlots(m, 'page');
  undo.current = { focus: () => focused.push('Undo') };
  const rowOf = (id) => {
    const at = html.indexOf(`data-report-row="${id}"`);
    return at < 0 ? null : html.slice(at, html.indexOf('</li>', at));
  };
  panel.current = {
    querySelector: (sel) => {
      const id = (sel.match(/^\[data-report-row="([^"]+)"\]$/) || [])[1];
      const block = id ? rowOf(id) : null;
      if (!block) return null;
      return {
        querySelector: (inner) => {
          const action = (inner.match(/^\[data-row-action="(\w+)"\]$/) || [])[1];
          return action && block.includes(`data-row-action="${action}"`) ? { focus: () => focused.push(`${id} ${action}`) } : null;
        },
      };
    },
  };
  runEffects(m, 'page');
  assert.deepEqual(focused, [], 'nothing moves on its own');
  click(m, 'Archive');
  html = await settle(m, { report: { _id: 'rb', archivedAt: '2026-10-28T14:00:00Z' } });
  runEffects(m, 'page');
  assert.deepEqual(focused, ['Undo'], 'the row folded away: Undo takes it');
  click(m, 'Undo');
  html = await settle(m, { report: { _id: 'rb', archivedAt: null } });
  runEffects(m, 'page');
  assert.deepEqual(focused, ['Undo', 'rb archive'], 'back in the list: its Archive');
  click(m, 'Unarchive');
  html = await settle(m, { report: { _id: 'ra', archivedAt: null } });
  runEffects(m, 'page');
  assert.deepEqual(focused, ['Undo', 'rb archive', 'ra open'], 'the newest of its kind has no Archive: Open');
});

test('the list page: Take down and Delete say what happens to the report’s own link — and Delete, while an old link to all your reports still works, says that link shows it (LINKS §D2)', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  m.fresh();
  const shown = row();
  const qc = pageQc(m, { reports: [shown], shares: [link(), ownLink(), elsewhere] });
  m.page(qc);
  let t = text(handed(m, 'ReportRow', 'onTakeDown', shown));
  assert.ok(
    t.includes('Take down this report? Your client stops seeing it. It stays exactly as it was — numbers, map and publish date — and Put back up shows it again. Its link shows “taken down” until you put it back up. Any build or new numbers waiting for review are cancelled.'),
    t
  );
  click(m, 'Cancel');
  let html = handed(m, 'ReportRow', 'onDelete', shown);
  t = text(html);
  assert.ok(
    t.includes('Delete this report? Your client can open the Oct 19 – Oct 25 report right now. Deleting it also deletes its link — anyone who opens it then reads “This link isn’t available.” To hide it but keep it, use Take down instead. This can’t be undone.'),
    t
  );
  assert.match(html, /<p class="text-danger-fg">Your client can open the Oct 19 – Oct 25 report right now\.<\/p>/);
  // Deleted: its link went with it, so the links list (and History) is read again.
  const invalidated = [];
  const real = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = (f) => {
    invalidated.push(JSON.stringify(f?.queryKey));
    return real(f);
  };
  click(m, 'Delete');
  assert.deepEqual(m.h().last.calls[0].variables, { row: shown, erase: false });
  await settle(m, { ok: true });
  assert.ok(invalidated.includes(JSON.stringify(['admin', 'client-report-shares', CID])), invalidated.join(' '));
  // No link of its own, beside a working old link to all your reports: Delete says that link shows it;
  // Take down has no line about a link.
  m.fresh();
  m.page(pageQc(m, { reports: [shown], shares: [link()] }));
  t = text(handed(m, 'ReportRow', 'onDelete', shown));
  assert.ok(t.includes('The Oct 19 – Oct 25 report has no link of its own, but your old link to all your reports shows it — deleting it takes it off that too. This can’t be undone.'), t);
  click(m, 'Cancel');
  t = text(handed(m, 'ReportRow', 'onTakeDown', shown));
  assert.ok(!t.includes('Its link shows'));
  // Once the switch has turned the old links off, it's only the report.
  m.fresh();
  m.page(pageQc(m, { reports: [shown], shares: [link()], allReportsRetired: true }));
  t = text(handed(m, 'ReportRow', 'onDelete', shown));
  assert.ok(t.includes('The Oct 19 – Oct 25 report has no link of its own, so this deletes only the report. This can’t be undone.'), t);
  // Taken down, with its link: it goes too.
  m.fresh();
  const down = row({ takenDownAt: '2026-10-27T14:00:00Z' });
  m.page(pageQc(m, { reports: [down], shares: [ownLink()] }));
  t = text(handed(m, 'ReportRow', 'onDelete', down));
  assert.ok(t.includes('Your client already can’t see the Oct 19 – Oct 25 report — it was taken down. Deleting it also deletes its link, for good. This can’t be undone.'), t);
});

test('the list page: a new report whose dates start after today opens the builder saying so (?ahead=1), as Next does (WEEK-3)', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  for (const [warnings, to] of [
    [['STARTS_AFTER_TODAY'], `/campaigns/${CID}/reports/rA?ahead=1`],
    [undefined, `/campaigns/${CID}/reports/rA`],
  ]) {
    m.fresh();
    const qc = pageQc(m);
    m.page(qc);
    click(m, 'New report');
    landPicker(m, qc);
    click(m, 'Create draft');
    await settle(m, { report: { _id: 'rA' }, build: { status: 'queued' }, ...(warnings ? { warnings } : {}) });
    assert.deepEqual(m.h().navigations.at(-1), { to, opts: null });
  }
});

test('the list page: Next refused NEXT_GAP_TOO_LONG opens New report on the tab with the suggested dates picked', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  m.fresh();
  const last = row({ id: 'rl', weekStart: '2026-09-01', weekEnd: '2026-09-09', status: 'published' });
  const qc = pageQc(m, { reports: [last] });
  m.page(qc);
  click(m, 'Next report');
  const sentence = 'More than two weeks have passed since this report. Choose the next report’s dates in New report.';
  assert.ok(text(await settle(m, refusal('NEXT_GAP_TOO_LONG', { error: sentence, catchUp: { weekStart: '2026-09-10', weekEnd: '2026-10-25' }, suggested: { weekStart: '2026-10-19', weekEnd: '2026-10-25' } }))).includes('New report'));
  const html = landPicker(m, qc);
  const t = text(html);
  assert.ok(t.includes('New report'), 'New report opens');
  // The server's own sentence says why, at the top of the dates (code review round 2, FRESH-3).
  assert.ok(t.includes(`Dates ${sentence} ${TOTALS_LINE()} Last week · Oct 19 – Oct 25 No report covers Sep 10 – Oct 18.`), 'the suggestion, naming the gap');
  assert.deepEqual(ticks(html, 'report-dates'), [true, false, false, false]);
  assert.ok(!t.includes('Couldn’t start the next report.'), 'not an error');
  // Any other refusal is the banner, as before.
  m.fresh();
  m.page(pageQc(m, { reports: [last] }));
  click(m, 'Next report');
  assert.ok(text(await settle(m, refusal('NOT_LATEST_REPORT'))).includes('Couldn’t start the next report.'));
});

test('the list page: ?new=1&seriesId=&weekStart=&weekEnd= opens New report with those dates, on that tab, then drops the params (contract K10)', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  m.fresh({ search: 'new=1&seriesId=sc&weekStart=2026-10-19&weekEnd=2026-10-25&tab=other' });
  const qc = pageQc(m, { reports: [row({ id: 'rl', weekStart: '2026-09-01', weekEnd: '2026-09-09' })] });
  let t = text(m.page(qc));
  assert.ok(!t.includes('Pick dates'), 'not before its effect');
  const cleanups = m.h().effects.filter((e) => e.module === 'page').map((e) => e.fn()).filter((c) => typeof c === 'function');
  assert.equal(cleanups.length, 0, 'it starts nothing that needs stopping');
  assert.deepEqual(m.h().setParams, [{ search: 'tab=sc', opts: { replace: true } }], 'the params go, the tab is the series’');
  m.rerender();
  const html = landPicker(m, qc);
  t = text(html);
  assert.ok(t.includes('Last week · Oct 19 – Oct 25 No report covers Sep 10 – Oct 18.'));
  assert.deepEqual(ticks(html, 'report-dates'), [true, false, false, false]);
  // Without new=1, or before the series list is here: nothing.
  m.fresh({ search: 'tab=sc' });
  m.page(pageQc(m));
  m.h().effects.filter((e) => e.module === 'page').forEach((e) => e.fn());
  assert.deepEqual(m.h().setParams, []);
  m.fresh({ search: 'new=1&seriesId=sc&weekStart=2026-10-19&weekEnd=2026-10-25' });
  m.page(pageQc(m, { series: null }));
  m.h().effects.filter((e) => e.module === 'page').forEach((e) => e.fn());
  assert.deepEqual(m.h().setParams, [], 'waits for the series list');
});
