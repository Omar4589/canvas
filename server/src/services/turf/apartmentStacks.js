import { Household } from '../../models/Household.js';
import { buildingKeyForCoords } from '../../utils/buildingKey.js';
import { stackBaseOf, isUnitAddress } from '../../utils/streetName.js';

// Remove apartments' one rule (docs/PROPOSAL_PLACEHOLDER_PINS.md §H). At threshold N, a door is taken when
//   1. at least N doors on its map spot share its street address (stackBaseOf) — a building's units; or
//   2. its address names a unit (isUnitAddress) and its spot holds at least N doors.
// A separate house is never taken because a vendor stamped it with the same coordinate as its
// neighbours; a unit-addressed door can be, even when its building's main door is written without one.
//
// Returns one entry per door any N ≥ 2 would take: { id, takenUpTo, spot }. `takenUpTo` is the largest
// N that still takes the door (taken iff N ≤ takenUpTo); `spot` numbers its building key within this
// result. One read serves every threshold: the POST and the preview GET both call this, so the
// preview's numbers are what the button does. The population is the effort's active, located doors
// — voted and do-not-knock doors included, as the exclusion has always been.
export async function apartmentCandidates({ campaignId, effortId }) {
  const docs = await Household.find(
    { campaignId, effortId, isActive: true, 'location.coordinates': { $exists: true, $ne: null } },
    { _id: 1, location: 1, addressLine1: 1, addressLine2: 1 }
  ).lean();
  const bySpot = new Map();
  for (const h of docs) {
    const key = buildingKeyForCoords(h.location?.coordinates);
    if (!key) continue;
    const list = bySpot.get(key);
    if (list) list.push(h);
    else bySpot.set(key, [h]);
  }
  const out = [];
  let spot = 0;
  for (const doors of bySpot.values()) {
    if (doors.length < 2) continue;
    const bases = doors.map((h) => stackBaseOf(h.addressLine1));
    const perBase = new Map();
    for (const b of bases) perBase.set(b, (perBase.get(b) || 0) + 1);
    let any = false;
    doors.forEach((h, i) => {
      const takenUpTo = Math.max(perBase.get(bases[i]), isUnitAddress(h) ? doors.length : 0);
      if (takenUpTo < 2) return;
      out.push({ id: h._id, takenUpTo, spot });
      any = true;
    });
    if (any) spot += 1;
  }
  return out;
}

// The threshold as the routes have always clamped it.
export const apartmentThreshold = (raw) => Math.max(2, parseInt(raw, 10) || 4);
