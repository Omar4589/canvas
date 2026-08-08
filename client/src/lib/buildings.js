// Doors that share one pin — the web mirror of mobile/lib/buildings.js and
// server/src/utils/buildingKey.js. All three round to 5 decimals (~1.1m), so
// "this is one building" means the SAME set of doors on the admin map, the cut
// map, the canvasser map, and the /exclude-apartments endpoint. If you change
// the rounding here, change it in all four or they silently disagree.
//
// Why this exists on the admin map at all: the household symbol layer draws with
// icon-allow-overlap + icon-ignore-placement, so 84 units at 17475 Frances St
// render as 84 coincident house icons and read as ONE door. Grouping them into a
// building glyph is what makes the hidden doors countable and clickable.
//
// This is grouping, not clustering — the key is the door's actual coordinate, at
// every zoom, and a building never merges with the building next door.

export const BUILDING_MIN_UNITS = 2;

// Doors whose status counts as worked. Mirrors mobile/lib/buildings.js.
const DONE_STATUSES = new Set(['surveyed', 'lit_dropped']);

export function buildingKeyForCoords(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return `${Math.round(lat * 1e5)}|${Math.round(lng * 1e5)}`;
}

// households: the /admin/households/map shape — { id, location: { lng, lat }, status, … }.
// Returns:
//   buildings  — [{ key, lng, lat, units, total, done, touched, roll }] sorted biggest-first
//   stackedIds — Set of household ids that belong to a building (the ones the house
//                layer must NOT draw, or the building glyph sits on top of hidden pins)
//   byKey      — Map<key, building> for click lookup
// Doors without coordinates are dropped: they can't stack because they can't be drawn.
export function groupHouseholds(households, minUnits = BUILDING_MIN_UNITS) {
  const groups = new Map();
  for (const h of households || []) {
    const key = buildingKeyForCoords(h.location?.lng, h.location?.lat);
    if (!key) continue;
    const arr = groups.get(key);
    if (arr) arr.push(h);
    else groups.set(key, [h]);
  }

  const buildings = [];
  const stackedIds = new Set();
  for (const [key, units] of groups) {
    if (units.length < minUnits) continue;
    let done = 0;
    let touched = 0;
    for (const u of units) {
      if (DONE_STATUSES.has(u.status)) done += 1;
      if (u.status && u.status !== 'unknocked') touched += 1;
      stackedIds.add(u.id);
    }
    const first = units[0];
    buildings.push({
      key,
      lng: first.location.lng,
      lat: first.location.lat,
      addressLine1: first.addressLine1,
      city: first.city,
      state: first.state,
      zipCode: first.zipCode,
      units,
      total: units.length,
      done,
      touched,
      roll: done === units.length ? 'done' : touched > 0 ? 'partial' : 'none',
    });
  }
  buildings.sort((a, b) => b.total - a.total);

  const byKey = new Map(buildings.map((b) => [b.key, b]));
  return { buildings, stackedIds, byKey };
}

// "17475 Frances St" from the units at one pin. Every unit shares the street line
// in the normal case; if an import disagreed, say so rather than picking one.
export function buildingLabel(building) {
  if (!building) return '';
  const lines = new Set(building.units.map((u) => (u.addressLine1 || '').trim()).filter(Boolean));
  if (lines.size === 1) return [...lines][0];
  return lines.size > 1 ? `${building.total} doors at one pin` : 'Building';
}
