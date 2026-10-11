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

// The page reads the org's time zone for its dates (useOrgTimeZone); SSR has no session, so the auth hooks
// are stubbed, the doorOutcomesRender way — everything else is the real page.
const AUTH_STUB = `export const useAuth = () => ({ homePath: '/', isOrgAdmin: true, isSuperAdmin: false, user: { id: 'u1' } });
     export const useOrgTimeZone = () => 'America/New_York';`;
const stubAuth = (stubDir) => ({
  name: 'stub-auth',
  setup(b) {
    b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(stubDir, 'authStub.jsx') }));
  },
});
const stubCss = {
  name: 'stub-css',
  setup(b) {
    b.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'css-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: '', loader: 'js' }));
  },
};

test('PinFixesPage renders its queue shell under a loading fetch', async () => {
  writeFileSync(join(dir, 'authStub.jsx'), AUTH_STUB);
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
      stubAuth(dir),
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

// The pin-fixes build (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S10.2–S10.3): with the queue loaded, the
// "Fix together" cards render one per cause with their actions, the complexes as rows, the set-aside list,
// and the header counts the complexes; the Place along the street rail renders its sentence and buttons.
test('PinFixesPage renders the cause cards from a loaded queue, and the placing rail', async () => {
  const dir2 = mkdtempSync(join(here, '../../.smoke-'));
  writeFileSync(join(dir2, 'authStub.jsx'), AUTH_STUB);
  writeFileSync(
    join(dir2, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { MemoryRouter, Routes, Route } from 'react-router-dom';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import PinFixesPage from '${join(here, '../pages/PinFixesPage.jsx')}';
     import PlaceAlongRail from '${join(here, '../components/PlaceAlongRail.jsx')}';
     import { placeAtCopy } from '${join(here, './movePin.js')}';
     globalThis.fetch = () => new Promise(() => {});
     const id = '6a0000000000000000000001';
     const door = (i, line, extra = {}) => ({
       id: 'd' + i, addressLine1: line, addressLine2: null, city: 'Fairfield', state: 'CT', zipCode: '06824',
       location: { lng: -73.25 - i / 1000, lat: 41.15 }, status: 'unknocked', ...extra,
     });
     const members = [
       door(10, '10 Rowayton Woods Dr', { pinSuspect: 'complex', location: { lng: -73.43, lat: 41.08 } }),
       door(11, '11 Rowayton Woods Dr', { pinSuspect: 'complex', location: { lng: -73.43, lat: 41.08 } }),
     ];
     const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
     qc.setQueryData(['config', 'mapbox-token'], { isReady: true, token: 'pk.test' });
     qc.setQueryData(['admin', 'pin-fixes', id], {
       households: [
         door(1, '1 Foxboro Dr', { pinSuspect: 'placeholder', location: { lng: -73.4, lat: 41.1 } }),
         door(2, '3 Foxboro Dr', { pinSuspect: 'placeholder', location: { lng: -73.4, lat: 41.1 } }),
         door(3, '9 Oak St', { pinSuspect: 'far' }),
         door(4, 'Fairfield University No Know', { pinSuspect: 'unlocated', location: { lng: 0, lat: 0 } }),
         door(5, '4 Fir St', { coordConfidence: 'interpolated' }),
       ],
       total: 5,
       truncated: false,
       complexes: [{ key: 'K1', lng: -73.43, lat: 41.08, count: 2, streets: ['Rowayton Woods Dr'], rows: members }],
       complexCount: 1,
       setAside: [door(6, '5151 Park Ave', { setAside: true, pinSuspect: 'unlocated' })],
       truncatedExtra: false,
     });
     export const pageHtml = renderToString(
       <QueryClientProvider client={qc}>
         <MemoryRouter initialEntries={['/campaigns/' + id + '/pin-fixes']}>
           <Routes>
             <Route path="/campaigns/:campaignId/pin-fixes" element={<PinFixesPage />} />
           </Routes>
         </MemoryRouter>
       </QueryClientProvider>
     );
     const rows = [
       { rowKey: 'h:a', label: '1 Foxboro Dr', sub: 'No exact map spot', street: 'Foxboro Dr' },
       { rowKey: 'h:b', label: '3 Foxboro Dr', sub: 'No exact map spot', street: 'Foxboro Dr' },
     ];
     export const railHtml = renderToString(
       <PlaceAlongRail
         placeMode={{ title: 'Share one spot', rows, index: 1, placed: ['h:a'] }}
         copy={placeAtCopy({ scope: 'unit', addressLine1: '3 Foxboro Dr' })}
         onSkip={() => {}} onBack={() => {}} onExit={() => {}} onPick={() => {}} onResume={() => {}}
       />
     );
     export const doneHtml = renderToString(
       <PlaceAlongRail placeMode={{ title: 'x', rows, index: 2, placed: ['h:a'] }} copy={null} />
     );`
  );
  const out = join(dir2, 'bundle.mjs');
  await esbuild.build({
    entryPoints: [join(dir2, 'entry.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    jsx: 'automatic',
    logLevel: 'silent',
    packages: 'external',
    plugins: [stubCss, stubAuth(dir2)],
  });
  try {
    const { pageHtml, railHtml, doneHtml } = await import(pathToFileURL(out).href);
    const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    const page = text(pageHtml);
    assert.match(page, /5 doors to review · 1 complex/);
    assert.match(page, /Fix together/);
    for (const title of ['Share one spot with other addresses', 'Pinned far from their street', "Couldn't be found by address", 'Complexes', 'Placed on the street, not the house']) {
      assert.ok(page.includes(title), title);
    }
    assert.match(page, /Look up by address/);
    assert.match(page, /Place along the street/);
    assert.match(page, /Set aside…/);
    assert.match(page, /Start checking/);
    assert.match(page, /Rowayton Woods Dr — 2 homes/);
    assert.match(page, /Set aside \( ?1 ?\)/);
    assert.match(page, /Foxboro Dr \(2\)/, 'the busiest street on the shared card');
    const rail = text(railHtml);
    assert.match(rail, /Placing · Foxboro Dr · 2 of 2/);
    assert.match(rail, /Click the roof of 3 Foxboro Dr ?\./); // SSR splits the bold address into its own text node
    assert.match(rail, /Back/);
    assert.match(rail, /Skip/);
    assert.match(rail, /Exit/);
    const done = text(doneHtml);
    assert.match(done, /All done/);
    assert.match(done, /1 placed · 1 skipped/);
  } finally {
    rmSync(dir2, { recursive: true, force: true });
  }
});
