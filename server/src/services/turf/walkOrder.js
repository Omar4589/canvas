import { hilbertSort, projectToMeters } from './spatial.js';
import { snapPoint, shortestPathFrom } from './roads/graph.js';

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Bounded 2-opt refinement of a route (projected points with x/y). Seeded from
// the Hilbert order, which is already near-optimal, so few iterations are
// needed. Only run for modest book sizes (it's O(n^2) per sweep).
//
// `cost(a, b)` is injected so the same refinement serves both metrics: straight-line
// by default, or walking distance along real streets when a road graph is available.
function twoOpt(seq, cost, maxIter = 2000) {
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
        const before = cost(a, b) + (d ? cost(c, d) : 0);
        const after = cost(a, c) + (d ? cost(b, d) : 0);
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

// How far the shortest-path search may wander, as a multiple of the book's own
// diagonal. The walk between two doors can be many times their straight-line gap —
// that is the whole reason this exists — so the bound has to be generous. Measured on
// a 1.28 km Marco book: 2x leaves 8 of 4,225 pairs unreachable, 4x leaves none and
// costs 53 ms, and unbounded costs 2,537 ms for the same answer. 4x it is.
const SEARCH_RADIUS_MULTIPLE = 4;
const MIN_SEARCH_RADIUS_M = 2000;

// Pairwise walking distances between one book's doors. Returns a cost function that
// falls back to straight-line for any pair the street network cannot connect — a door
// with a bad geocode, or one on a fragment with no link to the rest.
const roadCostFor = (graph, points) => {
  const n = points.length;
  const nodes = new Int32Array(n);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const px = graph.projection.x(points[i].lng);
    const py = graph.projection.y(points[i].lat);
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    const snapped = snapPoint(graph, px, py);
    nodes[i] = snapped.node >= 0 && graph.component[snapped.node] === graph.mainComponent ? snapped.node : -1;
  }
  const radius = Math.max(MIN_SEARCH_RADIUS_M, Math.hypot(maxX - minX, maxY - minY) * SEARCH_RADIUS_MULTIPLE);

  const matrix = new Float64Array(n * n).fill(Infinity);
  const scratch = new Float64Array(graph.nodeCount);
  const index = new Map();
  points.forEach((p, i) => index.set(p, i));
  for (let i = 0; i < n; i++) {
    if (nodes[i] < 0) continue;
    const from = shortestPathFrom(graph, nodes[i], scratch, radius);
    for (let j = 0; j < n; j++) {
      if (nodes[j] < 0) continue;
      matrix[i * n + j] = from[nodes[j]];
    }
  }
  return (a, b) => {
    const i = index.get(a);
    const j = index.get(b);
    const v = matrix[i * n + j];
    return Number.isFinite(v) ? v : dist(a, b);
  };
};

// households: [{ _id, location: { coordinates: [lng, lat] }, addressLine1 }]
// Returns an ordered array of household _id (the walk sequence). Households
// without valid coordinates are appended at the end.
//
// With `roadGraph` set the sequence follows STREETS rather than straight lines, so a
// book that legitimately wraps around a canal is walked the way you would drive it
// instead of zig-zagging across water. Without it, behaviour is exactly as before.
export function computeWalkOrder(households, { optimize = true, roadGraph = null } = {}) {
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
    const cost = roadGraph ? roadCostFor(roadGraph, seq) : dist;
    seq = twoOpt(seq.slice(), cost);
  }
  return [...seq.map((p) => p.id), ...noCoords];
}

// Total length of a walk sequence, in metres, under the same metric the order was
// built with. Exported because the printed packet re-decides its own order and has to
// score the candidates on a level field: comparing a road-aware route against a
// street-grouped one with a straight-line ruler would reject the road route precisely
// BECAUSE it correctly goes around the water.
export function walkLength(points, { roadGraph = null } = {}) {
  const usable = points.filter((p) => Number.isFinite(p?.lng) && Number.isFinite(p?.lat));
  if (usable.length < 2) return 0;
  // projectToMeters preserves input order (hilbertSort does NOT — it sorts, which would
  // silently measure a different route than the caller asked about).
  const inOrder = projectToMeters(usable);
  const cost = roadGraph ? roadCostFor(roadGraph, inOrder) : dist;
  let total = 0;
  for (let i = 1; i < inOrder.length; i++) total += cost(inOrder[i - 1], inOrder[i]);
  return total;
}
