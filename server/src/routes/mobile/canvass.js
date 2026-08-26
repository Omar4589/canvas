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
import { Turf } from '../../models/Turf.js';
import { haversineMeters } from '../../utils/normalizeAddress.js';
import { recomputeHouseholdStatus, recomputeSurveyStatus } from '../../services/canvass/status.js';
import { knockStateOf, knockStateDelta, bumpCampaignStats } from '../../services/reports/campaignCounters.js';
import { canManageCampaign } from '../../services/authz/campaignManagement.js';
import { assertCampaignWritable } from '../../middleware/campaignWritable.js';
import { activePassIds } from '../../services/passes/activePasses.js';
import { getPassStatusMap } from '../../services/passes/passStatus.js';
import { normalizeAndFilterAnswers } from '../../services/surveys/normalizeAnswers.js';
import { effectiveSurveyTemplateId } from '../../services/surveys/effectiveTemplate.js';
import { archiveOverwrittenResponse } from '../../services/surveys/archiveOverwrite.js';
import { updateHouseholdLocation } from '../../services/households/updateHouseholdLocation.js';
import { KNOCK_ACTIONS } from '../../services/reports/aggregations.js';
import { bumpLive } from '../../services/platform/platformStats.js';
import { struckByUnknock } from '../../services/canvass/unknock.js';

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
// Keyed on the CAMPAIGN, not the org. A crew is a per-campaign fact — the same canvasser can work
// two races under two different coordinators — so the source is CampaignAssignment.coordinatorId
// for the campaign this door belongs to. Reading it off req.activeMembership (which is per-org and
// already in memory) is what made two leads overwrite each other.
//
// `organizationId` is retained for call-site symmetry with the row being written; the lookup does
// not need it, because CampaignAssignment is unique on {campaignId, userId} and a campaign belongs
// to exactly one org.
//
// null is a real answer, not a failure: a candidate knocking their own district, an admin handed a
// book on the fly, or anyone not yet on a crew here belongs in the "No coordinator" bucket. Never
// invent a team.
async function coordinatorForWrite(req, organizationId, campaignId) {
  if (!campaignId) return null;
  // Per-REQUEST memo. A survey submit resolves the team twice (the SurveyResponse and its paired
  // activity row, which must not drift), and a canvasser posts against one campaign at a time, so
  // one lookup covers the request. This replaced a zero-query read off req.activeMembership — the
  // cost of the crew becoming a per-campaign fact rather than an org-chart one.
  if (!req._crewCache) req._crewCache = new Map();
  const key = String(campaignId);
  if (req._crewCache.has(key)) return req._crewCache.get(key);

  const assignment = await CampaignAssignment.findOne(
    { campaignId, userId: req.user._id },
    'coordinatorId'
  ).lean();
  // No roster row is a REAL answer of "no crew", not a failure: an org admin or super-admin can be
  // handed a book on the fly (services/campaignRoster.js), and they belong in the No-team bucket
  // until somebody puts them on a crew for this campaign. Never invent a team here.
  const value = assignment?.coordinatorId ?? null;
  req._crewCache.set(key, value);
  return value;
}

function isOrgAdminOrSuper(req) {
  if (req.user.isSuperAdmin) return true;
  return req.activeMembership?.role === 'admin';
}

// Org scoping only — split out because the pin-correction route needs the 404-not-403 org
// check (never leak that another org's household exists) but must NOT run the roster check
// below: a lead who MANAGES a campaign was often never rostered onto it as a walker.
function assertHouseholdOrg(req, household) {
  const orgId = activeOrgId(req);
  if (!orgId) return { error: { status: 400, message: 'Active organization required' } };
  if (String(household.organizationId) !== String(orgId)) {
    return { error: { status: 404, message: 'Household not found' } };
  }
  return {};
}

