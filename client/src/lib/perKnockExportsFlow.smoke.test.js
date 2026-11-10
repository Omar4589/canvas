import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// FLOW test for One row per knock on the Exports page (docs/PROPOSAL_ONE_ROW_PER_KNOCK.md): the REAL
// page on react-dom's client renderer, a real QueryClient, the API stubbed, driven through the owner's
// steps. The render smoke test (perKnockExportsRender) seeds state and never clicks, so a review proved
// it could not fail when (a) the box stopped resetting each time the options open — the owner's D1
// ruling, "make it needed to be checked every time" — or (b) the option stopped reaching the POST.
// This one fails on both, and pins the campaign-switch reset of the walk list, round and canvasser,
// and that a failed attempt's error never greets the next dialog.
//
// The repo has no jsdom: the minimal DOM below is memberDeletionFlow.smoke's, plus select/option
// support (react-dom's ReactDOMSelect walks node.options). node --test runs each file in its own
// process, so these globals never meet another test.

const here = fileURLToPath(new URL('.', import.meta.url));
// Inside the client tree on purpose: dependencies stay external to the bundle, so node resolves
// react/react-dom from the bundle's own location.
const dir = mkdtempSync(join(here, '../../.smoke-per-knock-flow-'));
after(() => rmSync(dir, { recursive: true, force: true }));

