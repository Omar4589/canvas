// Voter identity helpers shared by every door-facing surface.
//
// The map's house sheet and the household screen read the SAME bootstrap voter
// object, but each used to compose its own meta line — the sheet showed age, the
// household screen showed precinct. Same person, two different lines. These
// helpers are the one source of truth for what a canvasser reads at a door.
//
// Precinct is deliberately NOT here: it's turf/admin metadata, useless on a
// porch. It stays on the voter profile (voters/[id].jsx), which is fed by a
// different endpoint.

export function voterAge(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 86400000));
}

// The canonical door-facing meta, in order: Party · Age · Gender.
// Voter-file imports are sparse (plenty of rows have no DOB or party), so every
// part is optional and the caller joins whatever survives — never a dangling ' · '.
export function voterMetaParts(voter) {
  if (!voter) return [];
  const age = voterAge(voter.dateOfBirth);
  return [voter.party, age != null ? `${age} yrs` : null, voter.gender].filter(Boolean);
}
