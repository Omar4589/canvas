import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke tests for a campaign's Team page (docs/PROPOSAL_PEOPLE_PAGES.md §E): the quick filters
// with counts, the columns, the crew headings, 25 to a page, the list's state read from the address
// (filters, sort, page and the open person), what a team lead and an archived campaign get, and the bulk
// bar with its three dialogs. renderToString executes every component body; the list logic is
// lib/rosterView.js and the run rules lib/runInChunks.js, each tested directly. Overlay and auth are
// stubbed.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-team-page-'));
after(() => rmSync(dir, { recursive: true, force: true }));

writeFileSync(
  join(dir, 'overlayStub.jsx'),
  `const Overlay = ({ className = '', children }) => <div data-testid="panel" className={className}>{children}</div>;
   export default Overlay;`
);
writeFileSync(
  join(dir, 'authStub.jsx'),
  `export const useAuth = () => globalThis.__auth;
   export const useOrgTimeZone = () => 'America/Chicago';`
);

const src = (p) => join(here, '..', p);
const ENTRY = `
  import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { MemoryRouter, Routes, Route } from 'react-router-dom';
  import CampaignTeamPage from '${src('pages/CampaignTeamPage.jsx')}';
  import TeamBulkBar from '${src('components/team/TeamBulkBar.jsx')}';
  import BulkCrewDialog from '${src('components/team/BulkCrewDialog.jsx')}';
  import BulkConfirmDialog from '${src('components/team/BulkConfirmDialog.jsx')}';
  globalThis.fetch = () => new Promise(() => {});
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const noop = () => {};
  const qcOf = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  export const page = (auth, { rows, url = '/campaigns/c1/team', archived = false, paused = [], activity = [] }) => {
    globalThis.__auth = auth;
    const qc = qcOf();
    qc.setQueryData(['admin', 'campaigns'], { campaigns: [{ _id: 'c1', name: 'Fall Canvass', type: 'survey', isActive: !archived }] });
    qc.setQueryData(['admin', 'campaign-crew', 'c1'], {
      members: [],
      coordinators: [{ id: 'd1', firstName: 'Dana', lastName: 'Cruz', role: 'lead' }, { id: 'r1', firstName: 'Riley', lastName: 'Shaw', role: 'admin' }],
    });
    qc.setQueryData(['admin', 'campaign-assignments', 'c1'], { assignments: rows });
    qc.setQueryData(['admin', 'report-canvassers', 'c1'], activity);
    qc.setQueryData(['admin', 'pace-pauses', 'list', 'org-paused'], { pauses: paused.map((userId) => ({ userId, status: 'paused', blocking: true })), rosterLines: [] });
    qc.setQueryData(['memberships'], { members: [] });
    return renderToString(
      <QueryClientProvider client={qc}><MemoryRouter initialEntries={[url]}>
        <Routes><Route path="/campaigns/:campaignId/team" element={<CampaignTeamPage />} /></Routes>
      </MemoryRouter></QueryClientProvider>
    );
  };
  const wrap = (node) => renderToString(<QueryClientProvider client={qcOf()}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>);
  export const bar = (props) => wrap(<TeamBulkBar onSelectAll={noop} onClear={noop} onMove={noop} onResend={noop} onRemove={noop} {...props} />);
  export const move = () => wrap(<BulkCrewDialog campaignId="c1" ids={['a', 'b']} nameOf={() => 'Someone'} coordinators={[{ id: 'd1', name: 'Dana Cruz' }]} onClose={noop} />);
  export const confirm = (kind, people, roster) => wrap(<BulkConfirmDialog kind={kind} campaignId="c1" campaignName="Fall Canvass" people={people} roster={roster} onClose={noop} />);`;

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
          b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
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
const buttons = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], label: text(m[2]).trim() }));
const rowNames = (html) => [...html.matchAll(/data-person-row="([^"]+)"/g)].map((m) => m[1]);

const ADMIN = { user: { id: 'me' }, isSuperAdmin: false, isOrgAdmin: true, activeMembership: { role: 'admin', billingAccess: false } };
const LEAD = { user: { id: 'lee' }, isSuperAdmin: false, isOrgAdmin: false, activeMembership: { role: 'lead' } };

