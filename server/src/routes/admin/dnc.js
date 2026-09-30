import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { DncUpload } from '../../models/DncUpload.js';
import { DncPendingId } from '../../models/DncPendingId.js';
import { parseAndMatchState, NOT_FOUND_CAP } from '../../services/import/parseVoterIdList.js';
import { recomputeFullyDnc } from '../../services/dnc/recomputeFullyDnc.js';
import { canonicalVoterId } from '../../utils/voterIdKey.js';
import { clearParkedByCanonical } from '../../services/voters/voterIdLookup.js';

// Do-not-contact list uploads. ORG-LEVEL on purpose, twice over: the flag is an org-wide fact on
// the Voter (there is no campaignId to nest under — a nested route would falsely imply campaign
// scope), and the gate is org-admins-only — the campaign-nested voted.js router is gated
// requireCampaignManager, which admits team leads, and leads must not set DNC.
const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function activeOrgId(req) {
  return req.activeOrg?._id;
}
function ensureOrgScoped(req, res) {
  if (!activeOrgId(req)) {
    res.status(400).json({ error: 'Active organization required (X-Org-Id header)' });
    return false;
  }
  return true;
}

// Split matched voter ROWS into newly-flagged vs already-flagged, counting PEOPLE for the UI:
// rows are per-campaign, so a person in 2+ campaigns matches once per campaign — `newly` (rows)
// feeds the flag ops and `affected` (their doors, across every campaign) the recompute, while
// the people counts keep "matched/will flag" meaning humans, not rows. A half-flagged person
// (sibling rows disagreeing — shouldn't happen, the writers keep them in step) counts as newly,
// and the ops converge their rows.
function classify(matched) {
  const newly = matched.filter((v) => v.doNotContact?.flagged !== true);
  const affected = [...new Set(matched.map((v) => String(v.householdId)))];
  const people = new Set(matched.map((v) => v.stateVoterId));
  const newlyPeople = new Set(newly.map((v) => v.stateVoterId));
  const alreadyCount = people.size - newlyPeople.size;
  return { newly, alreadyCount, affected, matchedPeople: people.size, willFlagPeople: newlyPeople.size };
}

// Dry-run: which doors would become fully-DNC (across every campaign housing these voters), with
// a per-campaign breakdown for the preview UI.
async function previewDrops(orgId, affected, newlyVoterIds) {
  if (!affected.length) return { doorsWillDrop: 0, dropsByCampaign: [] };
  const voters = await Voter.find(
    { householdId: { $in: affected } },
    { _id: 1, householdId: 1, 'doNotContact.flagged': 1 }
  ).lean();
  const newlySet = new Set(newlyVoterIds.map(String));
  const byHh = new Map();
  for (const v of voters) {
    const k = String(v.householdId);
    if (!byHh.has(k)) byHh.set(k, []);
    byHh.get(k).push(v.doNotContact?.flagged === true || newlySet.has(String(v._id)));
  }
  const hhDocs = await Household.find(
    { _id: { $in: affected }, organizationId: orgId },
    { _id: 1, campaignId: 1, fullyDnc: 1 }
  ).lean();
  const dropsPerCampaign = new Map();
  let doorsWillDrop = 0;
  for (const h of hhDocs) {
    if (h.fullyDnc) continue; // already suppressed
    const flags = byHh.get(String(h._id)) || [];
    if (flags.length > 0 && flags.every(Boolean)) {
      doorsWillDrop += 1;
      const k = String(h.campaignId);
      dropsPerCampaign.set(k, (dropsPerCampaign.get(k) || 0) + 1);
    }
  }
  const campaigns = dropsPerCampaign.size
    ? await Campaign.find({ _id: { $in: [...dropsPerCampaign.keys()] } }, 'name').lean()
    : [];
  const nameById = new Map(campaigns.map((c) => [String(c._id), c.name]));
  const dropsByCampaign = [...dropsPerCampaign.entries()].map(([campaignId, doors]) => ({
    campaignId,
    name: nameById.get(campaignId) || null,
    doors,
  }));
  return { doorsWillDrop, dropsByCampaign };
}

// The list is for ONE state, and the upload must say which: the lookup runs inside that state's
// campaigns only, because two states can issue the same digits and nothing in the file can tell a
// stripped Georgia id from a genuine Nebraska one (services/import/parseVoterIdList.js). Anything
// the file names outside the state is reported, never flagged.
const stateOf = (req) => String(req.body?.state || '').trim().toUpperCase();
const matchFailure = (res, m) => res.status(400).json({ error: m.error, code: m.code || null, columns: m.columns, states: m.states || [] });

