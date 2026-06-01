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

// Reduce a turf Feature<Polygon|MultiPolygon> to its largest-area Polygon
// geometry (so the stored boundary stays a plain Polygon). null-safe.
function largestPolygon(feature) {
  const g = feature?.geometry;
  if (!g) return null;
  if (g.type === 'Polygon') return g;
  if (g.type === 'MultiPolygon') {
    let best = null;
    let bestArea = -Infinity;
    for (const coords of g.coordinates) {
      const poly = { type: 'Polygon', coordinates: coords };
      let a = 0;
      try { a = turf.area(turf.feature(poly)); } catch { a = 0; }
      if (a > bestArea) { bestArea = a; best = poly; }
    }
    return best;
  }
  return null;
}

function padBbox([minX, minY, maxX, maxY], frac) {
  const dx = (maxX - minX) * frac || 0.01;
  const dy = (maxY - minY) * frac || 0.01;
  return [minX - dx, minY - dy, maxX + dx, maxY + dy];
}

// Tight, NON-OVERLAPPING book outlines: each book's concave hull clipped to its
// Voronoi cell (the region nearer this book's center than any other's). Disjoint
// Voronoi cells guarantee zero overlap; clipping by the hull keeps each territory
// hugging its own houses. books: [{ centroid: <Point geom|null>, households }].
// Returns Polygon geometries aligned to `books` (plain hull as the fallback).
export function computeTerritories(books) {
  const hulls = books.map((b) => computeBoundary(b.households));
  if (books.length < 2) return hulls;

  const idxWithCentroid = [];
  const ptFeatures = [];
  books.forEach((b, i) => {
    const c = b.centroid?.coordinates;
    if (Array.isArray(c) && c.length === 2) {
      idxWithCentroid.push(i);
      ptFeatures.push(turf.point(c));
    }
  });
  if (ptFeatures.length < 2) return hulls;

  // bbox from all houses (padded) so the edge Voronoi cells fully cover the hulls.
  const allPts = [];
  for (const b of books) {
    for (const h of b.households) {
      const co = h.location?.coordinates;
      if (Array.isArray(co) && co.length === 2) allPts.push(turf.point(co));
    }
  }
  let cells;
  try {
    const bb = padBbox(turf.bbox(turf.featureCollection(allPts.length ? allPts : ptFeatures)), 0.5);
    cells = turf.voronoi(turf.featureCollection(ptFeatures), { bbox: bb });
  } catch {
    return hulls;
  }

  const territories = hulls.slice();
  idxWithCentroid.forEach((bookIdx, j) => {
    const cell = cells?.features?.[j];
    const hull = hulls[bookIdx];
    if (!cell || !hull) return;
    try {
      const clipped = turf.intersect(turf.featureCollection([turf.feature(hull), cell]));
      const poly = largestPolygon(clipped);
      if (poly) territories[bookIdx] = poly;
    } catch {
      // keep the plain hull for this book
    }
  });
  return territories;
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
