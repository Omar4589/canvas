// What a door's shared-map-spot fields mean, in one place (docs/PROPOSAL_PLACEHOLDER_PINS.md §C).
// Pure: every caller passes a household (a lean doc is fine) with the fields it was loaded with.

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
