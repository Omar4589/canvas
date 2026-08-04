import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inBoundsWithMargin, markerSig, diffMarkers, MAX_DOM_MARKERS } from './buildingMarkers.js';

const B = { west: -80.3, south: 26.0, east: -80.1, north: 26.2 }; // 0.2° square

test('inBoundsWithMargin: inside, margin zone, and outside', () => {
  assert.ok(inBoundsWithMargin(B, -80.2, 26.1)); // dead center
  // 20% margin of 0.2° = 0.04°: just past the edge but inside the margin
  assert.ok(inBoundsWithMargin(B, -80.08, 26.1));
  assert.ok(inBoundsWithMargin(B, -80.2, 26.23));
  // beyond the margin
  assert.ok(!inBoundsWithMargin(B, -80.0, 26.1));
  assert.ok(!inBoundsWithMargin(B, -80.2, 26.3));
});

test('markerSig changes with any drawn attribute and nothing else', () => {
  const base = markerSig('#f00', '3/5 hit', false, false);
  assert.equal(base, markerSig('#f00', '3/5 hit', false, false));
  assert.notEqual(base, markerSig('#00f', '3/5 hit', false, false));
  assert.notEqual(base, markerSig('#f00', '4/5 hit', false, false));
  assert.notEqual(base, markerSig('#f00', '3/5 hit', true, false));
  assert.notEqual(base, markerSig('#f00', '3/5 hit', false, true));
});

test('diffMarkers: remove gone, create missing, rebuild only on sig change', () => {
  const current = new Map([
    ['a', { sig: '1' }],
    ['b', { sig: '2' }],
    ['c', { sig: '3' }],
  ]);
  const wanted = new Map([
    ['b', { sig: '2' }], // unchanged — untouched
    ['c', { sig: 'X' }], // sig changed — rebuild
    ['d', { sig: '4' }], // new — create
  ]);
  const { remove, create, rebuild } = diffMarkers(current, wanted);
  assert.deepEqual(remove, ['a']);
  assert.deepEqual(create, ['d']);
  assert.deepEqual(rebuild, ['c']);
});

test('MAX_DOM_MARKERS is a sane ceiling', () => {
  assert.ok(MAX_DOM_MARKERS >= 100 && MAX_DOM_MARKERS <= 1000);
});
