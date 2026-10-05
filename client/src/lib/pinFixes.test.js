import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStreetGroups,
  googleMapsUrl,
  confirmToast,
  confirmErrorMessage,
  confirmNeedsRefetch,
  enterAction,
  popupKeyAction,
  popupHint,
  confirmLabel,
  UNPLACED_CONFIRM_PROMPT,
  confirmInvalidationKeys,
  pickSpotRow,
} from './pinFixes.js';

// pinFixes.js is the pure half of the Pin Fixes queue page. Under lock: the street grouping
// (one row per PIN — buildings collapse; streets numeric-aware A→Z; house-number order inside),
// the id → row map the map click handler needs (stacked units included), the Google Maps
// ADDRESS link, the confirm toast/error copy, and the cache contract a confirm stales.

const door = (id, addressLine1, lng, lat, extra = {}) => ({
  id,
  addressLine1,
  city: 'Kissimmee',
  state: 'FL',
  zipCode: '34741',
  status: 'unknocked',
  coordConfidence: 'interpolated',
  location: { lng, lat },
  ...extra,
});

test('street grouping: buildings collapse to one row, streets sort numeric-aware, rows by house number', () => {
  const households = [
    door('a', '12 Oak St', -81.401, 28.301),
    door('b', '2 Oak St', -81.402, 28.302),
    // Two units on ONE pin — a building row, not two door rows.
    door('c', '9 Elm Ave Apt 1', -81.5, 28.4),
    door('d', '9 Elm Ave Apt 2', -81.5, 28.4),
    door('e', '4 2nd St', -81.42, 28.32),
  ];
  const { groups, rowCount, rowKeys, idToRowKey } = buildStreetGroups(households);

  assert.equal(rowCount, 4, '5 doors → 4 rows (the Elm pair is one building row)');
  assert.deepEqual(groups.map((g) => g.street), ['2nd St', 'Elm Ave', 'Oak St'], 'numeric-aware A→Z');
  assert.deepEqual(
    groups.find((g) => g.street === 'Oak St').rows.map((r) => r.label),
    ['2 Oak St', '12 Oak St'],
    'house-number order, not lexicographic'
  );

  const bRow = groups.find((g) => g.street === 'Elm Ave').rows[0];
  assert.equal(bRow.kind, 'building');
  assert.equal(bRow.sub, '2 units at one pin');
  assert.equal(bRow.target.scope, 'building');
  assert.equal(bRow.target.count, 2);
  // The popup lists the building's units — the row must carry the FULL unit set.
  assert.deepEqual(bRow.units.map((u) => u.id), ['c', 'd']);
  // EVERY unit id resolves to the building row — a stacked pin click must find its row.
  assert.equal(idToRowKey.get('c'), bRow.rowKey);
  assert.equal(idToRowKey.get('d'), bRow.rowKey);
  assert.equal(idToRowKey.get('a'), 'h:a');

  // The flattened order Next/Prev and auto-advance walk: street order, house-number order
  // inside — exactly the list as rendered.
  assert.deepEqual(rowKeys, ['h:e', bRow.rowKey, 'h:b', 'h:a']);

  const single = groups.find((g) => g.street === 'Oak St').rows[0];
  assert.equal(single.kind, 'door');
  assert.equal(single.units, null, 'door rows carry no unit list — the shape stays explicit');
  assert.deepEqual(single.target, {
    id: 'b', addressLine1: '2 Oak St', lng: -81.402, lat: 28.302, scope: 'unit', count: 1, unplaced: false,
  });
});

test('street grouping: separate homes on one shared spot get a row each; one address\'s units share one', () => {
  const S = [-115.95, 36.21];
  const flagged = { pinSuspect: 'placeholder' };
  const households = [
    door('m1', '5001 E Monte Penne Way', ...S, flagged),
    door('m2', '5011 E Monte Penne Way', ...S, flagged),
    door('u1', '100 Main St Apt 1', ...S, flagged),
    door('u2', '100 Main St Apt 2', ...S, flagged),
  ];
  const { rowCount, groups, idToRowKey } = buildStreetGroups(households);
  assert.equal(rowCount, 3, 'two houses + one address row');
  const main = groups.find((g) => g.street === 'Main St').rows[0];
  assert.equal(main.kind, 'building');
  assert.equal(main.label, '2 units at 100 Main St');
  assert.equal(main.sub, 'No exact map spot');
  assert.equal(main.unplaced, true);
  assert.equal(main.target.scope, 'building');
  assert.equal(main.target.unplaced, true);
  assert.equal(idToRowKey.get('u2'), main.rowKey);
  const houses = groups.find((g) => g.street === 'E Monte Penne Way').rows;
  assert.deepEqual(houses.map((r) => [r.kind, r.label, r.sub, r.target.scope]), [
    ['door', '5001 E Monte Penne Way', 'No exact map spot', 'unit'],
    ['door', '5011 E Monte Penne Way', 'No exact map spot', 'unit'],
  ]);
  // The map draws ONE glyph for the spot; its rows follow the list's order, and clicking the glyph
  // again steps to the next home on the spot, wrapping.
  const { spotRowKeys, rowKeys } = buildStreetGroups(households);
  const spot = main.spot;
  assert.ok(houses.every((r) => r.spot === spot));
  assert.deepEqual(spotRowKeys.get(spot), rowKeys);
  assert.equal(pickSpotRow(spotRowKeys, spot, null), rowKeys[0]);
  assert.equal(pickSpotRow(spotRowKeys, spot, rowKeys[0]), rowKeys[1]);
  assert.equal(pickSpotRow(spotRowKeys, spot, rowKeys[2]), rowKeys[0]);
  assert.equal(pickSpotRow(spotRowKeys, spot, 'h:elsewhere'), rowKeys[0]);
  assert.equal(pickSpotRow(spotRowKeys, 'no-such-spot', null), null);
});

