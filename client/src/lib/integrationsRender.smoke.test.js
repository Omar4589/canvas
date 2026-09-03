import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke test for the rebuilt Integrations page, on the billingRender recipe:
// renderToString EXECUTES the component body, so an import, hook-ordering or JSX
// mistake fails in `npm test` rather than on the first admin who opens the page.
//
// The load-bearing assertion is the NEGATIVE one: no <select> in the table. The old
// page rendered one per unlinked row, each holding the entire org roster as
// <option>s — N x M nodes, unsearchable, and showing bare names so two people with
// the same name were indistinguishable. That must not come back.

const here = fileURLToPath(new URL('.', import.meta.url));

async function render(entry) {
  const dir = mkdtempSync(join(here, '../../.smoke-'));
  writeFileSync(
    join(dir, 'authStub.jsx'),
    `export const useAuth = () => ({ homePath: '/', isLead: false, isOrgAdmin: true, isSuperAdmin: false, canViewBilling: false, user: { id: 'u1' } });
     export const useOrgTimeZone = () => 'America/Chicago';`
  );
  writeFileSync(join(dir, 'entry.jsx'), entry(here));
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
        name: 'stub-auth',
        setup(b) {
          b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
        },
      },
    ],
  });
  const { html } = await import(pathToFileURL(out).href);
  rmSync(dir, { recursive: true, force: true });
  // React SSR separates adjacent text nodes with <!-- -->, which splits any
  // interpolated sentence ("Review {n} matches") mid-phrase.
  return html.replace(/<!-- -->/g, '');
}

// One fixture covering every row kind the folding can produce.
const SEED = `
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['admin', 'integrations', 'fbtime', 'o1'], {
    connected: true, configured: true, status: 'connected', keyPrefix: 'fbt_live_abcd',
    fbtimeOrgName: 'Acme Field Ops', hourFigure: 'adjustedHours',
    lastSyncAt: '2026-09-02T12:00:00Z', lastSyncError: null, lastErrorAt: null,
    linkCount: 2, unmatchedWithHours: 1,
  });
  qc.setQueryData(['admin', 'integrations', 'fbtime', 'people', 'o1'], {
    people: [
      { fbtimePersonId: 'p1', firstName: 'Maria', lastName: 'Ortega', email: 'maria@org.com',
        isActive: true, linkedUserId: 'u1', linkSource: 'auto-email', hasUnmatchedHours: false },
      { fbtimePersonId: 'p2', firstName: 'Chris', lastName: 'Nunez', email: 'chris@personal.com',
        isActive: true, linkedUserId: null, linkSource: null, hasUnmatchedHours: true },
      { fbtimePersonId: 'p3', firstName: 'Dormant', lastName: 'Dan', email: 'dan@old.com',
        isActive: false, linkedUserId: null, linkSource: null, hasUnmatchedHours: false },
      { fbtimePersonId: 'p4', firstName: 'Left', lastName: 'Org', email: 'left@org.com',
        isActive: true, linkedUserId: 'ghostuser', linkSource: 'manual', hasUnmatchedHours: false },
    ],
    suggestions: [{ fbtimePersonId: 'p2', userId: 'u2' }],
    orphanLinks: [],
    ghostPersonIds: [],
  });
  qc.setQueryData(['admin', 'integrations', 'fbtime', 'projects', 'o1'], {
    windowDays: 30, degraded: false,
    projects: [
      { fbtimePersonId: 'p1', lastShiftAt: '2026-09-01T12:00:00Z',
        projects: [{ id: 'x', name: 'Ward 5 Field', lastAt: '2026-09-01T12:00:00Z', shifts: 4 }] },
    ],
  });
  qc.setQueryData(['admin', 'integrations', 'org-users', 'o1'], {
    members: [
      { membershipId: 'm1', role: 'canvasser', isActive: true, campaignIds: ['c1'], managedCampaignIds: [], fbtime: { linked: true },
        user: { id: 'u1', firstName: 'Maria', lastName: 'Ortega', email: 'maria@org.com', isActive: true, isDeleted: false } },
      { membershipId: 'm2', role: 'canvasser', isActive: true, campaignIds: ['c1'], managedCampaignIds: [], fbtime: { linked: false },
        user: { id: 'u2', firstName: 'Devon', lastName: 'Price', email: 'chris@personal.com', isActive: true, isDeleted: false } },
      { membershipId: 'm3', role: 'canvasser', isActive: false, campaignIds: [], managedCampaignIds: [], fbtime: { linked: false },
        user: { id: 'u3', firstName: 'Deleted', lastName: 'user', email: 'x@deleted.invalid', isActive: false, isDeleted: true } },
    ],
  });
  qc.setQueryData(['admin', 'campaigns'], {
    campaigns: [
      { _id: 'c1', name: 'Ward 5 Primary', isActive: true },
      { _id: 'c9', name: 'Old Race', isActive: false },
    ],
    deletingCampaigns: [],
  });
  globalThis.fetch = () => new Promise(() => {});
`;

