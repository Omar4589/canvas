import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { addAuditSubjects } from '../../services/access/supportAccess.js';
import { requireAuth, requireOrgMember } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { Membership } from '../../models/Membership.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { Effort } from '../../models/Effort.js';
import { Turf } from '../../models/Turf.js';
import { haversineMeters } from '../../utils/normalizeAddress.js';
import { recomputeHouseholdStatus, recomputeSurveyStatus } from '../../services/canvass/status.js';
import { knockStateOf, knockStateDelta, bumpCampaignStats } from '../../services/reports/campaignCounters.js';
import { canvasserHouseholdScope } from '../../services/canvass/canvasserScope.js';
import { activePassIds } from '../../services/passes/activePasses.js';
import { normalizeAndFilterAnswers } from '../../services/surveys/normalizeAnswers.js';
import { updateHouseholdLocation } from '../../services/households/updateHouseholdLocation.js';
import { KNOCK_ACTIONS } from '../../services/reports/aggregations.js';
import { bumpLive } from '../../services/platform/platformStats.js';

const router = Router();

// Record-level audit tag for :voterId (see routes/admin/voters.js) — completeness: the one
// voter-scoped route here is a field write, but a staff request under a grant logs the record.
router.param('voterId', (req, res, next, voterId) => {
  if (mongoose.isValidObjectId(voterId)) addAuditSubjects(res, 'voter', voterId);
  next();
});
router.use(requireAuth, orgContext, requireOrgMember);

function activeOrgId(req) {
  return req.activeOrg?._id;
}

// The TEAM a knock belongs to, resolved ONCE at knock time and frozen onto the row.
//
// `orgContext` already loaded this request's Membership, so the normal canvasser path costs ZERO
// extra queries. The one exception is a SUPER-ADMIN: orgContext returns early for them without
// loading a membership (orgContext.js:35-38), so fall back to a lookup rather than silently
// stamping null — a super-admin who is also a coordinated member of the org should still have
// their doors land on their team.
//
// null is a real answer, not a failure: a candidate knocking their own district, or anyone with no
// coordinator, belongs in the "No coordinator" bucket. Never invent a team here.
async function coordinatorForWrite(req, organizationId) {
  if (req.activeMembership) return req.activeMembership.coordinatorId ?? null;
  if (!organizationId) return null;
  const m = await Membership.findOne(
    { userId: req.user._id, organizationId },
    'coordinatorId'
  ).lean();
  return m?.coordinatorId ?? null;
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
  // Provenance for the GPS audit (new clients send these; old clients omit them):
  // mocked = Android's isFromMockProvider (fake-GPS apps; null = unknown/iOS),
  // fixTimestamp = when the OS computed the fix (vs `timestamp`, the tap).
  mocked: z.boolean().nullable().optional(),
  fixTimestamp: z.string().datetime().nullable().optional(),
});

// No location = no knock. The mobile app hard-gates recording on a fresh GPS fix; this
// is the server backstop for bypassed or old clients. Machine-readable `code` follows
// the ORG_CONTEXT convention (mobile api.js parses it; recordAction.js maps it to a
// specific alert). Checked BEFORE zod so the client gets this message, not a zod dump.
function missingLocation(body) {
  const loc = body?.location;
  return !loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number';
}
const LOCATION_REQUIRED = {
  status: 400,
  code: 'LOCATION_REQUIRED',
  message: 'A GPS location is required to record canvassing. Turn on location and try again.',
};
// The authoritative do-not-contact block. The client disables the survey CTA and walls the survey
// screen, but this is what catches a stale cache, a deep link, or an offline-queued submission
// flushed after the voter was flagged. recordAction.js maps the code to its own alert.
const DO_NOT_CONTACT = {
  status: 403,
  code: 'DO_NOT_CONTACT',
  message: 'This voter has asked not to be contacted. The survey was not saved.',
};

function sendRouteError(res, error) {
  const body = { error: error.message };
  if (error.code) body.code = error.code;
  return res.status(error.status).json(body);
}

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

