import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import { defaultScheduler, notifyManager } from '@tanstack/react-query';

// FLOW tests for Share and the old-links card (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §D1, §D3): the REAL
// Client Reports page with its real Share dialog, old-links card, rows and Overlay (portal, focus trap,
// focus restore), a real QueryClient and react-dom's client renderer — real effects, refs and focus — with
// the API answering whenever a test chooses. The render smoke tests (clientReportShareLinks.smoke,
// renderToString) never mount, so they can't see where the keyboard goes. Each test below is a code
// review finding (round 2):
//   - V2-1: a press whose own button goes with its success — Turn on, Unlock now, Renew link, an Extend
//     date, a confirm's New address, Show, Delete link, an extra link's Delete, the card's Delete — and
//     the Cancel and Close that put a panel away, dropped the keyboard to <body>, outside Share's Tab loop.
//     It goes to what stays in its place instead.
//   - N1: Copy link took the keyboard after Same as … only when Share's own state was drawn before the
//     list's answer: react-query's notification and React's scheduler land in either order.
//   - V2-2: Create refused because the report was taken down or deleted somewhere else read only the
//     links again, so Share kept offering Create link and the row kept offering Take down.
//
// The repo has no jsdom: this file carries a minimal DOM — what react-dom's client renderer touches, the
// selectors the page and the Overlay use, a focus() that refuses what a browser refuses (a disabled
// control, one that isn't focusable, one outside the document), and the browser's "focus falls to body
// when its element goes" rule (memberDeletionFlow.smoke's DOM, grown for this page). node --test runs
// each file in its own process, so these globals never meet another test. Only auth and the API client
// are stood in for.

const here = fileURLToPath(new URL('.', import.meta.url));
// Inside the client tree on purpose: dependencies stay external to the bundle, so node resolves react,
// react-dom and react-query from the bundle's own location — the same instances this file imports.
const dir = mkdtempSync(join(here, '../../.smoke-cr-share-flow-'));

const CID = '6a0000000000000000000001';
const TZ = 'America/New_York';

writeFileSync(
  join(dir, 'authStub.jsx'),
  `export const useAuth = () => globalThis.__auth;
   export const useOrgTimeZone = () => '${TZ}';
   export const useSignOut = () => () => {};`
);
writeFileSync(
  join(dir, 'apiStub.js'),
  `export const api = (path, options) => globalThis.__api(path, options || {});
   export const getToken = () => null;
   export const getActiveOrgId = () => null;
   export const setToken = () => {};
   export const setActiveOrgId = () => {};`
);
writeFileSync(
  join(dir, 'entry.jsx'),
  `import React from 'react';
   import { createRoot } from 'react-dom/client';
   import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
   import { MemoryRouter, Routes, Route } from 'react-router-dom';
   import ClientReportsPage from '${join(here, '../pages/ClientReportsPage.jsx')}';
   export const mount = () => {
     // gcTime Infinity: no five-minute garbage-collection timers holding the test process open.
     const qc = new QueryClient({
       defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: Infinity }, mutations: { gcTime: Infinity } },
     });
     const container = document.createElement('div');
     document.body.appendChild(container);
     const root = createRoot(container);
     root.render(
       <QueryClientProvider client={qc}>
         <MemoryRouter initialEntries={['/campaigns/${CID}/reports']}>
           <Routes>
             <Route path="/campaigns/:campaignId/reports" element={<ClientReportsPage />} />
           </Routes>
         </MemoryRouter>
       </QueryClientProvider>
     );
     return { qc, unmount: () => { root.unmount(); container.parentNode?.removeChild(container); qc.clear(); } };
   };`
);
const bundle = join(dir, 'bundle.mjs');
await esbuild.build({
  entryPoints: [join(dir, 'entry.jsx')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  jsx: 'automatic',
  logLevel: 'silent',
  packages: 'external',
  plugins: [
    {
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
        b.onResolve({ filter: /api\/client\.js$/ }, () => ({ path: join(dir, 'apiStub.js') }));
      },
    },
  ],
});

