import { test } from 'node:test';
import assert from 'node:assert';
import { isValidLatLng } from '../src/utils/stateBounds.js';

// The ONE world-bounds predicate behind the knock-stamp backstop (canvass.js missingLocation) and the
// pin-move guard (updateHouseholdLocation). A refused knock is a 400 LOCATION_REQUIRED, and a queued
// offline knock refused with a 4xx is dropped from the phone, so the edges must stay accepted.

test('the poles and the antimeridian are real places', () => {
  for (const [lat, lng] of [[90, 0], [-90, 0], [0, 180], [0, -180], [90, 180], [-90, -180], [0, 0], [38.25, -85.76]]) {
    assert.strictEqual(isValidLatLng(lat, lng), true, `${lat},${lng}`);
  }
});

test('anything past them, or not a finite number, is not', () => {
  for (const [lat, lng] of [
    [90.0001, 0], [-90.0001, 0], [0, 180.0001], [0, -180.0001], [200, -85], [-180, -180],
    [Infinity, 0], [0, -Infinity], [NaN, 0], ['38.2', -85.7], [null, -85.7], [38.2, undefined],
  ]) {
    assert.strictEqual(isValidLatLng(lat, lng), false, `${lat},${lng}`);
  }
});
