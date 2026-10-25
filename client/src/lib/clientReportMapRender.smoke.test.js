import { test, after } from 'node:test';
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
after(() => rmSync(dir, { recursive: true, force: true }));
const PATH = '/public/reports/r1/map';

// node cannot import .css; the styles are irrelevant to a render smoke (pinFixes recipe).
const stubCss = {
  name: 'stub-css',
  setup(b) {
    b.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'css-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: '', loader: 'js' }));
  },
};

test('ClientReportMap: a Not a target voter chip only when the report has such a door', async () => {
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import ClientReportMap from '${join(here, '../components/ClientReportMap.jsx')}';
     globalThis.fetch = () => new Promise(() => {});
     // The compact pins payload (§F11): columnar arrays, positions = rows, statuses by index.
     const STATUS_KEYS = ['surveyed', 'lit_dropped', 'refused', 'not_target', 'not_home', 'wrong_address', 'no_soliciting', 'restricted'];
     const payloadOf = (households) => ({
       mode: 'pins', snapshotKey: 'k1', count: households.length, statusKeys: STATUS_KEYS,
       lng: households.map((h) => h.lng), lat: households.map((h) => h.lat),
       status: households.map((h) => STATUS_KEYS.indexOf(h.status)), questions: [], answers: {}, extent: null,
     });
     export const render = (households) => {
       const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
       // [kind, path, share token, map version] — the builder's preview passes neither.
       qc.setQueryData(['client-report-map', '${PATH}', null, null], payloadOf(households));
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
    plugins: [stubCss],
  });
  const { render } = await import(pathToFileURL(out).href);
  const pt = (id, status) => ({ _id: id, status, lng: -84.3, lat: 33.7, addressLine1: `${id} Elm`, answers: [] });

  const without = render([pt('a', 'surveyed'), pt('b', 'refused')]);
  assert.match(without, /2 of 2 doors/, 'the map rendered its sidebar');
  assert.ok(!without.includes('Not a target voter'), 'no chip on a report without such a door');

  const withOne = render([pt('a', 'surveyed'), pt('b', 'not_target')]);
  assert.match(withOne, /2 of 2 doors/, 'the door is drawn and counted');
  assert.ok(withOne.includes('Not a target voter'), 'and the chip appears');
});

