import { Household } from '../../models/Household.js';
import { HouseholdLocationChange } from '../../models/HouseholdLocationChange.js';
import { sameAddressDoors } from './updateHouseholdLocation.js';
import { isPinUnplaced } from './pinState.js';

// The ONE "this pin still needs a human look" predicate — spread it over a campaignId (or a
// campaignId $in) everywhere the needs-fixing set is read: the Pin Fixes list endpoint, the
// campaigns-rollup badge count, and any test oracle. One predicate, three surfaces, so the
// badge, the list, and the map can never disagree (the Door Outcomes one-resolver precedent).
export const NEEDS_PIN_FIX = {
  isActive: true,
  coordConfidence: 'interpolated',
  locationConfirmedAt: null,
};

// The queue's second set: doors judged to sit on a map spot shared with other addresses
// (services/households/placeStackedPins.js) that nobody has vouched for. Disjoint from NEEDS_PIN_FIX
// by construction (never 'interpolated' here), so the list and the badge read two queries and add
// them — no $or, which would defeat both partial indexes.
export const UNPLACED_PIN = {
  isActive: true,
  pinSuspect: { $type: 'string' },
  locationConfirmedAt: null,
  coordConfidence: { $ne: 'interpolated' },
};

// What the confirm may vouch for: an approximate geocode, or a door unplaced now.
export const isConfirmable = (h) => h?.coordConfidence === 'interpolated' || isPinUnplaced(h);
// A sibling needing a vouch: approximate, or carrying a shared-spot flag (a vouched one keeps it).
const needsVouch = (h) => h.coordConfidence === 'interpolated' || !!h.pinSuspect;

export const PIN_CHANGED = 'PIN_CHANGED';
const pinChanged = () => {
  const err = new Error('This pin changed since the page loaded — reloading.');
  err.code = PIN_CHANGED;
  return err;
};

// Confirm a household's approximate pin IN PLACE (the Pin Fixes queue): a manager checked the
// interpolated geocode against imagery/Google Maps and vouches it's right without moving it.
// Deliberately NOT updateHouseholdLocation — that writer means "a human PLACED this pin" and
// stamps coordSource='corrected', which re-imports shield and the far-flag downgrade trusts.
// A confirmed pin is still the geocoder's answer; only the stamp changes.
//
// It also vouches for a door unplaced now (on a map spot shared with other addresses): "the home
// really is here". pinSuspect is KEPT under the stamp — "unplaced now" is pinSuspect && no stamp —
// so an Undo restores the door exactly.
//
// `scope: 'building'` also confirms the other units of the SAME street address on the same ~1.1m
// pin (the move fan-out's set, services/households/updateHouseholdLocation.js sameAddressDoors) —
// but only those needing a vouch: approximate, or flagged. That filter is load-bearing twice over:
// a 'confirm' audit row must never land on a coordSource='corrected' door (repair:import-pins
// reverts its own repairs only while the door's LATEST audit row is 'import_repair' — a confirm
// row on top would permanently mask that; a corrected door gets the stamp but no row), and an
// 'exact' rooftop sibling was never in question, so stamping it would log a verification nobody
// performed. Separate houses on a shared spot are never vouched together.
//
// Each stamp is a CONDITIONAL write on the pin as loaded (location, coordSource, no stamp yet, the
// flag as loaded): a placement or a move that lands between the route's load and the stamp makes the
// primary's write match nothing, and the route answers 409 PIN_CHANGED instead of vouching for a pin
// nobody saw. A sibling that changed is just skipped.
//
// `confirmed: false` is the undo: it clears the stamp — the primary's, and only siblings stamped by
// the same confirm (same timestamp), so a sibling vouched separately stays vouched — and writes NO
// audit row: un-stamping isn't a location event, and the stamp's absence is the record.
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
    const siblings = await sameAddressDoors({
      campaignId: household.campaignId,
      location: household.location,
      addressLine1: household.addressLine1,
      excludeId: household._id,
    });
    targets = [household, ...siblings.filter(needsVouch)];
  }

  const now = new Date();
  const stamp = household.locationConfirmedAt;
  const updated = [];
  for (const h of targets) {
    const primary = h === household;
    if (confirmed) {
      if (h.locationConfirmedAt) continue; // already vouched — don't re-stamp or re-log
      const doc = await Household.findOneAndUpdate(
        {
          _id: h._id,
          'location.coordinates': h.location?.coordinates ?? null,
          coordSource: h.coordSource ?? null,
          locationConfirmedAt: null,
          pinSuspect: h.pinSuspect || { $exists: false },
        },
        { $set: { locationConfirmedBy: byUserId, locationConfirmedAt: now } },
        { new: true }
      );
      if (!doc) {
        if (primary) throw pinChanged();
        continue;
      }
      if (doc.coordSource !== 'corrected') {
        await HouseholdLocationChange.create({
          organizationId: doc.organizationId,
          campaignId: doc.campaignId,
          householdId: doc._id,
          userId: byUserId,
          source: 'confirm',
          scope,
          from: doc.location || null,
          to: doc.location, // nothing moved — from equals to, by design
        });
      }
      updated.push(doc);
    } else {
      if (!h.locationConfirmedAt) continue;
      if (!primary && +h.locationConfirmedAt !== +stamp) continue; // vouched separately: stays vouched
      const doc = await Household.findOneAndUpdate(
        { _id: h._id, locationConfirmedAt: h.locationConfirmedAt },
        { $set: { locationConfirmedBy: null, locationConfirmedAt: null } },
        { new: true }
      );
      if (doc) updated.push(doc);
    }
  }
  return { updated };
}
