import { Organization } from '../../models/Organization.js';
import { Campaign } from '../../models/Campaign.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { CampaignManager } from '../../models/CampaignManager.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { ClientReport } from '../../models/ClientReport.js';
import { ClientReportMapPoint } from '../../models/ClientReportMapPoint.js';
import { Effort } from '../../models/Effort.js';
import { EffortMember } from '../../models/EffortMember.js';
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

// Every collection that carries organizationId. Voter is deleted LAST in this
// list's order-independent sweep but its personIds are collected FIRST — the
// cross-org Person hygiene below depends on knowing which canonical people this
// org's voters pointed at before the rows vanish. Exported so the integration
// test can seed a stub row in every one and prove the sweep is exhaustive.
export const ORG_SCOPED = [
  Campaign, CampaignAssignment, CampaignManager, CanvassActivity, ClientReport,
  ClientReportMapPoint, Effort, EffortMember, FlagReview, Household,
  HouseholdLocationChange, ImportJob, ImportProfile, Membership, Pass,
  ReportShareLink, SavedSearch, Subscription, SubscriptionEvent, SurveyResponse,
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

  const personIds = await Voter.distinct('personId', {
    organizationId: org._id,
    personId: { $ne: null },
  });

  // The raw uploaded spreadsheets, BEFORE the ImportJob rows that name them are swept away.
  //
  // These were never deleted. The cascade below destroyed 30 collections — the voter file, the
  // households, every knock — and left the ORIGINAL uploaded CSV/XLSX sitting in GridFS, complete,
  // forever. A customer asking us to delete their data got the copies deleted and the source kept.
  const jobIds = await ImportJob.find({ organizationId: org._id }).distinct('_id');
  for (const id of jobIds) await deleteRawImport(id);
  const counts = {};
  if (jobIds.length) counts.rawImportFiles = jobIds.length;

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
    await Person.deleteOne({ _id: pid });
    await PersonMergeCandidate.deleteMany({ $or: [{ personIdA: pid }, { personIdB: pid }] });
    await PersonEditProposal.deleteMany({ personId: pid });
    // PersonMergeLog holds a FULL pre-merge snapshot of both Person docs — identity PII. It goes
    // with the org too; keeping it would be retaining exactly what we were asked to delete.
    await PersonMergeLog.deleteMany({ $or: [{ survivorId: pid }, { victimId: pid }] });
    personsPurged += 1;
  }
  // Belt and braces: anything still carrying this org's id (a Person created outside the voter
  // link, say) goes as well.
  const strays = await Person.deleteMany({ organizationId: org._id });
  personsPurged += strays.deletedCount || 0;

  await Organization.deleteOne({ _id: org._id });

  return {
    organization: { id: String(org._id), name: org.name, slug: org.slug },
    counts,
    personsPurged,
  };
}
