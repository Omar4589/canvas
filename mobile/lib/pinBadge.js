// The pin badge on the phone's door screens (the canvasser door screen and the admin map's door sheet) — the
// same order as the web (client/src/lib/pinBadges.js, docs/PROPOSAL_PLACEHOLDER_PINS.md §J). The first that
// applies wins:
//   1. No exact map spot  — unplaced now (the payloads send `pinSuspect` only then);
//   2. Location confirmed — a person vouched the spot (any door with the stamp, a shared-spot home included);
//   3. Pin corrected      — a person moved it;
//   4. Approximate location — a street-level geocode nobody has checked.
// `tone` picks the colour: 'warning' or 'brand'. Null when no badge applies.
export const pinBadge = (h) => {
  if (!h) return null;
  if (h.pinSuspect) return { kind: 'unplaced', label: 'No exact map spot', tone: 'warning' };
  if (h.locationConfirmedAt) return { kind: 'confirmed', label: 'Location confirmed', tone: 'brand' };
  if (h.coordSource === 'corrected') return { kind: 'corrected', label: 'Pin corrected', tone: 'brand' };
  if (h.coordConfidence === 'interpolated') return { kind: 'approximate', label: 'Approximate location', tone: 'warning' };
  return null;
};
