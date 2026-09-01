import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// A RENDER smoke test for the Exports page, on the doorOutcomesRender recipe: renderToString
// EXECUTES the component body, so an import, ordering or JSX mistake in the page fails here in
// `npm test` instead of on the first admin who opens Exports. Pinned specifically: with
// Canvassing activity selected (the default type), the Door-outcome chips and the one-row-per-
// voter checkbox are NOT inline — they belong to the dialog that Queue export opens — while the
// narrowing filters and the Queue button are. (SSR cannot click, so the open dialog itself is
// compiled by the build but not rendered here.)

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-'));

test('ExportsPage renders; canvass-activity options live in the dialog, not inline', async () => {
  writeFileSync(
    join(dir, 'authStub.jsx'),
    `export const useAuth = () => ({ homePath: '/', isLead: false, isOrgAdmin: true, isSuperAdmin: false, user: { id: 'u1' } });
     export const useOrgTimeZone = () => 'America/Chicago';`
  );
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { MemoryRouter, Routes, Route } from 'react-router-dom';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import ExportsPage from '${join(here, '../pages/ExportsPage.jsx')}';
     globalThis.fetch = () => new Promise(() => {});
     const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
     export const html = renderToString(
       <QueryClientProvider client={qc}>
         <MemoryRouter initialEntries={['/campaigns/6a0000000000000000000001/exports']}>
           <Routes>
             <Route path="/campaigns/:campaignId/exports" element={<ExportsPage />} />
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
  try {
    const { html } = await import(pathToFileURL(out).href);
    assert.match(html, /Canvassing activity/, 'the type cards render from the local fallback while /types is pending');
    assert.match(html, /Queue export/);
    assert.doesNotMatch(html, /Door outcome/, 'the outcome chips are in the dialog, not inline, for canvass-activity');
    assert.doesNotMatch(html, /One row per voter at the door/, 'so is the per-voter checkbox');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
