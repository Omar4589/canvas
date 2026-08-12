import { balancedKMeans } from './balancedKMeans.js';
import { roadCut } from './roads/roadCut.js';

// Split households into compact, balanced books of <= maxDoors using
// capacity-balanced k-means (balancedKMeans.js) — every house lands in its
// nearest book that still has room, so books come out tight and walkable rather
// than merely count-balanced. Coordinate-less households go in a trailing chunk.
//
// With `opts.roadGraph` set, distance is measured ALONG STREETS instead
// (roads/roadCut.js) so a book cannot span a canal that has no bridge. That path
// degrades to the straight-line cut rather than failing: too few doors near a
// street and roadCut returns a null cluster set, which falls through below.
// `opts.onRoadResult` (optional) reports what actually happened, so the caller can
// tell the admin whether road data was used rather than leaving it a mystery.
export function geometricChunks(households, maxDoors, opts = {}) {
  const withCoords = households.filter((h) => h.location?.coordinates?.length === 2);
  const noCoords = households.filter((h) => !(h.location?.coordinates?.length === 2));
  if (!withCoords.length) return noCoords.length ? [noCoords] : [];

  const items = withCoords.map((h) => ({
    doc: h,
    lng: h.location.coordinates[0],
    lat: h.location.coordinates[1],
  }));

  let chunks = null;
  if (opts.roadGraph) {
    const { clusters, offNetwork } = roadCut(items, maxDoors, { ...opts, graph: opts.roadGraph });
    if (clusters) {
      chunks = clusters;
      opts.onRoadResult?.({ applied: true, offNetwork, doors: items.length });
    } else {
      opts.onRoadResult?.({ applied: false, reason: 'too-few-doors-near-a-street', offNetwork, doors: items.length });
    }
  }
  if (!chunks) chunks = balancedKMeans(items, maxDoors, opts);

  if (noCoords.length) chunks.push(noCoords);
  return chunks;
}

// NOTE the rest-spread: this used to rebuild `{ tolerance }` by hand, which silently
// swallowed every other option — a caller passing a road graph would have got a
// straight-line cut and no error. Forward opts whole.
export function geometricCut(households, { maxDoors = 65, ...opts } = {}) {
  return geometricChunks(households, maxDoors, opts).map((members, i) => ({
    name: `Book ${i + 1}`,
    households: members,
  }));
}

// Subdivide one attribute group into compact contiguous sub-books <= capN (soft).
export function geometricSubdivide(households, capN, opts = {}) {
  return geometricChunks(households, capN, opts);
}
