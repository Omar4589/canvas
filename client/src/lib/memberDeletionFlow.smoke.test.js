import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// FLOW tests for deleting a member's account: the REAL profile and dialog, a real QueryClient, real
// effects and subscriptions, with the API answering in whatever order a test chooses. The render
// smoke tests (renderToString) can't see any of this: they never mount, so they missed a review that
// hung on "Checking…" for good when the stats refetch landed, unchanged, before the check did. Each
// test below is a bug a review found (docs/PROPOSAL_ADMIN_ACCOUNT_DELETION.md, §D):
//   - the stats refetch lands first with identical numbers, the check after: Continue must enable;
//   - two submits in one burst, and a close right behind them: one DELETE, nothing closes;
//   - an answer that never came, ALREADY_DELETED, NOT_A_MEMBER: no ghost of a deleted person;
//   - a BLOCKED whose cause has cleared by the reload: the reasons show on top, in a live region.
//
// The repo has no jsdom, so this file carries a minimal DOM: just what react-dom's client renderer
// touches, plus event bubbling and the browser's "focus falls to body when its element goes" rule.
// node --test runs each file in its own process, so these globals never meet another test. Overlay
// is stubbed (its portal and focus trap aren't under test) with a scrim button that calls its onClose,
// standing in for Escape and a scrim click; auth and the API client are stubbed too.

const here = fileURLToPath(new URL('.', import.meta.url));
// Inside the client tree on purpose: dependencies stay external to the bundle, so node resolves
// react/react-dom from the bundle's own location (the doorOutcomesRender smoke test's rule).
const dir = mkdtempSync(join(here, '../../.smoke-member-deletion-flow-'));
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
   import UserProfileModal from '${join(here, '../components/UserProfileModal.jsx')}';
   // The Users page's part: it unmounts the profile on onClose and shows the notice it is handed.
   const Host = ({ membership, log }) => {
     const [open, setOpen] = useState(true);
     return open ? (
       <UserProfileModal
         membership={membership}
         onClose={() => { log.push('close'); setOpen(false); }}
         onDeleted={(notice) => log.push('notice: ' + notice)}
       />
     ) : <p>profile closed</p>;
   };
   export const mount = (membership) => {
     const log = [];
     // gcTime Infinity: no five-minute garbage-collection timers holding the test process open.
     const qc = new QueryClient({
       defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: Infinity }, mutations: { gcTime: Infinity } },
     });
     qc.setQueryData(['memberships'], { members: [membership] });
     const container = document.createElement('div');
     document.body.appendChild(container);
     const root = createRoot(container);
     root.render(<QueryClientProvider client={qc}><MemoryRouter><Host membership={membership} log={log} /></MemoryRouter></QueryClientProvider>);
     return { log, qc, unmount: () => { root.unmount(); container.parentNode?.removeChild(container); qc.clear(); } };
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
        // esbuild matches the import specifier as WRITTEN — Modal imports './Overlay.jsx'.
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

// ---- The API, answering as each test says --------------------------------------------------------
const STATS = { doorsKnocked: 1200, restricted: 84, surveysSubmitted: 312, litDropped: 0, distanceMeters: 0, campaignsWorked: 2, lastActivityAt: '2026-10-01T15:00:00Z', fbtime: null };
const CHECK = {
  canDelete: true,
  blockers: [],
  confirmEmail: 'sam@example.com',
  kind: 'used',
  usage: { signedIn: true, fieldRecordsHere: true, fbtimeHours: false, crew: { people: 0, campaigns: 0 }, wasCoordinator: false },
  holding: { campaigns: 2, books: { soleHolder: 2, shared: 1 }, effortCrews: 0, leadGrants: 0, membershipActive: true, retained: { days: 180 } },
};
const SAM = {
  membershipId: 'm7',
  role: 'canvasser',
  isActive: true,
  billingAccess: false,
  managedCampaignIds: [],
  user: { id: 'u7', firstName: 'Sam', lastName: 'Rivera', email: 'sam@example.com', isActive: true, isDeleted: false, isSuperAdmin: false, lastLoginAt: '2026-10-20T12:00:00Z' },
};
// The api client's errors: the server's words, its status and code, and the body.
const refusal = (status, body) => Object.assign(new Error(body.error), { status, code: body.code || null, data: body });
const HOLD = Symbol('hold');
let calls;
let held;
let answer;
const route = (method, path) => {
  if (path.includes('/stats')) return STATS;
  if (path.includes('/recent-activity')) return { activities: [] };
  if (path.includes('/crews')) return { crews: [] };
  if (path === '/admin/campaigns') return { campaigns: [] };
  if (path.endsWith('/deletion-check')) return CHECK;
  if (method === 'DELETE' && path.endsWith('/account')) return { ok: true, deletedAt: '2026-10-24T18:00:00Z', kind: 'used', released: {} };
  throw new Error(`unmocked ${method} ${path}`);
};
globalThis.__api = (path, { method = 'GET', body } = {}) => {
  calls.push(`${method} ${path}`);
  const a = answer(method, path, body);
  if (a === HOLD) return new Promise((resolve, reject) => held.push({ method, path, resolve, reject }));
  // A fresh copy every time, as from the network: identical JSON, never the same object.
  return a instanceof Error ? Promise.reject(a) : Promise.resolve(structuredClone(a));
};
const heldCall = (pred) => held.find((h) => !h.done && pred(h));
const settle = (pred, how) => {
  const h = heldCall(pred);
  assert.ok(h, 'a held call to answer');
  h.done = true;
  if (how instanceof Error) h.reject(how);
  else h.resolve(structuredClone(how));
};
const deletes = () => calls.filter((c) => c.startsWith('DELETE')).length;