const row = (userId, over = {}) => ({
  userId,
  firstName: userId,
  lastName: 'Lee',
  email: `${userId}@t.co`,
  phone: null,
  status: 'active',
  isActive: true,
  isSuperAdmin: false,
  lastLoginAt: '2026-10-20T00:00:00Z',
  createdAt: '2026-06-01T00:00:00Z',
  role: 'canvasser',
  coordinatorId: null,
  coordinatorName: null,
  assignedAt: '2026-10-01T00:00:00Z',
  ...over,
});
const DANA = { coordinatorId: 'd1', coordinatorName: 'Dana Cruz' };
const ROWS = [
  row('ann', DANA),
  row('bo', { ...DANA, lastLoginAt: null }),
  row('cy', { status: 'deactivated', isActive: false }),
  row('di', { lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' }),
  row('ed'),
  row('flo', { status: 'removed' }),
];

test('the quick filters count what they show; the columns, the crew headings and the state badges', async () => {
  const { page } = await load();
  const html = page(ADMIN, { rows: ROWS, paused: ['ed'], activity: [{ userId: 'ann', knocks: 412, lastActivityAt: '2026-10-26T00:00:00Z' }] });
  const t = text(html);
  assert.match(t, /Current team 6/);
  assert.match(t, /Never signed in 1/, 'Bo — Di’s account is older than the sign-in clock');
  assert.match(t, /Deactivated 1/);
  assert.match(t, /Paused 1/);
  assert.match(t, /Member Crew ▴ Last password login Doors Last door/, 'sorted by crew, as it opens');
  assert.match(t, /Dana Cruz’s crew · 2/);
  assert.match(t, /No crew · 4/);
  assert.match(t, /412/, 'Doors from the leaderboard');
  assert.match(t, /Not recorded/, 'No sign-in recorded is plain, in the column');
  assert.match(t, /No longer in the org/);
  assert.deepEqual(rowNames(html), ['ann', 'bo', 'cy', 'di', 'ed', 'flo'], 'by crew: Dana’s crew, then No crew');
  assert.ok(buttons(html).some((b) => b.label === 'Add people'));
  assert.match(t, /Org users ›/);
  assert.match(html, /aria-label="Select ann Lee"/, 'a checkbox per row');
});

test('the list’s state comes from the address: filters, sort, page and the open person', async () => {
  const { page } = await load();
  assert.deepEqual(rowNames(page(ADMIN, { rows: ROWS, url: '/campaigns/c1/team?chip=never-signed-in' })), ['bo']);
  assert.deepEqual(rowNames(page(ADMIN, { rows: ROWS, url: '/campaigns/c1/team?crew=none&role=canvasser' })), ['cy', 'di', 'ed', 'flo']);
  assert.deepEqual(rowNames(page(ADMIN, { rows: ROWS, url: '/campaigns/c1/team?q=ann' })), ['ann']);
  const byName = rowNames(page(ADMIN, { rows: ROWS, url: '/campaigns/c1/team?sort=name&dir=desc' }));
  assert.deepEqual(byName, ['flo', 'ed', 'di', 'cy', 'bo', 'ann']);

  const many = Array.from({ length: 30 }, (_, i) => row(`p${String(i).padStart(2, '0')}`));
  const one = page(ADMIN, { rows: many });
  assert.equal(rowNames(one).length, 25, '25 to a page');
  assert.match(text(one), /1–25 of 30/);
  const two = page(ADMIN, { rows: many, url: '/campaigns/c1/team?page=2' });
  assert.equal(rowNames(two).length, 5);
  assert.match(text(two), /26–30 of 30/);

  const open = page(ADMIN, { rows: ROWS, url: '/campaigns/c1/team?person=bo' });
  assert.match(open, /data-testid="panel"/, 'the person panel');
  assert.match(text(open), /2 of 6/);
});

test('a team lead sees no Org users link; an archived campaign has no Add people and no selection', async () => {
  const { page } = await load();
  const lead = text(page(LEAD, { rows: ROWS }));
  assert.doesNotMatch(lead, /Org users/);
  assert.match(lead, /Add people/);
  const archived = page(ADMIN, { rows: ROWS, archived: true });
  assert.match(text(archived), /This campaign is archived, so its team is read-only\./);
  assert.ok(!buttons(archived).some((b) => b.label === 'Add people'));
  assert.doesNotMatch(archived, /aria-label="Select /);
});

test('the bulk bar: the selection, Select all N that match (up to 500), and each action’s reach', async () => {
  const { bar } = await load();
  const t = text(bar({ count: 3, matching: 45, resendCount: 1, removeCount: 3 }));
  assert.match(t, /3 selected Select all 45 that match Clear Move to crew… Resend invites \(1\) Remove from campaign/);
  assert.match(text(bar({ count: 3, matching: 620, resendCount: 0, removeCount: 2 })), /Select all 620 that match \(up to 500\)/);
  const lead = bar({ count: 3, matching: 3, resendCount: 0, removeCount: 2 });
  assert.match(text(lead), /Remove from campaign \(2\)/, 'a lead’s reach is said');
  assert.doesNotMatch(text(lead), /Select all/, 'everyone matching is selected');
  assert.match(buttons(lead).find((b) => b.label.startsWith('Resend invites')).attrs, /disabled=""/);
  assert.equal(bar({ count: 0, matching: 9, resendCount: 0, removeCount: 0 }), '', 'nothing selected, no bar');
});

test('the bulk dialogs: pick a crew first; how many invites go out; who loses their crew on a remove', async () => {
  const { move, confirm } = await load();
  const m = move();
  assert.match(text(m), /Move to crew 2 selected/);
  assert.match(m, /Pick a crew…/);
  assert.match(buttons(m).find((b) => b.label.startsWith('Move ')).attrs, /disabled=""/, 'nothing moves before a check');

  const resend = confirm('resend', [row('bo', { lastLoginAt: null })], ROWS);
  assert.match(text(resend), /Send 1 invite email/);
  assert.match(text(resend), /Each new link replaces any earlier invite or reset link for that person\./);

  const roster = [row('dana', { role: 'lead', firstName: 'Dana' }), row('x', { coordinatorId: 'dana' }), row('y', { coordinatorId: 'dana' })];
  const remove = text(confirm('remove', [roster[0]], roster));
  assert.match(remove, /Remove 1 person from Fall Canvass \?/);
  assert.match(remove, /Dana runs a crew here: 2 people will have no crew\. Their past doors stay on Dana’s team\./);
  assert.match(remove, /Their work is kept\./);
});
