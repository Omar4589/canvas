import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { Effort } from '../../models/Effort.js';
import { EffortMember } from '../../models/EffortMember.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { Household } from '../../models/Household.js';
import { WalkList } from '../../models/WalkList.js';
import { Membership } from '../../models/Membership.js';
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

async function loadEffort(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid effortId' });
    const effort = await Effort.findOne({ _id: req.params.id, campaignId: req.campaign._id });
    if (!effort) return res.status(404).json({ error: 'Effort not found' });
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
    const activeRounds = await Pass.find(
      { campaignId: cId, status: 'active' },
      { effortId: 1, roundNumber: 1, name: 1 }
    ).lean();
    const activePassIds = activeRounds.map((p) => p._id);
    const passToEffort = new Map(activeRounds.map((p) => [String(p._id), String(p.effortId)]));

    // "Crew" is DERIVED: manual roster members ∪ canvassers assigned to the
    // effort's active round's books. So it always reflects who's actually working
    // and self-corrects on unassign / re-carve (no stored sync needed).
    const [doorCounts, memberSets, assignSets, intakeCount] = await Promise.all([
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
    ]);

    const doorMap = new Map(doorCounts.map((d) => [String(d._id), d.n]));
    const activeMap = new Map(activeRounds.map((p) => [String(p.effortId), p]));
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
      efforts: efforts.map((e) => ({
        ...e,
        doorCount: doorMap.get(String(e._id)) || 0,
        crewCount: crewByEffort.get(String(e._id))?.size || 0,
        crewUserIds: [...(crewByEffort.get(String(e._id)) || [])],
        activeRound: activeMap.get(String(e._id)) || null,
      })),
      intakeCount,
    });
  } catch (err) {
    next(err);
  }
});

// Create an effort. Optionally seed its door-set from a walk list (claims that
// list's Intake households) — see /:id/claim for the full claim/re-carve flow.
router.post('/', async (req, res, next) => {
  try {
    const { name, surveyTemplateId, seedWalkListId } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const effort = await Effort.create({
      organizationId: req.campaign.organizationId,
      campaignId: req.campaign._id,
      name: String(name).trim(),
      // Lit-drop campaigns never carry a survey (mirrors Campaign type rule).
      surveyTemplateId:
        req.campaign.type === 'survey' && surveyTemplateId ? surveyTemplateId : null,
      seededFromWalkListId: seedWalkListId && mongoose.isValidObjectId(seedWalkListId) ? seedWalkListId : null,
      status: 'active',
      createdBy: req.user._id,
    });
    // Optional immediate seed from a walk list (Intake-only claim).
    if (effort.seededFromWalkListId) {
      const wl = await WalkList.findOne({ _id: effort.seededFromWalkListId, campaignId: req.campaign._id }, { householdIds: 1 }).lean();
      if (wl?.householdIds?.length) {
        await Household.updateMany(
          { _id: { $in: wl.householdIds }, campaignId: req.campaign._id, effortId: null },
          { $set: { effortId: effort._id } }
        );
      }
    }
    res.status(201).json({ effort });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', loadEffort, async (req, res, next) => {
  try {
    const { name, surveyTemplateId } = req.body || {};
    if (name) req.effort.name = String(name).trim();
    if (surveyTemplateId !== undefined) {
      req.effort.surveyTemplateId =
        req.campaign.type === 'survey' && surveyTemplateId ? surveyTemplateId : null;
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
// A walk-list claim may include doors owned by ANOTHER effort — those are returned as
// `conflicts` unless force:true (the re-carve path), which also pulls them out of their
// old effort's books so they re-cut cleanly here. "Claim all Intake" only ever touches
// unowned doors, so it never conflicts.
router.post('/:id/claim', loadEffort, async (req, res, next) => {
  try {
    const { walkListId, all, force } = req.body || {};
    const cId = req.campaign._id;

    let idFilter;
    if (walkListId) {
      if (!mongoose.isValidObjectId(walkListId)) return res.status(400).json({ error: 'Invalid walkListId' });
      const wl = await WalkList.findOne({ _id: walkListId, campaignId: cId }, { householdIds: 1 }).lean();
      if (!wl) return res.status(404).json({ error: 'Walk list not found' });
      idFilter = { _id: { $in: wl.householdIds || [] } };
    } else if (all) {
      idFilter = { effortId: null }; // Intake (unowned) doors only — never another effort's doors
    } else {
      return res.status(400).json({ error: 'Provide walkListId or all:true' });
    }

    const targets = await Household.find(
      { campaignId: cId, isActive: true, ...idFilter },
      { _id: 1, effortId: 1, turfId: 1 }
    ).lean();

    const intake = targets.filter((h) => !h.effortId);
    const owned = targets.filter((h) => h.effortId && String(h.effortId) !== String(req.effort._id));

    if (owned.length && !force) {
      return res.status(409).json({
        error: `${owned.length} door(s) are already in another effort. Re-send with force:true to move them here.`,
        code: 'doors-owned',
        conflicts: owned.length,
        claimable: intake.length,
      });
    }

    // Claim Intake doors outright.
    if (intake.length) {
      await Household.updateMany(
        { _id: { $in: intake.map((h) => h._id) } },
        { $set: { effortId: req.effort._id } }
      );
    }

    // Re-carve: move owned doors here and pull them from their old books.
    let recutBooks = 0;
    if (owned.length && force) {
      const ownedIds = owned.map((h) => h._id);
      await Household.updateMany(
        { _id: { $in: ownedIds } },
        { $set: { effortId: req.effort._id, turfId: null, walkOrder: null } }
      );
      const affectedTurfIds = [...new Set(owned.filter((h) => h.turfId).map((h) => String(h.turfId)))];
      const ownedSet = new Set(ownedIds.map(String));
      for (const tid of affectedTurfIds) {
        const turf = await Turf.findById(tid);
        if (!turf) continue;
        turf.householdIds = turf.householdIds.filter((id) => !ownedSet.has(String(id)));
        await recomputeTurf(turf);
        recutBooks += 1;
      }
    }

    res.json({ claimed: intake.length + (force ? owned.length : 0), reassigned: force ? owned.length : 0, recutBooks });
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
    // Must be an active member of the org.
    const member = await Membership.exists({ organizationId: req.campaign.organizationId, userId, isActive: true });
    if (!member) return res.status(400).json({ error: 'User is not an active org member' });
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
      return res.status(400).json({ error: 'Effort has active/archived rounds; archive it instead of deleting.' });
    }
    await Household.updateMany({ campaignId: req.campaign._id, effortId: req.effort._id }, { $set: { effortId: null, turfId: null, walkOrder: null } });
    // Remove the effort's (draft) rounds AND their books + assignments so nothing dangles.
    const passIds = (await Pass.find({ effortId: req.effort._id }, { _id: 1 }).lean()).map((p) => p._id);
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
