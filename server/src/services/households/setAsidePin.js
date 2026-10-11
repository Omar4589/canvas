import mongoose from 'mongoose';
import { Household } from '../../models/Household.js';

// Set aside / bring back — the ONE writer of Household.pinSetAside (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md
// S7.1). "Fairfield University No Know, 00000" is never going to get a pin; Set aside takes such a home out
// of the Pin Fixes queue (the queue predicates in confirmHouseholdLocation.js skip the stamp) and out of
// every book cut. It rides excludedFromTurf, because every cut, count, phone and packet already honours that
// flag (KNOCKABLE_DOOR_FILTER) — so Re-include apartments (routes/admin/turfs.js) must, and does, skip a door
// carrying the stamp. The stamp is the record (who, when); set aside is not a location change, so it writes
// no HouseholdLocationChange row. A person's move or vouch brings the door back on its own
// (updateHouseholdLocation, confirmHouseholdLocation).
//
// Only a door the queue could show can be set aside: a pin flag, or an approximate pin. Any other door by id
// is ignored, so Set aside stays a pin-queue action, not a second "exclude from books".

const oids = (ids) => [...new Set((ids || []).map(String))].filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));

export const setAsidePins = async ({ campaignId, householdIds, byUserId }) => {
  const r = await Household.updateMany(
    {
      _id: { $in: oids(householdIds) },
      campaignId,
      isActive: true,
      'pinSetAside.at': null,
      $or: [{ pinSuspect: { $type: 'string' } }, { coordConfidence: 'interpolated' }],
    },
    { $set: { excludedFromTurf: true, pinSetAside: { at: new Date(), by: byUserId || null } } }
  );
  return { updated: r.modifiedCount || 0 };
};

export const bringBackPins = async ({ campaignId, householdIds }) => {
  const r = await Household.updateMany(
    { _id: { $in: oids(householdIds) }, campaignId, 'pinSetAside.at': { $ne: null } },
    { $set: { excludedFromTurf: false }, $unset: { pinSetAside: 1 } }
  );
  return { updated: r.modifiedCount || 0 };
};
