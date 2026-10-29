import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireCampaignManager } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { NOT_DELETING } from '../../services/campaigns/deletionState.js';
import { Pass } from '../../models/Pass.js';
import { Effort } from '../../models/Effort.js';
import { Turf } from '../../models/Turf.js';
import { Household } from '../../models/Household.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { getPassStatusMap, statusCountsFromMap } from '../../services/passes/passStatus.js';
import { knocksPipeline, connectionRate, contactRate } from '../../services/reports/aggregations.js';
import { activePassIds } from '../../services/passes/activePasses.js';
import { createNextPass } from '../../services/passes/createPass.js';
import { removeDeskRestrict } from '../../services/canvass/deskRestrict.js';
import { deleteRoundSnapshots } from '../../services/turf/snapshotRetention.js';
import { acquireRecutLock, releaseRecutLock } from '../../services/turf/recutLock.js';
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { DESK_RESTRICT_MATCH } from '../../services/canvass/deskRestrict.js';
import {
  requireActiveCampaign,
  assertWalkListWritable,
  assertPassWritable,
} from '../../middleware/campaignWritable.js';
import {
  activatePass,
  archivePass,
  bringBackPass,
  bringBackVerdict,
  bringBackCounts,
  endingPassOf,
  heldReply,
  isRecutLockedDoc,
  passLabel,
  refusalMessage,
  sendLifecycleError,
  withLifecycleLock,
} from '../../services/passes/passLifecycle.js';
import { hydrateCanvassers } from '../../services/reports/canvasserIdentity.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireCampaignManager);

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
    // NOT_DELETING: a mid-delete campaign reads as gone (services/campaigns/deletionState.js).
    const campaign = await Campaign.findOne({ _id: req.params.campaignId, organizationId: orgId, ...NOT_DELETING });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    req.campaign = campaign;
    next();
  } catch (err) {
    next(err);
  }
}
router.use(loadCampaign);
// Archived campaign ⇒ its passes are read-only too; reads stay open.
router.use(requireActiveCampaign());

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
    // Per-round counts via the SHARED billing pipeline (distinct (household, pass) +
    // completion tallies) — the same aggregation every report uses, so this page can
    // never disagree with the knocks-by-pass report or the dashboards.
    const knockAgg = await CanvassActivity.aggregate(
      knocksPipeline({ campaignId: req.campaign._id }, { byPass: true })
    );
    const kMap = new Map(knockAgg.map((c) => [String(c._id), c]));
    const activeIds = await activePassIds(req.campaign._id);
    // Pre-turf survey responses belong to no Pass document. A client building a ROUND PICKER needs
    // to know they exist, or its rounds silently fail to add up to the all-rounds headline — the
    // same reason the knocks-by-pass report emits a "Legacy / no round" row.
    const legacyResponseCount = await SurveyResponse.countDocuments({
      organizationId: req.campaign.organizationId,
      campaignId: req.campaign._id,
      passId: null,
    });
    // How each archived pass ended and whether it can be brought back (docs/PROPOSAL_WALK_LIST_ARCHIVE.md
    // §B.5) — answered for every archived pass from this one load, never a query per pass: the
    // siblings are the passes listed here (a filter by effortId still lists all of that walk list's).
    const archived = passes.filter((p) => p.status === 'archived');
    const [effortDocs, bringBackFacts, people] = await Promise.all([
      Effort.find({ campaignId: req.campaign._id }, { name: 1, status: 1 }).lean(),
      bringBackCounts(archived.map((p) => p._id)),
      hydrateCanvassers(archived.map((p) => p.archivedBy).filter(Boolean), req.campaign.organizationId),
    ]);
    const effortById = new Map(effortDocs.map((e) => [String(e._id), e]));
    const siblingsOf = (p) => passes.filter((s) => String(s.effortId) === String(p.effortId) && String(s._id) !== String(p._id));
    const nameOf = (id) => {
      const u = id ? people.get(String(id)) : null;
      return u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || null : null;
    };
    const now = new Date();
    const lifecycleOf = (p) => {
      // Always present, null on passes from before these fields existed (the clients test === null).
      const stamps = {
        lastActivatedAt: p.lastActivatedAt ?? null,
        archivedFrom: p.archivedFrom ?? null,
        archivedVia: p.archivedVia ?? null,
        archivedBy: p.archivedBy ?? null,
        endedByPassId: p.endedByPassId ?? null,
      };
      if (p.status !== 'archived') return { ...stamps, archivedByName: null, endedByPassName: null };
      const siblings = siblingsOf(p);
      const ending = endingPassOf(p, siblings);
      const bringBack = bringBackVerdict(p, {
        campaign: req.campaign,
        effort: effortById.get(String(p.effortId)) || null,
        siblings,
        booksWithDoors: bringBackFacts.booksByPass.get(String(p._id)) || 0,
        canvassers: bringBackFacts.canvassersByPass.get(String(p._id)) || 0,
        recutLocked: isRecutLockedDoc(p, now.getTime()),
        now,
      });
      return {
        ...stamps,
        archivedByName: nameOf(p.archivedBy),
        endedByPassName: ending ? passLabel(ending) : null,
        bringBack,
        ...(bringBack.ok ? {} : { bringBackMessage: refusalMessage(bringBack) }),
      };
    };
    res.json({
      legacyResponseCount,
      passes: passes.map((p) => {
        const k = kMap.get(String(p._id)) || null;
        return {
          ...p,
          ...lifecycleOf(p),
          turfCount: cMap.get(String(p._id)) || 0,
          knockCount: k?.knocks || 0,
          surveyedKnocks: k?.surveyedKnocks || 0,
          litKnocks: k?.litKnocks || 0,
          refusedKnocks: k?.refusedKnocks || 0,
          notTargetKnocks: k?.notTargetKnocks || 0,
          connectionRate: k ? connectionRate(k) : 0,
          contactRate: k ? contactRate(k) : 0,
        };
      }),
      activePassIds: activeIds.map(String),
    });
  } catch (err) {
    next(err);
  }
});

