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
