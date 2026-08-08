// Shared Mapbox rendering helpers, extracted from pages/MapPage.jsx so the admin map and
// the read-only client report map render identical pins from the same code. Pure functions
// (no React, no data fetching) plus registerLayers(), which (re)creates the Mapbox sources/
// layers/images. STATUS_COLORS is the single palette source (lib/statusColors.js) — the same
// hexes drive the canvas house icons here and the chart/legend colors elsewhere.

import { STATUS_COLORS } from './statusColors.js';
import { REASON_BY_KEY, primaryReason } from './flags.js';

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
          // Pin provenance — drives the "approximate" ring + detail badge.
          coordConfidence: h.coordConfidence || '',
          coordSource: h.coordSource || '',
        },
      })),
  };
}

// Overlap doors → point features for the ring highlight. Only the households currently
// loaded (so we have their coordinates) whose id is in the overlap set are ringed — the
// /overlap-doors endpoint returns ids only, and we already hold the coordinates on the map.
export function overlapDoorsToGeoJSON(households, overlapIds) {
  const set = overlapIds instanceof Set ? overlapIds : new Set(overlapIds || []);
  return {
    type: 'FeatureCollection',
    features: households
      .filter((h) => set.has(h.id) && h.location?.lng != null && h.location?.lat != null)
      .map((h) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [h.location.lng, h.location.lat] },
        properties: { id: h.id },
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

// Flagged entries → GPS-point features, colored by worst reason. `reviewed` fades actioned
// flags so open ones pop.
export function flagsToGeoJSON(entries) {
  return {
    type: 'FeatureCollection',
    features: (entries || [])
      .filter((e) => e.location?.lng != null && e.location?.lat != null)
      .map((e) => {
        const pr = primaryReason(e);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [e.location.lng, e.location.lat] },
          properties: {
            actionId: e.actionId,
            reason: pr?.type || '',
            color: REASON_BY_KEY[pr?.type]?.color || '#ef4444',
            severity: e.maxSeverity || 'med',
            reviewed: e.review?.status && e.review.status !== 'open' ? 1 : 0,
          },
        };
      }),
  };
}

// A dashed line from each flag's GPS point to its house pin (so a "far" flag visibly
// connects the ping to the door it belongs to).
//
// The pin end is the house's CURRENT coordinate, which may post-date the entry if someone
// corrected the pin after the door was recorded — the app stores no historical pin, so there
// is nothing else to draw to. That's why FlaggedEntryPanel labels both distances ("from the
// pin at the time" / "from the pin's current spot") whenever they differ: the line and the
// panel used to silently contradict each other after a correction.
export function flagsToLinesGeoJSON(entries) {
  const features = [];
  for (const e of entries || []) {
    if (e.location?.lng == null || e.location?.lat == null) continue;
    const hp = e.household?.location;
    if (!hp || hp.lng == null || hp.lat == null) continue;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [e.location.lng, e.location.lat],
          [hp.lng, hp.lat],
        ],
      },
      properties: { actionId: e.actionId, color: REASON_BY_KEY[primaryReason(e)?.type]?.color || '#ef4444' },
    });
  }
  return { type: 'FeatureCollection', features };
}

// A single-point FeatureCollection for one activity (or empty when null) — powers the
// first/last-knock highlight markers (the ping where a canvasser started vs their latest).
export function pointToGeoJSON(activity) {
  if (activity?.location?.lng == null || activity?.location?.lat == null) return EMPTY_FC;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [activity.location.lng, activity.location.lat] },
        properties: { activityId: activity.id },
      },
    ],
  };
}

// The first/last-knock highlight colors — deliberately OUTSIDE the status palette
// (green/blue/red/amber/purple/gray) so they read as route endpoints, not statuses.
export const FIRST_KNOCK_COLOR = '#0891b2'; // cyan
export const LAST_KNOCK_COLOR = '#db2777'; // pink

