import * as turf from '@turf/turf';

// Display boundary for a book: concave hull with a relaxing maxEdge ladder,
// falling back to convex, then a small buffered circle for degenerate books.
// Overlapping hulls between adjacent books are acceptable (display only).
export function computeBoundary(households, { maxEdgeKm = 0.4 } = {}) {
  const pts = households
    .filter((h) => h.location?.coordinates?.length === 2)
    .map((h) => turf.point(h.location.coordinates));
  if (pts.length < 3) {
    if (!pts.length) return null;
    const c = turf.center(turf.featureCollection(pts));
    const circle = turf.buffer(c, 0.05, { units: 'kilometers' });
    return circle?.geometry?.type === 'Polygon' ? circle.geometry : null;
  }
  const fc = turf.featureCollection(pts);
  for (const edge of [maxEdgeKm, maxEdgeKm * 1.5, maxEdgeKm * 3]) {
    try {
      const hull = turf.concave(fc, { units: 'kilometers', maxEdge: edge });
      if (hull?.geometry?.type === 'Polygon') return hull.geometry;
    } catch {
      // try a looser edge
    }
  }
  try {
    const cx = turf.convex(fc);
    if (cx?.geometry?.type === 'Polygon') return cx.geometry;
  } catch {
    // fall through
  }
  return null;
}

export function computeCentroid(households) {
  const pts = households
    .filter((h) => h.location?.coordinates?.length === 2)
    .map((h) => turf.point(h.location.coordinates));
  if (!pts.length) return null;
  const c = turf.center(turf.featureCollection(pts));
  return c?.geometry?.type === 'Point' ? c.geometry : null;
}

function safeContains(boundary, pt) {
  try {
    return turf.booleanPointInPolygon(pt, boundary);
  } catch {
    return false;
  }
}

// Unified resolver (decision P1-2): assign a point to one of `turfs` — a turf
// that contains it, else the nearest by centroid. turfs: [{ _id, boundary, centroid }].
export function assignHouseholdToTurf(coordinates, turfs) {
  if (!coordinates || !turfs?.length) return null;
  const pt = turf.point(coordinates);
  const containing = turfs.filter((t) => t.boundary && safeContains(t.boundary, pt));
  const pool = containing.length ? containing : turfs;

  let best = null;
  let bestD = Infinity;
  for (const t of pool) {
    const c = t.centroid?.coordinates;
    if (!c) continue;
    const d = turf.distance(pt, turf.point(c), { units: 'kilometers' });
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return (best || pool[0])?._id || null;
}