// Dry run — no writes.
router.post('/preview', upload.single('file'), async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: "file")' });
    const m = await parseAndMatchState(activeOrgId(req), stateOf(req), req.file.buffer, req.body?.idColumn);
    if (m.error) return matchFailure(res, m);
    const { newly, alreadyCount, affected, matchedPeople, willFlagPeople } = classify(m.matched);
    const { doorsWillDrop, dropsByCampaign } = await previewDrops(activeOrgId(req), affected, newly.map((v) => v._id));
    res.json({
      state: m.state,
      idColumn: m.col,
      columns: m.columns,
      sampleIds: m.sampleIds,
      totalRows: m.totalRows,
      idsInFile: m.csvCount,
      spellings: m.spellings,
      noId: m.noId,
      matched: matchedPeople,
      matchedViaZeros: m.matchedViaZeros,
      zeroMatchExample: m.zeroMatchExample,
      willFlag: willFlagPeople,
      alreadyFlagged: alreadyCount,
      notFound: m.notFound,
      notFoundIds: m.notFoundIds.slice(0, NOT_FOUND_CAP),
      outsideState: m.outsideState,
      doorsWillDrop,
      dropsByCampaign,
    });
  } catch (err) {
    next(err);
  }
});

// Apply — flags voters, recomputes fully-DNC doors, records the upload.
router.post('/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: "file")' });
    const m = await parseAndMatchState(activeOrgId(req), stateOf(req), req.file.buffer, req.body?.idColumn);
    if (m.error) return matchFailure(res, m);
    const { newly, alreadyCount, affected, matchedPeople, willFlagPeople } = classify(m.matched);

    const uploadDoc = await DncUpload.create({
      organizationId: activeOrgId(req),
      fileName: req.file.originalname,
      uploadedBy: req.user._id,
      totalRows: m.totalRows,
      alreadyFlagged: alreadyCount,
      notFound: m.notFound,
      state: m.state,
      outsideState: m.outsideState.count,
      idColumn: m.col,
      matchedViaZeros: m.matchedViaZeros,
    });

    if (newly.length) {
      const now = new Date();
      const ops = newly.map((v) => ({
        updateOne: {
          // Skip-already-flagged lives IN THE OP FILTER so undo attribution stays clean even
          // against a concurrent admin flag: this upload only ever claims rows it flipped.
          filter: { _id: v._id, 'doNotContact.flagged': { $ne: true } },
          update: {
            $set: {
              doNotContact: {
                flagged: true,
                at: now,
                byUserId: req.user._id,
                reason: null,
                source: 'upload',
                uploadId: uploadDoc._id,
              },
            },
          },
        },
      }));
      for (let i = 0; i < ops.length; i += 2000) {
        await Voter.bulkWrite(ops.slice(i, i + 2000), { ordered: false });
      }
    }

    const beforeFully = await Household.countDocuments({ _id: { $in: affected }, fullyDnc: true });
    await recomputeFullyDnc(affected);
    const afterFully = await Household.countDocuments({ _id: { $in: affected }, fullyDnc: true });
    const doorsDropped = Math.max(0, afterFully - beforeFully);

    // People, not rows — a person with sibling rows in two campaigns is one match.
    await DncUpload.updateOne({ _id: uploadDoc._id }, { $set: { matched: willFlagPeople, doorsDropped } });

    // Sticky DNC: remember ids with no voter anywhere in the org yet, so a later universe import
    // graduates them (reapplyDncLists); clear stale pendings for ids that DID match.
    if (m.notFoundIds.length) {
      const pendingDocs = m.notFoundIds.map((stateVoterId) => ({
        organizationId: activeOrgId(req),
        uploadId: uploadDoc._id,
        stateVoterId,
        state: m.state,
      }));
      for (let i = 0; i < pendingDocs.length; i += 2000) {
        await DncPendingId.insertMany(pendingDocs.slice(i, i + 2000), { ordered: false });
      }
    }
    // Whatever spelling an earlier list parked them under, these people are flagged now — but only
    // rows parked for THIS state (or before states were recorded); a sibling state's parking of the
    // same digits is somebody else's request.
    await clearParkedByCanonical(
      DncPendingId,
      { organizationId: activeOrgId(req), $or: [{ state: m.state }, { state: null }] },
      m.matched.map((v) => canonicalVoterId(v.stateVoterId))
    );

    res.json({
      uploadId: String(uploadDoc._id),
      state: m.state,
      idColumn: m.col,
      matched: matchedPeople,
      matchedViaZeros: m.matchedViaZeros,
      zeroMatchExample: m.zeroMatchExample,
      noId: m.noId,
      flagged: willFlagPeople,
      alreadyFlagged: alreadyCount,
      notFound: m.notFound,
      notFoundIds: m.notFoundIds.slice(0, NOT_FOUND_CAP),
      outsideState: m.outsideState,
      doorsDropped,
      totalRows: m.totalRows,
    });
  } catch (err) {
    next(err);
  }
});

