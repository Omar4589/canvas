import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
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

async function recordHouseholdAction({ householdId, userId, actionType, status, body }) {
  const household = await Household.findById(householdId);
  if (!household) return { error: { status: 404, message: 'Household not found' } };

  const data = baseActionSchema.parse(body);
  const ts = data.timestamp ? new Date(data.timestamp) : new Date();
  const distance = distanceFromHouse(household, data.location);

  const activity = await CanvassActivity.create({
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

    const template = await SurveyTemplate.findById(data.surveyTemplateId);
    if (!template) return res.status(404).json({ error: 'Survey template not found' });

    const ts = data.timestamp ? new Date(data.timestamp) : new Date();
    const distance = distanceFromHouse(household, data.location);

    const surveyResponse = await SurveyResponse.create({
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

    const activity = await CanvassActivity.create({
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
