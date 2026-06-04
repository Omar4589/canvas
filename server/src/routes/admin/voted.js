import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { VotedUpload } from '../../models/VotedUpload.js';
import { VotedPendingId } from '../../models/VotedPendingId.js';
import { parseAndMatch, NOT_FOUND_CAP } from '../../services/import/parseVoterIdList.js';
import { recomputeFullyVoted } from '../../services/voted/recomputeFullyVoted.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireOrgRole('admin'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

async function loadCampaign(req, res, next) {
  try {
    const orgId = req.activeOrg?._id;
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

// Split matched voters into newly-voting vs already-voted, and count how many
// doors would become fully-voted (dry-run union).
async function classify(campaign, inCampaign) {
  const voterIds = inCampaign.map((v) => v._id);
  const already = await VotedVoter.find(
    { campaignId: campaign._id, voterId: { $in: voterIds } },
    { voterId: 1 }
  ).lean();
  const alreadySet = new Set(already.map((r) => String(r.voterId)));
  const newly = inCampaign.filter((v) => !alreadySet.has(String(v._id)));
  const affected = [...new Set(inCampaign.map((v) => String(v.householdId)))];
  return { newly, alreadyCount: alreadySet.size, affected };
}

async function previewDrops(campaign, affected, newlyVoterIds) {
  if (!affected.length) return 0;
  const voters = await Voter.find({ householdId: { $in: affected } }, { _id: 1, householdId: 1 }).lean();
  const byHh = new Map();
  for (const v of voters) {
    const k = String(v.householdId);
    if (!byHh.has(k)) byHh.set(k, []);
    byHh.get(k).push(String(v._id));
  }
  const existing = await VotedVoter.find(
    { campaignId: campaign._id, voterId: { $in: voters.map((v) => v._id) } },
    { voterId: 1 }
  ).lean();
  const votedSet = new Set(existing.map((r) => String(r.voterId)));
  for (const vid of newlyVoterIds) votedSet.add(String(vid));
  const alreadyFully = new Set(
    (await Household.find({ _id: { $in: affected }, fullyVoted: true }, { _id: 1 }).lean()).map((h) => String(h._id))
  );
  let drops = 0;
  for (const id of affected) {
    if (alreadyFully.has(id)) continue;
    const hv = byHh.get(id) || [];
    if (hv.length > 0 && hv.every((x) => votedSet.has(x))) drops++;
  }
  return drops;
}

// Dry run — no writes.
router.post('/preview', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: "file")' });
    const m = await parseAndMatch(req.campaign, req.file.buffer, req.body?.idColumn);
    if (m.error) return res.status(400).json({ error: m.error, columns: m.columns });
    const { newly, alreadyCount, affected } = await classify(req.campaign, m.inCampaign);
    const doorsWillDrop = await previewDrops(req.campaign, affected, newly.map((v) => v._id));
    res.json({
      idColumn: m.col,
      columns: m.columns,
      totalRows: m.totalRows,
      idsInFile: m.csvCount,
      matched: m.inCampaign.length,
      willMark: newly.length,
      alreadyVoted: alreadyCount,
      notFound: m.notFound,
      notFoundIds: m.notFoundIds.slice(0, NOT_FOUND_CAP),
      doorsWillDrop,
    });
  } catch (err) {
    next(err);
  }
});

// Apply — marks voters voted, recomputes fully-voted doors, records the upload.
router.post('/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: "file")' });
    const m = await parseAndMatch(req.campaign, req.file.buffer, req.body?.idColumn);
    if (m.error) return res.status(400).json({ error: m.error, columns: m.columns });
    const { newly, alreadyCount, affected } = await classify(req.campaign, m.inCampaign);

    const uploadDoc = await VotedUpload.create({
      organizationId: req.campaign.organizationId,
      campaignId: req.campaign._id,
      fileName: req.file.originalname,
      uploadedBy: req.user._id,
      totalRows: m.totalRows,
      alreadyVoted: alreadyCount,
      notFound: m.notFound,
    });

    if (newly.length) {
      const ops = newly.map((v) => ({
        updateOne: {
          filter: { campaignId: req.campaign._id, voterId: v._id },
          update: {
            $setOnInsert: {
              organizationId: req.campaign.organizationId,
              campaignId: req.campaign._id,
              voterId: v._id,
              householdId: v.householdId,
              stateVoterId: v.stateVoterId,
              votedAt: new Date(),
              uploadId: uploadDoc._id,
            },
          },
          upsert: true,
        },
      }));
      for (let i = 0; i < ops.length; i += 2000) {
        await VotedVoter.bulkWrite(ops.slice(i, i + 2000), { ordered: false });
      }
    }

    const beforeFully = await Household.countDocuments({ _id: { $in: affected }, fullyVoted: true });
    await recomputeFullyVoted(req.campaign._id, affected);
    const afterFully = await Household.countDocuments({ _id: { $in: affected }, fullyVoted: true });
    const doorsDropped = Math.max(0, afterFully - beforeFully);

    await VotedUpload.updateOne({ _id: uploadDoc._id }, { $set: { matched: newly.length, doorsDropped } });

    // Sticky early voting: remember ids that didn't match yet (the voter isn't in the universe),
    // so a later universe import can mark them; and clear any stale pending ids for voters that
    // DID match (they're present now).
    if (m.notFoundIds.length) {
      const pendingDocs = m.notFoundIds.map((stateVoterId) => ({
        organizationId: req.campaign.organizationId,
        campaignId: req.campaign._id,
        uploadId: uploadDoc._id,
        stateVoterId,
      }));
      for (let i = 0; i < pendingDocs.length; i += 2000) {
        await VotedPendingId.insertMany(pendingDocs.slice(i, i + 2000), { ordered: false });
      }
    }
    const matchedSvids = m.inCampaign.map((v) => v.stateVoterId);
    if (matchedSvids.length) {
      await VotedPendingId.deleteMany({ campaignId: req.campaign._id, stateVoterId: { $in: matchedSvids } });
    }

    res.json({
      uploadId: String(uploadDoc._id),
      matched: m.inCampaign.length,
      marked: newly.length,
      alreadyVoted: alreadyCount,
      notFound: m.notFound,
      notFoundIds: m.notFoundIds.slice(0, NOT_FOUND_CAP),
      doorsDropped,
      totalRows: m.totalRows,
    });
  } catch (err) {
    next(err);
  }
});

