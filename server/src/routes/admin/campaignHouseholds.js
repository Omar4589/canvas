import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Campaign } from '../../models/Campaign.js';
import { Household } from '../../models/Household.js';
import { requireAuth, requireCampaignManager } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { updateHouseholdLocation } from '../../services/households/updateHouseholdLocation.js';

// Campaign-nested household admin actions. Today: correcting a door's pin
// (PATCH .../households/:householdId/location). Mounted at
// /admin/campaigns/:campaignId/households (mergeParams to read :campaignId).
const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireCampaignManager);

function activeOrgId(req) {
  return req.activeOrg?._id;
}

const locationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  scope: z.enum(['unit', 'building']).optional(),
});

router.patch('/:householdId/location', async (req, res, next) => {
  try {
    const orgId = activeOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Active organization required' });
    if (!mongoose.isValidObjectId(req.params.campaignId) || !mongoose.isValidObjectId(req.params.householdId)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const campaign = await Campaign.findOne({ _id: req.params.campaignId, organizationId: orgId }).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const household = await Household.findOne({
      _id: req.params.householdId,
      campaignId: campaign._id,
      organizationId: orgId,
    });
    if (!household) return res.status(404).json({ error: 'Household not found' });

    const data = locationSchema.parse(req.body);
    try {
      const { updated } = await updateHouseholdLocation(
        household,
        { lat: data.lat, lng: data.lng },
        { source: 'admin_drag', byUserId: req.user._id, scope: data.scope || 'unit' }
      );
      const h = updated[0];
      return res.json({
        household: {
          id: String(h._id),
          location: h.location ? { lng: h.location.coordinates[0], lat: h.location.coordinates[1] } : null,
          coordSource: h.coordSource,
          coordConfidence: h.coordConfidence,
          correctedAt: h.correctedAt,
        },
        moved: updated.length,
      });
    } catch (err) {
      if (err.code === 'out_of_bounds' || err.code === 'invalid_coords') {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      throw err;
    }
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

export default router;
