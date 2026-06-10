import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { Turf } from '../../models/Turf.js';
import { Pass } from '../../models/Pass.js';
import { getPassStatusMap } from '../../services/passes/passStatus.js';
import { zonedDayRange } from '../../utils/timezone.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));

function activeOrgId(req) {
  return req.activeOrg?._id;
}

// Anchor timezone for the map's date window: the campaign's, else the org's. Mirrors
// reports.js so the map narrows to the same campaign-day window as the dashboards.
async function resolveMapTz(orgId, campaignId) {
  if (campaignId) {
    const c = await Campaign.findOne({ _id: campaignId, organizationId: orgId }, { timeZone: 1 }).lean();
    if (c?.timeZone) return c.timeZone;
  }
  const org = await Organization.findById(orgId, { timeZone: 1 }).lean();
  return org?.timeZone || 'America/New_York';
}

// The full active canvasser roster for this org. The map's canvasser dropdown is
// populated from this — it must NOT depend on the current filters, or selecting a
// canvasser (or any filter that yields zero households) would empty the options
// and wedge the control. So we return it even on the empty-result paths.
async function loadCanvasserRoster(orgId) {
  const memberIds = await Membership.find({ organizationId: orgId, isActive: true }).distinct('userId');
  const users = await User.find(
    { _id: { $in: memberIds }, isActive: true },
    'firstName lastName email'
  )
    .sort({ firstName: 1 })
    .lean();
  return users.map((u) => ({
    id: String(u._id),
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
  }));
}

function ensureOrgScoped(req, res) {
  if (!activeOrgId(req)) {
    res.status(400).json({ error: 'Active organization required (X-Org-Id header)' });
    return false;
  }
  return true;
}

