// Mirror of mobile/lib/buildings.js `buildingKey` — coordinates are [lng, lat] and
// the key is "roundedLat|roundedLng" at ~1.1m precision. Apartment units at one
// geocoded address share the exact same point, so this key identifies "the same pin".
// Keeping the precision identical to the mobile grouping means the client's
// "this shares a pin with N units" prompt and the server's `scope:'building'` move agree.
export function buildingKeyForCoords(coords) {
  if (!Array.isArray(coords) || coords.length !== 2) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${Math.round(lat * 1e5)}|${Math.round(lng * 1e5)}`;
}