// ---- A minimal DOM, installed before react-dom and react-query load (both look for one then) ----
const ELEMENT = 1;
const TEXT = 3;
const DOCUMENT = 9;
const capturing = (opts) => (typeof opts === 'boolean' ? opts : !!opts?.capture);
const listenable = {
  addEventListener(type, fn, opts) {
    (this.__listeners ||= []).push({ type, fn, capture: capturing(opts) });
  },
  removeEventListener(type, fn, opts) {
    const list = this.__listeners || [];
    const i = list.findIndex((l) => l.type === type && l.fn === fn && l.capture === capturing(opts));
    if (i >= 0) list.splice(i, 1);
  },
};
// Selectors: a tag, [attr], [attr="v"], :not([attr]) and :not([attr="v"]), in comma lists — what the
// page, Share, the card and the Overlay's focus trap ask for.
const ATTR = /^\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/;
const parseCompound = (sel) => {
  const out = { tag: null, attrs: [], nots: [] };
  let s = sel.trim();
  const tag = s.match(/^[a-zA-Z][\w-]*/);
  if (tag) {
    out.tag = tag[0].toLowerCase();
    s = s.slice(tag[0].length);
  }
  while (s.length) {
    let m;
    if ((m = s.match(ATTR))) {
      out.attrs.push({ name: m[1], value: m[2] ?? m[3] ?? m[4] ?? null });
      s = s.slice(m[0].length);
    } else if (s.startsWith(':not(')) {
      const end = s.indexOf(')');
      const inner = s.slice(5, end).match(ATTR);
      if (!inner) throw new Error(`fake DOM: unsupported ${s}`);
      out.nots.push({ name: inner[1], value: inner[2] ?? inner[3] ?? inner[4] ?? null });
      s = s.slice(end + 1);
    } else throw new Error(`fake DOM: unsupported selector "${sel}"`);
  }
  return out;
};
const hasAttr = (el, a) => (a.value == null ? el.hasAttribute(a.name) : el.getAttribute(a.name) === a.value);
const matches = (el, list) => list.some((c) => (!c.tag || el.localName === c.tag) && c.attrs.every((a) => hasAttr(el, a)) && c.nots.every((a) => !hasAttr(el, a)));
const descendants = (root) => {
  const out = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType !== ELEMENT) continue;
      out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
};
const FOCUSABLE_TAGS = new Set(['button', 'input', 'select', 'textarea']);
class FakeNode {
  constructor(nodeType, nodeName, ownerDocument) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
    this.childNodes = [];
    this.parentNode = null;
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling() {
    const s = this.parentNode?.childNodes;
    return s ? s[s.indexOf(this) + 1] ?? null : null;
  }
  get parentElement() {
    return this.parentNode?.nodeType === ELEMENT ? this.parentNode : null;
  }
  appendChild(child) {
    return this.insertBefore(child, null);
  }
  insertBefore(child, ref) {
    child.parentNode?.removeChild(child);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(child);
    else this.childNodes.splice(i, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child) {
    const doc = this.ownerDocument || this;
    // The browser's focus fixup: focus inside a removed subtree falls back to the body.
    if (doc.activeElement && child.contains(doc.activeElement)) doc.activeElement = doc.body;
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n.nodeType === DOCUMENT;
  }
  get textContent() {
    return this.nodeType === TEXT ? this.nodeValue : this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(value) {
    while (this.childNodes.length) this.removeChild(this.childNodes[0]);
    if (value !== '' && value != null) this.appendChild((this.ownerDocument || this).createTextNode(value));
  }
  querySelectorAll(selector) {
    const list = selector.split(',').map(parseCompound);
    return descendants(this).filter((e) => matches(e, list));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}
Object.assign(FakeNode.prototype, listenable);
class FakeElement extends FakeNode {
  constructor(tag, doc, ns) {
    super(ELEMENT, ns ? tag : tag.toUpperCase(), doc);
    this.localName = tag;
    this.tagName = this.nodeName;
    this.namespaceURI = ns || 'http://www.w3.org/1999/xhtml';
    this.style = { setProperty() {}, removeProperty() {} };
    this.__attrs = new Map();
  }
  setAttribute(name, value) {
    this.__attrs.set(name, String(value));
  }
  setAttributeNS(_ns, name, value) {
    this.setAttribute(name, value);
  }
  getAttribute(name) {
    return this.__attrs.has(name) ? this.__attrs.get(name) : null;
  }
  hasAttribute(name) {
    return this.__attrs.has(name);
  }
  removeAttribute(name) {
    this.__attrs.delete(name);
  }
  removeAttributeNS(_ns, name) {
    this.removeAttribute(name);
  }
  // react-dom reads `type` to tell a text box (and its change events) from a checkbox or a radio.
  get type() {
    return this.getAttribute('type') ?? (this.localName === 'input' ? 'text' : '');
  }
  set type(value) {
    this.setAttribute('type', value);
  }
  // A <select>'s options, as react-dom's select wrapper reads them.
  get options() {
    return this.localName === 'select' ? descendants(this).filter((e) => e.localName === 'option') : undefined;
  }
  closest(selector) {
    const list = selector.split(',').map(parseCompound);
    for (let n = this; n && n.nodeType === ELEMENT; n = n.parentNode) if (matches(n, list)) return n;
    return null;
  }
  // As a browser does: never a disabled control, an element that can't take focus (no tabindex, not a
  // control or a link), or one outside the document.
  focus() {
    const focusable = (FOCUSABLE_TAGS.has(this.localName) && !this.hasAttribute('disabled')) || (this.localName === 'a' && this.hasAttribute('href')) || this.hasAttribute('tabindex');
    if (!focusable || !this.isConnected) return;
    this.ownerDocument.activeElement = this;
  }
  blur() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }
  scrollIntoView() {}
}
class FakeOption extends FakeElement {
  get value() {
    return this.getAttribute('value') ?? this.textContent;
  }
  set value(v) {
    this.setAttribute('value', v);
  }
}
class FakeDocument extends FakeNode {
  constructor() {
    super(DOCUMENT, '#document', null);
    this.oninput = null; // react-dom feature-detects the input event this way
  }
  createElement(tag) {
    return tag === 'option' ? new FakeOption(tag, this) : new FakeElement(tag, this);
  }
  createElementNS(ns, tag) {
    return new FakeElement(tag, this, ns);
  }
  createTextNode(text) {
    const node = new FakeNode(TEXT, '#text', this);
    node.nodeValue = String(text);
    return node;
  }
}
const document = new FakeDocument();
document.documentElement = document.appendChild(document.createElement('html'));
document.body = document.documentElement.appendChild(document.createElement('body'));
document.activeElement = document.body;
const copied = [];
const window = {
  document,
  event: undefined,
  navigator: { userAgent: 'node', clipboard: { writeText: async (t) => void copied.push(t) } },
  location: { href: `https://doorline.app/campaigns/${CID}/reports`, protocol: 'https:', origin: 'https://doorline.app', pathname: `/campaigns/${CID}/reports` },
  HTMLIFrameElement: class {},
  ...listenable,
};
document.defaultView = window;
globalThis.window = window;
globalThis.document = document;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
const stored = new Map();
globalThis.localStorage = { getItem: (k) => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) };

// A native event, dispatched with capture and bubble phases through the node's ancestors.
const fire = (target, type, extra = {}) => {
  const event = {
    type,
    target,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    isTrusted: true,
    timeStamp: Date.now(),
    button: 0,
    ...extra,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
  const path = [];
  for (let n = target; n; n = n.parentNode) path.push(n);
  path.push(window);
  const run = (node, capture) => {
    for (const l of [...(node.__listeners || [])]) {
      if (l.type !== type || l.capture !== capture) continue;
      event.currentTarget = node;
      l.fn.call(node, event);
    }
  };
  for (let i = path.length - 1; i >= 0 && !event.stopped; i--) run(path[i], true);
  for (let i = 0; i < path.length && !event.stopped; i++) run(path[i], false);
  return event;
};
const closestForm = (node) => {
  for (let n = node; n; n = n.parentNode) if (n.localName === 'form') return n;
  return null;
};
// A press the way a keyboard makes it: the control has the keyboard, then its click — nothing on a
// disabled one; a radio is ticked before its click; a submit button that isn't stopped submits its form.
const press = (el) => {
  assert.ok(el, 'a control to press');
  if (el.hasAttribute('disabled')) return;
  el.focus();
  if (el.localName === 'input' && el.type === 'radio') el.checked = true;
  const event = fire(el, 'click');
  if (!event.defaultPrevented && el.localName === 'button' && (el.getAttribute('type') || 'submit') === 'submit') {
    const form = closestForm(el);
    if (form) fire(form, 'submit');
  }
};

const { mount } = await import(pathToFileURL(bundle).href);

// ---- Reading the screen ---------------------------------------------------------------------------
const elements = (root = document.body) => descendants(root);
const words = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
const screen = () => words(document.body);
const buttons = (label, root = document.body) => elements(root).filter((e) => e.localName === 'button' && words(e) === label);
const button = (label, root) => buttons(label, root).at(-1) || null;
const dialog = () => document.body.querySelector('[role="dialog"]');
const active = () => document.activeElement;
const describe = (el) => (!el ? 'nothing' : el === document.body ? '<body>' : `<${el.localName}${el.getAttribute('role') ? ` role="${el.getAttribute('role')}"` : ''}> ${words(el).slice(0, 60)}`);
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (check, what, ms = 2000) => {
  const start = Date.now();
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() - start > ms) assert.fail(`timed out waiting for ${what}; the keyboard is on ${describe(active())}; the screen reads: ${screen().slice(0, 700)}`);
    await tick(5);
  }
};
// The keyboard lands on `label` (a button's words, or a check of the element) inside Share — and stays.
const landsOn = async (check, what) => {
  const ok = typeof check === 'string' ? () => words(active()) === check && dialog()?.contains(active()) : check;
  await waitFor(ok, `the keyboard on ${what || check}`);
  await tick(20);
  assert.ok(ok(), `the keyboard stayed on ${what || check} (now ${describe(active())})`);
};

