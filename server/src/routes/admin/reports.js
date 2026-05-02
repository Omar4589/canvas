import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { Campaign } from '../../models/Campaign.js';
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

function campaignFilter(req) {
  const { campaignId } = req.query;
  if (campaignId && mongoose.isValidObjectId(campaignId)) {
    return { campaignId: new mongoose.Types.ObjectId(campaignId) };
  }
  return {};
}

router.get('/overview', async (req, res, next) => {
  try {
    const cFilter = campaignFilter(req);
    const householdMatch = { isActive: true, ...cFilter };

    const [
      households,
      voterDocs,
      activeUsers,
      surveysSubmitted,
      homesKnocked,
      statusAgg,
      eventAgg,
    ] = await Promise.all([
      Household.countDocuments(householdMatch),
      Household.find(householdMatch, { _id: 1 }).lean(),
      User.countDocuments({ isActive: true }),
      SurveyResponse.countDocuments(cFilter),
      Household.countDocuments({ ...householdMatch, status: { $ne: 'unknocked' } }),
      Household.aggregate([
        { $match: householdMatch },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      CanvassActivity.aggregate([
        ...(Object.keys(cFilter).length ? [{ $match: cFilter }] : []),
        { $group: { _id: '$actionType', count: { $sum: 1 } } },
      ]),
    ]);

    const voterIds = voterDocs.map((h) => h._id);
    const voters = await Voter.countDocuments({ householdId: { $in: voterIds } });

    const canvass = {
      unknocked: 0,
      not_home: 0,
      surveyed: 0,
      wrong_address: 0,
      lit_dropped: 0,
    };
    for (const r of statusAgg) canvass[r._id] = r.count;

    const events = { notHome: 0, wrongAddress: 0, surveySubmitted: 0, litDropped: 0 };
    for (const r of eventAgg) {
      if (r._id === 'not_home') events.notHome = r.count;
      else if (r._id === 'wrong_address') events.wrongAddress = r.count;
      else if (r._id === 'survey_submitted') events.surveySubmitted = r.count;
      else if (r._id === 'lit_dropped') events.litDropped = r.count;
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
    const cFilter = campaignFilter(req);
    const surveyMatch = { ...parseDateRange(req, 'submittedAt'), ...cFilter };
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter };

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
          litDropped: 0,
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
      else if (row._id.actionType === 'lit_dropped') u.litDropped = row.count;
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
          litDropped: u.litDropped,
          homesKnocked:
            u.surveysSubmitted + u.notHome + u.wrongAddress + u.litDropped,
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
    const cFilter = campaignFilter(req);

    let templateFilter = {};
    if (cFilter.campaignId) {
      const campaign = await Campaign.findById(cFilter.campaignId).lean();
      if (campaign?.surveyTemplateId) {
        templateFilter = { _id: campaign.surveyTemplateId };
      } else {
        return res.json([]);
      }
    }

    const [templates, responseCounts] = await Promise.all([
      SurveyTemplate.find(templateFilter, 'name version').sort({ updatedAt: -1 }).lean(),
      SurveyResponse.aggregate([
        ...(Object.keys(cFilter).length ? [{ $match: cFilter }] : []),
        { $group: { _id: '$surveyTemplateId', count: { $sum: 1 } } },
      ]),
    ]);

    const counts = new Map(responseCounts.map((r) => [String(r._id), r.count]));
    const rows = templates
      .map((t) => ({
        id: String(t._id),
        name: t.name,
        version: t.version,
        responseCount: counts.get(String(t._id)) || 0,
      }))
      .filter((t) => t.responseCount > 0 || !cFilter.campaignId)
      .sort((a, b) => b.responseCount - a.responseCount);

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/survey-results', async (req, res, next) => {
  try {
    const cFilter = campaignFilter(req);
    let { surveyTemplateId } = req.query;

    let template = null;
    if (surveyTemplateId && mongoose.isValidObjectId(surveyTemplateId)) {
      template = await SurveyTemplate.findById(surveyTemplateId).lean();
    }
    if (!template && cFilter.campaignId) {
      const campaign = await Campaign.findById(cFilter.campaignId).lean();
      if (campaign?.surveyTemplateId) {
        template = await SurveyTemplate.findById(campaign.surveyTemplateId).lean();
      }
    }
    if (!template) {
      return res.json({ surveyTemplate: null, totalResponses: 0, questions: [] });
    }

    const dateRange = parseDateRange(req, 'submittedAt');
    const match = { surveyTemplateId: template._id, ...dateRange, ...cFilter };
    const totalResponses = await SurveyResponse.countDocuments(match);

    const voterPreviewLimit = Math.min(
      Math.max(parseInt(req.query.voterPreview, 10) || 0, 0),
      20
    );

    const questions = [];
    const sortedQs = [...(template.questions || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

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
    const cFilter = campaignFilter(req);
    const filter = {
      ...dateRange,
      ...cFilter,
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

router.get('/overlaps', async (req, res, next) => {
  try {
    const cFilter = campaignFilter(req);
    const dateRange = parseDateRange(req, 'timestamp');
    const match = {
      ...cFilter,
      ...dateRange,
      actionType: { $in: ['not_home', 'wrong_address', 'survey_submitted', 'lit_dropped'] },
    };

    // Per-canvasser overwrite already guarantees one row per (canvasser, household).
    // Group by household — any household with count > 1 has been touched by 2+
    // distinct canvassers in this range.
    const overlaps = await CanvassActivity.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$householdId',
          canvassers: {
            $push: {
              userId: '$userId',
              actionType: '$actionType',
              timestamp: '$timestamp',
            },
          },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 200 },
    ]);

    if (!overlaps.length) {
      return res.json({ overlaps: [], total: 0 });
    }

    const householdIds = overlaps.map((o) => o._id);
    const userIds = [
      ...new Set(
        overlaps.flatMap((o) => o.canvassers.map((c) => String(c.userId)))
      ),
    ].map((id) => new mongoose.Types.ObjectId(id));

    const [households, users] = await Promise.all([
      Household.find(
        { _id: { $in: householdIds } },
        'addressLine1 addressLine2 city state zipCode location'
      ).lean(),
      User.find({ _id: { $in: userIds } }, 'firstName lastName email').lean(),
    ]);

    const hMap = new Map(households.map((h) => [String(h._id), h]));
    const uMap = new Map(users.map((u) => [String(u._id), u]));

    const result = overlaps
      .map((o) => {
        const h = hMap.get(String(o._id));
        if (!h) return null;
        return {
          household: {
            id: String(h._id),
            addressLine1: h.addressLine1,
            addressLine2: h.addressLine2 || null,
            city: h.city,
            state: h.state,
            zipCode: h.zipCode,
          },
          count: o.count,
          canvassers: o.canvassers
            .map((c) => {
              const u = uMap.get(String(c.userId));
              return {
                userId: String(c.userId),
                firstName: u?.firstName || '',
                lastName: u?.lastName || '',
                email: u?.email || '',
                actionType: c.actionType,
                timestamp: c.timestamp,
              };
            })
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
        };
      })
      .filter(Boolean);

    res.json({ overlaps: result, total: result.length });
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
    const cFilter = campaignFilter(req);
    const filter = {
      userId: new mongoose.Types.ObjectId(userId),
      ...dateRange,
      ...cFilter,
    };

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
