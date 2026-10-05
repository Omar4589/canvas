import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import { ACCURACY_CIRCLE_CAPTION, formatDistanceImperial as ft } from './flags.js';
import { RINGS_WITHHELD_NOTE } from './accuracyRing.js';

// RENDER smoke for the map's flag and ping panels and the Audit flag cards (docs/PROPOSAL_GPS_UPGRADES.md
// §H.1), on the billingRender recipe: "far" and its red follow the audit's own verdict, never the raw
// distance; the accuracy line says what is left after allowing for the phone's radius; the pin line
// says when the house pin is approximate; and the map sidebar says when the circles are withheld.

const here = fileURLToPath(new URL('.', import.meta.url));

const build = async () => {
  const dir = mkdtempSync(join(here, '../../.smoke-'));
  writeFileSync(
    join(dir, 'authStub.jsx'),
    `export const useAuth = () => ({ homePath: '/', isLead: false, isOrgAdmin: true, isSuperAdmin: false, user: { id: 'u1' } });
     export const useOrgTimeZone = () => 'America/Chicago';`
  );
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { MemoryRouter } from 'react-router-dom';
     import FlaggedEntryPanel from '${join(here, '../components/FlaggedEntryPanel.jsx')}';
     import CanvasserPingPanel from '${join(here, '../components/CanvasserPingPanel.jsx')}';
     import FlaggedEntryList from '${join(here, '../components/FlaggedEntryList.jsx')}';
     import MapFilters from '${join(here, '../components/MapFilters.jsx')}';
     import { STATUS_COLORS, STATUS_LABELS } from '${join(here, 'statusColors.js')}';
     export const flagPanel = (entry) => renderToString(<FlaggedEntryPanel entry={entry} onClose={() => {}} />);
     export const pingPanel = (activity) => renderToString(<CanvasserPingPanel activity={activity} onClose={() => {}} />);
     export const filters = (props) =>
       renderToString(
         <MapFilters statusColors={STATUS_COLORS} statusLabels={STATUS_LABELS} statusFilter={[]} onStatusChange={() => {}} onCanvasserChange={() => {}} onAnswerChange={() => {}} {...props} />
       );
     export const flagList = (entries) =>
       renderToString(
         <MemoryRouter>
           <FlaggedEntryList entries={entries} tz="America/Chicago" campaignId="c1" />
         </MemoryRouter>
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

// The page's words, without tags, comments or entities.
const text = (html) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
const RED = 'mt-1 font-medium text-danger';
const house = (extra = {}) => ({ id: 'h1', addressLine1: '12 Elm St', city: 'Louisville', state: 'KY', zipCode: '40202', ...extra });
const flag = (extra) => ({ actionId: 'a1', userId: 'u2', actionType: 'not_home', timestamp: '2026-10-01T15:00:00Z', canvasser: { name: 'Sam' }, review: { status: 'open' }, ...extra });
const far = (severity, detail) => ({ type: 'far', severity, detail });

test('flag panel: a medium far is red, with what is left after the radius and the circle caption', async () => {
  const { flagPanel } = await bundle();
  const html = flagPanel(flag({ distanceFromHouseMeters: 300, location: { lat: 38.2, lng: -85.7, accuracy: 40 }, reasons: [far('med', { meters: 300, effectiveMeters: 260, accuracy: 40 })], household: house() }));
  const t = text(html);
  assert.ok(html.includes(RED));
  assert.ok(t.includes(`${ft(300)} from house — far`));
  assert.ok(t.includes(`${ft(260)} after allowing for GPS accuracy (±${ft(40)})`));
  assert.ok(t.includes(ACCURACY_CIRCLE_CAPTION));
  assert.ok(!t.includes('House pin is approximate'), 'an exact pin gets no pin line');
});

test('flag panel: a Weak GPS flag 394 ft out with a ±492 ft fix is not far, and says why', async () => {
  const { flagPanel } = await bundle();
  const html = flagPanel(flag({ distanceFromHouseMeters: 120, location: { lat: 38.2, lng: -85.7, accuracy: 150 }, reasons: [{ type: 'weak_gps', severity: 'low', detail: { accuracy: 150 } }] }));
  const t = text(html);
  assert.ok(!html.includes(RED));
  assert.ok(t.includes(`${ft(120)} from house`) && !t.includes('— far'));
  assert.ok(t.includes(`Too imprecise to judge the distance (±${ft(150)})`));
});

test('flag panel: a far the pin correction lowered reads "far, flagged low", not red, and says why', async () => {
  const { flagPanel } = await bundle();
  const html = flagPanel(flag({
    distanceFromHouseMeters: 300,
    location: { lat: 38.2, lng: -85.7, accuracy: 20 },
    reasons: [far('low', { meters: 300, effectiveMeters: 280, accuracy: 20, pinDowngraded: true, pinCorrectedMeters: 20, pinCorrectedAt: '2026-09-01T00:00:00Z' })],
  }));
  const t = text(html);
  assert.ok(!html.includes(RED));
  assert.ok(t.includes(`${ft(300)} from the pin at the time — far, flagged low`));
  assert.ok(t.includes(`${ft(20)} from the pin's current spot`));
  assert.ok(t.includes('The pin was corrected to a spot this entry sits next to — flagged low for reference.'));
});

test('flag panel: the pin line for an approximate, a confirmed and a corrected pin', async () => {
  const { flagPanel } = await bundle();
  const at = (household) => text(flagPanel(flag({ distanceFromHouseMeters: 20, location: { lat: 38.2, lng: -85.7, accuracy: 10 }, reasons: [], household })));
  assert.ok(at(house({ coordConfidence: 'interpolated' })).includes('House pin is approximate (placed by address lookup) — check the pin before asking the canvasser.'));
  assert.ok(at(house({ coordConfidence: 'interpolated', locationConfirmedAt: '2026-09-15T17:00:00Z' })).includes('House pin is approximate but was confirmed in place on Sep 15, 2026.'));
  assert.ok(!at(house({ coordConfidence: 'interpolated', coordSource: 'corrected' })).includes('House pin'), 'a corrected pin is no longer approximate');
});

test('flag panel: a ±400 m fix is too wide to draw, so no circle caption; no usable radius, no accuracy line', async () => {
  const { flagPanel } = await bundle();
  const wide = text(flagPanel(flag({ distanceFromHouseMeters: 30, location: { lat: 38.2, lng: -85.7, accuracy: 400 }, reasons: [] })));
  assert.ok(wide.includes(`GPS accuracy ±${ft(400)}`));
  assert.ok(wide.includes('Too wide to draw on the map'));
  assert.ok(!wide.includes(ACCURACY_CIRCLE_CAPTION));
  for (const accuracy of [0, -1, null]) {
    const t = text(flagPanel(flag({ distanceFromHouseMeters: 30, location: { lat: 38.2, lng: -85.7, accuracy }, reasons: [] })));
    assert.ok(!t.includes('GPS accuracy') && !t.includes(ACCURACY_CIRCLE_CAPTION), String(accuracy));
  }
});

const ping = (extra) => ({ id: 'p1', actionType: 'not_home', timestamp: '2026-10-01T15:00:00Z', distanceFromHouseMeters: 300, location: { lat: 38.2, lng: -85.7, accuracy: 10 }, ...extra });

test("ping panel: the server's verdict wins; without one, the audit's arithmetic decides", async () => {
  const { pingPanel } = await bundle();
  const cleared = pingPanel(ping({ far: null }));
  assert.ok(!cleared.includes(RED) && !text(cleared).includes('— far'), 'the audit did not flag it: not far, whatever the raw distance');
  const legacy = pingPanel(ping({}));
  assert.ok(legacy.includes(RED) && text(legacy).includes(`${ft(300)} from house — far`), 'an older payload: 300 m less 10 m is far');
  const near = text(pingPanel(ping({ distanceFromHouseMeters: 120, location: { lat: 38.2, lng: -85.7, accuracy: 60 } })));
  assert.ok(!near.includes('— far') && near.includes(`Not far after allowing for GPS accuracy (±${ft(60)})`));
  const self = text(pingPanel(ping({ far: far('high', { meters: 300, effectiveMeters: 290, accuracy: 10, pinMovedBySelf: true, pinCorrectedMeters: 280, pinCorrectedAt: '2026-09-01T00:00:00Z' }) })));
  assert.ok(self.includes(`${ft(300)} from the pin at the time — far`));
  assert.ok(self.includes('The person who recorded this door also moved the pin — kept at full severity for review.'));
});

test('flag cards: a Weak GPS badge carries the raw distance; the pin line shows under the house', async () => {
  const { flagList } = await bundle();
  const weak = { type: 'weak_gps', severity: 'low', detail: { accuracy: 150 } };
  const t = text(flagList([flag({ distanceFromHouseMeters: 120, reasons: [weak], household: house({ coordConfidence: 'interpolated' }) })]));
  assert.ok(t.includes(`GPS ±${ft(150)} · ${ft(120)} from house`));
  assert.ok(t.includes('House pin is approximate (placed by address lookup)'));
  const both = text(flagList([flag({ distanceFromHouseMeters: 300, reasons: [far('med', { meters: 300, effectiveMeters: 150, accuracy: 150 }), weak], household: house() })]));
  assert.ok(!both.includes(`GPS ±${ft(150)} · ${ft(300)} from house`), 'a far badge already prints the distance');
});

test('map sidebar: the withheld note shows only while circles are withheld, under whichever layer is on', async () => {
  const { filters } = await bundle();
  const note = (props) => text(filters(props)).includes(RINGS_WITHHELD_NOTE);
  assert.ok(note({ showCanvasserPins: true, accuracyRingsWithheld: true }), 'under the pings toggle');
  assert.ok(note({ showFlags: true, accuracyRingsWithheld: true }), 'under the flags toggle when pings are off');
  assert.ok(!note({ showCanvasserPins: true, accuracyRingsWithheld: false }));
  assert.ok(!note({ accuracyRingsWithheld: true }), 'no layer on, no circles, no note');
  assert.strictEqual(text(filters({ showCanvasserPins: true, showFlags: true, accuracyRingsWithheld: true })).split(RINGS_WITHHELD_NOTE).length - 1, 1, 'both layers on: said once');
  assert.ok(text(filters({})).includes("Zoom in and each dot shows a faint circle: the phone's own accuracy estimate, a guide, not a boundary."));
});
