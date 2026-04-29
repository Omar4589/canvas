const upperTrim = (s) => (s == null ? '' : String(s).trim().toUpperCase());

export function normalizeAddress({ addressLine1, addressLine2, city, state, zipCode }) {
  const a1 = upperTrim(addressLine1);
  const a2 = upperTrim(addressLine2);
  const c = upperTrim(city);
  const st = upperTrim(state);
  const zip5 = upperTrim(zipCode).slice(0, 5);
  return [a1, a2, c, st, zip5].join('|');
}

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
