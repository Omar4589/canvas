// Group households into buildings by geocode. Apartment units are each their own
// Household but share the exact same point (vendors geocode all units of a
// building to one spot), so coordinates are the reliable key — works whether the
// unit lives in addressLine2 or is baked into addressLine1.
//
// Not every stack is a building: a voter file can give DIFFERENT homes one coordinate. The server marks those
// homes (`pinSuspect`, sent only while a home has no exact map spot), and `kind` reads the marks the same way
// the web does (client/src/lib/buildings.js stackKind, docs/PROPOSAL_PLACEHOLDER_PINS.md §J).

import { stackBaseOf, baseAddressOf } from './streetName.js';

const DONE = new Set(['surveyed', 'lit_dropped']);

// 'unplaced' — different homes that share one map spot: any member is 'placeholder', or every member is
// flagged. 'building' — anything else; its 'stray' members (another address on the building's spot) are listed
// apart, and the building's header comes from its first member that isn't one.
export const stackKind = (units) => {
  const list = units || [];
  if (!list.length) return 'building';
  if (list.some((u) => u.pinSuspect === 'placeholder') || list.every((u) => !!u.pinSuspect)) return 'unplaced';
  return 'building';
};

export function buildingKey(h) {
  const c = h.location?.coordinates;
  if (!c || c.length !== 2) return null;
  // A null/NaN inside a length-2 array would round to 0 and fold unrelated doors
  // into a phantom building at the equator. Matches the server and web guards
  // (server/src/utils/buildingKey.js, client/src/lib/buildings.js).
  if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
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
    const kind = stackKind(units);
    const strays = kind === 'building' ? units.filter((u) => u.pinSuspect === 'stray') : [];
    const first = (kind === 'building' && units.find((u) => u.pinSuspect !== 'stray')) || units[0];
    const done = units.filter((u) => DONE.has(u.status || 'unknocked')).length;
    const touched = units.filter((u) => (u.status || 'unknocked') !== 'unknocked').length;
    const status = units.length && done >= units.length ? 'green' : touched > 0 ? 'yellow' : 'grey';
    buildings.push({
      key,
      kind,
      coordinates: first.location.coordinates,
      addressLine1: first.addressLine1,
      city: first.city,
      state: first.state,
      zipCode: first.zipCode,
      units,
      strays,
      total: units.length,
      done,
      status,
    });
  }
  return { buildings, singles };
}

// A door's street (house number and unit stripped) and house number, for "sorted by street, then house number".
const streetPart = (line1) => stackBaseOf(line1).replace(/^\d+\s+/, '');
const houseNumber = (line1) => parseInt(String(line1 || ''), 10) || 0;
const unitLine = (u) => String(u.addressLine2 || u.addressLine1 || '');

// The homes on a shared spot in the order a canvasser walks them: by street, then house number, then unit.
export const homesInOrder = (units) =>
  [...(units || [])].sort(
    (a, b) =>
      streetPart(a.addressLine1).localeCompare(streetPart(b.addressLine1)) ||
      houseNumber(a.addressLine1) - houseNumber(b.addressLine1) ||
      unitLine(a).localeCompare(unitLine(b), undefined, { numeric: true })
  );

// The other units of this door's street address on its pin — the set the server's "Whole building" moves
// (server/src/services/households/updateHouseholdLocation.js sameAddressDoors), never the separate homes that
// merely share the coordinate. From the phone's own door list, so it counts what this phone holds.
export const sameAddressSiblings = (households, h) => {
  const key = buildingKey(h);
  if (!key) return [];
  const base = stackBaseOf(h.addressLine1);
  return (households || []).filter(
    (o) => String(o._id) !== String(h._id) && buildingKey(o) === key && stackBaseOf(o.addressLine1) === base
  );
};

// The doors on one pin grouped by street address, in homesInOrder: each group is one home, or one building's
// units. Returns [{ base, address, units }] — the admin map's stack chooser lists members under their address.
export const addressGroupsOf = (units) => {
  const groups = new Map();
  for (const u of homesInOrder(units)) {
    const base = stackBaseOf(u.addressLine1);
    const g = groups.get(base);
    if (g) g.units.push(u);
    else groups.set(base, { base, address: baseAddressOf(u.addressLine1), units: [u] });
  }
  return [...groups.values()];
};

// The admin map's payload (/admin/households/map) carries `location: { lng, lat }`, not GeoJSON; its key is the
// same ~1.1 m rounding.
export const adminKey = (h) => {
  const lng = h?.location?.lng;
  const lat = h?.location?.lat;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return `${Math.round(lat * 1e5)}|${Math.round(lng * 1e5)}`;
};

// A tap on the admin map: every door at the tapped pin's key (the payload's, not just the icons the tap hit), or
// the single door. Returns { stack: [door, …] } for 2+, { door } for one, or null.
export const stackForTap = (households, hitIds) => {
  const byId = new Map((households || []).map((h) => [String(h.id), h]));
  const first = (hitIds || []).map((id) => byId.get(String(id))).find(Boolean);
  if (!first) return null;
  const key = adminKey(first);
  const stack = key ? (households || []).filter((h) => adminKey(h) === key) : [first];
  return stack.length >= 2 ? { stack } : { door: first };
};
