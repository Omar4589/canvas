import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// A RENDER smoke test for the "Campaign not found" flash, because the unit test beside it can
// only pin the decision — not that the page ASKS the right question. This one drives the real
// DashboardPage through the exact sequence CampaignsPage performs on create:
//
//   setQueryData(['admin','campaigns'], <the list as it was a moment ago>)
//   invalidateQueries(['admin','campaigns'])          ← create's onSuccess
//   navigate(`/campaigns/${newId}`)                   ← same tick
//
// react-query reports that state as isLoading:false / isFetching:true (the optimistic result is
// computed in the mounting render pass, before any effect), so the old guard —
// `!campaignsQ.isLoading && !current` — fired and told the admin their brand-new campaign did
// not exist, until the refetch landed a moment later.
//
// The second case is the one that keeps the fix honest: a SETTLED list without the id must still
// say "Campaign not found" immediately, or a mistyped URL becomes a spinner forever.

const here = fileURLToPath(new URL('.', import.meta.url));
// Inside the client tree so node can resolve react/react-dom from the bundle's own location.
const dir = mkdtempSync(join(here, '../../.smoke-resolve-'));

const NEW_ID = '6a0000000000000000000009';
const STALE_LIST = `{ campaigns: [{ _id: '6a0000000000000000000001', name: 'Ward 3', isActive: true, type: 'survey', state: 'FL', timeZone: 'America/New_York' }] }`;

const entry = (invalidate) => `import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { MemoryRouter, Routes, Route } from 'react-router-dom';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import DashboardPage from '${join(here, '../pages/DashboardPage.jsx')}';
  // Nothing may actually resolve: a never-settling fetch keeps the refetch in flight for the
  // whole render without touching the network (pending promises don't hold node's loop open).
  globalThis.fetch = () => new Promise(() => {});
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The campaigns list as the admin left it on /campaigns — the new campaign is NOT in it.
  qc.setQueryData(['admin', 'campaigns'], ${STALE_LIST});
  ${invalidate ? "qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });" : ''}
  export const html = renderToString(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/campaigns/${NEW_ID}']}>
        <Routes>
          <Route path="/campaigns/:campaignId" element={<DashboardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );`;

const render = async (name, invalidate) => {
  writeFileSync(join(dir, `${name}.jsx`), entry(invalidate));
  const out = join(dir, `${name}.mjs`);
  await esbuild.build({
    entryPoints: [join(dir, `${name}.jsx`)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    jsx: 'automatic',
    logLevel: 'silent',
    packages: 'external',
    plugins: [
      {
        // SSR has no session, so only the auth hooks are stubbed — everything else is the real page.
        // The stylesheet stub is harness plumbing: dependencies stay external, so a transitive
        // `import 'mapbox-gl/dist/mapbox-gl.css'` would reach node, which cannot load a .css file.
        name: 'stub-auth',
        setup(b) {
          b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
          b.onResolve({ filter: /\.css$/ }, () => ({ path: join(dir, 'emptyStyle.js') }));
        },
      },
    ],
  });
  const { html } = await import(pathToFileURL(out).href);
  return html;
};

test('a campaign created a moment ago never renders as "Campaign not found"', async () => {
  writeFileSync(
    join(dir, 'authStub.jsx'),
    `export const useAuth = () => ({ homePath: '/campaigns', isOrgAdmin: true, isSuperAdmin: false, user: { id: 'u1' } });
     export const useOrgTimeZone = () => 'America/Chicago';`
  );
  writeFileSync(join(dir, 'emptyStyle.js'), 'export default {};');
  try {
    const flashing = await render('created', true);
    assert.doesNotMatch(flashing, /Campaign not found/, 'the create-path flash is back');
    assert.doesNotMatch(flashing, /No campaign selected/);
    // It renders the resolving skeleton instead — animate-pulse is Skeleton's own class.
    assert.match(flashing, /animate-pulse/);

    // …and an id that is genuinely absent from a settled list is still reported at once.
    const missing = await render('missing', false);
    assert.match(missing, /Campaign not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
