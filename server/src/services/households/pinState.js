// What a door's shared-map-spot fields mean, in one place (docs/PROPOSAL_PLACEHOLDER_PINS.md §C).
// Pure: every caller passes a household (a lean doc is fine) with the fields it was loaded with.

import { buildingKeyForCoords } from '../../utils/buildingKey.js';

// The kinds that mean "this pin is not the home" (the pin-fixes build adds 'far' and 'unlocated'). A
// 'complex' is the other kind of flag: the spot IS right, several homes share it.
export const UNPLACED_KINDS = Object.freeze(['placeholder', 'stray', 'far', 'unlocated']);
export const isComplex = (h) => h?.pinSuspect === 'complex';

// "Unplaced now": the door's pin is judged not to be the home (a shared spot, far from its street, a
// holding spot), and no person has vouched for it since. A confirm keeps pinSuspect under the vouch, so
// Undo restores the door exactly. A complex member is never unplaced.
export const isPinUnplaced = (h) => UNPLACED_KINDS.includes(h?.pinSuspect) && !h?.locationConfirmedAt;

// Flagged at all (a complex included) and unvouched. The server's two "nothing moved" save gates read this
// (updateHouseholdLocation's savedOnItsOwnPin; the door activity route's sameAddress.unplaced), so a
// complex member saved on its own spot is still refused as "nothing moved".
export const isPinFlaggedUnvouched = (h) => !!h?.pinSuspect && !h?.locationConfirmedAt;

// The flag every payload sends in its `pinSuspect` field: the raw value while the door is unplaced now,
// so a vouched unplaced home never reaches a client flagged — and 'complex' always, vouched or not: every
// map needs the fact, and the phones already draw any flagged stack as homes with per-home Directions.
export const effectivePinSuspect = (h) => (isComplex(h) || isPinUnplaced(h) ? h.pinSuspect : null);

// What a knock records about the pin it was measured against (CanvassActivity.knockPin), frozen at write
// time: 'complex' for a complex member (vouched or not — the dot is the complex), 'estimated' for an
// approximate lookup pin nobody has confirmed, else null.
export const knockPinOf = (h) =>
  isComplex(h) ? 'complex' : h?.coordConfidence === 'interpolated' && !h?.locationConfirmedAt ? 'estimated' : null;

// Placed by the address lookup, and still where the lookup put it: any later location writer changes
// coordSource (to 'corrected' by hand, 'file' on a vendor change) or stamps releasedAt.
export const isPlacedByLookup = (h) =>
  h?.pinPlacement?.by === 'lookup' && !h.pinPlacement.releasedAt && h?.coordSource === 'geocodio';

// The pin facts a client draws, for every payload that ships a door's pin (docs/PROPOSAL_PLACEHOLDER_PINS_RELEASE2.md
// §A). Each field is set only when it applies, so an ordinary door's payload is unchanged:
//   pinSuspect — 'placeholder' | 'stray' while the door is unplaced now (effectivePinSuspect);
//   pinPlaced  — { at, inPlace, stackSize } while the address lookup's placement is current: `inPlace` when the
//                lookup found the home on the spot it already had, `stackSize` the other homes that shared its
//                old spot (null when the record holds no count).
// The household must carry pinSuspect, locationConfirmedAt, coordSource and pinPlacement.
export const pinWireFields = (h) => {
  const out = {};
  const ps = effectivePinSuspect(h);
  if (ps) out.pinSuspect = ps;
  if (isPlacedByLookup(h)) {
    const pp = h.pinPlacement;
    out.pinPlaced = {
      at: pp.at || null,
      inPlace: buildingKeyForCoords(pp.from) === buildingKeyForCoords(pp.to),
      stackSize: Number.isFinite(pp.stackSize) ? pp.stackSize : null,
      // The flag the door left: 'unlocated' means it had no location in the file, so the web's placement
      // line says that instead of "its earlier spot was shared with N other homes".
      kind: pp.kind || null,
    };
  }
  return out;
};
