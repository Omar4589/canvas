import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundsOf, cameraSeed, DEFAULT_CENTER } from './mapCamera.js';

test('boundsOf: nothing usable → null', () => {
  assert.equal(boundsOf([]), null);
  assert.equal(boundsOf(undefined), null);
  assert.equal(boundsOf(null), null);
  assert.equal(boundsOf([null, undefined, 'x', [1], [1, 2, 3], [NaN, 1], ['1', '2']]), null);
});

test('boundsOf: one point is single, ne === sw === the point', () => {
  const b = boundsOf([[-97.7, 30.2]]);
  assert.deepEqual(b, { ne: [-97.7, 30.2], sw: [-97.7, 30.2], single: true });
});

test('boundsOf: many points → the bounding box, malformed entries ignored', () => {
  const b = boundsOf([[-73.5, 41.1], null, [-72.1, 41.6], [1, 2, 3], [-73.0, 40.9], [NaN, 50]]);
  assert.deepEqual(b, { ne: [-72.1, 41.6], sw: [-73.5, 40.9], single: false });
});

test('boundsOf: identical points are single (fitBounds would have nothing to fit)', () => {
  const b = boundsOf([[-73.5, 41.1], [-73.5, 41.1], [-73.5, 41.1]]);
  assert.deepEqual(b, { ne: [-73.5, 41.1], sw: [-73.5, 41.1], single: true });
});

test('cameraSeed: nothing known → the fallback at a wide zoom', () => {
  assert.deepEqual(cameraSeed([]), { centerCoordinate: DEFAULT_CENTER, zoomLevel: 9 });
  assert.deepEqual(cameraSeed(undefined, [-72.9, 41.3]), { centerCoordinate: [-72.9, 41.3], zoomLevel: 9 });
});

test('cameraSeed: one point → that point, close in', () => {
  assert.deepEqual(cameraSeed([[-97.7, 30.2]]), { centerCoordinate: [-97.7, 30.2], zoomLevel: 14 });
});

test('cameraSeed: many points → the bounding-box center at a county-ish zoom', () => {
  const seed = cameraSeed([[-73.5, 41.1], [-72.1, 41.6], [-73.0, 40.9]]);
  assert.equal(seed.zoomLevel, 10);
  assert.ok(Math.abs(seed.centerCoordinate[0] - -72.8) < 1e-9);
  assert.ok(Math.abs(seed.centerCoordinate[1] - 41.25) < 1e-9);
});
