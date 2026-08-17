import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireCampaignManager } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { NOT_DELETING } from '../../services/campaigns/deletionState.js';
import { Effort } from '../../models/Effort.js';
import { EffortMember } from '../../models/EffortMember.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { Household } from '../../models/Household.js';
import { SavedSearch } from '../../models/SavedSearch.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { canManageSurvey } from '../../services/authz/campaignManagement.js';
import { resolveClaimTargets, previewClaimConflicts } from '../../services/walklist/claimDoors.js';
import { getQueue, QUEUE_NAMES } from '../../queues/index.js';
import { deriveEffortSetup } from '../../services/reports/effortSetupSteps.js';
import { createNextPass } from '../../services/passes/createPass.js';
import { partitionAssignable } from '../../services/campaignRoster.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireCampaignManager);

// Queue calls are time-bounded: ioredis buffers commands while disconnected, so without
// this a wedged/absent Redis would HANG the request rather than failing it — the 503 path
// below would be unreachable exactly when it matters (the campaigns-delete enqueue pattern).
const queueOp = (promise, ms = Number(process.env.TURF_ENQUEUE_TIMEOUT_MS || 5000)) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('queue timeout')), ms).unref?.()),
  ]);

// Enqueue a claim job on the TURF queue (shared by the claim endpoint and effort-create
// seeding). attempts: 1 — a claim that genuinely fails mid-move must surface to the admin
// rather than silently re-run; the pre-mutation 'move' snapshot is the recovery, and the
// one stall-redelivery BullMQ still allows is safe (executeClaim is ownership-keyed).
const enqueueClaim = ({ campaignId, effortId, walkListId, all, force, requestedBy }) =>
  queueOp(
    getQueue(QUEUE_NAMES.TURF).add(
      'claim',
      {
        campaignId: String(campaignId),
        effortId: String(effortId),
        walkListId: walkListId ? String(walkListId) : null,
        all: !!all,
        force: !!force,
        requestedBy: String(requestedBy),
      },
      { attempts: 1 }
    )
  );

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

async function loadEffort(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid effortId' });
    const effort = await Effort.findOne({ _id: req.params.id, campaignId: req.campaign._id });
    if (!effort) return res.status(404).json({ error: 'Walk list not found' });
    req.effort = effort;
    next();
  } catch (err) {
    next(err);
  }
}

