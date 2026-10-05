import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCURACY_RING_CAP,
  ACCURACY_RING_MIN_ZOOM,
  accuracyRingsGeoJSON,
  geodesicCircle,
  nextRingView,
  padBounds,
  ringInputsFromPoints,
  ringRadiusM,
} from './accuracyRing.js';

// The admin maps' accuracy circles (docs/PROPOSAL_GPS_UPGRADES.md §H.4): true-scale geometry, which
// stamps get one, and the two ways a set is withheld (below the zoom floor, over the cap).

const R = 6371000;
const haversine = (lat1, lng1, lat2, lng2) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

test('geodesicCircle: 65 closed points, counter-clockwise, every vertex within 0.1 m of the radius', () => {
  for (const lat of [28, 30, 61]) {
    for (const radius of [5, 30, 250]) {
      const ring = geodesicCircle(-85.7, lat, radius);
      assert.equal(ring.length, 65);
      assert.deepEqual(ring[0], ring[64], 'closed');
      for (const [lng, la] of ring) assert.ok(Math.abs(haversine(lat, -85.7, la, lng) - radius) < 0.1, `${radius} m at lat ${lat}`);
      let area = 0;
      for (let i = 0; i < 64; i += 1) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      assert.ok(area > 0, 'counter-clockwise (positive shoelace area)');
    }
  }
});

test('geodesicCircle rejects 0, negative, NaN and missing input', () => {
  for (const args of [[-85.7, 30, 0], [-85.7, 30, -5], [-85.7, NaN, 10], [undefined, 30, 10], [-85.7, 30]]) {
    assert.equal(geodesicCircle(...args), null, JSON.stringify(args));
  }
});

test('a circle at lng 179.9999 does not span the globe', () => {
  const lngs = geodesicCircle(179.9999, 10, 250).map(([lng]) => lng);
  assert.ok(Math.max(...lngs) - Math.min(...lngs) < 0.01);
});

test('ringRadiusM: null, 0, negative, NaN and over 250 m draw nothing; 0.5 and 250 draw', () => {
  for (const a of [null, undefined, 0, -1, NaN, Infinity, 251]) assert.equal(ringRadiusM(a), null, String(a));
  assert.equal(ringRadiusM(0.5), 0.5);
  assert.equal(ringRadiusM(250), 250);
});

const point = (lng, lat, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties });
const fc = (...features) => ({ type: 'FeatureCollection', features });

test('ringInputsFromPoints: a stamp that is both a ping and a flag gets one circle, in the flag colour', () => {
  const pings = fc(point(-85.7, 38.2, { activityId: 'a1', actionType: 'not_home', accuracy: 12 }));
  const flags = fc(point(-85.7, 38.2, { actionId: 'a1', color: '#ef4444', reviewed: 0, accuracy: 12 }));
  const inputs = ringInputsFromPoints(pings, flags, () => '#3b82f6');
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].color, '#ef4444');
});

test('ringInputsFromPoints: pings without accuracy are skipped; web (activityId) and phone (id) pings both work', () => {
  const pings = fc(
    point(-85.7, 38.2, { activityId: 'w1', actionType: 'not_home', accuracy: 12 }),
    point(-85.7, 38.2, { id: 'p1', actionType: 'refused', accuracy: 8 }),
    point(-85.7, 38.2, { activityId: 'w2', actionType: 'not_home' })
  );
  const inputs = ringInputsFromPoints(pings, fc(), (t) => (t === 'refused' ? '#f59e0b' : '#3b82f6'));
  assert.deepEqual(inputs.map((x) => x.id), ['ping-w1', 'ping-p1']);
  assert.equal(inputs[1].color, '#f59e0b');
});

const input = (i, extra = {}) => ({ id: `ping-${i}`, lng: -85.7 + i * 0.0001, lat: 38.2, accuracy: 10, color: '#3b82f6', reviewed: 0, ...extra });

test('accuracyRingsGeoJSON: nothing below the zoom floor, and nothing withheld there either', () => {
  const r = accuracyRingsGeoJSON([input(1)], { zoom: ACCURACY_RING_MIN_ZOOM - 0.01 });
  assert.equal(r.fc.features.length, 0);
  assert.equal(r.withheld, false);
  assert.equal(accuracyRingsGeoJSON([input(1)], { zoom: null }).fc.features.length, 0, 'no camera yet: no circles');
  assert.equal(accuracyRingsGeoJSON([input(1)], { zoom: ACCURACY_RING_MIN_ZOOM }).fc.features.length, 1);
});

test('accuracyRingsGeoJSON: bounds cull; more than the cap withholds every circle and says so; exactly the cap draws all', () => {
  const zoom = 16;
  const bounds = { w: -85.71, s: 38.19, e: -85.6998, n: 38.21 };
  const culled = accuracyRingsGeoJSON([input(0), input(5)], { zoom, bounds });
  assert.equal(culled.fc.features.length, 1, 'the stamp east of the bounds is culled');
  const many = Array.from({ length: ACCURACY_RING_CAP + 1 }, (_, i) => input(i));
  const over = accuracyRingsGeoJSON(many, { zoom });
  assert.equal(over.withheld, true);
  assert.equal(over.fc.features.length, 0, 'a partial set would read as no circle = a perfect fix');
  const atCap = accuracyRingsGeoJSON(many.slice(0, ACCURACY_RING_CAP), { zoom });
  assert.equal(atCap.withheld, false);
  assert.equal(atCap.fc.features.length, ACCURACY_RING_CAP);
  const wide = accuracyRingsGeoJSON([input(1, { accuracy: 400 })], { zoom });
  assert.equal(wide.fc.features.length, 0, 'over 250 m is not drawn');
});

test('padBounds never pads less than 0.003°, rounds to 4 places, and rejects junk', () => {
  const b = padBounds({ w: -85.7, s: 38.2, e: -85.6999, n: 38.2001 });
  assert.ok(b.w <= -85.703 && b.e >= -85.6969, 'the minimum pad');
  for (const v of [b.w, b.s, b.e, b.n]) assert.equal(Math.round(v * 1e4) / 1e4, v);
  assert.equal(b.key, `${b.w},${b.s},${b.e},${b.n}`);
  assert.equal(padBounds({ w: NaN, s: 0, e: 1, n: 1 }), null);
});

test('nextRingView: the auto-fit and two zoom-ins inside the fetched box each give the circles a new camera', () => {
  let view = { zoom: null, bounds: null };
  view = nextRingView(view, 11.2, { w: -85.9, s: 38.1, e: -85.5, n: 38.4 }); // the auto-fit
  const fitted = view;
  assert.equal(fitted.zoom, 11.2);
  view = nextRingView(view, 14, { w: -85.72, s: 38.19, e: -85.68, n: 38.22 }); // inside the fitted box
  const z14 = view;
  assert.equal(z14.zoom, 14);
  assert.ok(z14.bounds.e - z14.bounds.w < fitted.bounds.e - fitted.bounds.w, 'a smaller view');
  view = nextRingView(view, 16, { w: -85.705, s: 38.2, e: -85.695, n: 38.205 });
  assert.equal(view.zoom, 16);
  assert.ok(view.bounds.e - view.bounds.w < z14.bounds.e - z14.bounds.w);
  assert.equal(accuracyRingsGeoJSON([input(1)], fitted).fc.features.length, 0, 'none at the fitted overview');
  assert.equal(accuracyRingsGeoJSON([input(1)], view).fc.features.length, 1, 'drawn at street zoom');
  assert.equal(nextRingView(view, 16, { w: -85.705, s: 38.2, e: -85.695, n: 38.205 }), view, 'an unchanged camera keeps the object');
});
