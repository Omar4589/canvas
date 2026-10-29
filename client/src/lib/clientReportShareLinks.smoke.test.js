import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import { formatDayOf } from '../components/clientReports/reportDates.js';
import { formatDateInTz } from './datetime.js';

// Share and the old-links card, clicked through (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §D1, §D3, Part 1
// §1–§3; contracts K1–K5, K12). Every state §E's client list names: no link — with a Same as … source on
// the report's tab (picked), only on another tab (offered, not picked), or none; just made (made up,
// typed, Same as …); has its link; Show then Copy password; can't be shown (unavailable, staff); staff
// without Type my own; taken down with and without a link; an extra link; locked; expired; turned off;
// Change password and fewer changed than offered; the two Create errors; the Type my own warning; the
// subtitle. Then the card: nothing without old links, its two wordings, each row's state, Change password
// and New address on a working one before the switch, and Delete's confirm by state.
//
// renderToString renders once and runs no effect, so — the clientReportsSimplify harness, one step
// further — the modules under test get their own hooks: state, refs and mutations held per COMPONENT
// (named from the call stack: Share swaps whole parts, its make-link form for its link manager, and a
// store per module would hand one part's state to the other), effects recorded for a test to run, every
// handler recorded with its words, and every request recorded so a test can answer it and render again.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-cr-share-links-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const CID = '6a0000000000000000000001';
const C = (f) => join(here, '../components/clientReports', f);
// The modules whose hooks the harness holds; their elements' handlers are recorded, and so are those of
// the shared confirm (parts.jsx), whose own hooks stay React's.
const HOOKED = new Set(['ShareDialog.jsx', 'linkParts.jsx', 'RetiredLinksCard.jsx', 'hooks.js']);
const RECORDED = new Set(['ShareDialog.jsx', 'linkParts.jsx', 'RetiredLinksCard.jsx', 'parts.jsx']);

// The store of the component whose render is running: the nearest PascalCase frame on the stack —
// a custom hook (useLinkAction, useCopy…) files its state under the component that called it.
const storeJs = `Error.stackTraceLimit = 50;
const ownerOf = () => {
  for (const line of String(new Error().stack || '').split('\\n').slice(1)) {
    const m = line.match(/^\\s*at (?:new )?([\\w$.]+)/);
    const name = m ? m[1].split('.').pop() : '';
    if (/^[A-Z]/.test(name) && name !== 'Object' && name !== 'Error') return name;
  }
  return '?';
};
export const owner = ownerOf;
export const st = () => {
  const h = globalThis.__h;
  const name = ownerOf();
  return h.stores[name] || (h.stores[name] = { slots: [], i: 0, mutations: [], mi: 0 });
};`;
const reactShim = `export * from 'react';
import * as R from 'react';
import { st, owner } from './store.js';
export default R;
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
export const useEffect = (fn) => { globalThis.__h.effects.push({ owner: owner(), fn }); };`;
const queryShim = `export * from '@tanstack/react-query';
import { st } from './store.js';
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
      opts.onMutate?.(variables);
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

let mod;
const load = async () => {
  if (mod) return mod;
  writeFileSync(join(dir, 'store.js'), storeJs);
  writeFileSync(join(dir, 'react.js'), reactShim);
  writeFileSync(join(dir, 'query.js'), queryShim);
  writeFileSync(join(dir, 'jsx.js'), jsxShim);
  writeFileSync(join(dir, 'portal.js'), `export * from 'react-dom';\nexport const createPortal = (children) => children;`);
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ShareDialog from '${C('ShareDialog.jsx')}';
import RetiredLinksCard from '${C('RetiredLinksCard.jsx')}';

const KEY = ['admin', 'client-report-shares', '${CID}'];
// The browser, as far as these screens reach it. A request waits until the test answers it; an abort
// (Show's controller) rejects it as fetch does.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = { location: { origin: 'https://doorline.app', pathname: '/campaigns/${CID}/reports' }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
globalThis.document = { body: { style: {} }, activeElement: null, addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (t) => { globalThis.__h.copied.push(t); } } } });
globalThis.fetch = (url, init = {}) =>
  new Promise((resolve, reject) => {
    const f = { url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, signal: init.signal || null, resolve, reject };
    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    globalThis.__h.fetches.push(f);
  });

// A new screen: nothing held, nothing recorded.
export const fresh = () => {
  globalThis.__h = { stores: {}, effects: [], handlers: [], last: null, fetches: [], copied: [], changed: 0 };
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
// The links list as GET /admin/client-reports/shares answers it (contract K1), in the page's cache —
// Share and the card read it from there each render, as the page hands it to them.
export const newQc = (shares, flags = {}) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (shares) qc.setQueryData(KEY, { shares, allReportsRetired: false, staffUnderGrant: false, ...flags });
  return qc;
};
const listOf = (qc) => qc.getQueryData(KEY) || null;
const onLinksChanged = () => { globalThis.__h.changed += 1; };
export const share = (qc, props = {}) =>
  show(() => {
    const d = listOf(qc);
    return (
      <QueryClientProvider client={qc}>
        <ShareDialog campaignId="${CID}" tz="America/New_York" shares={d ? d.shares : null} allReportsRetired={!!d?.allReportsRetired} staffUnderGrant={!!d?.staffUnderGrant} onClose={() => {}} onLinksChanged={onLinksChanged} {...props} />
      </QueryClientProvider>
    );
  });
export const card = (qc, props = {}) =>
  show(() => {
    const d = listOf(qc);
    return (
      <QueryClientProvider client={qc}>
        <RetiredLinksCard campaignId="${CID}" tz="America/New_York" shares={d ? d.shares : null} allReportsRetired={!!d?.allReportsRetired} staffUnderGrant={!!d?.staffUnderGrant} onChanged={onLinksChanged} {...props} />
      </QueryClientProvider>
    );
  });
export const sharesIn = (qc) => listOf(qc)?.shares || null;
// A list whose rows changed: React keys each row by its link, so a row that moves up starts with its own
// state. Here a component's state is filed by its name — forget it, and the next render starts clean.
export const forget = (name) => { delete globalThis.__h.stores[name]; };
`
  );
  const out = join(dir, 'bundle.mjs');
  const fileOf = (importer) => String(importer).split(/[\\/]/).pop();
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
          b.onResolve({ filter: /^react$/ }, (a) => (HOOKED.has(fileOf(a.importer)) ? { path: join(dir, 'react.js') } : undefined));
          b.onResolve({ filter: /^@tanstack\/react-query$/ }, (a) => (HOOKED.has(fileOf(a.importer)) ? { path: join(dir, 'query.js') } : undefined));
          b.onResolve({ filter: /^react\/jsx-runtime$/ }, (a) => (RECORDED.has(fileOf(a.importer)) ? { path: join(dir, 'jsx.js') } : undefined));
          // Overlay and Popover portal into document.body; render them in place for the server renderer.
          b.onResolve({ filter: /^react-dom$/ }, (a) => (/Overlay\.jsx$|Popover\.jsx$/.test(a.importer) ? { path: join(dir, 'portal.js') } : undefined));
          // The shims import from react and react-query themselves: those resolve to the real ones.
          b.onResolve({ filter: /^\.\/store\.js$/ }, () => ({ path: join(dir, 'store.js') }));
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
const handlerFor = (m, pick, what, nth = -1) => {
  const all = m.h().handlers.filter(pick);
  const r = nth < 0 ? all[all.length + nth] : all[nth];
  assert.ok(r, `${what} on the screen`);
  return r;
};
/** Presses the button whose words are `words` (the last such, or the `nth`) — never a disabled one — then renders again. */
const click = (m, words, nth = -1) => {
  const r = handlerFor(m, (x) => x.props.onClick && x.text === words, `a “${words}” button`, nth);
  assert.ok(!r.props.disabled && !r.props.loading, `“${words}” can be pressed`);
  r.props.onClick({ preventDefault() {}, stopPropagation() {} });
  return m.rerender();
};
/** Submits the form whose words include `words` (Create link, Change password). */
const submit = (m, words) => {
  handlerFor(m, (x) => x.type === 'form' && x.text.includes(words), `a form with “${words}”`).props.onSubmit({ preventDefault() {} });
  return m.rerender();
};
/** Picks the radio whose label starts with `words`. */
const choose = (m, words) => {
  const r = handlerFor(m, (x) => x.props.onChange && x.props.type === 'radio' && x.label.startsWith(words), `a radio “${words}…”`);
  assert.ok(!r.props.disabled, `“${words}” can be picked`);
  r.props.onChange({ target: { checked: true } });
  return m.rerender();
};
/** Types into the password box. */
const type = (m, value) => {
  handlerFor(m, (x) => x.props.onChange && x.props.autoComplete === 'new-password', 'a password box').props.onChange({ target: { value } });
  return m.rerender();
};
/** Ticks or unticks the checkbox whose label starts with `words`. */
const tick = (m, words, checked) => {
  handlerFor(m, (x) => x.props.onChange && x.props.type === 'checkbox' && x.label.startsWith(words), `a checkbox “${words}…”`).props.onChange({ target: { checked } });
  return m.rerender();
};
/** Answers the last request a press made (an Error refuses it), and renders again. */
const settle = async (m, outcome, req = m.h().last) => {
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
  req.opts.onSettled?.();
  return m.rerender();
};
/** The request the last press would send, as the server sees it: method, address and body. */
const sent = async (m) => {
  const req = m.h().last;
  const { variables } = req.calls[req.calls.length - 1];
  req.opts.mutationFn(variables).catch(() => {});
  const f = m.h().fetches.pop();
  return { method: f.method, url: f.url, body: f.body };
};
/** Answers a fetch the page made directly (Show): an HTTP status and its JSON. */
const answer = async (m, f, status, json) => {
  f.resolve({ ok: status < 400, status, text: async () => JSON.stringify(json) });
  await new Promise((r) => setTimeout(r, 0));
  return m.rerender();
};
const refusal = (code, status, data = {}) => Object.assign(new Error(data.error || code), { code, status, data: { code, ...data } });
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
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const TZ = 'America/New_York';
const day = (ms) => formatDayOf(iso(ms), TZ);
const reportOf = (id, weekStart, weekEnd, scopeLabel, seriesId) => ({ id, weekStart, weekEnd, scopeLabel, takenDown: false, seriesId });
const R1 = reportOf('r1', '2026-10-19', '2026-10-25', 'Whole campaign', 'sc');
// A share row as GET /admin/client-reports/shares sends it (contract K1): this report's own link.
const link = (over = {}) => ({
  id: 'l1',
  campaignId: CID,
  token: 'tokCandidate1',
  label: '',
  isActive: true,
  hasPassword: true,
  expiresAt: iso(NOW + 60 * DAY),
  lifetimeEndsAt: iso(NOW + 300 * DAY),
  passwordMeetsRule: true,
  lock: { locked: false, until: null },
  failures: { last24h: 0, last7d: 0, total: 0 },
  rotateAdvice: false,
  lastAccessedAt: null,
  createdAt: iso(NOW - 3 * DAY),
  reportId: 'r1',
  report: R1,
  allReports: false,
  passwordCopyable: true,
  passwordViewable: true,
  passwordHiddenReason: null,
  samePasswordCount: 0,
  samePasswordTabs: [],
  ...over,
});
// Last week's report on this tab, and one on another tab, each with a password Doorline kept.
const lastWeek = link({ id: 'p1', token: 'tokPrevious01', reportId: 'r0', report: reportOf('r0', '2026-10-12', '2026-10-18', 'Whole campaign', 'sc'), createdAt: iso(NOW - 9 * DAY) });
const paidTeam = link({ id: 't1', token: 'tokPaidTeam01', reportId: 'rt', report: reportOf('rt', '2026-10-12', '2026-10-18', 'Paid team', 'st'), createdAt: iso(NOW - 8 * DAY) });
// An old link to all your reports: no report, its password never kept.
const oldLink = (over = {}) =>
  link({ id: 'a1', token: 'tokAllReports1', label: 'Candidate', reportId: null, report: null, allReports: true, passwordCopyable: false, passwordViewable: false, passwordHiddenReason: 'unavailable', createdAt: iso(NOW - 90 * DAY), ...over });
