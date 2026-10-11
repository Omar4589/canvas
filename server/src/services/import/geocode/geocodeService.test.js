import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, confidenceFor, fillFrom } from './geocodeService.js';

// The pure parts of import-time placement (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S2). resolve()'s
// cache and provider flow is covered by the integration tests.

const home = { addressLine1: '21 Centerbrook Rd', city: 'Fairfield', state: 'CT', zipCode: '06824' };
const result = (extra = {}) => ({
  status: 'matched', lat: 41.17279, lng: -73.255717, accuracyType: 'rooftop', accuracy: 1,
  matchedAddress: '21 Centerbrook Rd, Fairfield, CT 06824', ...extra,
});

test('evaluate: every accuracy type is classed by the one ladder', () => {
  assert.equal(evaluate(result(), home).confidence, 'exact');
  assert.equal(evaluate(result({ accuracyType: 'point' }), home).confidence, 'exact');
  assert.equal(evaluate(result({ accuracyType: 'range_interpolation' }), home).confidence, 'interpolated');
  assert.equal(evaluate(result({ accuracyType: 'street_center' }), home).confidence, 'interpolated');
  // A neighbour's roof is no longer "exact": it imports flagged Approximate.
  assert.equal(evaluate(result({ accuracyType: 'nearest_rooftop_match' }), home).confidence, 'interpolated');
  for (const t of ['place', 'county', 'state', undefined]) {
    assert.equal(evaluate(result({ accuracyType: t }), home).code, 'geocode_low_confidence', String(t));
  }
});

test('evaluate: the 0.5 floor, the state box, and no match', () => {
  assert.equal(evaluate(result({ accuracy: 0.4 }), home).code, 'geocode_low_confidence');
  assert.equal(evaluate(result({ accuracy: 0.5 }), home).ok, true);
  assert.equal(evaluate(result({ lat: 26.1, lng: -80.2 }), home).code, 'geocode_out_of_bounds');
  assert.equal(evaluate({ status: 'unmatched' }, home).code, 'geocode_no_match');
});

test('evaluate: the ZIP rule — same ZIP, or the same city; another town is refused', () => {
  const boundary = { ...home, addressLine1: '3499 Black Rock Tpke', zipCode: '06825' };
  assert.equal(evaluate(result({ matchedAddress: '3499 Black Rock Tpke, Fairfield, CT 06824' }), boundary).ok, true, 'same city, ZIP line on the road');
  const r = evaluate(result({ matchedAddress: '1 Main St, Bridgeport, CT 06604' }), home);
  assert.equal(r.code, 'geocode_wrong_zip');
  assert.match(r.detail, /06604.*06824/);
  assert.equal(evaluate(result({ matchedAddress: null }), home).ok, true, 'no matched address: import-time placement fails open, as it always did');
});

test('confidenceFor', () => {
  assert.equal(confidenceFor('rooftop'), 'exact');
  assert.equal(confidenceFor('nearest_rooftop_match'), 'interpolated');
  assert.equal(confidenceFor('place'), 'none');
});

test('fillFrom: a cached nearest_rooftop_match stored as exact fills as interpolated, with its evidence', () => {
  const h = { ...home, latitude: null, longitude: null };
  const refusal = fillFrom(h, {
    location: { coordinates: [-73.2557, 41.1727] }, accuracyType: 'nearest_rooftop_match', accuracy: 0.9,
    confidence: 'exact', matchedAddress: '23 Centerbrook Rd, Fairfield, CT 06824',
  });
  assert.equal(refusal, null);
  assert.equal(h.coordConfidence, 'interpolated');
  assert.equal(h.coordSource, 'geocodio');
  assert.deepEqual([h.longitude, h.latitude], [-73.2557, 41.1727]);
  assert.equal(h.geocodeAccuracy, 0.9);
  assert.equal(h.geocodeAccuracyType, 'nearest_rooftop_match');
});

test('fillFrom: a cached answer in another town is refused and the household is untouched', () => {
  const h = { ...home, latitude: null, longitude: null };
  const refusal = fillFrom(h, {
    location: { coordinates: [-73.19, 41.18] }, accuracyType: 'rooftop', accuracy: 1, confidence: 'exact',
    matchedAddress: '21 Centerbrook Rd, Bridgeport, CT 06604',
  });
  assert.match(refusal, /06604/);
  assert.equal(h.latitude, null);
  assert.equal(h.coordSource, undefined);
});

test('fillFrom: a row with no type falls back to its stored confidence', () => {
  const h = { ...home };
  assert.equal(fillFrom(h, { location: { coordinates: [-73.25, 41.17] }, confidence: 'exact', matchedAddress: null }), null);
  assert.equal(h.coordConfidence, 'exact');
});
