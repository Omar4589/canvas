import { Organization } from '../../models/Organization.js';
import { Campaign } from '../../models/Campaign.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { CampaignManager } from '../../models/CampaignManager.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { ClientReport } from '../../models/ClientReport.js';
import { ClientReportMapPoint } from '../../models/ClientReportMapPoint.js';
import { CoordinatorChange } from '../../models/CoordinatorChange.js';
import { DncPendingId } from '../../models/DncPendingId.js';
import { DncUpload } from '../../models/DncUpload.js';
import { DoNotKnockAddress } from '../../models/DoNotKnockAddress.js';
import { Effort } from '../../models/Effort.js';
import { EffortMember } from '../../models/EffortMember.js';
import { ExportJob } from '../../models/ExportJob.js';
import { deleteArtifactsForScope } from '../export/exportArtifactStore.js';
import { FlagReview } from '../../models/FlagReview.js';
import { Household } from '../../models/Household.js';
import { HouseholdLocationChange } from '../../models/HouseholdLocationChange.js';
import { ImportJob } from '../../models/ImportJob.js';
import { DeletedUserRecord } from '../../models/DeletedUserRecord.js';
import { deleteRawImport } from '../import/rawImportStore.js';
import { ImportProfile } from '../../models/ImportProfile.js';
import { Membership } from '../../models/Membership.js';
import { Pass } from '../../models/Pass.js';
import { Person } from '../../models/Person.js';
import { PersonEditProposal } from '../../models/PersonEditProposal.js';
import { PersonMergeCandidate } from '../../models/PersonMergeCandidate.js';
import { PersonMergeLog } from '../../models/PersonMergeLog.js';
import { ReportShareLink } from '../../models/ReportShareLink.js';
import { SavedSearch } from '../../models/SavedSearch.js';
import { Statement } from '../../models/Statement.js';
import { Subscription } from '../../models/Subscription.js';
import { SubscriptionEvent } from '../../models/SubscriptionEvent.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { Tag } from '../../models/Tag.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { TurfSnapshot } from '../../models/TurfSnapshot.js';
import { VotedPendingId } from '../../models/VotedPendingId.js';
import { VotedUpload } from '../../models/VotedUpload.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { Voter } from '../../models/Voter.js';
import { VoterNote } from '../../models/VoterNote.js';
import { captureOrgBeforeDelete } from './platformStats.js';

// Chunk size for the Person purge below. Env-readable ONLY so the integration test can set it to
// 2 and prove multi-chunk correctness without seeding 5001 Person docs.
const CHUNK = Number(process.env.ORG_DELETE_CHUNK) || 5000;

// Every collection that carries organizationId. The sweep is order-independent, but it must run
// AFTER the Person pass that reads Voter.personId (pass 1 below) — that pass needs the voter rows
// to still exist to learn which canonical people this org pointed at. Exported so the integration
// test can seed a stub row in every one and prove the sweep is exhaustive.
export const ORG_SCOPED = [
  Campaign, CampaignAssignment, CampaignManager, CanvassActivity, ClientReport,
  ClientReportMapPoint, CoordinatorChange, DncPendingId, DncUpload, DoNotKnockAddress,
  Effort, EffortMember,
  ExportJob, FlagReview, Household, HouseholdLocationChange, ImportJob, ImportProfile, Membership, Pass,
  ReportShareLink, SavedSearch, Statement, Subscription, SubscriptionEvent, SurveyResponse,
  SurveyResponseArchive, SurveyTemplate, Tag, Turf, TurfAssignment, TurfSnapshot, VotedPendingId,
  VotedUpload, VotedVoter, Voter, VoterNote,
];

