// The pin badge and its one-line explanation on every web door surface — the Map page's door panel and the
// Turf Cutting house pop-up; the phone mirrors the same order (docs/PROPOSAL_PLACEHOLDER_PINS.md §J). Pure, so
// `node --test src/` pins the order and the wording.
//
// The badge: the first that applies wins.
//   1. No exact map spot  — the door is unplaced now (the payloads send `pinSuspect` only then);
//   2. Location confirmed — a person vouched the spot (any door with the stamp, a shared-spot home included);
//   3. Pin corrected      — a person moved it;
//   4. Approximate location — a street-level geocode nobody has checked.
export const pinBadge = (h) => {
  if (!h) return null;
  if (h.pinSuspect) return { kind: 'unplaced', label: 'No exact map spot', tone: 'warning', at: null };
  if (h.locationConfirmedAt) return { kind: 'confirmed', label: 'Location confirmed', tone: 'brand', at: h.locationConfirmedAt };
  if (h.coordSource === 'corrected') return { kind: 'corrected', label: 'Pin corrected', tone: 'brand', at: h.correctedAt || null };
  if (h.coordConfidence === 'interpolated') return { kind: 'approximate', label: 'Approximate location', tone: 'warning', at: null };
  return null;
};

// The sentence under the badge, when one applies: why a home has no exact spot, or what the address lookup
// did with it (`pinPlaced`, sent only while the lookup's placement stands). `fmtDate` formats a date in the
// page's time zone.
export const pinLine = (h, fmtDate = (d) => String(d)) => {
  if (!h) return null;
  if (h.pinSuspect) return 'This home has no exact map spot; its coordinate was shared with other addresses.';
  const pp = h.pinPlaced;
  if (!pp) return null;
  const when = pp.at ? ` (${fmtDate(pp.at)})` : '';
  if (pp.inPlace) return `The address lookup confirms this spot${when}.`;
  const n = Number(pp.stackSize) || 0;
  return `Placed by address${when}. Its earlier spot was shared with ${n > 0 ? `${n.toLocaleString()} other ${n === 1 ? 'home' : 'homes'}` : 'other addresses'}.`;
};

// "Just this unit" or "Whole building (N units)": asked only when other units of the door's street address
// share its pin (`sameAddress` from GET /admin/households/:id/activity — the server's own count, because the
// Map page's payload is date-filtered and would miss units nobody knocked today).
export const needsScopeQuestion = (sameAddress) => Number(sameAddress?.count) >= 2;
