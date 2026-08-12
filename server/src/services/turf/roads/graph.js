// A walking graph built from road center lines, plus the one query the turf cut needs:
// "for every node, which of these K book-centres are nearest, and how far along the streets?"
//
// Why a graph at all: the cut measures distance with `dist2` (straight line), and on Naples /
// Marco Island geography that is a lie — doors 140 m apart across a canal are 2.9 km apart on
// foot. Straight-line distance cannot see water because water is the ABSENCE of something;
// roads are a positive signal, and a canal simply has no road across it.
//
// Everything here is deterministic: no Math.random, no dependence on object iteration order,
// and ties in the priority queue broken by node index. The cut's reproducibility guarantee
// (see generateTurf.js) extends through this file.

const EARTH_RADIUS_M = 6371000;
const DEG = Math.PI / 180;

// Local equirectangular projection, same idea as spatial.js but around an EXPLICIT origin so
// roads and doors land in one coordinate system. (spatial.js derives its origin from whatever
// points it was handed, which would put roads and doors on two different planes.)
export const makeProjection = (lng0, lat0) => {
  const cos0 = Math.cos(lat0 * DEG);
  return {
    lng0,
    lat0,
    x: (lng) => (lng - lng0) * DEG * EARTH_RADIUS_M * cos0,
    y: (lat) => (lat - lat0) * DEG * EARTH_RADIUS_M,
  };
};

// Minimum-distance binary heap over (distance, node, source), in three parallel arrays so the
// hot loop never allocates a pair object. Ties break by node index, so a re-run settles the
// same way regardless of insertion order.
const makeHeap = () => {
  let dist = new Float64Array(1024);
  let node = new Int32Array(1024);
  let src = new Int32Array(1024);
  let size = 0;
  const grow = () => {
    const d = new Float64Array(dist.length * 2); d.set(dist); dist = d;
    const n = new Int32Array(node.length * 2); n.set(node); node = n;
    const s = new Int32Array(src.length * 2); s.set(src); src = s;
  };
  const before = (i, j) => dist[i] < dist[j] || (dist[i] === dist[j] && node[i] < node[j]);
  const swap = (i, j) => {
    const d = dist[i]; dist[i] = dist[j]; dist[j] = d;
    const n = node[i]; node[i] = node[j]; node[j] = n;
    const s = src[i]; src[i] = src[j]; src[j] = s;
  };
  return {
    get size() { return size; },
    push(d, n, s) {
      if (size === dist.length) grow();
      dist[size] = d; node[size] = n; src[size] = s;
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!before(i, p)) break;
        swap(i, p); i = p;
      }
    },
    // Returns the minimum as a 3-slot view; callers must read it before the next push/pop.
    pop(out) {
      out[0] = dist[0]; out[1] = node[0]; out[2] = src[0];
      size -= 1;
      if (size > 0) {
        dist[0] = dist[size]; node[0] = node[size]; src[0] = src[size];
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < size && before(l, m)) m = l;
          if (r < size && before(r, m)) m = r;
          if (m === i) break;
          swap(i, m); i = m;
        }
      }
      return out;
    },
  };
};