// List efforts with door counts, active round, roster size. Plus the campaign's
// Intake count (households owned by no effort).
router.get('/', async (req, res, next) => {
  try {
    const cId = req.campaign._id;
    const efforts = await Effort.find({ campaignId: cId }).sort({ createdAt: 1 }).lean();
    // All passes (not just active) — active drives crew; the full set drives the
    // per-effort readiness rollup (round/books/assigned across any pass status).
    const passes = await Pass.find(
      { campaignId: cId },
      { effortId: 1, roundNumber: 1, name: 1, status: 1 }
    ).lean();
    const activeRounds = passes.filter((p) => p.status === 'active');
    const activePassIds = activeRounds.map((p) => p._id);
    const passToEffort = new Map(activeRounds.map((p) => [String(p._id), String(p.effortId)]));
    const passToEffortAll = new Map(passes.map((p) => [String(p._id), String(p.effortId)]));
    const passCountByEffort = new Map();
    for (const p of passes) {
      const k = String(p.effortId);
      passCountByEffort.set(k, (passCountByEffort.get(k) || 0) + 1);
    }
    const activeEffortIds = new Set(activeRounds.map((p) => String(p.effortId)));

    // "Crew" is DERIVED: manual roster members ∪ canvassers assigned to the
    // effort's active round's books. So it always reflects who's actually working
    // and self-corrects on unassign / re-carve (no stored sync needed).
    const [doorCounts, memberSets, assignSets, intakeCount, pubTurfAgg, assignAgg, respAgg] = await Promise.all([
      Household.aggregate([
        { $match: { campaignId: cId, isActive: true, effortId: { $ne: null } } },
        { $group: { _id: '$effortId', n: { $sum: 1 } } },
      ]),
      EffortMember.aggregate([
        { $match: { campaignId: cId } },
        { $group: { _id: '$effortId', users: { $addToSet: '$userId' } } },
      ]),
      activePassIds.length
        ? TurfAssignment.aggregate([
            { $match: { passId: { $in: activePassIds } } },
            { $group: { _id: '$passId', users: { $addToSet: '$userId' } } },
          ])
        : Promise.resolve([]),
      Household.countDocuments({ campaignId: cId, isActive: true, effortId: null }),
      // Readiness rollup: published books + assignments per pass (any status),
      // folded up to the effort below via passToEffortAll.
      Turf.aggregate([
        { $match: { campaignId: cId, status: 'published' } },
        { $group: { _id: '$passId', n: { $sum: 1 } } },
      ]),
      TurfAssignment.aggregate([
        { $match: { campaignId: cId } },
        { $group: { _id: '$passId', n: { $sum: 1 } } },
      ]),
      // Survey responses per walk list (effortId indexed). The null bucket = responses
      // on Intake / pre-effort doors — those always use the campaign's default survey.
      SurveyResponse.aggregate([
        { $match: { campaignId: cId } },
        { $group: { _id: '$effortId', n: { $sum: 1 } } },
      ]),
    ]);

    const doorMap = new Map(doorCounts.map((d) => [String(d._id), d.n]));
    const respMap = new Map();
    let intakeResponseCount = 0;
    for (const r of respAgg) {
      if (r._id == null) intakeResponseCount = r.n;
      else respMap.set(String(r._id), r.n);
    }
    const activeMap = new Map(activeRounds.map((p) => [String(p.effortId), p]));
    const rollUp = (agg) => {
      const m = new Map();
      for (const r of agg) {
        const eff = passToEffortAll.get(String(r._id));
        if (eff) m.set(eff, (m.get(eff) || 0) + r.n);
      }
      return m;
    };
    const pubByEffort = rollUp(pubTurfAgg);
    const assignByEffort = rollUp(assignAgg);
    const crewByEffort = new Map(); // effortId -> Set(userId)
    for (const m of memberSets) crewByEffort.set(String(m._id), new Set(m.users.map(String)));
    for (const a of assignSets) {
      const effId = passToEffort.get(String(a._id));
      if (!effId) continue;
      const set = crewByEffort.get(effId) || new Set();
      for (const u of a.users) set.add(String(u));
      crewByEffort.set(effId, set);
    }

    res.json({
      efforts: efforts.map((e) => {
        const k = String(e._id);
        return {
          ...e,
          doorCount: doorMap.get(k) || 0,
          crewCount: crewByEffort.get(k)?.size || 0,
          crewUserIds: [...(crewByEffort.get(k) || [])],
          responseCount: respMap.get(k) || 0,
          activeRound: activeMap.get(k) || null,
          setup: deriveEffortSetup({
            doorCount: doorMap.get(k) || 0,
            passes: passCountByEffort.get(k) || 0,
            publishedTurfs: pubByEffort.get(k) || 0,
            assignments: assignByEffort.get(k) || 0,
            hasActivePass: activeEffortIds.has(k),
          }),
        };
      }),
      intakeCount,
      intakeResponseCount,
    });
  } catch (err) {
    next(err);
  }
});

// Create an effort. Optionally seed its door-set from a walk list (claims that
// list's Intake households) — see /:id/claim for the full claim/re-carve flow.
// Resolve + authorize a walk-list survey override. Returns { value } (null = no
// override) or { error: true } with the response already sent. Lit-drop campaigns
// never carry one (mirrors the Campaign type rule); the id is validated org-scoped
// (it used to be stored verbatim, garbage included) and gated by canManageSurvey so
// a lead can only point a walk list at a survey they authored or already run.
async function resolveOverrideTemplate(req, res, surveyTemplateId) {
  if (req.campaign.type !== 'survey' || !surveyTemplateId) return { value: null };
  if (!mongoose.isValidObjectId(surveyTemplateId)) {
    res.status(400).json({ error: 'Invalid surveyTemplateId.' });
    return { error: true };
  }
  const tmpl = await SurveyTemplate.findOne({
    _id: surveyTemplateId,
    organizationId: req.campaign.organizationId,
  });
  if (!tmpl) {
    res.status(400).json({ error: 'Survey template not found in this org.' });
    return { error: true };
  }
  if (!(await canManageSurvey(req, tmpl))) {
    res.status(403).json({
      error: 'You can only attach a survey you authored or one already attached to a campaign you manage.',
      code: 'survey-out-of-scope',
    });
    return { error: true };
  }
  return { value: tmpl._id };
}

