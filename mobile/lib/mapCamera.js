// Pure camera helpers for the admin Books map (app/(app)/admin/books.jsx) and the
// book-detail map (app/(app)/admin/book/[turfId].jsx). No react-native imports on
// purpose: this file runs under `npm run test:mobile` (see mapCamera.test.js).

// The neutral default the canvasser picker and the admin Map already open on while
// nothing is known yet (they keep their own copies; this one is the shared source).
export const DEFAULT_CENTER = [-84.5, 39.0];

const isPoint = (c) =>
  Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]);

// Bounding box of the usable points ([lng, lat] pairs — anything else is ignored), or
// null when there are none. `single` = every usable point is the same spot (or there
// is just one), where fitBounds has nothing to fit and the caller centers instead.
export const boundsOf = (points) => {
  const pts = (points || []).filter(isPoint);
  if (!pts.length) return null;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of pts) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { ne: [maxLng, maxLat], sw: [minLng, minLat], single: minLng === maxLng && minLat === maxLat };
};

// A camera to open on BEFORE the fit lands (Mapbox.Camera `defaultSettings`): the
// bounding-box center of the points at a county-ish zoom, the one point itself, or the
// fallback at a wide zoom when nothing is known yet. Read once, at the camera's
// creation, so it only has to be a reasonable first frame — the fit refines it.
export const cameraSeed = (points, fallback = DEFAULT_CENTER) => {
  const b = boundsOf(points);
  if (!b) return { centerCoordinate: fallback, zoomLevel: 9 };
  if (b.single) return { centerCoordinate: b.ne, zoomLevel: 14 };
  return {
    centerCoordinate: [(b.ne[0] + b.sw[0]) / 2, (b.ne[1] + b.sw[1]) / 2],
    zoomLevel: 10,
  };
};
