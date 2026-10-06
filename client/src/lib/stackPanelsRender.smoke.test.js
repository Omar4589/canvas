import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke for the Map page's stack panel and door panel (placeholder pins, release 2), on the
// flagPanelsRender recipe: a spot of different homes reads "N homes at one map spot" with the homes grouped by
// street address and a Move pin each; a click that hit houses a metre apart reads "N doors near here"; a real
// building keeps its list; the door panel shows the badge chain and the placement line.

const here = fileURLToPath(new URL('.', import.meta.url));

const build = async () => {
  const dir = mkdtempSync(join(here, '../../.smoke-'));
  writeFileSync(
    join(dir, 'authStub.jsx'),
    `export const useAuth = () => ({ homePath: '/', isLead: false, isOrgAdmin: true, isSuperAdmin: false, user: { id: 'u1' } });
     export const useOrgTimeZone = () => 'America/Los_Angeles';`
  );
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import DoorStackPanel from '${join(here, '../components/DoorStackPanel.jsx')}';
     import HouseholdDetailPanel from '${join(here, '../components/HouseholdDetailPanel.jsx')}';
     import { STATUS_COLORS, STATUS_LABELS } from '${join(here, 'statusColors.js')}';
     // Queries stay LOADING (never settle): pending promises do not hold the event loop open.
     globalThis.fetch = () => new Promise(() => {});
     export const stack = (doors, extra = {}) =>
       renderToString(
         <DoorStackPanel doors={doors} onSelect={() => {}} onClose={() => {}} onMovePin={() => {}} statusColors={STATUS_COLORS} statusLabels={STATUS_LABELS} tz="America/Los_Angeles" {...extra} />
       );
     export const door = (household) =>
       renderToString(
         <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
           <HouseholdDetailPanel household={household} campaignId="c1" onClose={() => {}} onMovePin={() => {}} statusColors={STATUS_COLORS} statusLabels={STATUS_LABELS} tz="America/Los_Angeles" />
         </QueryClientProvider>
       );`
  );
  const out = join(dir, 'bundle.mjs');
  try {
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
    return await import(pathToFileURL(out).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
let built;
const bundle = () => (built ??= build());

const text = (html) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
const d = (id, line1, extra = {}) => ({
  id,
  addressLine1: line1,
  city: 'Pahrump',
  state: 'NV',
  zipCode: '89061',
  location: { lng: -116.0, lat: 36.2 },
  status: 'unknocked',
  surveys: [],
  voters: [],
  ...extra,
});

test('a spot of different homes: N homes at one map spot, grouped by address, each with Move pin', async () => {
  const { stack } = await bundle();
  const t = text(
    stack([
      d('m', '5016 E Monte Penne Way', { pinSuspect: 'placeholder' }),
      d('n', '5021 E Monte Penne Way', { pinSuspect: 'placeholder' }),
      d('a1', '100 Main St', { addressLine2: 'Apt 1', pinSuspect: 'placeholder' }),
      d('a2', '100 Main St', { addressLine2: 'Apt 2', pinSuspect: 'placeholder' }),
    ])
  );
  assert.ok(t.includes('4 homes at one map spot'));
  assert.ok(t.includes('These are different homes that share one map spot.'));
  assert.ok(t.includes('100 Main St · 2 units'), 'one address, its units together');
  assert.ok(t.includes('5016 E Monte Penne Way'));
  assert.equal((t.match(/Move pin/g) || []).length, 4, 'a Move pin per home');
});

test('a click on houses a metre apart: N doors near here; a building keeps its plain list', async () => {
  const { stack } = await bundle();
  const near = text(stack([d('x', '1 A St'), d('y', '3 B St')], { near: true }));
  assert.ok(near.includes('2 doors near here'));
  assert.ok(!near.includes('Move pin'));
  const tower = text(stack([d('t1', '100 Main St Apt 1'), d('t2', '100 Main St Apt 2')]));
  assert.ok(tower.includes('These doors are all pinned to the same spot'));
  assert.ok(!tower.includes('homes at one map spot'));
  assert.ok(!tower.includes('Move pin'));
});

test('the door panel: the badge chain and the placement line', async () => {
  const { door } = await bundle();
  const unplaced = text(door(d('u', '5016 E Monte Penne Way', { pinSuspect: 'stray', coordConfidence: 'interpolated' })));
  assert.ok(unplaced.includes('No exact map spot'));
  assert.ok(unplaced.includes('its coordinate was shared with other addresses'));
  assert.ok(!unplaced.includes('Approximate location'), 'the first badge that applies wins');
  const placed = text(door(d('p', '20 Oak St', { coordSource: 'geocodio', pinPlaced: { at: '2026-10-05T18:30:00Z', inPlace: false, stackSize: 4 } })));
  assert.ok(placed.includes('Placed by address (Oct 5). Its earlier spot was shared with 4 other homes.'));
  const confirmed = text(door(d('c', '30 Elm St', { locationConfirmedAt: '2026-10-05T18:30:00Z', coordSource: 'file' })));
  assert.ok(confirmed.includes('Location confirmed'));
});
