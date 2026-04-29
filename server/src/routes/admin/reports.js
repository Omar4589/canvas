import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { User } from '../../models/User.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.get('/overview', async (req, res, next) => {
  try {
    const [households, voters, activeUsers, geocodeAgg, statusAgg] = await Promise.all([
      Household.countDocuments({ isActive: true }),
      Voter.countDocuments({}),
      User.countDocuments({ isActive: true }),
      Household.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$geocodeStatus', count: { $sum: 1 } } },
      ]),
      Household.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const geocoded = { pending: 0, success: 0, failed: 0 };
    for (const r of geocodeAgg) geocoded[r._id] = r.count;

    const canvass = { unknocked: 0, not_home: 0, surveyed: 0, wrong_address: 0 };
    for (const r of statusAgg) canvass[r._id] = r.count;

    res.json({
      totals: { households, voters, activeUsers },
      geocoded,
      canvass,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