// Create a pass within an effort. roundNumber auto-increments PER EFFORT. `name` is
// optional — blank auto-labels "Pass {roundNumber}" so "New pass" is a single click.
router.post('/', async (req, res, next) => {
  try {
    const { name, effortId } = req.body || {};
    if (!mongoose.isValidObjectId(effortId)) return res.status(400).json({ error: 'effortId is required' });
    const effort = await Effort.findOne({ _id: effortId, campaignId: req.campaign._id }).select('_id name status').lean();
    if (!effort) return res.status(404).json({ error: 'Walk list not found' });
    if (!assertWalkListWritable(res, effort)) return;
    const pass = await createNextPass({
      organizationId: req.campaign.organizationId,
      campaignId: req.campaign._id,
      effortId,
      name,
      userId: req.user._id,
    });
    if (!pass) return res.status(409).json({ error: 'Could not allocate a pass number; retry' });
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
    // A draft of an archived walk list is frozen with it.
    if (!(await assertPassWritable(res, pass))) return;
    if (req.body.name) pass.name = String(req.body.name).trim();
    await pass.save();
    res.json({ pass });
  } catch (err) {
    next(err);
  }
});

// Activation ends the walk list's current live pass (other walk lists keep theirs) and stamps how
// it ended, so Bring back knows it can never come back. The rules — and the survey and
// accepted-books requirements — live in services/passes/passLifecycle.js.
router.post('/:id/activate', async (req, res, next) => {
  try {
    const pass = await activatePass({ campaign: req.campaign, passId: req.params.id, userId: req.user._id });
    res.json({ pass });
  } catch (err) {
    if (!sendLifecycleError(res, err)) next(err);
  }
});

// Archiving asks for confirmation when the round is LIVE or has recorded knocks (canvassers lose its
// books on their next refresh; knocks are kept). It can be undone with Bring back until a later pass
// on the walk list goes live.
router.post('/:id/archive', async (req, res, next) => {
  try {
    const pass = await archivePass({
      campaign: req.campaign,
      passId: req.params.id,
      userId: req.user._id,
      confirm: req.body?.confirmArchive === true,
    });
    res.json({ pass });
  } catch (err) {
    if (!sendLifecycleError(res, err)) next(err);
  }
});

