import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movePinCopy, movePinErrorMessage, movePinInvalidationKeys, movePinToast } from './movePin.js';

// movePin.js is the pure half of "Move pin" shared by the Map page panel and the Turf Cutting
// pop-ups. Under lock here: the card's wording per scope, which server error reads as what,
// the EXACT set of query prefixes a save stales (the cross-page contract), and the toast.

const plain = (copy) => copy.body.map((s) => s.text).join('');

test('unit copy: one door, its address in the strong segment', () => {
  const c = movePinCopy({ scope: 'unit', count: 1, addressLine1: '123 Main St' });
  assert.equal(c.title, 'Move pin');
  assert.equal(plain(c), "Drag the blue marker to 123 Main St's correct spot, then Save.");
  assert.deepEqual(c.body.filter((s) => s.strong).map((s) => s.text), ['123 Main St']);
  assert.equal(
    c.caveat,
    'Corrects the pin only — this door keeps its current book until you re-cut turf (the book outline redraws around it). Canvassers see the new spot on their next sync.'
  );
  assert.equal(c.saveLabel, 'Save location');
});

test('building copy: every unit moves together, plural caveat', () => {
  const c = movePinCopy({ scope: 'building', count: 4, addressLine1: '9 Elm Ave' });
  assert.equal(c.title, 'Move building pin');
  assert.equal(plain(c), "Drag the blue marker to 9 Elm Ave's correct spot, then Save — this moves all 4 units together.");
  assert.equal(
    c.caveat,
    'Corrects the pins only — these doors keep their current book until you re-cut turf (the book outline redraws around them). Canvassers see the new spot on their next sync.'
  );
  assert.equal(c.saveLabel, 'Save location');
});

test('missing address falls back to "this door" / "this building"; missing scope is a unit', () => {
  assert.equal(plain(movePinCopy({ scope: 'unit' })), "Drag the blue marker to this door's correct spot, then Save.");
  assert.equal(
    plain(movePinCopy({ scope: 'building', count: 2 })),
    "Drag the blue marker to this building's correct spot, then Save — this moves all 2 units together."
  );
  assert.equal(movePinCopy({}).title, 'Move pin');
  assert.equal(movePinCopy().title, 'Move pin');
});

test('error copy: the server sentence wins for out_of_bounds, every other code has its own line', () => {
  const e = (over) => Object.assign(new Error(over.message || 'Request failed'), over);
  assert.equal(movePinErrorMessage(e({ code: 'out_of_bounds', status: 400, message: 'That spot is outside NE.' })), 'That spot is outside NE.');
  assert.match(movePinErrorMessage(e({ code: 'invalid_coords', status: 400, message: 'Invalid coordinates' })), /valid location/);
  assert.equal(movePinErrorMessage(e({ code: 'campaign-archived', status: 409 })), 'This campaign is archived — pins are read-only.');
  assert.equal(movePinErrorMessage(e({ status: 409 })), 'This campaign is archived — pins are read-only.');
  assert.equal(movePinErrorMessage(e({ code: 'FORBIDDEN_ROLE', status: 403 })), 'Only campaign admins and team leads can move pins.');
  assert.equal(movePinErrorMessage(e({ status: 404, message: 'Household not found' })), 'This door is no longer in the campaign.');
  // A code only on the payload (older callers) still branches.
  assert.equal(movePinErrorMessage(e({ status: 409, data: { code: 'campaign-archived' } })), 'This campaign is archived — pins are read-only.');
});

test('error copy: unknown errors keep their message, a bare failure gets the generic line', () => {
  assert.equal(movePinErrorMessage(new Error('Network down')), 'Network down');
  assert.equal(movePinErrorMessage({}), 'Could not move the pin.');
  assert.equal(movePinErrorMessage(null), 'Could not move the pin.');
  assert.equal(movePinErrorMessage(Object.assign(new Error(''), { status: 500 })), 'Could not move the pin.');
});

test('invalidation keys: the exact cross-page prefix set, in order', () => {
  assert.deepEqual(movePinInvalidationKeys('c1'), [
    ['turf-doors', 'c1'],
    ['turfs', 'c1'],
    ['turf-household', 'c1'],
    ['admin', 'households-map', 'c1'],
    ['admin', 'packet-data', 'c1'],
  ]);
  // Prefixes only — never a passId or a date window, which would miss the other page's key.
  for (const k of movePinInvalidationKeys('c1')) assert.ok(k.length <= 3);
});

test('toast: one door vs a building with the server count', () => {
  assert.equal(movePinToast('unit', 1), 'Pin moved.');
  assert.equal(movePinToast(undefined, 1), 'Pin moved.');
  assert.equal(movePinToast('building', 12), 'Building pin moved · 12 units');
  assert.equal(movePinToast('building', 1), 'Building pin moved · 1 unit');
  assert.equal(movePinToast('building', undefined), 'Building pin moved · 0 units');
});
