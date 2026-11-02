import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// Render smoke for the Voter Import page's Recent imports times (docs/PROPOSAL_CAMPAIGN_CLOCK.md, decision 1):
// an upload's time is on the campaign's clock, never the organization's. The campaignVotersRender recipe:
// renderToString against a seeded react-query cache, with the auth hooks stubbed (SSR has no session).

const here = fileURLToPath(new URL('.', import.meta.url));
const CID = '6a0000000000000000000001';

const render = async () => {
  // Inside the client tree on purpose: dependencies stay external to the bundle, so node resolves them from
  // the bundle's own location at import time.
  const dir = mkdtempSync(join(here, '../../.smoke-imp-'));
  try {
    writeFileSync(
      join(dir, 'authStub.jsx'),
      `export const useAuth = () => ({ homePath: '/campaigns', isOrgAdmin: true, isSuperAdmin: false, isLead: false, managedCampaignIds: [], user: { id: 'u1' } });
       export const useOrgTimeZone = () => 'America/New_York';`
    );
    writeFileSync(
      join(dir, 'entry.jsx'),
      `import React from 'react';
       import { renderToString } from 'react-dom/server';
       import { MemoryRouter, Routes, Route } from 'react-router-dom';
       import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
       import ImportPage from '${join(here, '../pages/ImportPage.jsx')}';
       globalThis.fetch = () => new Promise(() => {});
       const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
       qc.setQueryData(['admin', 'campaigns'], {
         campaigns: [{ _id: '${CID}', name: 'Omaha Race', type: 'survey', state: 'NE', isActive: true, timeZone: 'America/Chicago' }],
       });
       // One finished upload at 18:30 UTC: 12:30 PM CST in Omaha, 1:30 PM EST on the stubbed organization's clock.
       qc.setQueryData(['imports', '${CID}', 'with-lookups'], {
         jobs: [{ _id: 'j1', campaignId: '${CID}', filename: 'omaha-voters.csv', status: 'completed', createdAt: '2026-11-02T18:30:00.000Z' }],
       });
       export const html = renderToString(
         <QueryClientProvider client={qc}>
           <MemoryRouter initialEntries={['/campaigns/${CID}/import']}>
             <Routes>
               <Route path="/campaigns/:campaignId/import" element={<ImportPage />} />
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
    return html.replaceAll('<!-- -->', '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("an upload's time in Recent imports is on the campaign's clock, not the organization's", async () => {
  const html = await render();
  assert.match(html, /omaha-voters\.csv/, 'the seeded upload rendered');
  // Intl puts a narrow no-break space before AM/PM, which \s matches.
  assert.match(html, /11\/2\/2026, 12:30\sPM CST/);
  assert.doesNotMatch(html, /\bE[SD]T\b/, 'never the organization’s Eastern clock');
});
