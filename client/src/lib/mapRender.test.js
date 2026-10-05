import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATUS_COLORS } from './statusColors.js';
import { activitiesToPingsGeoJSON, flagsToGeoJSON, PING_COLOR_BY_ACTION, PING_COLOR_DEFAULT, pingColorFor, registerLayers } from './mapRender.js';

// The admin map's accuracy circles (docs/PROPOSAL_GPS_UPGRADES.md §H.4) as the map layers see them:
// which points carry an accuracy, where the circle layers sit in the stack, and that MapPage reads
// the circles' camera from a handler that sees every zoom-in.

test('pings and flags carry accuracy only when it is a positive number', () => {
  const at = (accuracy) => ({ lng: -85.7, lat: 38.2, accuracy });
  const pings = activitiesToPingsGeoJSON([null, 0, -1, 12].map((a, i) => ({ id: `a${i}`, actionType: 'not_home', location: at(a) })));
  assert.deepEqual(pings.features.map((f) => f.properties.accuracy), [undefined, undefined, undefined, 12]);
  const flags = flagsToGeoJSON([null, 0, -1, 12].map((a, i) => ({ actionId: `f${i}`, reasons: [], location: at(a) })));
  assert.deepEqual(flags.features.map((f) => f.properties.accuracy), [undefined, undefined, undefined, 12]);
});

test('the ping dot colour and its circle colour come from one table', () => {
  assert.deepEqual(PING_COLOR_BY_ACTION, {
    survey_submitted: STATUS_COLORS.surveyed,
    not_home: STATUS_COLORS.not_home,
    wrong_address: STATUS_COLORS.wrong_address,
    refused: STATUS_COLORS.refused,
    restricted: STATUS_COLORS.restricted,
    no_soliciting: STATUS_COLORS.no_soliciting,
    not_target: STATUS_COLORS.not_target,
    lit_dropped: STATUS_COLORS.lit_dropped,
  });
  assert.equal(PING_COLOR_DEFAULT, '#6b7280');
  assert.equal(pingColorFor('refused'), STATUS_COLORS.refused);
  assert.equal(pingColorFor('note_added'), PING_COLOR_DEFAULT);
});

// A fake map that keeps layers in style order (addLayer(layer, beforeId) inserts before), records
// every handler binding, and a canvas stub for the house and building icons.
const fakeMap = () => {
  const layers = [];
  const sources = new Map();
  const bindings = [];
  return {
    layers,
    bindings,
    getSource: (id) => sources.get(id),
    addSource: (id, s) => sources.set(id, s),
    getLayer: (id) => layers.find((l) => l.id === id),
    addLayer: (layer, beforeId) => {
      const i = beforeId ? layers.findIndex((l) => l.id === beforeId) : -1;
      if (beforeId && i === -1) throw new Error(`no layer ${beforeId} to insert before`);
      if (i === -1) layers.push(layer);
      else layers.splice(i, 0, layer);
    },
    hasImage: () => false,
    removeImage: () => {},
    addImage: () => {},
    on: (...args) => bindings.push(args),
  };
};
const withCanvas = (fn) => {
  const ctx = new Proxy(
    {},
    {
      get: (_, prop) =>
        prop === 'getImageData'
          ? () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) })
          : prop === 'createLinearGradient' || prop === 'createRadialGradient'
            ? () => ({ addColorStop: () => {} })
            : () => {},
      set: () => true,
    }
  );
  const saved = { document: globalThis.document, window: globalThis.window };
  globalThis.document = { createElement: () => ({ getContext: () => ctx, width: 0, height: 0 }) };
  globalThis.window = { devicePixelRatio: 1 };
  try {
    return fn();
  } finally {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
  }
};

test('registerLayers puts both circle layers below every ping, flag and house layer and binds nothing to them', () => {
  const map = withCanvas(() => {
    const m = fakeMap();
    registerLayers(m, false);
    return m;
  });
  const order = map.layers.map((l) => l.id);
  const idx = (id) => {
    const i = order.indexOf(id);
    assert.ok(i >= 0, `layer ${id} registered`);
    return i;
  };
  assert.deepEqual(order.slice(0, 2), ['accuracy-rings-fill', 'accuracy-rings-line'], 'the bottom of the app stack');
  for (const above of ['household-approx-ring', 'canvasser-lines', 'canvasser-pings', 'households-symbols', 'building-symbols', 'flagged-halo', 'flagged-pings']) {
    assert.ok(idx('accuracy-rings-line') < idx(above), `circles below ${above}`);
  }
  assert.equal(map.layers.find((l) => l.id === 'accuracy-rings-fill').minzoom, 13);
  assert.equal(map.bindings.length, 0, 'registerLayers binds no handler at all');
});

test('withCanvassers: false adds no circle layers', () => {
  const map = withCanvas(() => {
    const m = fakeMap();
    registerLayers(m, false, { withCanvassers: false });
    return m;
  });
  assert.ok(!map.layers.some((l) => String(l.id).startsWith('accuracy-rings')));
  assert.equal(map.getSource('accuracy-rings'), undefined);
});

test('MapPage reads the circles camera from its own moveend handler, never the gated bbox handler', () => {
  const src = readFileSync(new URL('../pages/MapPage.jsx', import.meta.url), 'utf8');
  assert.match(src, /map\.on\('moveend', onRingView\)/, 'bound to every moveend');
  const handler = src.slice(src.indexOf('const onRingView = () => {'), src.indexOf("map.on('moveend', onRingView)"));
  assert.ok(handler.includes('map.getZoom()') && handler.includes('map.getBounds()') && handler.includes('nextRingView('));
  assert.ok(!/_didFitBounds|paddedBboxRef|setBbox/.test(handler), 'not gated like the bbox handler, which skips every zoom-in');
  const load = src.slice(src.indexOf("map.on('load', () => {"), src.indexOf('return () => {', src.indexOf("map.on('load', () => {")));
  assert.ok(load.includes('onRingView();'), 'called once on load');
  assert.match(src, /accuracyRingsGeoJSON\(ringInputsFromPoints\(pingFC, flagFC, pingColorFor\), \{ bounds: ringView\.bounds, zoom: ringView\.zoom \}\)/);
});