async function assertHouseholdAccess(req, household) {
  const org = assertHouseholdOrg(req, household);
  if (org.error) return org;
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
// A per-campaign disabled outcome (Campaign.disabledOutcomes — services/canvass/outcomeToggles.js).
// The client hides the button, but a phone whose bootstrap predates the toggle flip still shows
// it; this is the backstop. Message is shown VERBATIM by the mobile hard-failure alert
// (lib/recordAction.js maps the code to its own title), so it names the outcome in the
// canvasser's words, not the key.
const OUTCOME_DISABLED_LABELS = {
  restricted: 'Restricted access',
  refused: 'Refused',
  wrong_address: 'Wrong address',
  no_soliciting: 'No soliciting',
};
const outcomeDisabled = (actionType) => ({
  status: 400,
  code: 'OUTCOME_DISABLED',
  message: `"${OUTCOME_DISABLED_LABELS[actionType] || actionType}" is turned off for this campaign, so this door was not recorded. Pick a different outcome.`,
});

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

const REPLACEABLE_ACTIONS = ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped', 'restricted', 'no_soliciting'];

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

// Has a QUEUED REPLAY arrived after the door already moved on?
//
// Both write paths below are replace-then-create: they deleteMany this canvasser's rows for the
// (household, pass) and insert one. That is correct for a live correction — last arrival wins — but
// the offline queue can deliver an action minutes or hours after it was recorded, and without this
// check a replayed `not_home` DELETES a newer `refused` (and, via the SurveyResponse cleanup below,
// a newer survey's ANSWERS) and reinstates itself, dragging household.lastActionAt backwards. That
// was reproduced returning HTTP 201, so nothing anywhere reported a problem.
//
// Two things make this decidable, and both are already on the wire:
//   • `wasOfflineSubmission` is stamped by the client at ENQUEUE time (mobile/lib/offlineQueue.js),
//     never at record time — so it marks exactly the replay population, including the
//     timed-out-while-online replay that causes this. A first attempt never carries it.
//   • the body's `timestamp` is frozen when the canvasser taps (mobile/lib/recordAction.js), so a
//     replay reports when it actually happened rather than when it finally arrived.
//
// Deliberately scoped to replays: a live write is never rejected, so online semantics are untouched
// and no clock-skewed phone can lock itself out. The comparison is also always against THIS
// canvasser's own rows (`mineRows`, mirroring the deleteMany's userId scope), so both timestamps
// come from one device — cross-device clock skew cannot affect it. That is what makes trusting a
// client timestamp defensible here and nowhere else.
function supersededByNewer(data, mineRows, ts) {
  if (!data.wasOfflineSubmission) return null;
  return (
    mineRows.find((r) => r.timestamp && new Date(r.timestamp).getTime() > ts.getTime()) || null
  );
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

// The household as it goes on the ACTION-RESPONSE wire: per-round status + last
// visit — the same values the bootstrap and /changes would show this door — and
// nothing else. The client reconcile (mobile lib/recordAction.js, survey.jsx)
// reads response.household.status and re-arms its optimistic overlay with it, so
// a global (cross-round) status here poisons the phone until restart: the stored
// Household.status is completion-STICKY across all rounds, and echoing it back
// after a not_home on a prior-round-surveyed door flipped the pin to "surveyed"
// and made the overlay defend the lie against correct deltas for its whole TTL.
// The action responses are the FOURTH per-round wire, alongside bootstrap,
// /changes, and me.js (docs/PASSES_AND_TURF.md). passId null = legacy/unbooked
// door → keep the global value, matching the bootstrap's fallback for doors
// outside doorPass. Deliberately minimal: the raw doc over-shipped (and the
// survey route's raw Voter leaked dateOfBirth/phone/doNotContact — see
// PRIVACY_VERIFICATION.md); nothing shipped ever read more than these fields.
async function toWireHousehold(household, passId, campaignType) {
  if (!passId) {
    // No round to answer for, so no per-round provenance either — restrictedFrom is null rather
    // than guessed from the global status, which is completion-sticky across ALL rounds.
    return {
      _id: String(household._id),
      status: household.status,
      lastActionAt: household.lastActionAt,
      restrictedFrom: null,
    };
  }
  const m = await getPassStatusMap(passId, [household._id], campaignType);
  const e = m.get(String(household._id));
  return {
    _id: String(household._id),
    status: e?.status || 'unknocked',
    lastActionAt: e?.lastActionAt || null,
    restrictedFrom: e?.restrictedFrom || null,
  };
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
  // A mid-delete campaign reads as gone — this closes the knock-after-stamp race
  // (services/campaigns/deletionState.js).
  if (!campaign || campaign.deletion?.requestedAt) return { error: { status: 404, message: 'Campaign not found' } };
  if (requireCampaignType && campaign.type !== requireCampaignType) {
    return { error: { status: 400, message: `Action not valid for campaign type "${campaign.type}".` } };
  }
  // Per-campaign disabled outcome: FRESH submissions are refused; offline replays are accepted.
  // `wasOfflineSubmission` is stamped at ENQUEUE time (mobile/lib/offlineQueue.js), so it marks
  // exactly the population recorded before the phone could learn the toggle flipped — rejecting
  // those would silently destroy real door data. Client-asserted, same documented trust
  // posture as supersededByNewer: this is policy, not security. Read off the raw body (like
  // missingLocation) — zod hasn't parsed yet.
  if (campaign.disabledOutcomes?.includes(actionType) && body?.wasOfflineSubmission !== true) {
    return { error: outcomeDisabled(actionType) };
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
  // `via` is projected for knockStateOf: a desk-authored restricted mark (bulk or single-home)
  // must not count as a billable door (aggregations.js). Omitting it would make every desk mark
  // look like field work.
  const pairRows = await CanvassActivity.find(
    { householdId, passId, actionType: { $in: REPLACEABLE_ACTIONS } },
    'actionType via userId timestamp location distanceFromHouseMeters replaced'
  ).lean();
  const mineRows = pairRows.filter((r) => String(r.userId) === String(userId));

  // MUST come before every mutation below — the deleteMany, the SurveyResponse cleanup, the create,
  // the status recompute, the lastActionAt write and the counter bumps. Returning the household
  // (in the minimal PER-ROUND wire shape — toWireHousehold) lets the client's optimistic overlay
  // reconcile to the round's truth for free (it reads response.household.status), so a superseded
  // replay self-corrects the pin to the round's newer action with no client change.
  if (supersededByNewer(data, mineRows, ts)) {
    return { household: await toWireHousehold(household, passId, campaign.type), superseded: true };
  }

  // The unknock tombstone — supersededByNewer's blind spot. That guard compares a replay against
  // rows that EXIST; an admin's unknock leaves none, so without this a queued copy of the struck
  // knock walks straight back in, re-billing the visit and flipping the door off `unknocked` —
  // and in the fraud case the phone holding the queue is the fraudulent canvasser's. Replays only
  // (a live write never pays the lookup), tap-time before the freeze only (later work is new
  // work), standing runs only (a reverted unknock restores the world, replays included). The 200
  // `superseded` shape drains the phone's queue with no client change.
  if (data.wasOfflineSubmission) {
    const struck = await struckByUnknock({
      campaignId: campaign._id,
      householdId: household._id,
      passId,
      userId: req.user._id,
      ts,
    });
    if (struck) {
      return { household: await toWireHousehold(household, passId, campaign.type), superseded: true };
    }
  }

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
  const coordinatorId = await coordinatorForWrite(req, household.organizationId, household.campaignId);

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

  // Runs AFTER the activity create, so the per-round aggregate reflects the action
  // just recorded. `activity` is deliberately not on the wire — nothing reads it.
  return { household: await toWireHousehold(household, passId, campaign.type) };
}

// Shown VERBATIM to the user by the mobile alert (lib/recordAction.js renders `data.error`),
// so it has to read like something a canvasser can act on, not like an API refusal.
//
// FORBIDDEN_ROLE is inert on this path: pin fixes go through submitOrQueue, not react-query,
// so _layout.jsx's onGlobalError/recoverRole never sees it. If pin fixes ever move to
// useMutation, re-check that — a demoted-mid-session user would then get a cache clear.
const PIN_ROLE_MESSAGE = 'Only team leads and admins can move a house pin. Ask your lead to fix this one.';

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

    // Org scoping only — deliberately NOT assertHouseholdAccess: its roster check would 403 a
    // lead who manages this campaign but never walked it, which is exactly who should be fixing
    // pins. The role gate below is the real boundary.
    const org = assertHouseholdOrg(req, household);
    if (org.error) return res.status(org.error.status).json({ error: org.error.message });

    // Moving a pin is a DATA change with an audit trail, so it belongs to the people accountable
    // for the data — not to whoever is standing there. It used to be open to any canvasser working
    // the book, which let a faked knock be laundered: record from home, collect a "far from house"
    // flag, then drag the pin onto your own house to soften it. Same policy as the web endpoint
    // (requireCampaignManager) — literally the same function, called inline because this route
    // isn't campaign-nested. No book-scope check survives: the only role that both reached it and
    // passes here is a managing lead, and the web path never imposed a roster on one.
    if (!(await canManageCampaign(req, household.campaignId))) {
      return res.status(403).json({ error: PIN_ROLE_MESSAGE, code: 'FORBIDDEN_ROLE' });
    }

    // The archived-campaign refusal has to live on BOTH pin doors for the same reason the role
    // gate above does: this is literally the same write as the campaign-nested web route, and an
    // identical write must never be 200 through one door and 409 through the other. Inline rather
    // than the router middleware because this path carries no :campaignId to resolve.
    const pinCampaign = await Campaign.findById(household.campaignId).select('isActive deletion.requestedAt').lean();
    if (!assertCampaignWritable(res, pinCampaign)) return;

    const data = locationCorrectionSchema.parse(req.body);
    try {
      const { updated, turfsRecomputed } = await updateHouseholdLocation(
        household,
        { lat: data.lat, lng: data.lng },
        { source: data.source, byUserId: req.user._id, accuracy: data.accuracy ?? null, scope: data.scope || 'unit' }
      );
      // Minimal wire shape: the client reads only location/coordSource/coordConfidence
      // (recordLocationCorrection reconcile) and `moved`. Not per-round — a pin move
      // has no status semantics — but the raw doc over-shipped (previousLocation,
      // correctedBy, normalizedAddress...). turfsRecomputed mirrors the web PATCH.
      const h = updated[0];
      return res.status(201).json({
        household: {
          _id: String(h._id),
          location: h.location,
          coordSource: h.coordSource,
          coordConfidence: h.coordConfidence,
        },
        moved: updated.length,
        turfsRecomputed,
      });
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
    // 200 = accepted but written nothing (a superseded replay); 201 = a real write. The queue
    // drains on any 2xx, so this drops the stale item without the client reporting a failure.
    res.status(result.superseded ? 200 : 201).json(result);
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
    // 200 = accepted but written nothing (a superseded replay); 201 = a real write. The queue
    // drains on any 2xx, so this drops the stale item without the client reporting a failure.
    res.status(result.superseded ? 200 : 201).json(result);
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
    // 200 = accepted but written nothing (a superseded replay); 201 = a real write. The queue
    // drains on any 2xx, so this drops the stale item without the client reporting a failure.
    res.status(result.superseded ? 200 : 201).json(result);
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
    // 200 = accepted but written nothing (a superseded replay); 201 = a real write. The queue
    // drains on any 2xx, so this drops the stale item without the client reporting a failure.
    res.status(result.superseded ? 200 : 201).json(result);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Restricted Access: the home is inaccessible (gated/locked/no legal access). Recorded
// as a first-class disposition + door status, but deliberately NOT a knock — it stays out of
// KNOCK_ACTIONS, so it never enters knocks/rates/coverage-knocked. Available for ALL campaign
// types (an unreachable home blocks both surveys and lit drops).
//
// It MAY still count as a billable DOOR: an org that invoices per door can opt in per campaign
// (billRestrictedDoors — services/reports/billRestricted.js), because the canvasser made the walk.
// That is a read-time reporting choice and changes none of the above. Independently, a first
// non-bulk restricted mark DOES start the campaign's billing clock (services/billing/statement.js).
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
    // 200 = accepted but written nothing (a superseded replay); 201 = a real write. The queue
    // drains on any 2xx, so this drops the stale item without the client reporting a failure.
    res.status(result.superseded ? 200 : 201).json(result);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// No Soliciting: the canvasser reached the door and a posted sign forbade the knock. Unlike
// `restricted` (never reached the door) this IS a knock — the same walk as any other door, so it
// counts in KNOCK_ACTIONS, in billable doors, and in coverage-knocked. It is NOT a contact:
// nobody answered, so it stays out of the contactRate numerator (aggregations.js).
//
// Available for ALL campaign types — a sign forbids leaving literature at least as much as it
// forbids a survey. Non-completion, so a later tap supersedes it (statusPrecedence.js).
router.post('/households/:householdId/no-soliciting', async (req, res, next) => {
  try {
    const result = await recordHouseholdAction({
      req,
      householdId: req.params.householdId,
      actionType: 'no_soliciting',
      status: 'no_soliciting',
      body: req.body,
    });
    if (result.error) return sendRouteError(res, result.error);
    // 200 = accepted but written nothing (a superseded replay); 201 = a real write. The queue
    // drains on any 2xx, so this drops the stale item without the client reporting a failure.
    res.status(result.superseded ? 200 : 201).json(result);
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
    // A mid-delete campaign reads as gone (services/campaigns/deletionState.js).
    if (!campaign || campaign.deletion?.requestedAt) return res.status(404).json({ error: 'Campaign not found' });
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

    // Per-effort survey: the door's effort overrides the campaign default. Shared with the admin
    // conversion tool (services/surveys/effectiveTemplate.js) so the two can't drift — a tool that
    // resolved this differently would write responses this route itself rejects.
    const effectiveSurveyId = await effectiveSurveyTemplateId(campaign, household);
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
      'actionType via userId timestamp location distanceFromHouseMeters replaced'
    ).lean();
    const mineRows = pairRows.filter((r) => String(r.userId) === String(req.user._id));

    // Same guard as the disposition path, and here it has to sit BEFORE the SurveyResponse upsert
    // below — that upsert runs ahead of this route's deleteMany and is keyed on (voterId, passId)
    // alone, not on user or time, so a stale replay would blindly overwrite a newer submission's
    // answers and clear its editedBy/editedAt audit trail before we ever reached the delete.
    if (supersededByNewer(data, mineRows, ts)) {
      return res
        .status(200)
        .json({ household: await toWireHousehold(household, passId, campaign.type), superseded: true });
    }

    // The unknock tombstone, before the upsert for the same reason as the guard above it — a
    // struck survey replay must never re-create its SurveyResponse. See the disposition path.
    if (data.wasOfflineSubmission) {
      const struck = await struckByUnknock({
        campaignId: campaign._id,
        householdId: household._id,
        passId,
        userId: req.user._id,
        ts,
      });
      if (struck) {
        return res
          .status(200)
          .json({ household: await toWireHousehold(household, passId, campaign.type), superseded: true });
      }
    }

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
    const coordinatorId = await coordinatorForWrite(req, household.organizationId, campaign._id);

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
    // Replace-vs-insert is decided by which WRITE actually ran, not by pre-read truthiness. The
    // old blind upsert had a race the parity oracle tolerated but this fix cannot: a racer whose
    // pre-read saw "no row" could land as a silent UPDATE (no E11000) after the winner's insert
    // committed — double-bumping surveyCount and, now that overwrites are preserved, replacing a
    // row it never read and so never archived. Splitting the paths (update-a-seen-row vs
    // insert-only, E11000 → re-read + retry) makes both the counter and the archive invariant
    // exact in every interleaving: a cross-canvasser replacement ALWAYS leaves an archive row.
    //
    // Full findOne (was .exists): same point-seek on the unique index, and the doc body is
    // exactly what a cross-canvasser overwrite must preserve before the $set destroys it. A
    // same-user re-submit is the designed self-heal and archives nothing.
    let surveyInserted = false;
    let surveyResponse = null;
    const replaceSeenRow = async (seen) => {
      if (String(seen.userId) !== String(req.user._id)) {
        // Snapshot-before-write: answers, note, authorship, GPS and any admin edit survive
        // for the admin surfaces + restore.
        await archiveOverwrittenResponse(seen, { byUserId: req.user._id });
      }
      // No upsert: this must only ever hit the row we just read (deleted-in-between falls
      // through to the insert path below).
      return SurveyResponse.findOneAndUpdate(surveyFilter, { $set: surveyFields }, { new: true });
    };
    const existing = await SurveyResponse.findOne(surveyFilter).lean();
    if (existing) surveyResponse = await replaceSeenRow(existing);
    if (!surveyResponse) {
      try {
        surveyResponse = await SurveyResponse.create(surveyFields);
        surveyInserted = true;
      } catch (err) {
        if (err.code !== 11000) throw err;
        // Lost the insert race — the winner's row exists now. Their seconds-old response is
        // still a real conversation; preserve it exactly like the slow path (latest answers win).
        const winner = await SurveyResponse.findOne(surveyFilter).lean();
        if (winner) surveyResponse = await replaceSeenRow(winner);
        if (!surveyResponse) {
          // Winner vanished in the microsecond between (a concurrent admin delete) — last
          // resort blind upsert; the tiny counter drift is the documented reconcile-healed class.
          surveyResponse = await SurveyResponse.findOneAndUpdate(
            surveyFilter,
            { $set: surveyFields },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }
      }
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

    // Minimal per-round wire shape ONLY. The old body shipped the raw Voter doc —
    // dateOfBirth, phone, phoneType, the full doNotContact subdoc — bypassing the
    // toWireVoter privacy shaping the bootstrap enforces ("the strongest protection
    // for a field is not sending it"). No shipped client ever read voter /
    // surveyResponse / activity from this response.
    res.status(201).json({ household: await toWireHousehold(household, passId, campaign.type) });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

export default router;
