import { balancedKMeans } from './balancedKMeans.js';

// Split households into compact, balanced books of <= maxDoors using
// capacity-balanced k-means (balancedKMeans.js) — every house lands in its
// nearest book that still has room, so books come out tight and walkable rather
// than merely count-balanced. Coordinate-less households go in a trailing chunk.
export function geometricChunks(households, maxDoors) {
  const withCoords = households.filter((h) => h.location?.coordinates?.length === 2);
  const noCoords = households.filter((h) => !(h.location?.coordinates?.length === 2));
  if (!withCoords.length) return noCoords.length ? [noCoords] : [];

  const items = withCoords.map((h) => ({
    doc: h,
    lng: h.location.coordinates[0],
    lat: h.location.coordinates[1],
  }));
  const chunks = balancedKMeans(items, maxDoors);
  if (noCoords.length) chunks.push(noCoords);
  return chunks;
}

export function geometricCut(households, { maxDoors = 65 } = {}) {
  return geometricChunks(households, maxDoors).map((members, i) => ({
    name: `Book ${i + 1}`,
    households: members,
  }));
}

// Subdivide one attribute group into balanced contiguous sub-books <= capN.
export function geometricSubdivide(households, capN) {
  return geometricChunks(households, capN);
}