const entryFor = (h) => `import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { MemoryRouter } from 'react-router-dom';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import IntegrationsPage from '${join(h, '../pages/IntegrationsPage.jsx')}';
  // getActiveOrgId() runs in the component body and reads localStorage, which node
  // has no notion of. Pinning the id is what lets the seeded cache keys match.
  const store = { 'canvass.activeOrgId': 'o1' };
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: () => {}, removeItem: () => {} };
  ${SEED}
  export const html = renderToString(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/integrations']}><IntegrationsPage /></MemoryRouter>
    </QueryClientProvider>
  );`;

test('the two-sided roster renders both systems side by side', async () => {
  const html = await render(entryFor);

  assert.match(html, /Acme Field Ops/, 'the status strip names the FbTime org');
  assert.match(html, /Maria Ortega/, 'a matched pair renders');
  // The whole point of the redesign: campaign and FbTime project on one row.
  assert.match(html, /Ward 5 Primary/, 'the Doorline campaign chip renders');
  assert.match(html, /Ward 5 Field/, 'the FbTime project renders beside it');

  assert.match(html, /Devon Price/, 'a Doorline person with no FbTime match is VISIBLE — the old page could not show them at all');
  assert.match(html, /Not in FbTime/);
  assert.match(html, /Not in Doorline/, 'and an FbTime person with no Doorline match');
  assert.match(html, /Broken link/, 'a link pointing at a non-member is called what it is, not "Linked"');
  assert.match(html, /Hours not counted/, 'unassigned hours get their own status');
});

test('the count line reports what is hidden, and inactive people are hidden by default', async () => {
  const html = await render(entryFor);
  // 6 rows fold from the fixture; the dormant FbTime person and the deleted
  // account are the two the toggle hides.
  assert.match(html, /\d+ of \d+ shown/, 'the count line renders');
  assert.match(html, /inactive hidden/, 'and says what it is hiding, rather than silently dropping rows');
  assert.doesNotMatch(html, /Dormant Dan/, 'a dormant FbTime person with no hours is hidden by default');
});

test('suggested matches are surfaced instead of being thrown away', async () => {
  const html = await render(entryFor);
  // The server has returned `suggestions` since day one and the old page read
  // only `.people`, so "Auto-match by email" wrote blind.
  // The count sits inside a <strong>, so assert the two halves separately.
  assert.match(html, /match by email and aren/, 'the review banner renders');
  assert.match(html, />1 person<\/strong>/, 'and names how many');
  assert.match(html, /Review 1 match/);
});

test('no per-row <select> of the whole roster comes back', async () => {
  const html = await render(entryFor);
  const table = html.slice(html.indexOf('<table'));
  assert.ok(table.length > 0, 'the table rendered');
  assert.doesNotMatch(table, /<select/, 'the N x M LinkPicker dropdown is gone for good');
});

test('the page is full-bleed — no max-width column', async () => {
  const html = await render(entryFor);
  // The old root was `mx-auto max-w-3xl`, a 768px column holding a 4-column table.
  const root = html.slice(0, 400);
  assert.doesNotMatch(root, /max-w-3xl/, 'the narrow settings-page container is gone');
});
