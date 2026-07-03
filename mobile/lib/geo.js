// Distance helpers for the list view's "nearest to me" sort. Ported from the
// server's haversineMeters (utils/normalizeAddress.js). Pure, no deps.

const R = 6371000; // earth radius (m)
const toRad = (d) => (d * Math.PI) / 180;

export function haversineMeters(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every((n) => Number.isFinite(n))) return null;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Distance from [lng,lat] user coords to a household's [lng,lat] location, or null.
export function distanceToCoords(userCoords, coords) {
  if (!Array.isArray(userCoords) || userCoords.length !== 2) return null;
  if (!Array.isArray(coords) || coords.length !== 2) return null;
  return haversineMeters(userCoords[1], userCoords[0], coords[1], coords[0]);
}

export function formatDistance(m) {
  if (m == null || !Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