// The report Share is opened on (copyMessage.js messageReportOf, plus campaignType, status, takenDownAt).
const report = (over = {}) => ({
  id: 'r1',
  weekStart: '2026-10-19',
  weekEnd: '2026-10-25',
  allTime: false,
  campaignType: 'survey',
  seriesId: 'sc',
  seriesKey: 'kc',
  scope: { kind: 'campaign', label: 'Whole campaign', seriesLabel: 'Whole campaign' },
  cumulative: { doorsKnocked: 3412, surveysTaken: 1980 },
  period: { doorsKnocked: 412, surveysTaken: 260 },
  status: 'published',
  takenDownAt: null,
  ...over,
});
const made = (over = {}) => link({ id: 'n1', token: 'tokMadeNow001', createdAt: iso(NOW), ...over });
const MESSAGE_START = 'The report for Oct 19 – Oct 25 is up: 3,412 doors knocked so far (+412 in that period) and 1,980 surveys (+260).';
const VISIBLE_LATER = 'Everyone who manages this campaign can see this password later. Don’t use one you use anywhere else.';
const CANT_SHOW = 'This link’s password can’t be shown. To have one you can see, change it — then send your client the new password.';

const SHARE_FORM = 'Make this report’s link';
const CHANGE_FORM = 'Changing it signs out';
const tickOver = () => new Promise((r) => setTimeout(r, 0));
// The message Share offers to copy (its textarea), read as text.
const messageOf = (html) => text((html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/) || [])[1] || '').trim();
const pickExpiry = (m, days) => {
  handlerFor(m, (x) => x.type === 'Select' && x.props.onChange, 'the Expires choice').props.onChange({ target: { value: String(days) } });
  return m.rerender();
};

// ── Share: no link yet (§C3, §D1) ────────────────────────────────────────────────────────────────

test('Share, no link yet, a password kept on this tab: Same as your last link is picked; Create sends it; the message says use the password I sent you', async () => {
  const m = await load();
  m.fresh();
  const qc = m.newQc([lastWeek, paidTeam]);
  let html = m.share(qc, { report: report() });
  let t = text(html);
  assert.ok(t.includes('Share “Oct 19 – Oct 25 · Whole campaign”'));
  assert.ok(t.includes('Paste the message into your own email or text. It never includes the password.'), 'the subtitle');
  assert.ok(t.includes('Make this report’s link Password Same as your last link (Whole campaign · Oct 12 – Oct 18) Make one up for me Type my own Expires'), t);
  assert.deepEqual(ticks(html, 'share-password'), [true, false, false], 'this tab’s password, picked');
  assert.ok(!t.includes('Paid team'), 'another tab’s link isn’t offered while this tab has one');
  assert.ok(!/Label|All your reports|Just this report/.test(t), 'no label, no "which reports"');
  assert.ok(t.includes('90 days — until'), 'Expires: 90 days unless another is picked');
  assert.equal(disabledButton(html, 'Copy message'), true, 'no link, no message');
  assert.ok(!t.includes('Message (no password in it)'));

  html = submit(m, SHARE_FORM);
  assert.deepEqual(await sent(m), {
    method: 'POST',
    url: '/api/admin/client-reports/shares',
    body: { campaignId: CID, reportId: 'r1', expiresInDays: 90, passwordFrom: 'p1' },
  });
  // Share stays open until the answer lands.
  assert.equal(disabledButton(html, 'Done'), true);
  assert.ok(!html.includes('aria-label="Close"'), 'no ✕ while the link is being made');

  html = await settle(m, { share: made() });
  t = text(html);
  assert.equal(m.h().changed, 1, 'the links list and History are read again');
  assert.equal(m.sharesIn(qc)[0].id, 'n1', 'the new link is in the list at once');
  assert.ok(t.includes('Link doorline.app/r/tokMa… Copy link'), t);
  assert.ok(t.includes('Password •••••••••••• Show Change password'));
  assert.ok(!t.includes('Its password:'), 'Same as …: the client has that password already');
  assert.ok(t.includes(`Active · Expires ${day(NOW + 60 * DAY)} · Not opened yet`));
  assert.equal(messageOf(html), `${MESSAGE_START} Open it here: https://doorline.app/r/tokMadeNow001 — use the password I sent you.`);
  assert.equal(disabledButton(html, 'Copy message'), false);
  assert.equal(disabledButton(html, 'Done'), false);
  click(m, 'Copy message');
  await tickOver();
  assert.equal(m.h().copied.at(-1), messageOf(html));
});

