import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireCampaignManager } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { requireActiveCampaign } from '../../middleware/campaignWritable.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { ensureCampaignAssignments, partitionAssignable } from '../../services/campaignRoster.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireCampaignManager);

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
// After loadTurf so a missing book still answers 404 — an archived campaign is a
// different refusal from a book that isn't there.
router.use(requireActiveCampaign());

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
    // Only published (accepted) books can be assigned — draft assignments would be
    // silently wiped by a re-cut, so we require Accept first.
    if (req.turf.status !== 'published') {
      return res.status(409).json({ error: 'Accept the books first — only published books can be assigned.', code: 'not-accepted' });
    }
    const orgId = activeOrgId(req);
    // Only people on this campaign's team (or an org admin/superadmin) can be assigned.
    const { allowed, notOnTeam } = await partitionAssignable({
      campaignId: req.turf.campaignId,
      organizationId: orgId,
      userIds: userIds.filter((id) => mongoose.isValidObjectId(id)),
    });
    if (!allowed.length) {
      return res.status(409).json({ error: 'Add them to the campaign team first.', code: 'not-on-team', notOnTeam });
    }
    // One round-trip: upsert every user for this book (unique index → idempotent).
    const now = new Date();
    await TurfAssignment.bulkWrite(
      allowed.map((uid) => ({
        updateOne: {
          filter: { turfId: req.turf._id, userId: uid },
          update: {
            $setOnInsert: {
              organizationId: orgId,
              campaignId: req.turf.campaignId,
              passId: req.turf.passId,
              assignedBy: req.user._id,
              assignedAt: now,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    // Book given → make sure they're on the campaign roster (gates mobile visibility).
    // (No-op for existing members; covers an admin assigned on the fly, incl. self.)
    await ensureCampaignAssignments(req.turf.campaignId, allowed, orgId, req.user._id);
    // The client only invalidates + refetches assignments; no caller reads the returned docs.
    res.status(201).json({ ok: true, count: allowed.length, notOnTeam });
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