// roads: [{ coords: [[lng, lat], ...], addressable }] — see roads/shapefile.js.
//
// Vertices are keyed by rounded projected metres, which is how disjoint TIGER segments become
// one network: the format shares no node ids between records, but a junction's coordinates are
// byte-identical in both, so rounding to a centimetre joins them and nothing else.
//
// Long segments are subdivided every `stepMeters` so a door mid-block snaps to something near
// it rather than to the far end of the street — TIGER draws a straight run as two vertices.
export const buildRoadGraph = (roads, { stepMeters = 25 } = {}) => {
  let sumLng = 0;
  let sumLat = 0;
  let n = 0;
  for (const r of roads) for (const [lng, lat] of r.coords) { sumLng += lng; sumLat += lat; n += 1; }
  if (!n) throw new Error('buildRoadGraph: no road geometry');
  const proj = makeProjection(sumLng / n, sumLat / n);

  const byKey = new Map();
  const xs = [];
  const ys = [];
  const addressable = [];
  const nodeAt = (x, y, isAddressable) => {
    const key = `${Math.round(x * 100)},${Math.round(y * 100)}`;
    let i = byKey.get(key);
    if (i === undefined) {
      i = xs.length;
      xs.push(x); ys.push(y); addressable.push(isAddressable ? 1 : 0);
      byKey.set(key, i);
    } else if (isAddressable) {
      addressable[i] = 1;
    }
    return i;
  };

  // Edges are collected as a flat list, then packed into an adjacency structure below.
  const ea = [];
  const eb = [];
  const ew = [];
  const connect = (a, b) => {
    if (a === b) return;
    const w = Math.hypot(xs[a] - xs[b], ys[a] - ys[b]);
    ea.push(a); eb.push(b); ew.push(w);
  };

  for (const road of roads) {
    const isAddr = !!road.addressable;
    let prev = -1;
    for (const [lng, lat] of road.coords) {
      const x = proj.x(lng);
      const y = proj.y(lat);
      const here = nodeAt(x, y, isAddr);
      if (prev >= 0) {
        const ax = xs[prev];
        const ay = ys[prev];
        const span = Math.hypot(x - ax, y - ay);
        const steps = Math.max(1, Math.floor(span / stepMeters));
        let last = prev;
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const mid = nodeAt(ax + (x - ax) * t, ay + (y - ay) * t, isAddr);
          connect(last, mid);
          last = mid;
        }
        connect(last, here);
      }
      prev = here;
    }
  }
  byKey.clear();

  const nodeCount = xs.length;
  // Adjacency as a head/next linked list over the doubled edge list — one Int32Array pass, no
  // per-node arrays. Every edge is stored twice; a canvasser walks a street both ways.
  const head = new Int32Array(nodeCount).fill(-1);
  const nextEdge = new Int32Array(ea.length * 2);
  const target = new Int32Array(ea.length * 2);
  const weight = new Float64Array(ea.length * 2);
  let e = 0;
  const addDirected = (from, to, w) => {
    target[e] = to; weight[e] = w; nextEdge[e] = head[from]; head[from] = e; e += 1;
  };
  for (let i = 0; i < ea.length; i++) {
    addDirected(ea[i], eb[i], ew[i]);
    addDirected(eb[i], ea[i], ew[i]);
  }

  const graph = {
    nodeCount,
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    addressable: Uint8Array.from(addressable),
    head,
    nextEdge,
    target,
    weight,
    edgeCount: ea.length,
    projection: proj,
  };
  graph.component = componentsOf(graph);
  graph.mainComponent = largestComponent(graph.component);
  graph.snapIndex = buildSnapIndex(graph);
  return graph;
};

const componentsOf = (g) => {
  const comp = new Int32Array(g.nodeCount).fill(-1);
  const stack = new Int32Array(g.nodeCount);
  let next = 0;
  for (let start = 0; start < g.nodeCount; start++) {
    if (comp[start] >= 0) continue;
    let top = 0;
    stack[top++] = start;
    comp[start] = next;
    while (top > 0) {
      const u = stack[--top];
      for (let it = g.head[u]; it !== -1; it = g.nextEdge[it]) {
        const v = g.target[it];
        if (comp[v] < 0) { comp[v] = next; stack[top++] = v; }
      }
    }
    next += 1;
  }
  return comp;
};

const largestComponent = (comp) => {
  const counts = new Map();
  for (let i = 0; i < comp.length; i++) counts.set(comp[i], (counts.get(comp[i]) || 0) + 1);
  let best = -1;
  let bestN = -1;
  // Iterate sorted so a tie resolves the same way every run.
  for (const id of [...counts.keys()].sort((a, b) => a - b)) {
    const c = counts.get(id);
    if (c > bestN) { bestN = c; best = id; }
  }
  return best;
};

