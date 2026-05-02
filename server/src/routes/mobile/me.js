import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../../middleware/auth.js';
import { Household } from '../../models/Household.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';

const router = Router();
router.use(requireAuth);

router.get('/today', async (req, res, next) => {
  try {
    const { campaignId } = req.query;
    if (!campaignId || !mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ error: 'campaignId query param is required' });
    }
    const cId = new mongoose.Types.ObjectId(campaignId);

    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const [doorsKnocked, responses, remaining] = await Promise.all([
      CanvassActivity.countDocuments({
        userId: req.user._id,
        campaignId: cId,
        timestamp: { $gte: start },
        actionType: { $in: ['not_home', 'wrong_address', 'survey_submitted', 'lit_dropped'] },
      }),
      SurveyResponse.countDocuments({
        userId: req.user._id,
        campaignId: cId,
        submittedAt: { $gte: start },
      }),
      Household.countDocuments({
        campaignId: cId,
        isActive: true,
        status: 'unknocked',
      }),
    ]);

    res.json({ doorsKnocked, responses, remaining });
  } catch (err) {
    next(err);
  }
});

export default router;
