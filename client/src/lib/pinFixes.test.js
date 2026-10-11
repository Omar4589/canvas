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

// ── The pin-fixes build: causes, cards, complexes (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S10.1) ──
import {
  rowCause, causeSub, buildGroups, confirmPrompt, FAR_CONFIRM_PROMPT, isOffWorld,
} from './pinFixes.js';

const cdoor = (id, addressLine1, lng, lat, extra = {}) => ({
  id, addressLine1, addressLine2: null, city: 'Norwalk', state: 'CT', zipCode: '06850',
  location: { lng, lat }, status: 'unknocked', ...extra,
});

test('rowCause and causeSub read the effective flag', () => {
  const { groups } = buildStreetGroups([
    cdoor('a', '1 Elm St', -73.4, 41.1, { pinSuspect: 'placeholder' }),
    cdoor('b', '2 Oak St', -73.41, 41.11, { pinSuspect: 'far' }),
    cdoor('c', '3 Ash St', -73.42, 41.12, { pinSuspect: 'unlocated' }),
    cdoor('d', '4 Fir St', -73.43, 41.13, { coordConfidence: 'interpolated' }),
  ]);
  const byLabel = Object.fromEntries(groups.flatMap((g) => g.rows).map((r) => [r.label, r]));
  assert.equal(rowCause(byLabel['1 Elm St']), 'shared');
  assert.equal(rowCause(byLabel['2 Oak St']), 'far');
  assert.equal(rowCause(byLabel['3 Ash St']), 'unlocated');
  assert.equal(rowCause(byLabel['4 Fir St']), 'approx');
  assert.equal(byLabel['2 Oak St'].sub, 'Pinned far from its street');
  assert.equal(byLabel['3 Ash St'].sub, "Couldn't be found by address");
  assert.equal(causeSub('approx'), null);
});

test('confirm: no Looks right at all on a holding spot; the far prompt names the cause', () => {
  const { groups } = buildStreetGroups([
    cdoor('c', '3 Ash St', -73.42, 41.12, { pinSuspect: 'unlocated' }),
    cdoor('b', '2 Oak St', -73.41, 41.11, { pinSuspect: 'far' }),
  ]);
  const rows = groups.flatMap((g) => g.rows);
  const parked = rows.find((r) => r.label === '3 Ash St');
  const far = rows.find((r) => r.label === '2 Oak St');
  assert.equal(confirmLabel(parked), null);
  assert.equal(enterAction(parked), null);
  assert.equal(confirmLabel(far), 'Looks right — the home is here');
  assert.equal(confirmPrompt(far), FAR_CONFIRM_PROMPT);
});

test('buildGroups: cards by cause, complexes as one row each, empties omitted, member rows built for Spread', () => {
  const complexMembers = [
    cdoor('m1', '10 Rowayton Woods Dr', -73.436, 41.08, { pinSuspect: 'complex', complexKey: 'K' }),
    cdoor('m2', '11 Rowayton Woods Dr', -73.436, 41.08, { pinSuspect: 'complex', complexKey: 'K' }),
    cdoor('m3', '12 Rowayton Woods Dr', -73.436, 41.08, { pinSuspect: 'complex', complexKey: 'K' }),
  ];
  const g = buildGroups({
    households: [
      cdoor('a', '1 Elm St', -73.4, 41.1, { pinSuspect: 'placeholder' }),
      cdoor('a2', '3 Elm St', -73.4, 41.1, { pinSuspect: 'placeholder' }),
      cdoor('d', '4 Fir St', -73.43, 41.13, { coordConfidence: 'interpolated' }),
      complexMembers[0], // a complex member that slipped into the list is ignored there
    ],
    complexes: [{ key: 'K', lng: -73.436, lat: 41.08, count: 3, streets: ['Rowayton Woods Dr'], rows: complexMembers }],
    setAside: [cdoor('s', '5151 Sacred Heart University', -73.25, 41.17, { setAside: true })],
  });
  assert.deepEqual(g.cards.map((c) => c.kind), ['shared', 'complexes', 'approx']);
  const shared = g.cards[0];
  assert.equal(shared.count, 2);
  assert.equal(shared.spots, 1);
  assert.deepEqual(shared.actions, ['lookup', 'place', 'setAside']);
  const complexes = g.cards[1];
  assert.equal(complexes.count, 3);
  assert.deepEqual(complexes.rowKeys, ['c:K']);
  assert.deepEqual(complexes.actions, ['vouchSpot', 'spread']);
  assert.equal(g.complexRows[0].memberRowKeys.length, 3, 'three addresses, three rows to place');
  assert.equal(g.memberRows.length, 3);
  assert.equal(g.memberIdToRowKey.get('m2'), 'h:m2');
  assert.equal(g.street.idToRowKey.has('m1'), false, 'complex members are not street rows');
  assert.equal(g.complexRows[0].target.scope, 'spot');
  assert.equal(g.setAside.length, 1);
});