router.get('/map', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const userId =
      req.query.userId && mongoose.isValidObjectId(req.query.userId)
        ? new mongoose.Types.ObjectId(req.query.userId)
        : null;
    const status = Array.isArray(req.query.status)
      ? req.query.status
      : req.query.status
      ? String(req.query.status).split(',').filter(Boolean)
      : null;
    const questionKey = req.query.questionKey || null;
    const answerOption = req.query.option || null;

    const campaignId =
      req.query.campaignId && mongoose.isValidObjectId(req.query.campaignId)
        ? new mongoose.Types.ObjectId(req.query.campaignId)
        : null;

    // Scoped audit: narrow the map to one effort's doors, or one pass's books.
    const effortId =
      req.query.effortId && mongoose.isValidObjectId(req.query.effortId)
        ? new mongoose.Types.ObjectId(req.query.effortId)
        : null;
    const passId =
      req.query.passId && mongoose.isValidObjectId(req.query.passId)
        ? new mongoose.Types.ObjectId(req.query.passId)
        : null;

    // Date window in the campaign's (or org's) timezone — date-only days in, half-open
    // [start(fromDay), start(toDay+1)) out — so the map narrows to the same day window as
    // the dashboards. See docs/TIMEZONES.md.
    const fromDay = req.query.from ? String(req.query.from).slice(0, 10) : null;
    const toDay = req.query.to ? String(req.query.to).slice(0, 10) : null;
    const dateWindow = zonedDayRange(fromDay, toDay, await resolveMapTz(orgId, campaignId));

    const householdFilter = {
      organizationId: orgId,
      isActive: true,
      'location.coordinates': { $exists: true, $ne: null },
    };
    // When scoped to a round we filter by PER-ROUND status (resolved below), not
    // the global Household.status — so the door set matches the colors shown.
    if (status && status.length && !passId) householdFilter.status = { $in: status };
    if (campaignId) householdFilter.campaignId = campaignId;
    if (effortId) householdFilter.effortId = effortId;

    const surveyMatch = { organizationId: orgId };
    const activityMatch = { organizationId: orgId };
    if (dateWindow.$gte || dateWindow.$lt) {
      surveyMatch.submittedAt = dateWindow;
      activityMatch.timestamp = dateWindow;
    }
    if (userId) {
      surveyMatch.userId = userId;
      activityMatch.userId = userId;
    }
    if (campaignId) {
      surveyMatch.campaignId = campaignId;
      activityMatch.campaignId = campaignId;
    }
    // Scope activity/surveys to the selected round so "showing Pass N" reflects
    // that round's status + activity, not the global latest across all rounds.
    if (passId) {
      surveyMatch.passId = passId;
      activityMatch.passId = passId;
    }
    if (questionKey && answerOption) {
      surveyMatch.answers = {
        $elemMatch: { questionKey, answer: answerOption },
      };
    }

    // Pass scoping: limit to households that sit in this pass's books (Turf.householdIds).
    let passHhSet = null;
    if (passId) {
      const turfDocs = await Turf.find({ passId }, 'householdIds').lean();
      passHhSet = new Set();
      for (const t of turfDocs) for (const id of t.householdIds || []) passHhSet.add(String(id));
      if (passHhSet.size === 0) {
        return res.json({ households: [], canvassers: await loadCanvasserRoster(orgId), activities: [], total: 0 });
      }
    }

    const filteringInteractions =
      Boolean(fromDay || toDay || userId || (questionKey && answerOption));

    if (filteringInteractions || passHhSet) {
      let idStrings;
      if (filteringInteractions) {
        const [surveyHIds, activityHIds] = await Promise.all([
          SurveyResponse.distinct('householdId', surveyMatch),
          questionKey && answerOption
            ? Promise.resolve([])
            : CanvassActivity.distinct('householdId', activityMatch),
        ]);
        idStrings = [...new Set([...surveyHIds, ...activityHIds].map(String))];
        // Intersect the interaction set with the pass's households when both apply.
        if (passHhSet) idStrings = idStrings.filter((id) => passHhSet.has(id));
      } else {
        idStrings = [...passHhSet];
      }
      if (!idStrings.length) {
        return res.json({ households: [], canvassers: await loadCanvasserRoster(orgId), activities: [], total: 0 });
      }
      householdFilter._id = { $in: idStrings.map((id) => new mongoose.Types.ObjectId(id)) };
    }

    let households = await Household.find(
      householdFilter,
      'addressLine1 addressLine2 city state zipCode location status lastActionAt lastActionBy'
    ).lean();

    if (!households.length) {
      return res.json({ households: [], canvassers: await loadCanvasserRoster(orgId), activities: [], total: 0 });
    }

    let householdIds = households.map((h) => h._id);
    const includeActivities = req.query.includeActivities === '1';

    // Per-round door status when scoped to a pass (else the global Household.status).
    let passStatusMap = null;
    if (passId) {
      const camp = campaignId ? await Campaign.findById(campaignId, { type: 1 }).lean() : null;
      passStatusMap = await getPassStatusMap(passId, householdIds, camp?.type);
      // Apply the status filter against per-round status (not the global one).
      if (status && status.length) {
        const wanted = new Set(status);
        households = households.filter((h) => wanted.has(passStatusMap.get(String(h._id))?.status || 'unknocked'));
        householdIds = households.map((h) => h._id);
      }
    }

    const canvassers = await loadCanvasserRoster(orgId);

    const [voters, surveys, lastActivities, activities] = await Promise.all([
      Voter.find(
        { householdId: { $in: householdIds }, organizationId: orgId },
        'householdId fullName surveyStatus party'
      ).lean(),
      SurveyResponse.find({ householdId: { $in: householdIds }, organizationId: orgId, ...(passId ? { passId } : {}) })
        .populate('voterId', 'fullName')
        .populate('userId', 'firstName lastName')
        .lean(),
      CanvassActivity.aggregate([
        { $match: { householdId: { $in: householdIds }, organizationId: orgId, ...(passId ? { passId } : {}) } },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$householdId',
            actionType: { $first: '$actionType' },
            timestamp: { $first: '$timestamp' },
            userId: { $first: '$userId' },
          },
        },
      ]),
      includeActivities
        ? CanvassActivity.find(
            { ...activityMatch, householdId: { $in: householdIds } },
            'householdId userId actionType timestamp location distanceFromHouseMeters'
          )
            .populate('userId', 'firstName lastName')
            .lean()
        : Promise.resolve([]),
    ]);

    const votersByHh = new Map();
    for (const v of voters) {
      const k = String(v.householdId);
      if (!votersByHh.has(k)) votersByHh.set(k, []);
      votersByHh.get(k).push({
        id: String(v._id),
        fullName: v.fullName,
        surveyStatus: v.surveyStatus,
        party: v.party || null,
      });
    }

    const surveysByHh = new Map();
    for (const s of surveys) {
      const k = String(s.householdId);
      if (!surveysByHh.has(k)) surveysByHh.set(k, []);
      surveysByHh.get(k).push({
        id: String(s._id),
        submittedAt: s.submittedAt,
        voter: s.voterId
          ? { id: String(s.voterId._id), fullName: s.voterId.fullName }
          : null,
        canvasser: s.userId
          ? {
              id: String(s.userId._id),
              firstName: s.userId.firstName,
              lastName: s.userId.lastName,
            }
          : null,
        answers: s.answers || [],
        note: s.note || null,
      });
    }

    const lastActByHh = new Map();
    for (const a of lastActivities) lastActByHh.set(String(a._id), a);

    const userIds = [...new Set(lastActivities.map((a) => String(a.userId)).filter(Boolean))];
    const lastUsers = await User.find(
      { _id: { $in: userIds } },
      'firstName lastName'
    ).lean();
    const userMap = new Map(lastUsers.map((u) => [String(u._id), u]));

    const result = households.map((h) => {
      const last = lastActByHh.get(String(h._id));
      const lastUser = last && userMap.get(String(last.userId));
      return {
        id: String(h._id),
        addressLine1: h.addressLine1,
        addressLine2: h.addressLine2 || null,
        city: h.city,
        state: h.state,
        zipCode: h.zipCode,
        location: h.location?.coordinates
          ? { lng: h.location.coordinates[0], lat: h.location.coordinates[1] }
          : null,
        // Per-round: a door untouched THIS round reads 'unknocked' (fresh), not its
        // global latest. Only fall back to global status when not pass-scoped.
        status: passId ? passStatusMap?.get(String(h._id))?.status || 'unknocked' : h.status,
        lastActionAt: (passId ? last?.timestamp : h.lastActionAt) || last?.timestamp || null,
        lastAction: last
          ? {
              actionType: last.actionType,
              timestamp: last.timestamp,
              canvasser: lastUser
                ? {
                    id: String(lastUser._id),
                    firstName: lastUser.firstName,
                    lastName: lastUser.lastName,
                  }
                : null,
            }
          : null,
        voters: votersByHh.get(String(h._id)) || [],
        surveys: surveysByHh.get(String(h._id)) || [],
      };
    });

    res.json({
      households: result,
      canvassers,
      activities: activities.map((a) => ({
        id: String(a._id),
        householdId: String(a.householdId),
        actionType: a.actionType,
        timestamp: a.timestamp,
        location: a.location
          ? { lng: a.location.lng, lat: a.location.lat, accuracy: a.location.accuracy }
          : null,
        distanceFromHouseMeters: a.distanceFromHouseMeters,
        canvasser: a.userId
          ? {
              id: String(a.userId._id),
              firstName: a.userId.firstName,
              lastName: a.userId.lastName,
            }
          : null,
      })),
      total: result.length,
    });
  } catch (err) {
    next(err);
  }
});

