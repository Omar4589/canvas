// Book-geometry helpers shared by the admin book screens: the enclosing outline
// (moved here from admin/book/[turfId].jsx so the assign map can reuse it — a
// dedupe, not a copy) and the density math the promoted-book sheet shows.

// Outline of the book's homes, computed from the ACTUAL coordinates so it encloses
// every house — unlike the server's stored boundary, which can miss homes added
// after it was computed. Uses a convex hull when the homes span an area; falls back
// to a small bounding box for degenerate books (<3 distinct or all-collinear homes,
// e.g. a stacked apartment) so a book with homes always shows an enclosing outline.
// Returns a closed [lng,lat] ring, or null only when there are no homes.
export function outlineRing(points) {
  return convexHull(points) || bboxRing(points);
}

// Convex hull (Andrew's monotone chain). Returns a closed ring, or null for <3
// distinct, non-collinear points (no polygon possible).
export function convexHull(points) {
  const pts = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return null;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const ring = lower.concat(upper);
  if (ring.length < 3) return null;
  ring.push(ring[0]);
  return ring;
}

// Bounding box around the points, padded to a small minimum (~80m) so it's never a
// degenerate line/point. Always encloses the points. null only when there are none.
export function bboxRing(points, pad = 0.0008) {
  if (!points.length) return null;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (maxLng - minLng < pad) { const c = (minLng + maxLng) / 2; minLng = c - pad / 2; maxLng = c + pad / 2; }
  if (maxLat - minLat < pad) { const c = (minLat + maxLat) / 2; minLat = c - pad / 2; maxLat = c + pad / 2; }
  return [[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]];
}

// Area of a closed [lng,lat] ring in acres: shoelace on an equirectangular
// projection anchored at the ring's mean latitude. Plenty accurate at book scale
// (a few city blocks); books never span enough latitude for the projection error
// to matter against a one-decimal density chip.
export function ringAreaAcres(ring) {
  if (!ring || ring.length < 4) return null; // closed ring = at least a triangle + repeat
  const meanLat = ring.reduce((s, [, lat]) => s + lat, 0) / ring.length;
  const mPerLng = 111320 * Math.cos((meanLat * Math.PI) / 180);
  const mPerLat = 110574;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    sum += lng1 * mPerLng * (lat2 * mPerLat) - lng2 * mPerLng * (lat1 * mPerLat);
  }
  const squareMeters = Math.abs(sum) / 2;
  return squareMeters / 4046.86;
}

// "8.3 doors/acre" for the promoted-book sheet. Computed from the book's own
// loaded door coordinates (not the stored display hull, which lags newly-added
// homes). Returns null when the geometry is degenerate.
export function doorsPerAcre(doorCount, ring) {
  const acres = ringAreaAcres(ring);
  if (!acres || acres <= 0) return null;
  return doorCount / acres;
}
