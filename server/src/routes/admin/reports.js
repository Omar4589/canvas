import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { User } from '../../models/User.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

function parseDateRange(req, field) {
  const { from, to } = req.query;
  if (!from && !to) return {};
  const range = {};
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) range.$gte = d;
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) range.$lte = d;
  }
  if (!range.$gte && !range.$lte) return {};
  return { [field]: range };
}

router.get('/overview', async (req, res, next) => {
  try {
    const [
      households,
      voters,
      activeUsers,
      surveysSubmitted,
      homesKnocked,
      statusAgg,
      eventAgg,
    ] = await Promise.all([
      Household.countDocuments({ isActive: true }),
      Voter.countDocuments({}),
      User.countDocuments({ isActive: true }),
      SurveyResponse.countDocuments({}),
      Household.countDocuments({ isActive: true, status: { $ne: 'unknocked' } }),
      Household.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      CanvassActivity.aggregate([
        { $group: { _id: '$actionType', count: { $sum: 1 } } },
      ]),
    ]);

    const canvass = { unknocked: 0, not_home: 0, surveyed: 0, wrong_address: 0 };
    for (const r of statusAgg) canvass[r._id] = r.count;

    const events = { notHome: 0, wrongAddress: 0, surveySubmitted: 0 };
    for (const r of eventAgg) {
      if (r._id === 'not_home') events.notHome = r.count;
      else if (r._id === 'wrong_address') events.wrongAddress = r.count;
      else if (r._id === 'survey_submitted') events.surveySubmitted = r.count;
    }

    res.json({
      totals: { households, voters, activeUsers, surveysSubmitted, homesKnocked },
      canvass,
      events,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/canvassers', async (req, res, next) => {
  try {
    const surveyMatch = parseDateRange(req, 'submittedAt');
    const activityMatch = parseDateRange(req, 'timestamp');

    const [surveyAgg, activityAgg] = await Promise.all([
      SurveyResponse.aggregate([
        ...(Object.keys(surveyMatch).length ? [{ $match: surveyMatch }] : []),
        {
          $group: {
            _id: '$userId',
            surveysSubmitted: { $sum: 1 },
            lastSurveyAt: { $max: '$submittedAt' },
          },
        },
      ]),
      CanvassActivity.aggregate([
        ...(Object.keys(activityMatch).length ? [{ $match: activityMatch }] : []),
        {
          $group: {
            _id: { userId: '$userId', actionType: '$actionType' },
            count: { $sum: 1 },
            lastAt: { $max: '$timestamp' },
          },
        },
      ]),
    ]);

    const byUser = new Map();
    const ensure = (id) => {
      const key = String(id);
      if (!byUser.has(key)) {
        byUser.set(key, {
          userId: key,
          surveysSubmitted: 0,
          notHome: 0,
          wrongAddress: 0,
          lastActivityAt: null,
        });
      }
      return byUser.get(key);
    };

    for (const row of surveyAgg) {
      const u = ensure(row._id);
      u.surveysSubmitted = row.surveysSubmitted;
      if (row.lastSurveyAt && (!u.lastActivityAt || row.lastSurveyAt > u.lastActivityAt)) {
        u.lastActivityAt = row.lastSurveyAt;
      }
    }
    for (const row of activityAgg) {
      const u = ensure(row._id.userId);
      if (row._id.actionType === 'not_home') u.notHome = row.count;
      else if (row._id.actionType === 'wrong_address') u.wrongAddress = row.count;
      if (row.lastAt && (!u.lastActivityAt || row.lastAt > u.lastActivityAt)) {
        u.lastActivityAt = row.lastAt;
      }
    }

    const userIds = Array.from(byUser.keys()).map((id) => new mongoose.Types.ObjectId(id));
    const users = await User.find(
      { _id: { $in: userIds } },
      'firstName lastName email isActive'
    ).lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const rows = Array.from(byUser.values())
      .map((u) => {
        const info = userMap.get(u.userId);
        return {
          userId: u.userId,
          firstName: info?.firstName || '',
          lastName: info?.lastName || '',
          email: info?.email || '',
          isActive: info?.isActive ?? false,
          surveysSubmitted: u.surveysSubmitted,
          notHome: u.notHome,
          wrongAddress: u.wrongAddress,
          homesKnocked: u.surveysSubmitted + u.notHome + u.wrongAddress,
          lastActivityAt: u.lastActivityAt,
        };
      })
      .sort((a, b) => {
        if (b.surveysSubmitted !== a.surveysSubmitted) return b.surveysSubmitted - a.surveysSubmitted;
        return b.homesKnocked - a.homesKnocked;
      });

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/surveys', async (req, res, next) => {
  try {
    const [templates, responseCounts] = await Promise.all([
      SurveyTemplate.find({}, 'name version isActive').sort({ updatedAt: -1 }).lean(),
      SurveyResponse.aggregate([
        { $group: { _id: '$surveyTemplateId', count: { $sum: 1 } } },
      ]),
    ]);

    const counts = new Map(responseCounts.map((r) => [String(r._id), r.count]));
    const rows = templates
      .map((t) => ({
        id: String(t._id),
        name: t.name,
        version: t.version,
        isActive: t.isActive,
        responseCount: counts.get(String(t._id)) || 0,
      }))
      .filter((t) => t.isActive || t.responseCount > 0)
      .sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return b.responseCount - a.responseCount;
      });

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/survey-results', async (req, res, next) => {
  try {
    const { surveyTemplateId } = req.query;
    let template = null;
    if (surveyTemplateId && mongoose.isValidObjectId(surveyTemplateId)) {
      template = await SurveyTemplate.findById(surveyTemplateId).lean();
    }
    if (!template) {
      template = await SurveyTemplate.findOne({ isActive: true }).lean();
    }
    if (!template) {
      return res.json({ surveyTemplate: null, totalResponses: 0, questions: [] });
    }

    const dateRange = parseDateRange(req, 'submittedAt');
    const match = { surveyTemplateId: template._id, ...dateRange };
    const totalResponses = await SurveyResponse.countDocuments(match);

    const voterPreviewLimit = Math.min(
      Math.max(parseInt(req.query.voterPreview, 10) || 0, 0),
      20
    );

    const questions = [];
    const sortedQs = [...(template.questions || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

    // First pass: aggregate counts (and gather top-N response IDs per option if requested).
    const aggResults = [];
    for (const q of sortedQs) {
      const pipeline = [
        { $match: match },
        { $unwind: '$answers' },
        { $match: { 'answers.questionKey': q.key } },
      ];

      if (q.type === 'multiple_choice') {
        pipeline.push({ $unwind: '$answers.answer' });
      }

      // For non-text questions with voter preview, sort by submittedAt desc so the first
      // N pushed into each group are the latest responses.
      const wantsPreview = voterPreviewLimit > 0 && q.type !== 'text';
      if (wantsPreview) {
        pipeline.push({ $sort: { submittedAt: -1 } });
      }

      const groupStage = {
        _id: '$answers.answer',
        count: { $sum: 1 },
      };
      if (wantsPreview) {
        groupStage.responseIds = { $push: '$_id' };
      }
      pipeline.push({ $group: groupStage });

      if (wantsPreview) {
        pipeline.push({
          $project: {
            count: 1,
            responseIds: { $slice: ['$responseIds', voterPreviewLimit] },
          },
        });
      }

      pipeline.push({ $sort: { count: -1 } });
      if (q.type === 'text') {
        pipeline.push({ $limit: 10 });
      }

      const agg = await SurveyResponse.aggregate(pipeline);
      aggResults.push({ q, agg });
    }

    // Collect every response ID we'll need to populate, so we can fetch in one batch.
    const allResponseIds = new Set();
    for (const { q, agg } of aggResults) {
      if (q.type === 'text') continue;
      for (const row of agg) {
        for (const id of row.responseIds || []) allResponseIds.add(String(id));
      }
    }

    let responseLookup = new Map();
    if (allResponseIds.size > 0) {
      const ids = Array.from(allResponseIds).map((id) => new mongoose.Types.ObjectId(id));
      const responses = await SurveyResponse.find({ _id: { $in: ids } })
        .populate('voterId', 'fullName party')
        .populate('householdId', 'addressLine1 city state')
        .populate('userId', 'firstName lastName')
        .lean();
      responseLookup = new Map(responses.map((r) => [String(r._id), r]));
    }

    function shapeVoter(r) {
      return {
        responseId: String(r._id),
        submittedAt: r.submittedAt,
        voter: r.voterId
          ? {
              id: String(r.voterId._id),
              fullName: r.voterId.fullName,
              party: r.voterId.party || null,
            }
          : null,
        household: r.householdId
          ? {
              id: String(r.householdId._id),
              addressLine1: r.householdId.addressLine1,
              city: r.householdId.city,
              state: r.householdId.state,
            }
          : null,
        canvasser: r.userId
          ? {
              id: String(r.userId._id),
              firstName: r.userId.firstName,
              lastName: r.userId.lastName,
            }
          : null,
      };
    }

    for (const { q, agg } of aggResults) {
      const options = agg
        .filter((r) => r._id !== null && r._id !== undefined && r._id !== '')
        .map((r) => {
          const out = {
            option: typeof r._id === 'string' ? r._id : String(r._id),
            count: r.count,
            percent: totalResponses > 0 ? Math.round((r.count / totalResponses) * 1000) / 10 : 0,
          };
          if (voterPreviewLimit > 0 && q.type !== 'text') {
            out.voters = (r.responseIds || [])
              .map((id) => responseLookup.get(String(id)))
              .filter(Boolean)
              .map(shapeVoter);
          }
          return out;
        });

      questions.push({
        key: q.key,
        label: q.label,
        type: q.type,
        options,
      });
    }

    res.json({
      surveyTemplate: {
        id: String(template._id),
        name: template.name,
        version: template.version,
        isActive: template.isActive,
      },
      totalResponses,
      questions,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/voters-by-answer', async (req, res, next) => {
  try {
    const { questionKey, option, surveyTemplateId } = req.query;
    if (!questionKey || !option) {
      return res.status(400).json({ error: 'questionKey and option are required' });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 200);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    const dateRange = parseDateRange(req, 'submittedAt');
    const filter = {
      ...dateRange,
      answers: { $elemMatch: { questionKey, answer: option } },
    };
    if (surveyTemplateId && mongoose.isValidObjectId(surveyTemplateId)) {
      filter.surveyTemplateId = new mongoose.Types.ObjectId(surveyTemplateId);
    }

    const [total, responses] = await Promise.all([
      SurveyResponse.countDocuments(filter),
      SurveyResponse.find(filter)
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('voterId', 'fullName party')
        .populate('householdId', 'addressLine1 city state')
        .populate('userId', 'firstName lastName')
        .lean(),
    ]);

    res.json({
      total,
      voters: responses.map((r) => ({
        responseId: String(r._id),
        submittedAt: r.submittedAt,
        voter: r.voterId
          ? {
              id: String(r.voterId._id),
              fullName: r.voterId.fullName,
              party: r.voterId.party || null,
            }
          : null,
        household: r.householdId
          ? {
              id: String(r.householdId._id),
              addressLine1: r.householdId.addressLine1,
              city: r.householdId.city,
              state: r.householdId.state,
            }
          : null,
        canvasser: r.userId
          ? {
              id: String(r.userId._id),
              firstName: r.userId.firstName,
              lastName: r.userId.lastName,
            }
          : null,
        note: r.note || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/canvassers/:userId/responses', async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const skip = parseInt(req.query.skip, 10) || 0;
    const dateRange = parseDateRange(req, 'submittedAt');
    const filter = { userId: new mongoose.Types.ObjectId(userId), ...dateRange };

    const [user, total, responses] = await Promise.all([
      User.findById(userId, 'firstName lastName email').lean(),
      SurveyResponse.countDocuments(filter),
      SurveyResponse.find(filter)
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('voterId', 'fullName')
        .populate('householdId', 'addressLine1 city state')
        .populate('surveyTemplateId', 'name version')
        .lean(),
    ]);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: String(user._id),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
      total,
      responses: responses.map((r) => ({
        id: String(r._id),
        submittedAt: r.submittedAt,
        surveyTemplate: r.surveyTemplateId
          ? {
              id: String(r.surveyTemplateId._id),
              name: r.surveyTemplateId.name,
              version: r.surveyTemplateVersion ?? r.surveyTemplateId.version,
            }
          : null,
        voter: r.voterId
          ? { id: String(r.voterId._id), fullName: r.voterId.fullName }
          : null,
        household: r.householdId
          ? {
              id: String(r.householdId._id),
              addressLine1: r.householdId.addressLine1,
              city: r.householdId.city,
              state: r.householdId.state,
            }
          : null,
        answers: r.answers || [],
        note: r.note || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
