import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { resolveStatus } from '../../utils/statusPrecedence.js';

// Shared door/voter status recomputation. Extracted from the mobile canvass
// write path so other callers (e.g. clearing a pass's knocks during a re-cut)
// recompute the exact same way.

// household.status = the "latest across all passes" convenience value, resolved
// with the sticky-completion precedence rule. Mutates the doc; caller saves.
export async function recomputeHouseholdStatus(household, campaignType) {
  const acts = await CanvassActivity.find(
    { householdId: household._id, actionType: { $ne: 'note_added' } },
    { actionType: 1, timestamp: 1 }
  ).lean();
  household.status = resolveStatus(campaignType, acts);
}

// "Ever surveyed" — recomputed from existence so deleting surveys corrects it.
export async function recomputeSurveyStatus(voterIds) {
  for (const vid of voterIds) {
    const exists = await SurveyResponse.exists({ voterId: vid });
    await Voter.updateOne({ _id: vid }, { $set: { surveyStatus: exists ? 'surveyed' : 'not_surveyed' } });
  }
}

// Bulk variant: load each household by id, recompute, and persist. Used after a
// knock wipe, where the affected set is just the households that had activity.
export async function recomputeHouseholdStatusesByIds(householdIds, campaignType) {
  for (const id of householdIds) {
    const hh = await Household.findById(id);
    if (!hh) continue;
    await recomputeHouseholdStatus(hh, campaignType);
    await hh.save();
  }
}
