import { Household } from '../../models/Household.js';
import { HouseholdLocationChange } from '../../models/HouseholdLocationChange.js';
import { buildingKeyForCoords } from '../../utils/buildingKey.js';

// The ONE "this pin still needs a human look" predicate — spread it over a campaignId (or a
// campaignId $in) everywhere the needs-fixing set is read: the Pin Fixes list endpoint, the
// campaigns-rollup badge count, and any test oracle. One predicate, three surfaces, so the
// badge, the list, and the map can never disagree (the Door Outcomes one-resolver precedent).
export const NEEDS_PIN_FIX = {
  isActive: true,
  coordConfidence: 'interpolated',
  locationConfirmedAt: null,
};

// Confirm a household's approximate pin IN PLACE (the Pin Fixes queue): a manager checked the
// interpolated geocode against imagery/Google Maps and vouches it's right without moving it.
// Deliberately NOT updateHouseholdLocation — that writer means "a human PLACED this pin" and
// stamps coordSource='corrected', which re-imports shield and the far-flag downgrade trusts.
// A confirmed pin is still the geocoder's answer; only the stamp changes.
//
// `scope: 'building'` also confirms every other active door sharing the same ~1.1m pin — but,
// unlike the move fan-out, ONLY interpolated siblings. That filter is load-bearing twice over:
// a 'confirm' audit row must never land on a coordSource='corrected' door (repair:import-pins
// reverts its own repairs only while the door's LATEST audit row is 'import_repair' — a confirm
// row on top would permanently mask that), and an 'exact' rooftop sibling was never in question,
// so stamping it would log a verification nobody performed.
//
// `confirmed: false` is the undo: it clears the stamp (same targets) and writes NO audit row —
// un-stamping isn't a location event, and the stamp's absence is the record.
//
// Returns { updated: [householdDoc, ...] } — only the docs actually changed (already-confirmed
// doors are skipped on confirm; unstamped doors are skipped on undo).
export async function confirmHouseholdLocation(
  household,
  { byUserId, scope = 'unit', confirmed = true } = {}
) {
  // Guard the save-then-throw trap: HouseholdLocationChange.userId is required, and the row is
  // written after the stamp save — a missing user id must fail BEFORE anything persists.
  if (!byUserId) {
    const err = new Error('byUserId is required');
    err.code = 'missing_user';
    throw err;
  }

  let targets = [household];
  if (scope === 'building' && household.location?.coordinates?.length === 2) {
    const key = buildingKeyForCoords(household.location.coordinates);
    if (key) {
      const siblings = await Household.find({
        campaignId: household.campaignId,
        isActive: true,
        _id: { $ne: household._id },
        coordConfidence: 'interpolated', // the load-bearing narrowing — see header
        'location.coordinates': { $exists: true, $ne: null },
      });
      const sameKey = siblings.filter((h) => buildingKeyForCoords(h.location?.coordinates) === key);
      targets = [household, ...sameKey];
    }
  }

  const now = new Date();
  const updated = [];
  for (const h of targets) {
    if (confirmed) {
      if (h.locationConfirmedAt) continue; // already vouched — don't re-stamp or re-log
      h.locationConfirmedBy = byUserId;
      h.locationConfirmedAt = now;
      await h.save();
      await HouseholdLocationChange.create({
        organizationId: h.organizationId,
        campaignId: h.campaignId,
        householdId: h._id,
        userId: byUserId,
        source: 'confirm',
        scope,
        from: h.location || null,
        to: h.location, // nothing moved — from equals to, by design
      });
      updated.push(h);
    } else {
      if (!h.locationConfirmedAt) continue;
      h.locationConfirmedBy = null;
      h.locationConfirmedAt = null;
      await h.save();
      updated.push(h);
    }
  }
  return { updated };
}
