// Local geometry helpers for turf cutting. We project lng/lat to a local
// equirectangular plane (meters) around the point set's centroid — accurate
// enough at city scale — then use a Hilbert space-filling curve for contiguous
// spatial ordering / chunking.

const R = 6371000; // earth radius (m)

// points: [{ lng, lat, ... }] -> same objects with { x, y } in meters added.
export function projectToMeters(points) {
  if (!points.length) return [];
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng0 = points.reduce((s, p) => s + p.lng, 0) / points.length;
  const cos0 = Math.cos((lat0 * Math.PI) / 180);
  return points.map((p) => ({
    ...p,
    x: ((p.lng - lng0) * Math.PI) / 180 * R * cos0,
    y: ((p.lat - lat0) * Math.PI) / 180 * R,
  }));
}

// Hilbert d-index for integer grid coords on an n×n grid (n = 2^order).
export function hilbertIndex(x, y, order) {
  const n = 1 << order;
  let rx;
  let ry;
  let d = 0;
  let px = x;
  let py = y;
  for (let s = n >> 1; s > 0; s >>= 1) {
    rx = (px & s) > 0 ? 1 : 0;
    ry = (py & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        px = n - 1 - px;
        py = n - 1 - py;
      }
      const t = px;
      px = py;
      py = t;
    }
  }
  return d;
}

// Project + sort points along a Hilbert curve. Returns the points (with x/y/h
// added) in contiguous spatial order.
export function hilbertSort(points, order = 16) {
  const proj = projectToMeters(points);
  if (proj.length <= 1) return proj;
  const xs = proj.map((p) => p.x);
  const ys = proj.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const n = 1 << order;
  const sx = maxX > minX ? (n - 1) / (maxX - minX) : 0;
  const sy = maxY > minY ? (n - 1) / (maxY - minY) : 0;
  return proj
    .map((p) => ({
      ...p,
      h: hilbertIndex(Math.round((p.x - minX) * sx), Math.round((p.y - minY) * sy), order),
    }))
    .sort((a, b) => a.h - b.h);
}

export function centroid(points) {
  if (!points.length) return null;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  return { lng, lat };
}
