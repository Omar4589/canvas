import { hilbertSort } from './spatial.js';

// Compactness-first k-means over geo points → tight, walkable books whose size is
// an APPROXIMATE target (maxDoors), not a hard equal cap. The old equal-size cap
// (ceil(n/k)) forced strays: a house whose nearest book was full got dumped into
// whatever book had the most room — distance-blind — and a mutual-swap-only polish
// could never relocate a lone stray. Here the cap is SOFT (maxDoors ± tolerance),
// overflow always goes to the NEAREST book with room, and a single-point relocation
// pass moves any house to a strictly-nearer book that has room (no reciprocal
// partner needed). Net: nobody drives across the area for one door.
//
// Deterministic — projection + seeds come from the Hilbert curve, never Math.random
// — so a worker re-run reproduces the same books.
//
// items: [{ doc, lng, lat }] (all must have coords). maxDoors: target/book.
// opts.tolerance (default 0.4): how far book sizes may flex from maxDoors.
// Returns: array of clusters, each an array of the original `doc`s.

const MAX_ITERS = 40;
const RELOCATE_SWEEPS = 12;
const POLISH_SWEEPS = 6;
const EPS = 1e-6;

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

// Balanced assignment: each point goes to its NEAREST centroid that is still under
// the soft cap. Points are processed by how strongly they prefer their best over
// their second-best (d2 − d1) so the "most decided" houses get their first choice
// and ambiguous ones absorb the capacity pressure. Because total capacity
// (k · softMax) exceeds n, a near book with room always exists — there is no
// distance-blind overflow.
function balancedAssign(pts, centroids, softMax) {
  const k = centroids.length;
  const entries = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const ds = new Array(k);
    for (let c = 0; c < k; c++) ds[c] = { c, d: dist2(pts[i], centroids[c]) };
    ds.sort((a, b) => a.d - b.d || a.c - b.c);
    const order = new Array(k);
    for (let c = 0; c < k; c++) order[c] = ds[c].c;
    entries[i] = { i, order, pref: (ds[1] ? ds[1].d : ds[0].d) - ds[0].d };
  }
  entries.sort((a, b) => b.pref - a.pref || a.i - b.i);

  const counts = new Array(k).fill(0);
  const labels = new Array(pts.length);
  for (const e of entries) {
    let placed = false;
    for (let oi = 0; oi < e.order.length; oi++) {
      const c = e.order[oi];
      if (counts[c] < softMax) {
        labels[e.i] = c;
        counts[c] += 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Unreachable when k·softMax > n; fall back to the nearest book regardless.
      const c = e.order[0];
      labels[e.i] = c;
      counts[c] += 1;
    }
  }
  return labels;
}

// Single-point relocation polish: move any house to a STRICTLY-nearer book that is
// still under the soft cap. Unlike a mutual swap this needs no reciprocal partner,
// so it relocates lone strays. Strict improvement ⇒ total distance-to-center
// decreases monotonically ⇒ it terminates (the sweep cap is just a backstop).
function relocatePolish(pts, labels, k, softMax, sweeps) {
  for (let s = 0; s < sweeps; s++) {
    const centroids = computeCentroids(pts, labels, k);
    const counts = new Array(k).fill(0);
    for (let i = 0; i < pts.length; i++) counts[labels[i]] += 1;
    let moved = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = labels[i];
      if (!centroids[a] || counts[a] <= 1) continue;
      const da = dist2(pts[i], centroids[a]);
      let b = -1;
      let db = Infinity;
      for (let c = 0; c < k; c++) {
        if (c === a || !centroids[c] || counts[c] >= softMax) continue;
        const d = dist2(pts[i], centroids[c]);
        if (d < db) {
          db = d;
          b = c;
        }
      }
      if (b >= 0 && db < da - EPS) {
        labels[i] = b;
        counts[a] -= 1;
        counts[b] += 1;
        moved += 1;
      }
    }
    if (!moved) break;
  }
}

