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
//   door-unit rows (canvass activity)                       → the knock is a record of work
//     performed and billed, so the ROW stays and every voter-identity column goes blank —
//     with NO "withheld" marker, because a marker would itself flag the household as
//     containing an opt-out (leaking the very fact the rule protects).
// Both paths count into ExportJob.excludedDncCount so the honest undercount vs dashboard
// figures is explainable, never mysterious.

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
