import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireCampaignManager } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { getQueue, QUEUE_NAMES } from '../../queues/index.js';
import { Household } from '../../models/Household.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { TurfSnapshot } from '../../models/TurfSnapshot.js';
import { SavedSearch } from '../../models/SavedSearch.js';
import { Voter } from '../../models/Voter.js';
import { recomputeTurf, recomputePassTerritories, addSupplementalBooks } from '../../services/turf/generateTurf.js';
import { ATTR_COLUMN } from '../../services/turf/attributeCut.js';
import { snapshotPass, restoreSnapshot } from '../../services/turf/snapshot.js';
import { recomputeHouseholdStatusesByIds, recomputeSurveyStatus } from '../../services/canvass/status.js';
import { recomputeCampaignStats } from '../../services/reports/campaignCounters.js';
import { acquireRecutLock, releaseRecutLock } from '../../services/turf/recutLock.js';
import { getPassStatusMap } from '../../services/passes/passStatus.js';
import { ensureCampaignAssignments, partitionAssignable } from '../../services/campaignRoster.js';
import { resolveWalkList } from '../../services/walklist/resolveWalkList.js';
import { KNOCKABLE_DOOR_FILTER } from '../../services/canvass/knockableDoorFilter.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireCampaignManager);

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

// Bulk-assign many books to many people in one call.
//   mode 'distribute' = round-robin: spread the books evenly across the crew (one
//     person per book, books in spatial/name order) — even BOOK count.
//   mode 'balance'    = greedy by knockable doors: biggest book to the lightest
//     person — even DOOR count (books vary in size).
//   mode 'everyone'   = put every selected person on every selected book.
//   replace:true      = clear existing assignments on those books first.
// Validates active org membership (admins allowed — they canvass too). Reuses the
// same TurfAssignment upsert as the per-book endpoint.
router.post('/assign-bulk', async (req, res, next) => {
  try {
    const { turfIds, userIds, mode = 'distribute', replace = false } = req.body || {};
    const orgId = activeOrgId(req);
    const tids = (Array.isArray(turfIds) ? turfIds : []).filter((x) => mongoose.isValidObjectId(x));
    const uids = (Array.isArray(userIds) ? userIds : []).filter((x) => mongoose.isValidObjectId(x));
    if (!tids.length || !uids.length) return res.status(400).json({ error: 'turfIds and userIds required' });

    const turfs = await Turf.find(
      { _id: { $in: tids }, campaignId: req.campaign._id },
      { _id: 1, passId: 1, name: 1, householdIds: 1, status: 1 }
    ).lean();
    if (!turfs.length) return res.status(404).json({ error: 'No matching books in this campaign' });
    // Only published (accepted) books can be assigned — draft assignments would be
    // silently wiped by a re-cut, so we require Accept first.
    if (turfs.some((t) => t.status !== 'published')) {
      return res.status(409).json({ error: 'Accept the books first — only published books can be assigned.', code: 'not-accepted' });
    }

    // Only people on this campaign's team (or an org admin/superadmin) can be assigned.
    const { allowed: validUsers, notOnTeam } = await partitionAssignable({
      campaignId: req.campaign._id,
      organizationId: orgId,
      userIds: uids,
    });
    if (!validUsers.length) return res.status(409).json({ error: 'Add them to the campaign team first.', code: 'not-on-team', notOnTeam });

    // Deterministic, spatially-sensible order (book names are spatially numbered).
    turfs.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));

    if (replace) {
      await TurfAssignment.deleteMany({ turfId: { $in: turfs.map((t) => t._id) } });
    }

    const pairs = [];
    if (mode === 'everyone') {
      for (const t of turfs) for (const uid of validUsers) pairs.push([t, uid]);
    } else if (mode === 'balance') {
      // Even out total KNOCKABLE doors per person (not book count). Eligible door
      // count per book mirrors the GET / list (active & not fully-voted). Greedy:
      // assign the biggest remaining book to the lightest-loaded person.
      const allHhIds = [...new Set(turfs.flatMap((t) => (t.householdIds || []).map(String)))];
      const eligible = new Set(
        allHhIds.length
          ? (
              await Household.find(
                { _id: { $in: allHhIds }, ...KNOCKABLE_DOOR_FILTER },
                { _id: 1 }
              ).lean()
            ).map((h) => String(h._id))
          : []
      );
      const doorsOf = (t) => (t.householdIds || []).filter((id) => eligible.has(String(id))).length;
      const byDoors = [...turfs].sort((a, b) => doorsOf(b) - doorsOf(a));
      const load = new Map(validUsers.map((u) => [String(u), 0]));
      for (const t of byDoors) {
        let lightest = validUsers[0];
        for (const u of validUsers) {
          if (load.get(String(u)) < load.get(String(lightest))) lightest = u;
        }
        pairs.push([t, lightest]);
        load.set(String(lightest), load.get(String(lightest)) + doorsOf(t));
      }
    } else {
      turfs.forEach((t, i) => pairs.push([t, validUsers[i % validUsers.length]]));
    }

    // One round-trip: upsert every (book, user) pair. The unique (turfId,userId) index
    // makes re-assignment idempotent; {ordered:false} so a duplicate-key race can't abort
    // the batch. (Was a sequential findOneAndUpdate per pair — O(books×users) round-trips.)
    const now = new Date();
    if (pairs.length) {
      await TurfAssignment.bulkWrite(
        pairs.map(([t, uid]) => ({
          updateOne: {
            filter: { turfId: t._id, userId: uid },
            update: { $setOnInsert: { organizationId: orgId, campaignId: req.campaign._id, passId: t.passId, assignedBy: req.user._id, assignedAt: now } },
            upsert: true,
          },
        })),
        { ordered: false }
      );
    }
    const assignments = pairs.length;
    // Books given → make sure those users are on the campaign roster (gates mobile visibility).
    await ensureCampaignAssignments(req.campaign._id, validUsers, orgId, req.user._id);
    res.json({ books: turfs.length, users: validUsers.length, assignments, mode: ['everyone', 'balance'].includes(mode) ? mode : 'distribute', replaced: !!replace, notOnTeam });
  } catch (err) {
    next(err);
  }
});

