import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke tests for Add people (docs/PROPOSAL_PEOPLE_PAGES.md §E.6). The By-email steps are a pure
// view of where the add has got to (AddPeopleDialog.jsx byEmailView), so each renders from the
// server's real answers: the lookup, a 429 with its wait, a returning person with their history and
// the crew picked for them, a switched-off account (Switch on only, when they're already here; a lead
// is told to ask), Already here, a new canvasser, typed details for someone who already has an account,
// and Done with what moved. Plus the dialog itself: an org admin gets both ways in, a team lead By email
// only, and From your organization lists who isn't on the campaign, 25 to a page. The sentences are
// lib/addPeople.js (addPeople.test.js).

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-add-people-'));
after(() => rmSync(dir, { recursive: true, force: true }));

writeFileSync(
  join(dir, 'overlayStub.jsx'),
  `const Overlay = ({ className = '', children }) => <div data-testid="panel" className={className}>{children}</div>;
   export default Overlay;`
);

const src = (p) => join(here, '..', p);
const ENTRY = `
  import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { MemoryRouter } from 'react-router-dom';
  import AddPeopleDialog, { byEmailView } from '${src('components/team/AddPeopleDialog.jsx')}';
  globalThis.fetch = () => new Promise(() => {});
  const noop = () => {};
  const qcOf = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const ON = new Proxy({}, { get: () => noop });
  const CHOICES = [{ id: 'd1', name: 'Dana Cruz' }, { id: 'y1', name: 'Yan Ito' }];
  export const step = (v) => {
    const view = byEmailView(
      { baseId: 'add', campaignName: 'Fall Canvass', isOrgAdmin: true, choices: CHOICES, email: 'pat@t.co', cleanEmail: 'pat@t.co', address: 'pat@t.co',
        form: { firstName: '', lastName: '', phone: '', password: '' }, found: null, done: null, pick: '', pickName: null,
        reportsLine: null, typedHandOver: false, resolving: false, resolveError: null, adding: false, addError: null, localError: '', ...v },
      ON
    );
    return { title: view.title, html: renderToString(<QueryClientProvider client={qcOf()}>{view.body}{view.footer}</QueryClientProvider>) };
  };
  export const dialog = ({ isOrgAdmin, startTab = 'email', members = [] }) => {
    const qc = qcOf();
    qc.setQueryData(['admin', 'campaign-crew', 'c1'], { members: [], coordinators: [{ id: 'd1', firstName: 'Dana', lastName: 'Cruz', role: 'lead' }] });
    qc.setQueryData(['memberships'], { members });
    return renderToString(
      <QueryClientProvider client={qc}><MemoryRouter>
        <AddPeopleDialog campaign={{ _id: 'c1', name: 'Fall Canvass' }} isOrgAdmin={isOrgAdmin} rosterIds={new Set(['on1'])} startTab={startTab}
          onOpenPerson={noop} onAdded={noop} onClose={noop} />
      </MemoryRouter></QueryClientProvider>
    );
  };`;

let mod;
const load = async () => {
  if (mod) return mod;
  writeFileSync(join(dir, 'entry.jsx'), ENTRY);
  const out = join(dir, 'bundle.mjs');
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
          b.onResolve({ filter: /(^|\/)Overlay\.jsx$/ }, () => ({ path: join(dir, 'overlayStub.jsx') }));
        },
      },
    ],
  });
  mod = await import(pathToFileURL(out).href);
  return mod;
};

const text = (html) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
const buttons = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => text(m[2]).trim());

const PAT = { userId: 'pat1', firstName: 'Pat', lastName: 'Lee', role: 'canvasser' };
const HISTORY = {
  doors: 120,
  sources: [
    { coordinatorId: 'd1', name: 'Dana Cruz', doors: 100, canLead: true },
    { coordinatorId: null, name: null, doors: 20, canLead: false },
  ],
};

test('step 1, and a 429 that says how long to wait', async () => {
  const { step } = await load();
  const first = step({});
  assert.equal(first.title, 'Add someone to Fall Canvass');
  assert.match(text(first.html), /Start with their email address/);
  assert.deepEqual(buttons(first.html), ['Cancel', 'Continue']);
  const limited = step({ resolveError: Object.assign(new Error('Too many'), { status: 429, data: { code: 'rate-limited', retryAfterSeconds: 1500 } }) });
  assert.match(text(limited.html), /You’ve checked a lot of email addresses in the last hour\. Try again in 25 minutes\./);
});

test('a returning colleague: their doors here and on which teams, their old crew picked, what the pick does', async () => {
  const { step } = await load();
  const s = step({
    found: { outcome: 'in-org', person: PAT, history: HISTORY },
    pick: 'd1',
    pickName: 'Dana Cruz',
    reportsLine: 'This also changes the numbers in the Downtown team client report.',
  });
  assert.equal(s.title, 'Add them to Fall Canvass?');
  const t = text(s.html);
  assert.match(t, /Pat Lee is already in your organization\./);
  assert.match(t, /Pat has 120 doors here from before: 100 on Dana Cruz’s team, 20 on No team\./);
  assert.match(s.html, /<option value="d1" selected="">Dana Cruz<\/option>/, 'their crew before, picked');
  assert.match(t, /All 120 doors will count for Dana Cruz’s team; the ones on No team move there\./);
  assert.match(t, /This also changes the numbers in the Downtown team client report\./);
  assert.deepEqual(buttons(s.html), ['Back', 'Add to campaign']);

  const typed = step({ found: { outcome: 'in-org', person: PAT, history: { doors: 0, sources: [] } }, typedHandOver: true });
  assert.match(text(typed.html), /Pat already has an account, so what you typed wasn’t used\./);
  assert.match(text(typed.html), /Their doors from here on count toward no team\./, 'nothing from before: no history line');
  assert.doesNotMatch(text(typed.html), /from before/);
});

