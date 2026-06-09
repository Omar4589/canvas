import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { Effort } from '../../models/Effort.js';
import { EffortMember } from '../../models/EffortMember.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { TurfSnapshot } from '../../models/TurfSnapshot.js';
import { WalkList } from '../../models/WalkList.js';
import { VotedUpload } from '../../models/VotedUpload.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { VotedPendingId } from '../../models/VotedPendingId.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { ClientReport } from '../../models/ClientReport.js';
import { ClientReportMapPoint } from '../../models/ClientReportMapPoint.js';
import { ReportShareLink } from '../../models/ReportShareLink.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { ImportJob } from '../../models/ImportJob.js';
import { Campaign } from '../../models/Campaign.js';

// Hard-delete a campaign and everything it owns. Mirrors the effort-delete cascade
// ([efforts.js]) but campaign-wide. ONLY call after the caller has verified the
// campaign has no canvassing history (no CanvassActivity / SurveyResponse) — this
// is the irreversible "delete a never-walked campaign" path; otherwise archive.
//
// Voters are org-scoped (no campaignId) but housed via Household.householdId, so we
// remove the voters housed in THIS campaign's households. Safe here because a
// deletable campaign has no responses referencing them; the broader cross-campaign
// shared-voter model is a separate effort.
//
// Sequential (no transaction), matching the rest of the app. Returns delete counts.
export async function deleteCampaignCascade(campaign) {
  const campaignId = campaign._id;

  const householdIds = await Household.find({ campaignId }).distinct('_id');
  const voters = await Voter.deleteMany({ householdId: { $in: householdIds } });

  // Every campaignId-scoped collection (audited via grep over models/).
  const CAMPAIGN_SCOPED = [
    Household, Effort, EffortMember, Pass, Turf, TurfAssignment, TurfSnapshot,
    WalkList, VotedUpload, VotedVoter, VotedPendingId, CampaignAssignment,
    ClientReport, ClientReportMapPoint, ReportShareLink, CanvassActivity,
    SurveyResponse, ImportJob,
  ];
  const counts = { voters: voters.deletedCount || 0 };
  for (const Model of CAMPAIGN_SCOPED) {
    const res = await Model.deleteMany({ campaignId });
    counts[Model.modelName] = res.deletedCount || 0;
  }
  // NOTE: ImportJob raw files live in GridFS and are not removed here — a minor
  // storage orphan, not a correctness issue.

  await Campaign.deleteOne({ _id: campaignId });
  return counts;
}