router.post('/:id/bring-back', async (req, res, next) => {
  try {
    res.json(await bringBackPass({ campaign: req.campaign, passId: req.params.id, userId: req.user._id }));
  } catch (err) {
    if (!sendLifecycleError(res, err)) next(err);
  }
});

// Under the walk list's lifecycle lock, so an activation can't land on the draft mid-delete, answering
// once it's released. A draft with no walk list (data from before walk lists) has no lock to take, and no
// activation to race: activating one is refused.
router.delete('/:id', async (req, res, next) => {
  try {
    const first = await Pass.findOne({ _id: req.params.id, campaignId: req.campaign._id }, { effortId: 1 }).lean();
    if (!first) return res.status(404).json({ error: 'Pass not found' });
    const { reply, send } = heldReply();
    await (first.effortId ? withLifecycleLock(first.effortId, () => deletePass(req, reply)) : deletePass(req, reply));
    send(res);
  } catch (err) {
    if (!sendLifecycleError(res, err)) next(err);
  }
});

const deletePass = async (req, res) => {
  let lockedId = null;
  try {
    const pass = await Pass.findOne({ _id: req.params.id, campaignId: req.campaign._id }).lean();
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    if (pass.status !== 'draft') return res.status(400).json({ error: 'Only draft passes can be deleted' });
    // A draft of an archived walk list is frozen with it.
    if (!(await assertPassWritable(res, pass))) return;
    // Under the round's re-cut lock, as a discard and a snapshot restore are: a restore landing mid-delete
    // put knocks back under a round that was gone, then failed on its deleted snapshot (code review after
    // round 9).
    if (!(await acquireRecutLock(pass._id, req.user?._id))) {
      return res.status(409).json({ error: 'This round is being re-cut, discarded or restored right now. Try again in a minute.', code: 'recut-locked' });
    }
    lockedId = pass._id;
    // Draft is not proof of no history: a discard that keeps the knocks turns a live round back to draft,
    // and so does a restored snapshot. Deleted, its entries and surveys belonged to no round — the round
    // list and the per-round numbers stopped adding up to the campaign's — and its kept copies of earlier
    // answers named a round that no longer existed. The ledger is the authority, as for a walk list
    // (efforts.js): archive it instead. Desk marks don't count — they go with the round (below).
    const [entries, surveys, copies] = await Promise.all([
      CanvassActivity.exists({ passId: pass._id, $nor: [DESK_RESTRICT_MATCH] }),
      SurveyResponse.exists({ passId: pass._id }),
      SurveyResponseArchive.exists({ passId: pass._id }),
    ]);
    if (entries || surveys || copies) {
      return res.status(400).json({
        error: 'This pass has recorded door history (knocks, survey answers or their kept copies); archive it instead of deleting.',
        code: 'has-history',
      });
    }
    const books = await Turf.find({ passId: pass._id }, { _id: 1 }).lean();
    const turfIds = books.map((b) => b._id);
    if (turfIds.length) {
      await Household.updateMany({ turfId: { $in: turfIds } }, { $set: { turfId: null, walkOrder: null } });
      await TurfAssignment.deleteMany({ turfId: { $in: turfIds } });
    }
    await Turf.deleteMany({ passId: pass._id });
    // Single-home desk marks are allowed on a DRAFT round (restrict-doors); with the round
    // gone they would orphan — global status stuck at restricted, no book-level undo left —
    // so sweep them with the round (field rows refused it above).
    await removeDeskRestrict({ campaign: req.campaign, filter: { passId: pass._id } });
    await Pass.deleteOne({ _id: pass._id });
    // Its snapshots go with it, cleared knocks and all: only this round could take them back, so
    // left behind they were answers and notes no screen reached (services/turf/snapshotRetention.js).
    // After the round, so a delete that stops in between leaves the round its undo — and the nightly
    // sweep takes what a stopped delete left.
    await deleteRoundSnapshots(req.campaign._id, [pass._id]);
    res.json({ deleted: 1 });
  } finally {
    // A no-op once the round is gone; a delete that stopped short lets the round go again.
    if (lockedId) await releaseRecutLock(lockedId).catch(() => {});
  }
};

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
