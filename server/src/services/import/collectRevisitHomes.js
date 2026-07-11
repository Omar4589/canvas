import { Voter } from '../../models/Voter.js';
import { Household } from '../../models/Household.js';
import { SavedSearch } from '../../models/SavedSearch.js';

// A door reads as "worked" once its sticky global status is the campaign's completion —
// 'surveyed' (survey campaigns) or 'lit_dropped' (lit-drop). These persist even after the
// completing round is archived, so a home worked in an old round still counts. See
// utils/statusPrecedence.js.
const WORKED_STATUSES = ['surveyed', 'lit_dropped'];

// When a voter import adds NEW target voters into homes that were ALREADY worked this
// campaign, those homes stay owned/booked and their door stays "done" — so the new voter
// is never walked. This collects exactly those homes into a frozen SavedSearch ("walk
// list") the admin can cut a fresh, BILLABLE revisit round from (a new pass, with the
// first knock preserved in its own pass). Brand-new homes are excluded — they land in
// Intake and are claimed the normal way; not-yet-worked existing homes are excluded too
// (their new voter is surveyed on the normal visit; a revisit list would double-assign).
//
// Opt-in (importJob.revisitNewVoters) and idempotent (skips once revisitSavedSearchId is
// set, so a BullMQ retry never creates a duplicate). Returns
// { savedSearchId, householdCount } when a list is created, else null. The caller folds
// those onto the ImportJob; a throw here must be caught by the caller (non-fatal — the
// import is the source of truth, the list is a convenience).
export async function collectRevisitHomes(importJob, campaign, counts = {}) {
  if (!importJob?.revisitNewVoters || importJob.revisitSavedSearchId) return null;

  // Idempotent by import: if a prior attempt already created this import's list, return
  // it instead of making a second one. `revisitSavedSearchId` is persisted only in the
  // import's FINAL update, so a crash between the create below and that write would
  // otherwise let a BullMQ retry duplicate the list — this importJobId lookup closes
  // that window regardless of when the crash happened.
  const existing = await SavedSearch.findOne(
    { campaignId: campaign._id, source: 'import', 'sourceMeta.importJobId': importJob._id },
    { _id: 1, householdCount: 1 }
  ).lean();
  if (existing) return { savedSearchId: existing._id, householdCount: existing.householdCount || 0 };

  // Retry-safe: this run's inserted ids, else the ones persisted on a prior attempt.
  const insVoterIds =
    counts.insertedVoterIds?.length ? counts.insertedVoterIds : importJob.insertedVoterIds || [];
  if (!insVoterIds.length) return null;

  // New homes (this run + any persisted) are Intake already — exclude them.
  const newHomeSet = new Set(
    [...(counts.insertedHouseholdIds || []), ...(importJob.insertedHouseholdIds || [])].map(String)
  );

  // Each newly-inserted voter's (post-apply) household.
  const voterDocs = await Voter.find({ _id: { $in: insVoterIds } }, { householdId: 1 }).lean();
  const candidateHomeIds = [
    ...new Set(
      voterDocs
        .map((v) => v.householdId)
        .filter((id) => id && !newHomeSet.has(String(id)))
        .map(String)
    ),
  ];
  if (!candidateHomeIds.length) return null;

  // Narrow to homes already worked (a completion status) — the ones needing a revisit.
  const workedHomes = await Household.find(
    { campaignId: campaign._id, _id: { $in: candidateHomeIds }, status: { $in: WORKED_STATUSES } },
    { _id: 1 }
  ).lean();
  if (!workedHomes.length) return null;

  const workedHomeSet = new Set(workedHomes.map((h) => String(h._id)));
  const householdIds = workedHomes.map((h) => h._id);
  const voterIds = voterDocs
    .filter((v) => v.householdId && workedHomeSet.has(String(v.householdId)))
    .map((v) => v._id);

  const savedSearch = await SavedSearch.create({
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    name: `New voters — ${importJob.filename || 'import'}`,
    filter: {},
    householdIds, // load-bearing: drives claim / cut / re-carve
    voterIds, // the new targets in those homes (export/count)
    householdCount: householdIds.length,
    voterCount: voterIds.length,
    source: 'import',
    sourceMeta: {
      fileName: importJob.filename || null,
      matchedVoters: voterIds.length,
      importJobId: importJob._id,
    },
    createdBy: importJob.uploadedBy || null,
  });

  return { savedSearchId: savedSearch._id, householdCount: householdIds.length };
}
