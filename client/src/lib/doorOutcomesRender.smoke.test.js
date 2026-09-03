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
