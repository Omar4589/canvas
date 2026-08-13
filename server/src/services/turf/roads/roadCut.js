import { hilbertSort } from '../spatial.js';
import { snapPoint, nearestSources, shortestPathFrom } from './graph.js';

// Capacity-balanced k-MEDOIDS over walking distance — the road-aware sibling of
// balancedKMeans.js. Same contract (soft size band around maxDoors, deterministic, returns
// clusters of the caller's `doc`s) with one difference that matters: distance is measured
// along streets, so a book cannot quietly span a canal that has no bridge.
//
// Why medoids and not means: k-means makes a centre by AVERAGING coordinates, and the average
// of two doors on opposite banks sits in the water — a point with no position on the road
// graph and therefore no walking distance to anything. Centres here are real doors.
//
// Cost is dominated by ONE multi-source sweep per iteration (graph.js nearestSources), not by
// a sweep per book. Measured on 9,476 real Naples doors over a 170k-node graph: 1.8 s total,
// against 5.6 s for today's straight-line cut on the same doors.
//
// Deterministic throughout: seeds come from the Hilbert order the rest of the cut already
// uses, medoid choice breaks ties by index, and there is no Math.random.

const MAX_ITERS = 8;
const LABELS = 4; // nearest book-centres tracked per node; the assignment needs a shortlist

// A door too far from any street (bad geocode, a private road TIGER omits, a genuine island)
// cannot be measured along the network. Rather than distort the graph we set these aside and
// place them at the end by straight-line distance — they are rare and they must still land in
// exactly one book.
const SNAP_LIMIT_M = 400;

const centroidNearest = (members, xs, ys) => {
  let sx = 0;
  let sy = 0;
  for (const i of members) { sx += xs[i]; sy += ys[i]; }
  const cx = sx / members.length;
  const cy = sy / members.length;
  let best = -1;
  let bestD = Infinity;
  for (const i of members) {
    const d = Math.hypot(xs[i] - cx, ys[i] - cy);
    if (d < bestD || (d === bestD && i < best)) { bestD = d; best = i; }
  }
  return best;
};

// True graph medoid, over a bounded sample of candidates. Evaluating every member would cost
// |members| shortest-path sweeps per book; sampling the spread evenly gets most of the quality
// for a fixed price. Measured on Marco: probing lifts books-over-1.5km from 16/41 to 9/41.
//
// Each probe is RADIUS-BOUNDED to a few times the book's own extent. A book spans a kilometre
// or two, so an unbounded sweep would walk the whole county to answer a local question — that
// was the difference between a 386 s Naples cut and a usable one.
const graphMedoid = (g, members, nodeOf, probes, scratch, xs, ys) => {
  if (members.length <= 2 || probes <= 0) return -1;

  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const m of members) {
    if (xs[m] < minX) minX = xs[m];
    if (xs[m] > maxX) maxX = xs[m];
    if (ys[m] < minY) minY = ys[m];
    if (ys[m] > maxY) maxY = ys[m];
  }
  // Generous: the walk between two doors can be several times their straight-line gap (that is
  // the whole point of this cut), so allow 4x the book's diagonal plus a floor.
  const radius = Math.max(2000, Math.hypot(maxX - minX, maxY - minY) * 4);

  const stepSize = Math.max(1, Math.ceil(members.length / probes));
  let best = -1;
  let bestTotal = Infinity;
  for (let s = 0; s < members.length; s += stepSize) {
    const candidate = members[s];
    const dist = shortestPathFrom(g, nodeOf[candidate], scratch, radius);
    let total = 0;
    for (const m of members) {
      const d = dist[nodeOf[m]];
      total += Number.isFinite(d) ? d : radius * 4; // out of range is worse than any real distance
    }
    if (total < bestTotal || (total === bestTotal && candidate < best)) { bestTotal = total; best = candidate; }
  }
  return best;
};