test('Share, no link yet, only another tab kept a password: offered, never picked; Make one up shows the password in plain text, and the message says it comes separately', async () => {
  const m = await load();
  m.fresh();
  const qc = m.newQc([paidTeam]);
  let html = m.share(qc, { report: report() });
  assert.ok(text(html).includes('Same as the Paid team · Oct 12 – Oct 18 link Make one up for me Type my own'));
  assert.deepEqual(ticks(html, 'share-password'), [false, true, false], 'that tab may go to someone else');
  // Picked on purpose, it sends that link.
  html = choose(m, 'Same as the Paid team');
  assert.deepEqual(ticks(html, 'share-password'), [true, false, false]);
  html = choose(m, 'Make one up for me');

  html = submit(m, SHARE_FORM);
  assert.deepEqual(m.h().last.calls[0].variables, { campaignId: CID, reportId: 'r1', expiresInDays: 90 }, 'made up by the server: no password sent');
  html = await settle(m, { share: made(), generatedPassword: 'k7Hq9mXrW2pZ' });
  const t = text(html);
  assert.ok(t.includes('Password Its password: k7Hq9mXrW2pZ Copy password'), t);
  assert.equal(messageOf(html), `${MESSAGE_START} Open it here: https://doorline.app/r/tokMadeNow001 — I’ll send you its password separately.`);
  assert.ok(!messageOf(html).includes('k7Hq9mXrW2pZ'), 'never the password in the message');
  click(m, 'Copy password');
  await tickOver();
  assert.equal(m.h().copied.at(-1), 'k7Hq9mXrW2pZ');
  assert.ok(!JSON.stringify(qc.getQueryCache().getAll().map((q) => q.state.data)).includes('k7Hq9mXrW2pZ'), 'the list never holds a password');
});

test('Share, no link yet, no password kept anywhere: no Same as … — an old link to all your reports, or a link Doorline kept no copy of, is never a source', async () => {
  const m = await load();
  m.fresh();
  const notKept = link({ id: 'k0', token: 'tokNotKept001', reportId: 'r0', report: lastWeek.report, passwordCopyable: false });
  const html = m.share(m.newQc([oldLink(), notKept]), { report: report() });
  const t = text(html);
  assert.ok(!t.includes('Same as'), t);
  assert.deepEqual(ticks(html, 'share-password'), [true, false], 'Make one up for me, picked');
  assert.ok(!t.includes('Candidate'), 'the old link isn’t this report’s, and isn’t on its Share');
  assert.ok(t.includes(SHARE_FORM));
});