// React warnings fail the test that caused them.
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
  answer = route;
});
after(() => screenUnmount?.());

// Profile open → More options → Delete account… → the review, settled.
const openReview = async (membership = SAM) => {
  const view = mount(membership);
  screenUnmount = view.unmount;
  await waitFor(() => button('More options ▸'), 'the profile to load');
  click(button('More options ▸'));
  await waitFor(() => button('Delete account…'), 'the Delete account card');
  click(button('Delete account…'));
  return view;
};
const toStepTwo = async () => {
  await waitFor(() => enabled('Continue'), 'Continue to enable');
  click(button('Continue'));
  await waitFor(() => button('Delete permanently'), 'step 2');
  typeInto(document.activeElement, 'sam@example.com');
  await waitFor(() => enabled('Delete permanently'), 'the typed email to match');
};

test('the review settles when the stats refetch lands first with the same numbers, the check after', async () => {
  const view = mount(SAM);
  screenUnmount = view.unmount;
  // The profile's own stats first: the bug is in the REFETCH the review triggers, so the first load
  // must be in and on screen before anything is held.
  await waitFor(() => button('More options ▸') && /Miles walked/.test(screen()), 'the profile and its stats');
  // From here the stats refetch and the check wait until the test answers them.
  answer = (method, path) => (path.includes('/stats') || path.endsWith('/deletion-check') ? HOLD : route(method, path));
  click(button('More options ▸'));
  await waitFor(() => button('Delete account…'), 'the Delete account card');
  click(button('Delete account…'));
  await waitFor(() => heldCall((h) => h.path.includes('/stats')) && heldCall((h) => h.path.endsWith('/deletion-check')), 'both calls');
  assert.match(screen(), /Checking what deleting would change…/);
  assert.equal(enabled('Continue'), false);

  settle((h) => h.path.includes('/stats'), STATS); // identical JSON: the cached data object is kept
  await tick(30);
  settle((h) => h.path.endsWith('/deletion-check'), CHECK);
  await waitFor(() => enabled('Continue'), 'Continue to enable once both have landed', 1500);
  assert.match(screen(), /Their 1,284 door results and 312 surveys stay\./);
  assert.deepEqual(errors, []);
});

test('two submits in one burst send one DELETE, and a close right behind them is ignored', async () => {
  const view = await openReview();
  await toStepTwo();
  answer = (method, path) => (method === 'DELETE' ? HOLD : route(method, path));
  const submit = button('Delete permanently');
  // One task, no render in between: the second click, the scrim (Escape's stand-in) and a third click
  // all land before react-query has reported anything pending.
  click(submit);
  click(submit);
  click(elements().find((e) => e.hasAttribute('data-scrim')));
  click(submit);
  await tick(30);
  assert.equal(deletes(), 1, 'one DELETE');
  assert.match(screen(), /Deleting…/, 'still open, still deleting');
  assert.equal(button('Back').hasAttribute('disabled'), true);
  const dialog = elements().find((e) => e.hasAttribute('data-overlay'));
  assert.ok(!elements(dialog).some((e) => e.getAttribute('aria-label') === 'Close'), 'no close button while it is out');

  settle((h) => h.method === 'DELETE', { ok: true, kind: 'used' });
  await waitFor(() => view.log.includes('close'), 'everything to close');
  assert.deepEqual(view.log, ["notice: Sam Rivera's account was deleted.", 'close']);
  assert.equal(view.qc.getQueryState(['memberships']).isInvalidated, true, 'the Users list refreshes');
  assert.deepEqual(errors, []);
});

