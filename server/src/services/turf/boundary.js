import * as turf from '@turf/turf';

// Display boundary for a book: concave hull with a relaxing maxEdge ladder,
// falling back to convex, then a small buffered circle for degenerate books.
// Overlapping hulls between adjacent books are acceptable (display only).
//
// Every rung must CONTAIN all of the book's houses. turf.concave triangulates and
// discards edges longer than maxEdge, so an outlying house can be triangulated away
// — and the result is still a valid Polygon. Returning on "is a Polygon" alone
// therefore accepted hulls that visibly excluded their own doors, and the relaxing
// ladder never got its chance (measured: 1 of 13 houses outside at 0.4km, 0 at 1.2km).
// Convex is the floor: it contains every input point by construction.
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
  const containsAll = (geometry) => pts.every((p) => safeContains(geometry, p));
  for (const edge of [maxEdgeKm, maxEdgeKm * 1.5, maxEdgeKm * 3]) {
    try {
      const hull = turf.concave(fc, { units: 'kilometers', maxEdge: edge });
      if (hull?.geometry?.type === 'Polygon' && containsAll(hull.geometry)) return hull.geometry;
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

function padBbox([minX, minY, maxX, maxY], frac) {
  const dx = (maxX - minX) * frac || 0.01;
  const dy = (maxY - minY) * frac || 0.01;
  return [minX - dx, minY - dy, maxX + dx, maxY + dy];
}

// Tight, NON-OVERLAPPING book outlines that CONTAIN every one of their own doors:
//
//   territory_i = hull_i ∩ union(Voronoi cells of book i's OWN doors)
//
// with the Voronoi diagram computed over ALL booked doors of the pass — not one seed per
// book. Every door is inside its own cell by definition and inside its hull (computeBoundary
// verifies containment), so it's inside the intersection; cells are disjoint across books, so
// territories never overlap. Both properties hold at once — the earlier centroid-seeded clip
// (one cell per book) could not do this, and doors nearer a NEIGHBOR's centroid fell outside
// their own book's outline.
//
// Visual consequence, by design: a door surrounded by another book's houses gets a small
// POCKET of its own book's territory (a MultiPolygon island), and the surrounding book's
// shape carries a matching hole — which is exactly how the map answers "whose door is that?".
//
// books: [{ households, centroid? }]. Returns Polygon|MultiPolygon geometries aligned to
// `books` (plain hull as the per-book fallback — containment beats disjointness on failure).
// Measured at production scale (16.5k doors / 128 books): ~1.6s, 0 doors outside, 0 m²
// overlap. Deterministic (no randomness), so worker re-runs reproduce identical shapes.
//
// onlyIndices (Set<number>|null): compute the diagram over ALL books' doors (seams depend on
// everyone) but run the expensive per-book union/intersect ONLY for these indices — the rest
// return undefined so the caller leaves their stored shapes alone. Safe because a door MOVE
// doesn't change the diagram (only cell ownership flips → untouched books' shapes stay exactly
// right), and a door REMOVAL only grows the remaining cells (untouched books' stored shapes
// stay strictly inside their new entitlement → still disjoint, still containing).
export function computeTerritories(books, { onlyIndices = null } = {}) {
  const need = (i) => !onlyIndices || onlyIndices.has(i);
  const hulls = books.map((b, i) => (need(i) ? computeBoundary(b.households) : null));
  if (books.length < 2) return hulls;

  // All booked doors, deduped by exact coordinate (apartment stacks share a geocode; a
  // coordinate split across two books can't be strictly inside both disjoint shapes, so the
  // first book seen owns the cell — the dot ring and popup stay truthful for the others).
  const seen = new Set();
  const pts = [];
  const ownerOf = [];
  books.forEach((b, bi) => {
    for (const h of b.households) {
      const c = h.location?.coordinates;
      if (!Array.isArray(c) || c.length !== 2) continue;
      const k = `${c[0]}|${c[1]}`;
      if (seen.has(k)) continue;
      seen.add(k);
      pts.push(turf.point(c));
      ownerOf.push(bi);
    }
  });
  if (pts.length < 2) return hulls;

  let cells;
  try {
    const bb = padBbox(turf.bbox(turf.featureCollection(pts)), 0.5);
    cells = turf.voronoi(turf.featureCollection(pts), { bbox: bb });
  } catch {
    return hulls;
  }

  // Voronoi output is index-aligned with its input points; duplicates/degenerates come back
  // null and are simply skipped (their doors are still covered by the hull fallback path).
  const cellsByBook = books.map(() => []);
  (cells?.features || []).forEach((cell, i) => {
    if (cell && need(ownerOf[i])) cellsByBook[ownerOf[i]].push(cell);
  });

  return books.map((b, i) => {
    if (!need(i)) return undefined; // caller must not overwrite this book's stored shape
    const hull = hulls[i];
    if (!hull || !cellsByBook[i].length) return hull;
    try {
      const cellUnion =
        cellsByBook[i].length === 1
          ? cellsByBook[i][0]
          : turf.union(turf.featureCollection(cellsByBook[i]));
      if (!cellUnion) return hull;
      const territory = turf.intersect(turf.featureCollection([turf.feature(hull), cellUnion]));
      // Keep the WHOLE geometry — reducing a MultiPolygon to its largest polygon would
      // drop exactly the pocket islands this construction exists to draw.
      return territory?.geometry || hull;
    } catch {
      return hull; // containment over disjointness in the failure path
    }
  });
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
