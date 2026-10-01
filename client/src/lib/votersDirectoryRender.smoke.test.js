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
// A second seed is a FAILED directory query, so the timeout band renders too.

const here = fileURLToPath(new URL('.', import.meta.url));

// The page's initial query key, verbatim — every filter starts '' and skip 0.
const PAGE_KEY =
  "['admin', 'voters', { search: '', campaignId: '', party: '', surveyStatus: '', voted: '', dnc: '', doorAdded: '', skip: 0 }]";

// `seed` is JS that runs inside the bundle against the QueryClient `qc`, before the render.
async function render(seed) {
  // Each test gets its OWN temp dir: a shared one is removed by whichever test finishes first.
  // Inside the client tree on purpose: dependencies stay external to the bundle, so node
  // resolves them from the bundle's own location at import time.
  const dir = mkdtempSync(join(here, '../../.smoke-'));
  try {
    writeFileSync(
      join(dir, 'entry.jsx'),
      `import React from 'react';
       import { renderToString } from 'react-dom/server';
       import { MemoryRouter } from 'react-router-dom';
       import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
       import VotersPage from '${join(here, '../pages/VotersPage.jsx')}';
       globalThis.fetch = () => new Promise(() => {});
       // retryOnMount: false so a seeded FAILURE stays one — with the default, the first render
       // optimistically reports an errored query as pending again, and the band never shows.
       const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
       qc.setQueryData(['admin', 'campaigns'], { campaigns: [] });
       ${seed}
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
    const { html } = await import(pathToFileURL(out).href);
    // React splits adjacent text nodes with <!-- --> markers, which would make an assertion
    // about a rendered SENTENCE depend on where JSX happened to break it.
    return html.replaceAll('<!-- -->', '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A failed directory query, the way api/client.js throws one: status and code stamped on the error.
const seedFailure = (message, status, code) =>
  `qc.getQueryCache().build(qc, { queryKey: ${PAGE_KEY} }).setState({
     status: 'error',
     error: Object.assign(new Error(${JSON.stringify(message)}), { status: ${status}, code: ${JSON.stringify(code)} }),
     errorUpdateCount: 1,
     errorUpdatedAt: Date.now(),
   });`;

test('VotersPage renders a seeded page: door-added badge shown, manual: svid masked', async () => {
  const html = await render(
    `qc.setQueryData(
       ${PAGE_KEY},
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
     );`
  );
  assert.match(html, /Wally Walkup/, 'the seeded rows rendered');
  assert.match(html, /Added at the door/, 'the walk-up badge (and the source filter option) render');
  assert.match(html, /Any source/, 'the new source filter select is present');
  assert.match(html, /FL123/, 'a real state voter id still shows');
  assert.doesNotMatch(html, /manual:6a/, 'the synthetic manual: id never renders — masked as a dash');
});

test('a directory timeout renders the warning band: the server sentence, a Try again, filters still on screen', async () => {
  const html = await render(
    seedFailure('The voter directory took too long to load. Pick a campaign to narrow it, or try again.', 503, 'DIRECTORY_TIMEOUT')
  );
  assert.match(
    html,
    /The voter directory took too long to load\. Pick a campaign to narrow it, or try again\./,
    'the server sentence, verbatim'
  );
  assert.match(html, /Try again/, 'a retry the admin can click');
  assert.match(html, /bg-warning-tint/, 'the Notes-hub warning band, not the danger box');
  assert.doesNotMatch(html, /Error loading voters/);
  assert.match(html, /All campaigns/, 'the filter row stays above the band — "pick a campaign" is one click away');
});

test('any other failure keeps the plain error box, with nothing to retry', async () => {
  const html = await render(seedFailure('Request failed: 503', 503, null));
  assert.match(html, /Error loading voters: Request failed: 503/);
  assert.doesNotMatch(html, /Try again/);
  assert.doesNotMatch(html, /bg-warning-tint/);
});