// ---- Fixtures: as GET /admin/client-reports and GET …/shares answer (contracts K1, K7) -----------------
const DAY = 86400000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const row = (over = {}) => ({
  id: 'r1',
  campaignId: CID,
  campaignType: 'survey',
  seriesId: 'sc',
  seriesKey: 'sc',
  seriesLabel: 'Whole campaign',
  scope: { kind: 'campaign', label: 'Whole campaign' },
  weekStart: '2026-10-12',
  weekEnd: '2026-10-18',
  timeZone: TZ,
  status: 'published',
  takenDownAt: null,
  archivedAt: null,
  hasSnapshot: true,
  publishedAt: '2026-10-19T14:00:00Z',
  build: { status: 'idle' },
  headline: { cumulative: { doorsKnocked: 3000, surveysTaken: 1720 }, period: { doorsKnocked: 400, surveysTaken: 250 } },
  ...over,
});
const reportOf = (r) => ({ id: r.id, weekStart: r.weekStart, weekEnd: r.weekEnd, scopeLabel: r.seriesLabel, takenDown: !!r.takenDownAt, seriesId: r.seriesId });
const link = (over = {}) => ({
  id: 'L1',
  campaignId: CID,
  token: 'tokWeekOne001',
  label: '',
  isActive: true,
  hasPassword: true,
  expiresAt: iso(NOW + 90 * DAY),
  lifetimeEndsAt: iso(NOW + 365 * DAY),
  passwordMeetsRule: true,
  lock: { locked: false, until: null },
  failures: { last24h: 0, last7d: 0, total: 0 },
  rotateAdvice: false,
  lastAccessedAt: null,
  createdAt: iso(NOW - DAY),
  reportId: 'r1',
  report: reportOf(row()),
  allReports: false,
  passwordCopyable: true,
  passwordViewable: true,
  passwordHiddenReason: null,
  samePasswordCount: 0,
  samePasswordTabs: [],
  ...over,
});
// An old link to all your reports: no report, its password never kept.
const oldLink = (over = {}) =>
  link({ id: 'A1', token: 'tokAllReports', label: 'Candidate', reportId: null, report: null, allReports: true, passwordCopyable: false, passwordViewable: false, passwordHiddenReason: 'unavailable', createdAt: iso(NOW - 120 * DAY), ...over });
