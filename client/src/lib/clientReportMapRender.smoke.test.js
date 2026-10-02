import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// The client share map renders the LIVE bundle against FROZEN points — reports already sent
// included. An ungated status list would add a "Not a target voter" chip to every survey campaign's
// share map on the deploy day. The chip is gated on presence (the public wire carries no campaign
// settings); the door itself is drawn and counted either way.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-'));
const PATH = '/public/reports/r1/map';

test('ClientReportMap: a Not a target voter chip only when the report has such a door', async () => {
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import ClientReportMap from '${join(here, '../components/ClientReportMap.jsx')}';
     globalThis.fetch = () => new Promise(() => {});
     export const render = (households) => {
       const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
       qc.setQueryData(['client-report-map', '${PATH}', null], { households });
       // A ready token, or the component stops at "Loading map…" before the sidebar renders. The
       // map itself only constructs in an effect, which SSR never runs.
       qc.setQueryData(['mapbox-token', '/admin/config/mapbox-token', null], { isReady: true, token: 'pk.test' });
       return renderToString(
         <QueryClientProvider client={qc}>
           <ClientReportMap mapDataPath="${PATH}" campaignType="survey" />
         </QueryClientProvider>
       );
     };`
  );
  const out = join(dir, 'bundle.mjs');
  await esbuild.build({
    entryPoints: [join(dir, 'entry.jsx')],
    bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic', logLevel: 'silent',
    packages: 'external',
    plugins: [
      {
        // node cannot import .css; the styles are irrelevant to a render smoke (pinFixes recipe).
        name: 'stub-css',
        setup(b) {
          b.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'css-stub' }));
          b.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: '', loader: 'js' }));
        },
      },
    ],
  });
  try {
    const { render } = await import(pathToFileURL(out).href);
    const pt = (id, status) => ({ _id: id, status, lng: -84.3, lat: 33.7, addressLine1: `${id} Elm`, answers: [] });

    const without = render([pt('a', 'surveyed'), pt('b', 'refused')]);
    assert.match(without, /2 of 2 doors knocked/, 'the map rendered its sidebar');
    assert.ok(!without.includes('Not a target voter'), 'no chip on a report without such a door');

    const withOne = render([pt('a', 'surveyed'), pt('b', 'not_target')]);
    assert.match(withOne, /2 of 2 doors knocked/, 'the door is drawn and counted');
    assert.ok(withOne.includes('Not a target voter'), 'and the chip appears');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
