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
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { haversineMeters } from '../../utils/normalizeAddress.js';
import { resolveStatus } from '../../utils/statusPrecedence.js';

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

// Resolve which pass an action belongs to from its (knock-time) timestamp: the
// latest pass activated at or before ts (half-open windows), so an offline
// Pass-1 knock synced after Pass 2 goes live still counts for Pass 1. Falls
// back to the campaign's active pass.
async function resolvePassForTimestamp(campaign, ts) {
  const pass = await Pass.findOne({
    campaignId: campaign._id,
    activatedAt: { $ne: null, $lte: ts },
  })
    .sort({ activatedAt: -1 })
    .select('_id')
    .lean();
  return pass?._id || campaign.activePassId || null;
}

// Best-effort turf tag (metadata only); null when not in exactly one pass turf.
async function resolveTurf(passId, householdId) {
  if (!passId) return null;
  const turf = await Turf.findOne({ passId, householdIds: householdId }).select('_id').lean();
  return turf?._id || null;
}

// household.status = latest-across-all-passes convenience value, resolved with
// the sticky-completion precedence rule (decision 2).
async function recomputeHouseholdStatus(household, campaignType) {
  const acts = await CanvassActivity.find(
    { householdId: household._id, actionType: { $ne: 'note_added' } },
    { actionType: 1, timestamp: 1 }
  ).lean();
  household.status = resolveStatus(campaignType, acts);
}

// "Ever surveyed" — recomputed from existence so a later-pass not_home can't
// wipe it, and deleting a mistaken survey still corrects it.
async function recomputeSurveyStatus(voterIds) {
  for (const vid of voterIds) {
    const exists = await SurveyResponse.exists({ voterId: vid });
    await Voter.updateOne({ _id: vid }, { $set: { surveyStatus: exists ? 'surveyed' : 'not_surveyed' } });
  }
}

async function recordHouseholdAction({ req, householdId, actionType, body, requireCampaignType }) {
  const userId = req.user._id;
  const household = await Household.findById(householdId);
  if (!household) return { error: { status: 404, message: 'Household not found' } };

  const access = await assertHouseholdAccess(req, household);
  if (access.error) return access;

  const campaign = await Campaign.findById(household.campaignId).lean();
  if (!campaign) return { error: { status: 404, message: 'Campaign not found' } };
  if (requireCampaignType && campaign.type !== requireCampaignType) {
    return { error: { status: 400, message: `Action not valid for campaign type "${campaign.type}".` } };
  }

  const data = baseActionSchema.parse(body);
  const ts = data.timestamp ? new Date(data.timestamp) : new Date();
  const distance = distanceFromHouse(household, data.location);
  const passId = await resolvePassForTimestamp(campaign, ts);
  const turfId = await resolveTurf(passId, household._id);

  // Replace this canvasser's prior action at this house for THIS pass.
  await CanvassActivity.deleteMany({
    userId,
    householdId,
    passId,
    actionType: { $in: REPLACEABLE_ACTIONS },
  });

  const priorSurveys = await SurveyResponse.find({ userId, householdId, passId }, 'voterId').lean();
  if (priorSurveys.length) {
    await SurveyResponse.deleteMany({ userId, householdId, passId });
    await recomputeSurveyStatus(priorSurveys.map((s) => s.voterId));
  }

  const activity = await CanvassActivity.create({
    organizationId: household.organizationId,
    campaignId: household.campaignId,
    householdId,
    userId,
    actionType,
    passId,
    turfId,
    note: data.note ?? null,
    location: data.location,
    distanceFromHouseMeters: distance,
    timestamp: ts,
    wasOfflineSubmission: !!data.wasOfflineSubmission,
  });

  await recomputeHouseholdStatus(household, campaign.type);
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
    const passId = await resolvePassForTimestamp(campaign, ts);
    const turfId = await resolveTurf(passId, household._id);

    // One survey per voter PER PASS (prior-pass surveys are preserved).
    await SurveyResponse.deleteMany({ voterId: voter._id, passId });

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
      passId,
      turfId,
      wasOfflineSubmission: !!data.wasOfflineSubmission,
    });

    await CanvassActivity.deleteMany({
      userId: req.user._id,
      householdId: household._id,
      passId,
      actionType: { $in: REPLACEABLE_ACTIONS },
    });

    const activity = await CanvassActivity.create({
      organizationId: household.organizationId,
      campaignId: campaign._id,
      householdId: household._id,
      voterId: voter._id,
      userId: req.user._id,
      actionType: 'survey_submitted',
      passId,
      turfId,
      note: data.note ?? null,
      location: data.location,
      distanceFromHouseMeters: distance,
      timestamp: ts,
      wasOfflineSubmission: !!data.wasOfflineSubmission,
    });

    voter.surveyStatus = 'surveyed';
    await voter.save();

    await recomputeHouseholdStatus(household, campaign.type);
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
