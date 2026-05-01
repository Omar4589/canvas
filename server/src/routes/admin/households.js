import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { User } from '../../models/User.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

router.get('/map', async (req, res, next) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
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

    // Households we display: active + have coordinates.
    const householdFilter = {
      isActive: true,
      'location.coordinates': { $exists: true, $ne: null },
    };
    if (status && status.length) householdFilter.status = { $in: status };
    if (campaignId) householdFilter.campaignId = campaignId;

    // Build SurveyResponse + CanvassActivity match scoped by date/user/answer.
    const surveyMatch = {};
    const activityMatch = {};
    if (from) {
      surveyMatch.submittedAt = { ...(surveyMatch.submittedAt || {}), $gte: from };
      activityMatch.timestamp = { ...(activityMatch.timestamp || {}), $gte: from };
    }
    if (to) {
      surveyMatch.submittedAt = { ...(surveyMatch.submittedAt || {}), $lte: to };
      activityMatch.timestamp = { ...(activityMatch.timestamp || {}), $lte: to };
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

    const filteringInteractions =
      Boolean(from || to || userId || (questionKey && answerOption));

    // If we're filtering by interaction (date/user/answer), restrict households
    // to those with at least one matching SurveyResponse OR matching CanvassActivity.
    let interactedHouseholdIds = null;
    if (filteringInteractions) {
      const [surveyHIds, activityHIds] = await Promise.all([
        SurveyResponse.distinct('householdId', surveyMatch),
        // If we're filtering by an answer, only surveys count — activities have no answers.
        questionKey && answerOption
          ? Promise.resolve([])
          : CanvassActivity.distinct('householdId', activityMatch),
      ]);
      const set = new Set([...surveyHIds, ...activityHIds].map(String));
      interactedHouseholdIds = Array.from(set).map(
        (id) => new mongoose.Types.ObjectId(id)
      );
      if (!interactedHouseholdIds.length) {
        return res.json({ households: [], canvassers: [], total: 0 });
      }
      householdFilter._id = { $in: interactedHouseholdIds };
    }

    const households = await Household.find(
      householdFilter,
      'addressLine1 addressLine2 city state zipCode location status lastActionAt lastActionBy'
    ).lean();

    if (!households.length) {
      return res.json({ households: [], canvassers: [], total: 0 });
    }

    const householdIds = households.map((h) => h._id);
    const includeActivities = req.query.includeActivities === '1';

    const [voters, surveys, lastActivities, allCanvassers, activities] = await Promise.all([
      Voter.find(
        { householdId: { $in: householdIds } },
        'householdId fullName surveyStatus party'
      ).lean(),
      SurveyResponse.find(
        // for popup: ALL surveys at these houses (so popup is informative even if filter is on activity-only)
        { householdId: { $in: householdIds } }
      )
        .populate('voterId', 'fullName')
        .populate('userId', 'firstName lastName')
        .lean(),
      CanvassActivity.aggregate([
        { $match: { householdId: { $in: householdIds } } },
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
      // Distinct list of canvassers who have any activity (used to populate the filter dropdown).
      User.find({ isActive: true }, 'firstName lastName email').sort({ firstName: 1 }).lean(),
      // Raw GPS pings for each activity, only when requested (the canvasser-pin overlay).
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
      canvassers: allCanvassers.map((u) => ({
        id: String(u._id),
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
      })),
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