test('Type my own: it checks the 12 characters as you type and carries its warning; the typed password shows right after, and the message says it comes separately', async () => {
  const m = await load();
  m.fresh();
  m.share(m.newQc([]), { report: report() });
  let html = choose(m, 'Type my own');
  assert.ok(text(html).includes(`Type my own 12 or more characters ${VISIBLE_LATER}`), text(html));
  html = type(m, 'short one');
  assert.match(html, /text-warning-fg">12 or more characters</, 'short while typing: the hint warns');
  html = submit(m, SHARE_FORM);
  assert.equal(m.h().last, null, 'nothing sent');
  assert.ok(text(html).includes('Use at least 12 characters.'));
  html = type(m, '  correct horse battery  ');
  assert.match(html, /text-fg-muted">12 or more characters</, 'long enough');
  html = pickExpiry(m, 30);
  html = submit(m, SHARE_FORM);
  assert.deepEqual(m.h().last.calls[0].variables, { campaignId: CID, reportId: 'r1', expiresInDays: 30, password: 'correct horse battery' });
  html = await settle(m, { share: made() });
  assert.ok(text(html).includes('Its password: correct horse battery Copy password'));
  assert.ok(messageOf(html).endsWith('— I’ll send you its password separately.'));
});

test('Doorline staff under a support grant: no Type my own; a made-up password is never shown to them; later, Share says they can’t view it', async () => {
  const m = await load();
  m.fresh();
  let html = m.share(m.newQc([lastWeek], { staffUnderGrant: true }), { report: report() });
  let t = text(html);
  assert.ok(!t.includes('Type my own'));
  assert.ok(t.includes('Doorline staff can’t type a link password — make one up or use Same as …'));
  assert.deepEqual(ticks(html, 'share-password'), [true, false], 'Same as … still works for staff — they never learn it');
  html = choose(m, 'Make one up for me');
  html = submit(m, SHARE_FORM);
  // The server leaves the made-up password out of its answer to staff (contract K2).
  html = await settle(m, { share: made({ passwordViewable: false, passwordHiddenReason: 'staff' }) });
  t = text(html);
  assert.ok(t.includes('Doorline staff can’t view link passwords — the campaign’s admins and leads can see it in Share.'));
  assert.ok(!t.includes('Its password:'));
  assert.ok(messageOf(html).endsWith('— I’ll send you its password separately.'));

  // Opened again later: the row says why it can't be shown; Change password offers only Make one up.
  m.fresh();
  html = m.share(m.newQc([link({ passwordViewable: false, passwordHiddenReason: 'staff' })], { staffUnderGrant: true }), { report: report() });
  t = text(html);
  assert.ok(t.includes('Password Doorline staff can’t view link passwords. Change password'), t);
  assert.ok(!/\bShow\b/.test(t));
  html = click(m, 'Change password');
  assert.deepEqual(ticks(html, 'change-password'), [true]);
  assert.ok(!text(html).includes('Type my own'));
});

// ── Share: its link (§D1) ────────────────────────────────────────────────────────────────────────

test('its link: the address with Copy link; the password hidden — Show, then Copy password at the click; Show’s answer stays in Share, never in a cache', async () => {
  const m = await load();
  m.fresh();
  const qc = m.newQc([link({ lastAccessedAt: iso(NOW - DAY) })]);
  let html = m.share(qc, { report: report() });
  let t = text(html);
  assert.ok(t.includes('Link doorline.app/r/tokCa… Copy link'));
  assert.ok(t.includes('Password •••••••••••• Show Change password'));
  assert.ok(t.includes(`Active · Expires ${day(NOW + 60 * DAY)} · Last opened ${day(NOW - DAY)}`));
  assert.ok(t.includes('Extend New address Delete link'));
  assert.ok(!t.includes(SHARE_FORM), 'never a second link to make');
  assert.equal(messageOf(html), `${MESSAGE_START} Open it here: https://doorline.app/r/tokCandidate1 — use the password I sent you.`, 'opened again later');
  click(m, 'Copy link');
  await tickOver();
  assert.equal(m.h().copied.at(-1), 'https://doorline.app/r/tokCandidate1');

  html = click(m, 'Show');
  const f = m.h().fetches.at(-1);
  assert.deepEqual([f.method, f.url], ['GET', '/api/admin/client-reports/shares/l1/password']);
  assert.ok(text(html).includes('Showing…'));
  html = await answer(m, f, 200, { password: 'k7Hq9mXrW2pZ' });
  t = text(html);
  assert.ok(t.includes('Password k7Hq9mXrW2pZ Copy password Change password'), t);
  click(m, 'Copy password');
  await tickOver();
  assert.equal(m.h().copied.at(-1), 'k7Hq9mXrW2pZ', 'copied at the click, from what is on screen');
  assert.ok(!JSON.stringify(qc.getQueryCache().getAll().map((q) => q.state.data)).includes('k7Hq9mXrW2pZ'), 'never a react-query cache entry');
  assert.ok(!messageOf(html).includes('k7Hq9mXrW2pZ'));
});

test('Show on its way when Share closes is aborted; a failed Show says so with Try again; Doorline’s refusals read as can’t be shown', async () => {
  const m = await load();
  m.fresh();
  m.share(m.newQc([link()]), { report: report() });
  click(m, 'Show');
  const f = m.h().fetches.at(-1);
  // Share closes: the link manager's effects clean up — the request is aborted, never answered into it.
  for (const e of m.h().effects.filter((x) => x.owner === 'LinkManager')) e.fn()?.();
  assert.equal(f.signal.aborted, true);

  m.fresh();
  m.share(m.newQc([link()]), { report: report() });
  click(m, 'Show');
  let html = await answer(m, m.h().fetches.at(-1), 500, { error: 'Something broke.' });
  assert.ok(text(html).includes('•••••••••••• Try again Couldn’t show the password.'), text(html));
  click(m, 'Try again');
  html = await answer(m, m.h().fetches.at(-1), 409, { code: 'PASSWORD_NOT_VIEWABLE', reason: 'unavailable', error: 'This link’s password can’t be shown.' });
  assert.ok(text(html).includes(`Password ${CANT_SHOW} Change password`));

  m.fresh();
  m.share(m.newQc([link()]), { report: report() });
  click(m, 'Show');
  html = await answer(m, m.h().fetches.at(-1), 403, { code: 'STAFF_CANNOT_VIEW_PASSWORD', error: 'Doorline staff can’t view link passwords.' });
  assert.ok(text(html).includes('Password Doorline staff can’t view link passwords. Change password'));
});

test('a password that can’t be shown — a link from before, or no key — says so, with Change password; never a Show', async () => {
  const m = await load();
  m.fresh();
  const t = text(m.share(m.newQc([link({ passwordViewable: false, passwordHiddenReason: 'unavailable' })]), { report: report() }));
  assert.ok(t.includes(`Password ${CANT_SHOW} Change password`), t);
  assert.ok(!/\bShow\b/.test(t));
});

test('Change password: made up, Also change it on the other links (ticked), the old link’s own password; the new one in plain text; the message says so; fewer changed than offered', async () => {
  const m = await load();
  m.fresh();
  const mine = link({ samePasswordCount: 3, samePasswordTabs: ['Whole campaign', 'Paid team', 'Paid team'] });
  const qc = m.newQc([mine, oldLink()]);
  m.share(qc, { report: report() });
  let html = click(m, 'Change password');
  let t = text(html);
  assert.deepEqual(ticks(html, 'change-password'), [true, false], 'Make one up for me, picked');
  assert.ok(t.includes('Also change it on the 3 other links that use this password (Whole campaign, Paid team)'), t);
  assert.match(html, /<input type="checkbox"[^>]*checked=""/, 'ticked');
  assert.ok(t.includes('Changing it signs out anyone using the old one — send your client the new password.'));
  assert.ok(t.includes('Your old link to all your reports keeps its own password — if that leaked too, change it or delete it under Old links to all your reports.'));
  html = submit(m, CHANGE_FORM);
  assert.deepEqual(await sent(m), { method: 'PATCH', url: '/api/admin/client-reports/shares/l1', body: { generatePassword: true, alsoChanged: true } });
  assert.equal(disabledButton(html, 'Done'), true, 'Share stays open until the new password lands');
  // Two changes at once can split the links without either seeing a skip: `changed` against the 3 offered.
  html = await settle(m, { share: mine, password: 'N3wPassw0rdXy', changed: 1, skipped: 0 });
  t = text(html);
  assert.ok(t.includes('Password Its password: N3wPassw0rdXy Copy password'), t);
  assert.ok(t.includes('Changed on 1 of the 3 other links — the rest were changed by someone else a moment ago; check their passwords.'));
  assert.ok(messageOf(html).endsWith('— I’ll send you the new password separately.'));
  assert.equal(m.h().changed, 1);
  assert.equal(disabledButton(html, 'Done'), false);

  // Typed, not on the others; the switch already turned the old link off; all offered changed: no line.
  m.fresh();
  m.share(m.newQc([mine, oldLink()], { allReportsRetired: true }), { report: report() });
  html = click(m, 'Change password');
  assert.ok(!text(html).includes('Your old link to all your reports keeps'), 'the switch turned it off');
  html = choose(m, 'Type my own');
  assert.ok(text(html).includes(VISIBLE_LATER));
  html = type(m, 'a typed new password');
  html = tick(m, 'Also change it', false);
  html = submit(m, CHANGE_FORM);
  assert.deepEqual(m.h().last.calls[0].variables, { method: 'PATCH', body: { password: 'a typed new password' } });
  html = await settle(m, { share: mine, changed: 0 });
  t = text(html);
  assert.ok(t.includes('Its password: a typed new password'));
  assert.ok(!t.includes('Changed on'), 'nothing offered, nothing to compare');

  m.fresh();
  m.share(m.newQc([mine]), { report: report() });
  click(m, 'Change password');
  submit(m, CHANGE_FORM);
  html = await settle(m, { share: mine, password: 'An0therOne123', changed: 3, skipped: 0 });
  assert.ok(!text(html).includes('Changed on'), 'every one offered was changed');
  // No other link uses it: no offer.
  m.fresh();
  m.share(m.newQc([link()]), { report: report() });
  assert.ok(!text(click(m, 'Change password')).includes('Also change it'));
});

test('a link’s state in one vocabulary — locked: Unlock now and give it a new address; expired: Renew only; turned off: Turn on, and New address says it stays off', async () => {
  const m = await load();
  m.fresh();
  const lock = { locked: true, until: iso(NOW + 5 * 3600000) };
  let html = m.share(m.newQc([link({ lock, failures: { last24h: 50, last7d: 50, total: 61 }, rotateAdvice: true })]), { report: report() });
  let t = text(html);
  assert.ok(t.includes('Locked'));
  assert.ok(t.includes('after 50 wrong passwords. Devices already signed in still work.'));
  assert.ok(t.includes('50 wrong passwords in the last day · 50 this week · 61 in total.'));
  assert.ok(t.includes('Someone else has this link — 50 wrong passwords is never your client. Give it a new address.'));
  assert.ok(t.includes('Extend Unlock now New address Delete link'), t);
  assert.ok(!/Rotate|Disable|Enable|Turn off/.test(t), 'one vocabulary');
  click(m, 'Unlock now');
  assert.deepEqual(m.h().last.calls[0].variables, { path: '/unlock' });

  // Expired: Renew, never New address or Unlock (its new address would be dead on arrival).
  m.fresh();
  html = m.share(m.newQc([link({ expiresAt: iso(NOW - DAY), lock, failures: { last24h: 50, last7d: 50, total: 50 }, rotateAdvice: true })]), { report: report() });
  t = text(html);
  assert.ok(t.includes(`Expired · Expired ${day(NOW - DAY)}`), t);
  assert.ok(t.includes('Renew gives this link a new address — send your client the new link.'));
  assert.ok(t.includes('Renew Delete link') && !t.includes('New address') && !t.includes('Unlock now') && !t.includes('Someone else has this link'));
  html = click(m, 'Renew');
  assert.ok(text(html).includes('Renew gives this link a new address — send your client the new link. The password stays the same.'));
  click(m, 'Renew link');
  assert.deepEqual(m.h().last.calls[0].variables, { path: '/renew', body: { expiresInDays: 90 } });

  // Turned off (from before — there's no Turn off now): Turn on; New address keeps it off.
  m.fresh();
  const qc = m.newQc([link({ isActive: false })]);
  html = m.share(qc, { report: report() });
  t = text(html);
  assert.ok(t.includes('Turned off') && t.includes('Nobody can open it until you turn it on.'));
  assert.ok(t.includes('Turn on Extend New address Delete link'), t);
  html = click(m, 'New address');
  assert.ok(text(html).includes('It stays turned off — nobody can open the new address until you turn it on.'));
  click(m, 'Cancel');
  click(m, 'Turn on');
  assert.deepEqual(m.h().last.calls.at(-1).variables, { method: 'PATCH', body: { isActive: true } });
  html = await settle(m, { share: link() });
  assert.ok(text(html).includes('Active') && !text(html).includes('Turned off'), 'the answer’s row, at once');

  // Extend: only later dates, up to a year from when it was made.
  m.fresh();
  m.share(m.newQc([link()]), { report: report() });
  html = click(m, 'Extend');
  assert.ok(text(html).includes('Make it last until:'));
  click(m, `${formatDateInTz(new Date(NOW + 90 * DAY), TZ)} (90 days)`);
  assert.deepEqual(m.h().last.calls[0].variables, { path: '/extend', body: { expiresInDays: 90 } });
});

test('New address asks first, then the new address shows at once — in the link and in the message', async () => {
  const m = await load();
  m.fresh();
  m.share(m.newQc([link()]), { report: report() });
  let html = click(m, 'New address');
  let t = text(html);
  assert.ok(t.includes('Give this link a new address?'));
  assert.ok(t.includes(`It gets a new address, and everyone using the old one is signed out. The password stays the same. It still expires ${formatDateInTz(iso(NOW + 60 * DAY), TZ)}.`));
  assert.ok(t.includes('Send your client the new link afterwards.'));
  html = click(m, 'New address');
  assert.deepEqual(await sent(m), { method: 'POST', url: '/api/admin/client-reports/shares/l1/rotate', body: null });
  html = await settle(m, { share: link({ token: 'tokRotated999' }) });
  t = text(html);
  assert.ok(t.includes('Link doorline.app/r/tokRo… Copy link'));
  assert.equal(messageOf(html), `${MESSAGE_START} Open it here: https://doorline.app/r/tokRotated999 — use the password I sent you.`);
  assert.ok(!t.includes('Give this link a new address?'), 'the confirm closed');
});

test('Delete link asks first; then the report has no link of its own, and Share offers to make one', async () => {
  const m = await load();
  m.fresh();
  const qc = m.newQc([link(), lastWeek]);
  m.share(qc, { report: report() });
  let html = click(m, 'Delete link');
  assert.ok(text(html).includes('Delete this link? Anyone using it loses access for good. This can’t be undone.'));
  html = click(m, 'Delete link');
  assert.deepEqual(await sent(m), { method: 'DELETE', url: '/api/admin/client-reports/shares/l1', body: null });
  html = await settle(m, { ok: true });
  assert.deepEqual(m.sharesIn(qc).map((s) => s.id), ['p1'], 'gone from the list at once');
  assert.ok(text(html).includes(SHARE_FORM));
  assert.equal(disabledButton(html, 'Copy message'), true);
});

test('a report that got two links before one link per report: the main one, then “Also opens this report: Board · made …” with Delete, which asks first', async () => {
  const m = await load();
  m.fresh();
  const board = link({ id: 'x1', token: 'tokBoardOld01', label: 'Board', createdAt: iso(NOW - 4 * DAY) });
  const unlabelled = link({ id: 'x2', token: 'tokOther00001', createdAt: iso(NOW - 5 * DAY) });
  let html = m.share(m.newQc([board, link(), unlabelled]), { report: report() });
  const t = text(html);
  assert.ok(t.includes('Link doorline.app/r/tokCa…'), 'the main link: the newest usable one');
  assert.ok(t.includes(`Also opens this report: Board · made ${day(NOW - 4 * DAY)} · Delete`), t);
  assert.ok(t.includes(`Also opens this report: a link made ${day(NOW - 5 * DAY)} · Delete`));
  html = click(m, 'Delete', 0);
  assert.ok(text(html).includes('Delete this link? Anyone using it loses access for good. This can’t be undone.'));
  click(m, 'Delete link');
  assert.deepEqual(await sent(m), { method: 'DELETE', url: '/api/admin/client-reports/shares/x1', body: null });
});

test('a taken-down report: its link is still managed here, but its message can’t be copied; without a link, nothing to make until it’s back up', async () => {
  const m = await load();
  m.fresh();
  let html = m.share(m.newQc([link()]), { report: report({ takenDownAt: iso(NOW - DAY) }) });
  let t = text(html);
  assert.ok(t.includes('This report is taken down — its link shows “taken down” until you put it back up.'));
  assert.ok(t.includes('Copy link') && t.includes('Change password') && t.includes('Delete link'));
  assert.ok(!t.includes('Message (no password in it)'));
  assert.equal(disabledButton(html, 'Copy message'), true);

  m.fresh();
  html = m.share(m.newQc([lastWeek]), { report: report({ takenDownAt: iso(NOW - DAY) }) });
  t = text(html);
  assert.ok(t.includes('This report is taken down. Put it back up, then make its link.'));
  assert.ok(!t.includes(SHARE_FORM) && !t.includes('Create link'));
  assert.equal(disabledButton(html, 'Copy message'), true);
});

test('Create refused: Same as …’s password can’t be copied any more — choose another way; someone made the link a moment ago — here it is; anything else in the server’s words', async () => {
  const m = await load();
  m.fresh();
  m.share(m.newQc([lastWeek]), { report: report() });
  submit(m, SHARE_FORM);
  let html = await settle(m, refusal('PASSWORD_NOT_VIEWABLE', 409, { error: 'That link’s password can’t be copied.' }));
  let t = text(html);
  assert.ok(t.includes('Your last link’s password can’t be copied any more — choose Make one up for me or Type my own.'), t);
  assert.equal(m.h().changed, 1, 'the list is read again: it says which passwords can still be copied');
  assert.deepEqual(ticks(html, 'share-password'), [false, false, false], 'nothing picked: the operator chooses');
  assert.match(html, /<input type="radio" name="share-password"[^>]*disabled=""/, 'that Same as … can’t be picked again');
  assert.equal(disabledButton(html, 'Create link'), true);
  choose(m, 'Make one up for me');
  submit(m, SHARE_FORM);
  assert.deepEqual(m.h().last.calls.at(-1).variables, { campaignId: CID, reportId: 'r1', expiresInDays: 90 });

  m.fresh();
  m.share(m.newQc([lastWeek]), { report: report() });
  submit(m, SHARE_FORM);
  html = await settle(m, refusal('SOURCE_NOT_FOUND', 404, { error: 'Source link not found' }));
  assert.ok(text(html).includes('Your last link’s password can’t be copied any more'));

  // Two people pressed Create at once: the other one's link, with the password they chose.
  m.fresh();
  const qc = m.newQc([]);
  m.share(qc, { report: report() });
  submit(m, SHARE_FORM);
  const theirs = link({ id: 'z9', token: 'tokTheirs0001', createdAt: iso(NOW) });
  html = await settle(m, refusal('REPORT_HAS_LINK', 409, { error: 'This report already has its link.', share: theirs }));
  t = text(html);
  assert.ok(t.includes('Someone made this report’s link a moment ago — here it is. Its password is the one they chose.'));
  assert.ok(t.includes('Link doorline.app/r/tokTh…') && t.includes('•••••••••••• Show'));
  assert.ok(!t.includes('Couldn’t create the link.') && !t.includes('Its password:'));
  assert.ok(messageOf(html).endsWith('— use the password I sent you.'));
  assert.equal(m.sharesIn(qc)[0].id, 'z9');

  m.fresh();
  m.share(m.newQc([]), { report: report() });
  submit(m, SHARE_FORM);
  html = await settle(m, refusal('REPORT_NOT_SHOWN', 409, { error: 'This report is taken down. Put it back up, then make its link.' }));
  assert.ok(text(html).includes('Couldn’t create the link. This report is taken down. Put it back up, then make its link.'));
});

test('Create refused for the report itself (code review V2-2): taken down elsewhere, the report is read again and Share then shows it taken down; deleted, Share says so, offers nothing more and reads the links again', async () => {
  const m = await load();
  let reads = 0;
  const onReportChanged = () => {
    reads += 1;
  };
  m.fresh();
  const qc = m.newQc([]);
  m.share(qc, { report: report(), onReportChanged });
  submit(m, SHARE_FORM);
  let html = await settle(m, refusal('REPORT_NOT_SHOWN', 409, { error: 'This report is taken down. Put it back up, then make its link.', status: 'published', takenDown: true }));
  assert.equal(reads, 1, 'the report is read again');
  assert.equal(m.h().changed, 0, 'its links didn’t change');
  // The page hands Share the report as it stands now — taken down: no Create link on it any more.
  html = m.share(qc, { report: report({ takenDownAt: iso(NOW) }), onReportChanged });
  let t = text(html);
  assert.ok(t.includes('This report is taken down. Put it back up, then make its link.'), t);
  assert.ok(!t.includes(SHARE_FORM) && !t.includes('Create link') && !t.includes('Couldn’t create'), t);

  // Deleted a moment ago, somewhere else.
  m.fresh();
  reads = 0;
  m.share(m.newQc([]), { report: report(), onReportChanged });
  submit(m, SHARE_FORM);
  html = await settle(m, refusal('REPORT_NOT_FOUND', 404, { error: 'Report not found' }));
  t = text(html);
  assert.equal(reads, 1, 'the report is read again: its row goes');
  assert.equal(m.h().changed, 1, 'the links list is read again: its links went with it');
  assert.ok(t.includes('This report was deleted — there’s nothing to share.'), t);
  assert.ok(!t.includes(SHARE_FORM) && !t.includes('Create link') && !t.includes('Report not found'), t);
  assert.equal(disabledButton(html, 'Copy message'), true);
});

test('before the links list is in, Share waits; a list that failed says so with Try again — and opening Share after a failure reads it again (LINK-3, VER-2)', async () => {
  const m = await load();
  m.fresh();
  let html = m.share(m.newQc(null), { report: report() });
  let t = text(html);
  assert.ok(t.includes('Link Loading links…'));
  assert.ok(!t.includes(SHARE_FORM) && !t.includes('Create link'), 'nothing offered on a list it hasn’t read');
  assert.equal(disabledButton(html, 'Copy message'), true);

  m.fresh();
  const qc = m.newQc(null);
  let reads = 0;
  qc.refetchQueries = () => {
    reads += 1;
    return Promise.resolve();
  };
  html = m.share(qc, { report: report(), linksError: Object.assign(new Error('Couldn’t reach Doorline.'), { status: 0 }) });
  t = text(html);
  assert.ok(t.includes('Couldn’t load the links. Couldn’t reach Doorline.') && !t.includes('Loading links…'));
  for (const e of m.h().effects.filter((x) => x.owner === 'ShareDialog')) e.fn();
  assert.equal(reads, 1, 'read again as Share opens');
  click(m, 'Try again');
  assert.equal(reads, 2);
});

// ── Code review round 1 (CC-1 – CC-6) ─────────────────────────────────────────────────────────────

test('a link the client can’t open — turned off, expired, locked — offers no message: Copy message is off, as on a taken-down report, and one line says what to do first (code review CC-1)', async () => {
  const m = await load();
  const gone = iso(NOW - DAY);
  const lock = { lock: { locked: true, until: iso(NOW + 5 * 3600000) }, failures: { last24h: 50, last7d: 50, total: 50 }, rotateAdvice: true };
  for (const [over, line] of [
    [{ isActive: false }, 'Turn it on before you send it.'],
    [{ expiresAt: gone }, 'Renew it before you send it.'],
    [lock, 'Unlock it before you send it.'],
    // Turned off and expired: turned off first, as the row's link line reads them.
    [{ isActive: false, expiresAt: gone }, 'Turn it on before you send it.'],
  ]) {
    m.fresh();
    const html = m.share(m.newQc([link(over)]), { report: report() });
    const t = text(html);
    assert.equal(disabledButton(html, 'Copy message'), true, JSON.stringify(over));
    assert.ok(!t.includes('Message (no password in it)') && messageOf(html) === '', 'no message to copy');
    assert.ok(t.includes(line), `${JSON.stringify(over)}: ${t}`);
  }
  // Turned on again: the message is back, and the line has gone.
  m.fresh();
  m.share(m.newQc([link({ isActive: false })]), { report: report() });
  click(m, 'Turn on');
  let html = await settle(m, { share: link() });
  assert.equal(disabledButton(html, 'Copy message'), false);
  assert.equal(messageOf(html), `${MESSAGE_START} Open it here: https://doorline.app/r/tokCandidate1 — use the password I sent you.`);
  assert.ok(!text(html).includes('before you send it'));
  // Taken down as well: its banner says why — no second line.
  m.fresh();
  html = m.share(m.newQc([link({ expiresAt: gone })]), { report: report({ takenDownAt: gone }) });
  assert.ok(text(html).includes('This report is taken down — its link shows') && !text(html).includes('before you send it'));
  assert.equal(disabledButton(html, 'Copy message'), true);
});

test('a refusal shows only beside the request that sent it: a confirm or a panel opened afterwards opens clean — in Share and on the old-links card (code review CC-2)', async () => {
  const m = await load();
  const BROKE = 'Doorline didn’t answer.';
  const broke = () => refusal('BROKE', 500, { error: BROKE });
  const ninety = `${formatDateInTz(new Date(NOW + 90 * DAY), TZ)} (90 days)`;
  m.fresh();
  m.share(m.newQc([link()]), { report: report() });
  // Extend refused: said under the buttons. Then New address: its confirm says nothing of it.
  click(m, 'Extend');
  click(m, ninety);
  let html = await settle(m, broke());
  assert.ok(text(html).includes(BROKE), 'Extend’s refusal, under the buttons');
  html = click(m, 'New address');
  assert.ok(text(html).includes('Give this link a new address?') && !text(html).includes(BROKE), text(html));
  // New address refused: said in its confirm. Cancel, then Delete link: that confirm opens clean.
  click(m, 'New address');
  html = await settle(m, broke());
  assert.match(text(html), /Give this link a new address\?[^]*Doorline didn’t answer\./, 'in the confirm that sent it');
  click(m, 'Cancel');
  html = click(m, 'Delete link');
  assert.ok(text(html).includes('Delete this link?') && !text(html).includes(BROKE), text(html));
  // Delete link refused, cancelled, asked again: clean.
  click(m, 'Delete link');
  html = await settle(m, broke());
  assert.ok(text(html).includes(BROKE));
  click(m, 'Cancel');
  html = click(m, 'Delete link');
  assert.ok(text(html).includes('Delete this link?') && !text(html).includes(BROKE), 'asked again, it opens clean');
  click(m, 'Cancel');
  // Change password refused, cancelled, opened again: clean.
  click(m, 'Change password');
  submit(m, CHANGE_FORM);
  html = await settle(m, broke());
  assert.ok(text(html).includes(BROKE), 'said in the panel');
  click(m, 'Cancel');
  html = click(m, 'Change password');
  assert.ok(text(html).includes('Changing it signs out') && !text(html).includes(BROKE), text(html));

  // A link from before one link per report: its Delete refused, cancelled, asked again — clean.
  m.fresh();
  const board = link({ id: 'x1', token: 'tokBoardOld01', label: 'Board', createdAt: iso(NOW - 4 * DAY) });
  m.share(m.newQc([board, link()]), { report: report() });
  click(m, 'Delete', 0);
  click(m, 'Delete link');
  html = await settle(m, broke());
  assert.ok(text(html).includes(BROKE));
  click(m, 'Cancel');
  html = click(m, 'Delete', 0);
  assert.ok(text(html).includes('Delete this link?') && !text(html).includes(BROKE), text(html));

  // The old-links card: New address refused, cancelled — Delete's confirm opens clean; Change password
  // refused, cancelled, opened again — clean.
  m.fresh();
  m.card(m.newQc([oldLink()]));
  click(m, 'New address');
  click(m, 'New address');
  html = await settle(m, broke());
  assert.ok(text(html).includes(BROKE), 'in its confirm');
  click(m, 'Cancel');
  html = click(m, 'Delete');
  assert.ok(text(html).includes('Delete this link?') && !text(html).includes(BROKE), text(html));
  click(m, 'Cancel');
  click(m, 'Change password');
  submit(m, CHANGE_FORM);
  html = await settle(m, broke());
  assert.ok(text(html).includes(BROKE));
  click(m, 'Cancel');
  html = click(m, 'Change password');
  assert.ok(text(html).includes('Changing it signs out') && !text(html).includes(BROKE), text(html));
});

test('Same as … refused, and the list read again has another tab’s link in its place: nothing is picked — that link is offered, never picked; nor when this tab’s source was deleted elsewhere (code review CC-3)', async () => {
  const m = await load();
  const KEY = ['admin', 'client-report-shares', CID];
  m.fresh();
  const qc = m.newQc([lastWeek, paidTeam]);
  let html = m.share(qc, { report: report() });
  assert.deepEqual(ticks(html, 'share-password'), [true, false, false], 'this tab’s password, picked');
  submit(m, SHARE_FORM);
  await settle(m, refusal('SOURCE_NOT_FOUND', 404, { error: 'Your last link’s password can’t be copied any more — choose Make one up for me or Type my own.' }));
  assert.equal(m.h().changed, 1, 'the list is read again');
  // Read again: last week's link was deleted a moment ago; the Paid team's stays.
  qc.setQueryData(KEY, { shares: [paidTeam], allReportsRetired: false, staffUnderGrant: false });
  html = m.rerender();
  assert.ok(text(html).includes('Same as the Paid team · Oct 12 – Oct 18 link Make one up for me Type my own'), text(html));
  assert.deepEqual(ticks(html, 'share-password'), [false, false, false], 'the operator chooses, as the banner asks');
  assert.equal(disabledButton(html, 'Create link'), true);
  // Picked on purpose, it can be — and that's what is sent.
  html = choose(m, 'Same as the Paid team');
  assert.deepEqual(ticks(html, 'share-password'), [true, false, false]);
  submit(m, SHARE_FORM);
  assert.deepEqual(m.h().last.calls.at(-1).variables, { campaignId: CID, reportId: 'r1', expiresInDays: 90, passwordFrom: 't1' });

  // No refusal at all: this tab's link deleted elsewhere while Share is open, and the list read again.
  // Same as … doesn't move onto another tab's link — Make one up for me, as for a source nobody picked.
  m.fresh();
  const qc2 = m.newQc([lastWeek, paidTeam]);
  m.share(qc2, { report: report() });
  qc2.setQueryData(KEY, { shares: [paidTeam], allReportsRetired: false, staffUnderGrant: false });
  html = m.rerender();
  assert.deepEqual(ticks(html, 'share-password'), [false, true, false]);
  submit(m, SHARE_FORM);
  assert.deepEqual(m.h().last.calls.at(-1).variables, { campaignId: CID, reportId: 'r1', expiresInDays: 90 }, 'made up — never the Paid team’s password');
});

test('a refusal that means the link changed elsewhere reads the list again — deleted, renewed, changed, expired meanwhile, or turned off by the switch; Show’s 404 and Create’s SHARE_CHANGED too; any other refusal doesn’t (code review CC-4)', async () => {
  const m = await load();
  const ninety = `${formatDateInTz(new Date(NOW + 90 * DAY), TZ)} (90 days)`;
  // Delete link: deleted elsewhere a moment ago.
  m.fresh();
  m.share(m.newQc([link()]), { report: report() });
  click(m, 'Delete link');
  click(m, 'Delete link');
  await settle(m, refusal('SHARE_NOT_FOUND', 404, { error: 'Share link not found' }));
  assert.equal(m.h().changed, 1, 'deleted elsewhere');
  // Renew: renewed elsewhere a moment ago.
  m.fresh();
  m.share(m.newQc([link({ expiresAt: iso(NOW - DAY) })]), { report: report() });
  click(m, 'Renew');
  click(m, 'Renew link');
  await settle(m, refusal('SHARE_NOT_EXPIRED', 409, { error: 'Only an expired link is renewed. Extend this one instead.' }));
  assert.equal(m.h().changed, 1, 'renewed elsewhere');
  // Extend: changed, or expired, meanwhile.
  for (const code of ['SHARE_CHANGED', 'SHARE_NEEDS_RENEW']) {
    m.fresh();
    m.share(m.newQc([link()]), { report: report() });
    click(m, 'Extend');
    click(m, ninety);
    await settle(m, refusal(code, 409));
    assert.equal(m.h().changed, 1, code);
  }
  // Show: deleted elsewhere — read again, the link and its Try again leave the screen.
  m.fresh();
  m.share(m.newQc([link()]), { report: report() });
  click(m, 'Show');
  await answer(m, m.h().fetches.at(-1), 404, { code: 'SHARE_NOT_FOUND', error: 'Share link not found' });
  assert.equal(m.h().changed, 1, 'Show’s 404');
  // Create: the report's link changed a moment ago (two Creates at once).
  m.fresh();
  m.share(m.newQc([]), { report: report() });
  submit(m, SHARE_FORM);
  await settle(m, refusal('SHARE_CHANGED', 409, { error: 'This report’s link just changed. Look again, then share it.' }));
  assert.equal(m.h().changed, 1, 'Create');
  // The old-links card: the switch turned these off since the page read the list.
  m.fresh();
  m.card(m.newQc([oldLink()]));
  click(m, 'New address');
  click(m, 'New address');
  await settle(m, refusal('ALL_REPORTS_LINK', 409, { error: 'Links that open all your reports can only be deleted now.' }));
  assert.equal(m.h().changed, 1, 'the switch');
  // Anything else is said where it happened; the list isn't read for it.
  m.fresh();
  m.share(m.newQc([link()]), { report: report() });
  click(m, 'Extend');
  click(m, ninety);
  await settle(m, refusal('BROKE', 500, { error: 'Doorline didn’t answer.' }));
  click(m, 'Show');
  await answer(m, m.h().fetches.at(-1), 500, { error: 'Something broke.' });
  assert.equal(m.h().changed, 0);
});

test('Type my own’s box is named by its radio’s words and described by the lines under it — the hint, then the warning (code review CC-5)', async () => {
  const m = await load();
  // What a screen reader reads for the password box: its name (aria-labelledby) and description
  // (aria-describedby), from the elements those ids point at.
  const named = (html) => {
    const input = (html.match(/<input type="password"[^>]*>/) || [''])[0];
    const attr = (name) => (input.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1] || '';
    const byId = (id) => text((html.match(new RegExp(`<[a-z]+ id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([^<]*)<`)) || [])[1] || '').trim();
    return { name: attr('aria-labelledby').split(' ').filter(Boolean).map(byId).join(' '), description: attr('aria-describedby').split(' ').filter(Boolean).map(byId) };
  };
  m.fresh();
  m.share(m.newQc([]), { report: report() });
  let html = choose(m, 'Type my own');
  assert.deepEqual(named(html), { name: 'Type my own', description: ['12 or more characters', VISIBLE_LATER] });
  // Change password in Share: the same.
  m.fresh();
  m.share(m.newQc([link()]), { report: report() });
  click(m, 'Change password');
  html = choose(m, 'Type my own');
  assert.deepEqual(named(html), { name: 'Type my own', description: ['12 or more characters', VISIBLE_LATER] });
  // The card: an old link's password is never kept, so no warning — the hint only.
  m.fresh();
  m.card(m.newQc([oldLink()]));
  click(m, 'Change password');
  html = choose(m, 'Type my own');
  assert.deepEqual(named(html), { name: 'Type my own', description: ['12 or more characters'] });
});

// Where the keyboard lands is a real DOM's to see (renderToString never mounts, focuses or runs an
// effect): clientReportShareFlow.smoke.test.js presses these on the real page. Here, what the markup
// carries: Copy password takes the keyboard as it appears, while Copy link never takes it by mounting —
// mounting can come before Share's own `did` is drawn (code review N1) — but is marked for Share to find
// once the link is on screen.
test('after Create link with no password on screen — Same as …, someone else’s link, or one staff never see — Copy link takes the keyboard once drawn, never by mounting; a password on screen gives it to Copy password (code review CC-6, N1)', async () => {
  const m = await load();
  const focusTakers = () => m.h().handlers.filter((x) => x.props.autoFocus).map((x) => x.text);
  const copyLinkMarked = (html) => /<button[^>]*data-link-action="copy"[^>]*>Copy link<\/button>/.test(html);
  // Same as …
  m.fresh();
  m.share(m.newQc([lastWeek]), { report: report() });
  submit(m, SHARE_FORM);
  let html = await settle(m, { share: made() });
  assert.deepEqual(focusTakers(), []);
  assert.ok(copyLinkMarked(html), html);
  // Someone made it a moment ago: here it is.
  m.fresh();
  m.share(m.newQc([]), { report: report() });
  submit(m, SHARE_FORM);
  html = await settle(m, refusal('REPORT_HAS_LINK', 409, { error: 'This report already has its link.', share: link({ id: 'z9', token: 'tokTheirs0001', createdAt: iso(NOW) }) }));
  assert.deepEqual(focusTakers(), []);
  assert.ok(copyLinkMarked(html));
  // Made up by Doorline staff, who never see it.
  m.fresh();
  m.share(m.newQc([], { staffUnderGrant: true }), { report: report() });
  submit(m, SHARE_FORM);
  html = await settle(m, { share: made({ passwordViewable: false, passwordHiddenReason: 'staff' }) });
  assert.deepEqual(focusTakers(), []);
  assert.ok(copyLinkMarked(html));
  // Made up and shown: Copy password takes it.
  m.fresh();
  m.share(m.newQc([]), { report: report() });
  submit(m, SHARE_FORM);
  await settle(m, { share: made(), generatedPassword: 'k7Hq9mXrW2pZ' });
  assert.deepEqual(focusTakers(), ['Copy password']);
  // Opened on the link it already has: nothing takes it (the dialog's own first focus stands).
  m.fresh();
  m.share(m.newQc([link()]), { report: report() });
  assert.deepEqual(focusTakers(), []);
});

// ── The old-links card (§C1, §D3, Part 1 §3) ────────────────────────────────────────────────────

test('the old-links card: nothing without a link to all your reports, or before the list is in', async () => {
  const m = await load();
  m.fresh();
  assert.equal(m.card(m.newQc([link(), lastWeek])), '');
  assert.equal(m.card(m.newQc(null)), '');
});

test('the card before the switch: what each old link does now; Change password and New address on one that still works; Delete on each, asking first by its state', async () => {
  const m = await load();
  m.fresh();
  const working = oldLink({ lastAccessedAt: iso(NOW - 2 * DAY) });
  const expired = oldLink({ id: 'a2', token: 'tokAllReports2', label: '', createdAt: iso(NOW - 100 * DAY), expiresAt: iso(NOW - 3 * DAY) });
  const off = oldLink({ id: 'a3', token: 'tokAllReports3', label: 'Board', isActive: false, createdAt: iso(NOW - 95 * DAY) });
  const qc = m.newQc([link(), expired, off, working]);
  let html = m.card(qc);
  let t = text(html);
  assert.ok(t.includes('Old links to all your reports Each report now has its own link: press Share on a report to send it. Doorline will turn these old links off.'), t);
  // Newest first, each saying what it does now.
  assert.ok(
    t.includes(
      `Candidate · still opens every report · last opened ${day(NOW - 2 * DAY)} Change password New address Delete Board · turned off Delete A link made ${day(NOW - 100 * DAY)} · expired ${day(NOW - 3 * DAY)} Delete`
    ),
    t
  );
  assert.ok(!/Turn on|Renew|Extend|Unlock/.test(t), 'none can be turned back on, renewed or extended');
  assert.ok(!t.includes('doorline.app/r/'), 'no address to send: each report has its own link now');

  // Delete on the one that still works: the client loses every report on it now.
  html = click(m, 'Delete', 0);
  assert.ok(
    text(html).includes(
      'Delete this link? Your client loses every report on it now, not on the day Doorline turns these off. Send them each report’s own link first. This can’t be undone.'
    )
  );
  click(m, 'Delete link');
  assert.deepEqual(await sent(m), { method: 'DELETE', url: '/api/admin/client-reports/shares/a1', body: null });
  await settle(m, { ok: true });
  assert.equal(m.h().changed, 1);
  m.forget('OldLinkRow');
  html = m.rerender();
  assert.ok(!text(html).includes('Candidate'), 'gone from the list at once');
  // On one nobody can open: it only leaves the list.
  html = click(m, 'Delete', 0);
  assert.ok(text(html).includes('Delete this link? Nobody can open it. This removes it from your list.'));
  m.forget('OldLinkRow');
  m.rerender();
  html = click(m, 'Delete', 1);
  assert.ok(text(html).includes('Delete this link? Nobody can open it. This removes it from your list.'), 'expired, the same');
});

test('the card’s Change password: no "everyone can see it later" (an old link’s password is never kept) and no Also change it; the new password shows once, right there', async () => {
  const m = await load();
  m.fresh();
  m.card(m.newQc([oldLink()]));
  let html = click(m, 'Change password');
  let t = text(html);
  assert.ok(t.includes('Changing it signs out anyone using the old one — send your client the new password.'));
  assert.ok(!t.includes('Also change it') && !t.includes('Your old link to all your reports keeps'));
  html = choose(m, 'Type my own');
  assert.ok(!text(html).includes('Everyone who manages this campaign can see'), 'never kept, so never shown later');
  html = choose(m, 'Make one up for me');
  html = submit(m, CHANGE_FORM);
  assert.deepEqual(await sent(m), { method: 'PATCH', url: '/api/admin/client-reports/shares/a1', body: { generatePassword: true } });
  html = await settle(m, { share: oldLink(), password: 'Fr3shPassw0rd' });
  t = text(html);
  assert.ok(t.includes('Its password: Fr3shPassw0rd Copy password'), t);
  click(m, 'Copy password');
  await tickOver();
  assert.equal(m.h().copied.at(-1), 'Fr3shPassw0rd');
});

test('the card’s New address: asks first, then shows the new address to copy; staff get no Change password (nobody could see it)', async () => {
  const m = await load();
  m.fresh();
  m.card(m.newQc([oldLink()]));
  let html = click(m, 'New address');
  let t = text(html);
  assert.ok(t.includes('Give this link a new address?') && t.includes('Send your client the new link afterwards.'));
  html = click(m, 'New address');
  assert.deepEqual(m.h().last.calls.at(-1).variables, { path: '/rotate' });
  html = await settle(m, { share: oldLink({ token: 'tokAllRotated9' }) });
  t = text(html);
  assert.ok(t.includes('Its new address: doorline.app/r/tokAl… Copy link'), t);
  click(m, 'Copy link');
  await tickOver();
  assert.equal(m.h().copied.at(-1), 'https://doorline.app/r/tokAllRotated9');

  m.fresh();
  t = text(m.card(m.newQc([oldLink()], { staffUnderGrant: true })));
  assert.ok(!t.includes('Change password') && t.includes('New address') && t.includes('Delete'));
});

test('the card after the switch: turned off — every row the link and when it was last opened, with Delete only, which says it no longer works', async () => {
  const m = await load();
  m.fresh();
  const qc = m.newQc([oldLink({ lastAccessedAt: iso(NOW - DAY) }), oldLink({ id: 'a2', token: 'tokAllReports2', label: 'Board', isActive: false, createdAt: iso(NOW - 95 * DAY) })], {
    allReportsRetired: true,
  });
  let html = m.card(qc);
  const t = text(html);
  assert.ok(
    t.includes(
      'Old links to all your reports — turned off These opened every report of this campaign and no longer work. Each report now has its own link: press Share on a report to send it.'
    ),
    t
  );
  assert.ok(t.includes(`Candidate · last opened ${day(NOW - DAY)} Delete Board Delete`), t);
  assert.ok(!/still opens every report|Change password|New address/.test(t));
  html = click(m, 'Delete', 0);
  assert.ok(text(html).includes('Delete this link? It no longer works. This removes it from your list.'));
});
