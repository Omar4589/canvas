import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';

const router = Router();
router.use(requireAuth);

router.get('/bootstrap', async (req, res, next) => {
  try {
    const [households, voters, activeSurvey] = await Promise.all([
      Household.find(
        { isActive: true, 'location.coordinates': { $exists: true, $ne: null } },
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
      ).lean(),
      Voter.find(
        {},
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
      ).lean(),
      SurveyTemplate.findOne({ isActive: true }).lean(),
    ]);

    res.json({
      user: req.user.toSafeJSON(),
      activeSurvey,
      households,
      voters,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
