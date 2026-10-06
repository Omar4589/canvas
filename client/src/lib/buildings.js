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

import { stackBaseOf, baseAddressOf, streetOf } from './streetName.js';

export const BUILDING_MIN_UNITS = 2;

// Doors whose status counts as worked. Mirrors mobile/lib/buildings.js.
const DONE_STATUSES = new Set(['surveyed', 'lit_dropped']);

export function buildingKeyForCoords(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return `${Math.round(lat * 1e5)}|${Math.round(lng * 1e5)}`;
}

// What a stack of doors on one pin is, from each door's effective `pinSuspect` (the payloads send it only
// while the door has no exact map spot — server/src/services/households/pinState.js pinWireFields):
//   'unplaced' — different homes that share one map spot: any member is 'placeholder', or every member is
//                flagged. Drawn as "N homes", never as a building.
//   'building' — anything else. Its 'stray' members (a different address sitting on the building's spot) are
//                listed apart, and the building's header address comes from its first non-stray member.
// The one rule on the web and the phone (docs/PROPOSAL_PLACEHOLDER_PINS.md §J).
export const stackKind = (units) => {
  const list = units || [];
  if (!list.length) return 'building';
  if (list.some((u) => u.pinSuspect === 'placeholder') || list.every((u) => !!u.pinSuspect)) return 'unplaced';
  return 'building';
};

// households: the /admin/households/map shape — { id, location: { lng, lat }, status, … }.
// Returns:
//   buildings  — [{ key, kind, lng, lat, units, strays, total, done, touched, roll }] sorted biggest-first
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
    const kind = stackKind(units);
    // Strays stay in `units`, `total` and the roll-up (every door on the pin is counted); a building's
    // header comes from its first member that isn't one.
    const strays = kind === 'building' ? units.filter((u) => u.pinSuspect === 'stray') : [];
    const first = (kind === 'building' && units.find((u) => u.pinSuspect !== 'stray')) || units[0];
    buildings.push({
      key,
      kind,
      lng: first.location.lng,
      lat: first.location.lat,
      addressLine1: first.addressLine1,
      city: first.city,
      state: first.state,
      zipCode: first.zipCode,
      units,
      strays,
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
  if (building.kind === 'unplaced') return `${building.total} homes at one map spot`;
  const lines = new Set(building.units.map((u) => (u.addressLine1 || '').trim()).filter(Boolean));
  if (lines.size === 1) return [...lines][0];
  return lines.size > 1 ? `${building.total} doors at one pin` : 'Building';
}

// Move building pin on a stack: the units of the street address that holds MORE THAN HALF of the doors
// on the pin (stackBaseOf, the key the server's scope:'building' fan-out uses — it moves exactly that
// address's units, never the separate houses that merely share the coordinate). Returns
// { primary, count, address } — any member of that address as the move's target, how many units it
// carries here, and its street address for the copy — or null when no address holds a majority: a spot of
// different homes, which are moved one at a time (Pin Fixes). The count is this payload's; the server's
// answer (res.moved) can be larger when doors outside the payload share the address.
export const buildingMovePrimary = (units) => {
  const list = units || [];
  if (list.length < 2) return null;
  const byBase = new Map();
  for (const u of list) {
    const base = stackBaseOf(u.addressLine1);
    const members = byBase.get(base);
    if (members) members.push(u);
    else byBase.set(base, [u]);
  }
  for (const members of byBase.values()) {
    if (members.length >= 2 && members.length * 2 > list.length) {
      return { primary: members[0], count: members.length, address: baseAddressOf(members[0].addressLine1) };
    }
  }
  return null;
};

// The doors on one pin grouped by street address (stackBaseOf), for every list that shows a stack: each
// group is one home, or one building's units. Groups sort by street, then house number; units inside a group
// by their unit line, numeric-aware. Returns [{ base, address, units }].
const houseNumber = (line1) => parseInt(String(line1 || ''), 10) || 0;
const unitLine = (u) => String(u.addressLine2 || u.addressLine1 || '');
export const addressGroups = (units) => {
  const byBase = new Map();
  for (const u of units || []) {
    const base = stackBaseOf(u.addressLine1);
    const list = byBase.get(base);
    if (list) list.push(u);
    else byBase.set(base, [u]);
  }
  const groups = [...byBase.entries()].map(([base, list]) => ({
    base,
    address: baseAddressOf(list[0].addressLine1),
    units: [...list].sort((a, b) => unitLine(a).localeCompare(unitLine(b), undefined, { numeric: true })),
  }));
  groups.sort(
    (a, b) =>
      streetOf(a.units[0].addressLine1).localeCompare(streetOf(b.units[0].addressLine1), undefined, { numeric: true }) ||
      houseNumber(a.units[0].addressLine1) - houseNumber(b.units[0].addressLine1) ||
      a.address.localeCompare(b.address)
  );
  return groups;
};
