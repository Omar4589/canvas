import mongoose from 'mongoose';
import { Household } from '../../models/Household.js';
import { HouseholdLocationChange } from '../../models/HouseholdLocationChange.js';
import { inStateBounds, isValidLatLng } from '../../utils/stateBounds.js';
import { buildingKeyForCoords } from '../../utils/buildingKey.js';
import { haversineMeters } from '../../utils/normalizeAddress.js';
import { stackBaseOf } from '../../utils/streetName.js';
import { isPinUnplaced } from './pinState.js';
import { rehullBooksForMovedHouseholds } from '../turf/rehullAfterPinMove.js';

// A save landing this close to the pin it started from moved nothing (a tap without a real drag).
export const NO_MOVE_METERS = 1.5;

const metersBetween = (a, b) =>
  a?.length === 2 && b?.length === 2 ? haversineMeters(a[1], a[0], b[1], b[0]) : Infinity;

// The units of one building on one spot: the active doors in the campaign on the same ~1.1 m building
// key whose street address (stackBaseOf) matches. Shared by the move and confirm fan-outs, so "Whole
// building" means one street address — never the other houses a vendor stamped with the same
// coordinate (docs/PROPOSAL_PLACEHOLDER_PINS.md §G). A 3 m geo query rides the 2dsphere index, then the
// exact key decides.
export async function sameAddressDoors({ campaignId, location, addressLine1, excludeId = null }) {
  const coords = location?.coordinates;
  const key = buildingKeyForCoords(coords);
  if (!key) return [];
  const base = stackBaseOf(addressLine1);
  const near = await Household.find({
    campaignId,
    isActive: true,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    location: { $geoWithin: { $centerSphere: [coords, 3 / 6378137] } },
  });
  return near.filter((h) => buildingKeyForCoords(h.location?.coordinates) === key && stackBaseOf(h.addressLine1) === base);
}

