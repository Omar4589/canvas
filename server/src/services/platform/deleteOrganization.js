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
// org's voters pointed at before the rows vanish.
const ORG_SCOPED = [
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
// What survives, deliberately:
//   - User accounts (decision, Jul 2026): global identities are kept even when
//     this was their only org — only their Membership rows are removed. A user
//     who also belongs to another org keeps that access untouched.
//   - Cross-org Persons that still have voters in OTHER orgs. If the deleted
//     org OWNED such a person's identity, ownership is released to null
//     (= super-admin-only canonical edits, per docs/PERSONS.md) rather than
//     stranding a dead owner reference.
// Persons left with no linked voter anywhere are purged along with their merge
// candidates/logs and edit proposals (the deleteTestCampaigns pattern).
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

  const counts = {};
  for (const M of ORG_SCOPED) {
    const r = await M.deleteMany({ organizationId: org._id });
    if (r.deletedCount) counts[M.modelName] = r.deletedCount;
  }
  // Person edit proposals are keyed by orgId (the proposing org), not organizationId.
  const proposals = await PersonEditProposal.deleteMany({ orgId: org._id });
  if (proposals.deletedCount) counts.PersonEditProposal = proposals.deletedCount;

  // Cross-org Person hygiene.
  let personsPurged = 0;
  for (const pid of personIds) {
    if ((await Voter.countDocuments({ personId: pid })) > 0) continue; // linked elsewhere — keep
    await Person.deleteOne({ _id: pid });
    await PersonMergeCandidate.deleteMany({ $or: [{ personIdA: pid }, { personIdB: pid }] });
    await PersonEditProposal.deleteMany({ personId: pid });
    await PersonMergeLog.deleteMany({ $or: [{ survivorId: pid }, { victimId: pid }] });
    personsPurged += 1;
  }
  // Surviving persons this org owned: release ownership instead of stranding it.
  const released = await Person.updateMany(
    { identityOwnerOrgId: org._id },
    { $set: { identityOwnerOrgId: null } }
  );

  await Organization.deleteOne({ _id: org._id });

  return {
    organization: { id: String(org._id), name: org.name, slug: org.slug },
    counts,
    personsPurged,
    ownershipsReleased: released.modifiedCount,
  };
}
