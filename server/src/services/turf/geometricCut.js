import { hilbertSort } from './spatial.js';

// Split households into contiguous, balanced chunks of <= maxDoors using a
// Hilbert space-filling curve (preserves spatial locality, so each chunk is a
// compact, walkable area). Coordinate-less households go in their own chunk.
export function geometricChunks(households, maxDoors) {
  const withCoords = households.filter((h) => h.location?.coordinates?.length === 2);
  const noCoords = households.filter((h) => !(h.location?.coordinates?.length === 2));
  if (!withCoords.length) return noCoords.length ? [noCoords] : [];

  const pts = withCoords.map((h) => ({
    doc: h,
    lng: h.location.coordinates[0],
    lat: h.location.coordinates[1],
  }));
  const sorted = hilbertSort(pts);

  const n = sorted.length;
  const chunkCount = Math.max(1, Math.ceil(n / Math.max(1, maxDoors)));
  const target = Math.ceil(n / chunkCount); // balanced chunk size

  const chunks = [];
  for (let i = 0; i < n; i += target) {
    chunks.push(sorted.slice(i, i + target).map((p) => p.doc));
  }
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