const REPLACEABLE_ACTIONS = ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped', 'restricted'];

// Snapshot of the entry a replace is about to delete, stamped onto the new row. "Latest
// wins" is a delete-then-create, which would otherwise destroy the prior entry's GPS
// evidence — an honest correction made after walking away from the door would then look
// identical to a phantom knock in the GPS audit. `nearest` carries the best door-presence
// evidence across the whole replacement chain (min effective distance = distance − accuracy),
// so a second correction can't lose the proof the first one preserved. flagDetection.js
// downgrades a far flag to low when `nearest` proves the canvasser was at the door recently.
// MUST be built from the pre-read rows (before the deleteMany), never a re-query.
function buildReplacedSnapshot(mineRows) {
  if (!mineRows.length) return null;
  const prior = [...mineRows].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  const effective = (c) => Math.max(0, c.distanceFromHouseMeters - (c.accuracy ?? 0));
  const candidates = [];
  if (prior.distanceFromHouseMeters != null) {
    candidates.push({
      distanceFromHouseMeters: prior.distanceFromHouseMeters,
      accuracy: prior.location?.accuracy ?? null,
      timestamp: prior.timestamp ?? null,
    });
  }
  if (prior.replaced?.nearest?.distanceFromHouseMeters != null) candidates.push(prior.replaced.nearest);
  return {
    actionType: prior.actionType,
    timestamp: prior.timestamp ?? null,
    location: prior.location ?? null,
    distanceFromHouseMeters: prior.distanceFromHouseMeters ?? null,
    nearest: candidates.length ? candidates.reduce((a, b) => (effective(b) < effective(a) ? b : a)) : null,
  };
}

// Deterministic attribution: a door belongs to its book on one of the campaign's
// ACTIVE rounds. Efforts are door-disjoint, so a household is in at most one
// active round's books — no time-window guessing needed (works with several
// concurrent active rounds). effortId comes from the door's owner; passId/turfId
// from its published book on an active round (null = legacy / not yet booked).
async function resolveAttribution(campaign, household) {
  const effortId = household.effortId || null;
  const passIds = await activePassIds(campaign._id);
  if (!passIds.length) return { passId: null, turfId: null, effortId };
  const turf = await Turf.findOne(
    { campaignId: campaign._id, passId: { $in: passIds }, status: 'published', householdIds: household._id },
    { _id: 1, passId: 1 }
  ).lean();
  return { passId: turf?.passId || null, turfId: turf?._id || null, effortId };
}