test('isOffWorld: only Null Island', () => {
  assert.equal(isOffWorld(0, 0), true);
  assert.equal(isOffWorld(41.1, -73.4), false);
});

// ── The page's new helpers (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S10.2–S10.3) ──
import {
  cardCountLine, doorIdsOfRows, setAsidePrompt, setAsideToast, bringBackToast, isLookupActive, lookupToast,
  lookupErrorMessage, scopedGroups, placeFlyTarget, middleOf, neighbourNumbersGeoJSON,
} from './pinFixes.js';
import { importPinLine } from './importPins.js';

test('a complex vouch is a click, never Enter; its toast counts homes', () => {
  const g = buildGroups({
    complexes: [{ key: 'K', lng: -73.4, lat: 41.1, count: 2, streets: ['Elm St'], rows: [
      cdoor('m1', '1 Elm St', -73.4, 41.1, { pinSuspect: 'complex' }),
      cdoor('m2', '3 Elm St', -73.4, 41.1, { pinSuspect: 'complex' }),
    ] }],
  });
  const row = g.complexRows[0];
  assert.equal(enterAction(row), null);
  assert.equal(popupKeyAction('Enter', row), null);
  assert.equal(confirmToast('spot', 46), 'Confirmed 46 homes at the complex');
  assert.equal(confirmToast('spot', 1), 'Confirmed 1 home at the complex');
});

test('cards carry a sentence, the busiest streets and a count line', () => {
  const g = buildGroups({
    households: [
      cdoor('a', '1 Foxboro Dr', -73.4, 41.1, { pinSuspect: 'placeholder' }),
      cdoor('b', '3 Foxboro Dr', -73.4, 41.1, { pinSuspect: 'placeholder' }),
      cdoor('c', '5 Foxboro Dr', -73.4, 41.1, { pinSuspect: 'placeholder' }),
      cdoor('d', '2 Thomas Pl', -73.41, 41.11, { pinSuspect: 'placeholder' }),
      cdoor('e', '9 Oak St', -73.5, 41.2, { pinSuspect: 'far' }),
    ],
  });
  const shared = g.cards.find((c) => c.kind === 'shared');
  assert.match(shared.blurb, /one coordinate/);
  assert.deepEqual(shared.streets, [{ street: 'Foxboro Dr', count: 3 }, { street: 'Thomas Pl', count: 1 }]);
  assert.equal(cardCountLine(shared), '4 homes · 2 spots');
  assert.equal(cardCountLine(g.cards.find((c) => c.kind === 'far')), '1 home');
  assert.equal(cardCountLine({ kind: 'complexes', count: 212, spots: 11 }), '212 homes · 11 spots');
});

test('set aside sends every door of a row, units included, once', () => {
  const { groups } = buildStreetGroups([
    cdoor('u1', '533 Black Rock Tpke', -73.2, 41.15, { addressLine2: 'Apt 1', pinSuspect: 'placeholder' }),
    cdoor('u2', '533 Black Rock Tpke', -73.2, 41.15, { addressLine2: 'Apt 2', pinSuspect: 'placeholder' }),
    cdoor('x', '7 Elm St', -73.3, 41.2, { pinSuspect: 'unlocated' }),
  ]);
  const rows = groups.flatMap((g) => g.rows);
  assert.deepEqual(doorIdsOfRows([...rows, rows[0]]).sort(), ['u1', 'u2', 'x']);
  assert.equal(setAsidePrompt(13), 'Set aside 13 homes? They leave the queue and every book cut until brought back.');
  assert.equal(setAsidePrompt(1), 'Set aside 1 home? It leaves the queue and every book cut until brought back.');
  assert.equal(setAsideToast(2), 'Set aside 2 homes.');
  assert.match(bringBackToast(1), /^Brought back 1 home — it is in the queue/);
});

