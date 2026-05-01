import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { Campaign } from '../../models/Campaign.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { haversineMeters } from '../../utils/normalizeAddress.js';

const router = Router();
router.use(requireAuth);

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

async function recordHouseholdAction({ householdId, userId, actionType, status, body, requireCampaignType }) {
  const household = await Household.findById(householdId);
  if (!household) return { error: { status: 404, message: 'Household not found' } };

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

  // Per-canvasser overwrite: a canvasser can have at most one activity per household.
  // Re-entering an action replaces their previous one (corrects mistakes cleanly).
  await CanvassActivity.deleteMany({
    userId,
    householdId,
    actionType: { $in: REPLACEABLE_ACTIONS },
  });

  // If this canvasser previously submitted any surveys at this house, those become
  // invalid too (e.g. they realized they were at the wrong door). Drop the
  // SurveyResponse records and reset surveyStatus on the affected voters.
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
      householdId: req.params.householdId,
      userId: req.user._id,
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
      householdId: req.params.householdId,
      userId: req.user._id,
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
      householdId: req.params.householdId,
      userId: req.user._id,
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

    const campaign = await Campaign.findById(household.campaignId).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.type !== 'survey') {
      return res
        .status(400)
        .json({ error: 'Surveys can only be submitted on survey-type campaigns.' });
    }

    const template = await SurveyTemplate.findById(data.surveyTemplateId);
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

    // Per-voter overwrite: each voter has at most one SurveyResponse — the latest
    // submission wins. Without this, re-surveys would inflate counts and answer
    // breakdowns (e.g., a voter who answered "Undecided" then "Yes" would appear
    // in both buckets).
    await SurveyResponse.deleteMany({ voterId: voter._id });

    const surveyResponse = await SurveyResponse.create({
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

    // Per-canvasser overwrite (matches recordHouseholdAction): one activity per
    // (canvasser, household). The SurveyResponse above is the per-voter source of truth.
    await CanvassActivity.deleteMany({
      userId: req.user._id,
      householdId: household._id,
      actionType: { $in: REPLACEABLE_ACTIONS },
    });

    const activity = await CanvassActivity.create({
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

    // Any survey at the house turns it green (per locked decision).
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
