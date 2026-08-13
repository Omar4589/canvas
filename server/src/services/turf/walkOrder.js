import { hilbertSort } from './spatial.js';

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Bounded 2-opt refinement of a route (projected points with x/y). Seeded from
// the Hilbert order, which is already near-optimal, so few iterations are
// needed. Only run for modest book sizes (it's O(n^2) per sweep).
function twoOpt(seq, maxIter = 2000) {
  const n = seq.length;
  let improved = true;
  let iter = 0;
  while (improved && iter < maxIter) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const a = seq[i - 1];
        const b = seq[i];
        const c = seq[k];
        const d = seq[k + 1];
        const before = dist(a, b) + (d ? dist(c, d) : 0);
        const after = dist(a, c) + (d ? dist(b, d) : 0);
        if (after + 1e-9 < before) {
          let lo = i;
          let hi = k;
          while (lo < hi) {
            const t = seq[lo];
            seq[lo] = seq[hi];
            seq[hi] = t;
            lo += 1;
            hi -= 1;
          }
          improved = true;
          iter += 1;
          if (iter >= maxIter) return seq;
        }
      }
    }
  }
  return seq;
}

// households: [{ _id, location: { coordinates: [lng, lat] }, addressLine1 }]
// Returns an ordered array of household _id (the walk sequence). Households
// without valid coordinates are appended at the end.
export function computeWalkOrder(households, { optimize = true } = {}) {
  const withCoords = [];
  const noCoords = [];
  for (const h of households) {
    if (h.location?.coordinates?.length === 2) {
      withCoords.push({ id: h._id, lng: h.location.coordinates[0], lat: h.location.coordinates[1] });
    } else {
      noCoords.push(h._id);
    }
  }
  if (!withCoords.length) return noCoords;

  let seq = hilbertSort(withCoords); // contiguous spatial order (has x/y)
  if (optimize && seq.length >= 8 && seq.length <= 400) {
    seq = twoOpt(seq.slice());
  }
  return [...seq.map((p) => p.id), ...noCoords];
}
