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
import { DncPendingId } from '../../models/DncPendingId.js';
import { VoterNote } from '../../models/VoterNote.js';
import { captureCampaignBeforeDelete } from '../platform/platformStats.js';

const CHUNK = 5000;

// Hard-delete a campaign and everything it owns. Mirrors the effort-delete cascade
// ([efforts.js]) but campaign-wide. ONLY call after the caller has verified the
// campaign has no canvassing history (no CanvassActivity / SurveyResponse) — this
// is the irreversible "delete a never-walked campaign" path; otherwise archive.
//
// Voter rows are per-campaign, so this deletes exactly this campaign's rows — a person
// shared with a sibling campaign lives on there, untouched. Two org-level facts need
// care before the rows go: a flagged person losing their LAST row parks as a
// DncPendingId (the "never contact me again" survives the delete), and org-level
// VoterNotes re-point to a surviving sibling row (or delete with their last row).
//
// Sequential (no transaction), matching the rest of the app. Returns delete counts.
export async function deleteCampaignCascade(campaign) {
  const campaignId = campaign._id;
  const orgId = campaign.organizationId;
  const counts = {};

  // Bank this campaign's lifetime contribution into the platform marketing counters BEFORE its rows
  // are destroyed (no-op for internal orgs). A deletable campaign is never-walked, so this is mostly
  // its campaign count and never-walked voters — but capturing keeps the numbers whole either way.
  await captureCampaignBeforeDelete(campaign);

  // DNC stickiness: for each flagged person whose ONLY row(s) live in this campaign, park
  // the request as a DncPendingId carrying the flag's original attribution (uploadId, or
  // null + reason for admin-set) — a future import graduates it back onto the real row
  // (reapplyDncLists). A person with a surviving sibling row needs nothing: the flag
  // lives on there.
  const flaggedRows = await Voter.find(
    { campaignId, 'doNotContact.flagged': true },
    { stateVoterId: 1, doNotContact: 1 }
  ).lean();
  let dncParked = 0;
  if (flaggedRows.length) {
    const flaggedSvids = [...new Set(flaggedRows.map((v) => v.stateVoterId))];
    const surviving = new Set();
    for (let i = 0; i < flaggedSvids.length; i += CHUNK) {
      const found = await Voter.find({
        organizationId: orgId,
        stateVoterId: { $in: flaggedSvids.slice(i, i + CHUNK) },
        campaignId: { $ne: campaignId },
      }).distinct('stateVoterId');
      for (const s of found) surviving.add(s);
    }
    const dncBySvid = new Map();
    for (const v of flaggedRows) if (!dncBySvid.has(v.stateVoterId)) dncBySvid.set(v.stateVoterId, v.doNotContact);
    for (const [svid, dnc] of dncBySvid) {
      if (surviving.has(svid)) continue;
      await DncPendingId.updateOne(
        { organizationId: orgId, stateVoterId: svid },
        { $setOnInsert: { uploadId: dnc?.uploadId || null, reason: dnc?.reason || null } },
        { upsert: true }
      );
      dncParked += 1;
    }
  }
  counts.dncParked = dncParked;

  // Note hygiene: VoterNotes are org-level but keyed by voterId. Re-point a deleted row's
  // notes to a surviving sibling (the person keeps their history), and delete notes whose
  // person leaves the org entirely — before this, deleting a campaign orphaned them.
  const deletedVoterIds = await Voter.find({ campaignId }).distinct('_id');
  const notedVoterIds = [];
  for (let i = 0; i < deletedVoterIds.length; i += CHUNK) {
    const ids = await VoterNote.find({
      organizationId: orgId,
      voterId: { $in: deletedVoterIds.slice(i, i + CHUNK) },
    }).distinct('voterId');
    notedVoterIds.push(...ids);
  }
  if (notedVoterIds.length) {
    const noted = await Voter.find({ _id: { $in: notedVoterIds } }, { stateVoterId: 1 }).lean();
    const notedSvids = [...new Set(noted.map((v) => v.stateVoterId))];
    const siblingBySvid = new Map();
    for (let i = 0; i < notedSvids.length; i += CHUNK) {
      const sibs = await Voter.find(
        { organizationId: orgId, stateVoterId: { $in: notedSvids.slice(i, i + CHUNK) }, campaignId: { $ne: campaignId } },
        { stateVoterId: 1 }
      ).lean();
      for (const s of sibs) if (!siblingBySvid.has(s.stateVoterId)) siblingBySvid.set(s.stateVoterId, s._id);
    }
    for (const v of noted) {
      const sib = siblingBySvid.get(v.stateVoterId);
      if (sib) await VoterNote.updateMany({ organizationId: orgId, voterId: v._id }, { $set: { voterId: sib } });
      else await VoterNote.deleteMany({ organizationId: orgId, voterId: v._id });
    }
  }

  const voters = await Voter.deleteMany({ campaignId });
  counts.voters = voters.deletedCount || 0;

  // Every campaignId-scoped collection (audited via grep over models/).
  const CAMPAIGN_SCOPED = [
    Household, Effort, EffortMember, Pass, Turf, TurfAssignment, TurfSnapshot,
    SavedSearch, VotedUpload, VotedVoter, VotedPendingId, CampaignAssignment,
    CampaignManager, ClientReport, ClientReportMapPoint, ReportShareLink,
    CanvassActivity, SurveyResponse, ImportJob, HouseholdLocationChange,
  ];

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
