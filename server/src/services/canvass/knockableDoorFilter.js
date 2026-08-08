// The one definition of "a door a canvasser can be sent to". Spread this into every query that
// cuts, serves, counts, or previews knockable doors — never inline the flags.
//
// History: this began as a 3-flag bundle (isActive / fullyVoted / excludedFromTurf) hand-copied
// at 15 sites across turf cutting, the mobile bootstrap, daily stats, and the demo seeder. The
// 4th flag (fullyDnc — every resident at the door asked not to be contacted) is why it was
// extracted: a suppression flag that misses even one site silently leaks doors canvassers must
// not visit. The 5th (doNotKnock — an address-level "never come back", mirrored from
// DoNotKnockAddress) was added here and nowhere else, exactly as this comment demanded; that one
// line reached every cut/serve/count site for free. If a 6th ever appears, same rule.
//
// Deliberately NOT included: 'location.coordinates' (some counting sites include coordinate-less
// doors on purpose) and effortId/turfId scoping — those stay per-site.
export const KNOCKABLE_DOOR_FILTER = Object.freeze({
  isActive: true,
  fullyVoted: { $ne: true },
  fullyDnc: { $ne: true },
  doNotKnock: { $ne: true },
  excludedFromTurf: { $ne: true },
});
