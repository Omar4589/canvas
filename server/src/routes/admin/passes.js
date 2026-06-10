import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { Pass } from '../../models/Pass.js';
import { Effort } from '../../models/Effort.js';
import { Turf } from '../../models/Turf.js';
import { Household } from '../../models/Household.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { getPassStatusMap, statusCountsFromMap } from '../../services/passes/passStatus.js';
import { KNOCK_ACTIONS } from '../../services/reports/aggregations.js';
import { activePassIds } from '../../services/passes/activePasses.js';

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

// List a campaign's rounds, optionally scoped to one effort. roundNumber sorts
// per effort. Returns the campaign's active round ids (one per active effort).
router.get('/', async (req, res, next) => {
  try {
    const filter = { campaignId: req.campaign._id };
    if (req.query.effortId && mongoose.isValidObjectId(req.query.effortId)) {
      filter.effortId = new mongoose.Types.ObjectId(req.query.effortId);
    }
    const passes = await Pass.find(filter).sort({ roundNumber: 1 }).lean();
    const counts = await Turf.aggregate([
      { $match: { campaignId: req.campaign._id, status: { $ne: 'archived' } } },
      { $group: { _id: '$passId', turfs: { $sum: 1 } } },
    ]);
    const cMap = new Map(counts.map((c) => [String(c._id), c.turfs]));
    // Per-round knock count — billing definition: distinct (household, pass).
    const knockAgg = await CanvassActivity.aggregate([
      { $match: { campaignId: req.campaign._id, actionType: { $in: KNOCK_ACTIONS } } },
      { $group: { _id: { passId: '$passId', householdId: '$householdId' } } },
      { $group: { _id: '$_id.passId', knocks: { $sum: 1 } } },
    ]);
    const kMap = new Map(knockAgg.map((c) => [String(c._id), c.knocks]));
    const activeIds = await activePassIds(req.campaign._id);
    res.json({
      passes: passes.map((p) => ({
        ...p,
        turfCount: cMap.get(String(p._id)) || 0,
        knockCount: kMap.get(String(p._id)) || 0,
      })),
      activePassIds: activeIds.map(String),
    });
  } catch (err) {
    next(err);
  }
});

// Create a round within an effort. roundNumber auto-increments PER EFFORT.
router.post('/', async (req, res, next) => {
  try {
    const { name, effortId } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!mongoose.isValidObjectId(effortId)) return res.status(400).json({ error: 'effortId is required' });
    const effort = await Effort.findOne({ _id: effortId, campaignId: req.campaign._id }).select('_id').lean();
    if (!effort) return res.status(404).json({ error: 'Effort not found' });
    let pass;
    for (let attempt = 0; attempt < 5 && !pass; attempt += 1) {
      const last = await Pass.findOne({ effortId }).sort({ roundNumber: -1 }).select('roundNumber').lean();
      const roundNumber = (last?.roundNumber || 0) + 1;
      try {
        pass = await Pass.create({
          organizationId: req.campaign.organizationId,
          campaignId: req.campaign._id,
          effortId,
          roundNumber,
          name: String(name).trim(),
          status: 'draft',
          createdBy: req.user._id,
        });
      } catch (err) {
        if (err.code === 11000) continue; // (effortId, roundNumber) race — retry
        throw err;
      }
    }
    if (!pass) return res.status(409).json({ error: 'Could not allocate a round number; retry' });
    res.status(201).json({ pass });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const pass = await Pass.findOne({ _id: req.params.id, campaignId: req.campaign._id });
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    if (pass.status !== 'draft') return res.status(400).json({ error: 'Only draft passes can be edited' });
    if (req.body.name) pass.name = String(req.body.name).trim();
    await pass.save();
    res.json({ pass });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/activate', async (req, res, next) => {
  try {
    const pass = await Pass.findOne({ _id: req.params.id, campaignId: req.campaign._id });
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    if (pass.status === 'archived') {
      return res.status(409).json({ error: 'Archived passes cannot be reactivated; create a new pass' });
    }
    const published = await Turf.countDocuments({ passId: pass._id, status: 'published' });
    if (!published) return res.status(400).json({ error: 'Generate and accept books before activating this pass' });

    const now = new Date();
    // Archive only other active rounds OF THE SAME EFFORT — other efforts keep
    // their active rounds (a campaign can have several active rounds at once).
    await Pass.updateMany(
      { campaignId: req.campaign._id, effortId: pass.effortId, status: 'active', _id: { $ne: pass._id } },
      { $set: { status: 'archived', archivedAt: now } }
    );
    pass.status = 'active';
    if (!pass.activatedAt) pass.activatedAt = now;
    await pass.save();
    res.json({ pass });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/archive', async (req, res, next) => {
  try {
    const pass = await Pass.findOne({ _id: req.params.id, campaignId: req.campaign._id });
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    // Guard: archiving is one-way (no reopen). Require explicit confirmation when
    // the round is LIVE or has recorded knocks — otherwise canvassers lose a round
    // mid-work with no undo. (Knock history is kept either way.)
    if (!req.body?.confirmArchive) {
      const knockCount = await CanvassActivity.countDocuments({ passId: pass._id });
      if (pass.status === 'active' || knockCount > 0) {
        return res.status(409).json({
          error:
            pass.status === 'active'
              ? 'This round is live. Confirm to archive it.'
              : 'This round has recorded knocks. Confirm to archive it.',
          code: 'archive-confirm-required',
          isActive: pass.status === 'active',
          knockCount,
        });
      }
    }
    pass.status = 'archived';
    pass.archivedAt = new Date();
    await pass.save();
    res.json({ pass });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const pass = await Pass.findOne({ _id: req.params.id, campaignId: req.campaign._id }).lean();
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    if (pass.status !== 'draft') return res.status(400).json({ error: 'Only draft passes can be deleted' });
    const books = await Turf.find({ passId: pass._id }, { _id: 1 }).lean();
    const turfIds = books.map((b) => b._id);
    if (turfIds.length) {
      await Household.updateMany({ turfId: { $in: turfIds } }, { $set: { turfId: null, walkOrder: null } });
      await TurfAssignment.deleteMany({ turfId: { $in: turfIds } });
    }
    await Turf.deleteMany({ passId: pass._id });
    await Pass.deleteOne({ _id: pass._id });
    res.json({ deleted: 1 });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/progress', async (req, res, next) => {
  try {
    const pass = await Pass.findOne({ _id: req.params.id, campaignId: req.campaign._id }).lean();
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    const turfs = await Turf.find({ passId: pass._id }, { householdIds: 1 }).lean();
    const householdIds = turfs.flatMap((t) => t.householdIds.map(String));
    const map = await getPassStatusMap(pass._id, householdIds, req.campaign.type);
    res.json({ passId: String(pass._id), total: householdIds.length, counts: statusCountsFromMap(map, householdIds) });
  } catch (err) {
    next(err);
  }
});

export default router;