const R1 = row();
const R2 = row({ id: 'r2', weekStart: '2026-10-19', weekEnd: '2026-10-25', publishedAt: '2026-10-26T14:00:00Z' });
const picker = { teamsReady: true, weekStartsOn: 1, today: '2026-10-27', knockedBeforeThisWeek: true, series: [{ id: 'sc', kind: 'campaign', label: 'Whole campaign', ended: false }], crews: [], formerCrews: [], noCrewCanvassers: 0 };

// ---- The API stand-in -----------------------------------------------------------------------------
// GETs answer from `server` as it stands; anything else waits until a test answers it.
const refusal = (status, body) => Object.assign(new Error(body.error), { status, code: body.code || null, data: body });
const server = { reports: [], shares: [], allReportsRetired: false, staffUnderGrant: false };
let calls = [];
let held = [];
let errors = [];
const SHARES = `/admin/client-reports/shares?campaignId=${CID}`;
const REPORTS = `/admin/client-reports?campaignId=${CID}`;
const get = (path) => {
  if (path === '/admin/campaigns') return { campaigns: [{ _id: CID, name: 'Ward 3', type: 'survey', isActive: true, timeZone: TZ }] };
  if (path === REPORTS) return { reports: server.reports };
  if (path === `/admin/client-reports/series?campaignId=${CID}`) return picker;
  if (path === SHARES) return { shares: server.shares, allReportsRetired: server.allReportsRetired, staffUnderGrant: server.staffUnderGrant };
  if (path === `/admin/campaigns/${CID}/efforts`) return { efforts: [] };
  if (path === '/admin/branding') return { hasLogo: false };
  return undefined;
};
globalThis.__api = (path, { method = 'GET', body, signal } = {}) => {
  const call = { method, path, body: body === undefined ? undefined : structuredClone(body), signal: signal || null };
  calls.push(call);
  const answer = method === 'GET' ? get(path) : undefined;
  if (answer !== undefined) return Promise.resolve(structuredClone(answer));
  return new Promise((resolve, reject) => {
    held.push({ ...call, resolve, reject });
    signal?.addEventListener?.('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
  });
};
// Answers the request `pick` names, once it has been sent: an Error refuses it.
const answer = async (pick, how, what = 'the request') => {
  const h = await waitFor(() => held.find((x) => !x.done && pick(x)), what);
  h.done = true;
  if (how instanceof Error) h.reject(how);
  else h.resolve(structuredClone(how));
  return h;
};
const reads = (path) => calls.filter((c) => c.method === 'GET' && c.path === path).length;

// React's warnings are kept for each test to check.
const consoleError = console.error;
console.error = (...args) => errors.push(args.map(String).join(' '));

let current = null;
const fresh = ({ reports = [R1], shares = [], allReportsRetired = false, staffUnderGrant = false } = {}) => {
  current?.unmount();
  for (const c of [...document.body.childNodes]) document.body.removeChild(c);
  document.activeElement = document.body;
  calls = [];
  held = [];
  errors = [];
  Object.assign(server, { reports, shares, allReportsRetired, staffUnderGrant });
  globalThis.__auth = { isOrgAdmin: true, user: { id: 'u1' } };
  // How it works was put away earlier: the guide doesn't stand above the reports.
  localStorage.setItem('doorline.clientReports.howItWorks.u1', '1');
  current = mount();
  return waitFor(() => screen().includes('Client Reports') && screen().includes('Oct') && document.body.querySelector('[data-report-row]'), 'the page to load');
};
after(() => {
  current?.unmount();
  console.error = consoleError;
  rmSync(dir, { recursive: true, force: true });
});

const shareButtons = () => buttons('Share').filter((b) => !dialog()?.contains(b));
const openShare = async (nth = 0) => {
  press(shareButtons()[nth]);
  await waitFor(() => dialog() && screen().includes('Paste the message into your own email or text.'), 'Share to open');
};
const card = () => elements().find((e) => e.localName === 'h2' && words(e).startsWith('Old links to all your reports'))?.parentNode || null;
// react-query tells the page about a changed list with setTimeout(0), and React draws its own state with
// its scheduler (setImmediate here, MessageChannel in a browser): either can land first — here it even
// depends on the event loop's phase. The focus must hold whichever does (code review N1), so each flow
// runs with react-query's own timing, then with each order forced.
const ORDERS = [
  ['react-query’s own timing', defaultScheduler],
  ['Share’s own state drawn first', (cb) => setTimeout(cb, 15)],
  ['the list’s answer drawn first', (cb) => queueMicrotask(cb)],
];
const inEachOrder = async (fn) => {
  for (const [order, scheduler] of ORDERS) {
    notifyManager.setScheduler(scheduler);
    try {
      await fn(order);
    } finally {
      notifyManager.setScheduler(defaultScheduler);
    }
  }
};

// ── V2-1: a button that goes with its own success ─────────────────────────────────────────────────

test('V2-1: Turn on and Unlock now hand the keyboard to Copy link; Renew link and an Extend date to Extend — inside Share, never <body>', async () => {
  const cases = [
    { name: 'Turn on', over: { isActive: false }, press: ['Turn on'], path: '/L1', fix: { isActive: true }, lands: 'Copy link' },
    {
      name: 'Unlock now',
      over: { lock: { locked: true, until: iso(NOW + 3600000) }, failures: { last24h: 50, last7d: 50, total: 50 }, rotateAdvice: true },
      press: ['Unlock now'],
      path: '/L1/unlock',
      fix: { lock: { locked: false, until: null }, failures: { last24h: 0, last7d: 50, total: 50 } },
      lands: 'Copy link',
    },
    { name: 'Renew link', over: { expiresAt: iso(NOW - DAY) }, press: ['Renew', 'Renew link'], path: '/L1/renew', fix: { expiresAt: iso(NOW + 90 * DAY), token: 'tokRenewed01' }, lands: 'Extend' },
    { name: 'an Extend date', over: { expiresAt: iso(NOW + 10 * DAY) }, press: ['Extend', '(90 days)'], path: '/L1/extend', fix: { expiresAt: iso(NOW + 90 * DAY) }, lands: 'Extend' },
  ];
  const named = (p) => (e) => e.localName === 'button' && (words(e) === p || words(e).endsWith(p));
  await inEachOrder(async (order) => {
    for (const c of cases) {
      await fresh({ shares: [link(c.over)] });
      await openShare();
      for (const p of c.press) press(await waitFor(() => elements(dialog()).find(named(p)), `${p} (${order})`));
      const fixed = link({ ...c.over, ...c.fix });
      server.shares = [fixed];
      await answer((h) => h.path === `/admin/client-reports/shares${c.path}`, { share: fixed }, `${c.name}’s request`);
      await waitFor(() => !elements(dialog()).some(named(c.press.at(-1))), `${c.press.at(-1)} to go with its success (${order})`);
      await landsOn(c.lands, `${c.lands} after ${c.name} (${order})`);
    }
  });
  assert.deepEqual(errors, [], 'no React warnings');
});

test('V2-1: New address’s confirm hands the keyboard back to New address; Show to Copy password, or to Change password when it can’t be shown', async () => {
  await fresh({ shares: [link()] });
  await openShare();
  press(button('New address', dialog()));
  await waitFor(() => screen().includes('Give this link a new address?'), 'the confirm');
  press(buttons('New address', dialog()).at(-1));
  const renamed = link({ token: 'tokNewAddress1' });
  server.shares = [renamed];
  await answer((h) => h.path.endsWith('/L1/rotate'), { share: renamed }, 'New address');
  await waitFor(() => !screen().includes('Give this link a new address?'), 'the confirm to close');
  assert.equal(buttons('New address', dialog()).length, 1, 'only the one that opened it');
  await landsOn('New address', 'the New address that opened it');

  press(button('Show', dialog()));
  await answer((h) => h.path.endsWith('/L1/password'), { password: 'Wk1Passw0rdAB' }, 'Show');
  await landsOn('Copy password');

  await fresh({ shares: [link()] });
  await openShare();
  press(button('Show', dialog()));
  await answer((h) => h.path.endsWith('/L1/password'), refusal(409, { error: 'This link’s password can’t be shown.', code: 'PASSWORD_NOT_VIEWABLE', reason: 'not_kept' }), 'Show');
  await waitFor(() => screen().includes('This link’s password can’t be shown. To have one you can see'), 'the line that says so');
  await landsOn('Change password');
  assert.deepEqual(errors, []);
});

test('V2-1: a panel or confirm put away hands the keyboard back to the button that opened it — Close, Cancel; Change password opens on its first choice', async () => {
  await fresh({ shares: [link({ expiresAt: iso(NOW + 10 * DAY) }), link({ id: 'X1', token: 'tokExtra01', label: 'Board', createdAt: iso(NOW - 3 * DAY), isActive: false })] });
  await openShare();
  press(button('Extend', dialog()));
  press(await waitFor(() => button('Close', elements(dialog()).find((e) => words(e).startsWith('Make it last until:'))), 'the panel’s Close'));
  await landsOn('Extend');
  for (const [opener, confirmWords] of [
    ['New address', 'Give this link a new address?'],
    ['Delete link', 'Anyone using it loses access for good.'],
  ]) {
    press(buttons(opener, dialog())[0]);
    await waitFor(() => screen().includes(confirmWords), `${opener}’s confirm`);
    press(button('Cancel', dialog()));
    await landsOn(opener);
  }
  // The extra link's Delete: its confirm's Cancel, back to it.
  const extraDelete = () => elements(dialog()).find((e) => e.localName === 'button' && words(e) === 'Delete');
  press(extraDelete());
  await waitFor(() => buttons('Delete link', dialog()).length >= 2, 'the extra link’s confirm');
  press(button('Cancel', dialog()));
  await landsOn(() => active() === extraDelete(), 'the extra link’s Delete');
  // Change password takes its own button's place: its first choice has the keyboard; Cancel brings it back.
  press(button('Change password', dialog()));
  await landsOn(() => active()?.localName === 'input' && active().getAttribute('name') === 'change-password' && dialog().contains(active()), 'Make one up for me');
  assert.equal(words(active().parentNode), 'Make one up for me');
  press(button('Cancel', dialog()));
  await landsOn('Change password');

  // Renew's panel, on an expired link: Cancel, back to Renew.
  await fresh({ shares: [link({ expiresAt: iso(NOW - DAY) })] });
  await openShare();
  press(button('Renew', dialog()));
  press(await waitFor(() => button('Cancel', dialog()), 'Renew’s panel'));
  await landsOn('Renew');

  // The card: Change password opens on its first choice; Cancel brings it back.
  await fresh({ shares: [oldLink()] });
  press(button('Change password', card()));
  await landsOn(() => active()?.getAttribute('name') === 'change-password' && card().contains(active()), 'the card’s first choice');
  press(button('Cancel', card()));
  await landsOn(() => words(active()) === 'Change password' && card().contains(active()), 'the card’s Change password');
  assert.deepEqual(errors, []);
});

test('V2-1: deletes — an extra link’s Delete hands the keyboard to the next one’s, the last to Share itself; Delete link to the make-link form’s first choice', async () => {
  await inEachOrder(async (order) => {
    const x1 = link({ id: 'X1', token: 'tokExtra01', label: 'Board', createdAt: iso(NOW - 3 * DAY), isActive: false });
    const x2 = link({ id: 'X2', token: 'tokExtra02', label: 'Press', createdAt: iso(NOW - 4 * DAY), isActive: false });
    await fresh({ shares: [link(), x1, x2] });
    await openShare();
    const extraDeletes = () => elements(dialog()).filter((e) => e.localName === 'button' && words(e) === 'Delete');
    const extraLine = (x) => elements(dialog()).find((e) => e.localName === 'li' && words(e).includes(`Also opens this report: ${x.label}`)) || null;
    assert.equal(extraDeletes().length, 2);
    for (const [gone, left, lands] of [
      [x1, [link(), x2], () => active() === extraDeletes()[0] && extraLine(x2).contains(active())],
      [x2, [link()], () => active() === dialog()],
    ]) {
      press(extraLine(gone).querySelector('button'));
      await waitFor(() => buttons('Delete link', dialog()).length >= 2, 'its confirm');
      press(buttons('Delete link', dialog()).at(-1));
      server.shares = left;
      await answer((h) => h.method === 'DELETE' && h.path.endsWith(`/${gone.id}`), { ok: true }, `${gone.id}’s Delete`);
      await waitFor(() => !extraLine(gone), `${gone.label}’s line to go (${order})`);
      await landsOn(lands, `after ${gone.label}’s Delete (${order})`);
    }
    press(button('Delete link', dialog()));
    await waitFor(() => screen().includes('Anyone using it loses access for good.'), 'Delete link’s confirm');
    press(buttons('Delete link', dialog()).at(-1));
    server.shares = [];
    await answer((h) => h.method === 'DELETE' && h.path.endsWith('/L1'), { ok: true }, 'Delete link');
    await waitFor(() => screen().includes('Make this report’s link'), `the make-link form (${order})`);
    await landsOn(() => active()?.getAttribute('name') === 'share-password' && dialog().contains(active()), `the form’s first choice (${order})`);
    assert.equal(active(), dialog().querySelector('input[name="share-password"]'), 'its first choice');
  });
  assert.deepEqual(errors, []);
});

test('V2-1: the old-links card — a Delete hands the keyboard to the next row’s first button; the last one, with the card gone, to the reports below it', async () => {
  await inEachOrder(async (order) => {
    const a2 = oldLink({ id: 'A2', label: '', token: 'tokAllReports2', createdAt: iso(NOW - 200 * DAY) });
    await fresh({ shares: [oldLink(), a2] });
    const rows = () => (card() ? elements(card()).filter((e) => e.localName === 'li') : []);
    assert.equal(rows().length, 2);
    press(button('Delete', rows()[0]));
    await waitFor(() => dialog() && words(dialog()).includes('Delete this link?'), 'its confirm');
    press(button('Delete link', dialog()));
    server.shares = [a2];
    await answer((h) => h.method === 'DELETE' && h.path.endsWith('/A1'), { ok: true }, 'A1’s Delete');
    await waitFor(() => !dialog() && rows().length === 1, `A1’s row to go (${order})`);
    await landsOn(() => active() === rows()[0].querySelector('button'), `the next row’s first button (${order})`);
    assert.equal(words(active()), 'Change password');

    press(button('Delete', rows()[0]));
    await waitFor(() => dialog() && words(dialog()).includes('Delete this link?'), 'its confirm');
    press(button('Delete link', dialog()));
    server.shares = [];
    await answer((h) => h.method === 'DELETE' && h.path.endsWith('/A2'), { ok: true }, 'A2’s Delete');
    await waitFor(() => !dialog() && !card(), `the card to go with its last link (${order})`);
    await landsOn(() => active()?.localName === 'h2' && words(active()) === 'Reports', `the reports heading (${order})`);
  });
  assert.deepEqual(errors, []);
});

// ── N1: Copy link after Same as …, whichever lands first ──────────────────────────────────────────

test('N1: after Create link, Copy link — or Copy password, when one shows — takes the keyboard whichever lands first: the list’s answer or Share’s own state', async () => {
  const L2 = link({ id: 'L2', token: 'tokWeekTwo002', reportId: 'r2', report: reportOf(R2), createdAt: iso(NOW) });
  await inEachOrder(async (order) => {
    // Same as your last link: no password on screen.
    await fresh({ reports: [R2, R1], shares: [link()] });
    await openShare(0);
    press(button('Create link', dialog()));
    server.shares = [L2, link()];
    const post = await answer((h) => h.method === 'POST', { share: L2 }, 'Create');
    assert.equal(post.body.passwordFrom, 'L1');
    await landsOn('Copy link', `Copy link (${order})`);
    // Made up: Copy password, as it appears.
    await fresh({ reports: [R2, R1], shares: [] });
    await openShare(0);
    press(button('Create link', dialog()));
    server.shares = [L2];
    await answer((h) => h.method === 'POST', { share: L2, generatedPassword: 'N3wPassw0rdAB' }, 'Create');
    await landsOn('Copy password', `Copy password (${order})`);
  });
  assert.deepEqual(errors, []);
});

// ── V2-2: Create refused for the report itself ───────────────────────────────────────────────────

test('V2-2: Create answered REPORT_NOT_SHOWN reads the reports again — Share shows the report taken down, with no Create link, and its row offers Put back up', async () => {
  await fresh({ reports: [R1], shares: [] });
  await openShare();
  const before = reads(REPORTS);
  press(button('Create link', dialog()));
  server.reports = [{ ...R1, takenDownAt: '2026-10-28T10:00:00Z' }];
  await answer((h) => h.method === 'POST', refusal(409, { error: 'This report is taken down. Put it back up, then make its link.', code: 'REPORT_NOT_SHOWN', status: 'published', takenDown: true }), 'Create');
  await waitFor(() => reads(REPORTS) > before, 'the reports read again');
  await waitFor(() => !button('Create link', dialog()), 'Create link to go');
  assert.ok(words(dialog()).includes('This report is taken down. Put it back up, then make its link.'), words(dialog()));
  assert.ok(!words(dialog()).includes('Couldn’t create'));
  assert.ok(buttons('Put back up').some((b) => !dialog().contains(b)), 'the row offers Put back up');
  assert.equal(buttons('Take down').length, 0);
  await landsOn(() => active() === dialog(), 'Share itself (nothing left to press)');
  assert.deepEqual(errors, []);
});

test('V2-2: Create answered REPORT_NOT_FOUND — Share says the report was deleted and offers nothing more; the reports and the links are read again, and its row goes', async () => {
  await fresh({ reports: [R2, R1], shares: [] });
  await openShare(1);
  const before = { reports: reads(REPORTS), shares: reads(SHARES) };
  press(button('Create link', dialog()));
  server.reports = [R2];
  await answer((h) => h.method === 'POST', refusal(404, { error: 'Report not found', code: 'REPORT_NOT_FOUND' }), 'Create');
  await waitFor(() => words(dialog()).includes('This report was deleted — there’s nothing to share.'), 'the line that says so');
  assert.ok(!button('Create link', dialog()) && !words(dialog()).includes('Make this report’s link'));
  assert.equal(button('Copy message', dialog()).hasAttribute('disabled'), true);
  await waitFor(() => reads(REPORTS) > before.reports && reads(SHARES) > before.shares, 'the reports and the links read again');
  await waitFor(() => !document.body.querySelector('[data-report-row="r1"]'), 'its row to go');
  await landsOn(() => active() === dialog(), 'Share itself (nothing left to press)');
  press(button('Done', dialog()));
  await waitFor(() => !dialog(), 'Share to close');
  assert.deepEqual(errors, []);
});
