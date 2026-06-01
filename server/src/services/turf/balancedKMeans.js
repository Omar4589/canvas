import { hilbertSort } from './spatial.js';

// Capacity-balanced k-means over geo points → compact, near-equal-sized clusters
// (tight, walkable "i360-style" books). The plain Hilbert-chunk cut balances
// COUNTS but severs the curve at arbitrary points, so a house near a chunk edge
// can land in a book whose center is farther than a neighbor's. This assigns
// every house to its NEAREST book that still has room, then polishes boundaries.
//
// Deterministic — projection + seeds come from the Hilbert curve, never
// Math.random — so a worker re-run reproduces the same books.
//
// items: [{ doc, lng, lat }] (all must have coords). maxDoors: target cap/book.
// Returns: array of clusters, each an array of the original `doc`s.

const MAX_ITERS = 40;
const POLISH_SWEEPS = 6;

const dist2 = (p, c) => {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return dx * dx + dy * dy;
};

function computeCentroids(pts, labels, k) {
  const sx = new Array(k).fill(0);
  const sy = new Array(k).fill(0);
  const cnt = new Array(k).fill(0);
  for (let i = 0; i < pts.length; i++) {
    const c = labels[i];
    sx[c] += pts[i].x;
    sy[c] += pts[i].y;
    cnt[c] += 1;
  }
  const cents = new Array(k);
  for (let c = 0; c < k; c++) cents[c] = cnt[c] ? { x: sx[c] / cnt[c], y: sy[c] / cnt[c] } : null;
  return cents;
}

// Balanced assignment (equal-size k-means step): each point goes to its
// most-preferred centroid that still has spare capacity. Points are processed by
// how strongly they prefer their best over their second-best (d2 - d1), so the
// "most decided" houses get their first choice and ambiguous ones absorb the
// capacity pressure — keeps clusters both compact and balanced.
function balancedAssign(pts, centroids, capacity) {
  const k = centroids.length;
  const entries = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const ds = new Array(k);
    for (let c = 0; c < k; c++) ds[c] = { c, d: dist2(pts[i], centroids[c]) };
    ds.sort((a, b) => a.d - b.d);
    const order = new Array(k);
    for (let c = 0; c < k; c++) order[c] = ds[c].c;
    entries[i] = { i, order, pref: (ds[1] ? ds[1].d : ds[0].d) - ds[0].d };
  }
  entries.sort((a, b) => b.pref - a.pref);

  const counts = new Array(k).fill(0);
  const labels = new Array(pts.length);
  for (const e of entries) {
    let placed = false;
    for (let oi = 0; oi < e.order.length; oi++) {
      const c = e.order[oi];
      if (counts[c] < capacity) {
        labels[e.i] = c;
        counts[c] += 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      let best = 0;
      let bestRem = -Infinity;
      for (let c = 0; c < k; c++) {
        const rem = capacity - counts[c];
        if (rem > bestRem) {
          bestRem = rem;
          best = c;
        }
      }
      labels[e.i] = best;
      counts[best] += 1;
    }
  }
  return labels;
}

// Boundary polish: repeatedly swap PAIRS of houses that each prefer the other's
// book. A mutual swap keeps every book's count identical (so balance is
// preserved) and strictly lowers total distance-to-center. Directly fixes the
// "this house belongs in the closer book" case.
function swapPolish(pts, labels, k, sweeps) {
  for (let s = 0; s < sweeps; s++) {
    const centroids = computeCentroids(pts, labels, k);
    const wants = [];
    for (let i = 0; i < pts.length; i++) {
      const a = labels[i];
      if (!centroids[a]) continue;
      const da = dist2(pts[i], centroids[a]);
      let b = -1;
      let db = Infinity;
      for (let c = 0; c < k; c++) {
        if (c === a || !centroids[c]) continue;
        const d = dist2(pts[i], centroids[c]);
        if (d < db) {
          db = d;
          b = c;
        }
      }
      if (b >= 0 && db < da) wants.push({ i, a, b });
    }
    const byPair = new Map();
    for (const w of wants) {
      const key = `${w.a}>${w.b}`;
      const arr = byPair.get(key);
      if (arr) arr.push(w);
      else byPair.set(key, [w]);
    }
    const used = new Set();
    let swaps = 0;
    for (const w of wants) {
      if (used.has(w.i)) continue;
      const back = byPair.get(`${w.b}>${w.a}`);
      if (!back) continue;
      const partner = back.find((x) => x.i !== w.i && !used.has(x.i));
      if (!partner) continue;
      labels[w.i] = w.b;
      labels[partner.i] = w.a;
      used.add(w.i);
      used.add(partner.i);
      swaps += 1;
    }
    if (!swaps) break;
  }
}

function labelsEqual(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function balancedKMeans(items, maxDoors) {
  const n = items.length;
  if (!n) return [];
  const k = Math.max(1, Math.ceil(n / Math.max(1, maxDoors)));
  if (k === 1) return [items.map((it) => it.doc)];

  // Project + Hilbert-order once (deterministic). hilbertSort returns each point
  // with projected x/y in meters — reuse those for all distance math.
  const sorted = hilbertSort(items.map((it) => ({ lng: it.lng, lat: it.lat, doc: it.doc })));
  const pts = sorted.map((p) => ({ x: p.x, y: p.y, doc: p.doc }));

  // Seed k centroids evenly along the Hilbert order — well-spread + deterministic.
  let centroids = [];
  for (let c = 0; c < k; c++) {
    const idx = Math.min(pts.length - 1, Math.floor(((c + 0.5) * pts.length) / k));
    centroids.push({ x: pts[idx].x, y: pts[idx].y });
  }

  const capacity = Math.ceil(n / k); // balanced cap/book (≈ maxDoors, books within ~1)
  let labels = null;
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const next = balancedAssign(pts, centroids, capacity);
    const cents = computeCentroids(pts, next, k);
    centroids = cents.map((c, i) => c || centroids[i]); // keep a vacated seed in place
    if (labels && labelsEqual(labels, next)) {
      labels = next;
      break;
    }
    labels = next;
  }

  swapPolish(pts, labels, k, POLISH_SWEEPS);

  // Cluster index order ≈ Hilbert order (seeds were spread along the curve), so
  // Book numbering stays spatially sensible.
  const clusters = Array.from({ length: k }, () => []);
  for (let i = 0; i < pts.length; i++) clusters[labels[i]].push(pts[i].doc);
  return clusters.filter((c) => c.length);
}
