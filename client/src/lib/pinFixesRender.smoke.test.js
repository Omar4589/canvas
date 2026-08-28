import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// Render smoke for the Pin Fixes page — the doorOutcomesRender recipe (renderToString EXECUTES
// the component body, so ordering/TDZ bugs fail in `npm test` instead of in the field) plus one
// new plugin this page needs: a CSS stub. The page imports 'mapbox-gl/dist/mapbox-gl.css', and
// with packages:'external' node would try to import the .css natively and die with "Unknown
// file extension". mapbox-gl itself imports fine under node (v3 guards its globals) and the map
// only constructs in effects, which SSR skips — so no mapbox stub is needed, only the css.

const here = fileURLToPath(new URL('.', import.meta.url));
// Inside the client tree on purpose: dependencies stay external to the bundle, so node must
// resolve them from the bundle's own location at import time.
const dir = mkdtempSync(join(here, '../../.smoke-'));

test('PinFixesPage renders its queue shell under a loading fetch', async () => {
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { MemoryRouter, Routes, Route } from 'react-router-dom';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import PinFixesPage from '${join(here, '../pages/PinFixesPage.jsx')}';
     // Queries stay LOADING (never settle) so the token guard doesn't bail and the full page
     // body executes; pending promises do not hold the node event loop open.
     globalThis.fetch = () => new Promise(() => {});
     const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
     export const html = renderToString(
       <QueryClientProvider client={qc}>
         <MemoryRouter initialEntries={['/campaigns/6a0000000000000000000001/pin-fixes']}>
           <Routes>
             <Route path="/campaigns/:campaignId/pin-fixes" element={<PinFixesPage />} />
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
        // Any css import (mapbox-gl's today, whatever tomorrow) becomes an empty module —
        // node cannot import .css, and the styles are irrelevant to a render smoke.
        name: 'stub-css',
        setup(b) {
          b.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'css-stub' }));
          b.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: '', loader: 'js' }));
        },
      },
    ],
  });
  try {
    const { html } = await import(pathToFileURL(out).href);
    // The full shell rendered: header + instructional copy + the loading count. This is the
    // page's real component body executing, not a placeholder.
    assert.match(html, /Pin Fixes/);
    assert.match(html, /street address/);
    assert.match(html, /Loading…/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