// items: [{ doc, lng, lat }]. opts.graph is required (roads/graph.js buildRoadGraph).
// Returns { clusters, offNetwork } — clusters is an array of arrays of `doc`, and offNetwork
// counts doors that had to be placed by straight-line because no street was near enough.
export const roadCut = (items, maxDoors, opts = {}) => {
  const g = opts.graph;
  if (!g) throw new Error('roadCut requires opts.graph');
  const tolerance = opts.tolerance != null ? opts.tolerance : 0.4;
  // OFF by default, and the default is load-bearing: at 8 probes this refinement was ~27 of
  // the 33 seconds a Palm Beach cut spent in ONE unbroken synchronous block, which exceeded
  // BullMQ's 30s job lock, stalled the job, and got it redelivered — the cut visibly restarted
  // and eventually died with "job stalled more than allowable limit". Measured on real doors,
  // it also buys nothing: Palm Beach 69/122 books over 1.5 km with probes vs 70/122 without,
  // Marco 7/41 with vs 6/41 WITHOUT. Kept as a tunable rather than deleted, because it may
  // earn its cost on geography we haven't measured — but turn it on only with a measurement
  // in hand, and only if the caller can tolerate the block.
  const probes = opts.medoidProbes != null ? opts.medoidProbes : 0;
  const n = items.length;
  if (!n) return { clusters: [], offNetwork: 0 };

  const k = Math.max(1, Math.ceil(n / Math.max(1, maxDoors)));
  if (k === 1) return { clusters: [items.map((it) => it.doc)], offNetwork: 0 };

  // Project once, into the GRAPH's plane so doors and streets share coordinates.
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const nodeOf = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    xs[i] = g.projection.x(items[i].lng);
    ys[i] = g.projection.y(items[i].lat);
  }
  const onNet = [];
  const offNet = [];
  for (let i = 0; i < n; i++) {
    const s = snapPoint(g, xs[i], ys[i], { maxMeters: SNAP_LIMIT_M });
    // A door on a stranded fragment of the network is as unmeasurable as one with no street.
    if (s.node >= 0 && g.component[s.node] === g.mainComponent) {
      nodeOf[i] = s.node;
      onNet.push(i);
    } else {
      offNet.push(i);
    }
  }
  if (onNet.length < k) {
    // Not enough measurable doors to seed the books — the caller falls back to the
    // straight-line cut rather than us producing something arbitrary.
    return { clusters: null, offNetwork: offNet.length };
  }

  // Seeds spread along the Hilbert order, exactly as balancedKMeans does — deterministic and
  // well-distributed, and it keeps book numbering spatially sensible.
  const ordered = hilbertSort(onNet.map((i) => ({ lng: items[i].lng, lat: items[i].lat, i })));
  let medoids = new Int32Array(k);
  for (let c = 0; c < k; c++) {
    medoids[c] = ordered[Math.min(ordered.length - 1, Math.floor(((c + 0.5) * ordered.length) / k))].i;
  }

  const softMax = Math.max(maxDoors, Math.ceil(maxDoors * (1 + tolerance)));
  const label = new Int32Array(n).fill(-1);
  const scratch = new Float64Array(g.nodeCount);
  let previous = null;

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const sweep = nearestSources(g, Array.from(medoids, (i) => nodeOf[i]), LABELS);
    const stride = sweep.stride;

    // Assign in order of how strongly each door prefers its best book over its second — the
    // most-decided doors get their first choice and ambiguous ones absorb capacity pressure.
    // Same rule as balancedKMeans.balancedAssign, so the two cuts behave alike.
    const order = onNet.slice();
    const margin = new Float64Array(n);
    for (const i of onNet) {
      const at = nodeOf[i] * stride;
      const cnt = sweep.count[nodeOf[i]];
      margin[i] = cnt > 1 ? sweep.dist[at + 1] - sweep.dist[at] : 0;
    }
    order.sort((a, b) => margin[b] - margin[a] || a - b);

    const counts = new Int32Array(k);
    const next = new Int32Array(n).fill(-1);
    for (const i of order) {
      const base = nodeOf[i] * stride;
      const cnt = sweep.count[nodeOf[i]];
      let placed = -1;
      for (let j = 0; j < cnt; j++) {
        const c = sweep.src[base + j];
        if (counts[c] < softMax) { placed = c; break; }
      }
      // Shortlist exhausted — every one of this door's LABELS nearest books is full, or the
      // node was never reached. Fall back to the nearest book WITH ROOM by straight line to its
      // medoid. It must respect the cap: an earlier version took the nearest book regardless and
      // produced a 183-door book against a 65-door target, because with k=151 a door's four
      // nearest books are often all full and every such door cascaded into the same one.
      // Capacity always exists: k·softMax >= n·(1+tolerance) > n.
      if (placed < 0) {
        let bestD = Infinity;
        for (let c = 0; c < k; c++) {
          if (counts[c] >= softMax) continue;
          const m = medoids[c];
          const d = Math.hypot(xs[i] - xs[m], ys[i] - ys[m]);
          if (d < bestD || (d === bestD && c < placed)) { bestD = d; placed = c; }
        }
        // Genuinely every book at the cap (only reachable if maxDoors was pushed to n): take the
        // emptiest so the overflow is spread rather than piled on one book.
        if (placed < 0) {
          placed = 0;
          for (let c = 1; c < k; c++) if (counts[c] < counts[placed]) placed = c;
        }
      }
      next[i] = placed;
      counts[placed] += 1;
    }

    const groups = Array.from({ length: k }, () => []);
    for (const i of onNet) groups[next[i]].push(i);

    const moved = Array.from({ length: k }, (_, c) => {
      const members = groups[c];
      if (!members.length) return medoids[c]; // keep a vacated seed in place
      const refined = graphMedoid(g, members, nodeOf, probes, scratch, xs, ys);
      return refined >= 0 ? refined : centroidNearest(members, xs, ys);
    });

    const settled = previous && onNet.every((i) => previous[i] === next[i]);
    previous = next;
    label.set(next);
    medoids = Int32Array.from(moved);
    if (settled) break;
  }

  const clusters = Array.from({ length: k }, () => []);
  const finalCounts = new Int32Array(k);
  for (const i of onNet) { clusters[label[i]].push(items[i].doc); finalCounts[label[i]] += 1; }

  // Off-network doors join the nearest book WITH ROOM, by straight line — the only measure
  // available for a door the street graph cannot see. The capacity check is not optional: these
  // arrive after the balanced assignment, so an uncapped pass here undoes it. Naples has 379
  // such doors and letting them ignore softMax produced a 183-door book against a 65 target.
  // Processed in index order so the result does not depend on Set/array iteration accidents.
  for (const i of offNet) {
    let bestC = -1;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      if (finalCounts[c] >= softMax) continue;
      const m = medoids[c];
      const d = Math.hypot(xs[i] - xs[m], ys[i] - ys[m]);
      if (d < bestD) { bestD = d; bestC = c; }
    }
    if (bestC < 0) { // every book at the cap — spread rather than pile
      bestC = 0;
      for (let c = 1; c < k; c++) if (finalCounts[c] < finalCounts[bestC]) bestC = c;
    }
    clusters[bestC].push(items[i].doc);
    finalCounts[bestC] += 1;
  }

  return { clusters: clusters.filter((c) => c.length), offNetwork: offNet.length };
};
