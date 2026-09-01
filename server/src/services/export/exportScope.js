import { Voter } from '../../models/Voter.js';

// Do-not-contact enforcement for the Export Center, in ONE place (owner decision
// 2026-08-01: no DNC voter appears in ANY new export — the strict reading of the published
// sentence "exclude that person from the organization's future canvassing lists and
// exports", privacy.html). The processor builds the context and injects it; builders
// receive it and never construct their own, so a new export type cannot forget the rule —
// and the registry-driven guard test (exportDnc coverage in exportBuilders.int.test.js)
// asserts the flagged fixture voter appears in no artifact of any type.
//
// Semantics by row unit:
//   voter-unit rows (survey responses, voter files, notes)  → the row IS the person: DROP it.
//   door-unit rows (canvass activity, door notes)           → the knock is a record of work
//     performed and billed, so the ROW stays and every voter-identity column goes blank —
//     with NO "withheld" marker, because a marker would itself flag the household as
//     containing an opt-out (leaking the very fact the rule protects).
// Both paths count into ExportJob.excludedDncCount so the honest undercount vs dashboard
// figures is explainable, never mysterious.
//
// TWO opt-in exceptions to "every voter-identity column goes blank". Both name the people
// registered at a door beside a record that named nobody; both are OFF by default and frozen into
// ExportJob.params, so the export history records which downloads carried them:
//
//   1. `notes` → `includeDoorVoters` (2026-09-01). A column listing the door's roster beside a door
//      note. The count column beside it counts ONLY the names printed — a count of 3 beside two
//      names would be exactly the marker this rule forbids. (PRIVACY_VERIFICATION v6 item 17.)
//   2. `canvass-activity` → `perVoterRows` (2026-09-01). An activity row whose voterId is null is
//      REPEATED once per registered voter at that door — the first option in the Export Center
//      that changes a file's row GRAIN rather than its columns, which is why the file and the
//      download are renamed activity-log-by-voter / canvass-activity-by-voter.
//      (PRIVACY_VERIFICATION v6 item 18.)
//
// Both read the roster through DNC_FILTER, so a flagged voter is simply ABSENT — the same omission
// voterfile-current.csv already publishes through the same clause, which is what makes it reveal
// nothing new to whoever receives the file. Three rules keep an omission from becoming the marker;
// a third exception must satisfy all three:
//   (a) NEVER emit a count, placeholder, ordinal or "withheld" row for an omitted voter. An empty
//       kept roster falls back to exactly ONE blank-identity row — byte-identical to the row a door
//       with NO registered voters produces — so "everyone here is flagged" and "nobody is registered
//       here" cannot be told apart, and the knock (billable work) never disappears from the ledger.
//   (b) Roster omissions do NOT count into excludedDncCount. That counter is per-JOB, so on a
//       tightly filtered export (one canvasser, one day, one door) a per-door omission count would
//       BE the disclosure. excludedDncCount keeps its one meaning: rows whose OWN voterId is flagged.
//   (c) The fan keys on the STORED voterId being null, never on whether the identity columns
//       RENDERED blank. A DNC-blanked row and a dangling-voterId row also print blank; fanning
//       either would attribute one person's knock to their neighbours (and break estimate==build,
//       which can only see the query-level null/non-null partition).

// Spread into any direct Voter query. resolveWalkList applies the same clause internally
// (resolveWalkList.js voter query); double application is harmless belt-and-braces.
export const DNC_FILTER = { 'doNotContact.flagged': { $ne: true } };

// The flagged-voter id set for join-time checks (door-unit rows carry a voterId that a
// query-level filter can't blank). Rides the partial { organizationId, doNotContact.flagged }
// index (flagged docs only), so this set is small — flagged voters, not the roster.
export async function loadDncVoterIdSet(organizationId, campaignId = null) {
  const q = { organizationId, 'doNotContact.flagged': true };
  if (campaignId) q.campaignId = campaignId;
  const ids = await Voter.find(q, { _id: 1 }).lean();
  return new Set(ids.map((v) => String(v._id)));
}