// Uniform grid over the projected plane. Doors are snapped one at a time and a county graph is
// ~10^5 nodes, so a linear scan per door would be the slowest thing in the cut.
const SNAP_CELL_M = 150;
const buildSnapIndex = (g) => {
  const cells = new Map();
  for (let i = 0; i < g.nodeCount; i++) {
    const key = `${Math.floor(g.x[i] / SNAP_CELL_M)},${Math.floor(g.y[i] / SNAP_CELL_M)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(i);
    else cells.set(key, [i]);
  }
  return cells;
};

// Nearest graph node to a projected point, searching outward a ring at a time.
// `addressableOnly` prefers street nodes — a door belongs on a street, not on the ramp that
// happens to pass behind it. Returns { node, meters }, or node -1 if nothing is within range.
export const snapPoint = (g, px, py, { maxMeters = 400, addressableOnly = true } = {}) => {
  const cx = Math.floor(px / SNAP_CELL_M);
  const cy = Math.floor(py / SNAP_CELL_M);
  const maxRing = Math.ceil(maxMeters / SNAP_CELL_M) + 1;
  let best = -1;
  let bestD = Infinity;
  for (let ring = 0; ring <= maxRing; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        // only the newly-added perimeter of this ring
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        const bucket = g.snapIndex.get(`${cx + dx},${cy + dy}`);
        if (!bucket) continue;
        for (const i of bucket) {
          if (addressableOnly && !g.addressable[i]) continue;
          const d = Math.hypot(px - g.x[i], py - g.y[i]);
          // `i < best` keeps the choice stable when two nodes are equidistant
          if (d < bestD || (d === bestD && i < best)) { bestD = d; best = i; }
        }
      }
    }
    // A hit inside the ring already scanned cannot be beaten by a further ring.
    if (best >= 0 && bestD <= ring * SNAP_CELL_M) break;
  }
  if (best >= 0 && bestD <= maxMeters) return { node: best, meters: bestD };
  if (addressableOnly) return snapPoint(g, px, py, { maxMeters, addressableOnly: false });
  return { node: -1, meters: Infinity };
};

// ONE sweep that labels every reachable node with its `labels` nearest sources, in order.
// This is what makes the road cut affordable: a Dijkstra per book-centre costs O(k · E log V)
// per iteration (measured: 521 s on a Naples-sized graph), whereas this is a single
// multi-source pass — the same 9,476 doors settle in 1.8 s.
//
// Returns { dist, src, count } as flat arrays of stride `labels`, ordered nearest-first.
export const nearestSources = (g, sources, labels = 4) => {
  const stride = labels;
  const dist = new Float64Array(g.nodeCount * stride).fill(Infinity);
  const src = new Int32Array(g.nodeCount * stride).fill(-1);
  const count = new Uint8Array(g.nodeCount);
  const heap = makeHeap();
  const out = new Float64Array(3);

  sources.forEach((node, id) => { if (node >= 0) heap.push(0, node, id); });

  while (heap.size > 0) {
    heap.pop(out);
    const d = out[0];
    const u = out[1] | 0;
    const s = out[2] | 0;
    if (count[u] >= stride) continue;
    // A node keeps at most one label per source; the first is the shortest by construction.
    let seen = false;
    for (let j = 0; j < count[u]; j++) if (src[u * stride + j] === s) { seen = true; break; }
    if (seen) continue;

    const slot = u * stride + count[u];
    dist[slot] = d;
    src[slot] = s;
    count[u] += 1;

    for (let it = g.head[u]; it !== -1; it = g.nextEdge[it]) {
      const v = g.target[it];
      if (count[v] >= stride) continue;
      let dup = false;
      for (let j = 0; j < count[v]; j++) if (src[v * stride + j] === s) { dup = true; break; }
      if (!dup) heap.push(d + g.weight[it], v, s);
    }
  }
  return { dist, src, count, stride };
};

// Plain single-source shortest path, for scoring and for the medoid refinement.
//
// `maxMeters` bounds the search. That matters more than it looks: refining one book's medoid
// only needs distances to that book's own ~65 doors, all within a kilometre or two, but an
// unbounded sweep walks the entire county — 254k nodes — every time. Capping the frontier
// turned a 386 s Naples cut into seconds. Nodes beyond the cap stay Infinity, which callers
// already treat as unreachable.
export const shortestPathFrom = (g, source, into = null, maxMeters = Infinity) => {
  const dist = into && into.length === g.nodeCount ? into : new Float64Array(g.nodeCount);
  dist.fill(Infinity);
  if (source < 0) return dist;
  dist[source] = 0;
  const heap = makeHeap();
  const out = new Float64Array(3);
  heap.push(0, source, 0);
  while (heap.size > 0) {
    heap.pop(out);
    const d = out[0];
    const u = out[1] | 0;
    if (d > dist[u]) continue;
    if (d > maxMeters) break; // the heap pops in distance order, so everything after is further
    for (let it = g.head[u]; it !== -1; it = g.nextEdge[it]) {
      const v = g.target[it];
      const nd = d + g.weight[it];
      if (nd < dist[v] && nd <= maxMeters) { dist[v] = nd; heap.push(nd, v, 0); }
    }
  }
  return dist;
};
