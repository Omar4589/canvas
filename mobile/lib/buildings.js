// Group households into buildings by geocode. Apartment units are each their own
// Household but share the exact same point (vendors geocode all units of a
// building to one spot), so coordinates are the reliable key — works whether the
// unit lives in addressLine2 or is baked into addressLine1.

const DONE = new Set(['surveyed', 'lit_dropped']);

export function buildingKey(h) {
  const c = h.location?.coordinates;
  if (!c || c.length !== 2) return null;
  return `${Math.round(c[1] * 1e5)}|${Math.round(c[0] * 1e5)}`; // ~1.1m precision
}

// Returns { buildings, singles }. A building is a key with >=2 units; singles are
// lone households (rendered as ordinary house pins by the existing flow).
export function groupBuildings(households) {
  const groups = new Map();
  for (const h of households || []) {
    const k = buildingKey(h);
    if (!k) continue;
    const arr = groups.get(k) || [];
    arr.push(h);
    groups.set(k, arr);
  }
  const buildings = [];
  const singles = [];
  for (const [key, units] of groups) {
    if (units.length < 2) {
      singles.push(units[0]);
      continue;
    }
    const first = units[0];
    const done = units.filter((u) => DONE.has(u.status || 'unknocked')).length;
    const touched = units.filter((u) => (u.status || 'unknocked') !== 'unknocked').length;
    const status = done >= units.length ? 'green' : touched > 0 ? 'yellow' : 'grey';
    buildings.push({
      key,
      coordinates: first.location.coordinates,
      addressLine1: first.addressLine1,
      city: first.city,
      state: first.state,
      zipCode: first.zipCode,
      units,
      total: units.length,
      done,
      status,
    });
  }
  return { buildings, singles };
}
