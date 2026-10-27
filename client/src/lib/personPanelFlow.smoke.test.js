import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// FLOW tests for the person panel's container (docs/PROPOSAL_PEOPLE_PAGES.md §D.2, §D.3): the REAL
// panel, a real QueryClient, real effects, with the API answering when a test says. What a render
// can't show:
//   - ‹ › step through the list as it was, "2 of 3", and the page is told (onStep);
//   - typed edits ask before stepping or closing, once, and a No keeps you where you are;
//   - while a write for this person is out, the arrows and × wait and the scrim does nothing;
//   - the result line names the person and stays on screen as you step on.
//
// The same minimal DOM as memberDeletionFlow.smoke.test.js (the repo has no jsdom). Overlay is stubbed
// with a scrim button that calls its onClose, standing in for Escape and a scrim click; auth and the API
// client are stubbed. The panel is opened as the Users page opens it (its sections have no <select>,
// which this DOM doesn't model).

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-person-panel-flow-'));
after(() => rmSync(dir, { recursive: true, force: true }));

writeFileSync(
  join(dir, 'overlayStub.jsx'),
  `const Overlay = ({ onClose, children }) => (
     <div data-overlay="">
       <button type="button" data-scrim="" onClick={() => onClose?.()}>scrim</button>
       {children}
     </div>
   );
   export default Overlay;`
);
writeFileSync(
  join(dir, 'authStub.jsx'),
  `export const useAuth = () => ({ user: { id: 'viewer' }, isSuperAdmin: false, isOrgAdmin: true, activeMembership: { role: 'admin', billingAccess: true } });
   export const useOrgTimeZone = () => 'America/Chicago';`
);
writeFileSync(join(dir, 'apiStub.js'), 'export const api = (path, options) => globalThis.__api(path, options || {});');
writeFileSync(
  join(dir, 'entry.jsx'),
  `import React, { useState } from 'react';
   import { createRoot } from 'react-dom/client';
   import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
   import { MemoryRouter } from 'react-router-dom';
   import PersonPanel from '${join(here, '../components/people/PersonPanel.jsx')}';
   import { personFromMember } from '${join(here, './personAccess.js')}';
   // The Users page's part: it holds ?person= (here, state), steps and closes as the panel asks. The
   // member list is state too, so a test can land a fresher list under an open panel.
   const hostApi = {};
   const Host = ({ members: initial, startId, log }) => {
     const [personId, setPersonId] = useState(startId);
     const [members, setMembers] = useState(initial);
     hostApi.setMembers = setMembers;
     const people = new Map(members.map((m) => [String(m.user.id), personFromMember(m)]));
     return personId ? (
       <PersonPanel
         personId={personId}
         ids={members.map((m) => String(m.user.id))}
         place={() => null}
         lookup={(id) => people.get(String(id)) || null}
         loaded
         scope={{ kind: 'org', pausedIds: new Set(), rosterLines: [] }}
         onStep={(id) => { log.push('step ' + id); setPersonId(id); }}
         onClose={() => { log.push('close'); setPersonId(null); }}
       />
     ) : <p>panel closed</p>;
   };
   export const mount = (members, startId) => {
     const log = [];
     const qc = new QueryClient({
       defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: Infinity }, mutations: { gcTime: Infinity } },
     });
     qc.setQueryData(['memberships'], { members });
     const container = document.createElement('div');
     document.body.appendChild(container);
     const root = createRoot(container);
     root.render(<QueryClientProvider client={qc}><MemoryRouter><Host members={members} startId={startId} log={log} /></MemoryRouter></QueryClientProvider>);
     return { log, qc, setMembers: (next) => hostApi.setMembers(next), unmount: () => { root.unmount(); container.parentNode?.removeChild(container); qc.clear(); } };
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
        b.onResolve({ filter: /(^|\/)Overlay\.jsx$/ }, () => ({ path: join(dir, 'overlayStub.jsx') }));
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
  get textContent() {
    return this.nodeType === TEXT ? this.nodeValue : this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(value) {
    while (this.childNodes.length) this.removeChild(this.childNodes[0]);
    if (value !== '' && value != null) this.appendChild((this.ownerDocument || this).createTextNode(value));
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
  // react-dom reads `type` to tell a text box (and its change events) from a checkbox.
  get type() {
    return this.getAttribute('type') ?? (this.localName === 'input' ? 'text' : '');
  }
  set type(value) {
    this.setAttribute('type', value);
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  blur() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }
}
class FakeDocument extends FakeNode {
  constructor() {
    super(DOCUMENT, '#document', null);
    this.oninput = null; // react-dom feature-detects the input event this way
  }
  createElement(tag) {
    return new FakeElement(tag, this);
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
const window = {
  document,
  event: undefined,
  navigator: { userAgent: 'node' },
  location: { href: 'http://localhost/', protocol: 'http:' },
  HTMLIFrameElement: class {},
  ...listenable,
};
document.defaultView = window;
globalThis.window = window;
globalThis.document = document;
if (!('navigator' in globalThis)) globalThis.navigator = window.navigator;

// A native event, dispatched with capture and bubble phases through the node's ancestors.
const fire = (target, type) => {
  const event = {
    type,
    target,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    isTrusted: true,
    timeStamp: Date.now(),
    button: 0,
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
// A click the way a browser delivers it: nothing on a disabled button, and a submit button that
// isn't stopped submits its form.
const click = (el) => {
  if (el.hasAttribute('disabled')) return;
  const event = fire(el, 'click');
  if (!event.defaultPrevented && el.localName === 'button' && el.getAttribute('type') === 'submit') {
    const form = closestForm(el);
    if (form) fire(form, 'submit');
  }
};
const typeInto = (input, value) => {
  input.value = value;
  fire(input, 'input');
};

// window.confirm, answered as each test says, and counted.
let confirms;
let confirmAnswer;
window.confirm = (message) => {
  confirms.push(message);
  return confirmAnswer;
};

const { mount } = await import(pathToFileURL(bundle).href);

// ---- Reading the screen ---------------------------------------------------------------------------
const elements = (root = document.body) => {
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
const words = (n) => n.textContent.replace(/\s+/g, ' ').trim();
const screen = () => words(document.body);
const button = (label) => elements().find((e) => e.localName === 'button' && words(e) === label) || null;
const enabled = (label) => !!button(label) && !button(label).hasAttribute('disabled');
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (check, what, ms = 2000) => {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > ms) assert.fail(`timed out waiting for ${what}; the screen reads: ${screen().slice(0, 600)}`);
    await tick(5);
  }
};

const byLabel = (label) => elements().find((e) => e.localName === 'button' && e.getAttribute('aria-label') === label) || null;
const inputById = (id) => elements().find((e) => e.localName === 'input' && e.getAttribute('id') === id) || null;

// ---- The API --------------------------------------------------------------------------------------
const member = (id, first) => ({
  membershipId: `m-${id}`,
  role: 'canvasser',
  isActive: true,
  billingAccess: false,
  managedCampaignIds: [],
  campaignIds: [],
  addedAt: '2026-06-01T00:00:00Z',
  user: { id, firstName: first, lastName: 'Lee', email: `${id}@t.co`, isActive: true, isDeleted: false, isSuperAdmin: false, lastLoginAt: '2026-10-20T12:00:00Z', createdAt: '2026-06-01T00:00:00Z' },
});
const MEMBERS = [member('ann', 'Ann'), member('sam', 'Sam'), member('bo', 'Bo')];
const HOLD = Symbol('hold');
let calls;
let held;
let answer;
const route = (method, path) => {
  if (path.includes('/stats')) return { doorsKnocked: 3, surveysSubmitted: 0, litDropped: 0, distanceMeters: 0, campaignsWorked: 1, lastActivityAt: null, fbtime: null };
  if (path.includes('/recent-activity')) return { activities: [] };
  if (path.includes('/crews')) return { crews: [] };
  if (path === '/admin/campaigns') return { campaigns: [] };
  if (path.startsWith('/admin/pace-pauses')) return { pauses: [] };
  if (method === 'PATCH' && path.endsWith('/password')) return { user: {} };
  throw new Error(`unmocked ${method} ${path}`);
};
globalThis.__api = (path, { method = 'GET', body } = {}) => {
  calls.push(`${method} ${path}`);
  const a = answer(method, path, body);
  if (a === HOLD) return new Promise((resolve, reject) => held.push({ method, path, resolve, reject }));
  return a instanceof Error ? Promise.reject(a) : Promise.resolve(structuredClone(a));
};

let errors;
const consoleError = console.error;
console.error = (...args) => errors.push(args.map(String).join(' '));
after(() => {
  console.error = consoleError;
});

let screenUnmount = null;
beforeEach(() => {
  screenUnmount?.();
  screenUnmount = null;
  calls = [];
  held = [];
  errors = [];
  confirms = [];
  confirmAnswer = true;
  answer = route;
});
after(() => screenUnmount?.());

const open = async (startId = 'sam') => {
  const view = mount(MEMBERS, startId);
  screenUnmount = view.unmount;
  await waitFor(() => button('Set temporary password'), 'the panel to load');
  return view;
};

test('‹ › step through the list as it was, and say where you are', async () => {
  const view = await open('sam');
  assert.match(screen(), /2 of 3/);
  click(byLabel('Next person'));
  await waitFor(() => /Bo Lee/.test(screen()), 'Bo');
  assert.match(screen(), /3 of 3/);
  assert.equal(byLabel('Next person').hasAttribute('disabled'), true, 'nobody after the last');
  click(byLabel('Previous person'));
  await waitFor(() => /2 of 3/.test(screen()), 'Sam');
  click(byLabel('Previous person'));
  await waitFor(() => /1 of 3/.test(screen()), 'Ann');
  assert.equal(byLabel('Previous person').hasAttribute('disabled'), true, 'nobody before the first');
  assert.deepEqual(view.log, ['step bo', 'step sam', 'step ann']);
  assert.deepEqual(errors, []);
});

test('typed edits ask once before stepping or closing; No keeps you where you are', async () => {
  const view = await open('sam');
  typeInto(inputById('person-sam-first'), 'Samuel');
  confirmAnswer = false;
  click(byLabel('Next person'));
  await tick(10);
  assert.equal(confirms.length, 1, 'asked once');
  assert.deepEqual(view.log, [], 'stayed on Sam');
  click(elements().find((e) => e.hasAttribute('data-scrim')));
  await tick(10);
  assert.equal(confirms.length, 2, 'the scrim (Escape’s stand-in) asks too');
  assert.deepEqual(view.log, []);
  confirmAnswer = true;
  click(byLabel('Close'));
  await waitFor(() => view.log.includes('close'), 'the panel to close');
  assert.equal(confirms.length, 3);
  assert.deepEqual(errors, []);
});

test('while a write is out the arrows and × wait and the scrim does nothing; the result line stays as you step', async () => {
  const view = await open('bo');
  answer = (method, path) => (method === 'PATCH' && path.endsWith('/password') ? HOLD : route(method, path));
  click(button('Set temporary password'));
  await waitFor(() => elements().some((e) => e.localName === 'input' && e.getAttribute('type') === 'password'), 'the password box');
  typeInto(elements().find((e) => e.localName === 'input' && e.getAttribute('type') === 'password'), 'Temp-pass-77');
  await waitFor(() => enabled('Set password'), 'Set password');
  click(button('Set password'));
  await waitFor(() => held.some((h) => h.path.endsWith('/password')), 'the password write');
  await waitFor(() => byLabel('Close').hasAttribute('disabled'), '× to wait');
  assert.equal(byLabel('Previous person').hasAttribute('disabled'), true, 'the arrows wait');
  click(elements().find((e) => e.hasAttribute('data-scrim')));
  click(byLabel('Previous person'));
  await tick(10);
  assert.deepEqual(view.log, [], 'nothing moved or closed');
  assert.equal(confirms.length, 0, 'not asked about a password already sent');

  held.find((h) => h.path.endsWith('/password')).resolve({ user: {} });
  await waitFor(() => /Password set for Bo\./.test(screen()), 'the result line');
  assert.equal(byLabel('Close').hasAttribute('disabled'), false);
  click(byLabel('Previous person'));
  await waitFor(() => /Sam Lee/.test(screen()), 'Sam');
  assert.match(screen(), /Password set for Bo\./, 'still on screen, with Bo’s name, after stepping on');
  assert.deepEqual(view.log, ['step sam']);
  assert.deepEqual(errors, []);
});

test('opened on someone a cached list doesn’t hold yet: once the fresher list lands, they get their place', async () => {
  const view = mount(MEMBERS, 'zed');
  screenUnmount = view.unmount;
  await waitFor(() => /Not in your organization/.test(screen()), 'the note');
  assert.ok(!/of 3/.test(screen()), 'no place in the list');
  view.setMembers([...MEMBERS, member('zed', 'Zed')]);
  await waitFor(() => button('Set temporary password') && /Zed Lee/.test(screen()), 'Zed');
  assert.match(screen(), /4 of 4/, 'the list taken again, with them in it');
  assert.doesNotMatch(screen(), /Not in your organization/);
  click(byLabel('Previous person'));
  await waitFor(() => /Bo Lee/.test(screen()), 'Bo');
  assert.deepEqual(view.log, ['step bo']);
  assert.deepEqual(errors, []);
});