// Undo one upload: revert ONLY the rows it flagged (matched via doNotContact.uploadId). An
// admin-set flag (uploadId null), or an admin re-flag that overwrote the subdoc, is never touched.
router.post('/undo', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const { uploadId } = req.body || {};
    if (!mongoose.isValidObjectId(uploadId)) return res.status(400).json({ error: 'Invalid uploadId' });
    const uploadDoc = await DncUpload.findOne({ _id: uploadId, organizationId: activeOrgId(req) });
    if (!uploadDoc) return res.status(404).json({ error: 'Upload not found' });
    if (uploadDoc.undone) return res.status(409).json({ error: 'Upload already undone' });

    const ownRows = await Voter.find(
      { organizationId: activeOrgId(req), 'doNotContact.uploadId': uploadDoc._id, 'doNotContact.flagged': true },
      { _id: 1, householdId: 1, stateVoterId: 1 }
    ).lean();
    if (ownRows.length) {
      // Keep the stamp (at/byUserId/uploadId) for history; only the flag flips.
      await Voter.updateMany(
        { _id: { $in: ownRows.map((v) => v._id) }, 'doNotContact.uploadId': uploadDoc._id },
        { $set: { 'doNotContact.flagged': false } }
      );
    }
    await DncPendingId.deleteMany({ uploadId: uploadDoc._id });
    const affected = [...new Set(ownRows.map((v) => String(v.householdId)))];
    if (affected.length) await recomputeFullyDnc(affected); // doors may reopen

    uploadDoc.undone = true;
    uploadDoc.undoneAt = new Date();
    await uploadDoc.save();

    // People, not rows (a person's sibling rows unflag together).
    res.json({ ok: true, unflagged: new Set(ownRows.map((v) => v.stateVoterId)).size, doorsReopened: affected.length });
  } catch (err) {
    next(err);
  }
});

// History + org totals for the Do-not-contact page.
router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const [uploads, flaggedAgg, fullyDncDoors, states] = await Promise.all([
      DncUpload.find({ organizationId: activeOrgId(req) })
        .sort({ createdAt: -1 })
        .limit(50)
        .populate('uploadedBy', 'firstName lastName')
        .lean(),
      // People, not rows — sibling rows in 2+ campaigns are one flagged person. Rides the
      // partial doNotContact.flagged index.
      Voter.aggregate([
        { $match: { organizationId: activeOrgId(req), 'doNotContact.flagged': true } },
        { $group: { _id: '$stateVoterId' } },
        { $count: 'n' },
      ]),
      Household.countDocuments({ organizationId: activeOrgId(req), fullyDnc: true }),
      // The states the upload's State picker offers: every state this organization runs a campaign
      // in (archived ones included — their voters still exist and can still be flagged).
      Campaign.distinct('state', { organizationId: activeOrgId(req) }),
    ]);
    const totalFlagged = flaggedAgg[0]?.n || 0;
    res.json({
      totalFlagged,
      fullyDncDoors,
      states: states.filter(Boolean).sort(),
      uploads: uploads.map((u) => ({
        id: String(u._id),
        fileName: u.fileName,
        uploadedBy: u.uploadedBy ? `${u.uploadedBy.firstName || ''} ${u.uploadedBy.lastName || ''}`.trim() : null,
        createdAt: u.createdAt,
        totalRows: u.totalRows,
        matched: u.matched,
        alreadyFlagged: u.alreadyFlagged,
        notFound: u.notFound,
        doorsDropped: u.doorsDropped,
        state: u.state || null,
        outsideState: u.outsideState || 0,
        idColumn: u.idColumn || null,
        matchedViaZeros: u.matchedViaZeros || 0,
        undone: u.undone,
        undoneAt: u.undoneAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
