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

// Age arrives PRE-COMPUTED from the server (`voter.age`) — the raw date of birth is deliberately
// never sent to the device.
//
// It used to be. The bootstrap shipped every voter's full `dateOfBirth`, which then sat in the
// AsyncStorage cache on every canvasser's phone... and the only thing the app ever did with it was
// derive this integer. A DOB is the most identity-theft-useful field in a voter file; an age is
// close to worthless. So the server does the arithmetic and the sensitive field never leaves it.
// The strongest protection for a field is not sending it.
//
// The `dateOfBirth` fallback below is NOT dead code: a phone that has not re-bootstrapped since the
// update still holds an old cached payload with dates and no ages. It can go once every install has
// refreshed — but it costs nothing to leave, and removing it early would blank the age line on the
// doors of anyone mid-shift during a deploy.
export function voterAge(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 86400000));
}

// The canonical door-facing meta, in order: Party · Age · Gender.
// Voter-file imports are sparse (plenty of rows have no age or party), so every
// part is optional and the caller joins whatever survives — never a dangling ' · '.
export function voterMetaParts(voter) {
  if (!voter) return [];
  const age = voter.age ?? voterAge(voter.dateOfBirth);
  return [voter.party, age != null ? `${age} yrs` : null, voter.gender].filter(Boolean);
}

// Normalize a raw voter-file party value to a colors.party key. Vendor files carry whatever the
// state exports — 'D', 'REP', 'DEM', 'UNA', 'NPA', 'Libertarian' — while colors.party is keyed on
// full names, so an unmapped value used to fall through to colors.brand and paint the bar RED,
// which reads as Republican. Unrecognized-but-present parties map to 'Other' (amber — honest:
// "a party, not one of the big three"), blank/null to 'Unknown' (gray). Display still shows the
// file's own raw text; only the COLOR is normalized.
const PARTY_KEY = {
  D: 'Democratic', DEM: 'Democratic', DEMOCRAT: 'Democratic', DEMOCRATIC: 'Democratic',
  R: 'Republican', REP: 'Republican', REPUBLICAN: 'Republican', GOP: 'Republican',
  I: 'Independent', IND: 'Independent', INDEPENDENT: 'Independent',
  U: 'No Party', UN: 'No Party', UNA: 'No Party', NPA: 'No Party', NP: 'No Party',
  UNAFFILIATED: 'No Party', NONPARTISAN: 'No Party', 'NON-PARTISAN': 'No Party',
  'NO PARTY': 'No Party', NONE: 'No Party',
  UNKNOWN: 'Unknown',
};
export function partyKey(raw) {
  const s = raw == null ? '' : String(raw).trim();
  if (!s) return 'Unknown';
  return PARTY_KEY[s.toUpperCase()] || 'Other';
}