// Remove many (book, user) assignments in ONE request — collapses the client's old
// "unassign from every book" loop (N DELETEs) into a single campaign-scoped deleteMany.
router.post('/unassign-bulk', async (req, res, next) => {
  try {
    const { turfIds, userIds } = req.body || {};
    const tids = (Array.isArray(turfIds) ? turfIds : []).filter((x) => mongoose.isValidObjectId(x));
    const uids = (Array.isArray(userIds) ? userIds : []).filter((x) => mongoose.isValidObjectId(x));
    if (!tids.length || !uids.length) return res.status(400).json({ error: 'turfIds and userIds required' });
    // Scope to THIS campaign's books so a bad id can't delete another campaign's assignments.
    const scoped = await Turf.find({ _id: { $in: tids }, campaignId: req.campaign._id }, { _id: 1 }).lean();
    if (!scoped.length) return res.json({ deleted: 0 });
    const r = await TurfAssignment.deleteMany({ turfId: { $in: scoped.map((t) => t._id) }, userId: { $in: uids } });
    res.json({ deleted: r.deletedCount });
  } catch (err) {
    next(err);
  }
});

// Enqueue a turf generation run.
router.post('/generate', async (req, res, next) => {
  try {
    const { passId, mode, params } = req.body || {};
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    if (!['attribute', 'geometric', 'manual'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be attribute|geometric|manual' });
    }
    const pass = await Pass.findOne({ _id: passId, campaignId: req.campaign._id }).select('_id effortId').lean();
    if (!pass) return res.status(404).json({ error: 'Pass not found' });

    // Dead-end guard: the round cuts from its effort's owned, mappable doors. With
    // none, generation silently produces 0 books — so block it and point the admin
    // back to the Efforts page to claim doors first. (Client guards this too.)
    const doorCount = await Household.countDocuments({
      campaignId: req.campaign._id,
      isActive: true,
      effortId: pass.effortId,
      'location.coordinates': { $exists: true, $ne: null },
    });
    if (doorCount === 0) {
      return res.status(400).json({
        error: 'This walk list owns no mappable doors yet. Claim doors into the walk list (Walk Lists page) before cutting books.',
        code: 'no-doors',
      });
    }

    // Block re-generating over accepted books — Discard is the deliberate path to
    // re-cut an accepted pass. (Regenerate only wipes drafts, so it would leave the
    // published set + a mismatched household mirror behind and let a re-Accept
    // create duplicate books.)
    const published = await Turf.countDocuments({ passId, status: 'published' });
    if (published > 0) {
      return res.status(409).json({
        error: 'This pass has accepted books. Discard them first to re-cut.',
        code: 'has-published-books',
      });
    }

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
    // The queue is platform-wide and job ids are sequential integers — without the ownership
    // check, any org's admin could walk other orgs' job ids and read their progress/result
    // metadata. The campaign gate above only proves the CALLER owns a campaign; this proves
    // the JOB belongs to it.
    if (!job || String(job.data?.campaignId) !== String(req.campaign._id)) {
      return res.status(404).json({ error: 'Job not found' });
    }
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

// Add supplemental book(s) to a pass from its currently-unassigned households
// (voters imported after the pass was cut) WITHOUT a recut or archive. New books
// come in as drafts → use the normal Accept + Assign flow. Non-destructive, so it
// works on an active pass with published books (unlike /generate, which 409s).
router.post('/add-supplemental', async (req, res, next) => {
  try {
    const { passId, name, maxDoors, excludeRestricted } = req.body || {};
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    const pass = await Pass.findOne({ _id: passId, campaignId: req.campaign._id }).lean();
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    if (pass.status === 'archived') {
      return res.status(400).json({ error: 'Cannot add books to an archived pass' });
    }

    const locked = await acquireRecutLock(pass._id, req.user._id);
    if (!locked) {
      return res.status(409).json({ error: 'A re-cut or restore is in progress on this pass. Try again shortly.' });
    }
    try {
      const result = await addSupplementalBooks({
        campaignId: req.campaign._id,
        passId,
        name: (name && String(name).trim()) || 'New voters',
        maxDoors: Number(maxDoors) > 0 ? Number(maxDoors) : 65,
        excludeRestricted: !!excludeRestricted,
      });
      return res.status(result.added ? 201 : 200).json(result);
    } finally {
      await releaseRecutLock(pass._id);
    }
  } catch (err) {
    next(err);
  }
});

// Discard a pass's books so it can be re-cut from scratch. Snapshots everything
// first (undo), clears the household mirror + assignments, and hard-deletes the
// draft+published books (archived left untouched). On an ACTIVE pass it requires
// confirmActive and reverts the pass to draft when it empties, so a campaign is
// never left "active with zero books". Optionally also clears the pass's knock
// history (also snapshotted for undo). Serialized per-pass by an advisory lock.
router.post('/discard', async (req, res, next) => {
  const { passId, confirmActive, clearKnocks } = req.body || {};
  let locked = false;
  try {
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    const pass = await Pass.findOne({ _id: passId, campaignId: req.campaign._id });
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    if (pass.status === 'archived') return res.status(409).json({ error: 'Pass is archived; create a new pass instead' });

    // Guard: a LIVE pass — or any pass that's already been WORKED (knocks
    // recorded) — needs explicit confirmation; report the stakes either way.
    if (!confirmActive) {
      const knockCount = await CanvassActivity.countDocuments({ passId });
      if (pass.status === 'active' || knockCount > 0) {
        const assignmentCount = await TurfAssignment.countDocuments({ passId });
        return res.status(409).json({
          error:
            pass.status === 'active'
              ? 'This pass is live. Confirm to discard its books.'
              : 'This pass has recorded knocks. Confirm to discard its books.',
          code: 'active-pass-confirm-required',
          isActive: pass.status === 'active',
          knockCount,
          assignmentCount,
        });
      }
    }

    if (!(await acquireRecutLock(passId, req.user._id))) {
      return res.status(409).json({ error: 'A re-cut is already in progress for this pass; try again shortly.' });
    }
    locked = true;

    // Snapshot FIRST (before any deletion) so a failure here aborts the discard
    // and nothing is lost.
    const snapshot = await snapshotPass({
      campaign: req.campaign,
      passId,
      reason: 'discard',
      includeKnocks: !!clearKnocks,
      userId: req.user._id,
    });

    // Optionally clear this pass's knock history (statuses recomputed after).
    let clearedHouseholds = [];
    let clearedVoters = [];
    if (clearKnocks) {
      clearedHouseholds = await CanvassActivity.distinct('householdId', { passId });
      clearedVoters = await SurveyResponse.distinct('voterId', { passId });
      await CanvassActivity.deleteMany({ passId });
      await SurveyResponse.deleteMany({ passId });
      // Bulk ledger delete → recompute Campaign.stats exactly (rare admin op; delta math for a
      // whole-pass wipe would be error-prone). Swallow: stats are a read cache, not the op.
      await recomputeCampaignStats(req.campaign._id, { swallowErrors: true });
    }

    // Wipe the books + their household mirror + assignments.
    const books = await Turf.find(
      { campaignId: req.campaign._id, passId, status: { $in: ['draft', 'published'] } },
      { _id: 1 }
    ).lean();
    const turfIds = books.map((b) => b._id);
    if (turfIds.length) {
      await Household.updateMany({ turfId: { $in: turfIds } }, { $set: { turfId: null, walkOrder: null } });
      await TurfAssignment.deleteMany({ turfId: { $in: turfIds } });
      await Turf.deleteMany({ _id: { $in: turfIds } });
    }
    // Sweep any archived merge-stubs for the pass (legacy; merge now hard-deletes).
    await Turf.deleteMany({ campaignId: req.campaign._id, passId, status: 'archived' });

    // Recompute statuses for the cleared knocks (must run after deletion).
    if (clearKnocks) {
      await recomputeHouseholdStatusesByIds(clearedHouseholds, req.campaign.type);
      await recomputeSurveyStatus(clearedVoters);
    }

    // An active round with no books is invalid — revert it to draft. (Active
    // rounds are derived from Pass.status, so there's no campaign cache to clear.)
    let reverted = false;
    if (pass.status === 'active') {
      pass.status = 'draft';
      await pass.save();
      reverted = true;
    }

    res.json({
      discarded: turfIds.length,
      clearedKnocks: !!clearKnocks,
      reverted,
      snapshotId: String(snapshot._id),
    });
  } catch (err) {
    next(err);
  } finally {
    if (locked) await releaseRecutLock(passId);
  }
});

// List recent undo snapshots for a pass (metadata only — heavy arrays omitted).
router.get('/snapshots', async (req, res, next) => {
  try {
    const { passId } = req.query;
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    const snapshots = await TurfSnapshot.find({ campaignId: req.campaign._id, passId })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('reason bookCount knockCount clearedKnocks restoredAt createdAt createdBy')
      .lean();
    res.json({ snapshots });
  } catch (err) {
    next(err);
  }
});

// Restore a snapshot (undo a discard/re-cut). Refuses if the pass already has
// live books — discard them first. Re-creates books + assignments and, if the
// snapshot captured them, the cleared knocks. Does NOT re-activate the pass.
router.post('/restore-snapshot', async (req, res, next) => {
  const { snapshotId } = req.body || {};
  let lockPassId = null;
  try {
    if (!mongoose.isValidObjectId(snapshotId)) return res.status(400).json({ error: 'snapshotId required' });
    const snapshot = await TurfSnapshot.findOne({ _id: snapshotId, campaignId: req.campaign._id });
    if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });
    const pass = await Pass.findOne({ _id: snapshot.passId, campaignId: req.campaign._id }).select('_id').lean();
    if (!pass) return res.status(404).json({ error: 'Pass not found' });

    const liveBooks = await Turf.countDocuments({ passId: snapshot.passId, status: { $in: ['draft', 'published'] } });
    if (liveBooks > 0) {
      return res.status(409).json({ error: 'This pass already has books. Discard them before restoring a snapshot.' });
    }

    if (!(await acquireRecutLock(snapshot.passId, req.user._id))) {
      return res.status(409).json({ error: 'A re-cut is already in progress for this pass; try again shortly.' });
    }
    lockPassId = snapshot.passId;

    const result = await restoreSnapshot({ campaign: req.campaign, snapshot, userId: req.user._id });
    res.json({ restored: result.bookCount, restoredKnocks: result.restoredKnocks, snapshotId: String(snapshot._id) });
  } catch (err) {
    next(err);
  } finally {
    if (lockPassId) await releaseRecutLock(lockPassId);
  }
});

// Delete a snapshot the admin no longer needs. Lock-guarded so it can't be
// removed out from under an in-flight restore.
router.delete('/snapshots/:id', async (req, res, next) => {
  const { id } = req.params;
  let lockPassId = null;
  try {
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'invalid id' });
    const snapshot = await TurfSnapshot.findOne({ _id: id, campaignId: req.campaign._id }).select('_id passId').lean();
    if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });
    if (!(await acquireRecutLock(snapshot.passId, req.user._id))) {
      return res.status(409).json({ error: 'A re-cut/restore is in progress for this pass; try again shortly.' });
    }
    lockPassId = snapshot.passId;
    await TurfSnapshot.deleteOne({ _id: id, campaignId: req.campaign._id });
    res.json({ deleted: 1 });
  } catch (err) {
    next(err);
  } finally {
    if (lockPassId) await releaseRecutLock(lockPassId);
  }
});

