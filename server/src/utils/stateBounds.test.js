import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidLatLng, inStateBounds, isOffWorld, fileCoordRefusal, OFF_WORLD_EPSILON } from './stateBounds.js';

// The Fairfield file's "no location" value, and the import's answer to it
// (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S1.1).

test('isOffWorld: Null Island and anything within ~1 m of it', () => {
  assert.equal(isOffWorld(0, 0), true);
  assert.equal(isOffWorld(0.000005, -0.000005), true);
  assert.equal(isOffWorld(OFF_WORLD_EPSILON, 0), false); // the boundary is exclusive
  assert.equal(isOffWorld(41.17, -73.25), false);
});

test('fileCoordRefusal: 0,0 is offworld even for a state whose box is unknown', () => {
  assert.equal(fileCoordRefusal({ lat: 0, lng: 0, state: 'CT' }), 'offworld');
  assert.equal(fileCoordRefusal({ lat: 0, lng: 0, state: 'ZZ' }), 'offworld');
});

test('fileCoordRefusal: a CT house passes; the same pair swapped is outside CT', () => {
  assert.equal(fileCoordRefusal({ lat: 41.17279, lng: -73.255717, state: 'CT' }), null);
  assert.equal(fileCoordRefusal({ lat: -73.255717, lng: 41.17279, state: 'CT' }), 'outside_state');
});

test('fileCoordRefusal: a Fairfield address pinned in Bristol CT is still in state (the cohort rule, not this one, catches that)', () => {
  assert.equal(fileCoordRefusal({ lat: 41.664458, lng: -72.933639, state: 'CT' }), null);
});

test('fileCoordRefusal: an unknown state code fails open, as inStateBounds does', () => {
  assert.equal(fileCoordRefusal({ lat: 41.17, lng: -73.25, state: 'ZZ' }), null);
  assert.equal(fileCoordRefusal({ lat: 41.17, lng: -73.25, state: '' }), null);
  assert.equal(fileCoordRefusal({ lat: 41.17, lng: -73.25, state: null }), null);
});

test('fileCoordRefusal: a non-finite pair reads as outside its state (callers never pass one)', () => {
  assert.equal(fileCoordRefusal({ lat: NaN, lng: -73.25, state: 'CT' }), 'outside_state');
});

test('isValidLatLng and inStateBounds are untouched', () => {
  assert.equal(isValidLatLng(0, 0), true); // in range — the refusal is a separate question
  assert.equal(isValidLatLng(91, 0), false);
  assert.equal(inStateBounds('CT', 41.17, -73.25), true);
  assert.equal(inStateBounds('CT', 0, 0), false);
  assert.equal(inStateBounds('ZZ', 0, 0), true);
});
