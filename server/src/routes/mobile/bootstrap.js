import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgMember } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { Pass } from '../../models/Pass.js';
import { Effort } from '../../models/Effort.js';
import { activePassIds } from '../../services/passes/activePasses.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgMember);

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

function isOrgAdminOrSuper(req) {
  if (req.user.isSuperAdmin) return true;
  return req.activeMembership?.role === 'admin';
}

async function assertCampaignAccess(req, campaignId) {
  if (!mongoose.isValidObjectId(campaignId)) return { error: 400, message: 'Invalid campaignId' };
  const orgId = activeOrgId(req);
  if (!orgId) return { error: 400, message: 'Active organization required' };
  const campaign = await Campaign.findOne({ _id: campaignId, organizationId: orgId }).lean();
  if (!campaign) return { error: 404, message: 'Campaign not found' };
  if (isOrgAdminOrSuper(req)) return { campaign };
  const assigned = await CampaignAssignment.exists({ campaignId: campaign._id, userId: req.user._id });
  if (!assigned) return { error: 403, message: 'Not assigned to this campaign' };
  return { campaign };
}

// A canvasser only sees households in the books ASSIGNED to them on the
// campaign's ACTIVE rounds — UNIONED across all active efforts (a canvasser can
// be on more than one effort). Returns:
//   null  -> no restriction (admin/super see everything)
//   [...] -> the allowed household ids; an EMPTY array ⇒ they see nothing.
async function canvasserHouseholdScope(req, campaign) {
  if (isOrgAdminOrSuper(req)) return null;
  const passIds = await activePassIds(campaign._id);
  if (!passIds.length) return []; // no active round anywhere → see nothing
  const myTurfs = await TurfAssignment.find(
    { userId: req.user._id, campaignId: campaign._id, passId: { $in: passIds } },
    { turfId: 1 }
  ).lean();
  if (!myTurfs.length) return []; // not assigned a book on any active round
  const books = await Turf.find({ _id: { $in: myTurfs.map((a) => a.turfId) } }, { householdIds: 1 }).lean();
  return books.flatMap((b) => b.householdIds || []);
}

// The canvasser's assigned books across ALL active rounds, each tagged with its
// effortId + resolved surveyTemplateId (effort override || campaign default) so
// the app can render the right survey per door. Empty for admins/super or when
// nothing is assigned.
async function canvasserBooks(req, campaign) {
  if (isOrgAdminOrSuper(req)) return [];
  const passIds = await activePassIds(campaign._id);
  if (!passIds.length) return [];
  const myTurfs = await TurfAssignment.find(
    { userId: req.user._id, campaignId: campaign._id, passId: { $in: passIds } },
    { turfId: 1 }
  ).lean();
  if (!myTurfs.length) return [];
  const books = await Turf.find(
    { _id: { $in: myTurfs.map((a) => a.turfId) } },
    { name: 1, centroid: 1, doorCount: 1, householdIds: 1, passId: 1 }
  ).lean();

  // book → round (pass) → effort → survey override (falls back to campaign default).
  const passes = await Pass.find({ _id: { $in: books.map((b) => b.passId) } }, { effortId: 1 }).lean();
  const passEffort = new Map(passes.map((p) => [String(p._id), p.effortId ? String(p.effortId) : null]));
  const efforts = await Effort.find(
    { _id: { $in: passes.map((p) => p.effortId).filter(Boolean) } },
    { surveyTemplateId: 1 }
  ).lean();
  const effortSurvey = new Map(
    efforts.map((e) => [String(e._id), e.surveyTemplateId ? String(e.surveyTemplateId) : null])
  );
  const campaignSurvey = campaign.surveyTemplateId ? String(campaign.surveyTemplateId) : null;

  // doorCount reflects REMAINING doors — exclude fully-voted (and inactive) households.
  const allHhIds = books.flatMap((b) => b.householdIds || []);
  const eligible = new Set(
    (
      await Household.find(
        { _id: { $in: allHhIds }, isActive: true, fullyVoted: { $ne: true } },
        { _id: 1 }
      ).lean()
    ).map((h) => String(h._id))
  );
  return books.map((b) => {
    const effortId = passEffort.get(String(b.passId)) || null;
    const surveyTemplateId = (effortId && effortSurvey.get(effortId)) || campaignSurvey;
    return {
      id: String(b._id),
      name: b.name,
      centroid: b.centroid,
      doorCount: (b.householdIds || []).filter((id) => eligible.has(String(id))).length,
      effortId,
      surveyTemplateId,
    };
  });
}