// List books for a pass (preview / map).
router.get('/', async (req, res, next) => {
  try {
    const filter = { campaignId: req.campaign._id };
    if (req.query.passId && mongoose.isValidObjectId(req.query.passId)) filter.passId = req.query.passId;
    if (req.query.status) filter.status = req.query.status;
    else filter.status = { $ne: 'archived' }; // hide merge-absorbed stubs by default
    const turfs = await Turf.find(filter).sort({ createdAt: 1 }).lean();
    // Live "eligible" door count per book — active & not-fully-voted — mirroring what the
    // mobile bootstrap serves canvassers, so admin counts don't drift after early voting.
    const allHhIds = [...new Set(turfs.flatMap((t) => (t.householdIds || []).map(String)))];
    const eligible = new Set(
      allHhIds.length
        ? (
            await Household.find(
              { _id: { $in: allHhIds }, ...KNOCKABLE_DOOR_FILTER },
              { _id: 1 }
            ).lean()
          ).map((h) => String(h._id))
        : []
    );
    // Bulk-restricted marks per book — drives the "Unmark restricted (N)" affordance.
    const bulkAgg = turfs.length
      ? await CanvassActivity.aggregate([
          {
            $match: {
              turfId: { $in: turfs.map((t) => t._id) },
              actionType: 'restricted',
              via: 'bulk',
            },
          },
          { $group: { _id: '$turfId', n: { $sum: 1 } } },
        ])
      : [];
    const bulkByTurf = new Map(bulkAgg.map((r) => [String(r._id), r.n]));
    const withCounts = turfs.map((t) => ({
      ...t,
      eligibleDoorCount: (t.householdIds || []).filter((id) => eligible.has(String(id))).length,
      bulkRestrictedCount: bulkByTurf.get(String(t._id)) || 0,
    }));
    // Owned doors this pass's cut skipped, by reason — surfaced on the page as
    // "N door(s) already voted — skipped" / "N do-not-contact" so a smaller book total makes
    // sense. A door that is BOTH fully-voted and fully-DNC counts once, as DNC (matching the
    // coverage bucket precedence: permanent suppression outranks cycle suppression), so the
    // skip-lines always sum.
    let votedDoorCount = 0;
    let dncDoorCount = 0;
    let excludedApartmentCount = 0;
    let knockCount = 0;
    if (filter.passId) {
      const pass = await Pass.findOne({ _id: filter.passId, campaignId: req.campaign._id }, { effortId: 1 }).lean();
      if (pass) {
        const base = {
          campaignId: req.campaign._id,
          effortId: pass.effortId,
          isActive: true,
          'location.coordinates': { $exists: true, $ne: null },
        };
        [votedDoorCount, dncDoorCount, excludedApartmentCount, knockCount] = await Promise.all([
          Household.countDocuments({ ...base, fullyVoted: true, fullyDnc: { $ne: true } }),
          Household.countDocuments({ ...base, fullyDnc: true }),
          Household.countDocuments({ ...base, excludedFromTurf: true }),
          CanvassActivity.countDocuments({ passId: filter.passId }),
        ]);
      }
    }
    res.json({ turfs: withCounts, votedDoorCount, dncDoorCount, excludedApartmentCount, knockCount });
  } catch (err) {
    next(err);
  }
});