// History + current totals.
router.get('/', async (req, res, next) => {
  try {
    const [uploads, totalVoted, fullyVotedDoors] = await Promise.all([
      VotedUpload.find({ campaignId: req.campaign._id })
        .sort({ createdAt: -1 })
        .limit(50)
        .populate('uploadedBy', 'firstName lastName email')
        .lean(),
      VotedVoter.countDocuments({ campaignId: req.campaign._id }),
      Household.countDocuments({ campaignId: req.campaign._id, fullyVoted: true }),
    ]);
    res.json({ uploads, totalVoted, fullyVotedDoors });
  } catch (err) {
    next(err);
  }
});

// Undo one upload — delete only the rows it first created, recompute doors.
router.post('/undo', async (req, res, next) => {
  try {
    const { uploadId } = req.body || {};
    if (!mongoose.isValidObjectId(uploadId)) return res.status(400).json({ error: 'uploadId required' });
    const uploadDoc = await VotedUpload.findOne({ _id: uploadId, campaignId: req.campaign._id });
    if (!uploadDoc) return res.status(404).json({ error: 'Upload not found' });
    if (uploadDoc.undone) return res.status(400).json({ error: 'Upload already undone' });

    const rows = await VotedVoter.find({ uploadId: uploadDoc._id }, { householdId: 1 }).lean();
    const affected = [...new Set(rows.map((r) => String(r.householdId)))];
    await VotedVoter.deleteMany({ uploadId: uploadDoc._id });
    // Drop this upload's not-yet-matched ids too, so an undone list never re-applies on import.
    await VotedPendingId.deleteMany({ uploadId: uploadDoc._id });
    await recomputeFullyVoted(req.campaign._id, affected);
    await VotedUpload.updateOne({ _id: uploadDoc._id }, { $set: { undone: true, undoneAt: new Date() } });

    res.json({ ok: true, removed: rows.length });
  } catch (err) {
    next(err);
  }
});

// Un-mark a single voter who was marked voted by mistake (regardless of which upload added
// them). Re-opens the door if it had been fully-voted.
router.post('/unmark', async (req, res, next) => {
  try {
    const stateVoterId = String(req.body?.stateVoterId || '').trim();
    if (!stateVoterId) return res.status(400).json({ error: 'stateVoterId required' });

    const voter = await Voter.findOne(
      { organizationId: req.campaign.organizationId, stateVoterId },
      { _id: 1, householdId: 1 }
    ).lean();
    if (!voter) return res.status(404).json({ error: 'No voter with that ID in this organization' });
    const inCampaign = await Household.exists({ _id: voter.householdId, campaignId: req.campaign._id });
    if (!inCampaign) return res.status(404).json({ error: 'That voter is not in this campaign' });

    const del = await VotedVoter.deleteMany({ campaignId: req.campaign._id, voterId: voter._id });
    if (!del.deletedCount) return res.status(404).json({ error: 'That voter was not marked voted' });

    const wasFully = await Household.exists({ _id: voter.householdId, fullyVoted: true });
    await recomputeFullyVoted(req.campaign._id, [String(voter.householdId)]);
    const stillFully = await Household.exists({ _id: voter.householdId, fullyVoted: true });

    res.json({ ok: true, removed: del.deletedCount, reopened: !!wasFully && !stillFully });
  } catch (err) {
    next(err);
  }
});

export default router;