router.get('/campaigns', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    let campaignFilter = { organizationId: orgId, isActive: true };
    if (!isOrgAdminOrSuper(req)) {
      const assignedIds = await CampaignAssignment.find({
        userId: req.user._id,
        organizationId: orgId,
      }).distinct('campaignId');
      campaignFilter._id = { $in: assignedIds };
    }
    const campaigns = await Campaign.find(campaignFilter)
      .sort({ createdAt: -1 })
      .select('name type state surveyTemplateId')
      .lean();
    res.json({
      user: req.user.toSafeJSON(),
      campaigns: campaigns.map((c) => ({
        id: String(c._id),
        name: c.name,
        type: c.type,
        state: c.state,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/bootstrap', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const { campaignId } = req.query;
    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId query param is required' });
    }
    const access = await assertCampaignAccess(req, campaignId);
    if (access.error) return res.status(access.error).json({ error: access.message });
    const campaign = access.campaign;
    if (!campaign.isActive) return res.status(404).json({ error: 'Campaign inactive' });

    const householdFilter = {
      campaignId: campaign._id,
      organizationId: orgId,
      isActive: true,
      fullyVoted: { $ne: true }, // drop doors where everyone has already voted
      'location.coordinates': { $exists: true, $ne: null },
    };
    const scope = await canvasserHouseholdScope(req, campaign);
    if (scope !== null) householdFilter._id = { $in: scope };

    const households = await Household.find(householdFilter, {
      addressLine1: 1,
      addressLine2: 1,
      city: 1,
      state: 1,
      zipCode: 1,
      location: 1,
      status: 1,
      lastActionAt: 1,
      turfId: 1,
    }).lean();

    const householdIds = households.map((h) => h._id);

    const [votersRaw, survey, votedRecs] = await Promise.all([
      campaign.type === 'survey'
        ? Voter.find(
            { householdId: { $in: householdIds }, organizationId: orgId },
            {
              householdId: 1,
              fullName: 1,
              firstName: 1,
              lastName: 1,
              party: 1,
              gender: 1,
              dateOfBirth: 1,
              precinct: 1,
              surveyStatus: 1,
            }
          ).lean()
        : Promise.resolve([]),
      campaign.surveyTemplateId
        ? SurveyTemplate.findOne({
            _id: campaign.surveyTemplateId,
            organizationId: orgId,
          }).lean()
        : Promise.resolve(null),
      VotedVoter.find({ campaignId: campaign._id }, { voterId: 1 }).lean(),
    ]);
    // Early voting: flag (not hide) voters who already voted so the app can show
    // a ✓ next to their name. Fully-voted doors were already dropped above.
    const votedSet = new Set(votedRecs.map((r) => String(r.voterId)));
    const voters = votersRaw.map((v) => ({ ...v, voted: votedSet.has(String(v._id)) }));

    const books = await canvasserBooks(req, campaign);
    // Per-effort surveys: every survey a door in scope might need (effort
    // overrides + campaign default), keyed by id. The app resolves a voter's
    // survey via household → book → surveyTemplateId → surveys[id], falling back
    // to activeSurvey (the campaign default).
    const surveyIds = new Set();
    if (campaign.surveyTemplateId) surveyIds.add(String(campaign.surveyTemplateId));
    for (const b of books) if (b.surveyTemplateId) surveyIds.add(String(b.surveyTemplateId));
    const surveyTemplates = surveyIds.size
      ? await SurveyTemplate.find({ _id: { $in: [...surveyIds] }, organizationId: orgId }).lean()
      : [];
    const surveys = {};
    for (const t of surveyTemplates) surveys[String(t._id)] = t;

    res.json({
      user: req.user.toSafeJSON(),
      campaign: {
        id: String(campaign._id),
        name: campaign.name,
        type: campaign.type,
        state: campaign.state,
      },
      activeSurvey: survey,
      surveys,
      households,
      voters,
      books,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/changes', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const { campaignId, since } = req.query;
    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId query param is required' });
    }
    const access = await assertCampaignAccess(req, campaignId);
    if (access.error) return res.status(access.error).json({ error: access.message });

    const sinceMs = since ? Date.parse(since) : NaN;
    if (!Number.isFinite(sinceMs)) {
      return res.status(400).json({ error: 'since query param is required (ISO datetime)' });
    }
    const sinceDate = new Date(sinceMs);
    const cId = access.campaign._id;

    const changedFilter = {
      campaignId: cId,
      organizationId: orgId,
      updatedAt: { $gt: sinceDate },
    };
    const scope = await canvasserHouseholdScope(req, access.campaign);
    if (scope !== null) changedFilter._id = { $in: scope };

    const changedHouseholds = await Household.find(changedFilter, {
      _id: 1,
      status: 1,
      lastActionAt: 1,
      isActive: 1,
      fullyVoted: 1, // client drops doors where everyone has now voted
    }).lean();

    let changedVoters = [];
    if (changedHouseholds.length > 0) {
      const hhIds = changedHouseholds.map((h) => h._id);
      // Re-send ALL voters of the changed households (not only docs whose own
      // updatedAt moved): marking a voter voted writes a VotedVoter row, not the
      // Voter doc, so an updatedAt filter would miss the ✓. The recompute bumps
      // each affected household's updatedAt, so its door is already in this delta.
      const raw = await Voter.find(
        { householdId: { $in: hhIds }, organizationId: orgId },
        { _id: 1, householdId: 1, surveyStatus: 1 }
      ).lean();
      const votedRecs = await VotedVoter.find(
        { campaignId: cId, voterId: { $in: raw.map((v) => v._id) } },
        { voterId: 1 }
      ).lean();
      const votedSet = new Set(votedRecs.map((r) => String(r.voterId)));
      changedVoters = raw.map((v) => ({ ...v, voted: votedSet.has(String(v._id)) }));
    }

    res.json({
      serverTime: new Date().toISOString(),
      households: changedHouseholds,
      voters: changedVoters,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