// Remove apartments: persistently exclude households in multi-unit buildings (N+ at
// one geocode) from cutting / the map / counts / the canvasser list (mirrors the
// fully-voted exclusion). Scoped to the pass's effort. Re-includable.
router.post('/exclude-apartments', async (req, res, next) => {
  try {
    const { passId, threshold } = req.body || {};
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    const n = Math.max(2, parseInt(threshold, 10) || 4);
    const pass = await Pass.findOne({ _id: passId, campaignId: req.campaign._id }, { effortId: 1 }).lean();
    if (!pass) return res.status(404).json({ error: 'Pass not found' });

    const households = await Household.find(
      { campaignId: req.campaign._id, effortId: pass.effortId, isActive: true, 'location.coordinates': { $exists: true, $ne: null } },
      { _id: 1, location: 1 }
    ).lean();
    // Group by rounded geocode (5 decimals ≈ 1m) — same key the client groupDoors uses.
    const byKey = new Map();
    for (const h of households) {
      const c = h.location?.coordinates;
      if (!c || c.length !== 2) continue;
      const key = `${Math.round(c[1] * 1e5)}|${Math.round(c[0] * 1e5)}`;
      const arr = byKey.get(key) || [];
      arr.push(h._id);
      byKey.set(key, arr);
    }
    const ids = [];
    let buildings = 0;
    for (const arr of byKey.values()) {
      if (arr.length >= n) { buildings += 1; ids.push(...arr); }
    }
    if (ids.length) await Household.updateMany({ _id: { $in: ids } }, { $set: { excludedFromTurf: true } });
    res.json({ excluded: ids.length, buildings });
  } catch (err) {
    next(err);
  }
});

