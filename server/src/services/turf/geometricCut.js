import { balancedKMeans } from './balancedKMeans.js';

// Split households into compact, balanced books of <= maxDoors using
// capacity-balanced k-means (balancedKMeans.js) — every house lands in its
// nearest book that still has room, so books come out tight and walkable rather
// than merely count-balanced. Coordinate-less households go in a trailing chunk.
export function geometricChunks(households, maxDoors, opts = {}) {
  const withCoords = households.filter((h) => h.location?.coordinates?.length === 2);
  const noCoords = households.filter((h) => !(h.location?.coordinates?.length === 2));
  if (!withCoords.length) return noCoords.length ? [noCoords] : [];

  const items = withCoords.map((h) => ({
    doc: h,
    lng: h.location.coordinates[0],
    lat: h.location.coordinates[1],
  }));
  const chunks = balancedKMeans(items, maxDoors, opts);
  if (noCoords.length) chunks.push(noCoords);
  return chunks;
}

export function geometricCut(households, { maxDoors = 65, tolerance } = {}) {
  return geometricChunks(households, maxDoors, { tolerance }).map((members, i) => ({
    name: `Book ${i + 1}`,
    households: members,
  }));
}

// Subdivide one attribute group into compact contiguous sub-books <= capN (soft).
export function geometricSubdivide(households, capN, opts = {}) {
  return geometricChunks(households, capN, opts);
}