// recomputeHouseholdStatus / recomputeSurveyStatus now live in
// services/canvass/status.js so the re-cut "clear knocks" path reuses them.

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

  if (missingLocation(body)) return { error: LOCATION_REQUIRED };
  const data = baseActionSchema.parse(body);
  const ts = data.timestamp ? new Date(data.timestamp) : new Date();
  const distance = distanceFromHouse(household, data.location);
  const { passId, turfId, effortId } = await resolveAttribution(campaign, household);

  // Campaign.stats deltas: one indexed read of the pair's replaceable rows gives the pair's
  // billable-knock state BEFORE, and — because the delete below removes exactly THIS canvasser's
  // rows and the create adds one known row — the state AFTER, plus the per-type deleted counts.
  // Must match the deleteMany filter's actionType set (REPLACEABLE_ACTIONS) exactly.
  const pairRows = await CanvassActivity.find(
    { householdId, passId, actionType: { $in: REPLACEABLE_ACTIONS } },
    'actionType userId timestamp location distanceFromHouseMeters replaced'
  ).lean();
  const mineRows = pairRows.filter((r) => String(r.userId) === String(userId));
  const replaced = buildReplacedSnapshot(mineRows);

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

  // Freeze the team on the door. Resolved now, never re-derived — so this door stays on this
  // team even after the canvasser is deactivated, taken off the campaign, or leaves the org.
  const coordinatorId = await coordinatorForWrite(req, household.organizationId);

  const activity = await CanvassActivity.create({
    organizationId: household.organizationId,
    campaignId: household.campaignId,
    householdId,
    userId,
    actionType,
    passId,
    turfId,
    effortId,
    coordinatorId,
    note: data.note ?? null,
    location: data.location,
    distanceFromHouseMeters: distance,
    replaced,
    timestamp: ts,
    wasOfflineSubmission: !!data.wasOfflineSubmission,
  });

  await recomputeHouseholdStatus(household, campaign.type);
  household.lastActionAt = ts;
  household.lastActionBy = userId;
  await household.save();

  // Campaign.stats: net row delta (1 created − mine deleted), the pair's knock-state delta,
  // lit-drop volume delta, and the replaced surveys. Mobile writes are never bulk → at/userId set.
  const afterRows = [...pairRows.filter((r) => String(r.userId) !== String(userId)), { actionType }];
  await bumpCampaignStats(household.campaignId, {
    activity: 1 - mineRows.length,
    knocks: knockStateDelta(knockStateOf(pairRows), knockStateOf(afterRows)),
    litDropped:
      (actionType === 'lit_dropped' ? 1 : 0) -
      mineRows.filter((r) => r.actionType === 'lit_dropped').length,
    surveys: -priorSurveys.length,
    at: ts,
    userId,
  });

  // Lifetime marketing counters, as ROW deltas mirroring the Campaign.stats deltas above (what the
  // backfill recomputes): net new knock rows for this disposition, minus any surveys it removed
  // (re-dispositioning a surveyed door to not_home deletes its SurveyResponse). Never bulk here.
  {
    const isInternal = req.subscription?.status === 'internal';
    const knockRowDelta =
      (KNOCK_ACTIONS.includes(actionType) ? 1 : 0) -
      mineRows.filter((r) => KNOCK_ACTIONS.includes(r.actionType)).length;
    await bumpLive('doorsKnocked', knockRowDelta, { isInternal });
    if (priorSurveys.length) await bumpLive('surveyResponses', -priorSurveys.length, { isInternal });
  }

  return { household, activity };
}

// Fix a door's pin. The move coords are top-level lat/lng (chosen in the UI at fix
// time, frozen in any offline-queued body). `location` (the merged GPS stamp from the
// client's optimistic layer) is ignored for the move; only the audit accuracy is used.
const locationCorrectionSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  source: z.enum(['gps', 'drag']),
  accuracy: z.number().nullable().optional(),
  scope: z.enum(['unit', 'building']).optional(),
});