test('a DELETE answered ALREADY_DELETED (an earlier answer lost) closes as a success', async () => {
  answer = (method, path) =>
    method === 'DELETE' ? refusal(409, { error: 'This account was deleted.', code: 'ALREADY_DELETED' }) : route(method, path);
  const view = await openReview();
  await toStepTwo();
  click(button('Delete permanently'));
  await waitFor(() => view.log.includes('close'), 'everything to close');
  assert.deepEqual(view.log, ["notice: Sam Rivera's account was deleted.", 'close']);
  assert.equal(view.qc.getQueryState(['memberships']).isInvalidated, true);
});

test('a DELETE answered NOT_A_MEMBER (an unused account’s row, gone) closes with the neutral notice', async () => {
  answer = (method, path) =>
    method === 'DELETE' ? refusal(404, { error: 'Member not in this org', code: 'NOT_A_MEMBER' }) : route(method, path);
  const view = await openReview();
  await toStepTwo();
  click(button('Delete permanently'));
  await waitFor(() => view.log.includes('close'), 'everything to close');
  assert.deepEqual(view.log, ['notice: Sam Rivera is no longer in your organization.', 'close']);
  assert.equal(view.qc.getQueryState(['memberships']).isInvalidated, true);
});

test('no answer at all: back to a reloaded review that says so, and it closes if the account is gone', async () => {
  answer = (method, path) => (method === 'DELETE' ? new TypeError('Failed to fetch') : route(method, path));
  const view = await openReview();
  await toStepTwo();
  // The reload will find the account deleted: the lost answer had landed.
  const before = calls.length;
  answer = (method, path) =>
    path.endsWith('/deletion-check') ? HOLD : method === 'DELETE' ? new TypeError('Failed to fetch') : route(method, path);
  click(button('Delete permanently'));
  await waitFor(() => heldCall((h) => h.path.endsWith('/deletion-check')), 'the review to reload');
  assert.ok(calls.slice(before).some((c) => c.includes('/stats')), 'the stats reload too');
  const note = elements().find((e) => e.getAttribute('role') === 'alert');
  assert.ok(note, 'the note is a live region');
  assert.equal(
    words(note),
    "Doorline couldn't confirm the delete (Failed to fetch), so the review was loaded again. If the account is already gone, this closes on its own."
  );
  assert.equal(enabled('Continue'), false, 'nothing to continue from until the review is back');
  assert.notEqual(document.activeElement, document.body, 'focus stays in the dialog');
  assert.ok(document.activeElement.contains(note), 'on the review, note first');

  settle((h) => h.path.endsWith('/deletion-check'), refusal(409, { error: 'This account was deleted.', code: 'ALREADY_DELETED' }));
  await waitFor(() => view.log.includes('close'), 'everything to close');
  assert.deepEqual(view.log, ["notice: Sam Rivera's account was deleted.", 'close']);
});

test('a review that opens on an account no longer here closes with the neutral notice', async () => {
  answer = (method, path) =>
    path.endsWith('/deletion-check') ? refusal(404, { error: 'Member not in this org', code: 'NOT_A_MEMBER' }) : route(method, path);
  const view = await openReview();
  await waitFor(() => view.log.includes('close'), 'everything to close');
  assert.deepEqual(view.log, ['notice: Sam Rivera is no longer in your organization.', 'close']);
});

test('a BLOCKED whose cause cleared by the reload shows its reasons on top of the fresh review', async () => {
  const blocked = refusal(409, {
    error: 'This account can’t be deleted.',
    code: 'BLOCKED',
    blockers: [{ code: 'LAST_ADMIN', message: 'This person is the only admin. Make someone else an admin first.' }],
  });
  answer = (method, path) => (method === 'DELETE' ? blocked : route(method, path));
  await openReview();
  await toStepTwo();
  click(button('Delete permanently'));
  await waitFor(() => enabled('Continue'), 'the reloaded review');
  const note = elements().find((e) => e.getAttribute('role') === 'alert');
  assert.equal(words(note), 'This person is the only admin. Make someone else an admin first.');
  assert.match(screen(), /Their 1,284 door results and 312 surveys stay\./, 'the review, read again');
  assert.ok(document.activeElement.contains(note), 'focus on the review, inside the dialog');

  // Continue starts clean: no note, an empty box.
  click(button('Continue'));
  await waitFor(() => button('Delete permanently'), 'step 2');
  assert.equal(document.activeElement.value, '');
  assert.ok(!elements().some((e) => e.getAttribute('role') === 'alert'));
  assert.deepEqual(errors, []);
});

test('Back keeps focus inside the dialog', async () => {
  await openReview();
  await toStepTwo();
  click(button('Back'));
  await waitFor(() => button('Continue'), 'step 1');
  assert.notEqual(document.activeElement, document.body);
  assert.ok(document.activeElement.contains(button('Continue')), 'on the review');
});
