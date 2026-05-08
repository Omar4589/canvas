import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgMember } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';

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

    const households = await Household.find(
      {
        campaignId: campaign._id,
        organizationId: orgId,
        isActive: true,
        'location.coordinates': { $exists: true, $ne: null },
      },
      {
        addressLine1: 1,
        addressLine2: 1,
        city: 1,
        state: 1,
        zipCode: 1,
        location: 1,
        status: 1,
        lastActionAt: 1,
      }
    ).lean();

    const householdIds = households.map((h) => h._id);

    const [voters, survey] = await Promise.all([
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
    ]);

    res.json({
      user: req.user.toSafeJSON(),
      campaign: {
        id: String(campaign._id),
        name: campaign.name,
        type: campaign.type,
        state: campaign.state,
      },
      activeSurvey: survey,
      households,
      voters,
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

    const changedHouseholds = await Household.find(
      {
        campaignId: cId,
        organizationId: orgId,
        updatedAt: { $gt: sinceDate },
      },
      { _id: 1, status: 1, lastActionAt: 1, isActive: 1 }
    ).lean();

    let changedVoters = [];
    if (changedHouseholds.length > 0) {
      changedVoters = await Voter.find(
        {
          householdId: { $in: changedHouseholds.map((h) => h._id) },
          organizationId: orgId,
          updatedAt: { $gt: sinceDate },
        },
        { _id: 1, householdId: 1, surveyStatus: 1 }
      ).lean();
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
