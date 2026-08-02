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

// Every collection that carries organizationId. Voter is deleted LAST in this
// list's order-independent sweep but its personIds are collected FIRST — the
// cross-org Person hygiene below depends on knowing which canonical people this
// org's voters pointed at before the rows vanish. Exported so the integration
// test can seed a stub row in every one and prove the sweep is exhaustive.
export const ORG_SCOPED = [
  Campaign, CampaignAssignment, CampaignManager, CanvassActivity, ClientReport,
  ClientReportMapPoint, CoordinatorChange, DncPendingId, DncUpload, Effort, EffortMember,
  ExportJob, FlagReview, Household, HouseholdLocationChange, ImportJob, ImportProfile, Membership, Pass,
  ReportShareLink, SavedSearch, Statement, Subscription, SubscriptionEvent, SurveyResponse,
  SurveyTemplate, Tag, Turf, TurfAssignment, TurfSnapshot, VotedPendingId,
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
export async function deleteOrganization(orgId) {
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

  // The org's Persons, from BOTH the Voter links AND Person.organizationId directly. The direct read is
  // what makes a RETRY safe: if a prior partial run already deleted this org's Voters, the Voter-derived
  // set would come back empty and the identity records (and their PII-bearing merge logs) would be
  // stranded. Persons carry their own organizationId now, so we find them either way.
  const [voterPersonIds, orgPersons] = await Promise.all([
    Voter.distinct('personId', { organizationId: org._id, personId: { $ne: null } }),
    Person.find({ organizationId: org._id }, '_id').lean(),
  ]);
  const personIdSet = new Map();
  for (const pid of voterPersonIds) personIdSet.set(String(pid), pid);
  for (const p of orgPersons) personIdSet.set(String(p._id), p._id);
  const personIds = [...personIdSet.values()];

  // The raw uploaded spreadsheets, BEFORE the ImportJob rows that name them are swept away.
  //
  // These were never deleted. The cascade below destroyed 30 collections — the voter file, the
  // households, every knock — and left the ORIGINAL uploaded CSV/XLSX sitting in GridFS, complete,
  // forever. A customer asking us to delete their data got the copies deleted and the source kept.
  const jobIds = await ImportJob.find({ organizationId: org._id }).distinct('_id');
  for (const id of jobIds) await deleteRawImport(id);
  const counts = {};
  if (jobIds.length) counts.rawImportFiles = jobIds.length;

  // Export Center artifacts — the same lesson: ExportJob rows are swept by ORG_SCOPED below,
  // but the GridFS files they point at would survive without an explicit purge, and "we aim
  // to permanently delete" (privacy.html, DPA §9) covers a downloaded-file copy at rest too.
  // Keyed by bucket metadata, not the job list, so a stranded artifact is caught even if its
  // ExportJob doc is already gone.
  const exportFiles = await deleteArtifactsForScope({ organizationId: org._id });
  if (exportFiles) counts.exportArtifactFiles = exportFiles;

  // DeletedUserRecord is NOT in ORG_SCOPED, and adding it there would not have worked: it stores
  // `organizationIds` as an ARRAY (a user can belong to several orgs), so `deleteMany({
  // organizationId })` matches nothing. The result was that a deleted user's name, email and phone
  // outlived the deletion of the very organization they belonged to. Pull the org out of the array,
  // and drop the record entirely once no org is left holding it.
  const dur = await DeletedUserRecord.updateMany(
    { organizationIds: org._id },
    { $pull: { organizationIds: org._id } }
  );
  const durGone = await DeletedUserRecord.deleteMany({ organizationIds: { $size: 0 } });
  if (dur.modifiedCount) counts.DeletedUserRecordDetached = dur.modifiedCount;
  if (durGone.deletedCount) counts.DeletedUserRecord = durGone.deletedCount;

  for (const M of ORG_SCOPED) {
    const r = await M.deleteMany({ organizationId: org._id });
    if (r.deletedCount) counts[M.modelName] = r.deletedCount;
  }
  // Person edit proposals are keyed by orgId (the proposing org), not organizationId.
  const proposals = await PersonEditProposal.deleteMany({ orgId: org._id });
  if (proposals.deletedCount) counts.PersonEditProposal = proposals.deletedCount;

  // Persons belong to this org now, so they die with it — every one, unconditionally.
  //
  // This used to be "cross-org Person hygiene": a Person was global, shared by every customer that
  // had imported the same human, so deleting an org could only remove the Persons nobody else was
  // still linked to, and it had to RELEASE ownership of the rest rather than strand them. That was
  // the right code for a shared identity graph — and the shared identity graph is exactly what we
  // removed (models/Person.js). A customer asking us to delete their data should not leave a record
  // of the humans in their voter file sitting in our database because someone else also has them.
  let personsPurged = 0;
  for (const pid of personIds) {
    // Delete the PII-bearing satellites BEFORE the Person itself. PersonMergeLog holds a FULL pre-merge
    // snapshot of both Person docs (name, DOB, phone); PersonMergeCandidate/PersonEditProposal carry
    // identity too. If this loop dies mid-iteration, deleting the Person LAST means a retry still finds
    // it (Person.organizationId) and re-runs the cleanup idempotently — the Person is never removed
    // while its identity snapshots survive. Keeping any of these would retain exactly what a customer
    // asked us to delete.
    await PersonMergeCandidate.deleteMany({ $or: [{ personIdA: pid }, { personIdB: pid }] });
    await PersonEditProposal.deleteMany({ personId: pid });
    await PersonMergeLog.deleteMany({ $or: [{ survivorId: pid }, { victimId: pid }] });
    await Person.deleteOne({ _id: pid });
    personsPurged += 1;
  }
  // Belt and braces: any Person still carrying this org's id that the loop above didn't cover (e.g. one
  // created by a concurrent import racing this delete, after the line-~80 snapshot). Clean its identity
  // satellites too, same order as the loop, so a stray can't strand a merge-log PII snapshot either.
  const strays = await Person.find({ organizationId: org._id }, '_id').lean();
  for (const s of strays) {
    await PersonMergeCandidate.deleteMany({ $or: [{ personIdA: s._id }, { personIdB: s._id }] });
    await PersonEditProposal.deleteMany({ personId: s._id });
    await PersonMergeLog.deleteMany({ $or: [{ survivorId: s._id }, { victimId: s._id }] });
    await Person.deleteOne({ _id: s._id });
    personsPurged += 1;
  }

  await Organization.deleteOne({ _id: org._id });

  return {
    organization: { id: String(org._id), name: org.name, slug: org.slug },
    counts,
    personsPurged,
  };
}
