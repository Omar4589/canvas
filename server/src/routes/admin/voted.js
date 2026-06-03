import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import Papa from 'papaparse';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { VotedUpload } from '../../models/VotedUpload.js';
import { suggestMapping } from '../../services/import/canonicalFields.js';
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

// Parse the CSV, find the voter-id column, and resolve which of this campaign's
// voters it matches. Voters are matched org-wide by stateVoterId (indexed) then
// filtered to those living in THIS campaign's households.
async function parseAndMatch(campaign, fileBuffer, idColumn) {
  const csv = fileBuffer.toString('utf8');
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  const columns = parsed.meta?.fields || [];
  const col =
    (idColumn && columns.includes(idColumn) && idColumn) ||
    suggestMapping(columns).stateVoterId ||
    columns.find((c) => /voter\s*id/i.test(c)) ||
    null;
  if (!col) return { error: 'Could not detect a Voter ID column — pick one with idColumn.', columns };

  const csvIds = new Set();
  for (const row of parsed.data) {
    const raw = row[col];
    if (raw == null) continue;
    const id = String(raw).trim();
    if (id) csvIds.add(id);
  }
  const ids = [...csvIds];
  const voters = ids.length
    ? await Voter.find(
        { organizationId: campaign.organizationId, stateVoterId: { $in: ids } },
        { _id: 1, stateVoterId: 1, householdId: 1 }
      ).lean()
    : [];
  const hhIds = [...new Set(voters.map((v) => String(v.householdId)))];
  const inCampaignHh = new Set(
    (await Household.find({ _id: { $in: hhIds }, campaignId: campaign._id }, { _id: 1 }).lean()).map((h) => String(h._id))
  );
  const inCampaign = voters.filter((v) => inCampaignHh.has(String(v.householdId)));
  const matchedSvids = new Set(inCampaign.map((v) => v.stateVoterId));
  const notFoundIds = ids.filter((id) => !matchedSvids.has(id));
  return {
    columns,
    col,
    totalRows: parsed.data.length,
    csvCount: csvIds.size,
    inCampaign,
    notFound: notFoundIds.length,
    notFoundIds,
  };
}

// IDs in the file that didn't match a voter in this campaign — capped so the response
// stays small; the admin downloads these to fix and re-upload.
const NOT_FOUND_CAP = 10000;

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