// Re-include: clear the apartment exclusion for the pass's effort.
router.post('/include-apartments', async (req, res, next) => {
  try {
    const { passId } = req.body || {};
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    const pass = await Pass.findOne({ _id: passId, campaignId: req.campaign._id }, { effortId: 1 }).lean();
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    const r = await Household.updateMany(
      { campaignId: req.campaign._id, effortId: pass.effortId, excludedFromTurf: true },
      { $set: { excludedFromTurf: false } }
    );
    res.json({ included: r.modifiedCount || 0 });
  } catch (err) {
    next(err);
  }
});

// Per-area preview for manual mode: cuttable houses + their voters inside each
// drawn polygon (same cut base filter), index-aligned with the input polygons.
router.post('/manual-preview', async (req, res, next) => {
  try {
    const { passId, polygons } = req.body || {};
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    if (!Array.isArray(polygons)) return res.status(400).json({ error: 'polygons required' });
    const pass = await Pass.findOne({ _id: passId, campaignId: req.campaign._id }, { effortId: 1 }).lean();
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    const base = {
      campaignId: req.campaign._id,
      effortId: pass.effortId,
      ...KNOCKABLE_DOOR_FILTER,
      'location.coordinates': { $exists: true, $ne: null },
    };
    const areas = [];
    // Overlaps dedup first-area-wins, same as generation, so these live counts
    // match what Generate will actually produce.
    const claimed = new Set();
    for (const polygon of polygons) {
      if (!polygon) { areas.push({ doorCount: 0, voterCount: 0 }); continue; }
      const ids = (
        await Household.find({ ...base, location: { $geoWithin: { $geometry: polygon } } }, { _id: 1 }).lean()
      )
        .map((h) => h._id)
        .filter((id) => !claimed.has(String(id)));
      ids.forEach((id) => claimed.add(String(id)));
      const voterCount = ids.length ? await Voter.countDocuments({ householdId: { $in: ids } }) : 0;
      areas.push({ doorCount: ids.length, voterCount });
    }
    res.json({ areas });
  } catch (err) {
    next(err);
  }
});

// Preview a targeted follow-up cut: how many of the effort's doors match the
// filter (knock status + survey answers) AND are cuttable — so the admin sees the
// universe before generating. Mirrors the cut: resolve effort-scoped, then
// intersect with the voted/apartment/inactive exclusions.
router.post('/target-preview', async (req, res, next) => {
  try {
    const { passId, filter } = req.body || {};
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    const pass = await Pass.findOne({ _id: passId, campaignId: req.campaign._id }, { effortId: 1 }).lean();
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    const { householdIds } = await resolveWalkList(req.campaign, filter || {}, { effortId: pass.effortId });
    const cuttable = householdIds.length
      ? (
          await Household.find(
            { _id: { $in: householdIds }, ...KNOCKABLE_DOOR_FILTER },
            { _id: 1 }
          ).lean()
        ).map((h) => h._id)
      : [];
    const voterCount = cuttable.length ? await Voter.countDocuments({ householdId: { $in: cuttable } }) : 0;
    res.json({ doorCount: cuttable.length, voterCount, householdIds: cuttable.map(String) });
  } catch (err) {
    next(err);
  }
});

