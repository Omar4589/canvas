import { Household } from '../../models/Household.js';
import { HouseholdLocationChange } from '../../models/HouseholdLocationChange.js';
import { inStateBounds } from '../../utils/stateBounds.js';
import { buildingKeyForCoords } from '../../utils/buildingKey.js';

// Correct a household's pin. Shared by the canvasser (mobile) and admin (web)
// endpoints so provenance can never drift.
//
// Deliberately touches ONLY the coordinate + provenance. It does NOT change
// `turfId`/`walkOrder`/book membership (set at cut time, not re-derived from coords),
// `status`, or any published `ClientReportMapPoint` snapshot — so a fix never re-cuts
// turf or resets a door. A `HouseholdLocationChange` audit row is written per move.
//
// `scope: 'building'` also moves every OTHER active household sharing the same pin
// (an apartment tower placed wrong), each getting its own provenance + audit row.
//
// Returns { updated: [householdDoc, ...] } (the primary first) or throws an Error with
// `.code = 'out_of_bounds' | 'invalid_coords'` for a 4xx.
export async function updateHouseholdLocation(household, { lat, lng }, { source, byUserId, accuracy = null, scope = 'unit' } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    const err = new Error('Invalid coordinates');
    err.code = 'invalid_coords';
    throw err;
  }
  // Guardrail against a fat-finger drag across the country (fails open for unknown states).
  if (!inStateBounds(household.state, lat, lng)) {
    const err = new Error(`That spot is outside ${String(household.state || '').toUpperCase()}.`);
    err.code = 'out_of_bounds';
    throw err;
  }

  // Which households move: just this one, or every active door sharing its pin.
  let targets = [household];
  if (scope === 'building' && household.location?.coordinates?.length === 2) {
    const key = buildingKeyForCoords(household.location.coordinates);
    if (key) {
      const siblings = await Household.find({
        campaignId: household.campaignId,
        isActive: true,
        _id: { $ne: household._id },
        'location.coordinates': { $exists: true, $ne: null },
      });
      const sameKey = siblings.filter((h) => buildingKeyForCoords(h.location?.coordinates) === key);
      targets = [household, ...sameKey];
    }
  }

  const to = { type: 'Point', coordinates: [lng, lat] };
  const now = new Date();
  for (const h of targets) {
    const from = h.location && h.location.coordinates?.length === 2 ? h.location : null;
    h.previousLocation = from;
    h.location = { type: 'Point', coordinates: [lng, lat] };
    h.coordSource = 'corrected';
    h.coordConfidence = null;
    h.correctedBy = byUserId || null;
    h.correctedAt = now;
    await h.save();
    await HouseholdLocationChange.create({
      organizationId: h.organizationId,
      campaignId: h.campaignId,
      householdId: h._id,
      userId: byUserId || null,
      source,
      scope,
      accuracy,
      from,
      to,
    });
  }
  return { updated: targets };
}
