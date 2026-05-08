import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireOrgMember } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { haversineMeters } from '../../utils/normalizeAddress.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgMember);

function activeOrgId(req) {
  return req.activeOrg?._id;
}

function isOrgAdminOrSuper(req) {
  if (req.user.isSuperAdmin) return true;
  return req.activeMembership?.role === 'admin';
}

async function assertHouseholdAccess(req, household) {
  const orgId = activeOrgId(req);
  if (!orgId) return { error: { status: 400, message: 'Active organization required' } };
  if (String(household.organizationId) !== String(orgId)) {
    return { error: { status: 404, message: 'Household not found' } };
  }
  if (isOrgAdminOrSuper(req)) return {};
  const assigned = await CampaignAssignment.exists({
    campaignId: household.campaignId,
    userId: req.user._id,
  });
  if (!assigned) return { error: { status: 403, message: 'Not assigned to this campaign' } };
  return {};
}

const locationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().nullable().optional(),
});

const baseActionSchema = z.object({
  note: z.string().max(2000).optional().nullable(),
  location: locationSchema,
  timestamp: z.string().datetime().optional(),
  wasOfflineSubmission: z.boolean().optional(),
});

function distanceFromHouse(household, location) {
  if (!household?.location?.coordinates) return null;
  const [hLng, hLat] = household.location.coordinates;
  return Math.round(haversineMeters(hLat, hLng, location.lat, location.lng));
}

const REPLACEABLE_ACTIONS = ['not_home', 'wrong_address', 'survey_submitted', 'lit_dropped'];

async function recordHouseholdAction({ req, householdId, actionType, status, body, requireCampaignType }) {
  const userId = req.user._id;
  const household = await Household.findById(householdId);
  if (!household) return { error: { status: 404, message: 'Household not found' } };

  const access = await assertHouseholdAccess(req, household);
  if (access.error) return access;

  if (requireCampaignType) {
    const campaign = await Campaign.findById(household.campaignId).lean();
    if (!campaign) return { error: { status: 404, message: 'Campaign not found' } };
    if (campaign.type !== requireCampaignType) {
      return {
        error: {
          status: 400,
          message: `Action not valid for campaign type "${campaign.type}".`,
        },
      };
    }
  }

  const data = baseActionSchema.parse(body);
  const ts = data.timestamp ? new Date(data.timestamp) : new Date();
  const distance = distanceFromHouse(household, data.location);

  await CanvassActivity.deleteMany({
    userId,
    householdId,
    actionType: { $in: REPLACEABLE_ACTIONS },
  });

  const priorSurveys = await SurveyResponse.find(
    { userId, householdId },
    'voterId'
  ).lean();
  if (priorSurveys.length) {
    await SurveyResponse.deleteMany({ userId, householdId });
    await Voter.updateMany(
      { _id: { $in: priorSurveys.map((s) => s.voterId) } },
      { $set: { surveyStatus: 'not_surveyed' } }
    );
  }

  const activity = await CanvassActivity.create({
    organizationId: household.organizationId,
    campaignId: household.campaignId,
    householdId,
    userId,
    actionType,
    note: data.note ?? null,
    location: data.location,
    distanceFromHouseMeters: distance,
    timestamp: ts,
    wasOfflineSubmission: !!data.wasOfflineSubmission,
  });

  household.status = status;
  household.lastActionAt = ts;
  household.lastActionBy = userId;
  await household.save();

  return { household, activity };
}

