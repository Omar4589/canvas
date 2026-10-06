// The canvasser list view's rows (app/(app)/map.jsx), pure so node can test them. The same scoped, grouped
// doors as the map, filtered by the active status chips, each with a distance to the canvasser, then sorted.
//
// Homes with no exact map spot (docs/PROPOSAL_PLACEHOLDER_PINS.md §K): a door whose coordinate is shared with
// other addresses (`pinSuspect`), or a spot of such homes (lib/buildings.js kind 'unplaced'), shows NO distance —
// it would be measured to the shared spot, not the house. Under "Nearest" they get their own "No exact map spot"
// section after the sorted homes. A spot of homes is one 'homes' row, filed under "Address A–Z" by its lowest
// house number on its street ("4906 E Monte Penne Way"), among the other numbered homes. A real building keeps its
// distance even when an odd address sits on its spot.
import { distanceToCoords } from './geo.js';

const STATUS_ORDER = { unknocked: 0, not_home: 1, wrong_address: 2, refused: 3, not_target: 4, no_soliciting: 5, restricted: 6, lit_dropped: 7, surveyed: 8 };
const houseNumber = (line1) => parseInt(String(line1 || ''), 10);

// The member line a spot of homes sorts by: its lowest house number (a home with no number sorts last).
const lowestLine = (units) => {
  const list = [...(units || [])].sort((a, b) => {
    const na = houseNumber(a.addressLine1);
    const nb = houseNumber(b.addressLine1);
    const fa = Number.isFinite(na);
    const fb = Number.isFinite(nb);
    if (fa !== fb) return fa ? -1 : 1;
    return (fa ? na - nb : 0) || String(a.addressLine1 || '').localeCompare(String(b.addressLine1 || ''));
  });
  return list[0]?.addressLine1 || '';
};

const byAddress = (a, b) => a._addr.localeCompare(b._addr, undefined, { numeric: true, sensitivity: 'base' }) || a._walk - b._walk;

export const NO_SPOT_SECTION = 'No exact map spot';

// singles / buildings: groupBuildings(); userCoords: [lng, lat] or null; activeFilters: Set of statuses (empty =
// all); sortMode: 'nearest' | 'walk' | 'address' | 'status'. Returns rows of kind 'single' | 'building' | 'homes'
// | 'section'.
export const buildListEntries = ({ singles = [], buildings = [], userCoords = null, activeFilters = new Set(), sortMode = 'walk' }) => {
  const matches = (s) => activeFilters.size === 0 || activeFilters.has(s || 'unknocked');
  const entries = [];
  for (const h of singles) {
    if (!matches(h.status)) continue;
    const noSpot = !!h.pinSuspect;
    entries.push({
      kind: 'single',
      key: String(h._id),
      household: h,
      noSpot,
      distanceM: noSpot ? null : distanceToCoords(userCoords, h.location?.coordinates),
      _walk: h.walkOrder ?? Infinity,
      _addr: h.addressLine1 || '',
      _status: STATUS_ORDER[h.status || 'unknocked'] ?? 9,
    });
  }
  for (const b of buildings) {
    if (activeFilters.size !== 0 && !b.units.some((u) => activeFilters.has(u.status || 'unknocked'))) continue;
    const homes = b.kind === 'unplaced';
    entries.push({
      kind: homes ? 'homes' : 'building',
      key: String(b.key),
      building: b,
      noSpot: homes,
      distanceM: homes ? null : distanceToCoords(userCoords, b.coordinates),
      _walk: Math.min(...b.units.map((u) => u.walkOrder ?? Infinity)),
      _addr: homes ? lowestLine(b.units) : b.addressLine1 || '',
      _status: 0, // stacks sort to the top of a status sort (mixed)
    });
  }
  const hasUser = Array.isArray(userCoords);
  if (sortMode === 'nearest' && hasUser) {
    const placed = entries.filter((e) => !e.noSpot).sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
    const noSpot = entries.filter((e) => e.noSpot).sort(byAddress);
    return noSpot.length ? [...placed, { kind: 'section', key: 'section:no-spot', title: NO_SPOT_SECTION }, ...noSpot] : placed;
  }
  entries.sort((a, b) => {
    if (sortMode === 'status') return a._status - b._status || a._walk - b._walk;
    // Address A→Z — numeric-aware so "12 Oak St" sorts before "104 Oak St".
    if (sortMode === 'address') return byAddress(a, b);
    return a._walk - b._walk; // 'walk' (and 'nearest' with no GPS fix)
  });
  return entries;
};
