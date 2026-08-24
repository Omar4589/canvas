import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireCampaignManager } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { requireActiveCampaign } from '../../middleware/campaignWritable.js';
import { Campaign } from '../../models/Campaign.js';
import { NOT_DELETING } from '../../services/campaigns/deletionState.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { getQueue, QUEUE_NAMES } from '../../queues/index.js';
import { Household } from '../../models/Household.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { TurfSnapshot } from '../../models/TurfSnapshot.js';
import { SavedSearch } from '../../models/SavedSearch.js';
import { Voter } from '../../models/Voter.js';
import { recomputeTurf, recomputePassTerritories, wipeDraftBooks, cutExclusionFilter } from '../../services/turf/generateTurf.js';
import { ATTR_COLUMN } from '../../services/turf/attributeCut.js';
import { snapshotPass, restoreSnapshot } from '../../services/turf/snapshot.js';
import { recomputeHouseholdStatusesByIds, recomputeSurveyStatus } from '../../services/canvass/status.js';
import { recomputeCampaignStats } from '../../services/reports/campaignCounters.js';
import { acquireRecutLock, releaseRecutLock, isRecutLocked } from '../../services/turf/recutLock.js';
import { getPassStatusMap, statusCountsFromMap } from '../../services/passes/passStatus.js';
import { addAuditSubjects } from '../../services/access/supportAccess.js';
import { ensureCampaignAssignments, partitionAssignable } from '../../services/campaignRoster.js';
import { resolveWalkList, isActiveTargetFilter } from '../../services/walklist/resolveWalkList.js';
import { KNOCKABLE_DOOR_FILTER } from '../../services/canvass/knockableDoorFilter.js';
import {
  DESK_RESTRICT_MATCH,
  emptyDeskSkips,
  planDeskRestrict,
  commitDeskRestrict,
  removeDeskRestrict,
  bookOfDoorsInPass,
  resolveDeskPassForDoors,
  deskMarkCountsForPasses,
  deskMarkStateForPasses,
  countDeskMarksByBook,
  deskMarkFilterForBook,
} from '../../services/canvass/deskRestrict.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireCampaignManager);

// Record-level audit tag for the :householdId drill (same pattern as routes/admin/households.js
// and routes/admin/voters.js) — GET /household/:householdId is a single-record open returning
// voter names, so a staff read under a grant must log WHICH door was opened.
router.param('householdId', (req, res, next, householdId) => {
  if (mongoose.isValidObjectId(householdId)) addAuditSubjects(res, 'household', householdId);
  next();
});

function activeOrgId(req) {
  return req.activeOrg?._id;
}

// Queue calls are time-bounded: ioredis buffers commands while disconnected, so without
// this a wedged/absent Redis would HANG the request rather than failing it — the 503 path
// below would be unreachable exactly when it matters (the campaigns-delete enqueue pattern).
const queueOp = (promise, ms = Number(process.env.TURF_ENQUEUE_TIMEOUT_MS || 5000)) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('queue timeout')), ms).unref?.()),
  ]);

// Chunked "which of these doors are knockable" set — one $in per 100k ids so the
// query document stays bounded on 250k-door campaigns. Shared by GET / and /progress.
const eligibleSetOf = async (allHhIds) => {
  const eligible = new Set();
  for (let i = 0; i < allHhIds.length; i += 100000) {
    const docs = await Household.find(
      { _id: { $in: allHhIds.slice(i, i + 100000) }, ...KNOCKABLE_DOOR_FILTER },
      { _id: 1 }
    ).lean();
    for (const d of docs) eligible.add(String(d._id));
  }
  return eligible;
};

