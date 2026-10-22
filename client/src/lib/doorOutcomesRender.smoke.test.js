import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// A RENDER smoke test, because `vite build` cannot catch the bug class this page actually shipped:
// a component-body const referenced by a useMemo declared above it is in its temporal dead zone,
// and nothing throws until a render reaches that branch — which for the filter-token memo meant
// the first answer chip an admin ever picked (2026-08-26, "Cannot access 'De' before
// initialization"). renderToString EXECUTES the component body, so ordering bugs fail here, in
// `npm test`, instead of in the field.
//
// The page renders with its real providers minus auth (stubbed — SSR has no session): a
// MemoryRouter whose URL carries the deep-link seeds `?questionKey&optionId&userId`, which is the
// shipped path that puts the page straight into the answer-filter state that detonated.

const here = fileURLToPath(new URL('.', import.meta.url));
// The temp dir lives INSIDE the client tree on purpose: dependencies stay external to the
// bundle (react-dom/server is CJS and cannot be inlined into an ESM bundle), so node must be
// able to resolve them from the bundle's own location at import time.
const dir = mkdtempSync(join(here, '../../.smoke-'));

test('DoorOutcomesPage renders with a seeded answer filter — the TDZ regression', async () => {
  writeFileSync(
    join(dir, 'authStub.jsx'),
    `export const useAuth = () => ({ homePath: '/', isOrgAdmin: true, isSuperAdmin: false, user: { id: 'u1' } });
     export const useOrgTimeZone = () => 'America/Chicago';`
  );
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { MemoryRouter, Routes, Route } from 'react-router-dom';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import DoorOutcomesPage from '${join(here, '../pages/DoorOutcomesPage.jsx')}';
     // A never-settling fetch keeps every query pending without touching the network (pending
     // promises do not hold the node event loop open), so the page renders its loading states.
     // The one query that must NOT be pending is the campaigns list: :campaignId has to resolve
     // to a campaign or the drill-in renders its resolving skeleton and the page body — the
     // thing this test exists to EXECUTE — never runs. So the list is seeded, fresh, with the
     // campaign the URL names. (Before lib/useCurrentCampaign.js this test leaned on an
     // accident: a cold list left isLoading true, which happened to skip the old guard.)
     globalThis.fetch = () => new Promise(() => {});
     const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
     qc.setQueryData(['admin', 'campaigns'], {
       campaigns: [{
         _id: '6a0000000000000000000001',
         name: 'Ward 3',
         type: 'survey',
         state: 'FL',
         isActive: true,
         timeZone: 'America/New_York',
       }],
     });
     export const html = renderToString(
       <QueryClientProvider client={qc}>
         <MemoryRouter initialEntries={[
           '/campaigns/6a0000000000000000000001/outcomes?questionKey=support&optionId=yes&userId=6a0000000000000000000002'
         ]}>
           <Routes>
             <Route path="/campaigns/:campaignId/outcomes" element={<DoorOutcomesPage />} />
           </Routes>
         </MemoryRouter>
       </QueryClientProvider>
     );`
  );
  const out = join(dir, 'bundle.mjs');
  await esbuild.build({
    entryPoints: [join(dir, 'entry.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    jsx: 'automatic',
    logLevel: 'silent',
    // Bundle ONLY the app source — that is what this test exercises — and leave every
    // dependency external for node to load natively.
    packages: 'external',
    plugins: [
      {
        // SSR has no session, so the auth hooks are stubbed — everything else is the real page.
        name: 'stub-auth',
        setup(b) {
          b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
        },
      },
    ],
  });
  try {
    const { html } = await import(pathToFileURL(out).href);
    // The page reached its full render: the filter card is up and the seeded answer filter is
    // visible as an applied token (the exact branch the TDZ killed).
    assert.match(html, /Door Outcomes/);
    assert.match(html, /answer filter/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Not a target voter (docs/PROPOSAL_NOT_TARGET_OUTCOME.md §H, §J): its filter chip shows only on a
// campaign that has used the outcome — a customer who never turns it on never sees the words — and an
// entry queued offline wears an "Offline" tag beside its outcome. The entries list is seeded through
// setQueryDefaults' initialData, because its key carries a date-dependent scope string.
test('DoorOutcomesPage: the Not a target voter chip only where used, and the Offline tag', async () => {
  const dir2 = mkdtempSync(join(here, '../../.smoke-'));
  writeFileSync(
    join(dir2, 'authStub.jsx'),
    `export const useAuth = () => ({ homePath: '/', isOrgAdmin: true, isSuperAdmin: false, user: { id: 'u1' } });
     export const useOrgTimeZone = () => 'America/Chicago';`
  );
  writeFileSync(
    join(dir2, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { MemoryRouter, Routes, Route } from 'react-router-dom';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import DoorOutcomesPage from '${join(here, '../pages/DoorOutcomesPage.jsx')}';
     globalThis.fetch = () => new Promise(() => {});
     export const render = (campaignExtra) => {
       const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
       qc.setQueryData(['admin', 'campaigns'], {
         campaigns: [{ _id: '6a0000000000000000000001', name: 'Ward 3', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York', ...campaignExtra }],
         optInOutcomesAvailable: ['not_target'],
       });
       qc.setQueryDefaults(['admin', 'outcome-entries'], {
         staleTime: Infinity,
         initialData: {
           entries: [{
             id: 'e1', householdId: 'h1', address: '12 Elm St', city: 'Tampa', actionType: 'not_target',
             userId: 'u9', passId: null, timestamp: '2026-09-30T15:00:00Z', wasOfflineSubmission: true,
           }],
           total: 1, doors: 1, facets: { not_target: 1 }, sources: ['not_target'],
         },
       });
       return renderToString(
         <QueryClientProvider client={qc}>
           <MemoryRouter initialEntries={['/campaigns/6a0000000000000000000001/outcomes']}>
             <Routes>
               <Route path="/campaigns/:campaignId/outcomes" element={<DoorOutcomesPage />} />
             </Routes>
           </MemoryRouter>
         </QueryClientProvider>
       );
     };`
  );
  const out = join(dir2, 'bundle.mjs');
  await esbuild.build({
    entryPoints: [join(dir2, 'entry.jsx')],
    bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic', logLevel: 'silent',
    packages: 'external',
    plugins: [
      {
        name: 'stub-auth',
        setup(b) {
          b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir2, 'authStub.jsx') }));
        },
      },
    ],
  });
  try {
    const { render } = await import(pathToFileURL(out).href);
    // A filter chip is a <button aria-pressed> whose text is the label — matched as such, so the
    // table row or the Change-to list naming the outcome cannot satisfy the assertion.
    const hasChip = (html) =>
      [...html.matchAll(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>([\s\S]*?)<\/button>/g)].some((m) =>
        m[1].includes('Not a target voter')
      );

    const used = render({ enabledOutcomes: ['not_target'], everEnabledOutcomes: ['not_target'] });
    assert.ok(hasChip(used), 'a campaign that used it gets the chip');
    assert.match(used, /12 Elm St/, 'the seeded entry rendered');
    assert.match(used, />Offline</, 'an offline-queued entry is marked');

    const never = render({ enabledOutcomes: [], everEnabledOutcomes: [] });
    assert.ok(hasChip(never) === false, 'never used: no chip');
    assert.ok(hasChip(render({ enabledOutcomes: [], everEnabledOutcomes: ['not_target'] })), 'switched off later: history keeps the chip');
  } finally {
    rmSync(dir2, { recursive: true, force: true });
  }
});

