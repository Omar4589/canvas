import { Household } from '../../models/Household.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { deriveSetupSteps } from './setupSteps.js';

// One round-trip of cheap grouped counts for a set of campaigns, turned into the
// per-campaign setup-progress + management state used by the campaigns list, the
// Overview rollup, and (via deriveSetupSteps) the dashboard hub. Single source of
// truth so every surface agrees.
//
// `campaigns`: array of lean docs with at least { _id, type, surveyTemplateId, name }.
// Returns Map<campaignIdStr, { setupComplete, stepsDone, stepsTotal, nextStepKey,
//   hasCanvassed, deletable, canEditType }>.
export async function campaignSummaries({ organizationId, campaigns }) {
  const ids = campaigns.map((c) => c._id);
  const out = new Map();
  if (!ids.length) return out;

  const group = { $group: { _id: '$campaignId', n: { $sum: 1 } } };
  const [households, owned, passes, publishedTurfs, assignments, activePasses, activity, responses] =
    await Promise.all([
      Household.aggregate([{ $match: { organizationId, campaignId: { $in: ids }, isActive: true } }, group]),
      Household.aggregate([{ $match: { organizationId, campaignId: { $in: ids }, isActive: true, effortId: { $ne: null } } }, group]),
      Pass.aggregate([{ $match: { campaignId: { $in: ids } } }, group]),
      Turf.aggregate([{ $match: { campaignId: { $in: ids }, status: 'published' } }, group]),
      TurfAssignment.aggregate([{ $match: { campaignId: { $in: ids } } }, group]),
      Pass.aggregate([{ $match: { campaignId: { $in: ids }, status: 'active' } }, group]),
      CanvassActivity.aggregate([{ $match: { campaignId: { $in: ids } } }, group]),
      SurveyResponse.aggregate([{ $match: { campaignId: { $in: ids } } }, group]),
    ]);

  const map = (agg) => new Map(agg.map((r) => [String(r._id), r.n]));
  const householdsBy = map(households);
  const ownedBy = map(owned);
  const passesBy = map(passes);
  const pubTurfBy = map(publishedTurfs);
  const assignBy = map(assignments);
  const activeBy = map(activePasses);
  const activityBy = map(activity);
  const responsesBy = map(responses);

  for (const campaign of campaigns) {
    const k = String(campaign._id);
    const hh = householdsBy.get(k) || 0;
    const ownedDoors = ownedBy.get(k) || 0;
    const hasCanvassed = (activityBy.get(k) || 0) > 0 || (responsesBy.get(k) || 0) > 0;
    const setup = deriveSetupSteps({
      campaign,
      counts: {
        households: hh,
        ownedDoors,
        intakeDoors: Math.max(0, hh - ownedDoors),
        passes: passesBy.get(k) || 0,
        publishedTurfs: pubTurfBy.get(k) || 0,
        assignments: assignBy.get(k) || 0,
        activePasses: activeBy.get(k) || 0,
      },
    });
    out.set(k, {
      setupComplete: setup.complete,
      stepsDone: setup.stepsDone,
      stepsTotal: setup.stepsTotal,
      nextStepKey: setup.nextStepKey,
      hasCanvassed,
      deletable: !hasCanvassed,
      canEditType: !hasCanvassed,
    });
  }
  return out;
}