// HARD-delete an organization and everything scoped to it. Irreversible — the
// route in front of this demands the org's slug typed back as confirmation.
//
// This is what backs "a customer may request deletion of the information it
// controls", so anything that survives it had better be something we can defend.
//
// What survives, deliberately:
//   - User accounts (decision, Jul 2026): global identities are kept even when
//     this was their only org — only their Membership rows are removed. A user
//     who also belongs to another org keeps that access untouched.
//
// Persons now belong to this org (they used to be global, shared across
// customers) and are deleted with it — see the Person block below.
//
// Called from FOUR places, all of them now through the org-delete queue
// (services/platform/deleteOrgProcessor.js): the break-glass route and the three retention
// triggers. `heartbeat` (optional, fire-and-forget) is how that job stamps liveness between
// stages; the direct callers in the test suite pass nothing.
//
// KEEP THE SYNCHRONOUS ENTRY POINT. `deleteOrganization(idOrDoc)` with no options is contract:
// statement.int.test.js and platformStats.int.test.js call it directly, and one of them passes a
// Document rather than an id (Organization.findById casts it). Do not make the options required.
export async function deleteOrganization(orgId, { heartbeat = () => {} } = {}) {
  const org = await Organization.findById(orgId).lean();
  if (!org) {
    const err = new Error('Organization not found');
    err.status = 404;
    throw err;
  }

  // BEFORE destroying anything: bank this org's lifetime contribution into the platform marketing
  // counters, so "N doors knocked" survives the customer being deleted. No-op for internal orgs. Safe
  // on a retry — captureOrgBeforeDelete atomically claims the org (platformStatsCaptured) the first
  // time and returns null on any re-entry, so a retried delete never double-counts. See
  // services/platform/platformStats.js.
  await captureOrgBeforeDelete(org._id);
  heartbeat();

  // The raw uploaded spreadsheets, BEFORE the ImportJob rows that name them are swept away.
  //
  // These were never deleted. The cascade below destroyed 30 collections — the voter file, the
  // households, every knock — and left the ORIGINAL uploaded CSV/XLSX sitting in GridFS, complete,
  // forever. A customer asking us to delete their data got the copies deleted and the source kept.
  const jobIds = await ImportJob.find({ organizationId: org._id }).distinct('_id');
  for (const id of jobIds) {
    await deleteRawImport(id);
    heartbeat();
  }
  const counts = {};
  if (jobIds.length) counts.rawImportFiles = jobIds.length;

  // Export Center artifacts — the same lesson: ExportJob rows are swept by ORG_SCOPED below,
  // but the GridFS files they point at would survive without an explicit purge, and "we aim
  // to permanently delete" (privacy.html, DPA §9) covers a downloaded-file copy at rest too.
  // Keyed by bucket metadata, not the job list, so a stranded artifact is caught even if its
  // ExportJob doc is already gone.
  const exportFiles = await deleteArtifactsForScope({ organizationId: org._id, onProgress: heartbeat });
  if (exportFiles) counts.exportArtifactFiles = exportFiles;

  // DeletedUserRecord is NOT in ORG_SCOPED, and adding it there would not have worked: it stores
  // `organizationIds` as an ARRAY (a user can belong to several orgs), so `deleteMany({
  // organizationId })` matches nothing. The result was that a deleted user's name, email and phone
  // outlived the deletion of the very organization they belonged to. Pull the org out of the array,
  // and drop the record entirely once no org is left holding it.
  //
  // SCOPED to the records this delete actually touched. An unscoped
  // `deleteMany({ organizationIds: { $size: 0 } })` swept EVERY zero-org record in the database,
  // so deleting org A destroyed the retention tombstone of an unrelated user who happened to have
  // no memberships (a self-deleted user who belonged to no org is created that way) — and that
  // tombstone is what backs the published 180-day identity-retention window.
  const durIds = await DeletedUserRecord.find({ organizationIds: org._id }, { _id: 1 }).distinct('_id');
  const dur = await DeletedUserRecord.updateMany(
    { organizationIds: org._id },
    { $pull: { organizationIds: org._id } }
  );
  const durGone = await DeletedUserRecord.deleteMany({
    _id: { $in: durIds },
    organizationIds: { $size: 0 },
  });
  if (dur.modifiedCount) counts.DeletedUserRecordDetached = dur.modifiedCount;
  if (durGone.deletedCount) counts.DeletedUserRecord = durGone.deletedCount;

  // Persons belong to this org now, so they die with it — every one, unconditionally.
  //
  // This used to be "cross-org Person hygiene": a Person was global, shared by every customer that
  // had imported the same human, so deleting an org could only remove the Persons nobody else was
  // still linked to, and it had to RELEASE ownership of the rest rather than strand them. That was
  // the right code for a shared identity graph — and the shared identity graph is exactly what we
  // removed (models/Person.js). A customer asking us to delete their data should not leave a record
  // of the humans in their voter file sitting in our database because someone else also has them.
  // CHUNKED, not per-person. This loop used to run FOUR sequential queries for every single Person
  // — ~2.4 million round trips for a 600k-person org, which is hours, and it was preceded by a
  // `Voter.distinct('personId')` that returns one BSON document capped at 16MB (so a large enough
  // org became undeletable outright). Both are now cursor-fed chunks: 4 queries per 5000 people.
  let personsPurged = 0;
  const purgePersonChunk = async (ids) => {
    if (!ids.length) return;
    // Delete the PII-bearing satellites BEFORE the Person itself. PersonMergeLog holds a FULL pre-merge
    // snapshot of both Person docs (name, DOB, phone); PersonMergeCandidate/PersonEditProposal carry
    // identity too. If this dies mid-chunk, deleting the Person LAST means a retry still finds it
    // (Person.organizationId, pass 2) and re-runs the cleanup idempotently — the Person is never
    // removed while its identity snapshots survive. Keeping any of these would retain exactly what a
    // customer asked us to delete.
    await PersonMergeCandidate.deleteMany({ $or: [{ personIdA: { $in: ids } }, { personIdB: { $in: ids } }] });
    await PersonEditProposal.deleteMany({ personId: { $in: ids } });
    await PersonMergeLog.deleteMany({ $or: [{ survivorId: { $in: ids } }, { victimId: { $in: ids } }] });
    const r = await Person.deleteMany({ _id: { $in: ids } });
    personsPurged += r.deletedCount || 0;
    heartbeat();
  };
  const drainCursor = async (cursor, pick) => {
    let batch = [];
    for await (const doc of cursor) {
      batch.push(pick(doc));
      if (batch.length >= CHUNK) {
        await purgePersonChunk(batch);
        batch = [];
      }
    }
    await purgePersonChunk(batch);
  };

  // PASS 1 — Persons this org's voters point at. MUST run before the ORG_SCOPED sweep below
  // destroys Voter. $group over the {organizationId,...} index; no 16MB document cap.
  await drainCursor(
    Voter.aggregate([
      { $match: { organizationId: org._id, personId: { $ne: null } } },
      { $group: { _id: '$personId' } },
    ])
      .allowDiskUse(true)
      .cursor({ batchSize: CHUNK }),
    (d) => d._id
  );

  for (const M of ORG_SCOPED) {
    const r = await M.deleteMany({ organizationId: org._id });
    if (r.deletedCount) counts[M.modelName] = r.deletedCount;
    heartbeat();
  }
  // Person edit proposals are keyed by orgId (the proposing org), not organizationId.
  const proposals = await PersonEditProposal.deleteMany({ orgId: org._id });
  if (proposals.deletedCount) counts.PersonEditProposal = proposals.deletedCount;

  // PASS 2 — Persons carrying this org's id directly, LAST. This is what makes a RETRY safe: if a
  // prior partial run already deleted the Voters, pass 1 comes back empty and these rows (with
  // their PII-bearing merge logs) would otherwise be stranded. Running it after the sweep also
  // catches a Person created by an import racing this delete. A Person already removed by pass 1
  // simply isn't matched here, so personsPurged counts each human exactly once with no dedup set.
  await drainCursor(
    Person.find({ organizationId: org._id }, { _id: 1 }).lean().cursor({ batchSize: CHUNK }),
    (d) => d._id
  );

  await Organization.deleteOne({ _id: org._id });

  return {
    organization: { id: String(org._id), name: org.name, slug: org.slug },
    counts,
    personsPurged,
  };
}
