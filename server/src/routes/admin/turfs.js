import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { getQueue, QUEUE_NAMES } from '../../queues/index.js';
import { Household } from '../../models/Household.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { recomputeTurf } from '../../services/turf/generateTurf.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireOrgRole('admin'));

function activeOrgId(req) {
  return req.activeOrg?._id;
}

async function loadCampaign(req, res, next) {
  try {
    const orgId = activeOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Active organization required' });
    const { campaignId } = req.params;
    if (!mongoose.isValidObjectId(campaignId)) return res.status(400).json({ error: 'Invalid campaignId' });
    const campaign = await Campaign.findOne({ _id: campaignId, organizationId: orgId });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    req.campaign = campaign;
    next();
  } catch (err) {
    next(err);
  }
}
router.use(loadCampaign);

// Enqueue a turf generation run.
router.post('/generate', async (req, res, next) => {
  try {
    const { passId, mode, params } = req.body || {};
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    if (!['attribute', 'geometric', 'manual'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be attribute|geometric|manual' });
    }
    const pass = await Pass.findOne({ _id: passId, campaignId: req.campaign._id }).select('_id').lean();
    if (!pass) return res.status(404).json({ error: 'Pass not found' });

    const job = await getQueue(QUEUE_NAMES.TURF).add('generate', {
      campaignId: String(req.campaign._id),
      passId: String(passId),
      mode,
      params: params || {},
      generatedBy: String(req.user._id),
    });
    res.status(202).json({ jobId: String(job.id) });
  } catch (err) {
    next(err);
  }
});

// Poll a generation job.
router.get('/jobs/:jobId', async (req, res, next) => {
  try {
    const job = await getQueue(QUEUE_NAMES.TURF).getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const state = await job.getState();
    res.json({
      jobId: String(job.id),
      status: state,
      progress: job.progress || 0,
      result: job.returnvalue || null,
      error: job.failedReason || null,
    });
  } catch (err) {
    next(err);
  }
});

// Accept the current draft books for a pass (draft -> published).
router.post('/accept', async (req, res, next) => {
  try {
    const { passId } = req.body || {};
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    const r = await Turf.updateMany(
      { campaignId: req.campaign._id, passId, status: 'draft' },
      { $set: { status: 'published' } }
    );
    res.json({ published: r.modifiedCount });
  } catch (err) {
    next(err);
  }
});

// Discard ALL books for a pass (draft + published) so it can be re-cut from
// scratch. Archived books are left untouched. Clears the household turfId/walkOrder
// mirror + any canvasser assignments for those books. Blocked on archived passes.
// (Regenerate only wipes drafts, so this is the escape hatch once books are accepted.)
router.post('/discard', async (req, res, next) => {
  try {
    const { passId } = req.body || {};
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    const pass = await Pass.findOne({ _id: passId, campaignId: req.campaign._id });
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    if (pass.status === 'archived') return res.status(409).json({ error: 'Pass is archived; create a new pass instead' });

    const books = await Turf.find(
      { campaignId: req.campaign._id, passId, status: { $in: ['draft', 'published'] } },
      { _id: 1 }
    ).lean();
    const turfIds = books.map((b) => b._id);
    if (!turfIds.length) return res.json({ discarded: 0 });

    await Household.updateMany({ turfId: { $in: turfIds } }, { $set: { turfId: null, walkOrder: null } });
    await TurfAssignment.deleteMany({ turfId: { $in: turfIds } });
    const r = await Turf.deleteMany({ _id: { $in: turfIds } });
    res.json({ discarded: r.deletedCount });
  } catch (err) {
    next(err);
  }
});

// List books for a pass (preview / map).
router.get('/', async (req, res, next) => {
  try {
    const filter = { campaignId: req.campaign._id };
    if (req.query.passId && mongoose.isValidObjectId(req.query.passId)) filter.passId = req.query.passId;
    if (req.query.status) filter.status = req.query.status;
    const turfs = await Turf.find(filter).sort({ createdAt: 1 }).lean();
    res.json({ turfs });
  } catch (err) {
    next(err);
  }
});

// Door points for a pass (for the map: render + drag between books).
router.get('/doors', async (req, res, next) => {
  try {
    const { passId } = req.query;
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    const turfs = await Turf.find({ campaignId: req.campaign._id, passId }, { _id: 1 }).lean();
    const turfIds = turfs.map((t) => t._id);
    const households = await Household.find(
      { turfId: { $in: turfIds } },
      { location: 1, turfId: 1 }
    ).lean();
    const doors = households
      .filter((h) => h.location?.coordinates?.length === 2)
      .map((h) => ({
        id: String(h._id),
        lng: h.location.coordinates[0],
        lat: h.location.coordinates[1],
        turfId: String(h.turfId),
      }));
    res.json({ doors });
  } catch (err) {
    next(err);
  }
});

// Move a single door from one book to another (both recompute).
router.post('/move-door', async (req, res, next) => {
  try {
    const { householdId, fromTurfId, toTurfId } = req.body || {};
    if (!mongoose.isValidObjectId(householdId) || !mongoose.isValidObjectId(toTurfId)) {
      return res.status(400).json({ error: 'householdId and toTurfId required' });
    }
    const to = await Turf.findOne({ _id: toTurfId, campaignId: req.campaign._id });
    if (!to) return res.status(404).json({ error: 'Target book not found' });

    const fromQuery = mongoose.isValidObjectId(fromTurfId)
      ? { _id: fromTurfId, campaignId: req.campaign._id }
      : { campaignId: req.campaign._id, passId: to.passId, householdIds: householdId };
    const from = await Turf.findOne(fromQuery);
    if (from && String(from._id) !== String(to._id)) {
      from.householdIds = from.householdIds.filter((id) => String(id) !== String(householdId));
      await recomputeTurf(from);
    }
    if (!to.householdIds.map(String).includes(String(householdId))) to.householdIds.push(householdId);
    await recomputeTurf(to);
    res.json({
      from: from && String(from._id) !== String(to._id) ? { id: String(from._id), doorCount: from.doorCount } : null,
      to: { id: String(to._id), doorCount: to.doorCount },
    });
  } catch (err) {
    next(err);
  }
});

// Merge >=2 books (same pass) into the first; absorbed books are archived and
// their assignments folded into the primary.
router.post('/merge', async (req, res, next) => {
  try {
    const { turfIds } = req.body || {};
    const ids = (turfIds || []).filter((x) => mongoose.isValidObjectId(x));
    if (ids.length < 2) return res.status(400).json({ error: 'turfIds (>=2) required' });
    const turfs = await Turf.find({ _id: { $in: ids }, campaignId: req.campaign._id });
    if (turfs.length < 2) return res.status(404).json({ error: 'books not found' });
    const passId = String(turfs[0].passId);
    if (!turfs.every((t) => String(t.passId) === passId)) {
      return res.status(400).json({ error: 'books must be in the same pass' });
    }

    const primary = turfs[0];
    const absorbed = turfs.slice(1);
    const merged = new Set(primary.householdIds.map(String));
    for (const t of absorbed) for (const id of t.householdIds) merged.add(String(id));
    primary.householdIds = [...merged].map((id) => new mongoose.Types.ObjectId(id));

    const absorbedIds = absorbed.map((t) => t._id);
    const absorbedAssignments = await TurfAssignment.find({ turfId: { $in: absorbedIds } }).lean();
    for (const a of absorbedAssignments) {
      await TurfAssignment.findOneAndUpdate(
        { turfId: primary._id, userId: a.userId },
        { $setOnInsert: { organizationId: a.organizationId, campaignId: a.campaignId, passId: a.passId, assignedBy: a.assignedBy, assignedAt: new Date() } },
        { upsert: true }
      );
    }
    await TurfAssignment.deleteMany({ turfId: { $in: absorbedIds } });
    await Turf.updateMany({ _id: { $in: absorbedIds } }, { $set: { status: 'archived', householdIds: [] } });
    await recomputeTurf(primary);
    res.json({ turf: { id: String(primary._id), doorCount: primary.doorCount } });
  } catch (err) {
    next(err);
  }
});

// Split a subset of doors out of a book into a new book.
router.post('/:turfId/split', async (req, res, next) => {
  try {
    const { householdIds, name } = req.body || {};
    if (!Array.isArray(householdIds) || !householdIds.length) {
      return res.status(400).json({ error: 'householdIds required' });
    }
    const src = await Turf.findOne({ _id: req.params.turfId, campaignId: req.campaign._id });
    if (!src) return res.status(404).json({ error: 'Book not found' });
    const moveSet = new Set(householdIds.map(String));
    const moving = src.householdIds.filter((id) => moveSet.has(String(id)));
    if (!moving.length) return res.status(400).json({ error: 'none of those doors are in this book' });

    src.householdIds = src.householdIds.filter((id) => !moveSet.has(String(id)));
    const newTurf = await Turf.create({
      organizationId: src.organizationId,
      campaignId: src.campaignId,
      passId: src.passId,
      name: name || `${src.name} (split)`,
      mode: src.mode,
      params: src.params,
      householdIds: moving,
      doorCount: moving.length,
      status: src.status,
      generatedBy: req.user._id,
    });
    await recomputeTurf(src);
    await recomputeTurf(newTurf);
    res.json({
      source: { id: String(src._id), doorCount: src.doorCount },
      created: { id: String(newTurf._id), doorCount: newTurf.doorCount },
    });
  } catch (err) {
    next(err);
  }
});

// Rename / recolor a book.
router.patch('/:turfId', async (req, res, next) => {
  try {
    const turf = await Turf.findOne({ _id: req.params.turfId, campaignId: req.campaign._id });
    if (!turf) return res.status(404).json({ error: 'Book not found' });
    if (req.body.name) turf.name = String(req.body.name).trim();
    await turf.save();
    res.json({ turf });
  } catch (err) {
    next(err);
  }
});

export default router;
