// One tap's identity, for telling a duplicate delivery of it from new work — routes/mobile/canvass.js
// (supersededByNewer, deliveredInAnotherPass) and services/canvass/unknock.js (tapStruckInAnyPass).
// The caller scopes the rows to one canvasser at one door; the phone freezes the timestamp at the tap
// (mobile/lib/recordAction.js), so every delivery of one tap carries the same millisecond.
//
// The same tap: that millisecond, and the same action — or the outcome an admin has since converted the
// row FROM on Door Outcomes (`reclassified.from`): a duplicate arriving after that conversion used to
// re-apply the original outcome over the correction. For a survey, also the same voter — two voters at
// one door are two submissions even at one millisecond (code review 2026-10-19). A row converted away
// from Surveyed carries no voter; the one it had is `reclassified.voterIdWas` (round 2: its null voter
// matched every housemate surveyed in the same millisecond).
export const isSameTap = (row, { ts, actionType, voterId = null }) => {
  if (!row.timestamp || new Date(row.timestamp).getTime() !== ts.getTime()) return false;
  if (row.actionType !== actionType && row.reclassified?.from !== actionType) return false;
  const rowVoter = row.voterId ?? row.reclassified?.voterIdWas;
  return voterId == null || rowVoter == null || String(rowVoter) === String(voterId);
};
