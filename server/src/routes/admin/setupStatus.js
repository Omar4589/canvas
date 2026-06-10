import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { Household } from '../../models/Household.js';
import { Effort } from '../../models/Effort.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { Membership } from '../../models/Membership.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { activePassIds } from '../../services/passes/activePasses.js';
import { deriveSetupSteps } from '../../services/reports/setupSteps.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireOrgRole('admin'));

function activeOrgId(req) {
  return req.activeOrg?._id;
}

async function loadCampaign(req, res, next) {
  try {
    const orgId = activeOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Active organization required' });
    if (!mongoose.isValidObjectId(req.params.campaignId)) {
      return res.status(400).json({ error: 'Invalid campaignId' });
    }
    const campaign = await Campaign.findOne({ _id: req.params.campaignId, organizationId: orgId });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    req.campaign = campaign;
    next();
  } catch (err) {
    next(err);
  }
}
router.use(loadCampaign);

// Per-campaign cold-start readiness: the 8-step setup chain, derived from cheap
// counts over existing data. Every count reuses a query shape already used by the
// efforts / passes / turfs routes; the only new logic is deriveSetupSteps (shared
// with the campaign-rollup so list cards and this detail view agree).
router.get('/', async (req, res, next) => {
  try {
    const campaignId = req.campaign._id;
    const organizationId = req.campaign.organizationId;

    const [households, ownedDoors, intakeDoors, passes, publishedTurfs, assignments, orgCanvassers, activeIds, activity, responses, effortDocs, activeEffortIdsRaw] =
      await Promise.all([
        Household.countDocuments({ campaignId, isActive: true }),
        Household.countDocuments({ campaignId, isActive: true, effortId: { $ne: null } }),
        Household.countDocuments({ campaignId, isActive: true, effortId: null }),
        Pass.countDocuments({ campaignId }),
        Turf.countDocuments({ campaignId, status: 'published' }),
        TurfAssignment.countDocuments({ campaignId }),
        Membership.countDocuments({ organizationId, role: 'canvasser', isActive: true }),
        activePassIds(campaignId),
        CanvassActivity.exists({ campaignId }),
        SurveyResponse.exists({ campaignId }),
        Effort.find({ campaignId, status: { $ne: 'archived' } }, { _id: 1 }).lean(),
        Pass.distinct('effortId', { campaignId, status: 'active' }),
      ]);

    // Efforts that aren't live yet (no active round) — drives the dashboard nudge so
    // a new effort isn't masked by the campaign-level "complete".
    const activeEffortSet = new Set(activeEffortIdsRaw.map(String));
    const effortsNeedingSetup = effortDocs.filter((e) => !activeEffortSet.has(String(e._id))).length;

    const result = deriveSetupSteps({
      campaign: req.campaign,
      counts: {
        households,
        ownedDoors,
        intakeDoors,
        passes,
        publishedTurfs,
        assignments,
        orgCanvassers,
        activePasses: activeIds.length,
      },
    });

    res.json({ ...result, hasCanvassed: Boolean(activity || responses), effortsNeedingSetup });
  } catch (err) {
    next(err);
  }
});

export default router;
