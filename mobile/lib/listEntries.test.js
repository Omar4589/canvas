import { test } from 'node:test';
import assert from 'node:assert';
import { buildListEntries, NO_SPOT_SECTION } from './listEntries.js';
import { groupBuildings } from './buildings.js';

// The canvasser list view (placeholder pins, release 2): homes with no exact map spot show no distance and
// sort into their own section under "Nearest"; a spot of different homes is one row filed by its lowest house
// number; a real building keeps its distance even with a stray on its spot.
const at = (id, line1, coords, extra = {}) => ({
  _id: id,
  addressLine1: line1,
  location: { type: 'Point', coordinates: coords },
  status: 'unknocked',
  ...extra,
});
const SHARED = [-116.0, 36.2];
const doors = [
  at('near', '4880 E Monte Penne Way', [-116.0001, 36.2001], { walkOrder: 1 }),
  at('far', '4896 E Monte Penne Way', [-116.01, 36.21], { walkOrder: 2 }),
  at('h1', '5021 E Monte Penne Way', SHARED, { pinSuspect: 'placeholder', walkOrder: 3 }),
  at('h2', '4906 E Monte Penne Way', SHARED, { pinSuspect: 'placeholder', walkOrder: 4, status: 'surveyed' }),
  at('lone', '5100 Calvada Blvd', [-116.05, 36.25], { pinSuspect: 'placeholder', walkOrder: 5 }),
  at('b1', '100 Main St Apt 1', [-116.02, 36.22], { walkOrder: 6 }),
  at('b2', '100 Main St Apt 2', [-116.02, 36.22], { walkOrder: 7 }),
  at('stray', '12 Pine St', [-116.02, 36.22], { pinSuspect: 'stray', walkOrder: 8 }),
];
const { singles, buildings } = groupBuildings(doors);
const me = [-116.0, 36.2];

test('Nearest: placed homes by distance, then a No exact map spot section', () => {
  const rows = buildListEntries({ singles, buildings, userCoords: me, sortMode: 'nearest' });
  const kinds = rows.map((r) => (r.kind === 'section' ? `§${r.title}` : r.key));
  const section = kinds.indexOf(`§${NO_SPOT_SECTION}`);
  assert.ok(section > 0, 'the section exists');
  const placed = rows.slice(0, section);
  const noSpot = rows.slice(section + 1);
  assert.ok(placed.every((r) => r.distanceM != null), 'placed rows carry a distance');
  assert.ok(noSpot.every((r) => r.distanceM == null), 'no-spot rows carry none');
  assert.deepEqual(noSpot.map((r) => r.kind), ['homes', 'single'], 'the homes row and the lone home');
  // The building with a stray keeps its distance.
  assert.ok(placed.some((r) => r.kind === 'building'));
  assert.equal(placed[0].key, 'near');
});

test('Address A-Z: the homes row files under its lowest house number, among the numbered homes', () => {
  const rows = buildListEntries({ singles, buildings, sortMode: 'address' });
  const homes = rows.find((r) => r.kind === 'homes');
  assert.equal(homes._addr, '4906 E Monte Penne Way');
  const order = rows.map((r) => (r.kind === 'single' ? r.household.addressLine1 : r._addr));
  assert.ok(order.indexOf('4896 E Monte Penne Way') < order.indexOf('4906 E Monte Penne Way'));
  assert.ok(order.indexOf('4906 E Monte Penne Way') < order.indexOf('5100 Calvada Blvd'));
  assert.ok(!rows.some((r) => r.kind === 'section'), 'no section outside Nearest');
});

test('no GPS fix: Nearest falls back to walk order, no section; filters still apply', () => {
  const rows = buildListEntries({ singles, buildings, userCoords: null, sortMode: 'nearest' });
  assert.ok(!rows.some((r) => r.kind === 'section'));
  assert.equal(rows[0].key, 'near');
  const surveyedOnly = buildListEntries({ singles, buildings, sortMode: 'walk', activeFilters: new Set(['surveyed']) });
  assert.deepEqual(surveyedOnly.map((r) => r.kind), ['homes'], 'a stack shows when any member matches');
});