router.post('/households/:householdId/not-home', async (req, res, next) => {
  try {
    const result = await recordHouseholdAction({
      req,
      householdId: req.params.householdId,
      actionType: 'not_home',
      status: 'not_home',
      body: req.body,
      requireCampaignType: 'survey',
    });
    if (result.error) return res.status(result.error.status).json({ error: result.error.message });
    res.status(201).json(result);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.post('/households/:householdId/wrong-address', async (req, res, next) => {
  try {
    const result = await recordHouseholdAction({
      req,
      householdId: req.params.householdId,
      actionType: 'wrong_address',
      status: 'wrong_address',
      body: req.body,
      requireCampaignType: 'survey',
    });
    if (result.error) return res.status(result.error.status).json({ error: result.error.message });
    res.status(201).json(result);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.post('/households/:householdId/lit-drop', async (req, res, next) => {
  try {
    const result = await recordHouseholdAction({
      req,
      householdId: req.params.householdId,
      actionType: 'lit_dropped',
      status: 'lit_dropped',
      body: req.body,
      requireCampaignType: 'lit_drop',
    });
    if (result.error) return res.status(result.error.status).json({ error: result.error.message });
    res.status(201).json(result);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

const surveySchema = z.object({
  surveyTemplateId: z.string().min(1),
  answers: z
    .array(
      z.object({
        questionKey: z.string(),
        questionLabel: z.string(),
        answer: z.unknown().nullable(),
      })
    )
    .default([]),
  note: z.string().max(2000).optional().nullable(),
  location: locationSchema,
  timestamp: z.string().datetime().optional(),
  wasOfflineSubmission: z.boolean().optional(),
});

router.post('/voters/:voterId/survey', async (req, res, next) => {
  try {
    const data = surveySchema.parse(req.body);
    const voter = await Voter.findById(req.params.voterId);
    if (!voter) return res.status(404).json({ error: 'Voter not found' });

    const household = await Household.findById(voter.householdId);
    if (!household) return res.status(404).json({ error: 'Household for voter not found' });

    const access = await assertHouseholdAccess(req, household);
    if (access.error) return res.status(access.error.status).json({ error: access.error.message });

    const campaign = await Campaign.findById(household.campaignId).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.type !== 'survey') {
      return res
        .status(400)
        .json({ error: 'Surveys can only be submitted on survey-type campaigns.' });
    }

    const template = await SurveyTemplate.findOne({
      _id: data.surveyTemplateId,
      organizationId: household.organizationId,
    });
    if (!template) return res.status(404).json({ error: 'Survey template not found' });
    if (
      campaign.surveyTemplateId &&
      String(campaign.surveyTemplateId) !== String(template._id)
    ) {
      return res
        .status(400)
        .json({ error: "Survey template doesn't match the campaign's active survey." });
    }

    const ts = data.timestamp ? new Date(data.timestamp) : new Date();
    const distance = distanceFromHouse(household, data.location);

    await SurveyResponse.deleteMany({ voterId: voter._id });

    const surveyResponse = await SurveyResponse.create({
      organizationId: household.organizationId,
      campaignId: campaign._id,
      voterId: voter._id,
      householdId: household._id,
      userId: req.user._id,
      surveyTemplateId: template._id,
      surveyTemplateVersion: template.version || 1,
      answers: data.answers,
      note: data.note ?? null,
      location: data.location,
      distanceFromHouseMeters: distance,
      submittedAt: ts,
      wasOfflineSubmission: !!data.wasOfflineSubmission,
    });

    await CanvassActivity.deleteMany({
      userId: req.user._id,
      householdId: household._id,
      actionType: { $in: REPLACEABLE_ACTIONS },
    });

    const activity = await CanvassActivity.create({
      organizationId: household.organizationId,
      campaignId: campaign._id,
      householdId: household._id,
      voterId: voter._id,
      userId: req.user._id,
      actionType: 'survey_submitted',
      note: data.note ?? null,
      location: data.location,
      distanceFromHouseMeters: distance,
      timestamp: ts,
      wasOfflineSubmission: !!data.wasOfflineSubmission,
    });

    voter.surveyStatus = 'surveyed';
    await voter.save();

    household.status = 'surveyed';
    household.lastActionAt = ts;
    household.lastActionBy = req.user._id;
    await household.save();

    res.status(201).json({ household, voter, surveyResponse, activity });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

export default router;
