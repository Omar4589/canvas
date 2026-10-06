// What a door's shared-map-spot fields mean, in one place (docs/PROPOSAL_PLACEHOLDER_PINS.md §C).
// Pure: every caller passes a household (a lean doc is fine) with the fields it was loaded with.

import { buildingKeyForCoords } from '../../utils/buildingKey.js';

// "Unplaced now": the door was judged to sit on a shared spot (pinSuspect), and no person has vouched
// for the spot since. A confirm keeps pinSuspect under the vouch, so Undo restores the door exactly.
export const isPinUnplaced = (h) => !!h?.pinSuspect && !h?.locationConfirmedAt;

// The flag every payload sends in its `pinSuspect` field: the raw value only while the door is
// unplaced now, so a vouched home never reaches a client flagged.
export const effectivePinSuspect = (h) => (isPinUnplaced(h) ? h.pinSuspect : null);

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
    };
  }
  return out;
};