// A change at work, seen from the page (2026-10-21): its row says where it has got to and offers no Undo the
// server would refuse; a stopped conversion offers Pick up; an unknock still removing says how far it has
// got; and the live cards sit ABOVE the entries table — below every list, nobody saw them after Confirm.
test('DoorOutcomesPage: changes at work say where they are, and the live cards sit above the table', async () => {
  const dir3 = mkdtempSync(join(here, '../../.smoke-'));
  writeFileSync(
    join(dir3, 'authStub.jsx'),
    `export const useAuth = () => ({ homePath: '/', isOrgAdmin: true, isSuperAdmin: false, user: { id: 'u1' } });
     export const useOrgTimeZone = () => 'America/Chicago';`
  );
  writeFileSync(
    join(dir3, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { MemoryRouter, Routes, Route } from 'react-router-dom';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import DoorOutcomesPage from '${join(here, '../pages/DoorOutcomesPage.jsx')}';
     globalThis.fetch = () => new Promise(() => {});
     const CID = '6a0000000000000000000001';
     const at = '2026-10-21T15:00:00Z';
     const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
     qc.setQueryData(['admin', 'campaigns'], {
       campaigns: [{ _id: CID, name: 'Ward 3', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York' }],
     });
     qc.setQueryDefaults(['admin', 'outcome-entries'], {
       staleTime: Infinity,
       initialData: {
         entries: [{ id: 'e1', householdId: 'h1', address: '12 Elm St', city: 'Tampa', actionType: 'not_home', userId: 'u9', passId: null, timestamp: at }],
         total: 1, doors: 1, facets: { not_home: 1 }, sources: ['not_home'],
       },
     });
     qc.setQueryData(['admin', 'campaigns', CID, 'survey-conversions'], { runs: [
       { id: 'c1', campaignId: CID, direction: 'from_survey', to: 'not_home', status: 'running', counts: {}, progress: { phase: 'converting', pct: 66, doorsDone: 2, doorsTotal: 3 }, createdAt: at },
       { id: 'c2', campaignId: CID, direction: 'from_survey', to: 'not_home', status: 'failed', counts: { entriesConverted: 4 }, progress: {}, createdAt: at },
     ] });
     qc.setQueryData(['admin', 'campaigns', CID, 'answer-edits'], { runs: [
       { id: 'a1', campaignId: CID, mode: 'bulk', status: 'running', progress: { done: 120, total: 500 }, counts: {}, createdAt: at },
     ] });
     qc.setQueryData(['admin', 'campaigns', CID, 'unknock'], { runs: [
       { id: 'u1', status: 'pending', removing: true, undoing: false, progress: { phase: 'removing', pct: 47 }, frozenRows: 10, counts: { doorsAffected: 4 }, createdAt: at },
     ] });
     export const html = renderToString(
       <QueryClientProvider client={qc}>
         <MemoryRouter initialEntries={['/campaigns/' + CID + '/outcomes']}>
           <Routes>
             <Route path="/campaigns/:campaignId/outcomes" element={<DoorOutcomesPage />} />
           </Routes>
         </MemoryRouter>
       </QueryClientProvider>
     );`
  );
  const out = join(dir3, 'bundle.mjs');
  await esbuild.build({
    entryPoints: [join(dir3, 'entry.jsx')],
    bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic', logLevel: 'silent',
    packages: 'external',
    plugins: [
      {
        name: 'stub-auth',
        setup(b) {
          b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir3, 'authStub.jsx') }));
        },
      },
    ],
  });
  try {
    const { html } = await import(pathToFileURL(out).href);
    assert.match(html, /12 Elm St/, 'the page reached its full render');
    assert.match(html, /Working · 2 of 3 doors/, 'a conversion at work says where it is');
    assert.match(html, /Pick up where it stopped/, 'a stopped conversion can be picked up from its row');
    assert.match(html, /Working · 120 of 500 surveys/, 'an answer edit at work says where it is');
    assert.match(html, /Removing… 47%/, 'an unknock still removing says how far it has got');
    // The running conversion's row offers no Undo: between its title and the next row there is none.
    const row = html.slice(html.indexOf('Working · 2 of 3 doors') - 1500, html.indexOf('Working · 2 of 3 doors') + 300);
    assert.ok(!/>Undo</.test(row.slice(row.lastIndexOf('<li'))), 'no Undo while it runs');
  } finally {
    rmSync(dir3, { recursive: true, force: true });
  }
  // The live cards render above the entries table (their state comes from a click, so SSR can't show
  // them — the page's own order is what is pinned).
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(join(here, '../pages/DoorOutcomesPage.jsx'), 'utf8');
  const table = page.indexOf('{/* Entries */}');
  assert.ok(table > 0);
  assert.ok(page.indexOf('<AnswerEditRunCard') < table, 'the answer-edit card is above the table');
  assert.ok(page.indexOf('<ConversionRunCard') < table, 'the conversion card is above the table');
});
