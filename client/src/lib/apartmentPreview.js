// Turf Cutting's "Remove apartments" line — the pure half, so `node --test src/` pins it.
//
// GET /admin/campaigns/:id/turfs/apartment-preview answers once for every threshold, from the same
// function the button's POST runs (server/src/services/turf/apartmentStacks.js): one entry per door
// any threshold ≥ 2 would take, as parallel arrays { ids, takenUpTo, spot }. A door is taken at
// threshold N iff N ≤ takenUpTo; `spot` numbers its map spot. So the line counts exactly what the
// button will hold out — never a separate house that only shares its neighbours' coordinate.

export const apartmentPreviewCounts = (candidates, threshold) => {
  const takenUpTo = candidates?.takenUpTo || [];
  const spot = candidates?.spot || [];
  const n = Math.max(2, Number(threshold) || 4);
  let doors = 0;
  const spots = new Set();
  for (let i = 0; i < takenUpTo.length; i += 1) {
    if (takenUpTo[i] < n) continue;
    doors += 1;
    spots.add(spot[i]);
  }
  return { doors, spots: spots.size };
};

// "Holds out 441 homes on 61 spots (4+ units at one address, or a unit address on a spot of 4+)"
export const apartmentPreviewLine = ({ doors, spots }, threshold) => {
  const n = Math.max(2, Number(threshold) || 4);
  if (!doors) return 'None found';
  return `Holds out ${doors.toLocaleString()} ${doors === 1 ? 'home' : 'homes'} on ${spots.toLocaleString()} ${
    spots === 1 ? 'spot' : 'spots'
  } (${n}+ units at one address, or a unit address on a spot of ${n}+)`;
};
