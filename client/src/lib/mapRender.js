// Shared Mapbox rendering helpers, extracted from pages/MapPage.jsx so the admin map and
// the read-only client report map render identical pins from the same code. Pure functions
// (no React, no data fetching) plus registerLayers(), which (re)creates the Mapbox sources/
// layers/images. STATUS_COLORS is the single palette source (lib/statusColors.js) — the same
// hexes drive the canvas house icons here and the chart/legend colors elsewhere.

import { STATUS_COLORS } from './statusColors.js';

// Render a modern two-tone house icon — rounded body in the status color, a
// slightly darker roof, a small white door + window, and a soft drop shadow.
// One pre-colored ImageData per status; we ship our own because the
// streets-v12 sprite no longer bundles Maki icons.
export function darkenHex(hex, amount = 0.2) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - amount)));
  return `rgb(${r},${g},${b})`;
}

export function drawHouseIcon(color, size = 64) {
  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const darker = darkenHex(color);

  // Drop shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.beginPath();
  ctx.ellipse(size / 2, size - 4, 19, 2.8, 0, 0, Math.PI * 2);
  ctx.fill();

  // House body (walls) — rounded rectangle in the status color
  ctx.beginPath();
  ctx.roundRect(11, 28, 42, 26, 3);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Roof — darker shade of the same color, rounded peak
  ctx.beginPath();
  ctx.moveTo(6, 30);
  ctx.lineTo(31, 8);
  ctx.quadraticCurveTo(32, 7, 33, 8);
  ctx.lineTo(58, 30);
  ctx.closePath();
  ctx.fillStyle = darker;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Small window (left)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(17, 34, 9, 9, 1.5);
  ctx.fill();
  // Window cross
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(21.5, 34);
  ctx.lineTo(21.5, 43);
  ctx.moveTo(17, 38.5);
  ctx.lineTo(26, 38.5);
  ctx.stroke();

  // Door (right of center)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(32, 38, 11, 16, 1.5);
  ctx.fill();
  // Door knob
  ctx.fillStyle = darker;
  ctx.beginPath();
  ctx.arc(41, 47, 0.9, 0, Math.PI * 2);
  ctx.fill();

  return ctx.getImageData(0, 0, size * dpr, size * dpr);
}

export function householdsToGeoJSON(households) {
  return {
    type: 'FeatureCollection',
    features: households
      .filter((h) => h.location?.lng != null && h.location?.lat != null)
      .map((h) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [h.location.lng, h.location.lat],
        },
        properties: {
          id: h.id,
          status: h.status,
        },
      })),
  };
}

export function initialsFor(canvasser) {
  if (!canvasser) return '';
  const f = (canvasser.firstName || '').trim();
  const l = (canvasser.lastName || '').trim();
  const initials = `${f[0] || ''}${l[0] || ''}`.toUpperCase();
  return initials || (f[0] || l[0] || '').toUpperCase();
}

export function activitiesToPingsGeoJSON(activities) {
  return {
    type: 'FeatureCollection',
    features: activities
      .filter((a) => a.location?.lng != null && a.location?.lat != null)
      .map((a) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [a.location.lng, a.location.lat],
        },
        properties: {
          activityId: a.id,
          actionType: a.actionType,
          initials: initialsFor(a.canvasser),
        },
      })),
  };
}

export function activitiesToLinesGeoJSON(activities, householdsById) {
  const features = [];
  for (const a of activities) {
    if (a.location?.lng == null || a.location?.lat == null) continue;
    const h = householdsById.get(a.householdId);
    if (!h?.location) continue;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [a.location.lng, a.location.lat],
          [h.location.lng, h.location.lat],
        ],
      },
      properties: { activityId: a.id },
    });
  }
  return { type: 'FeatureCollection', features };
}

export const EMPTY_FC = { type: 'FeatureCollection', features: [] };

// (Re)create all sources/layers/images. Called on initial `load` AND after every
// `setStyle` (a style swap wipes custom sources/layers/images), so the basemap can
// be switched at runtime. `dark` lightens the unknocked pin + ping lines for
// contrast on dark/satellite basemaps. Layer event handlers are bound once at init
// (they survive style swaps), so this only handles sources/layers/images.
//
// withCanvassers=false skips the canvasser ping/line/label layers entirely — used by
// the client report map, which has no canvasser identity to show.
export function registerLayers(map, dark, { withCanvassers = true } = {}) {
  for (const status of Object.keys(STATUS_COLORS)) {
    const id = `house-${status}`;
    const color = status === 'unknocked' && dark ? '#d1d5db' : STATUS_COLORS[status];
    if (map.hasImage(id)) map.removeImage(id);
    map.addImage(id, drawHouseIcon(color), { pixelRatio: 2 });
  }

  map.addSource('households', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'households-symbols',
    type: 'symbol',
    source: 'households',
    layout: {
      'icon-image': [
        'match', ['get', 'status'],
        'unknocked', 'house-unknocked',
        'not_home', 'house-not_home',
        'surveyed', 'house-surveyed',
        'wrong_address', 'house-wrong_address',
        'lit_dropped', 'house-lit_dropped',
        'house-unknocked',
      ],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.22, 14, 0.34, 17, 0.48],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });

  if (!withCanvassers) return;

  // Canvasser GPS pings + dashed lines, inserted BELOW the household symbols.
  map.addSource('canvasser-lines', { type: 'geojson', data: EMPTY_FC });
  map.addLayer(
    {
      id: 'canvasser-lines',
      type: 'line',
      source: 'canvasser-lines',
      paint: {
        'line-color': dark ? '#9ca3af' : '#6b7280',
        'line-width': 1,
        'line-opacity': 0.45,
        'line-dasharray': [2, 2],
      },
    },
    'households-symbols'
  );

  map.addSource('canvasser-pings', { type: 'geojson', data: EMPTY_FC });
  map.addLayer(
    {
      id: 'canvasser-pings',
      type: 'circle',
      source: 'canvasser-pings',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 7, 13, 10, 16, 13, 18, 15],
        'circle-color': [
          'match', ['get', 'actionType'],
          'survey_submitted', STATUS_COLORS.surveyed,
          'not_home', STATUS_COLORS.not_home,
          'wrong_address', STATUS_COLORS.wrong_address,
          'lit_dropped', STATUS_COLORS.lit_dropped,
          '#6b7280',
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    },
    'households-symbols'
  );

  map.addLayer(
    {
      id: 'canvasser-labels',
      type: 'symbol',
      source: 'canvasser-pings',
      layout: {
        'text-field': ['get', 'initials'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 8, 13, 11, 16, 13],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0, 0, 0, 0.35)',
        'text-halo-width': 0.8,
      },
    },
    'households-symbols'
  );
}
