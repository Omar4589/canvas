import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { Membership } from '../../models/Membership.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireOrgRole('admin'));

function activeOrgId(req) {
  return req.activeOrg?._id;
}

async function loadTurf(req, res, next) {
  try {
    const orgId = activeOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Active organization required' });
    if (!mongoose.isValidObjectId(req.params.campaignId) || !mongoose.isValidObjectId(req.params.turfId)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const turf = await Turf.findOne({
      _id: req.params.turfId,
      campaignId: req.params.campaignId,
      organizationId: orgId,
    }).lean();
    if (!turf) return res.status(404).json({ error: 'Turf not found' });
    req.turf = turf;
    next();
  } catch (err) {
    next(err);
  }
}
router.use(loadTurf);

router.get('/', async (req, res, next) => {
  try {
    const assignments = await TurfAssignment.find({ turfId: req.turf._id })
      .populate('userId', 'firstName lastName email')
      .lean();
    res.json({ assignments });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { userIds } = req.body || {};
    if (!Array.isArray(userIds) || !userIds.length) return res.status(400).json({ error: 'userIds required' });
    const orgId = activeOrgId(req);
    const created = [];
    for (const uid of userIds) {
      if (!mongoose.isValidObjectId(uid)) continue;
      const member = await Membership.exists({ userId: uid, organizationId: orgId, isActive: true });
      if (!member) continue;
      const a = await TurfAssignment.findOneAndUpdate(
        { turfId: req.turf._id, userId: uid },
        {
          $setOnInsert: {
            organizationId: orgId,
            campaignId: req.turf.campaignId,
            passId: req.turf.passId,
            assignedBy: req.user._id,
            assignedAt: new Date(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      created.push(a);
    }
    res.status(201).json({ assignments: created });
  } catch (err) {
    next(err);
  }
});

router.delete('/:userId', async (req, res, next) => {
  try {
    const r = await TurfAssignment.deleteOne({ turfId: req.turf._id, userId: req.params.userId });
    res.json({ deleted: r.deletedCount });
  } catch (err) {
    next(err);
  }
});

export default router;
