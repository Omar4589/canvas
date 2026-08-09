// Doors stacked on one exact pin, classified: a real building, or a vendor placeholder?
//
// A genuine apartment/park is ONE street address with many units — every door shares its
// street line ("1000 Lely Palms Dr Apt 151" and "Apt 152" both read "Lely Palms Dr" once
// streetName.js strips the unit). A vendor PLACEHOLDER pin is the opposite: when a voter
// file can't place an address it stamps a ZIP/area centroid instead of leaving the
// coordinates blank, so doors from many DIFFERENT streets pile onto one identical dot.
// Measured on a real i360 district file: 176 such pins holding 2,081 doors — ~8% of the
// walk universe rendered unwalkable and, worse, excluded from books by "Remove apartments"
// (which keys on geocode stacking and cannot tell a tower from 18 collapsed houses).
//
// The refinement that keeps real buildings safe is the DOMINANT-STREET rule, learned from
// that same file: an 89-door mobile-home park carried two badly-typed rows ("Lbby K25"),
// and a naive "two streets = fake" test would have flagged the whole park. So:
//   · one street holds an OUTRIGHT MAJORITY of the pin (> DOMINANT_SHARE) → a real building
//     plus STRAYS; only the off-street doors are suspect.
//   · no street holds a majority → a PLACEHOLDER; every door is suspect. Strictly greater
//     on purpose: two doors on two different streets is a 50/50 split, and calling either
//     one "the building" would leave a genuinely mis-pinned door unchecked. Half strangers
//     is not a building.
//
// Consumed by the import validator (to warn in the preview) and repair:import-pins (to
// shortlist doors for geocode adjudication). Pure — callers supply { id, street, pinKey }.

export const DOMINANT_SHARE = 0.5;

/**
 * doors: [{ id, street, pinKey }] — street from streetName.js's streetOf, pinKey from
 * buildingKey.js (null pinKey rows are ignored: no coordinate, nothing to stack).
 *
 * Returns {
 *   suspects: Map<id, { kind: 'placeholder'|'stray', pinKey, pinDoors, pinStreets }>,
 *   placeholderPins, placeholderDoors,   // pins with no dominant street, and their doors
 *   strayDoors,                          // off-street doors at dominant-street pins
 * }
 */
export function classifyStackedPins(doors) {
  const byPin = new Map();
  for (const d of doors || []) {
    if (!d || !d.pinKey) continue;
    const arr = byPin.get(d.pinKey);
    if (arr) arr.push(d);
    else byPin.set(d.pinKey, [d]);
  }

  const suspects = new Map();
  let placeholderPins = 0;
  let placeholderDoors = 0;
  let strayDoors = 0;

  for (const [pinKey, stack] of byPin) {
    if (stack.length < 2) continue;
    const freq = new Map();
    for (const d of stack) {
      const s = d.street || '';
      freq.set(s, (freq.get(s) || 0) + 1);
    }
    if (freq.size < 2) continue; // one street line — a real building; never a suspect

    let modalStreet = '';
    let modalCount = 0;
    for (const [s, n] of freq) {
      if (n > modalCount) {
        modalStreet = s;
        modalCount = n;
      }
    }

    if (modalCount / stack.length > DOMINANT_SHARE) {
      // A real building with a few off-street strays — the strays are the mis-pins.
      for (const d of stack) {
        if ((d.street || '') === modalStreet) continue;
        suspects.set(d.id, { kind: 'stray', pinKey, pinDoors: stack.length, pinStreets: freq.size });
        strayDoors += 1;
      }
    } else {
      placeholderPins += 1;
      placeholderDoors += stack.length;
      for (const d of stack) {
        suspects.set(d.id, { kind: 'placeholder', pinKey, pinDoors: stack.length, pinStreets: freq.size });
      }
    }
  }

  return { suspects, placeholderPins, placeholderDoors, strayDoors };
}