test('look up by address: active until done, then the pin line, its own sentence, or 0 placed', () => {
  assert.equal(isLookupActive({ status: 'pending' }), true);
  assert.equal(isLookupActive({ status: 'importing' }), true);
  assert.equal(isLookupActive({ status: 'completed' }), false);
  assert.equal(isLookupActive(null), false);
  assert.deepEqual(
    lookupToast({ status: 'completed', pinsPlacedExact: 231, pinsPlacedApprox: 19, pinsStillUnplaced: 3 }, importPinLine),
    { text: 'Map pins: 231 placed by address · 19 placed on the street (check them) · 3 without an exact spot' }
  );
  assert.deepEqual(lookupToast({ status: 'completed' }, importPinLine), { text: 'Map pins: 0 placed — nothing changed.' });
  assert.equal(lookupToast({ status: 'completed', pinPassError: 'Busy — click Look up by address again.' }, importPinLine).tone, 'error');
  assert.equal(lookupToast({ status: 'failed', lastError: 'x' }, importPinLine).text, 'x');
  assert.equal(lookupErrorMessage({ code: 'LOOKUPS_OFF', message: 'Address lookups are switched off for now.' }), 'Address lookups are switched off for now.');
  assert.match(lookupErrorMessage({ data: { code: 'NOTHING_TO_LOOK_UP' } }), /^Nothing to look up/);
});

test('Start checking narrows the street list to its rows and drops empty streets', () => {
  const { groups } = buildStreetGroups([
    cdoor('a', '1 Elm St', -73.4, 41.1, { coordConfidence: 'interpolated' }),
    cdoor('b', '2 Oak St', -73.41, 41.11, { pinSuspect: 'far' }),
  ]);
  assert.equal(scopedGroups(groups, null), groups);
  const scoped = scopedGroups(groups, new Set(['h:a']));
  assert.deepEqual(scoped.map((g) => g.street), ['Elm St']);
});

test('place along the street never flies to 0,0: the street’s middle, else the fallback, else nowhere', () => {
  const rows = [
    { rowKey: 'h:z', street: 'Elm St', lng: 0, lat: 0 },
    { rowKey: 'h:a', street: 'Elm St', lng: -73.40, lat: 41.10 },
    { rowKey: 'h:b', street: 'Elm St', lng: -73.42, lat: 41.12 },
    { rowKey: 'h:c', street: 'Oak St', lng: -72.0, lat: 40.0 },
  ];
  assert.deepEqual(placeFlyTarget(rows[1], rows), { lng: -73.40, lat: 41.10 });
  assert.deepEqual(placeFlyTarget(rows[0], rows), { lng: -73.41, lat: 41.11 });
  const lonely = { rowKey: 'h:y', street: 'Nowhere Ln', lng: 0, lat: 0 };
  assert.deepEqual(placeFlyTarget(lonely, [lonely], { lng: -73, lat: 41 }), { lng: -73, lat: 41 });
  assert.equal(placeFlyTarget(lonely, [lonely]), null);
  assert.equal(middleOf([{ lng: 0, lat: 0 }]), null);
});

test('neighbour numbers: leading house numbers of doors not in the queue', () => {
  const fc = neighbourNumbersGeoJSON(
    [
      { id: '1', addressLine1: '1002 Foxboro Dr', location: { lng: -73.4, lat: 41.1 } },
      { id: '2', addressLine1: '10A Bloomfield Dr', location: { lng: -73.41, lat: 41.1 } },
      { id: '3', addressLine1: 'Fairfield University No Know', location: { lng: -73.42, lat: 41.1 } },
      { id: '4', addressLine1: '1004 Foxboro Dr', location: { lng: -73.43, lat: 41.1 } },
      { id: '5', addressLine1: '1006 Foxboro Dr', location: null },
    ],
    new Set(['4'])
  );
  assert.deepEqual(fc.features.map((f) => f.properties.num), ['1002', '10A']);
});