// Group-sizes preview for attribute mode: how many cuttable (knockable) doors fall
// in each group (precinct/zip/district/…), so the admin can set a smart cap before
// cutting. Same base filter as the cut, grouped by the attribute's column.
router.get('/attribute-preview', async (req, res, next) => {
  try {
    const { passId, attribute } = req.query;
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    const col = ATTR_COLUMN[attribute];
    if (!col) return res.status(400).json({ error: 'Invalid attribute' });
    const pass = await Pass.findOne({ _id: passId, campaignId: req.campaign._id }).lean();
    if (!pass) return res.status(404).json({ error: 'Pass not found' });

    const rows = await Household.aggregate([
      {
        $match: {
          campaignId: req.campaign._id,
          effortId: pass.effortId,
          ...KNOCKABLE_DOOR_FILTER,
          'location.coordinates': { $exists: true, $ne: null },
        },
      },
      { $group: { _id: `$${col}`, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]);
    // Merge blank/missing groups into a single "Unassigned" bucket.
    let unassigned = 0;
    const groups = [];
    for (const r of rows) {
      if (r._id == null || r._id === '') unassigned += r.n;
      else groups.push({ name: String(r._id), doorCount: r.n });
    }
    if (unassigned) groups.push({ name: 'Unassigned', doorCount: unassigned });
    res.json({ groups });
  } catch (err) {
    next(err);
  }
});

// Bulk "the whole book is inaccessible" (gated community): create REAL
// restricted CanvassActivity rows for every eligible, not-yet-done door in the
// selected book(s), tagged via:'bulk'. Real rows keep the per-round view right
// (canvassers see slate doors, not fresh ones); the via tag keeps them OUT of
// the GPS audit and every per-canvasser surface (NOT_BULK in reports). Field
// rows are never deleted — latest-wins status recompute flips the door, and a
// later field re-disposition flips it right back. Idempotent: already-
// restricted and round-completed doors are skipped. docs/PASSES_AND_TURF.md.
router.post('/restrict-bulk', async (req, res, next) => {
  try {
    const tids = (req.body?.turfIds || []).filter((id) => mongoose.isValidObjectId(id));
    if (!tids.length) return res.status(400).json({ error: 'turfIds required' });
    const turfs = await Turf.find(
      { _id: { $in: tids }, campaignId: req.campaign._id },
      { passId: 1, householdIds: 1, status: 1, name: 1 }
    ).lean();
    if (!turfs.length) return res.status(404).json({ error: 'Books not found' });
    if (turfs.some((t) => t.status !== 'published')) {
      return res.status(409).json({
        error: 'Draft books can’t be bulk-restricted — accept the cut first.',
        code: 'not-accepted',
      });
    }

    const now = new Date();
    let marked = 0;
    const skipped = { completed: 0, alreadyRestricted: 0, ineligible: 0 };
    const perTurf = [];
    const touched = [];
    const rows = [];
    for (const turf of turfs) {
      const hhIds = turf.householdIds || [];
      // Same eligibility clause as /:turfId/households, so the marked set equals
      // what the canvasser actually sees (coords are required by the model anyway).
      const eligibleDoors = await Household.find(
        {
          _id: { $in: hhIds },
          ...KNOCKABLE_DOOR_FILTER,
          'location.coordinates': { $exists: true, $ne: null },
        },
        { location: 1, effortId: 1, organizationId: 1, campaignId: 1 }
      ).lean();
      skipped.ineligible += hhIds.length - eligibleDoors.length;
      const statusMap = await getPassStatusMap(
        turf.passId,
        eligibleDoors.map((h) => h._id),
        req.campaign.type
      );
      let turfMarked = 0;
      for (const hh of eligibleDoors) {
        const s = statusMap.get(String(hh._id))?.status || 'unknocked';
        if (s === 'surveyed' || s === 'lit_dropped') {
          skipped.completed += 1; // a done door keeps its result
          continue;
        }
        if (s === 'restricted') {
          skipped.alreadyRestricted += 1; // idempotent re-runs
          continue;
        }
        const [lng, lat] = hh.location.coordinates;
        rows.push({
          organizationId: hh.organizationId,
          campaignId: hh.campaignId,
          householdId: hh._id,
          voterId: null,
          userId: req.user._id,
          actionType: 'restricted',
          via: 'bulk',
          note: null,
          location: { lat, lng, accuracy: null }, // the house's own pin
          distanceFromHouseMeters: 0,
          timestamp: now,
          wasOfflineSubmission: false,
          passId: turf.passId,
          turfId: turf._id,
          effortId: hh.effortId || null,
          // Explicitly NO team. An admin's own coordinator is not a field-work attribution — the
          // same reason lastActionBy is deliberately left unset below ("don't attribute a whole
          // community to the admin"). Bulk rows already sit outside every per-canvasser surface
          // (NOT_BULK), and they must sit outside every per-TEAM total for the same reason.
          coordinatorId: null,
        });
        touched.push(hh._id);
        turfMarked += 1;
      }
      marked += turfMarked;
      perTurf.push({ turfId: String(turf._id), name: turf.name, marked: turfMarked });
    }

    if (rows.length) {
      await CanvassActivity.insertMany(rows);
      await recomputeHouseholdStatusesByIds(touched, req.campaign.type);
      // save() no-ops when the recomputed status is unchanged (e.g. a door
      // restricted in a PRIOR pass), so bump the docs explicitly — the mobile
      // delta poll (/changes filters updatedAt > since) must deliver every
      // touched door. lastActionAt matches the single-door path; lastActionBy
      // is deliberately NOT set (don't attribute a whole community to the admin).
      await Household.updateMany({ _id: { $in: touched } }, { $set: { lastActionAt: now } });
      // Bulk restricted rows change activityCount (campaign tallies include bulk) but never the
      // knock/canvasser counters (restricted ∉ KNOCK_ACTIONS; via:'bulk' is NOT_BULK-excluded) —
      // recompute keeps every stats field exact in one move.
      await recomputeCampaignStats(req.campaign._id, { swallowErrors: true });
    }
    res.json({ marked, skipped, perTurf });
  } catch (err) {
    next(err);
  }
});

// Undo — removes ONLY the rows bulk-restrict created (any admin's; it's a
// book-level action). A canvasser's own field-recorded restricted marks survive
// and stay reversible per-door in the field, like today.
router.post('/unrestrict-bulk', async (req, res, next) => {
  try {
    const tids = (req.body?.turfIds || []).filter((id) => mongoose.isValidObjectId(id));
    if (!tids.length) return res.status(400).json({ error: 'turfIds required' });
    const filter = {
      campaignId: req.campaign._id,
      turfId: { $in: tids.map((id) => new mongoose.Types.ObjectId(id)) },
      actionType: 'restricted',
      via: 'bulk',
    };
    const touched = await CanvassActivity.distinct('householdId', filter);
    const r = await CanvassActivity.deleteMany(filter);
    if (touched.length) {
      await recomputeHouseholdStatusesByIds(touched, req.campaign.type);
      // Same stale-delta edge in reverse (a prior-pass-restricted door recomputes
      // to the same status → no save → no updatedAt bump). Nothing "happened to"
      // the door, so bump updatedAt without touching lastActionAt.
      await Household.updateMany({ _id: { $in: touched } }, { $currentDate: { updatedAt: true } });
      // Bulk ledger delete → keep Campaign.stats.activityCount exact (see restrict-bulk above).
      await recomputeCampaignStats(req.campaign._id, { swallowErrors: true });
    }
    res.json({ unmarked: r.deletedCount, households: touched.length });
  } catch (err) {
    next(err);
  }
});

// Door points for a pass. Returns ALL eligible households (mirroring the cut's
// base filter), each tagged with its book (turfId) or null — so the map shows
// the full door universe as gray dots BEFORE a cut and colors them in after, and
// surfaces any house a manual draw left unassigned.
router.get('/doors', async (req, res, next) => {
  try {
    const { passId } = req.query;
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    const pass = await Pass.findOne({ _id: passId, campaignId: req.campaign._id }).lean();
    if (!pass) return res.status(404).json({ error: 'Pass not found' });

    const filter = {
      campaignId: req.campaign._id,
      effortId: pass.effortId, // only the round's effort's doors (mirror the cut base filter)
      ...KNOCKABLE_DOOR_FILTER, // voted / DNC / excluded doors aren't cut or knocked
      'location.coordinates': { $exists: true, $ne: null },
    };
    if (pass.walkListId) {
      const wl = await SavedSearch.findById(pass.walkListId, { householdIds: 1 }).lean();
      if (wl?.householdIds?.length) filter._id = { $in: wl.householdIds };
    }

    // slim=1 (the mobile assign map): drop the address fields — that screen reads
    // only coordinates/turfId, and at 16k+ doors the JSON.parse cost + retained
    // strings matter on-device. Wire bytes are already gzipped, so this is a
    // parse/heap optimization, not a bandwidth one. Additive: without the param
    // the payload is unchanged (the web cut UI needs the addresses).
    const slim = req.query.slim === '1';
    const households = await Household.find(
      filter,
      slim
        ? { location: 1, turfId: 1, status: 1 }
        : { location: 1, turfId: 1, status: 1, addressLine1: 1, addressLine2: 1, city: 1, state: 1, zipCode: 1 }
    ).lean();
    // Address fields ride along (non-slim) so the client can group stacked
    // apartment units (same geocode) into one building marker and render the
    // unit list without a per-unit fetch.
    const doors = households
      .filter((h) => h.location?.coordinates?.length === 2)
      .map((h) => {
        const d = {
          id: String(h._id),
          lng: h.location.coordinates[0],
          lat: h.location.coordinates[1],
          turfId: h.turfId ? String(h.turfId) : null,
          status: h.status || 'unknocked', // so the cut UI can flag/count restricted doors
        };
        if (!slim) {
          d.addressLine1 = h.addressLine1 || '';
          d.addressLine2 = h.addressLine2 || '';
          d.city = h.city || '';
          d.state = h.state || '';
          d.zipCode = h.zipCode || '';
        }
        return d;
      });
    res.json({ doors });
  } catch (err) {
    next(err);
  }
});

// Single household detail (address + members) for the map popup.
router.get('/household/:householdId', async (req, res, next) => {
  try {
    const { householdId } = req.params;
    if (!mongoose.isValidObjectId(householdId)) return res.status(400).json({ error: 'invalid householdId' });
    const hh = await Household.findOne({ _id: householdId, campaignId: req.campaign._id }).lean();
    if (!hh) return res.status(404).json({ error: 'Household not found' });
    const voters = await Voter.find({ householdId: hh._id }, { fullName: 1, party: 1, surveyStatus: 1 })
      .sort({ fullName: 1 })
      .lean();
    res.json({
      household: {
        id: String(hh._id),
        addressLine1: hh.addressLine1,
        addressLine2: hh.addressLine2 || null,
        city: hh.city,
        state: hh.state,
        zipCode: hh.zipCode,
        county: hh.county || null,
        status: hh.status,
      },
      voters: voters.map((v) => ({
        id: String(v._id),
        fullName: v.fullName,
        party: v.party || null,
        surveyStatus: v.surveyStatus,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// One book's homes (location + per-pass status + address) plus the book's boundary
// / centroid — for the admin book-detail map. Eligible doors only (active & not
// fully-voted), matching the canvasser's view and the progress counts.
router.get('/:turfId/households', async (req, res, next) => {
  try {
    const { turfId } = req.params;
    if (!mongoose.isValidObjectId(turfId)) return res.status(400).json({ error: 'invalid turfId' });
    const turf = await Turf.findOne({ _id: turfId, campaignId: req.campaign._id }).lean();
    if (!turf) return res.status(404).json({ error: 'Book not found' });
    const ids = (turf.householdIds || []).map(String);
    const households = ids.length
      ? await Household.find(
          { _id: { $in: ids }, ...KNOCKABLE_DOOR_FILTER },
          { location: 1, addressLine1: 1, city: 1, state: 1 }
        ).lean()
      : [];
    const [statusMap, bulkRestrictedCount] = await Promise.all([
      getPassStatusMap(turf.passId, ids, req.campaign.type),
      // Drives the detail screen's "Unmark restricted (N)" menu item.
      CanvassActivity.countDocuments({ turfId: turf._id, actionType: 'restricted', via: 'bulk' }),
    ]);
    const out = households
      .filter((h) => h.location?.coordinates?.length === 2)
      .map((h) => ({
        id: String(h._id),
        lng: h.location.coordinates[0],
        lat: h.location.coordinates[1],
        status: statusMap.get(String(h._id))?.status || 'unknocked',
        addressLine1: h.addressLine1 || '',
        city: h.city || '',
        state: h.state || '',
      }));
    res.json({
      turf: {
        id: String(turf._id),
        name: turf.name,
        boundary: turf.boundary || null,
        centroid: turf.centroid || null,
        passId: String(turf.passId),
        bulkRestrictedCount,
      },
      households: out,
    });
  } catch (err) {
    next(err);
  }
});

// All canvasser assignments for a pass (book -> canvassers), for at-a-glance chips.
router.get('/assignments', async (req, res, next) => {
  try {
    const { passId } = req.query;
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    const rows = await TurfAssignment.find({ campaignId: req.campaign._id, passId })
      .populate('userId', 'firstName lastName')
      .lean();
    const assignments = rows
      .filter((a) => a.userId)
      .map((a) => ({
        turfId: String(a.turfId),
        user: { id: String(a.userId._id), firstName: a.userId.firstName, lastName: a.userId.lastName },
      }));
    res.json({ assignments });
  } catch (err) {
    next(err);
  }
});

// Per-book progress for a round: eligible doors (active & not fully-voted, mirroring
// the canvasser's book) and how many are knocked (status !== unknocked). One status
// map for the whole pass, then sliced per turf — so the Books list can show
// "12/40 done" per book without fetching every household.
router.get('/progress', async (req, res, next) => {
  try {
    const { passId } = req.query;
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    const pass = await Pass.findOne({ _id: passId, campaignId: req.campaign._id }).lean();
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    const turfs = await Turf.find(
      { campaignId: req.campaign._id, passId, status: { $ne: 'archived' } },
      { householdIds: 1 }
    ).lean();
    const allHhIds = [...new Set(turfs.flatMap((t) => (t.householdIds || []).map(String)))];
    const eligible = new Set(
      allHhIds.length
        ? (
            await Household.find(
              { _id: { $in: allHhIds }, ...KNOCKABLE_DOOR_FILTER },
              { _id: 1 }
            ).lean()
          ).map((h) => String(h._id))
        : []
    );
    const statusMap = await getPassStatusMap(passId, allHhIds, req.campaign.type);
    const progress = turfs.map((t) => {
      const ids = (t.householdIds || []).map(String).filter((id) => eligible.has(id));
      const knocked = ids.filter((id) => (statusMap.get(id)?.status || 'unknocked') !== 'unknocked').length;
      return { turfId: String(t._id), total: ids.length, knocked };
    });
    res.json({ progress });
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

    // Disjointness: a book may only hold doors owned by the book's effort.
    const toPass = await Pass.findById(to.passId, { effortId: 1 }).lean();
    if (!toPass) return res.status(409).json({ error: 'That book’s pass no longer exists.' });
    const movingHh = await Household.findOne({ _id: householdId, campaignId: req.campaign._id }, { effortId: 1 }).lean();
    if (!movingHh) return res.status(404).json({ error: 'Household not found' });
    if (String(movingHh.effortId) !== String(toPass.effortId)) {
      return res.status(409).json({ error: 'That door belongs to a different walk list and cannot be moved into this book.' });
    }

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
    await recomputePassTerritories(to.passId);
    res.json({
      from: from && String(from._id) !== String(to._id) ? { id: String(from._id), doorCount: from.doorCount } : null,
      to: { id: String(to._id), doorCount: to.doorCount },
    });
  } catch (err) {
    next(err);
  }
});

// Move many households (e.g. every unit of an apartment building) into one book
// at once — pull them out of any other book in the pass, then recompute
// territories a single time. Mirrors /move-door for the bulk case.
router.post('/move-doors', async (req, res, next) => {
  try {
    const { householdIds, toTurfId } = req.body || {};
    const ids = (householdIds || []).filter((x) => mongoose.isValidObjectId(x));
    if (!ids.length || !mongoose.isValidObjectId(toTurfId)) {
      return res.status(400).json({ error: 'householdIds and toTurfId required' });
    }
    const to = await Turf.findOne({ _id: toTurfId, campaignId: req.campaign._id });
    if (!to) return res.status(404).json({ error: 'Target book not found' });

    // Disjointness: a book may only hold doors owned by the book's effort.
    const toPass = await Pass.findById(to.passId, { effortId: 1 }).lean();
    if (!toPass) return res.status(409).json({ error: 'That book’s pass no longer exists.' });
    const moving = await Household.find({ _id: { $in: ids }, campaignId: req.campaign._id }, { effortId: 1 }).lean();
    const foreign = moving.filter((h) => String(h.effortId) !== String(toPass.effortId)).length;
    if (foreign) {
      return res.status(409).json({ error: `${foreign} door(s) belong to a different effort and cannot be moved into this book.` });
    }

    const idSet = new Set(ids.map(String));
    const others = await Turf.find({ campaignId: req.campaign._id, passId: to.passId, _id: { $ne: to._id } });
    for (const t of others) {
      const before = t.householdIds.length;
      t.householdIds = t.householdIds.filter((id) => !idSet.has(String(id)));
      if (t.householdIds.length !== before) await recomputeTurf(t);
    }
    const have = new Set(to.householdIds.map(String));
    for (const id of ids) if (!have.has(String(id))) to.householdIds.push(id);
    await recomputeTurf(to);
    await recomputePassTerritories(to.passId);
    res.json({ to: { id: String(to._id), doorCount: to.doorCount } });
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
    // Hard-delete absorbed books (their assignments are folded into primary above);
    // archiving left ghost stubs that lingered in the list and survived discard.
    await Turf.deleteMany({ _id: { $in: absorbedIds } });
    await recomputeTurf(primary);
    await recomputePassTerritories(primary.passId);
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
    await recomputePassTerritories(src.passId);
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
