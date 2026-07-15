import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { Effort } from '../../models/Effort.js';
import { EffortMember } from '../../models/EffortMember.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { TurfSnapshot } from '../../models/TurfSnapshot.js';
import { SavedSearch } from '../../models/SavedSearch.js';
import { VotedUpload } from '../../models/VotedUpload.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { VotedPendingId } from '../../models/VotedPendingId.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { CampaignManager } from '../../models/CampaignManager.js';
import { ClientReport } from '../../models/ClientReport.js';
import { ClientReportMapPoint } from '../../models/ClientReportMapPoint.js';
import { ReportShareLink } from '../../models/ReportShareLink.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { ImportJob } from '../../models/ImportJob.js';
import { deleteRawImport } from '../import/rawImportStore.js';
import { HouseholdLocationChange } from '../../models/HouseholdLocationChange.js';
import { Campaign } from '../../models/Campaign.js';
import { captureCampaignBeforeDelete } from '../platform/platformStats.js';

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

  // Bank this campaign's lifetime contribution into the platform marketing counters BEFORE its rows
  // are destroyed (no-op for internal orgs). A deletable campaign is never-walked, so this is mostly
  // its campaign count and never-walked voters — but capturing keeps the numbers whole either way.
  await captureCampaignBeforeDelete(campaign);

  const householdIds = await Household.find({ campaignId }).distinct('_id');
  const voters = await Voter.deleteMany({ householdId: { $in: householdIds } });

  // Every campaignId-scoped collection (audited via grep over models/).
  const CAMPAIGN_SCOPED = [
    Household, Effort, EffortMember, Pass, Turf, TurfAssignment, TurfSnapshot,
    SavedSearch, VotedUpload, VotedVoter, VotedPendingId, CampaignAssignment,
    CampaignManager, ClientReport, ClientReportMapPoint, ReportShareLink,
    CanvassActivity, SurveyResponse, ImportJob, HouseholdLocationChange,
  ];
  const counts = { voters: voters.deletedCount || 0 };

  // The raw uploaded spreadsheets, FIRST — while we can still find the ImportJob rows that name
  // them. This was called out here as "a minor storage orphan, not a correctness issue". It is not
  // minor and it is not just storage: the orphan is the customer's original voter file, complete,
  // with every name, address, date of birth and phone number in it. Deleting the campaign wiped the
  // Voter rows and left the source spreadsheet sitting in GridFS forever — so "delete my data"
  // deleted the copy and kept the original.
  const jobIds = await ImportJob.find({ campaignId }).distinct('_id');
  for (const id of jobIds) await deleteRawImport(id);
  counts.rawImportFiles = jobIds.length;

  for (const Model of CAMPAIGN_SCOPED) {
    const res = await Model.deleteMany({ campaignId });
    counts[Model.modelName] = res.deletedCount || 0;
  }

  await Campaign.deleteOne({ _id: campaignId });
  return counts;
}
