import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../../middleware/auth.js';
import { Campaign } from '../../models/Campaign.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';

const router = Router();
router.use(requireAuth);

router.get('/campaigns', async (req, res, next) => {
  try {
    const campaigns = await Campaign.find({ isActive: true })
      .sort({ createdAt: -1 })
      .select('name type state surveyTemplateId')
      .lean();
    res.json({
      user: req.user.toSafeJSON(),
      campaigns: campaigns.map((c) => ({
        id: String(c._id),
        name: c.name,
        type: c.type,
        state: c.state,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/bootstrap', async (req, res, next) => {
  try {
    const { campaignId } = req.query;
    if (!campaignId || !mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ error: 'campaignId query param is required' });
    }

    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign || !campaign.isActive) {
      return res.status(404).json({ error: 'Campaign not found or inactive' });
    }

    const households = await Household.find(
      {
        campaignId: campaign._id,
        isActive: true,
        'location.coordinates': { $exists: true, $ne: null },
      },
      {
        addressLine1: 1,
        addressLine2: 1,
        city: 1,
        state: 1,
        zipCode: 1,
        location: 1,
        status: 1,
        lastActionAt: 1,
      }
    ).lean();

    const householdIds = households.map((h) => h._id);

    const [voters, survey] = await Promise.all([
      campaign.type === 'survey'
        ? Voter.find(
            { householdId: { $in: householdIds } },
            {
              householdId: 1,
              fullName: 1,
              firstName: 1,
              lastName: 1,
              party: 1,
              gender: 1,
              dateOfBirth: 1,
              precinct: 1,
              surveyStatus: 1,
            }
          ).lean()
        : Promise.resolve([]),
      campaign.surveyTemplateId
        ? SurveyTemplate.findById(campaign.surveyTemplateId).lean()
        : Promise.resolve(null),
    ]);

    res.json({
      user: req.user.toSafeJSON(),
      campaign: {
        id: String(campaign._id),
        name: campaign.name,
        type: campaign.type,
        state: campaign.state,
      },
      activeSurvey: survey,
      households,
      voters,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
