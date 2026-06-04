const upperTrim = (s) => (s == null ? '' : String(s).trim().toUpperCase());

export function normalizeAddress({ addressLine1, addressLine2, city, state, zipCode }) {
  const a1 = upperTrim(addressLine1);
  const a2 = upperTrim(addressLine2);
  const c = upperTrim(city);
  const st = upperTrim(state);
  const zip5 = upperTrim(zipCode).slice(0, 5);
  return [a1, a2, c, st, zip5].join('|');
}

// Expand common street-suffix + directional abbreviations to a single canonical form
// so formatting drift collapses ("ST"→"STREET", "N"→"NORTH").
const STREET_WORDS = {
  ST: 'STREET', STR: 'STREET', AVE: 'AVENUE', AV: 'AVENUE', RD: 'ROAD', DR: 'DRIVE',
  BLVD: 'BOULEVARD', LN: 'LANE', CT: 'COURT', PL: 'PLACE', TER: 'TERRACE', TERR: 'TERRACE',
  CIR: 'CIRCLE', PKWY: 'PARKWAY', HWY: 'HIGHWAY', SQ: 'SQUARE', TRL: 'TRAIL', PT: 'POINT',
  N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST',
  NE: 'NORTHEAST', NW: 'NORTHWEST', SE: 'SOUTHEAST', SW: 'SOUTHWEST',
};

// A deliberately LOOSE address key for *near-duplicate detection only* (advisory).
// It is never used as an upsert key — that stays exact `normalizeAddress`. Strips
// punctuation, collapses whitespace, and canonicalizes street-type/directional words,
// so "123 N Main St" and "123 North Main Street" share a key. Keeps addressLine2 so
// distinct units ("Apt 1" vs "Apt 2") do NOT collapse together.
export function looseAddressKey({ addressLine1, addressLine2, city, state, zipCode }) {
  const clean = (s) =>
    String(s ?? '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const expand = (s) =>
    clean(s).split(' ').filter(Boolean).map((t) => STREET_WORDS[t] || t).join(' ');
  const a1 = expand(addressLine1);
  const a2 = expand(addressLine2);
  const c = clean(city);
  const st = clean(state);
  const zip5 = clean(zipCode).slice(0, 5);
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