// The map version (contract C7, PUBUX-1) and the tapped-doors panel's wording (PUBUX-5).
test('the map version keys the map data and the door lookups; a tap on several spots reads "near here"', async () => {
  writeFileSync(
    join(dir, 'entry-version.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import ClientReportMap, { DoorDetails } from '${join(here, '../components/ClientReportMap.jsx')}';
     import { decodePins } from '${join(here, './reportMapData.js')}';
     globalThis.fetch = () => new Promise(() => {});
     const STATUS_KEYS = ['surveyed', 'refused', 'not_home'];
     // Three doors: two share a spot (one building), the third stands a block away.
     export const payload = {
       mode: 'pins', snapshotKey: 'k1', count: 3, statusKeys: STATUS_KEYS,
       lng: [-84.3, -84.3, -84.302], lat: [33.7, 33.7, 33.701], status: [0, 1, 2],
       questions: [{ key: 'support', label: 'Support?', options: ['Yes', 'No'] }], answers: { support: [0, 1, null] }, extent: null,
     };
     const SHARE = '/share/T/reports/r1/map';
     const wrap = (qc, node) => renderToString(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
     const newQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
     export const map = (mapVersion, seededVersion) => {
       const qc = newQc();
       qc.setQueryData(['mapbox-token', '/share/T/mapbox-token', 'jwt'], { isReady: true, token: 'pk.test' });
       qc.setQueryData(['client-report-map', SHARE, 'jwt', seededVersion], payload);
       return wrap(qc, <ClientReportMap mapPath={SHARE} tokenPath="/share/T/mapbox-token" campaignType="survey" mapVersion={mapVersion} requestOpts={{ public: true, shareToken: 'jwt' }} />);
     };
     export const doors = ({ rows, spots, mapVersion, seededVersion, addresses }) => {
       const qc = newQc();
       qc.setQueryData(['client-report-doors', SHARE + '/doors', 'jwt', seededVersion, 'k1', rows.join(',')], {
         doors: rows.map((row, i) => ({ row, status: STATUS_KEYS[row], addressLine1: addresses[i], city: 'Tampa', state: 'FL', answers: [] })),
       });
       return wrap(qc, <DoorDetails pins={decodePins(payload, 'survey')} rows={rows} spots={spots} mapVersion={mapVersion} doorsPath={SHARE + '/doors'} requestOpts={{ public: true, shareToken: 'jwt' }} campaignType="survey" onClose={() => {}} />);
     };`
  );
  const out = join(dir, 'bundle-version.mjs');
  await esbuild.build({
    entryPoints: [join(dir, 'entry-version.jsx')],
    bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic', logLevel: 'silent',
    packages: 'external',
    plugins: [stubCss],
  });
  const m = await import(pathToFileURL(out).href);
  const text = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // The report's version is part of the map data's key: the payload cached under it is the map …
  assert.match(m.map('v1', 'v1'), /3 of 3 doors/);
  assert.match(text(m.map('v1', 'v1')), /Support\? Yes 1 No 1/, 'with its question');
  // … and a report re-fetched with a new version doesn't show the old payload: it loads the map again.
  const moved = m.map('v2', 'v1');
  assert.match(moved, /Loading doors…/);
  assert.doesNotMatch(moved, /of 3 doors/);

  // The door lookups carry it too: a question taken off keeps the snapshot key, and a door looked up
  // under the old version must not keep showing its answer.
  const same = text(m.doors({ rows: [0, 1], spots: 1, mapVersion: 'v1', seededVersion: 'v1', addresses: ['1 Elm St', '1 Elm St'] }));
  assert.match(same, /1 Elm St/);
  const stale = text(m.doors({ rows: [0, 1], spots: 1, mapVersion: 'v2', seededVersion: 'v1', addresses: ['1 Elm St', '1 Elm St'] }));
  assert.doesNotMatch(stale, /1 Elm St/);
  assert.match(stale, /Loading address…/);

  // One spot holding several doors: a building.
  assert.match(same, /2 doors here — an apartment building or several homes sharing one map spot\./);
  assert.doesNotMatch(same, /near here/);
  const building = text(m.doors({ rows: [0, 1], spots: 1, mapVersion: 'v1', seededVersion: 'v1', addresses: ['1 Elm St Apt 1', '1 Elm St Apt 2'] }));
  assert.match(building, /^ ?2 doors at one spot/, 'differing addresses at one spot: titled by the spot');
  // A tap that caught several spots: neighbours, never "one spot".
  const near = text(m.doors({ rows: [0, 1, 2], spots: 2, mapVersion: 'v1', seededVersion: 'v1', addresses: ['1 Elm St', '1 Elm St', '9 Oak Ave'] }));
  assert.match(near, /^ ?3 doors near here/, near);
  assert.match(near, /3 doors near here — zoom in to pick one\./);
  assert.doesNotMatch(near, /one spot|apartment building/);
  assert.match(near, /9 Oak Ave/, 'each door names its address');
});

// WALK-10: the map's keyboard path is told to a screen reader, and WALK-1: the area legend's swatches
// are the hexagons' colours as seen on the map. (Enter, Escape and the centre mark are effects and
// events, driven in a real browser: SP/cr2fix/ux.)
test('the map describes its keyboard path to a screen reader; an area legend swatch is the seen colour', async () => {
  writeFileSync(
    join(dir, 'entry-keys.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import ClientReportMap from '${join(here, '../components/ClientReportMap.jsx')}';
     globalThis.fetch = () => new Promise(() => {});
     const SHARE = '/share/T/reports/r1/map';
     const ring = (x, y) => [[x, y], [x + 0.01, y], [x + 0.01, y + 0.01], [x, y + 0.01], [x, y]];
     export const render = (mode) => {
       const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
       qc.setQueryData(['mapbox-token', '/share/T/mapbox-token', 'jwt'], { isReady: true, token: 'pk.test' });
       if (mode === 'area') {
         qc.setQueryData(['client-report-areas', '/share/T/reports/r1/areas', 'jwt', 'v1'], {
           mode: 'area', snapshotKey: 'k1', areaSize: 'small', extent: null, questions: [],
           cells: [{ h3: 'a', boundary: ring(-84.3, 33.7), doors: 3, byStatus: { surveyed: 3 }, answers: [] }],
         });
       } else {
         qc.setQueryData(['client-report-map', SHARE, 'jwt', 'v1'], {
           mode: 'pins', snapshotKey: 'k1', count: 1, statusKeys: ['surveyed'], lng: [-84.3], lat: [33.7], status: [0], questions: [], answers: {}, extent: null,
         });
       }
       return renderToString(
         <QueryClientProvider client={qc}>
           <ClientReportMap mapPath={SHARE} tokenPath="/share/T/mapbox-token" mapMode={mode} campaignType="survey" mapVersion="v1" requestOpts={{ public: true, shareToken: 'jwt' }} />
         </QueryClientProvider>
       );
     };`
  );
  const out = join(dir, 'bundle-keys.mjs');
  await esbuild.build({
    entryPoints: [join(dir, 'entry-keys.jsx')],
    bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic', logLevel: 'silent',
    packages: 'external',
    plugins: [stubCss],
  });
  const { render } = await import(pathToFileURL(out).href);
  const pins = render('pins').replace(/<!-- -->/g, '');
  const hint = pins.match(/<p id="([^"]+)" class="sr-only">([^<]+)<\/p>/);
  assert.ok(hint, 'a hidden description the canvas points at (aria-describedby, set when the map is made)');
  assert.equal(hint[2], 'Use the arrow keys to move the map, and plus or minus to zoom. Press Enter to show the doors at the centre of the map, and Escape to close them.');
  assert.match(pins, /<p class="sr-only" aria-live="polite"><\/p>/, 'a polite live line, empty until something happens');
  assert.doesNotMatch(pins, /border-brand-600 ring-2 ring-card/, 'no centre mark until the map has keyboard focus');

  const area = render('area').replace(/<!-- -->/g, '');
  assert.match(area, /Press Enter to show the area at the centre of the map, and Escape to close it\./);
  // One class (3 doors): #2a78d6 seen at 0.62 over the light fallback ground #f2f2f2 — 42·0.62 + 242·0.38
  // = 118, 120·0.62 + 242·0.38 = 166, 214·0.62 + 242·0.38 = 225 — not the full colour.
  const swatches = [...area.matchAll(/rounded-sm" style="background-color:(#[0-9a-f]{6})"/g)].map((x) => x[1]);
  assert.deepEqual(swatches, ['#76a6e1']);
});