test('Enter, the key map and the hint: Enter never confirms a home without an exact map spot', () => {
  const approx = { unplaced: false };
  const unplaced = { unplaced: true };
  assert.equal(enterAction(approx), 'confirm');
  assert.equal(enterAction(unplaced), null);
  assert.equal(enterAction(null), null);
  assert.equal(popupKeyAction('Enter', approx), 'confirm');
  assert.equal(popupKeyAction('Enter', unplaced), null);
  assert.equal(popupKeyAction('ArrowLeft', unplaced), 'prev');
  assert.equal(popupKeyAction('ArrowRight', unplaced), 'next');
  assert.equal(popupKeyAction('G', unplaced), 'maps');
  assert.equal(popupKeyAction('Escape', unplaced), 'close');
  assert.equal(popupKeyAction('x', approx), null);
  assert.equal(popupHint(approx), 'Enter confirm · ← → next / prev · G maps · Esc close');
  assert.equal(popupHint(unplaced), '← → next / prev · G maps · Esc close');
  assert.equal(confirmLabel(unplaced), 'Looks right — the home is here');
  assert.equal(confirmLabel(approx), 'Looks right — confirm');
  assert.match(UNPLACED_CONFIRM_PROMPT, /shared with other addresses/);
});

test('street grouping: a door with no coordinates is dropped, not a broken row', () => {
  const { rowCount } = buildStreetGroups([door('a', '1 Oak St', -81.4, 28.3), { ...door('b', '2 Oak St'), location: null }]);
  assert.equal(rowCount, 1);
});

test('google maps link: the ADDRESS search, url-encoded, tolerant of missing pieces', () => {
  assert.equal(
    googleMapsUrl({ addressLine1: '845 Collier Ct', city: 'Kissimmee', state: 'FL', zipCode: '34741' }),
    'https://www.google.com/maps/search/?api=1&query=845%20Collier%20Ct%2C%20Kissimmee%2C%20FL%2034741'
  );
  assert.equal(
    googleMapsUrl({ addressLine1: '845 Collier Ct' }),
    'https://www.google.com/maps/search/?api=1&query=845%20Collier%20Ct'
  );
});

test('confirm toast: one door vs a building with the server count', () => {
  assert.equal(confirmToast('unit', 1), 'Location confirmed.');
  assert.equal(confirmToast(undefined, 1), 'Location confirmed.');
  assert.equal(confirmToast('building', 12), 'Building location confirmed · 12 units');
  assert.equal(confirmToast('building', 1), 'Building location confirmed · 1 unit');
});

test('confirm error copy: every server refusal has its own line', () => {
  const e = (over) => Object.assign(new Error(over.message || 'Request failed'), over);
  assert.match(confirmErrorMessage(e({ code: 'NOT_APPROXIMATE', status: 400 })), /no longer approximate/);
  assert.equal(confirmErrorMessage(e({ status: 409 })), 'This campaign is archived — pins are read-only.');
  assert.equal(confirmErrorMessage(e({ code: 'PIN_CHANGED', status: 409 })), 'This pin changed since the page loaded — reloading.');
  assert.equal(confirmErrorMessage(e({ code: 'campaign-deleting', status: 409 })), 'This campaign is archived — pins are read-only.');
  assert.equal(confirmNeedsRefetch(e({ code: 'PIN_CHANGED', status: 409 })), true);
  assert.equal(confirmNeedsRefetch(e({ code: 'NOT_APPROXIMATE', status: 400 })), true);
  assert.equal(confirmNeedsRefetch(e({ status: 409 })), false);
  assert.equal(confirmErrorMessage(e({ code: 'FORBIDDEN_ROLE', status: 403 })), 'Only campaign admins and team leads can confirm pins.');
  assert.equal(confirmErrorMessage(e({ status: 404 })), 'This door is no longer in the campaign.');
  assert.equal(confirmErrorMessage(new Error('Network down')), 'Network down');
  assert.equal(confirmErrorMessage(null), 'Could not confirm the location.');
});

test('confirm invalidation keys: the exact prefix set a vouch stales', () => {
  assert.deepEqual(confirmInvalidationKeys('c1'), [
    ['admin', 'pin-fixes', 'c1'],
    ['admin', 'households-map', 'c1'],
    ['turf-household', 'c1'],
    ['admin', 'campaigns'],
  ]);
  for (const k of confirmInvalidationKeys('c1')) assert.ok(k.length <= 3, 'prefixes only');
});
