import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingKeyForCoords, groupHouseholds, buildingLabel, buildingMovePrimary } from './buildings.js';

const door = (id, lng, lat, status = 'unknocked', extra = {}) => ({
  id,
  location: { lng, lat },
  status,
  addressLine1: '17475 Frances St',
  city: 'Omaha',
  state: 'NE',
  zipCode: '68130',
  ...extra,
});

test('buildingKeyForCoords rounds to ~1.1m and rejects missing coords', () => {
  // 5 decimals: these two are the same pin, the third is not
  assert.equal(buildingKeyForCoords(-96.1, 41.2), buildingKeyForCoords(-96.100001, 41.200001));
  assert.notEqual(buildingKeyForCoords(-96.1, 41.2), buildingKeyForCoords(-96.1001, 41.2));
  assert.equal(buildingKeyForCoords(null, 41.2), null);
  assert.equal(buildingKeyForCoords(-96.1, undefined), null);
  assert.equal(buildingKeyForCoords(NaN, 41.2), null);
});

test('key matches the server/mobile formula exactly (lat|lng, not lng|lat)', () => {
  // server/src/utils/buildingKey.js and mobile/lib/buildings.js both build
  // `${round(lat*1e5)}|${round(lng*1e5)}` from a [lng, lat] GeoJSON pair.
  assert.equal(buildingKeyForCoords(-96.12806, 41.27677), '4127677|-9612806');
});

test('groupHouseholds: 2+ doors on one pin is a building, a lone door is not', () => {
  const { buildings, stackedIds } = groupHouseholds([
    door('a', -96.1, 41.2),
    door('b', -96.1, 41.2),
    door('c', -96.2, 41.3), // alone
  ]);
  assert.equal(buildings.length, 1);
  assert.equal(buildings[0].total, 2);
  assert.deepEqual([...stackedIds].sort(), ['a', 'b']);
  assert.ok(!stackedIds.has('c'));
});

test('every stacked door is accounted for — units + singles = input', () => {
  const doors = [
    door('a', -96.1, 41.2),
    door('b', -96.1, 41.2),
    door('c', -96.1, 41.2),
    door('d', -96.2, 41.3),
    door('e', -96.3, 41.4),
  ];
  const { buildings, stackedIds } = groupHouseholds(doors);
  const inBuildings = buildings.reduce((n, b) => n + b.total, 0);
  assert.equal(inBuildings, stackedIds.size);
  assert.equal(inBuildings + doors.filter((d) => !stackedIds.has(d.id)).length, doors.length);
});

test('roll-up status: none / partial / done', () => {
  const at = (...statuses) =>
    groupHouseholds(statuses.map((s, i) => door(`u${i}`, -96.1, 41.2, s))).buildings[0];

  assert.equal(at('unknocked', 'unknocked').roll, 'none');
  assert.equal(at('unknocked', 'not_home').roll, 'partial');
  assert.equal(at('surveyed', 'unknocked').roll, 'partial');
  assert.equal(at('surveyed', 'lit_dropped').roll, 'done');
  // "touched but not done" — refused/not_home count as worked, never as done
  const mixed = at('refused', 'not_home');
  assert.equal(mixed.done, 0);
  assert.equal(mixed.touched, 2);
  assert.equal(mixed.roll, 'partial');
});

test('doors without coordinates are dropped, not grouped into a phantom pin', () => {
  const { buildings, stackedIds } = groupHouseholds([
    { id: 'a', location: null, status: 'unknocked' },
    { id: 'b', location: null, status: 'unknocked' },
  ]);
  assert.equal(buildings.length, 0);
  assert.equal(stackedIds.size, 0);
});

test('minUnits raises the bar (the cut map can ask for 4+)', () => {
  const three = [door('a', -96.1, 41.2), door('b', -96.1, 41.2), door('c', -96.1, 41.2)];
  assert.equal(groupHouseholds(three, 2).buildings.length, 1);
  assert.equal(groupHouseholds(three, 4).buildings.length, 0);
});

test('buildings sort biggest-first and are addressable by key', () => {
  const { buildings, byKey } = groupHouseholds([
    door('a', -96.1, 41.2),
    door('b', -96.1, 41.2),
    door('c', -96.5, 41.5),
    door('d', -96.5, 41.5),
    door('e', -96.5, 41.5),
  ]);
  assert.deepEqual(buildings.map((b) => b.total), [3, 2]);
  assert.equal(byKey.get(buildings[0].key).total, 3);
});

test('buildingLabel uses the shared street line, or admits the units disagree', () => {
  const same = groupHouseholds([door('a', -96.1, 41.2), door('b', -96.1, 41.2)]).buildings[0];
  assert.equal(buildingLabel(same), '17475 Frances St');

  const differ = groupHouseholds([
    door('a', -96.1, 41.2),
    door('b', -96.1, 41.2, 'unknocked', { addressLine1: '805 S 173rd Ct' }),
  ]).buildings[0];
  assert.equal(buildingLabel(differ), '2 doors at one pin');
  assert.equal(buildingLabel(null), '');
});

test('groupHouseholds tolerates null/empty input', () => {
  assert.equal(groupHouseholds(null).buildings.length, 0);
  assert.equal(groupHouseholds([]).stackedIds.size, 0);
});

test('buildingMovePrimary: a building is the address holding most of the pin; separate homes have none', () => {
  const at = (id, line1) => door(id, -116.0, 36.2, 'unknocked', { addressLine1: line1 });
  // Four units of one address plus a stray: the four move together, the stray is not carried.
  const tower = buildingMovePrimary([
    at('a', '100 Main St Apt 1'),
    at('b', '100 Main St Apt 2'),
    at('c', '100 Main Street Apt 3'),
    at('d', '100 Main St #4'),
    at('e', '12 Pine St'),
  ]);
  assert.equal(tower.count, 4);
  assert.equal(tower.primary.id, 'a');
  assert.equal(tower.address, '100 Main St');
  // Different houses a voter file put on one coordinate: no building to move.
  assert.equal(buildingMovePrimary([at('m', '591 Mount Charleston Dr'), at('v', '1841 S Vineyard Dr'), at('n', '1084 Mount Charleston Dr')]), null);
  assert.equal(buildingMovePrimary([at('x', '5016 E Monte Penne Way'), at('y', '5021 E Monte Penne Way')]), null);
  // Exactly half is not a majority; a duplex is.
  assert.equal(buildingMovePrimary([at('p', '7 Elm St Apt A'), at('q', '7 Elm St Apt B'), at('r', '9 Elm St'), at('s', '11 Elm St')]), null);
  assert.equal(buildingMovePrimary([at('p', '7 Elm St Apt A'), at('q', '7 Elm St Apt B')]).count, 2);
  assert.equal(buildingMovePrimary([at('z', '1 Solo Rd')]), null);
  assert.equal(buildingMovePrimary(undefined), null);
});
