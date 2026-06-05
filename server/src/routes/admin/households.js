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
    if (status && status.length) householdFilter.status = { $in: status };
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

    const households = await Household.find(
      householdFilter,
      'addressLine1 addressLine2 city state zipCode location status lastActionAt lastActionBy'
    ).lean();

    if (!households.length) {
      return res.json({ households: [], canvassers: await loadCanvasserRoster(orgId), activities: [], total: 0 });
    }

    const householdIds = households.map((h) => h._id);
    const includeActivities = req.query.includeActivities === '1';

    const canvassers = await loadCanvasserRoster(orgId);

    const [voters, surveys, lastActivities, activities] = await Promise.all([
      Voter.find(
        { householdId: { $in: householdIds }, organizationId: orgId },
        'householdId fullName surveyStatus party'
      ).lean(),
      SurveyResponse.find({ householdId: { $in: householdIds }, organizationId: orgId })
        .populate('voterId', 'fullName')
        .populate('userId', 'firstName lastName')
        .lean(),
      CanvassActivity.aggregate([
        { $match: { householdId: { $in: householdIds }, organizationId: orgId } },
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
        status: h.status,
        lastActionAt: h.lastActionAt || last?.timestamp || null,
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

export default router;
