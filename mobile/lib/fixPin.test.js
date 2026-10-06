import { test } from 'node:test';
import assert from 'node:assert';
import { fixPinSaveState, seedAllowed, moveBarNothing, NO_MOVE_METERS } from './fixPin.js';

// Fix pin on a home with no exact map spot (placeholder pins, release 2).
const SPOT = [-116.0, 36.2];
const near = { lng: -116.0, lat: 36.2 + 0.9e-5 }; // ~1 m north
const off = { lng: -116.0, lat: 36.2 + 2.7e-5 }; // ~3 m north

test('an ordinary door saves whenever there is a pin, as before', () => {
  assert.deepEqual(fixPinSaveState({ unplaced: false, spot: SPOT, coords: near, source: null }), { canSave: true, atSpot: false });
  assert.equal(fixPinSaveState({ unplaced: false, spot: SPOT, coords: null }).canSave, false);
});

test('a home with no exact spot saves only once the lead put the pin clearly off the spot', () => {
  assert.equal(NO_MOVE_METERS, 1.5);
  assert.equal(fixPinSaveState({ unplaced: true, spot: SPOT, coords: { lng: SPOT[0], lat: SPOT[1] }, source: null }).canSave, false, 'just opened');
  assert.equal(fixPinSaveState({ unplaced: true, spot: SPOT, coords: off, source: null }).canSave, false, 'a GPS seed alone is shown, not placed');
  assert.equal(fixPinSaveState({ unplaced: true, spot: SPOT, coords: near, source: 'drag' }).canSave, false, 'a nudge');
  assert.equal(fixPinSaveState({ unplaced: true, spot: SPOT, coords: off, source: 'drag' }).canSave, true);
  assert.deepEqual(fixPinSaveState({ unplaced: true, spot: SPOT, coords: near, source: 'gps' }), { canSave: false, atSpot: true }, 'standing on the spot');
  assert.deepEqual(fixPinSaveState({ unplaced: true, spot: SPOT, coords: off, source: 'gps' }), { canSave: true, atSpot: false });
});

test('the GPS seed: only unplaced, only before the lead placed the pin, only near the spot', () => {
  const fixNear = [-116.001, 36.201]; // ~140 m
  const fixFar = [-116.1, 36.3]; // ~14 km
  assert.equal(seedAllowed({ unplaced: true, source: null, spot: SPOT, fix: fixNear }), true);
  assert.equal(seedAllowed({ unplaced: true, source: null, spot: SPOT, fix: fixFar }), false);
  assert.equal(seedAllowed({ unplaced: true, source: 'drag', spot: SPOT, fix: fixNear }), false);
  assert.equal(seedAllowed({ unplaced: false, source: null, spot: SPOT, fix: fixNear }), false);
  assert.equal(seedAllowed({ unplaced: true, source: null, spot: SPOT, fix: null }), false);
});

test('the admin move bar: a centre still on an unplaced spot posts nothing', () => {
  assert.equal(moveBarNothing({ unplaced: true, spot: SPOT, center: [near.lng, near.lat] }), true);
  assert.equal(moveBarNothing({ unplaced: true, spot: SPOT, center: [off.lng, off.lat] }), false);
  assert.equal(moveBarNothing({ unplaced: false, spot: SPOT, center: SPOT }), false, 'an ordinary door saves as before');
});
