// Fix pin location's rules for a home with no exact map spot (components/FixPinModal.jsx; placeholder pins,
// release 2, docs/PROPOSAL_PLACEHOLDER_PINS.md §K). Pure, so node pins them.
//
// On such a home — or a unit of its street address on the same spot — the pin starts on the shared spot, and a
// save that leaves it within NO_MOVE_METERS of that spot moves nothing on the server. So Save stays off until the
// lead has PUT the pin somewhere (a drag, or "Use my current location") clearly off the spot. A GPS fix that lands
// on the spot itself means the lead is standing there: Save stays off and the modal points to Looks right in Pin
// Fixes instead. On every other door Fix pin works as before: Save is on whenever there is a pin, nudges included.
import { distanceToCoords } from './geo.js';

export const NO_MOVE_METERS = 1.5; // the server's no-op radius (updateHouseholdLocation.js)
export const SEED_MAX_METERS = 500; // a lead's fix this close to the spot opens the map on them

// spot: the door's pin [lng, lat]; coords: { lng, lat } of the pin now; source: null | 'drag' | 'gps'.
export const fixPinSaveState = ({ unplaced = false, spot = null, coords = null, source = null }) => {
  if (!coords) return { canSave: false, atSpot: false };
  if (!unplaced) return { canSave: true, atSpot: false };
  const d = distanceToCoords(spot, [coords.lng, coords.lat]);
  const offSpot = d == null || d > NO_MOVE_METERS;
  return { canSave: !!source && offSpot, atSpot: source === 'gps' && !offSpot };
};

// Whether a GPS fix that arrives after the modal opened may move the pin and camera onto the lead: only on a
// home with no exact spot, only while the lead hasn't placed the pin yet, and only when the fix is near the spot
// (a lead working from far away isn't dropped on their own location).
export const seedAllowed = ({ unplaced = false, source = null, spot = null, fix = null }) => {
  if (!unplaced || source || !fix) return false;
  const d = distanceToCoords(spot, fix);
  return d != null && d <= SEED_MAX_METERS;
};

// The admin map's move bar posts the map centre. For a target with no exact spot (or a whole-building move whose
// address has an unplaced unit), a centre still on the spot would move nothing: the bar says so and posts nothing.
// spot / center: [lng, lat].
export const moveBarNothing = ({ unplaced = false, spot = null, center = null }) => {
  if (!unplaced) return false;
  const d = distanceToCoords(spot, center);
  return d != null && d <= NO_MOVE_METERS;
};