// Correct a household's pin. Shared by the canvasser (mobile) and admin (web)
// endpoints so provenance can never drift.
//
// Deliberately touches ONLY the coordinate + provenance. It does NOT change
// `turfId`/`walkOrder`/book membership (set at cut time, not re-derived from coords),
// `status`, or any published `ClientReportMapPoint` snapshot — so a fix never re-cuts
// turf or resets a door. It DOES redraw the affected book outlines afterwards
// (`Turf.boundary`/`centroid` — display-only, best-effort; services/turf/rehullAfterPinMove.js)
// so the door still sits inside its book's drawn shape; `rehull: false` opts out for a bulk
// caller that redraws whole passes itself (migrations/repairImportPins.js). A
// `HouseholdLocationChange` audit row is written per move.
//
// `scope: 'building'` also moves every OTHER active unit of the same street address on the same
// pin (an apartment tower placed wrong), each getting its own provenance + audit row — whatever
// their shared-spot flags, and never the separate houses a vendor stamped with the same coordinate.
// It never answers 4xx: old apps and queued offline replays send 'building' too.
//
// A move clears the door's shared-spot flag (pinSuspect) in the same single write, and records the
// spot a flagged door left (pinPlacement, by 'person'). Two saves move nothing and write nothing:
//   · onto a door's own pin when that door is unplaced now (a save without a real drag) — for a
//     building, when ANY unit it would move is;
//   · back onto the shared spot a placed door left (an old phone's stale save), unless the lookup had
//     placed it in place, where that spot is the verified house.
//
// Returns { updated: [householdDoc, ...], moved, unchanged, turfsRecomputed: string[] } (the primary
// first; `moved` 0 with `unchanged: true` for the no-op cases; the ids of the books whose outline was
// redrawn — [] when no live book holds the door, the pass was over the re-hull cap, or the redraw
// failed) or throws an Error with `.code = 'out_of_bounds' | 'invalid_coords'` for a 4xx.
export async function updateHouseholdLocation(
  household,
  { lat, lng },
  { source, byUserId, accuracy = null, scope = 'unit', rehull = true } = {}
) {
  if (!isValidLatLng(lat, lng)) {
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

  // Which households move: just this one, or every active unit of its street address on its pin.
  let targets = [household];
  if (scope === 'building' && household.location?.coordinates?.length === 2) {
    const siblings = await sameAddressDoors({
      campaignId: household.campaignId,
      location: household.location,
      addressLine1: household.addressLine1,
      excludeId: household._id,
    });
    targets = [household, ...siblings];
  }

  const point = [lng, lat];
  const placement = household.pinPlacement;
  const keyOf = (c) => buildingKeyForCoords(c);
  const savedOnItsOwnPin = (h) => isPinUnplaced(h) && metersBetween(h.location?.coordinates, point) <= NO_MOVE_METERS;
  const backOntoTheSpotItLeft =
    !!placement?.at &&
    keyOf(placement.from) !== keyOf(placement.to) &&
    keyOf(household.location?.coordinates) !== keyOf(placement.from) &&
    metersBetween(placement.from, point) <= NO_MOVE_METERS;
  if (targets.some(savedOnItsOwnPin) || backOntoTheSpotItLeft) {
    return { updated: [household], moved: 0, unchanged: true, turfsRecomputed: [] };
  }

  // One pipeline write per target. Every expression in a $set stage reads the document as it was
  // before the stage, so `from` and previousLocation are the old spot. Mongoose validates a
  // pipeline's shape but never casts its values, so correctedBy is cast here (the repair script's
  // --user arrives as a string). Built from the RETURNED document: the audit row and the route's
  // response, which therefore carries no pinSuspect for a door just fixed.
  const correctedBy = byUserId ? new mongoose.Types.ObjectId(String(byUserId)) : null;
  const to = { type: 'Point', coordinates: point };
  const now = new Date();
  const updated = [];
  for (const h of targets) {
    const doc = await Household.findOneAndUpdate(
      { _id: h._id },
      [
        {
          $set: {
            pinPlacement: {
              $cond: [
                { $eq: [{ $type: '$pinSuspect' }, 'string'] },
                { from: '$location.coordinates', to: point, at: now, kind: '$pinSuspect', by: 'person' },
                '$pinPlacement',
              ],
            },
            location: { type: 'Point', coordinates: point },
            coordSource: 'corrected',
            coordConfidence: null,
            correctedBy,
            correctedAt: now,
            previousLocation: '$location',
            // A real move supersedes a confirm-in-place vouch (Pin Fixes): the stamp described the
            // OLD spot, so leaving it would vouch for a pin nobody verified.
            locationConfirmedBy: null,
            locationConfirmedAt: null,
          },
        },
        { $unset: 'pinSuspect' },
      ],
      { new: true }
    );
    if (!doc) continue; // deleted mid-request
    updated.push(doc);
    const from = doc.previousLocation?.coordinates?.length === 2 ? doc.previousLocation : null;
    await HouseholdLocationChange.create({
      organizationId: doc.organizationId,
      campaignId: doc.campaignId,
      householdId: doc._id,
      userId: correctedBy,
      source,
      scope,
      accuracy,
      from,
      to,
    });
  }

  // Outlines LAST — every coordinate + audit row above is already committed, so the redraw is
  // derived from then-current pins and can never gate (or roll back) the pin write. Logged, never
  // thrown: a failed redraw leaves a stale outline, which recompute:territories heals.
  let turfsRecomputed = [];
  if (rehull) {
    try {
      turfsRecomputed = (await rehullBooksForMovedHouseholds({
        campaignId: household.campaignId,
        householdIds: updated.map((h) => h._id),
        point: [lng, lat],
      })) || [];
    } catch (err) {
      console.error('[pin-move] re-hull failed:', err?.message || err);
    }
  }
  if (!updated.length) return { updated: [household], moved: 0, unchanged: true, turfsRecomputed };
  return { updated, moved: updated.length, unchanged: false, turfsRecomputed };
}