router.post('/', async (req, res, next) => {
  try {
    const { name, surveyTemplateId, seedWalkListId, claimAllIntake } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const tpl = await resolveOverrideTemplate(req, res, surveyTemplateId);
    if (tpl.error) return;
    // The creator picks ONE door source. "All remaining (Intake)" wins over a saved-search
    // seed if both somehow arrive, so we never both claim-all and seed.
    const seedId = !claimAllIntake && seedWalkListId && mongoose.isValidObjectId(seedWalkListId) ? seedWalkListId : null;
    // Validate the seed BEFORE creating anything — enqueueing a doomed claim job would
    // leave a confusing failed job where a plain 400 says what's wrong.
    if (seedId && !(await SavedSearch.exists({ _id: seedId, campaignId: req.campaign._id }))) {
      return res.status(400).json({ error: 'Saved search not found in this campaign.' });
    }
    const effort = await Effort.create({
      organizationId: req.campaign.organizationId,
      campaignId: req.campaign._id,
      name: String(name).trim(),
      surveyTemplateId: tpl.value,
      seededFromWalkListId: seedId,
      status: 'active',
      createdBy: req.user._id,
    });
    // Every walk list starts its first pass automatically, so the common path skips the
    // create-and-name-a-pass step. Best-effort — a hiccup here must not fail effort creation
    // (the admin can add Pass 1 from the walk list's Passes panel).
    let pass = null;
    try {
      pass = await createNextPass({
        organizationId: req.campaign.organizationId,
        campaignId: req.campaign._id,
        effortId: effort._id,
        userId: req.user._id,
      });
    } catch { /* non-fatal: Pass 1 can be created manually */ }
    // Seed the new walk list's doors via the same queued claim job the claim endpoint
    // uses — the old inline Intake-claim here was a second copy of that logic that could
    // drift (and at 25k doors, outlive the request). force:false — create-time seeding
    // claims Intake only and never moves another list's doors (executeClaim skips owned).
    // On enqueue failure the list is merely UNSEEDED, never half-created: return 201 with
    // claimError and let the admin claim from the walk list's Claim panel.
    let claimJobId = null;
    let claimError = null;
    if (claimAllIntake || seedId) {
      try {
        const job = await enqueueClaim({
          campaignId: req.campaign._id,
          effortId: effort._id,
          walkListId: seedId,
          all: !!claimAllIntake,
          force: false,
          requestedBy: req.user._id,
        });
        claimJobId = String(job.id);
      } catch (err) {
        console.error('[efforts] create-seed enqueue failed:', err?.message || err);
        claimError = 'queue-unavailable';
      }
    }
    res.status(201).json({ effort, pass, claimJobId, claimError });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', loadEffort, async (req, res, next) => {
  try {
    const { name, surveyTemplateId } = req.body || {};
    if (name) req.effort.name = String(name).trim();
    if (surveyTemplateId !== undefined) {
      const tpl = await resolveOverrideTemplate(req, res, surveyTemplateId);
      if (tpl.error) return;
      req.effort.surveyTemplateId = tpl.value;
    }
    await req.effort.save();
    res.json({ effort: req.effort });
  } catch (err) {
    next(err);
  }
});

// Claim households into this effort (materialize Household.effortId).
//   body: { walkListId?, all?: true, force?: false }
// Targets = a walk list's households, or (all:true) every Intake (unowned) door.
// A walk-list claim may include doors owned by ANOTHER effort — without force those
// come back as a 409 with a per-donor-list breakdown (doors lost, books affected,
// books emptied) so the confirm modal can state the real stakes. With force, the
// move is ENQUEUED on the TURF queue and this returns 202 {jobId} — at 24k doors
// the old inline re-carve outlived Heroku's 30s router timeout (the client saw a
// 503 while the server kept moving doors) and took no lock against a concurrent
// cut. The job snapshots every donor pass before mutating (one-click undo), holds
// the per-pass recut lock, and reports progress on GET /turfs/jobs/:jobId.
// "Claim all Intake" only ever touches unowned doors, so it never conflicts.
router.post('/:id/claim', loadEffort, async (req, res, next) => {
  try {
    const { walkListId, all, force } = req.body || {};
    if (walkListId && !mongoose.isValidObjectId(walkListId)) {
      return res.status(400).json({ error: 'Invalid walkListId' });
    }

    let targets;
    try {
      targets = await resolveClaimTargets({
        campaignId: req.campaign._id,
        effortId: req.effort._id,
        walkListId,
        all,
      });
    } catch (err) {
      if (err.code === 'walklist-not-found') return res.status(404).json({ error: 'Saved search not found' });
      if (err.code === 'bad-claim-request') return res.status(400).json({ error: 'Provide walkListId or all:true' });
      throw err;
    }
    const { intake, owned } = targets;

    if (owned.length && !force) {
      const preview = await previewClaimConflicts({ owned });
      return res.status(409).json({
        error: `${owned.length} door(s) are already in another effort. Re-send with force:true to move them here.`,
        code: 'doors-owned',
        conflicts: owned.length,
        claimable: intake.length,
        ...preview,
      });
    }

    // Nothing would move — answer now instead of parking a no-op job on the queue.
    if (!intake.length && !(force && owned.length)) {
      return res.json({ jobId: null, claimable: 0, conflicts: 0 });
    }

    try {
      const job = await enqueueClaim({
        campaignId: req.campaign._id,
        effortId: req.effort._id,
        walkListId,
        all,
        force,
        requestedBy: req.user._id,
      });
      return res.status(202).json({ jobId: String(job.id), claimable: intake.length, conflicts: owned.length });
    } catch (err) {
      console.error('[efforts] claim enqueue failed:', err?.message || err);
      return res.status(503).json({ error: 'Could not queue the move — try again in a moment.', code: 'queue-unavailable' });
    }
  } catch (err) {
    next(err);
  }
});

// Intake: households owned by no effort (new-address imports awaiting assignment).
router.get('/intake', async (req, res, next) => {
  try {
    const cId = req.campaign._id;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
    const [count, households] = await Promise.all([
      Household.countDocuments({ campaignId: cId, isActive: true, effortId: null }),
      Household.find(
        { campaignId: cId, isActive: true, effortId: null },
        { addressLine1: 1, addressLine2: 1, city: 1, state: 1, zipCode: 1, location: 1, createdAt: 1 }
      ).sort({ createdAt: -1 }).limit(limit).lean(),
    ]);
    res.json({ count, households });
  } catch (err) {
    next(err);
  }
});

// Roster.
// The effort's crew = manual roster members (pre-staged) ∪ canvassers assigned
// to its active round's books. Each entry flags how they're on the crew so the UI
// can tag them and only offer to remove the manual-only ones.
router.get('/:id/members', loadEffort, async (req, res, next) => {
  try {
    const activePass = await Pass.findOne(
      { effortId: req.effort._id, status: 'active' },
      { _id: 1 }
    ).lean();
    const [roster, assigned] = await Promise.all([
      EffortMember.find({ effortId: req.effort._id })
        .populate('userId', 'firstName lastName email')
        .lean(),
      activePass
        ? TurfAssignment.find({ passId: activePass._id })
            .populate('userId', 'firstName lastName email')
            .lean()
        : Promise.resolve([]),
    ]);

    const byUser = new Map(); // userId -> { user, viaRoster, viaAssignment }
    const upsert = (u, key) => {
      if (!u) return;
      const id = String(u._id);
      const entry = byUser.get(id) || { user: { id, firstName: u.firstName, lastName: u.lastName, email: u.email }, viaRoster: false, viaAssignment: false };
      entry[key] = true;
      byUser.set(id, entry);
    };
    for (const m of roster) upsert(m.userId, 'viaRoster');
    for (const a of assigned) upsert(a.userId, 'viaAssignment');

    res.json({ crew: [...byUser.values()] });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/members', loadEffort, async (req, res, next) => {
  try {
    const { userId } = req.body || {};
    if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ error: 'userId is required' });
    // Pre-staging is limited to the campaign team (or an org admin) — mirrors book assignment.
    const { allowed } = await partitionAssignable({
      campaignId: req.campaign._id,
      organizationId: req.campaign.organizationId,
      userIds: [userId],
    });
    if (!allowed.length) return res.status(409).json({ error: 'Add them to the campaign team first.', code: 'not-on-team' });
    const doc = await EffortMember.findOneAndUpdate(
      { effortId: req.effort._id, userId },
      {
        $setOnInsert: {
          organizationId: req.campaign.organizationId,
          campaignId: req.campaign._id,
          effortId: req.effort._id,
          userId,
          addedBy: req.user._id,
        },
      },
      { upsert: true, new: true }
    );
    res.status(201).json({ member: doc });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/members/:userId', loadEffort, async (req, res, next) => {
  try {
    await EffortMember.deleteOne({ effortId: req.effort._id, userId: req.params.userId });
    res.json({ deleted: 1 });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/archive', loadEffort, async (req, res, next) => {
  try {
    req.effort.status = 'archived';
    await req.effort.save();
    res.json({ effort: req.effort });
  } catch (err) {
    next(err);
  }
});

// Delete a draft effort: release its doors back to Intake first; refuse if it has
// any non-draft rounds (history would dangle).
router.delete('/:id', loadEffort, async (req, res, next) => {
  try {
    const liveRounds = await Pass.countDocuments({ effortId: req.effort._id, status: { $ne: 'draft' } });
    if (liveRounds) {
      return res.status(400).json({ error: 'Walk list has active/archived passes; archive it instead of deleting.' });
    }
    const passIds = (await Pass.find({ effortId: req.effort._id }, { _id: 1 }).lean()).map((p) => p._id);
    // Draft-rounds-only is NOT proof of no history — the ledger is the authority
    // (2026-08 incident): knocks recorded while doors sat in this list carry its
    // effortId (resolveAttribution stamps the owner at write time, mobile/canvass.js),
    // and deleting the doc orphans those rows into the by-pass report's
    // "Legacy / no pass" bucket. Archiving keeps the name resolvable forever.
    const ledgerRef = {
      $or: [
        { effortId: req.effort._id },
        ...(passIds.length ? [{ passId: { $in: passIds } }] : []),
      ],
    };
    const [hasKnocks, hasResponses] = await Promise.all([
      CanvassActivity.exists(ledgerRef),
      SurveyResponse.exists(ledgerRef),
    ]);
    if (hasKnocks || hasResponses) {
      return res.status(400).json({
        error: 'Walk list has recorded door history (knocks or survey answers reference it); archive it instead of deleting.',
        code: 'has-history',
      });
    }
    await Household.updateMany({ campaignId: req.campaign._id, effortId: req.effort._id }, { $set: { effortId: null, turfId: null, walkOrder: null } });
    // Remove the effort's (draft) rounds AND their books + assignments so nothing dangles.
    if (passIds.length) {
      await Turf.deleteMany({ passId: { $in: passIds } });
      await TurfAssignment.deleteMany({ passId: { $in: passIds } });
    }
    await Pass.deleteMany({ effortId: req.effort._id }); // draft rounds only
    await EffortMember.deleteMany({ effortId: req.effort._id });
    await Effort.deleteOne({ _id: req.effort._id });
    res.json({ deleted: 1 });
  } catch (err) {
    next(err);
  }
});

export default router;
