import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { WalkList } from '../../models/WalkList.js';
import { getPassStatusMap, statusCountsFromMap } from '../../services/passes/passStatus.js';

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

router.get('/', async (req, res, next) => {
  try {
    const passes = await Pass.find({ campaignId: req.campaign._id }).sort({ roundNumber: 1 }).lean();
    const counts = await Turf.aggregate([
      { $match: { campaignId: req.campaign._id } },
      { $group: { _id: '$passId', turfs: { $sum: 1 } } },
    ]);
    const cMap = new Map(counts.map((c) => [String(c._id), c.turfs]));
    res.json({
      passes: passes.map((p) => ({ ...p, turfCount: cMap.get(String(p._id)) || 0 })),
      activePassId: req.campaign.activePassId,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, walkListId } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    let wl = null;
    if (walkListId) {
      if (!mongoose.isValidObjectId(walkListId)) return res.status(400).json({ error: 'Invalid walkListId' });
      wl = await WalkList.findOne({ _id: walkListId, campaignId: req.campaign._id }).select('_id').lean();
      if (!wl) return res.status(404).json({ error: 'Walk list not found' });
    }
    let pass;
    for (let attempt = 0; attempt < 5 && !pass; attempt += 1) {
      const last = await Pass.findOne({ campaignId: req.campaign._id }).sort({ roundNumber: -1 }).select('roundNumber').lean();
      const roundNumber = (last?.roundNumber || 0) + 1;
      try {
        pass = await Pass.create({
          organizationId: req.campaign.organizationId,
          campaignId: req.campaign._id,
          roundNumber,
          name: String(name).trim(),
          walkListId: wl?._id || null,
          status: 'draft',
          createdBy: req.user._id,
        });
      } catch (err) {
        if (err.code === 11000) continue; // roundNumber race — retry
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
    if (req.body.walkListId !== undefined) pass.walkListId = req.body.walkListId || null;
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
    await Pass.updateMany(
      { campaignId: req.campaign._id, status: 'active', _id: { $ne: pass._id } },
      { $set: { status: 'archived', archivedAt: now } }
    );
    pass.status = 'active';
    if (!pass.activatedAt) pass.activatedAt = now;
    await pass.save();
    await Campaign.updateOne({ _id: req.campaign._id }, { $set: { activePassId: pass._id } });
    res.json({ pass });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/archive', async (req, res, next) => {
  try {
    const pass = await Pass.findOne({ _id: req.params.id, campaignId: req.campaign._id });
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    pass.status = 'archived';
    pass.archivedAt = new Date();
    await pass.save();
    if (String(req.campaign.activePassId) === String(pass._id)) {
      await Campaign.updateOne({ _id: req.campaign._id }, { $set: { activePassId: null } });
    }
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