router.post('/households/:householdId/location', async (req, res, next) => {
  try {
    const household = await Household.findById(req.params.householdId);
    if (!household) return res.status(404).json({ error: 'Household not found' });

    const access = await assertHouseholdAccess(req, household);
    if (access.error) return res.status(access.error.status).json({ error: access.error.message });

    const campaign = await Campaign.findById(household.campaignId).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Non-admins can only fix pins for doors in the books they're actively working.
    if (!isOrgAdminOrSuper(req)) {
      const scope = await canvasserHouseholdScope(req, campaign);
      if (!scope.some((id) => String(id) === String(household._id))) {
        return res.status(403).json({ error: 'You can only fix pins for doors in your assigned books.' });
      }
    }

    const data = locationCorrectionSchema.parse(req.body);
    try {
      const { updated } = await updateHouseholdLocation(
        household,
        { lat: data.lat, lng: data.lng },
        { source: data.source, byUserId: req.user._id, accuracy: data.accuracy ?? null, scope: data.scope || 'unit' }
      );
      return res.status(201).json({ household: updated[0], moved: updated.length });
    } catch (err) {
      if (err.code === 'out_of_bounds' || err.code === 'invalid_coords') {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      throw err;
    }
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

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
    if (result.error) return sendRouteError(res, result.error);
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
    if (result.error) return sendRouteError(res, result.error);
    res.status(201).json(result);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.post('/households/:householdId/refused', async (req, res, next) => {
  try {
    const result = await recordHouseholdAction({
      req,
      householdId: req.params.householdId,
      actionType: 'refused',
      status: 'refused',
      body: req.body,
      requireCampaignType: 'survey',
    });
    if (result.error) return sendRouteError(res, result.error);
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
    if (result.error) return sendRouteError(res, result.error);
    res.status(201).json(result);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Restricted Access: the home is inaccessible (gated/locked/no legal access). Recorded
// as a first-class disposition + door status, but deliberately NOT a billable knock — it
// stays out of KNOCK_ACTIONS, so it never enters knocks/rates/coverage-knocked. Available
// for ALL campaign types (an unreachable home blocks both surveys and lit drops).
router.post('/households/:householdId/restricted', async (req, res, next) => {
  try {
    const result = await recordHouseholdAction({
      req,
      householdId: req.params.householdId,
      actionType: 'restricted',
      status: 'restricted',
      body: req.body,
    });
    if (result.error) return sendRouteError(res, result.error);
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
        optionIds: z.array(z.string()).optional().default([]),
        otherText: z.string().nullable().optional(),
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
    if (missingLocation(req.body)) return sendRouteError(res, LOCATION_REQUIRED);
    const data = surveySchema.parse(req.body);
    const voter = await Voter.findById(req.params.voterId);
    if (!voter) return res.status(404).json({ error: 'Voter not found' });

    const household = await Household.findById(voter.householdId);
    if (!household) return res.status(404).json({ error: 'Household for voter not found' });

    const access = await assertHouseholdAccess(req, household);
    if (access.error) return res.status(access.error.status).json({ error: access.error.message });

    // After the access check (keeps the 404-for-wrong-org concealment) and before ANY write —
    // everything below this line until the SurveyResponse upsert is read-only, so a blocked
    // submission leaves zero trace.
    if (voter.doNotContact?.flagged) return sendRouteError(res, DO_NOT_CONTACT);

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

    // Per-effort survey: the door's effort overrides the campaign default.
    let effectiveSurveyId = campaign.surveyTemplateId;
    if (household.effortId) {
      const effort = await Effort.findById(household.effortId).select('surveyTemplateId').lean();
      if (effort?.surveyTemplateId) effectiveSurveyId = effort.surveyTemplateId;
    }
    if (effectiveSurveyId && String(effectiveSurveyId) !== String(template._id)) {
      return res
        .status(400)
        .json({ error: "Survey template doesn't match this door's effort survey." });
    }

    const ts = data.timestamp ? new Date(data.timestamp) : new Date();
    const distance = distanceFromHouse(household, data.location);
    const { passId, turfId, effortId } = await resolveAttribution(campaign, household);

    // Campaign.stats deltas — same pre-read pattern as recordHouseholdAction (see the comment
    // there): the pair's replaceable rows give before/after knock state + deleted counts.
    const pairRows = await CanvassActivity.find(
      { householdId: household._id, passId, actionType: { $in: REPLACEABLE_ACTIONS } },
      'actionType userId timestamp location distanceFromHouseMeters replaced'
    ).lean();
    const mineRows = pairRows.filter((r) => String(r.userId) === String(req.user._id));
    const replaced = buildReplacedSnapshot(mineRows);

    // Normalize answers against the template (stable optionIds, retired-inclusive,
    // unknown ids/rows pruned) and drop ghost answers to questions hidden by the
    // current visibleIf logic. Shared with admin-edit so the two can't drift.
    const answers = normalizeAndFilterAnswers(template, data.answers);

    // One survey per voter PER PASS (prior-pass surveys are preserved). ATOMIC upsert keyed on
    // (voterId, passId): a re-submit REPLACES the prior answer (self-heal), and — backed by the
    // unique index — two concurrent submits (a double-tap) can never persist two rows; the loser
    // of the insert race updates the winner instead. Resets editedBy/editedAt so a fresh canvasser
    // submission clears any prior admin-edit audit.
    // Freeze the team on the survey too, so a team's SURVEY numbers survive a canvasser leaving
    // exactly like their door numbers do. (A re-submit restamps it — correct: it records the team
    // of whoever last did the fieldwork. An ADMIN editing the answers later must not touch it;
    // that path sets only editedBy/editedAt.)
    const coordinatorId = await coordinatorForWrite(req, household.organizationId);

    const surveyFields = {
      organizationId: household.organizationId,
      campaignId: campaign._id,
      voterId: voter._id,
      householdId: household._id,
      userId: req.user._id,
      surveyTemplateId: template._id,
      surveyTemplateVersion: template.version || 1,
      answers,
      note: data.note ?? null,
      location: data.location,
      distanceFromHouseMeters: distance,
      submittedAt: ts,
      passId,
      turfId,
      effortId,
      coordinatorId,
      wasOfflineSubmission: !!data.wasOfflineSubmission,
      editedBy: null,
      editedAt: null,
    };
    const surveyFilter = { voterId: voter._id, passId };
    // Whether the upsert truly INSERTED (vs replaced) decides the stats.surveyCount bump. The
    // pre-check + the E11000 override below stay exact under the double-tap race: both racers can
    // see "not exists", but only the insert winner keeps surveyInserted true.
    let surveyInserted = !(await SurveyResponse.exists(surveyFilter));
    let surveyResponse;
    try {
      surveyResponse = await SurveyResponse.findOneAndUpdate(
        surveyFilter,
        { $set: surveyFields },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (err) {
      if (err.code === 11000) {
        // Lost the insert race to a concurrent submit for this (voter, pass) — the winner's row
        // now exists, so update it (latest answers win).
        surveyInserted = false;
        surveyResponse = await SurveyResponse.findOneAndUpdate(
          surveyFilter,
          { $set: surveyFields },
          { new: true }
        );
      } else throw err;
    }

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
      effortId,
      coordinatorId, // same team as the SurveyResponse above — the two ledgers must not drift
      note: data.note ?? null,
      location: data.location,
      distanceFromHouseMeters: distance,
      replaced,
      timestamp: ts,
      wasOfflineSubmission: !!data.wasOfflineSubmission,
    });

    voter.surveyStatus = 'surveyed';
    await voter.save();

    // Lifetime marketing counters. Mirror the Campaign.stats deltas below, as ROW deltas (what the
    // backfill recomputes): doorsKnocked moves by the NET new knock rows — +1 for the survey_submitted,
    // minus any of this canvasser's prior knock rows this submit replaced — so re-dispositioning a door
    // (e.g. not_home → surveyed) doesn't count the door twice; surveyResponses moves only when a genuinely
    // new SurveyResponse row was inserted. A rare miss self-heals on the next backfill.
    {
      const isInternal = req.subscription?.status === 'internal';
      const knockRowDelta = 1 - mineRows.filter((r) => KNOCK_ACTIONS.includes(r.actionType)).length;
      await bumpLive('doorsKnocked', knockRowDelta, { isInternal });
      if (surveyInserted) await bumpLive('surveyResponses', 1, { isInternal });
    }

    await recomputeHouseholdStatus(household, campaign.type);
    household.lastActionAt = ts;
    household.lastActionBy = req.user._id;
    await household.save();

    // Campaign.stats: the created row is a survey_submitted knock; a re-submit that only
    // replaced the SurveyResponse (surveyInserted false) leaves surveyCount untouched.
    const afterRows = [
      ...pairRows.filter((r) => String(r.userId) !== String(req.user._id)),
      { actionType: 'survey_submitted' },
    ];
    await bumpCampaignStats(campaign._id, {
      activity: 1 - mineRows.length,
      knocks: knockStateDelta(knockStateOf(pairRows), knockStateOf(afterRows)),
      litDropped: -mineRows.filter((r) => r.actionType === 'lit_dropped').length,
      surveys: surveyInserted ? 1 : 0,
      at: ts,
      userId: req.user._id,
    });

    res.status(201).json({ household, voter, surveyResponse, activity });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

export default router;
