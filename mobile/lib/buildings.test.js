import { test } from 'node:test';
import assert from 'node:assert';
import { groupBuildings, stackKind, homesInOrder, sameAddressSiblings, addressGroupsOf, stackForTap } from './buildings.js';

// The phone's stacks (placeholder pins, release 2): which stacks are buildings and which are different homes
// sharing one map spot, the building header, the homes order, and the units "Whole building" carries. The same
// rule as the web (client/src/lib/buildings.js).
const at = (id, line1, extra = {}) => ({
  _id: id,
  addressLine1: line1,
  city: 'Pahrump',
  state: 'NV',
  zipCode: '89061',
  location: { type: 'Point', coordinates: [-116.0, 36.2] },
  status: 'unknocked',
  ...extra,
});

test('stackKind: different homes on one spot vs a building with a stray', () => {
  assert.equal(stackKind([at('a', '5016 E Monte Penne Way', { pinSuspect: 'placeholder' }), at('b', '5021 E Monte Penne Way', { pinSuspect: 'placeholder' })]), 'unplaced');
  assert.equal(stackKind([at('a', '1 A St'), at('b', '3 B St', { pinSuspect: 'placeholder' })]), 'unplaced');
  assert.equal(stackKind([at('a', '1 A St', { pinSuspect: 'stray' }), at('b', '3 B St', { pinSuspect: 'stray' })]), 'unplaced');
  assert.equal(stackKind([at('a', '100 Main St Apt 1'), at('b', '100 Main St Apt 2'), at('s', '12 Pine St', { pinSuspect: 'stray' })]), 'building');
  assert.equal(stackKind([]), 'building');
});

test('groupBuildings: kind, strays, and a header that skips the strays', () => {
  const { buildings, singles } = groupBuildings([
    at('s', '12 Pine St', { pinSuspect: 'stray', status: 'surveyed' }),
    at('a', '100 Main St Apt 1'),
    at('b', '100 Main St Apt 2'),
    at('lone', '9 Far Rd', { location: { type: 'Point', coordinates: [-116.5, 36.5] } }),
  ]);
  assert.equal(singles.length, 1);
  const b = buildings[0];
  assert.equal(b.kind, 'building');
  assert.deepEqual(b.strays.map((u) => u._id), ['s']);
  assert.equal(b.addressLine1, '100 Main St Apt 1');
  assert.equal(b.total, 3);
  assert.equal(b.done, 1, 'the stray still counts in the roll-up');
  assert.equal(b.status, 'yellow');
  const homes = groupBuildings([at('m', '5016 E Monte Penne Way', { pinSuspect: 'placeholder' }), at('n', '5021 E Monte Penne Way', { pinSuspect: 'placeholder' })]).buildings[0];
  assert.equal(homes.kind, 'unplaced');
  assert.deepEqual(homes.strays, []);
});

test('homesInOrder: by street, then house number, then unit', () => {
  const order = homesInOrder([
    at('b', '5021 E Monte Penne Way'),
    at('c', '100 Main St', { addressLine2: 'Apt 10' }),
    at('a', '5016 E Monte Penne Way'),
    at('d', '100 Main St', { addressLine2: 'Apt 2' }),
  ]).map((u) => u._id);
  assert.deepEqual(order, ['a', 'b', 'd', 'c']);
});

test('sameAddressSiblings: the units of one street address on the pin, never the other homes on it', () => {
  const doors = [
    at('a1', '100 Main St Apt 1'),
    at('a2', '100 Main Street Apt 2'),
    at('x', '102 Main St'),
    at('far', '100 Main St Apt 3', { location: { type: 'Point', coordinates: [-116.3, 36.4] } }),
  ];
  assert.deepEqual(sameAddressSiblings(doors, doors[0]).map((u) => u._id), ['a2']);
  assert.deepEqual(sameAddressSiblings(doors, doors[2]), []);
  assert.deepEqual(sameAddressSiblings(doors, { _id: 'none', addressLine1: '1 X St' }), []);
});

test('addressGroupsOf: one group per street address, in walking order', () => {
  const groups = addressGroupsOf([
    at('b2', '100 Main St', { addressLine2: 'Apt 10' }),
    at('m', '5016 E Monte Penne Way'),
    at('b1', '100 Main Street Apt 2'),
  ]);
  assert.deepEqual(groups.map((g) => [g.address, g.units.map((u) => u._id)]), [
    ['5016 E Monte Penne Way', ['m']],
    ['100 Main Street', ['b1', 'b2']],
  ]);
});

test('stackForTap: every door at the tapped pin, or the one door', () => {
  const d = (id, lng, lat) => ({ id, location: { lng, lat } });
  const doors = [d('a', -116, 36.2), d('b', -116, 36.2), d('c', -116.5, 36.5)];
  assert.deepEqual(stackForTap(doors, ['b']).stack.map((x) => x.id), ['a', 'b'], 'the payload decides, not just the hit icons');
  assert.equal(stackForTap(doors, ['c']).door.id, 'c');
  assert.equal(stackForTap(doors, ['zzz']), null);
});