async function loadCampaign(req, res, next) {
  try {
    const orgId = activeOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Active organization required' });
    const { campaignId } = req.params;
    if (!mongoose.isValidObjectId(campaignId)) return res.status(400).json({ error: 'Invalid campaignId' });
    // NOT_DELETING: a mid-delete campaign reads as gone (services/campaigns/deletionState.js).
    const campaign = await Campaign.findOne({ _id: campaignId, organizationId: orgId, ...NOT_DELETING });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    req.campaign = campaign;
    next();
  } catch (err) {
    next(err);
  }
}
router.use(loadCampaign);
// Archived campaign ⇒ read-only: no cutting, assigning, restricting or moving doors.
// The two *-preview endpoints are POSTs that persist nothing, so they stay open — the
// same carve-out entitlement.js makes for the exports estimate.
router.use(requireActiveCampaign({ readOnlyPosts: /-preview$/ }));

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

    try {
      const job = await queueOp(
        getQueue(QUEUE_NAMES.TURF).add('generate', {
          campaignId: String(req.campaign._id),
          passId: String(passId),
          mode,
          params: params || {},
          generatedBy: String(req.user._id),
        })
      );
      res.status(202).json({ jobId: String(job.id) });
    } catch (err) {
      console.error('[turfs] generate enqueue failed:', err?.message || err);
      res.status(503).json({ error: 'Could not queue the cut — try again in a moment.', code: 'queue-unavailable' });
    }
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
// ENQUEUED, not inline: at 26.5k bookless doors the inline cut outlived Heroku's
// 30s router timeout — the client saw a bare 503 while the server kept going and
// ~300 draft books appeared anyway (2026-08 incident). The job holds the recut
// lock (turfProcessor) and reports progress on GET /jobs/:jobId; the result
// (added/bookCount, including added: 0) lands in the job's returnvalue.
router.post('/add-supplemental', async (req, res, next) => {
  try {
    const { passId, name, maxDoors, excludeRestricted, excludeNoSoliciting } = req.body || {};
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    const pass = await Pass.findOne({ _id: passId, campaignId: req.campaign._id }).lean();
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    if (pass.status === 'archived') {
      return res.status(400).json({ error: 'Cannot add books to an archived pass' });
    }

    // Advisory pre-check only — the BINDING lock acquire lives in the job: a
    // route-held lock could go stale while the job waits behind a long generate.
    // This just gives the admin an immediate 409 instead of a job that fails later.
    if (await isRecutLocked(pass._id)) {
      return res.status(409).json({ error: 'A re-cut or restore is in progress on this pass. Try again shortly.' });
    }

    try {
      const job = await queueOp(
        getQueue(QUEUE_NAMES.TURF).add('supplemental', {
          campaignId: String(req.campaign._id),
          passId: String(passId),
          name: (name && String(name).trim()) || 'New voters',
          maxDoors: Number(maxDoors) > 0 ? Number(maxDoors) : 65,
          excludeRestricted: !!excludeRestricted,
          excludeNoSoliciting: !!excludeNoSoliciting,
          requestedBy: String(req.user._id),
        })
      );
      return res.status(202).json({ jobId: String(job.id) });
    } catch (err) {
      console.error('[turfs] supplemental enqueue failed:', err?.message || err);
      return res.status(503).json({ error: 'Could not queue the books — try again in a moment.', code: 'queue-unavailable' });
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
//
// scope: 'all' (default) | 'drafts'. Drafts-only undoes a bad supplemental add (or
// any unaccepted cut) without touching the accepted books — no snapshot and no
// confirmActive gate, because drafts by construction carry no assignments (both
// assign routes 409 `not-accepted`) and no FIELD history keyed to them; it is the
// exact wipe every re-generate already performs (wipeDraftBooks in generateTurf.js).
// Single-home desk marks (restrict-doors) may carry a draft book's id as provenance
// only — nothing reads it for counts/undo (deskRestrict.js keys by passId + current
// membership); those marks survive the wipe as loose-door marks and count under the
// door's next book.
router.post('/discard', async (req, res, next) => {
  const { passId, confirmActive, clearKnocks, scope } = req.body || {};
  let locked = false;
  try {
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    const draftsOnly = scope === 'drafts';
    if (draftsOnly && clearKnocks) {
      return res.status(400).json({ error: 'Knock history belongs to the pass, not its draft books — clear knocks with a full discard.' });
    }
    const pass = await Pass.findOne({ _id: passId, campaignId: req.campaign._id });
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    if (pass.status === 'archived') return res.status(409).json({ error: 'Pass is archived; create a new pass instead' });

    if (draftsOnly) {
      if (!(await acquireRecutLock(passId, req.user._id))) {
        return res.status(409).json({ error: 'A re-cut is already in progress for this pass; try again shortly.' });
      }
      locked = true;
      const discarded = await wipeDraftBooks(passId);
      return res.json({ discarded, scope: 'drafts' });
    }

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
      // Clear-knocks means "erase this round's field history" — archived (overwritten) responses
      // for the round go with it, or shadow answers outlive the round they came from. The
      // snapshot above preserved them, so discard → restore stays lossless.
      await SurveyResponseArchive.deleteMany({ passId });
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
    const eligible = await eligibleSetOf(allHhIds);
    // Desk-mark ROWS per book — drives the "Unmark restricted (N)" affordance. Keyed by
    // (passId, the book's CURRENT doors), not the stamped turfId, so a single-home mark made
    // while the book was a draft, a moved door's mark, or a restored book's marks all count
    // under — and fall to — the book the door is in now (deskRestrict.js). Archived
    // (merge-absorbed) stubs count 0.
    const deskPassIds = [...new Set(turfs.filter((t) => t.status !== 'archived').map((t) => String(t.passId)))];
    const deskState = await deskMarkStateForPasses(req.campaign._id, deskPassIds, req.campaign.type);
    const bulkByTurf = countDeskMarksByBook(turfs, deskState);
    // slim=1 (the web cut page sends it): drop householdIds from the response — the
    // page never reads them, and at 250k doors they are a multi-MB payload. Additive:
    // without the param the shape is unchanged (mobile books.jsx doesn't send it).
    const slim = req.query.slim === '1';
    const withCounts = turfs.map((t) => {
      const { householdIds, ...rest } = t;
      return {
        ...(slim ? rest : t),
        eligibleDoorCount: (householdIds || []).filter((id) => eligible.has(String(id))).length,
        // ROWS — unchanged meaning, and what Unmark deletes. Every shipped client reads this.
        bulkRestrictedCount: bulkByTurf.get(String(t._id))?.rows || 0,
        // The subset a canvasser's later field row out-voted. ADDITIVE and OMITTED when the
        // status half was skipped (deskRestrict.js's cap) — an absent field reads as "unknown"
        // on every client, where a 0 would read as "none superseded".
        ...(bulkByTurf.get(String(t._id))?.superseded == null
          ? {}
          : { bulkRestrictedSupersededCount: bulkByTurf.get(String(t._id)).superseded }),
      };
    });
    // Owned doors this pass's cut skipped, by reason — surfaced on the page as
    // "N door(s) already voted — skipped" / "N do-not-contact" so a smaller book total makes
    // sense. A door that is BOTH fully-voted and fully-DNC counts once, as DNC (matching the
    // coverage bucket precedence: permanent suppression outranks cycle suppression), so the
    // skip-lines always sum.
    let doNotKnockDoorCount = 0;
    let votedDoorCount = 0;
    let dncDoorCount = 0;
    let excludedApartmentCount = 0;
    let knockCount = 0;
    let supplementalDoorCount = 0;
    let supplementalRestrictedCount = 0;
    let supplementalNoSolicitingCount = 0;
    if (filter.passId) {
      const pass = await Pass.findOne(
        { _id: filter.passId, campaignId: req.campaign._id },
        { effortId: 1, targetFilter: 1 }
      ).lean();
      if (pass) {
        const base = {
          campaignId: req.campaign._id,
          effortId: pass.effortId,
          isActive: true,
          'location.coordinates': { $exists: true, $ne: null },
        };
        // Kept mutually DISJOINT, in the same precedence order the coverage buckets use
        // (services/reports/aggregations.js): doNotKnock > fullyDnc > fullyVoted. A door that is
        // several of these is reported once, in the strongest, so the three lines can be shown
        // side by side without double-counting.
        [doNotKnockDoorCount, votedDoorCount, dncDoorCount, excludedApartmentCount, knockCount] =
          await Promise.all([
            Household.countDocuments({ ...base, doNotKnock: true }),
            Household.countDocuments({
              ...base,
              fullyVoted: true,
              fullyDnc: { $ne: true },
              doNotKnock: { $ne: true },
            }),
            Household.countDocuments({ ...base, fullyDnc: true, doNotKnock: { $ne: true } }),
            Household.countDocuments({ ...base, excludedFromTurf: true }),
            CanvassActivity.countDocuments({ passId: filter.passId }),
          ]);
        // Doors a supplemental book would actually pick up: bookless + knockable,
        // and — when the round is targeted — matching the pass's own recorded
        // targetFilter (exclude branch included). Computed server-side so the
        // "N doors not in any book" nag can't count doors a targeted cut skipped
        // or an exclusion deliberately removed (they are bookless ON PURPOSE).
        const supplementalBase = {
          campaignId: req.campaign._id,
          effortId: pass.effortId,
          turfId: null,
          ...KNOCKABLE_DOOR_FILTER,
          'location.coordinates': { $exists: true, $ne: null },
        };
        if (isActiveTargetFilter(pass.targetFilter)) {
          const { householdIds } = await resolveWalkList(req.campaign, pass.targetFilter, {
            effortId: pass.effortId,
          });
          supplementalBase._id = { $in: householdIds };
        }
        [supplementalDoorCount, supplementalRestrictedCount, supplementalNoSolicitingCount] = await Promise.all([
          Household.countDocuments(supplementalBase),
          // The restricted slice, so the client can mirror its "exclude restricted"
          // checkbox: shown count = supplementalDoorCount − (checkbox ? this : 0).
          Household.countDocuments({ ...supplementalBase, status: 'restricted' }),
          // Same, for the "exclude no-soliciting" checkbox. Disjoint from the line above
          // (a door has ONE status), so subtracting both when both are ticked is correct.
          Household.countDocuments({ ...supplementalBase, status: 'no_soliciting' }),
        ]);
      }
    }
    res.json({
      turfs: withCounts,
      doNotKnockDoorCount,
      votedDoorCount,
      dncDoorCount,
      excludedApartmentCount,
      knockCount,
      supplementalDoorCount,
      supplementalRestrictedCount,
      supplementalNoSolicitingCount,
    });
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
// filter (knock status + survey answers, minus its exclude branch) AND are
// cuttable — so the admin sees the universe before generating. Mirrors the cut:
// resolve effort-scoped, then intersect with the voted/apartment/inactive
// exclusions (and the restricted toggle, when the client sends it — so the
// previewed count equals what Generate will actually cut).
router.post('/target-preview', async (req, res, next) => {
  try {
    const { passId, filter, excludeRestricted, excludeNoSoliciting } = req.body || {};
    if (!mongoose.isValidObjectId(passId)) return res.status(400).json({ error: 'passId required' });
    const pass = await Pass.findOne({ _id: passId, campaignId: req.campaign._id }, { effortId: 1 }).lean();
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    const { householdIds, excludedHouseholdIds, excludeDegenerate, warnings } = await resolveWalkList(
      req.campaign,
      filter || {},
      { effortId: pass.effortId }
    );
    // The same cuttability the cut itself applies (generateTurf's baseFilter) — including the
    // per-round restricted exclusion, so the preview's number equals what the cut produces. It
    // arrives as `$and` and the outer query owns `_id`, so the two cannot collide.
    const cutBase = {
      ...KNOCKABLE_DOOR_FILTER,
      ...(await cutExclusionFilter({
        campaignId: req.campaign._id,
        effortId: pass.effortId,
        campaignType: req.campaign.type,
        excludeRestricted,
        excludeNoSoliciting,
      })),
    };
    const cuttable = householdIds.length
      ? (
          await Household.find(
            { _id: { $in: householdIds }, ...cutBase },
            { _id: 1 }
          ).lean()
        ).map((h) => h._id)
      : [];
    // "M excluded" = doors the exclusion ACTUALLY removed from the cut: the resolver's
    // removed set (already ∩ the include result) narrowed to otherwise-cuttable doors.
    // NOT the raw exclusion population — a fully-voted/excludedFromTurf door with a
    // matching answer was never going to be cut, so it must not inflate M.
    const excludedDoorCount = excludedHouseholdIds.length
      ? await Household.countDocuments({ _id: { $in: excludedHouseholdIds }, ...cutBase })
      : 0;
    // Door-population count minus do-not-contact individuals (matching the walk list's
    // own voter set) — every other resident of a cut door gets walked.
    const voterCount = cuttable.length
      ? await Voter.countDocuments({ householdId: { $in: cuttable }, 'doNotContact.flagged': { $ne: true } })
      : 0;
    res.json({
      doorCount: cuttable.length,
      voterCount,
      excludedDoorCount,
      excludeDegenerate,
      warnings,
      householdIds: cuttable.map(String),
    });
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

// Desk marks — "this book is inaccessible" (a gated community) and, below, "this one home
// is" (one locked gate). Both write REAL restricted CanvassActivity rows tagged via:'bulk'
// through ONE writer, services/canvass/deskRestrict.js — see its header for the row class,
// why there is no second `via` value, and the (passId, current membership) keying of the
// book-level count/undo. Desk marks ignore Campaign.disabledOutcomes on purpose: the toggle
// governs what CANVASSERS may record, and these rows are never field work.
//
// restrict-bulk: every eligible, not-yet-done door in the selected PUBLISHED book(s).
// Idempotent: already-restricted and round-completed doors are skipped.
router.post('/restrict-bulk', async (req, res, next) => {
  try {
    const tids = (req.body?.turfIds || []).filter((id) => mongoose.isValidObjectId(id));
    if (!tids.length) return res.status(400).json({ error: 'turfIds required' });
    // scope decides which unfinished doors get marked:
    //   'incomplete' (default, backward-compatible) — every door not surveyed/lit-dropped/restricted,
    //     i.e. INCLUDING the ones the crew reached (not-home / refused / wrong-address). Use when the
    //     whole book is inaccessible (a gated community).
    //   'unknocked' — ONLY doors nobody has touched this round; every reached door keeps its status
    //     and its knock. Use when the crew worked part of the book and only the untouched remainder
    //     is inaccessible.
    const scope = req.body?.scope === 'unknocked' ? 'unknocked' : 'incomplete';
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
    const skipped = emptyDeskSkips();
    const perTurf = [];
    const touched = [];
    const rows = [];
    for (const turf of turfs) {
      const plan = await planDeskRestrict({
        campaign: req.campaign,
        passId: turf.passId,
        householdIds: turf.householdIds || [],
        userId: req.user._id,
        turfIdFor: () => turf._id,
        scope,
        now,
      });
      for (const k of Object.keys(skipped)) skipped[k] += plan.skipped[k];
      rows.push(...plan.rows);
      touched.push(...plan.touched);
      marked += plan.rows.length;
      perTurf.push({ turfId: String(turf._id), name: turf.name, marked: plan.rows.length });
    }
    await commitDeskRestrict({ campaign: req.campaign, rows, touched, now });
    res.json({ marked, skipped, perTurf });
  } catch (err) {
    next(err);
  }
});

// Undo — removes ONLY desk rows (any admin's; it's a book-level action) on the doors
// CURRENTLY in the selected book(s), for each book's round: bulk marks, single-home marks
// made before acceptance, marks that followed a moved or restored door. A canvasser's own
// field-recorded restricted marks survive and stay reversible per-door in the field.
// `unmarked` = rows removed, `households` = distinct doors.
router.post('/unrestrict-bulk', async (req, res, next) => {
  try {
    const tids = (req.body?.turfIds || []).filter((id) => mongoose.isValidObjectId(id));
    if (!tids.length) return res.status(400).json({ error: 'turfIds required' });
    // Archived (legacy merge-absorbed) stubs are excluded — GET / counts them 0, and their stale
    // householdIds now name doors that belong to the absorbing book, so the same set is used here.
    const turfs = await Turf.find(
      { _id: { $in: tids }, campaignId: req.campaign._id, status: { $ne: 'archived' } },
      { passId: 1, householdIds: 1 }
    ).lean();
    if (!turfs.length) return res.json({ unmarked: 0, households: 0 });
    // One delete across the books ($or of per-book filters) so a door booked in two rounds is
    // still ONE household in the count.
    const filters = turfs.map(deskMarkFilterForBook);
    const r = await removeDeskRestrict({
      campaign: req.campaign,
      filter: filters.length === 1 ? filters[0] : { $or: filters },
    });
    res.json({ unmarked: r.unmarked, households: r.households });
  } catch (err) {
    next(err);
  }
});

// 1–1000 deduped ObjectIds from a request body, or null. Shared by the two single-home routes.
const parseHouseholdIds = (raw) => {
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map(String))].filter((id) => mongoose.isValidObjectId(id));
  if (!ids.length || ids.length > 1000) return null;
  return ids.map((id) => new mongoose.Types.ObjectId(id));
};

// Plain-English reason the route could not pick a round on its own (PASS_REQUIRED).
const passRequiredMessage = (unresolved) =>
  unresolved[0]?.reason === 'intake'
    ? 'This door is not in a walk list yet — assign it to one first.'
    : 'Pick a round first — this walk list has no current round.';

// Door-level desk mark: one home (or every unit at one pin, or a whole lassoed selection)
// Restricted Access, from the turf page, the Map page or the mobile admin app — allowed any
// time the house is on the page (draft books, accepted books, loose dots), unlike
// restrict-bulk's published-only gate.
//   body { householdIds: string[], passId?: string, scope?: 'incomplete'|'unknocked' }
//   passId: explicit (must be this campaign's → 404; archived round → 409 `pass-archived`)
//     else each door's own effort's active round, else its single draft round, else
//     400 PASS_REQUIRED { unresolved:[{ id, reason:'intake'|'no-round' }] } — all-or-nothing.
//     An Intake door (no walk list) can never be marked: no round can own it.
//   scope: the same ladder restrict-bulk offers, so a map lasso over a part-worked street never
//     silently relabels the crew's not-homes and refusals — 'incomplete' (the default, and what
//     an older client that sends no scope gets) marks every door not surveyed/lit-dropped/
//     restricted; 'unknocked' marks only the never-touched ones and counts each reached door in
//     `skipped.reached`.
//   → { marked, skipped:{ completed, alreadyRestricted, ineligible, reached }, passId, passIds }
//   ineligible = not in this campaign, not a knockable door (KNOCKABLE_DOOR_FILTER / no pin),
//   or its effort ≠ the named round's effort.
router.post('/restrict-doors', async (req, res, next) => {
  try {
    const ids = parseHouseholdIds(req.body?.householdIds);
    if (!ids) return res.status(400).json({ error: 'householdIds required (1–1000)' });
    const rawPassId = req.body?.passId ? String(req.body.passId) : null;
    if (rawPassId && !mongoose.isValidObjectId(rawPassId)) return res.status(400).json({ error: 'invalid passId' });
    // Parsed exactly like restrict-bulk's: anything but the literal 'unknocked' is 'incomplete',
    // so an omitted (or unknown) scope behaves precisely as this route did before it existed.
    const scope = req.body?.scope === 'unknocked' ? 'unknocked' : 'incomplete';

    const households = await Household.find(
      { _id: { $in: ids }, campaignId: req.campaign._id },
      { effortId: 1 }
    ).lean();
    const skipped = emptyDeskSkips();
    skipped.ineligible += ids.length - households.length;

    const { byPass, unresolved, ineligible, passProblem } = await resolveDeskPassForDoors({
      campaign: req.campaign,
      households,
      passId: rawPassId,
      forMark: true,
    });
    if (passProblem === 'not-found') return res.status(404).json({ error: 'Pass not found' });
    if (passProblem === 'archived') {
      return res.status(409).json({
        error: 'That round is archived — a desk mark there would never reach a canvasser.',
        code: 'pass-archived',
      });
    }
    if (unresolved.length) {
      return res.status(400).json({ error: passRequiredMessage(unresolved), code: 'PASS_REQUIRED', unresolved });
    }
    skipped.ineligible += ineligible.length;

    const now = new Date();
    const rows = [];
    const touched = [];
    for (const [pid, hhs] of byPass) {
      const hhIds = hhs.map((h) => h._id);
      // Provenance only — the door's book in this round right now (null for a loose door).
      const book = await bookOfDoorsInPass({ campaignId: req.campaign._id, passId: pid, householdIds: hhIds });
      const plan = await planDeskRestrict({
        campaign: req.campaign,
        passId: new mongoose.Types.ObjectId(pid),
        householdIds: hhIds,
        userId: req.user._id,
        turfIdFor: (hh) => book.get(String(hh._id)) || null,
        scope,
        now,
      });
      for (const k of Object.keys(skipped)) skipped[k] += plan.skipped[k];
      rows.push(...plan.rows);
      touched.push(...plan.touched);
    }
    await commitDeskRestrict({ campaign: req.campaign, rows, touched, now });
    // Body ids don't trigger the :householdId param hook; tag them for the staff-access log.
    addAuditSubjects(res, 'household', ids.map(String));
    const passIds = [...byPass.keys()];
    res.json({ marked: rows.length, skipped, passId: rawPassId || (passIds.length === 1 ? passIds[0] : null), passIds });
  } catch (err) {
    next(err);
  }
});

// Single-home undo — removes the DESK rows on those doors for one round; field-recorded
// marks never match (a canvasser re-knocking supersedes those). No knockable filter, no
// effort / pass-status / pass-existence check: it deletes for whatever passId the client
// names (the mark's own round from /activity), so a mark whose draft round was since
// deleted or whose door was re-housed can always be removed. Omitted passId resolves
// exactly as restrict-doors does.
//   body { householdIds: string[], passId?: string } → { unmarked, households, passId, passIds }
router.post('/unrestrict-doors', async (req, res, next) => {
  try {
    const ids = parseHouseholdIds(req.body?.householdIds);
    if (!ids) return res.status(400).json({ error: 'householdIds required (1–1000)' });
    const rawPassId = req.body?.passId ? String(req.body.passId) : null;
    if (rawPassId && !mongoose.isValidObjectId(rawPassId)) return res.status(400).json({ error: 'invalid passId' });

    // Map<passIdStr, householdId[]>
    const groups = new Map();
    if (rawPassId) {
      groups.set(rawPassId, ids);
    } else {
      const households = await Household.find(
        { _id: { $in: ids }, campaignId: req.campaign._id },
        { effortId: 1 }
      ).lean();
      const { byPass, unresolved } = await resolveDeskPassForDoors({
        campaign: req.campaign,
        households,
        passId: null,
        forMark: false,
      });
      if (unresolved.length) {
        return res.status(400).json({ error: passRequiredMessage(unresolved), code: 'PASS_REQUIRED', unresolved });
      }
      for (const [pid, hhs] of byPass) groups.set(pid, hhs.map((h) => h._id));
    }
    const filters = [...groups].map(([pid, hhIds]) => ({
      passId: new mongoose.Types.ObjectId(pid),
      householdId: { $in: hhIds },
    }));
    const r = filters.length
      ? await removeDeskRestrict({ campaign: req.campaign, filter: filters.length === 1 ? filters[0] : { $or: filters } })
      : { unmarked: 0, households: 0 };
    addAuditSubjects(res, 'household', ids.map(String));
    const passIds = [...groups.keys()];
    res.json({ unmarked: r.unmarked, households: r.households, passId: rawPassId || (passIds.length === 1 ? passIds[0] : null), passIds });
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
    const placed = households.filter((h) => h.location?.coordinates?.length === 2);

    // door → book resolved from THIS PASS's own books, never from Household.turfId.
    // The mirror is single-valued and always points at the LATEST cut, so prepping a
    // future draft round moves it off this pass's books — which made this page hide
    // 12k live doors as "not in any book" mid-campaign. Turf.householdIds is the
    // authoritative membership (it is what the phones resolve against), so this map
    // reads it too and the two can no longer disagree.
    const passTurfs = await Turf.find(
      { passId: pass._id, status: { $ne: 'archived' } },
      { householdIds: 1 }
    ).lean();
    const bookOf = new Map();
    for (const t of passTurfs) {
      for (const hid of t.householdIds || []) bookOf.set(String(hid), String(t._id));
    }

    // withStatus=1 (the web cut map): each door's status FOR THIS ROUND, so the map can
    // color houses by what happened this pass instead of only by which book owns them.
    // Opt-in rather than unconditional — the mobile assign map (slim=1) colors by book and
    // would pay the aggregate + a string per door across a 16k-door effort for nothing.
    // Distinct from `status` below, which is Household.status (latest across ALL passes).
    let passStatusMap = null;
    let deskRowsByDoor = null;
    if (req.query.withStatus === '1' && placed.length) {
      // One more aggregate on the SAME opt-in, bounded by the desk rows themselves (a small
      // minority of any ledger — deskRestrict.js), not by the door count. It carries the desk
      // ROWS per door so the cut map's building pop-up and its "Select doors" bar can offer
      // Unmark on a SUPERSEDED mark: both used to gate on passStatus === 'restricted', which
      // goes false the moment a canvasser works the door and stranded the row with no undo.
      [passStatusMap, deskRowsByDoor] = await Promise.all([
        getPassStatusMap(pass._id, placed.map((h) => String(h._id)), req.campaign.type),
        deskMarkCountsForPasses(req.campaign._id, [String(pass._id)]),
      ]);
    }

    const doors = placed.map((h) => {
      const d = {
        id: String(h._id),
        lng: h.location.coordinates[0],
        lat: h.location.coordinates[1],
        turfId: bookOf.get(String(h._id)) || null,
        status: h.status || 'unknocked', // so the cut UI can flag/count restricted doors
      };
      if (passStatusMap) {
        d.passStatus = passStatusMap.get(String(h._id))?.status || 'unknocked';
        d.restrictedFrom = passStatusMap.get(String(h._id))?.restrictedFrom || null;
        // Emitted only where non-zero: an ordinary door's payload is byte-identical.
        const marks = deskRowsByDoor?.get(`${pass._id}|${h._id}`) || 0;
        if (marks > 0) d.deskMarks = marks;
      }
      if (!slim) {
        d.addressLine1 = h.addressLine1 || '';
        d.addressLine2 = h.addressLine2 || '';
        d.city = h.city || '';
        d.state = h.state || '';
        d.zipCode = h.zipCode || '';
      }
      return d;
    });
    // format=geojson (additive — without it the response is byte-identical): the
    // mobile Books map view feeds this straight to a file-backed ShapeSource so the
    // native SDK parses it off the JS thread. At 100k+ doors the {doors} JSON
    // crossed the RN bridge as one serialized string and froze the phone.
    if (req.query.format === 'geojson') {
      return res.json({
        type: 'FeatureCollection',
        features: doors.map(({ id, lng, lat, ...props }) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lng, lat] },
          properties: { id, ...props },
        })),
      });
    }
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
        // Pin + provenance for the pop-up's Move pin action (same shape as the pin PATCH's
        // response): where the dot is, and whether a person corrected it / it is approximate.
        location: hh.location?.coordinates?.length === 2
          ? { lng: hh.location.coordinates[0], lat: hh.location.coordinates[1] }
          : null,
        coordSource: hh.coordSource || null,
        coordConfidence: hh.coordConfidence || null,
        correctedAt: hh.correctedAt || null,
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
    const [statusMap, deskState] = await Promise.all([
      getPassStatusMap(turf.passId, ids, req.campaign.type),
      // Drives the detail screen's "Unmark restricted (N)" menu item — desk-mark ROWS on the
      // doors currently in this book, for its round (same keying as GET / and unrestrict-bulk;
      // an archived merge-absorbed stub counts 0 there too). Routed through the SAME primitive
      // GET / uses, so the books list and the book detail can no longer drift: the old
      // countDocuments here was a second implementation of "same keying as GET /" held only by
      // a comment, and it could not see superseded marks at all.
      turf.status === 'archived'
        ? new Map()
        : deskMarkStateForPasses(req.campaign._id, [String(turf.passId)], req.campaign.type),
    ]);
    const deskBook = countDeskMarksByBook([turf], deskState).get(String(turf._id));
    // Per-door desk-mark rows, so the book's house pop-up can offer Unmark on a SUPERSEDED
    // mark — a door whose status no longer says restricted but whose row is still on file.
    // Emitted only where non-zero, so the payload is byte-identical for every ordinary door.
    const deskRowsByDoor = new Map(
      ids.map((id) => [id, deskState.get(`${turf.passId}|${id}`)?.rows || 0]).filter(([, n]) => n > 0)
    );
    const out = households
      .filter((h) => h.location?.coordinates?.length === 2)
      .map((h) => ({
        id: String(h._id),
        lng: h.location.coordinates[0],
        lat: h.location.coordinates[1],
        status: statusMap.get(String(h._id))?.status || 'unknocked',
        restrictedFrom: statusMap.get(String(h._id))?.restrictedFrom || null,
        ...(deskRowsByDoor.has(String(h._id)) ? { deskMarks: deskRowsByDoor.get(String(h._id)) } : {}),
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
        bulkRestrictedCount: deskBook?.rows || 0,
        ...(deskBook?.superseded == null ? {} : { bulkRestrictedSupersededCount: deskBook.superseded }),
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
//
// `statusCounts` breaks that same slice out by status. THIS ROUTE IS THE SINGLE COUNT
// ORACLE for the cut page: the book status chips, the map labels, the completion tint and
// the round coverage bar all read it, so they cannot drift apart. /doors?withStatus=1
// colors dots from the same getPassStatusMap over the same pass, but never feeds a count.
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
    const eligible = await eligibleSetOf(allHhIds);
    const statusMap = await getPassStatusMap(passId, allHhIds, req.campaign.type);
    const progress = turfs.map((t) => {
      const ids = (t.householdIds || []).map(String).filter((id) => eligible.has(id));
      const knocked = ids.filter((id) => (statusMap.get(id)?.status || 'unknocked') !== 'unknocked').length;
      return { turfId: String(t._id), total: ids.length, knocked, statusCounts: statusCountsFromMap(statusMap, ids) };
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
    // Only the two touched books re-tessellate — a BOOK move flips cell ownership without
    // changing the pass's Voronoi diagram, so every other book's shape is still exact. (A
    // COORDINATE move does change it — the pin-move writer also recomputes the books whose
    // stored shape contains the new point; services/turf/rehullAfterPinMove.js.)
    const movedTurfIds = [String(to._id)];
    if (from && String(from._id) !== String(to._id)) movedTurfIds.push(String(from._id));
    await recomputePassTerritories(to.passId, { onlyTurfIds: movedTurfIds });
    // Body ids don't trigger the :householdId param hook; tag for the staff-access log.
    addAuditSubjects(res, 'household', [String(householdId)]);
    res.json({
      from: from && String(from._id) !== String(to._id) ? { id: String(from._id), doorCount: from.doorCount } : null,
      to: { id: String(to._id), doorCount: to.doorCount },
    });
  } catch (err) {
    next(err);
  }
});

// Move many households (every unit of an apartment building, or a whole lassoed map
// selection) into one book at once — pull them out of any other book in the pass, then
// recompute territories a single time. Mirrors /move-door for the bulk case. The target
// is EITHER an existing book (`toTurfId`) or a brand-new one (`newBook: { passId, name? }`)
// made from the moved doors themselves — born published when the round already has
// accepted books (instantly assignable mid-round), draft while the pass is still being
// cut. `from` reports every donor that lost doors so the client can offer to delete the
// ones the move emptied; nothing is deleted here.
router.post('/move-doors', async (req, res, next) => {
  try {
    const { toTurfId, newBook } = req.body || {};
    const ids = parseHouseholdIds(req.body?.householdIds);
    if (!ids) return res.status(400).json({ error: 'householdIds required (1–1000)' });
    if ((toTurfId ? 1 : 0) + (newBook ? 1 : 0) !== 1) {
      return res.status(400).json({ error: 'exactly one of toTurfId or newBook required' });
    }

    let to = null;
    let passId;
    if (toTurfId) {
      if (!mongoose.isValidObjectId(toTurfId)) return res.status(400).json({ error: 'invalid toTurfId' });
      // A legacy archived merge stub keeps stale householdIds naming doors live books own —
      // appending into one would corrupt the pass, so a stub is never a target.
      to = await Turf.findOne({ _id: toTurfId, campaignId: req.campaign._id, status: { $ne: 'archived' } });
      if (!to) return res.status(404).json({ error: 'Target book not found' });
      passId = to.passId;
    } else {
      if (!mongoose.isValidObjectId(newBook?.passId)) return res.status(400).json({ error: 'newBook.passId required' });
      passId = new mongoose.Types.ObjectId(String(newBook.passId));
    }

    const pass = await Pass.findOne({ _id: passId, campaignId: req.campaign._id }, { effortId: 1, status: 1 }).lean();
    if (!pass) {
      return to
        ? res.status(409).json({ error: 'That book’s pass no longer exists.' })
        : res.status(404).json({ error: 'Pass not found' });
    }
    if (pass.status === 'archived') {
      return res.status(409).json({
        error: 'That round is archived — its books never reach a canvasser.',
        code: 'pass-archived',
      });
    }

    // Disjointness: a book may only hold doors owned by the book's effort. And only doors
    // this campaign owns AT ALL — recomputeTurf's mirror write is unscoped, so a foreign
    // campaign's id must never reach the target's householdIds; unknown ids drop silently.
    const moving = await Household.find({ _id: { $in: ids }, campaignId: req.campaign._id }, { effortId: 1 }).lean();
    const foreign = moving.filter((h) => String(h.effortId) !== String(pass.effortId)).length;
    if (foreign) {
      return res.status(409).json({ error: `${foreign} door(s) belong to a different effort and cannot be moved into this book.` });
    }
    if (!moving.length) return res.status(404).json({ error: 'No matching doors in this campaign.' });
    const movingIds = moving.map((h) => h._id);

    const idSet = new Set(movingIds.map(String));
    const changedTurfIds = []; // donors that actually lost a door; the target joins at the end
    const from = [];
    const donorQuery = { campaignId: req.campaign._id, passId };
    if (to) donorQuery._id = { $ne: to._id };
    const others = await Turf.find(donorQuery);
    for (const t of others) {
      const before = t.householdIds.length;
      t.householdIds = t.householdIds.filter((id) => !idSet.has(String(id)));
      if (t.householdIds.length !== before) {
        await recomputeTurf(t);
        changedTurfIds.push(String(t._id));
        // Stubs are stripped like always but never offered for deletion (DELETE refuses them).
        if (t.status !== 'archived') {
          from.push({ id: String(t._id), name: t.name, doorCount: t.doorCount, emptied: t.doorCount === 0 });
        }
      }
    }

    let created = false;
    if (to) {
      const have = new Set(to.householdIds.map(String));
      for (const id of movingIds) if (!have.has(String(id))) to.householdIds.push(id);
    } else {
      // Born published iff the round already has accepted books (a mid-round add goes
      // straight to the crew); otherwise a draft that rides the normal Accept with the cut.
      const hasPublished = await Turf.exists({ campaignId: req.campaign._id, passId, status: 'published' });
      to = new Turf({
        organizationId: req.campaign.organizationId,
        campaignId: req.campaign._id,
        passId,
        name: (newBook.name && String(newBook.name).trim()) || 'New book',
        mode: 'manual',
        params: {},
        householdIds: movingIds,
        doorCount: movingIds.length,
        status: hasPublished ? 'published' : 'draft',
        generatedBy: req.user._id,
      });
      created = true;
    }
    await recomputeTurf(to); // saves the new book too — first write it gets
    await recomputePassTerritories(passId, { onlyTurfIds: [...changedTurfIds, String(to._id)] });
    // Body ids don't trigger the :householdId param hook; tag them for the staff-access log.
    addAuditSubjects(res, 'household', movingIds.map(String));
    res.json({
      to: { id: String(to._id), doorCount: to.doorCount, name: to.name, status: to.status, created },
      from,
    });
  } catch (err) {
    next(err);
  }
});

// Merge >=2 books (same pass) into one survivor; absorbed books are hard-deleted and
// their assignments folded into the survivor. Survivor = `primaryTurfId` when given
// (the "move these books into that one" case), else DB order of the $in — NOT request
// order — which is fine when any survivor will do (the panel's plain Merge).
router.post('/merge', async (req, res, next) => {
  try {
    const { turfIds, primaryTurfId } = req.body || {};
    const ids = (turfIds || []).filter((x) => mongoose.isValidObjectId(x));
    if (ids.length < 2) return res.status(400).json({ error: 'turfIds (>=2) required' });
    // Archived merge stubs hold stale householdIds naming doors live books own — unioning
    // one in would steal those doors from their real book, so stubs never merge.
    const turfs = await Turf.find({ _id: { $in: ids }, campaignId: req.campaign._id, status: { $ne: 'archived' } });
    if (turfs.length < 2) return res.status(404).json({ error: 'books not found' });
    const passId = String(turfs[0].passId);
    if (!turfs.every((t) => String(t.passId) === passId)) {
      return res.status(400).json({ error: 'books must be in the same pass' });
    }
    if (primaryTurfId != null) {
      const i = turfs.findIndex((t) => String(t._id) === String(primaryTurfId));
      if (i < 0) return res.status(400).json({ error: 'primaryTurfId must be one of turfIds' });
      if (i > 0) turfs.unshift(...turfs.splice(i, 1));
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
    // Absorbed doors flip ownership to primary; every other book's shape is still exact.
    await recomputePassTerritories(primary.passId, { onlyTurfIds: [String(primary._id)] });
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
    await recomputePassTerritories(src.passId, { onlyTurfIds: [String(src._id), String(newTurf._id)] });
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

// Delete a single DRAFT book — surgical cleanup (e.g. one unwanted supplemental
// book) — or an accepted book a bulk move has EMPTIED (zero members, probed live
// off householdIds, never the denormalized doorCount): with no doors left there is
// no field history to strand, only dead-weight assignments, which are cleared.
// Every other accepted book can only be removed via Discard (snapshot +
// type-confirm); a draft carries no assignments (both assign routes 409
// `not-accepted`) and no FIELD history keyed to it, so this only has to clear the
// household mirror. Single-home desk marks may carry this book's id as provenance
// only — nothing reads it for counts/undo (deskRestrict.js keys by passId +
// current membership); they survive as loose-door marks and count under the
// door's next book. NO re-tessellation: removing a book's doors only GROWS the
// neighbors' Voronoi entitlement, so every other stored shape stays disjoint and
// containing (same invariant the onlyTurfIds notes in generateTurf.js rely on).
// Lock-guarded so a supplemental/claim job re-tessellating this pass can't race
// the delete.
router.delete('/:turfId', async (req, res, next) => {
  const { turfId } = req.params;
  let lockPassId = null;
  try {
    if (!mongoose.isValidObjectId(turfId)) return res.status(400).json({ error: 'invalid turfId' });
    const turf = await Turf.findOne(
      { _id: turfId, campaignId: req.campaign._id },
      { status: 1, passId: 1, householdIds: { $slice: 1 } }
    ).lean();
    if (!turf) return res.status(404).json({ error: 'Book not found' });
    const emptyPublished = turf.status === 'published' && !(turf.householdIds || []).length;
    if (turf.status !== 'draft' && !emptyPublished) {
      return res.status(409).json({ error: 'Accepted books can only be removed with Discard.', code: 'not-draft' });
    }
    if (!(await acquireRecutLock(turf.passId, req.user._id))) {
      return res.status(409).json({ error: 'A re-cut or restore is in progress on this pass. Try again shortly.' });
    }
    lockPassId = turf.passId;
    await TurfAssignment.deleteMany({ turfId: turf._id }); // load-bearing for an emptied published book; belt-and-braces for drafts
    await Household.updateMany({ turfId: turf._id }, { $set: { turfId: null, walkOrder: null } });
    await Turf.deleteOne({ _id: turf._id });
    res.json({ deleted: 1 });
  } catch (err) {
    next(err);
  } finally {
    if (lockPassId) await releaseRecutLock(lockPassId);
  }
});

export default router;
