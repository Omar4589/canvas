import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireOrgMember } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { Turf } from '../../models/Turf.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { VoterNote } from '../../models/VoterNote.js';
import { buildVoterProfile } from '../../services/voters/voterProfile.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgMember);

function activeOrgId(req) {
  return req.activeOrg?._id;
}
function isAdminOrSuper(req) {
  return req.user.isSuperAdmin || req.activeMembership?.role === 'admin';
}
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Campaign comes from ?campaignId / body.campaignId; canvassers must be assigned to it.
async function resolveCampaign(req, res) {
  const cid = req.query.campaignId || req.body?.campaignId;
  if (!activeOrgId(req)) {
    res.status(400).json({ error: 'Active organization required (X-Org-Id header)' });
    return null;
  }
  if (!mongoose.isValidObjectId(cid)) {
    res.status(400).json({ error: 'campaignId required' });
    return null;
  }
  const campaign = await Campaign.findOne({ _id: cid, organizationId: activeOrgId(req) }).lean();
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return null;
  }
  if (!isAdminOrSuper(req)) {
    const assigned = await CampaignAssignment.exists({ campaignId: campaign._id, userId: req.user._id });
    if (!assigned) {
      res.status(403).json({ error: 'Not assigned to this campaign' });
      return null;
    }
  }
  return campaign;
}

// Household ids a canvasser may look up: their assigned books on the active pass.
// null = no restriction (admin/super). Empty array = sees nothing.
async function scopeHouseholdIds(req, campaign) {
  if (isAdminOrSuper(req)) return null;
  const passId = campaign.activePassId;
  if (!passId) return [];
  const myTurfs = await TurfAssignment.find(
    { userId: req.user._id, campaignId: campaign._id, passId },
    { turfId: 1 }
  ).lean();
  if (!myTurfs.length) return [];
  const books = await Turf.find({ _id: { $in: myTurfs.map((a) => a.turfId) } }, { householdIds: 1 }).lean();
  return [...new Set(books.flatMap((b) => (b.householdIds || []).map(String)))];
}

async function campaignHouseholdIds(req, campaign, scope) {
  const filter = { organizationId: activeOrgId(req), campaignId: campaign._id };
  if (scope) filter._id = { $in: scope.map((id) => new mongoose.Types.ObjectId(id)) };
  return (await Household.find(filter, '_id').lean()).map((h) => h._id);
}

// GET /mobile/voters?campaignId=&search= — campaign-scoped search (read).
router.get('/voters', async (req, res, next) => {
  try {
    const campaign = await resolveCampaign(req, res);
    if (!campaign) return;
    const orgId = activeOrgId(req);
    const scope = await scopeHouseholdIds(req, campaign);
    if (Array.isArray(scope) && scope.length === 0) return res.json({ voters: [] });

    const campHhIds = await campaignHouseholdIds(req, campaign, scope);
    const voterFilter = { organizationId: orgId, householdId: { $in: campHhIds } };

    const search = (req.query.search || '').trim();
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      const addrHh = (
        await Household.find(
          { _id: { $in: campHhIds }, $or: [{ addressLine1: rx }, { city: rx }, { zipCode: rx }] },
          '_id'
        )
          .limit(2000)
          .lean()
      ).map((h) => h._id);
      voterFilter.$or = [{ fullName: rx }, { stateVoterId: search }, { householdId: { $in: addrHh } }];
    }

    const rows = await Voter.find(voterFilter).sort({ lastName: 1, firstName: 1 }).limit(50).lean();
    const households = await Household.find(
      { _id: { $in: rows.map((v) => v.householdId) } },
      'addressLine1 city state'
    ).lean();
    const hMap = new Map(households.map((h) => [String(h._id), h]));
    const votedSet = new Set(
      (await VotedVoter.find({ campaignId: campaign._id, voterId: { $in: rows.map((v) => v._id) } }, 'voterId').lean()).map(
        (r) => String(r.voterId)
      )
    );

    res.json({
      voters: rows.map((v) => {
        const h = hMap.get(String(v.householdId));
        return {
          id: String(v._id),
          fullName: v.fullName,
          party: v.party || null,
          surveyStatus: v.surveyStatus,
          voted: votedSet.has(String(v._id)),
          household: h ? { addressLine1: h.addressLine1, city: h.city, state: h.state } : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// GET /mobile/voters/:voterId?campaignId= — read profile (scoped).
router.get('/voters/:voterId', async (req, res, next) => {
  try {
    const campaign = await resolveCampaign(req, res);
    if (!campaign) return;
    if (!mongoose.isValidObjectId(req.params.voterId)) {
      return res.status(400).json({ error: 'Invalid voterId' });
    }
    const voter = await Voter.findOne(
      { _id: req.params.voterId, organizationId: activeOrgId(req) },
      'householdId'
    ).lean();
    if (!voter) return res.status(404).json({ error: 'Voter not found' });

    const scope = await scopeHouseholdIds(req, campaign);
    if (scope && !scope.includes(String(voter.householdId))) {
      return res.status(403).json({ error: 'Voter not in your assigned books' });
    }
    const profile = await buildVoterProfile(req.params.voterId, { orgId: activeOrgId(req) });
    if (!profile) return res.status(404).json({ error: 'Voter not found' });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// POST /mobile/voters/:voterId/notes { campaignId, body } — canvasser adds a field note.
router.post('/voters/:voterId/notes', async (req, res, next) => {
  try {
    const campaign = await resolveCampaign(req, res);
    if (!campaign) return;
    if (!mongoose.isValidObjectId(req.params.voterId)) {
      return res.status(400).json({ error: 'Invalid voterId' });
    }
    const voter = await Voter.findOne(
      { _id: req.params.voterId, organizationId: activeOrgId(req) },
      'householdId'
    ).lean();
    if (!voter) return res.status(404).json({ error: 'Voter not found' });
    const scope = await scopeHouseholdIds(req, campaign);
    if (scope && !scope.includes(String(voter.householdId))) {
      return res.status(403).json({ error: 'Voter not in your assigned books' });
    }
    const body = z.string().trim().min(1).max(5000).parse(req.body?.body);
    const note = await VoterNote.create({
      organizationId: activeOrgId(req),
      voterId: voter._id,
      authorId: req.user._id,
      body,
    });
    res.status(201).json({ id: String(note._id) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Note body required' });
    next(err);
  }
});

export default router;
