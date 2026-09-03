import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke tests for the "the campaign I just created does not exist" family, because the unit
// tests beside them can only pin the DECISION — not that a page asks the right question. Both cases
// here drive the real page through the exact sequence CampaignsPage performs on create:
//
//   setQueryData(['admin','campaigns'], <the list as it was a moment ago>)
//   invalidateQueries(['admin','campaigns'])          <- create's onSuccess
//   navigate(`/campaigns/${newId}`)                   <- same tick
//
// react-query reports that state as isLoading:false / isFetching:true (the optimistic result is
// computed in the mounting render pass, before any effect), so any guard keyed on isLoading treats
// a list written BEFORE the campaign existed as a final answer.
//
// The two pages fail differently and both are pinned:
//   DashboardPage      — rendered "Campaign not found" over a campaign that exists.
//   CampaignSurveyPage — worse: <Navigate to="/campaigns" replace />, ejecting the admin out of the
//                        FIRST setup step. Its old guard leaned on the two sibling queries still
//                        being in flight, which on this path they are not: CampaignsPage mounts
//                        ['surveys'] itself so that cache is warm before the create, and
//                        ['admin','efforts',<newId>] answers {efforts: []} for a brand-new campaign
//                        well before the org-wide withCounts rollup behind GET /admin/campaigns.
//
// The settled-list cases keep the fix honest: a list that HAS answered without the id must still
// report at once, or a mistyped URL becomes a spinner forever.

const here = fileURLToPath(new URL('.', import.meta.url));
// One throwaway dir PER TEST, inside the client tree so node can resolve react/react-dom from the
// bundle's own location. Per-test matters: each test removes its dir in a finally, so a single
// shared dir would leave the second test with nowhere to write.
let dir = '';
const newDir = () => {
  dir = mkdtempSync(join(here, '../../.smoke-resolve-'));
  return dir;
};

const NEW_ID = '6a0000000000000000000009';
const OTHER = `{ _id: '6a0000000000000000000001', name: 'Ward 3', isActive: true, type: 'survey', state: 'FL', timeZone: 'America/New_York' }`;
const NEWROW = `{ _id: '${NEW_ID}', name: 'Brand New', isActive: true, type: 'survey', state: 'FL', timeZone: 'America/New_York' }`;

// seeds: extra qc.setQueryData lines. stale: seed the pre-create list then invalidate it.
const entry = ({ page, routePath, url, seeds = '', stale }) => `import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { MemoryRouter, Routes, Route } from 'react-router-dom';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import Page from '${join(here, '../pages/')}${page}';
  // Nothing may actually resolve: a never-settling fetch keeps the refetch in flight for the whole
  // render without touching the network (pending promises do not hold node's loop open).
  globalThis.fetch = () => new Promise(() => {});
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['admin', 'campaigns'], { campaigns: [${OTHER}${stale ? '' : ', ' + NEWROW}] });
  ${seeds}
  ${stale ? "qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });" : ''}
  export const html = renderToString(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['${url}']}>
        <Routes>
          <Route path="${routePath}" element={<Page />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );`;

const render = async (name, opts) => {
  writeFileSync(join(dir, `${name}.jsx`), entry(opts));
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

const writeStubs = () => {
  writeFileSync(
    join(dir, 'authStub.jsx'),
    `export const useAuth = () => ({ homePath: '/campaigns', isOrgAdmin: true, isSuperAdmin: false, managedCampaignIds: [], user: { id: 'u1' } });
     export const useOrgTimeZone = () => 'America/Chicago';`
  );
  writeFileSync(join(dir, 'emptyStyle.js'), 'export default {};');
};

test('a campaign created a moment ago never renders as "Campaign not found"', async () => {
  newDir();
  writeStubs();
  try {
    const flashing = await render('created', {
      page: 'DashboardPage.jsx',
      routePath: '/campaigns/:campaignId',
      url: `/campaigns/${NEW_ID}`,
      stale: true,
    });
    assert.doesNotMatch(flashing, /Campaign not found/, 'the create-path flash is back');
    assert.doesNotMatch(flashing, /No campaign selected/);
    // It renders the resolving skeleton instead — animate-pulse is Skeleton's own class.
    assert.match(flashing, /animate-pulse/);

    // …and an id that is genuinely absent from a settled list is still reported at once.
    const missing = await render('missing', {
      page: 'DashboardPage.jsx',
      routePath: '/campaigns/:campaignId',
      url: '/campaigns/6a0000000000000000000fff',
      stale: false,
    });
    assert.match(missing, /Campaign not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Survey tab never ejects to /campaigns for a campaign created a moment ago', async () => {
  newDir();
  writeStubs();
  // Both siblings SETTLED — the state the old guard had no defence against, and the state the
  // create path actually produces. <Navigate> renders null in SSR, so an EMPTY string is the
  // redirect branch and is the failure this test exists to catch.
  const settledSiblings = `qc.setQueryData(['surveys'], { surveys: [] });
  qc.setQueryData(['admin', 'efforts', '${NEW_ID}'], { efforts: [] });`;
  try {
    const created = await render('survey-created', {
      page: 'CampaignSurveyPage.jsx',
      routePath: '/campaigns/:campaignId/survey',
      url: `/campaigns/${NEW_ID}/survey`,
      seeds: settledSiblings,
      stale: true,
    });
    assert.notEqual(created, '', 'empty render = <Navigate> fired: the Survey tab ejected to /campaigns');
    assert.match(created, /Loading…/, 'it should hold while the campaigns list is still resolving');

    // The redirect itself is intact: a settled list without the id still bounces to the launchpad.
    const gone = await render('survey-gone', {
      page: 'CampaignSurveyPage.jsx',
      routePath: '/campaigns/:campaignId/survey',
      url: '/campaigns/6a0000000000000000000fff/survey',
      seeds: `qc.setQueryData(['surveys'], { surveys: [] });
  qc.setQueryData(['admin', 'efforts', '6a0000000000000000000fff'], { efforts: [] });`,
      stale: false,
    });
    assert.equal(gone, '', 'a genuinely missing campaign must still redirect');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