// Per-door activity history across ALL rounds, grouped by round — powers the
// audit door-detail "History by round" so you can see a door worked in Round 1
// AND Round 2 (the latest-only map view hides this).
router.get('/:householdId/activity', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const { householdId } = req.params;
    if (!mongoose.isValidObjectId(householdId)) return res.status(400).json({ error: 'Invalid id' });
    const hid = new mongoose.Types.ObjectId(householdId);
    const name = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : null);

    const [acts, surveys] = await Promise.all([
      CanvassActivity.find(
        { householdId: hid, organizationId: orgId, actionType: { $ne: 'note_added' } },
        'actionType timestamp userId passId'
      )
        .populate('userId', 'firstName lastName')
        .lean(),
      SurveyResponse.find(
        { householdId: hid, organizationId: orgId },
        'submittedAt userId passId voterId'
      )
        .populate('userId', 'firstName lastName')
        .populate('voterId', 'fullName')
        .lean(),
    ]);

    const entries = [
      ...acts.map((a) => ({ kind: 'knock', actionType: a.actionType, at: a.timestamp, passId: a.passId ? String(a.passId) : null, canvasser: name(a.userId) })),
      ...surveys.map((s) => ({ kind: 'survey', actionType: 'survey_submitted', at: s.submittedAt, passId: s.passId ? String(s.passId) : null, canvasser: name(s.userId), voter: s.voterId?.fullName || null })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at));

    const passIds = [...new Set(entries.map((e) => e.passId).filter(Boolean))];
    const passes = passIds.length ? await Pass.find({ _id: { $in: passIds } }, 'roundNumber name').lean() : [];
    const passMap = new Map(passes.map((p) => [String(p._id), p]));

    const byPass = new Map();
    for (const e of entries) {
      const key = e.passId || 'none';
      if (!byPass.has(key)) byPass.set(key, []);
      byPass.get(key).push(e);
    }
    const rounds = [...byPass.entries()]
      .map(([key, items]) => {
        const p = key === 'none' ? null : passMap.get(key);
        return {
          passId: key === 'none' ? null : key,
          roundNumber: p?.roundNumber ?? null,
          name: p?.name || (key === 'none' ? 'Before rounds' : 'Round'),
          entries: items,
        };
      })
      .sort((a, b) => (b.roundNumber ?? -1) - (a.roundNumber ?? -1));

    res.json({ rounds });
  } catch (err) {
    next(err);
  }
});

export default router;
