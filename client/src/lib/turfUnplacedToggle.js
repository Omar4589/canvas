// Turf Cutting's "Leave out N homes without a reliable map spot" (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S10.6) —
// the pure half, so `node --test src/` pins the words and the arithmetic.
//
// A home is left out when its pin is flagged and nobody has vouched for it: it shares a spot with other
// addresses, sits far from its street, or couldn't be found by address. A condo complex and a confirmed home
// cut as usual. Cut as they are, flagged homes land in whichever book covers their wrong spot.

const homes = (n) => `${n.toLocaleString()} ${n === 1 ? 'home' : 'homes'}`;

export const unplacedToggleCopy = (count) => ({
  label: `Leave out ${homes(count)} without a reliable map spot`,
  sub: 'They share a spot with other addresses, sit far from their street, or couldn’t be found by address — cut as they are, they land in the wrong book.',
  link: 'Fix in Pin Fixes →',
});

// The line under a finished cut that left homes out.
export const unplacedLeftOutLine = (count) =>
  `${homes(count)} left out — fix ${count === 1 ? 'its pin' : 'their pins'} in Pin Fixes, then Add as new book.`;

// "N doors not in any book" with every ticked toggle subtracted. Restricted and no-soliciting are disjoint
// (one status per door); the unplaced slice can overlap either, so its overlaps are added back when those
// toggles are ticked too (inclusion–exclusion). Every count is the server's (GET /turfs summary).
export const unassignedDoorCount = (summary = {}, { excludeRestricted = false, excludeNoSoliciting = false, excludeUnplaced = false } = {}) => {
  const n = (k) => Number(summary[k]) || 0;
  const unplaced = excludeUnplaced
    ? n('supplementalUnplacedCount') -
      (excludeRestricted ? n('supplementalUnplacedRestrictedCount') : 0) -
      (excludeNoSoliciting ? n('supplementalUnplacedNoSolicitingCount') : 0)
    : 0;
  return Math.max(
    0,
    n('supplementalDoorCount') -
      (excludeRestricted ? n('supplementalRestrictedCount') : 0) -
      (excludeNoSoliciting ? n('supplementalNoSolicitingCount') : 0) -
      unplaced
  );
};