// (Re)create all sources/layers/images. Called on initial `load` AND after every
// `setStyle` (a style swap wipes custom sources/layers/images), so the basemap can
// be switched at runtime. `dark` lightens the unknocked pin + ping lines for
// contrast on dark/satellite basemaps. Layer event handlers are bound once at init
// (they survive style swaps), so this only handles sources/layers/images.
//
// withCanvassers=false skips the canvasser ping/line/label layers entirely — used by
// the client report map, which has no canvasser identity to show.
export function registerLayers(map, dark, { withCanvassers = true } = {}) {
  // Idempotency backstop: registering twice on one style (e.g. stacked
  // style.load handlers) would throw mapbox's duplicate-source error.
  if (map.getSource('households')) return;

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
        'refused', 'house-refused',
        'restricted', 'house-restricted',
        'no_soliciting', 'house-no_soliciting',
        'lit_dropped', 'house-lit_dropped',
        'house-unknocked',
      ],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.22, 14, 0.34, 17, 0.48],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });

  // Amber "approximate" ring under any interpolated (non-rooftop) geocode, so admins
  // can spot the pins most likely to be off and correct them. Below the house icon.
  map.addLayer(
    {
      id: 'household-approx-ring',
      type: 'circle',
      source: 'households',
      filter: ['==', ['get', 'coordConfidence'], 'interpolated'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 13, 17, 18],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': '#f59e0b',
        'circle-stroke-width': 2,
        'circle-stroke-opacity': 0.9,
      },
    },
    'households-symbols'
  );

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
          'refused', STATUS_COLORS.refused,
          'restricted', STATUS_COLORS.restricted,
          'no_soliciting', STATUS_COLORS.no_soliciting,
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

  // First & last knock — when auditing ONE canvasser, ring their earliest ping ("Start")
  // and most-recent ping ("Latest") so you can see where they began and where they are now.
  // Rendered ON TOP (no beforeId) as a hollow ring + a labeled text badge; empty until a
  // single canvasser is selected (MapPage pushes the data).
  for (const [key, color, label] of [
    ['first-knock', FIRST_KNOCK_COLOR, 'Start'],
    ['last-knock', LAST_KNOCK_COLOR, 'Latest'],
  ]) {
    map.addSource(key, { type: 'geojson', data: EMPTY_FC });
    map.addLayer({
      id: `${key}-ring`,
      type: 'circle',
      source: key,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 12, 13, 16, 16, 20, 18, 24],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': color,
        'circle-stroke-width': 3,
      },
    });
    map.addLayer({
      id: `${key}-label`,
      type: 'symbol',
      source: key,
      layout: {
        'text-field': label,
        'text-size': 12,
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-offset': [0, -2.1],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': color,
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.4,
      },
    });
  }

  // Overlap highlight — doors worked by 2+ distinct canvassers in the same pass (a turf
  // collision / potential double-count). A hollow amber ring AROUND the existing house icon
  // (not a new pin, never clustered), toggled from MapFilters. Empty until MapPage pushes the
  // overlapping doors currently in view.
  map.addSource('overlap-doors', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'overlap-doors-ring',
    type: 'circle',
    source: 'overlap-doors',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 10, 13, 14, 16, 18, 18, 22],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': '#f59e0b',
      'circle-stroke-width': 3,
      'circle-stroke-opacity': 0.95,
    },
  });

  // Selection highlight — a bold ring around the door the admin last tapped or focused
  // via a Notes "view on map" link. On top; MapPage pushes the single selected point.
  map.addSource('selected-household', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'selected-household-ring',
    type: 'circle',
    source: 'selected-household',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 12, 13, 16, 16, 20, 18, 24],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': '#2563eb',
      'circle-stroke-width': 4,
    },
  });

  // GPS-audit flag overlay — colored by the worst reason, rendered ON TOP so flagged
  // entries stand out during a review. A soft halo + a ringed dot read as an alert (not a
  // status pin), with a dashed line back to the house. Empty until MapPage pushes flags.
  map.addSource('flagged-lines', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'flagged-lines',
    type: 'line',
    source: 'flagged-lines',
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 1.5,
      'line-opacity': 0.7,
      'line-dasharray': [2, 1.5],
    },
  });
  map.addSource('flagged-pings', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'flagged-halo',
    type: 'circle',
    source: 'flagged-pings',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 12, 14, 18, 17, 24],
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.18,
    },
  });
  map.addLayer({
    id: 'flagged-pings',
    type: 'circle',
    source: 'flagged-pings',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 13, 7, 16, 9, 18, 11],
      'circle-color': ['get', 'color'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['case', ['==', ['get', 'severity'], 'high'], 3, 2],
      // Actioned flags fade back so still-open ones pop.
      'circle-opacity': ['case', ['==', ['get', 'reviewed'], 1], 0.45, 1],
    },
  });
}
