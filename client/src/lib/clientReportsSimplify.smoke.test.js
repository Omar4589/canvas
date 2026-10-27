import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import { todayIn } from '../components/clientReports/reportDates.js';

// The Client Reports "simpler start", clicked through (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §B–§E):
// the guide (Got it, How it works, storage that fails, the phone lines), New report's dated choices with
// the organization's week (Change, the nudge, Move this tab, admins and leads), the duplicate prompt and
// the race note, Share (the link chooser, Make a link, a password shown once, the message's endings), the
// links panel (one-report links folded away, New link's Opens), and the list page's own wiring: Share on a
// row, Next refused NEXT_GAP_TOO_LONG, the ?new=1 link (contract K10), and the Take down / Delete confirms.
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
const SHIMMED = { 'ClientReportsPage.jsx': 'page', 'NewReportDialog.jsx': 'newReport', 'ShareDialog.jsx': 'share', 'ClientLinksPanel.jsx': 'links', 'HowItWorks.jsx': 'guide' };
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
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientReportsPage from '${join(here, '../pages/ClientReportsPage.jsx')}';
import NewReportDialog from '${C('NewReportDialog.jsx')}';
import ShareDialog from '${C('ShareDialog.jsx')}';
import ClientLinksPanel from '${C('ClientLinksPanel.jsx')}';
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
  globalThis.__h = { stores: {}, effects: [], handlers: [], last: null, fetches: [], copied: [], navigations: [], setParams: [], search, auth, storageBroken };
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
export const share = (props, qc = newQc()) => show(() => wrap(qc, <ShareDialog campaignId="${CID}" tz="America/New_York" onClose={() => {}} {...props} />));
export const links = (shares, reports = [], qc = newQc([[['admin', 'client-report-shares', '${CID}'], { shares }]]), extra = {}) => show(() => wrap(qc, <ClientLinksPanel campaignId="${CID}" tz="America/New_York" reports={reports} {...extra} />));
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
const R1 = { id: 'r1', weekStart: '2026-10-19', weekEnd: '2026-10-25', scopeLabel: 'Whole campaign' };
const board = (over = {}) => link({ id: 'b1', token: 'tokBoard00001', label: 'Board', reportId: 'r1', report: R1, ...over });
const donorElsewhere = link({ id: 'd2', token: 'tokDonor00002', label: 'Donor', reportId: 'r0', report: { id: 'r0', weekStart: '2026-10-12', weekEnd: '2026-10-18', scopeLabel: 'Whole campaign' } });
const messageReport = { id: 'r1', weekStart: '2026-10-19', weekEnd: '2026-10-25', campaignType: 'survey', scope: { kind: 'campaign', label: 'Whole campaign', seriesLabel: 'Whole campaign' }, cumulative: { doorsKnocked: 3412, surveysTaken: 1980 }, period: { doorsKnocked: 412, surveysTaken: 260 } };
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
// `series: null`: the series picker hasn't answered yet; `shares: null`: nor the links list.
const pageQc = (m, { reports = [row()], shares = [], series = picker() } = {}) =>
  m.newQc([
    [['admin', 'campaigns'], { campaigns: [{ _id: CID, name: 'Ward 3', type: 'survey', isActive: true, timeZone: 'America/New_York' }] }],
    [['admin', 'client-reports', CID], { reports }],
    ...(series ? [[['admin', 'client-report-series', CID], series]] : []),
    ...(shares ? [[['admin', 'client-report-shares', CID], { shares }]] : []),
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
  for (const s of ['Make a report — press New report and pick the dates, usually Last week.', 'Check it, then publish — the preview is exactly what your client will see.', 'Share it — Share gives you a message with the link']) {
    assert.ok(t.includes(s), s);
  }
  assert.ok(html.includes('href="/help/client-reports"') && t.includes('More in the Help Center →'), 'the Help Center’s guide');
  // Below 640 px: the short lines, and no Help line (the Help link and the long steps hide there).
  assert.match(html, /<ol class="[^"]*sm:hidden[^"]*"><li>Make a report — usually Last week; then Next report each week\.<\/li><li>Check the preview, then publish\.<\/li><li>Share the link; send its password separately\.<\/li><\/ol>/);
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
  assert.ok(t.includes('You already have a draft Whole campaign report for Oct 19 – Oct 25. Open the draft Make a second one Your client sees both once both are published.'));
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

// ── Share (§D, contract K9) ───────────────────────────────────────────────────────────────────────

test('Share with no link that opens the report: Make a link is the main action, All your reports picked', async () => {
  const m = await load();
  m.fresh();
  const html = m.share({ report: messageReport, shares: [donorElsewhere] });
  const t = text(html);
  assert.ok(t.includes('Share “Oct 19 – Oct 25 · Whole campaign”'));
  assert.ok(t.includes('All your reports (the usual choice) — one link and one password; next week’s report shows up on it too.'));
  assert.ok(t.includes('Just this report — for someone who should see only this one (a donor, a board member). It has its own password, and next week’s report won’t be on it.'));
  assert.deepEqual(ticks(html, 'share-kind'), [true, false]);
  assert.ok(t.includes('A password is shown once, right after the link is made — copy it then.'));
  assert.equal(disabledButton(html, 'Copy message'), true, 'no link, no message');
  assert.ok(!t.includes('Message (no password in it)') && !t.includes('Donor'), 'another report’s link is never offered');
  assert.ok(!t.includes('Make a link Make a link'), 'one Make a link');
});

test('Share: the links that open this report, all-reports first; the message ends by the link; no password for an existing link', async () => {
  const m = await load();
  m.fresh();
  const expired = link({ id: 'x', label: 'Old', expiresAt: iso(NOW - DAY) });
  let html = m.share({ report: messageReport, shares: [board(), donorElsewhere, expired, link()] });
  let t = text(html);
  assert.ok(t.includes('Candidate — opens all your reports Board — opens only this report'), 'the chooser, all-reports first');
  assert.ok(!t.includes('Donor') && !t.includes('Old —'), 'never another report’s link, never one that can’t open');
  assert.deepEqual(ticks(html, 'share-link'), [true, false]);
  assert.ok(t.includes('doorline.app/r/tokCa…') && t.includes('Copy link'));
  assert.match(t, /Open it here: https:\/\/doorline\.app\/r\/tokCandidate1\/reports\/r1 — use the password I sent you\./);
  assert.ok(!t.includes('Copy password'), 'an existing link’s password is stored hashed — never shown');
  assert.ok(t.includes('Make a link'), 'always there');
  html = choose(m, 'Board — opens only this report');
  t = text(html);
  assert.match(t, /Open it here: https:\/\/doorline\.app\/r\/tokBoard00001\/reports\/r1 — use the password I sent you for this report\./);
  click(m, 'Copy message');
  await new Promise((r) => setTimeout(r, 0));
  assert.match(m.h().copied.at(-1), /— use the password I sent you for this report\.$/);
});

test('Share → Make a link → Just this report: its password once, Copy password, and the message for a link made just now', async () => {
  const m = await load();
  m.fresh();
  let changed = 0;
  m.share({ report: messageReport, shares: [link()], onLinksChanged: () => (changed += 1) });
  click(m, 'Make a link');
  choose(m, 'Just this report');
  let html = fill(m, 'e.g. Board', 'Donor');
  click(m, 'Create link');
  const req = m.h().last;
  assert.deepEqual(req.calls[0].variables, { campaignId: CID, label: 'Donor', expiresInDays: 90, reportId: 'r1' });
  req.opts.mutationFn(req.calls[0].variables);
  assert.equal(m.h().fetches.pop().url, '/api/admin/client-reports/shares');
  const made = link({ id: 'n1', token: 'tokDonorNew01', label: 'Donor', reportId: 'r1', report: R1 });
  html = await settle(m, { share: made, generatedPassword: 'Plum-Ladder-Quiet-42' });
  const t = text(html);
  assert.equal(changed, 1, 'the links list and History are read again');
  assert.ok(t.includes('Password for Donor: Plum-Ladder-Quiet-42 Copy password — shown once. Send it separately from the message.'));
  assert.ok(t.includes('Donor — opens only this report'));
  assert.deepEqual(ticks(html, 'share-link'), [false, true], 'the new link is the one the message uses');
  assert.match(t, /Open it here: https:\/\/doorline\.app\/r\/tokDonorNew01\/reports\/r1 — I’ll send you its password separately\./);
  click(m, 'Copy password');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(m.h().copied.at(-1), 'Plum-Ladder-Quiet-42');
  // Back on the link that was there before: its own ending.
  assert.match(text(choose(m, 'Candidate — opens all your reports')), /— use the password I sent you\./);
});

test('Share before the links list is in: it waits — no Make a link, no message — and a list that failed says so (LINK-3)', async () => {
  const m = await load();
  m.fresh();
  const html = m.share({ report: messageReport, shares: null });
  let t = text(html);
  assert.ok(t.includes('Link Loading links…'), t);
  assert.ok(!t.includes('Make a link') && !t.includes('All your reports (the usual choice)'), 'nothing offered on a list it hasn’t read');
  assert.ok(!t.includes('Message (no password in it)'));
  assert.equal(disabledButton(html, 'Copy message'), true);
  m.fresh();
  t = text(m.share({ report: messageReport, shares: null, linksError: Object.assign(new Error('Couldn’t reach Doorline.'), { status: 0 }) }));
  assert.ok(t.includes('Couldn’t load the links. Couldn’t reach Doorline.') && !t.includes('Loading links…') && !t.includes('Make a link'));
});

test('Share: when the links meant for it can’t open (expired), it says so and offers a new one; a refusal reads in words', async () => {
  const m = await load();
  m.fresh();
  const html = m.share({ report: messageReport, shares: [link({ expiresAt: iso(NOW - DAY) })] });
  assert.ok(text(html).includes('Your only link expired — renew it.'));
  assert.deepEqual(ticks(html, 'share-kind'), [true, false]);
  click(m, 'Create link');
  assert.deepEqual(m.h().last.calls[0].variables, { campaignId: CID, label: undefined, expiresInDays: 90 }, 'All your reports: no reportId');
  const t = text(await settle(m, refusal('REPORT_NOT_SHOWN', { error: 'That report isn’t up — a link to it would only say “taken down”.' })));
  assert.ok(t.includes('Couldn’t create the link. That report isn’t up — a link to it would only say “taken down”.'));
});

// ── The links panel (§D) ──────────────────────────────────────────────────────────────────────────

test('links panel: all-reports links first, one-report links folded under their own heading, each saying what it opens', async () => {
  const m = await load();
  m.fresh();
  const donor = board({ id: 'b2', token: 'tokDonor00009', label: 'Donor' });
  let html = m.links([board(), link(), donor]);
  let t = text(html);
  assert.ok(t.includes('A link opens all your reports, or just one. Each has its own password — send it separately.'));
  assert.ok(t.includes('Opens all your reports'));
  assert.ok(t.includes('Links to one report (2)'));
  assert.ok(!t.includes('Opens only the'), 'folded away until opened');
  assert.match(html, /aria-expanded="false"[^>]*>.*Links to one report/);
  t = text(click(m, 'Links to one report (2)'));
  assert.equal((t.match(/Opens only the Oct 19 – Oct 25 report \(Whole campaign\)/g) || []).length, 2);
  assert.ok(t.indexOf('Opens all your reports') < t.indexOf('Links to one report'), 'all-reports links on top');
  // No one-report link: no heading.
  m.fresh();
  assert.ok(!text(m.links([link()])).includes('Links to one report'));
});

test('links panel → New link: Opens all your reports, or one report the client can see now — next week’s won’t be on it', async () => {
  const m = await load();
  m.fresh();
  const reports = [
    row(),
    row({ id: 'r2', weekStart: '2026-10-12', weekEnd: '2026-10-18', seriesLabel: 'Paid team', scope: { kind: 'team', label: 'Paid team' } }),
    row({ id: 'r3', weekStart: '2026-10-05', weekEnd: '2026-10-11', takenDownAt: '2026-10-20T14:00:00Z' }),
    row({ id: 'r4', status: 'draft', publishedAt: null }),
  ];
  m.links([link()], reports);
  let html = click(m, '+ New link');
  let t = text(html);
  assert.ok(t.includes('Opens All your reports One report only'));
  html = choose(m, 'One report only');
  t = text(html);
  assert.ok(t.includes('— next week’s report won’t be on it.'));
  assert.match(html, /<option value="r1" selected="">Oct 19 – Oct 25 \(Whole campaign\)<\/option><option value="r2">Oct 12 – Oct 18 \(Paid team\)<\/option><\/select>/, 'only the reports a client can see now, newest first');
  assert.ok(html.includes('placeholder="e.g. Board"'));
  fill(m, 'Report', 'r2');
  click(m, 'Create link');
  assert.deepEqual(m.h().last.calls[0].variables, { campaignId: CID, label: undefined, expiresInDays: 90, reportId: 'r2' });
  // Made: the Link ready dialog's message says "this report".
  t = text(await settle(m, { share: link({ id: 'n2', token: 'tokNew000002', label: '', reportId: 'r2', report: { id: 'r2', weekStart: '2026-10-12', weekEnd: '2026-10-18', scopeLabel: 'Paid team' } }), generatedPassword: 'Kite-Harbor-Mint-77' }));
  assert.ok(t.includes('Link ready') && t.includes('Kite-Harbor-Mint-77'));
  click(m, 'Copy message');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(m.h().copied.at(-1), 'Here\'s the link to this report: https://doorline.app/r/tokNew000002 — I’ll send the password separately.');
  // No report a client can see: One report only waits for one.
  m.fresh();
  m.links([], [row({ status: 'draft' })]);
  html = click(m, '+ New link');
  assert.ok(text(html).includes('One report only — publish a report first'));
  assert.match(html, /<input type="radio" class="accent-brand-accent" disabled=""/);
});

test('links panel → New link: “One report only” sends the report its select shows — the list arriving or changing after the dialog opened — and never an all-reports link in its place (LINK-1)', async () => {
  const m = await load();
  m.fresh();
  // The reports list is still on its way when New link opens (the page hands the panel null meanwhile).
  let reports = null;
  const qc = m.newQc([[['admin', 'client-report-shares', CID], { shares: [link()] }]]);
  m.links([link()], null, qc);
  let html = click(m, '+ New link');
  assert.ok(text(html).includes('One report only — loading your reports…'));
  assert.match(html, /<input type="radio" class="accent-brand-accent" disabled=""/, 'nothing to pick yet');
  reports = [row(), row({ id: 'r2', weekStart: '2026-10-12', weekEnd: '2026-10-18' })];
  m.links([link()], reports, qc);
  html = choose(m, 'One report only');
  assert.match(html, /<option value="r1" selected="">Oct 19 – Oct 25/, 'the select shows the newest');
  click(m, 'Create link');
  assert.deepEqual(m.h().last.calls.at(-1).variables, { campaignId: CID, label: undefined, expiresInDays: 90, reportId: 'r1' }, 'and the request names that one');
  // The report picked leaves the list (taken down meanwhile): the select and the request move together.
  m.h().last.isPending = false;
  fill(m, 'Report', 'r2');
  reports.splice(1, 1);
  html = m.rerender();
  assert.match(html, /<option value="r1" selected="">/);
  click(m, 'Create link');
  assert.equal(m.h().last.calls.at(-1).variables.reportId, 'r1');
  // None left to pick: Create waits — no all-reports link is made in its place.
  m.h().last.isPending = false;
  const sent = m.h().last.calls.length;
  reports.length = 0;
  html = m.rerender();
  assert.equal(disabledButton(html, 'Create link'), true);
  assert.equal(m.h().last.calls.length, sent);
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
      'You already published a Whole campaign report for Oct 19 – Oct 25, taken down. Open it Make a second one Your client sees only the new one; the taken-down one stays hidden unless you put it back up.'
    ),
    'a taken-down one stays hidden (FRESH-5)'
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

test('the guide’s Got it hands the keyboard to How it works; Share’s Make a link to its first choice, Create link to the new Copy password (FRESH-4)', async () => {
  const m = await load();
  m.storage.clear();
  m.fresh();
  m.page(pageQc(m));
  const focused = [];
  const [how] = refSlots(m, 'page');
  how.current = { focus: () => focused.push('How it works') };
  click(m, 'Got it');
  assert.deepEqual(focused, ['How it works']);
  // Share: Make a link, then Create link.
  m.fresh();
  m.share({ report: messageReport, shares: [link()] });
  const [make, passwords] = refSlots(m, 'share');
  make.current = { querySelector: (sel) => (sel === 'input[type="radio"]' ? { focus: () => focused.push('All your reports') } : null) };
  click(m, 'Make a link');
  runEffects(m, 'share');
  assert.equal(focused.at(-1), 'All your reports');
  click(m, 'Create link');
  await settle(m, { share: link({ id: 'n1', token: 'tokNew000001', label: 'Field' }), generatedPassword: 'Owl-Cedar-Tide-31' });
  passwords.current = { querySelectorAll: () => [{ focus: () => focused.push('an older Copy password') }, { focus: () => focused.push('the new Copy password') }] };
  runEffects(m, 'share');
  assert.equal(focused.at(-1), 'the new Copy password');
});

test('Share keeps every link made in it with its password until Done, each with how to recover it (FRESH-7)', async () => {
  const m = await load();
  m.fresh();
  m.share({ report: messageReport, shares: [link()] });
  click(m, 'Make a link');
  fill(m, 'e.g. Candidate', 'Field director');
  click(m, 'Create link');
  await settle(m, { share: link({ id: 'n1', token: 'tokField00001', label: 'Field director' }), generatedPassword: 'Owl-Cedar-Tide-31' });
  click(m, 'Make a link');
  choose(m, 'Just this report');
  fill(m, 'e.g. Board', 'Treasurer');
  click(m, 'Create link');
  const html = await settle(m, { share: link({ id: 'n2', token: 'tokTreas00002', label: 'Treasurer', reportId: 'r1', report: R1 }), generatedPassword: 'Fern-Quarry-Lamp-58' });
  const t = text(html);
  const line = (label, pw) => `Password for ${label}: ${pw} Copy password — shown once. Send it separately from the message. Lost it? Change password on the link.`;
  assert.ok(t.includes(line('Field director', 'Owl-Cedar-Tide-31')) && t.includes(line('Treasurer', 'Fern-Quarry-Lamp-58')), t);
  assert.match(t, /Open it here: https:\/\/doorline\.app\/r\/tokTreas00002\/reports\/r1 — I’ll send you its password separately\./, 'the newest link is the one the message uses');
  // Each Copy password copies its own link's.
  const copyButtons = m.h().handlers.filter((x) => x.text === 'Copy password');
  copyButtons[0].props.onClick();
  copyButtons[1].props.onClick();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(m.h().copied.slice(-2), ['Owl-Cedar-Tide-31', 'Fern-Quarry-Lamp-58']);
  // Back on the first one made: its message still says the password comes separately.
  assert.match(text(choose(m, 'Field director — opens all your reports')), /— I’ll send you its password separately\./);
});

test('a links list or reports list that failed is never a dead end: Share and the panel say so with Try again, and reading again starts at once; New link says it couldn’t load your reports (VER-2)', async () => {
  const m = await load();
  const SHARES_URL = `/api/admin/client-reports/shares?campaignId=${CID}`;
  const REPORTS_URL = `/api/admin/client-reports?campaignId=${CID}`;
  const reads = (url) => m.h().fetches.filter((f) => f.url === url).length;
  // The page's own query for a list, failed after its retry (its read is the one Try again repeats).
  const failed = (qc, key, url) => {
    // As in a browser, where the list's own observer was already there when it failed: no read on mount.
    qc.setDefaultOptions({ queries: { ...qc.getDefaultOptions().queries, retryOnMount: false } });
    const q = qc.getQueryCache().build(qc, { queryKey: key, queryFn: () => fetch(url).then((r) => r.json()) });
    q.setState({ status: 'error', error: Object.assign(new Error('Couldn’t reach Doorline.'), { status: 0 }), errorUpdatedAt: Date.now(), errorUpdateCount: 1, fetchStatus: 'idle' });
    return qc;
  };
  // Share, opened after the links list failed: it reads it again at once, and Try again does too.
  m.fresh();
  const qc = failed(m.newQc(), ['admin', 'client-report-shares', CID], SHARES_URL);
  let t = text(m.share({ report: messageReport, shares: null, linksError: Object.assign(new Error('Couldn’t reach Doorline.'), { status: 0 }) }, qc));
  assert.ok(t.includes('Couldn’t load the links. Couldn’t reach Doorline. Try again') && !t.includes('Make a link'), t);
  runEffects(m, 'share');
  assert.equal(reads(SHARES_URL), 1, 'opening Share after a failure reads the list again');
  t = text(m.rerender());
  assert.ok(t.includes('Loading links…') && !t.includes('Try again'), 'while it reads again');
  qc.getQueryCache().find({ queryKey: ['admin', 'client-report-shares', CID] }).setState({ fetchStatus: 'idle' });
  m.rerender();
  click(m, 'Try again');
  assert.equal(reads(SHARES_URL), 2, 'Try again reads it again');
  // The links panel's own list failed: Try again there too.
  m.fresh();
  const pqc = failed(m.newQc(), ['admin', 'client-report-shares', CID], SHARES_URL);
  t = text(m.links([], [], pqc));
  assert.ok(t.includes('Couldn’t load the links. Couldn’t reach Doorline. Try again'), t);
  const before = reads(SHARES_URL);
  click(m, 'Try again');
  assert.equal(reads(SHARES_URL), before + 1);
  // New link, the reports list failed: it says so with Try again — never "loading your reports…" for good.
  m.fresh();
  const rqc = failed(m.newQc([[['admin', 'client-report-shares', CID], { shares: [] }]]), ['admin', 'client-reports', CID], REPORTS_URL);
  m.links([], null, rqc, { reportsError: Object.assign(new Error('Couldn’t reach Doorline.'), { status: 0 }) });
  t = text(click(m, '+ New link'));
  assert.ok(t.includes('One report only Couldn’t load your reports. Try again') && !t.includes('loading your reports'), t);
  const r0 = reads(REPORTS_URL);
  runEffects(m, 'links');
  assert.equal(reads(REPORTS_URL), r0 + 1, 'opening New link after a failure reads the reports again');
  rqc.getQueryCache().find({ queryKey: ['admin', 'client-reports', CID] }).setState({ fetchStatus: 'idle' });
  m.rerender();
  click(m, 'Try again');
  assert.equal(reads(REPORTS_URL), r0 + 2, 'and so does Try again');
});

test('links panel: a one-report link whose report is taken down says so under what it opens (FRESH-6)', async () => {
  const m = await load();
  m.fresh();
  m.links([board({ report: { ...R1, takenDown: true } }), board({ id: 'b2', token: 'tokBoard00002', label: 'Donor' })]);
  const html = click(m, 'Links to one report (2)');
  assert.equal((text(html).match(/Its report is taken down — the link shows “taken down” until you put it back up\./g) || []).length, 1, 'only under the link whose report is down');
  const at = html.indexOf('Its report is taken down');
  assert.ok(html.indexOf('value="Board"') < at && at < html.indexOf('value="Donor"'), 'in Board’s row');
});

// ── The list page's wiring (§C, §D, K10) ──────────────────────────────────────────────────────────

test('the list page: Share on a shown report’s row opens Share for it', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  m.fresh();
  const qc = pageQc(m, { reports: [row(), row({ id: 'r0', weekStart: '2026-10-12', weekEnd: '2026-10-18', takenDownAt: '2026-10-22T14:00:00Z' })], shares: [link()] });
  const html = m.page(qc);
  let t = text(html);
  assert.equal((html.match(/>Share<\/button>/g) || []).length, 1, 'one Share — the taken-down report has none');
  assert.ok(!t.includes('Copy message'));
  t = text(click(m, 'Share'));
  assert.ok(t.includes('Share “Oct 19 – Oct 25 · Whole campaign”') && t.includes('Candidate — opens all your reports'));
  assert.match(t, /— use the password I sent you\./);
});

test('the list page: Share pressed before the links list is in waits for it, then shows the link — never an extra one (LINK-3)', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  m.fresh();
  const qc = pageQc(m, { reports: [row()], shares: null });
  m.page(qc);
  const dialog = (html) => {
    const t = text(html);
    return t.slice(t.indexOf('Share “'));
  };
  let d = dialog(click(m, 'Share'));
  assert.ok(d.startsWith('Share “Oct 19 – Oct 25 · Whole campaign”') && d.includes('Loading links…'), d);
  assert.ok(!d.includes('Make a link'));
  qc.setQueryData(['admin', 'client-report-shares', CID], { shares: [link()] });
  d = dialog(m.rerender());
  assert.ok(d.includes('Candidate — opens all your reports') && !d.includes('Loading links…'));
  assert.match(d, /— use the password I sent you\./);
});

test('the list page: a report whose own link expired says to renew it, even beside a working link to another report (LINK-2)', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  m.fresh();
  let t = text(m.page(pageQc(m, { reports: [row()], shares: [link({ expiresAt: iso(NOW - DAY) }), donorElsewhere] })));
  assert.ok(t.includes('Your only link expired — renew it.'), t);
  assert.ok(!t.includes('your links open other reports'));
  // No link of any state opens it: then it says the links open other reports.
  m.fresh();
  t = text(m.page(pageQc(m, { reports: [row()], shares: [{ ...donorElsewhere, isActive: false }] })));
  assert.ok(t.includes('No link opens this report — your links open other reports. Share makes one.'));
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

test('the list page: Take down and Delete name the report’s one-report links; Delete counts only the links that open it', async () => {
  const m = await load();
  m.storage.set(GUIDE_KEY, '1');
  m.fresh();
  const shown = row();
  const qc = pageQc(m, { reports: [shown], shares: [link(), board(), donorElsewhere] });
  m.page(qc);
  let t = text(handed(m, 'ReportRow', 'onTakeDown', shown));
  assert.ok(t.includes('Take down this report?'));
  assert.ok(
    t.includes('Your client stops seeing it. It stays exactly as it was — numbers, map and publish date — and Put back up shows it again. Board, a link to just this report, shows “taken down” until you put it back up. Any build or new numbers waiting for review are cancelled.')
  );
  assert.ok(!t.includes('Donor'), 'another report’s link isn’t this report’s');
  click(m, 'Cancel');
  t = text(handed(m, 'ReportRow', 'onDelete', shown));
  assert.ok(t.includes('Your client can see the Oct 19 – Oct 25 report right now — it shows on 2 links: Candidate, Board.'), 'never another report’s link');
  assert.ok(t.includes('Its link Board (just this report) stops working for good.'));
  // Deleted: its one-report links went with it, so the links list (and History) is read again.
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
  // A taken-down report says its own links go too; a report with none says nothing about links.
  m.fresh();
  const down = row({ takenDownAt: '2026-10-27T14:00:00Z' });
  m.page(pageQc(m, { reports: [down], shares: [board()] }));
  t = text(handed(m, 'ReportRow', 'onDelete', down));
  assert.ok(t.includes('Your client already can’t see the Oct 19 – Oct 25 report — it was taken down. Deleting it removes it for good. This can’t be undone. Its link Board (just this report) stops working for good.'));
  m.fresh();
  m.page(pageQc(m, { reports: [shown], shares: [link()] }));
  t = text(handed(m, 'ReportRow', 'onTakeDown', shown));
  assert.ok(!t.includes('a link to just this report'));
});