// Dissolve undersized books (< softMin) into their NEAREST neighbor that can absorb
// them (combined ≤ softMax) — but only if that neighbor is genuinely adjacent. A
// truly isolated small cluster is left alone (we don't drag a remote hamlet across
// town to even out counts). Centroid of a merged book = the count-weighted average.
function mergeSmall(pts, labels, k, softMin, softMax) {
  const centroids = computeCentroids(pts, labels, k);
  const counts = new Array(k).fill(0);
  for (let i = 0; i < pts.length; i++) counts[labels[i]] += 1;

  const live = [];
  for (let c = 0; c < k; c++) if (centroids[c] && counts[c] > 0) live.push(c);
  if (live.length <= 1) return;

  // Isolation threshold ≈ (2 × median nearest-neighbor book spacing)², in dist2 units.
  const nn = [];
  for (const c of live) {
    let best = Infinity;
    for (const d of live) {
      if (d === c) continue;
      const dd = dist2(centroids[c], centroids[d]);
      if (dd < best) best = dd;
    }
    if (best < Infinity) nn.push(best);
  }
  nn.sort((a, b) => a - b);
  const median = nn.length ? nn[Math.floor(nn.length / 2)] : Infinity;
  const isolationLimit = median * 4;

  // Smallest books first (deterministic by count then index).
  const order = live.slice().sort((a, b) => counts[a] - counts[b] || a - b);
  for (const c of order) {
    if (counts[c] === 0 || counts[c] >= softMin) continue;
    let best = -1;
    let bestD = Infinity;
    for (const d of live) {
      if (d === c || counts[d] === 0) continue;
      if (counts[c] + counts[d] > softMax) continue;
      const dd = dist2(centroids[c], centroids[d]);
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    if (best < 0 || bestD > isolationLimit) continue;
    for (let i = 0; i < pts.length; i++) if (labels[i] === c) labels[i] = best;
    const tn = counts[best] + counts[c];
    centroids[best] = {
      x: (centroids[best].x * counts[best] + centroids[c].x * counts[c]) / tn,
      y: (centroids[best].y * counts[best] + centroids[c].y * counts[c]) / tn,
    };
    counts[best] = tn;
    counts[c] = 0;
  }
}

// Boundary polish: swap PAIRS of houses that each prefer the other's book. A mutual
// swap keeps both books' counts identical (so the soft cap is never breached) and
// strictly lowers total distance-to-center. This fixes the case relocation can't —
// a house at the boundary of a FULL book trading with one that wants to leave it.
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

export function balancedKMeans(items, maxDoors, opts = {}) {
  const tolerance = opts.tolerance != null ? opts.tolerance : 0.4;
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

  // Soft size band: maxDoors is a target, not a hard equal cap. `softMax` keeps the
  // initial assignment fairly even; `hardMax` is the true ceiling the compactness
  // rescue may grow a book to so a stray joins its NEAREST book instead of driving
  // to a far one; `softMin` is a goal used by the merge pass.
  const softMax = Math.max(maxDoors, Math.ceil(maxDoors * (1 + tolerance)));
  const hardMax = Math.max(softMax, Math.ceil(maxDoors * (1 + tolerance * 1.5)));
  const softMin = Math.max(1, Math.floor(maxDoors * (1 - tolerance)));

  let labels = null;
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const next = balancedAssign(pts, centroids, softMax);
    const cents = computeCentroids(pts, next, k);
    centroids = cents.map((c, i) => c || centroids[i]); // keep a vacated seed in place
    if (labels && labelsEqual(labels, next)) {
      labels = next;
      break;
    }
    labels = next;
  }

  // Relocation fixes lone strays (move to a nearer book with room); swap fixes
  // boundary pairs between FULL books (count-preserving trades); the tiny-book merge
  // folds in scraps. Then a final rescue at `hardMax` lets any house still stuck far
  // from its cluster join its NEAREST book even slightly over target — compactness
  // beats hitting the count, so nobody drives across the area for one door.
  relocatePolish(pts, labels, k, softMax, RELOCATE_SWEEPS);
  swapPolish(pts, labels, k, POLISH_SWEEPS);
  mergeSmall(pts, labels, k, softMin, softMax);
  relocatePolish(pts, labels, k, softMax, 3);
  swapPolish(pts, labels, k, POLISH_SWEEPS);
  relocatePolish(pts, labels, k, hardMax, RELOCATE_SWEEPS);
  swapPolish(pts, labels, k, POLISH_SWEEPS);

  // Cluster index order ≈ Hilbert order (seeds were spread along the curve), so
  // Book numbering stays spatially sensible.
  const clusters = Array.from({ length: k }, () => []);
  for (let i = 0; i < pts.length; i++) clusters[labels[i]].push(pts[i].doc);
  return clusters.filter((c) => c.length);
}
