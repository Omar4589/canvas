import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// Render smoke for the voters directory (the doorOutcomesRender pattern): renderToString
// EXECUTES the component body and the row branches, so ordering/render bugs fail in
// `npm test` instead of in the field. Unlike the loading-state smokes, this one SEEDS the
// react-query cache with a directory page so the walk-up branches actually run: the
// "Added at the door" badge, the masked `manual:` voter id, and the new source filter.

const here = fileURLToPath(new URL('.', import.meta.url));
// Temp dir inside the client tree on purpose: dependencies stay external to the bundle,
// so node resolves them from the bundle's own location at import time.
const dir = mkdtempSync(join(here, '../../.smoke-'));

test('VotersPage renders a seeded page: door-added badge shown, manual: svid masked', async () => {
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { MemoryRouter } from 'react-router-dom';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import VotersPage from '${join(here, '../pages/VotersPage.jsx')}';
     globalThis.fetch = () => new Promise(() => {});
     const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
     // The page's initial query keys, verbatim — every filter starts '' and skip 0.
     qc.setQueryData(['admin', 'campaigns'], { campaigns: [] });
     qc.setQueryData(
       ['admin', 'voters', { search: '', campaignId: '', party: '', surveyStatus: '', voted: '', dnc: '', doorAdded: '', skip: 0 }],
       {
         total: 2,
         voters: [
           { id: 'v1', fullName: 'Ivy Imported', stateVoterId: 'FL123', party: 'IND',
             surveyStatus: 'not_surveyed', dnc: false, doorAdded: null, voted: false,
             household: { id: 'h1', addressLine1: '1 Walkup Way', city: 'Town', state: 'FL', campaignName: 'C' } },
           { id: 'v2', fullName: 'Wally Walkup', stateVoterId: 'manual:6a0000000000000000000009', party: null,
             surveyStatus: 'surveyed', dnc: false, doorAdded: { at: '2026-08-29T12:00:00Z' }, voted: false,
             household: { id: 'h1', addressLine1: '1 Walkup Way', city: 'Town', state: 'FL', campaignName: 'C' } },
         ],
       }
     );
     export const html = renderToString(
       <QueryClientProvider client={qc}>
         <MemoryRouter initialEntries={['/voters']}>
           <VotersPage />
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
  });
  try {
    const { html } = await import(pathToFileURL(out).href);
    assert.match(html, /Wally Walkup/, 'the seeded rows rendered');
    assert.match(html, /Added at the door/, 'the walk-up badge (and the source filter option) render');
    assert.match(html, /Any source/, 'the new source filter select is present');
    assert.match(html, /FL123/, 'a real state voter id still shows');
    assert.doesNotMatch(html, /manual:6a/, 'the synthetic manual: id never renders — masked as a dash');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