writeFileSync(join(dir, 'authStub.jsx'), `export const useAuth = () => ({ homePath: '/', isOrgAdmin: true, isLead: false, isSuperAdmin: false, user: { id: 'u1' }, activeOrgId: 'o1', activeMembership: { role: 'admin' } });
export const useOrgTimeZone = () => 'America/Chicago';`);
writeFileSync(join(dir, 'apiStub.js'), 'export const api = (path, options) => globalThis.__api(path, options || {}); export const getToken = () => null; export const getActiveOrgId = () => null; export const setToken = () => {}; export const setActiveOrgId = () => {};');
writeFileSync(join(dir, 'overlayStub.jsx'), 'export default function Overlay({ children }) { return <div data-overlay="">{children}</div>; }');
writeFileSync(join(dir, 'entry.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import ExportsPage from '${join(here, '../pages/ExportsPage.jsx')}';
const Nav = () => { globalThis.__navigate = useNavigate(); return null; };
export const mount = (path) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><Nav /><Routes><Route path="/campaigns/:campaignId/exports" element={<ExportsPage />} /></Routes></MemoryRouter></QueryClientProvider>);
  return { qc, unmount: () => { root.unmount(); qc.clear(); } };
};`);

const bundle = join(dir, 'bundle.mjs');
await esbuild.build({
  entryPoints: [join(dir, 'entry.jsx')],
  bundle: true, format: 'esm', platform: 'node', outfile: bundle, jsx: 'automatic', logLevel: 'silent',
  packages: 'external',
  plugins: [{
    name: 'stubs',
    setup(b) {
      b.onResolve({ filter: /(^|\/)Overlay\.jsx$/ }, () => ({ path: join(dir, 'overlayStub.jsx') }));
      b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
      b.onResolve({ filter: /api\/client\.js$/ }, () => ({ path: join(dir, 'apiStub.js') }));
    },
  }],
});

// ---- minimal DOM ----
const ELEMENT = 1, TEXT = 3, DOCUMENT = 9;
const capturing = (opts) => (typeof opts === 'boolean' ? opts : !!opts?.capture);
const listenable = {
  addEventListener(type, fn, opts) { (this.__listeners ||= []).push({ type, fn, capture: capturing(opts) }); },
  removeEventListener(type, fn, opts) {
    const list = this.__listeners || [];
    const i = list.findIndex((l) => l.type === type && l.fn === fn && l.capture === capturing(opts));
    if (i >= 0) list.splice(i, 1);
  },
};
class FakeNode {
  constructor(nodeType, nodeName, ownerDocument) { this.nodeType = nodeType; this.nodeName = nodeName; this.ownerDocument = ownerDocument; this.childNodes = []; this.parentNode = null; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling() { const s = this.parentNode?.childNodes; return s ? s[s.indexOf(this) + 1] ?? null : null; }
  get parentElement() { return this.parentNode?.nodeType === ELEMENT ? this.parentNode : null; }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, ref) {
    child.parentNode?.removeChild(child);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(child); else this.childNodes.splice(i, 0, child);
    child.parentNode = this; return child;
  }
  removeChild(child) {
    const doc = this.ownerDocument || this;
    if (doc.activeElement && child.contains(doc.activeElement)) doc.activeElement = doc.body;
    this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null; return child;
  }
  contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
  get textContent() { return this.nodeType === TEXT ? this.nodeValue : this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(value) {
    while (this.childNodes.length) this.removeChild(this.childNodes[0]);
    if (value !== '' && value != null) this.appendChild((this.ownerDocument || this).createTextNode(value));
  }
}
Object.assign(FakeNode.prototype, listenable);
const descendants = (root) => { const out = []; const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType !== ELEMENT) continue; out.push(c); walk(c); } }; walk(root); return out; };
class FakeElement extends FakeNode {
  constructor(tag, doc, ns) {
    super(ELEMENT, ns ? tag : tag.toUpperCase(), doc);
    this.localName = tag; this.tagName = this.nodeName; this.namespaceURI = ns || 'http://www.w3.org/1999/xhtml';
    this.style = { setProperty() {}, removeProperty() {} }; this.__attrs = new Map();
  }
  setAttribute(n, v) { this.__attrs.set(n, String(v)); }
  setAttributeNS(_ns, n, v) { this.setAttribute(n, v); }
  getAttribute(n) { return this.__attrs.has(n) ? this.__attrs.get(n) : null; }
  hasAttribute(n) { return this.__attrs.has(n); }
  removeAttribute(n) { this.__attrs.delete(n); }
  removeAttributeNS(_ns, n) { this.removeAttribute(n); }
  get type() { return this.getAttribute('type') ?? (this.localName === 'input' ? 'text' : ''); }
  set type(v) { this.setAttribute('type', v); }
  // select/option support (react-dom's ReactDOMSelect walks node.options)
  get options() { return this.localName === 'select' ? descendants(this).filter((e) => e.localName === 'option') : undefined; }
  get value() {
    if (this.localName === 'option') return this.getAttribute('value') ?? this.textContent;
    if (this.localName === 'select') { const o = this.options.find((x) => x.selected) || this.options[0]; return o ? o.value : ''; }
    return this.__value ?? '';
  }
  set value(v) {
    if (this.localName === 'select') { for (const o of this.options) o.selected = o.value === String(v); return; }
    if (this.localName === 'option') { this.setAttribute('value', v); return; }
    this.__value = v;
  }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
}
class FakeDocument extends FakeNode {
  constructor() { super(DOCUMENT, '#document', null); this.oninput = null; }
  createElement(tag) { return new FakeElement(tag, this); }
  createElementNS(ns, tag) { return new FakeElement(tag, this, ns); }
  createTextNode(text) { const n = new FakeNode(TEXT, '#text', this); n.nodeValue = String(text); return n; }
}
const document = new FakeDocument();
document.documentElement = document.appendChild(document.createElement('html'));
document.body = document.documentElement.appendChild(document.createElement('body'));
document.activeElement = document.body;
const store = new Map();
const window = { document, event: undefined, navigator: { userAgent: 'node' }, location: { href: 'http://localhost/', protocol: 'http:' }, HTMLIFrameElement: class {}, ...listenable };
document.defaultView = window;
globalThis.window = window; globalThis.document = document;
if (!('navigator' in globalThis)) globalThis.navigator = window.navigator;
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const fire = (target, type) => {
  const event = { type, target, bubbles: true, cancelable: true, defaultPrevented: false, isTrusted: true, timeStamp: Date.now(), button: 0,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
  const path = []; for (let n = target; n; n = n.parentNode) path.push(n); path.push(window);
  const run = (node, capture) => { for (const l of [...(node.__listeners || [])]) { if (l.type !== type || l.capture !== capture) continue; event.currentTarget = node; l.fn.call(node, event); } };
  for (let i = path.length - 1; i >= 0 && !event.stopped; i--) run(path[i], true);
  for (let i = 0; i < path.length && !event.stopped; i++) run(path[i], false);
  return event;
};
const click = (el) => { assert.ok(el, 'a control to click'); if (el.hasAttribute('disabled')) return; fire(el, 'click'); };
const toggle = (input) => { input.checked = !input.checked; fire(input, 'click'); };
const choose = (select, value) => { select.value = value; fire(select, 'change'); };

// ---- API stub ----
const C1 = '6a0000000000000000000001';
const C2 = '6a0000000000000000000002';
const posts = [];
const campaignsList = { campaigns: [
  { _id: C1, name: 'Ward 9', state: 'NV', type: 'survey', isActive: true, timeZone: 'America/Los_Angeles', disabledOutcomes: [], enabledOutcomes: [], everEnabledOutcomes: [] },
  { _id: C2, name: 'Lit Ward', state: 'NV', type: 'lit_drop', isActive: true, timeZone: 'America/Chicago', disabledOutcomes: [], enabledOutcomes: [], everEnabledOutcomes: [] },
], optInOutcomesAvailable: [] };
const TYPES = { types: [
  { id: 'canvass-activity', label: 'Canvassing activity', desc: 'Plain.', filters: ['date', 'effort', 'pass', 'canvasser', 'outcome', 'onePerKnock', 'perVoterRows', 'surveyAnswers'] },
  { id: 'doors-by-round', label: 'Doors by round', desc: 'Doors.', filters: ['effort', 'pass', 'roundStatus'] },
] };
let jobs = [];
globalThis.__api = (path, { method = 'GET', body } = {}) => {
  const ok = (x) => Promise.resolve(structuredClone(x));
  if (method === 'POST' && path === '/admin/exports') {
    if (globalThis.__failNextPost) { globalThis.__failNextPost = false; return Promise.reject(new Error('boom: the queue refused')); }
    posts.push(structuredClone(body)); return ok({ job: { _id: 'j' + posts.length } });
  }
  if (path === '/admin/campaigns') return ok(campaignsList);
  if (path === '/admin/exports/types') return ok(TYPES);
  if (path === '/admin/exports/worker-status') return ok({ online: true });
  if (path.startsWith('/admin/exports?')) return ok({ jobs, total: jobs.length });
  if (path === `/admin/campaigns/${C1}/efforts`) return ok({ efforts: [{ _id: 'e1', name: 'North' }] });
  if (path === `/admin/campaigns/${C2}/efforts`) return ok({ efforts: [{ _id: 'e9', name: 'South' }] });
  if (path.startsWith(`/admin/campaigns/${C1}/passes`)) return ok({ passes: [{ _id: 'p2', roundNumber: 2, name: 'Re-knock', effortId: 'e1', status: 'active' }] });
  if (path.startsWith(`/admin/campaigns/${C2}/passes`)) return ok({ passes: [{ _id: 'p9', roundNumber: 1, name: 'Pass 1', effortId: 'e9', status: 'active' }] });
  if (path.startsWith('/admin/reports/canvassers')) return ok(path.includes(C2) ? [{ userId: 'u7', firstName: 'Ana', lastName: 'Ruiz' }] : [{ userId: 'u9', firstName: 'Ben', lastName: 'Walker' }]);
  if (path.includes('/assignments')) return ok({ assignments: [] });
  return Promise.reject(new Error('unmocked ' + method + ' ' + path));
};


const errors = [];
const consoleError = console.error;
console.error = (...a) => errors.push(a.map(String).join(' '));
after(() => { console.error = consoleError; });

const { mount } = await import(pathToFileURL(bundle).href);

const words = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
const screen = () => words(document.body);
const els = () => descendants(document.body);
const buttons = (label) => els().filter((e) => e.localName === 'button' && words(e) === label);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (check, what, ms = 3000) => { const s = Date.now(); for (;;) { if (check()) return; if (Date.now() - s > ms) assert.fail(`timed out waiting for ${what}; screen: ${screen().slice(0, 500)}`); await tick(5); } };
const dialog = () => els().find((e) => e.getAttribute('data-overlay') === '');
const perKnockBox = () => { const d = dialog(); if (!d) return null; const lab = descendants(d).find((e) => e.localName === 'label' && words(e).startsWith('One row per knock')); return lab ? descendants(lab).find((e) => e.localName === 'input') : null; };
const surveyBox = () => { const d = dialog(); const lab = descendants(d).find((e) => e.localName === 'label' && words(e).startsWith('Include survey answers')); return descendants(lab).find((e) => e.localName === 'input'); };
const chipIn = (label) => descendants(dialog()).find((e) => e.localName === 'button' && words(e) === label) || null;
const scopeLine = () => { const p = descendants(dialog()).find((e) => e.localName === 'p' && words(e).startsWith('For:')); return words(p); };
const openDialog = async () => { click(buttons('Queue export')[0]); await waitFor(() => dialog(), 'the dialog'); };
const queueInDialog = async () => { const n = posts.length; click(buttons('Queue export').at(-1)); await waitFor(() => posts.length > n && !dialog(), 'the POST + dialog close'); };
const selectNear = (labelText) => { const lab = els().find((e) => e.localName === 'div' && words(e) === labelText && (e.getAttribute('class') || '').includes('uppercase')); const holder = lab.parentNode; return descendants(holder).find((e) => e.localName === 'select'); };


test('One row per knock: ticked for every export, reaches the POST, never carries a hidden chip or another campaign’s picks', async () => {
  const view = mount(`/campaigns/${C1}/exports`);
  try {
    await waitFor(() => buttons('Queue export').length && screen().includes('Canvassing activity'), 'the page');
    await tick(30);

    // First open: unticked. Ticking hides Restricted and Note added; the POST carries onePerKnock and
    // drops the Restricted chip ticked before the box.
    await openDialog();
    assert.equal(!!perKnockBox().checked, false, 'unticked on first open');
    click(chipIn('Restricted'));
    click(chipIn('Not home'));
    toggle(perKnockBox());
    await tick(5);
    assert.equal(!!perKnockBox().checked, true);
    assert.equal(chipIn('Restricted'), null, 'no Restricted chip while ticked');
    assert.equal(chipIn('Note added'), null, 'no Note added chip while ticked');
    toggle(surveyBox());
    await tick(5);
    assert.match(scopeLine(), /^For: All time · all walk lists · all rounds · all canvassers$/);
    await queueInDialog();
    assert.deepEqual(posts.at(-1), { type: 'canvass-activity', params: { actionTypes: ['not_home'], includeSurveyAnswers: true, onePerKnock: true }, campaignId: C1 });

    // Reopened after a queue: unticked again (D1), Include survey answers remembered, Restricted back.
    await openDialog();
    assert.equal(!!perKnockBox().checked, false, 'cleared for the next export');
    assert.equal(!!surveyBox().checked, true, 'Include survey answers is still remembered');
    assert.ok(chipIn('Restricted'), 'Restricted is offered again');
    click(buttons('Cancel').at(-1));
    await waitFor(() => !dialog(), 'the dialog to close');

    // Ticked then cancelled: unticked on the next open.
    await openDialog();
    toggle(perKnockBox());
    await tick(5);
    click(buttons('Cancel').at(-1));
    await waitFor(() => !dialog(), 'the dialog to close');
    await openDialog();
    assert.equal(!!perKnockBox().checked, false, 'cleared after a cancel');
    click(buttons('Cancel').at(-1));
    await waitFor(() => !dialog(), 'the dialog to close');

    // A failed queue shows its error in the dialog; the next open starts clean (Queue export resets it).
    globalThis.__failNextPost = true;
    await openDialog();
    click(buttons('Queue export').at(-1));
    await waitFor(() => /boom/.test(words(dialog())), 'the error in the dialog');
    click(buttons('Cancel').at(-1));
    await waitFor(() => !dialog(), 'the dialog to close');
    await openDialog();
    assert.doesNotMatch(screen(), /boom/, 'no stale error in the dialog or on the page');
    click(buttons('Cancel').at(-1));
    await waitFor(() => !dialog(), 'the dialog to close');

    // A walk list and round picked on Doors by round carry over to Canvassing activity: the scope line
    // names the round, whose label already carries the walk list (so the walk list isn't said twice).
    click(els().find((e) => e.localName === 'button' && words(e).startsWith('Doors by round')));
    await tick(10);
    choose(selectNear('Walk list'), 'e1');
    await waitFor(() => selectNear('Round').options.some((o) => o.value === 'p2'), 'the walk list\u2019s rounds');
    choose(selectNear('Round'), 'p2');
    await tick(10);
    click(els().find((e) => e.localName === 'button' && words(e).startsWith('Canvassing activity')));
    await tick(10);
    choose(selectNear('Canvasser'), 'u9');
    await tick(10);
    await openDialog();
    assert.match(scopeLine(), /^For: All time · North · Pass 2 · Re-knock · Ben Walker$/);
    click(buttons('Cancel').at(-1));
    await waitFor(() => !dialog(), 'the dialog to close');

    // Switching campaign clears the walk list, round and canvasser: the next export never carries the
    // old campaign's picks, and a lit-drop campaign gets the Lit dropped wording.
    globalThis.__navigate(`/campaigns/${C2}/exports`);
    await tick(50);
    await openDialog();
    assert.match(scopeLine(), /all walk lists · all rounds · all canvassers$/);
    assert.match(screen(), /Lit dropped if anyone dropped literature there/);
    toggle(perKnockBox());
    await tick(5);
    await queueInDialog();
    assert.equal(posts.at(-1).campaignId, C2);
    assert.equal(posts.at(-1).params.passId, undefined, 'no round from the other campaign');
    assert.equal(posts.at(-1).params.effortId, undefined, 'no walk list from the other campaign');
    assert.equal(posts.at(-1).params.userId, undefined, 'no canvasser from the other campaign');
    assert.equal(posts.at(-1).params.onePerKnock, true);

    // The campaign changing UNDER an open dialog (Back / Forward) closes it, so its choices never queue
    // against the other campaign.
    await openDialog();
    toggle(perKnockBox());
    await tick(5);
    globalThis.__navigate(`/campaigns/${C1}/exports`);
    await waitFor(() => !dialog(), 'the dialog to close on the campaign change');

    assert.deepEqual(errors.filter((e) => /Warning|Error/.test(e)), [], 'no React warnings');
  } finally {
    view.unmount();
  }
});