test('switched off: an admin gets Switch on only when they’re already here; a lead is told to ask', async () => {
  const { step } = await load();
  const here = step({ found: { outcome: 'in-org-inactive', person: PAT, history: HISTORY, onCampaign: true } });
  assert.match(text(here.html), /Pat Lee is in your organization and on this campaign, but their account is switched off\./);
  assert.deepEqual(buttons(here.html), ['Back', 'Switch on']);
  assert.doesNotMatch(here.html, /<select/, 'their crew stays as it is: no Crew choice');

  const notHere = step({ found: { outcome: 'in-org-inactive', person: PAT, history: HISTORY, onCampaign: false }, pick: 'd1', pickName: 'Dana Cruz' });
  assert.deepEqual(buttons(notHere.html), ['Back', 'Switch on & add']);
  assert.match(notHere.html, /<select/);

  const lead = step({ isOrgAdmin: false, found: { outcome: 'in-org-inactive', person: PAT, history: HISTORY, onCampaign: false } });
  assert.match(text(lead.html), /so an org admin has to do it/);
  assert.deepEqual(buttons(lead.html), ['Back', 'Close']);
});

test('already here offers Open them; someone new gets the form with a Crew choice', async () => {
  const { step } = await load();
  const here = step({ found: { outcome: 'on-campaign', person: PAT, history: HISTORY } });
  assert.equal(here.title, 'Already here');
  assert.deepEqual(buttons(here.html), ['Back', 'Open Pat']);

  const fresh = step({ found: { outcome: 'outside', person: null } });
  assert.equal(fresh.title, 'New canvasser');
  assert.match(text(fresh.html), /No one in your organization uses pat@t\.co \./);
  assert.match(fresh.html, /<option value="" selected="">No crew<\/option>/);
  assert.ok(buttons(fresh.html).includes('Create & add'));
  // The step names the address that was looked up, not what the box was changed to while it was out.
  const edited = step({ found: { outcome: 'outside', person: null }, email: 'pam@t.co', cleanEmail: 'pam@t.co', address: 'pat@t.co' });
  assert.match(text(edited.html), /No one in your organization uses pat@t\.co \./);
  assert.doesNotMatch(text(edited.html), /pam@t\.co/);
});

test('Done says who landed, what of theirs moved and from which teams, with Open them and Add another', async () => {
  const { step } = await load();
  const moved = step({
    found: { outcome: 'outside', person: null },
    done: {
      user: { id: 'pat1', firstName: 'Pat', lastName: 'Lee' },
      outcome: 'attached',
      attached: true,
      restamp: { changed: true, doors: 120, activities: 130, surveys: 2, error: null, sources: [{ coordinatorId: 'd1', name: 'Dana Cruz', doors: 120 }] },
    },
  });
  assert.equal(moved.title, 'Added');
  const t = text(moved.html);
  assert.match(t, /Pat Lee is on Fall Canvass\./);
  assert.match(t, /Pat already has an account, so what you typed wasn’t used\./, 'an account at another customer, attached');
  assert.match(t, /Pat’s 120 earlier doors moved from Dana Cruz’s team to No team\. Open Pat to change their crew/);
  assert.deepEqual(buttons(moved.html), ['Open Pat', 'Add another', 'Done']);

  const created = step({ found: { outcome: 'outside', person: null }, done: { user: { id: 'n1', firstName: 'Nia', lastName: 'Ng' }, outcome: 'created', attached: false, restamp: { changed: true, doors: 0, activities: 0, surveys: 0, sources: [] } } });
  assert.match(text(created.html), /They’ve been emailed a link to set their own password\./);
  assert.doesNotMatch(text(created.html), /earlier doors/);
  assert.doesNotMatch(text(created.html), /what you typed wasn’t used/);

  // Nobody had the address at the lookup, but someone in the organization had it by the add: they
  // joined as themselves, and what was typed for a new account wasn't used.
  const claimed = step({ found: { outcome: 'outside', person: null }, done: { user: { id: 'pat1', firstName: 'Pat', lastName: 'Lee' }, outcome: 'in-org', attached: false, restamp: { changed: true, doors: 0, activities: 0, surveys: 0, sources: [] } } });
  assert.match(text(claimed.html), /Pat already has an account, so what you typed wasn’t used\./);
});

test('the dialog: both ways in for an org admin, By email only for a lead; From your organization, 25 to a page', async () => {
  const { dialog } = await load();
  const admin = text(dialog({ isOrgAdmin: true }));
  assert.match(admin, /By email From your organization/);
  assert.doesNotMatch(text(dialog({ isOrgAdmin: false })), /From your organization/);

  const member = (i, over = {}) => ({
    membershipId: `m${i}`,
    role: 'canvasser',
    isActive: true,
    user: { id: `u${String(i).padStart(2, '0')}`, firstName: `P${String(i).padStart(2, '0')}`, lastName: 'Lee', email: `p${i}@t.co`, isActive: true, isDeleted: false },
    ...over,
  });
  const members = [
    ...Array.from({ length: 30 }, (_, i) => member(i)),
    { ...member(90), user: { ...member(90).user, id: 'on1' } }, // already on the campaign
    { ...member(91), isActive: false }, // switched off
  ];
  const org = dialog({ isOrgAdmin: true, startTab: 'org', members });
  const t = text(org);
  assert.match(t, /0 ticked · 30 not on this campaign/, 'only active members not on the roster');
  assert.match(t, /Select all 30 that match/);
  assert.match(t, /1–25 of 30/);
  assert.equal((org.match(/type="checkbox"/g) || []).length, 26, '25 rows and the page’s own box');
});
