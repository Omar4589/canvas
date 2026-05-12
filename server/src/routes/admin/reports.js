import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));

function activeOrgId(req) {
  return req.activeOrg?._id;
}

function ensureOrgScoped(req, res) {
  if (!activeOrgId(req)) {
    res.status(400).json({ error: 'Active organization required (X-Org-Id header)' });
    return false;
  }
  return true;
}

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

function baseFilter(req) {
  const orgId = activeOrgId(req);
  const filter = { organizationId: orgId };
  if (req.query.campaignId && mongoose.isValidObjectId(req.query.campaignId)) {
    filter.campaignId = new mongoose.Types.ObjectId(req.query.campaignId);
  }
  return filter;
}

// Action types that count as a "knock" (a door interaction). note_added is excluded
// because it can be left without an actual visit decision.
const KNOCK_ACTIONS = ['not_home', 'wrong_address', 'survey_submitted', 'lit_dropped'];

function parseUserIdParam(req, res) {
  const { userId } = req.params;
  if (!mongoose.isValidObjectId(userId)) {
    res.status(400).json({ error: 'Invalid userId' });
    return null;
  }
  return new mongoose.Types.ObjectId(userId);
}

function tzOf(req) {
  const tz = (req.query.tz || '').trim();
  // mongo accepts IANA TZ names; bail to UTC if not provided
  return tz || 'UTC';
}

function dayBucketExpr(field, tz) {
  return { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: tz } };
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(headers, rows) {
  const out = [headers.map(csvCell).join(',')];
  for (const row of rows) out.push(row.map(csvCell).join(','));
  return out.join('\n');
}

function streetAddress(h) {
  if (!h) return '';
  const line2 = h.addressLine2 ? `, ${h.addressLine2}` : '';
  return `${h.addressLine1 || ''}${line2}, ${h.city || ''}, ${h.state || ''} ${h.zipCode || ''}`.trim();
}

router.get('/overview', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const cFilter = baseFilter(req);
    const householdMatch = { isActive: true, ...cFilter };

    const memberCountPromise = Membership.countDocuments({
      organizationId: orgId,
      isActive: true,
    });

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
      memberCountPromise,
      SurveyResponse.countDocuments(cFilter),
      Household.countDocuments({ ...householdMatch, status: { $ne: 'unknocked' } }),
      Household.aggregate([
        { $match: householdMatch },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      CanvassActivity.aggregate([
        { $match: cFilter },
        { $group: { _id: '$actionType', count: { $sum: 1 } } },
      ]),
    ]);

    const voterIds = voterDocs.map((h) => h._id);
    const voters = await Voter.countDocuments({
      householdId: { $in: voterIds },
      organizationId: orgId,
    });

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
    if (!ensureOrgScoped(req, res)) return;
    const cFilter = baseFilter(req);
    const surveyMatch = { ...parseDateRange(req, 'submittedAt'), ...cFilter };
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter };

    const [surveyAgg, activityAgg, rangeAgg] = await Promise.all([
      SurveyResponse.aggregate([
        { $match: surveyMatch },
        {
          $group: {
            _id: '$userId',
            surveysSubmitted: { $sum: 1 },
            lastSurveyAt: { $max: '$submittedAt' },
          },
        },
      ]),
      CanvassActivity.aggregate([
        { $match: activityMatch },
        {
          $group: {
            _id: { userId: '$userId', actionType: '$actionType' },
            count: { $sum: 1 },
            lastAt: { $max: '$timestamp' },
          },
        },
      ]),
      CanvassActivity.aggregate([
        { $match: activityMatch },
        {
          $group: {
            _id: '$userId',
            firstActivityAt: { $min: '$timestamp' },
            lastActivityAt: { $max: '$timestamp' },
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
          firstActivityAt: null,
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
    for (const row of rangeAgg) {
      const u = ensure(row._id);
      u.firstActivityAt = row.firstActivityAt;
      if (
        row.lastActivityAt &&
        (!u.lastActivityAt || row.lastActivityAt > u.lastActivityAt)
      ) {
        u.lastActivityAt = row.lastActivityAt;
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
          firstActivityAt: u.firstActivityAt,
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
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const cFilter = baseFilter(req);

    let templateFilter = { organizationId: orgId };
    if (cFilter.campaignId) {
      const campaign = await Campaign.findOne({ _id: cFilter.campaignId, organizationId: orgId }).lean();
      if (campaign?.surveyTemplateId) {
        templateFilter = { _id: campaign.surveyTemplateId, organizationId: orgId };
      } else {
        return res.json([]);
      }
    }

    const [templates, responseCounts] = await Promise.all([
      SurveyTemplate.find(templateFilter, 'name version').sort({ updatedAt: -1 }).lean(),
      SurveyResponse.aggregate([
        { $match: cFilter },
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
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const cFilter = baseFilter(req);
    let { surveyTemplateId } = req.query;

    let template = null;
    if (surveyTemplateId && mongoose.isValidObjectId(surveyTemplateId)) {
      template = await SurveyTemplate.findOne({
        _id: surveyTemplateId,
        organizationId: orgId,
      }).lean();
    }
    if (!template && cFilter.campaignId) {
      const campaign = await Campaign.findOne({ _id: cFilter.campaignId, organizationId: orgId }).lean();
      if (campaign?.surveyTemplateId) {
        template = await SurveyTemplate.findOne({
          _id: campaign.surveyTemplateId,
          organizationId: orgId,
        }).lean();
      }
    }
    if (!template) {
      return res.json({ surveyTemplate: null, totalResponses: 0, questions: [] });
    }

    const dateRange = parseDateRange(req, 'submittedAt');
    const userIdParam =
      req.query.userId && mongoose.isValidObjectId(req.query.userId)
        ? new mongoose.Types.ObjectId(req.query.userId)
        : null;
    const compareToOrg = req.query.compareToOrg === 'true' && !!userIdParam;
    const baseMatch = { surveyTemplateId: template._id, ...dateRange, ...cFilter };
    const match = userIdParam ? { ...baseMatch, userId: userIdParam } : baseMatch;
    const [totalResponses, orgTotalResponses] = await Promise.all([
      SurveyResponse.countDocuments(match),
      compareToOrg ? SurveyResponse.countDocuments(baseMatch) : Promise.resolve(null),
    ]);

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

      let orgAgg = null;
      if (compareToOrg) {
        // Same pipeline but matched against the whole org (no userId scope) so we
        // can show "this canvasser vs everyone" on each option.
        const orgPipeline = [
          { $match: baseMatch },
          { $unwind: '$answers' },
          { $match: { 'answers.questionKey': q.key } },
        ];
        if (q.type === 'multiple_choice') {
          orgPipeline.push({ $unwind: '$answers.answer' });
        }
        orgPipeline.push({ $group: { _id: '$answers.answer', count: { $sum: 1 } } });
        orgAgg = await SurveyResponse.aggregate(orgPipeline);
      }

      aggResults.push({ q, agg, orgAgg });
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
      const responses = await SurveyResponse.find({ _id: { $in: ids }, organizationId: orgId })
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

    for (const { q, agg, orgAgg } of aggResults) {
      const orgMap = new Map();
      if (orgAgg) {
        for (const r of orgAgg) {
          const key = typeof r._id === 'string' ? r._id : String(r._id);
          orgMap.set(key, r.count);
        }
      }

      const options = agg
        .filter((r) => r._id !== null && r._id !== undefined && r._id !== '')
        .map((r) => {
          const optionKey = typeof r._id === 'string' ? r._id : String(r._id);
          const out = {
            option: optionKey,
            count: r.count,
            percent: totalResponses > 0 ? Math.round((r.count / totalResponses) * 1000) / 10 : 0,
          };
          if (compareToOrg) {
            const orgCount = orgMap.get(optionKey) || 0;
            out.orgCount = orgCount;
            out.orgPercent =
              orgTotalResponses > 0
                ? Math.round((orgCount / orgTotalResponses) * 1000) / 10
                : 0;
          }
          if (voterPreviewLimit > 0 && q.type !== 'text') {
            out.voters = (r.responseIds || [])
              .map((id) => responseLookup.get(String(id)))
              .filter(Boolean)
              .map(shapeVoter);
          }
          return out;
        });

      // When comparing, also surface org-only options the canvasser never picked
      // (so the bar chart shows zero for them rather than hiding the gap).
      if (compareToOrg) {
        const seen = new Set(options.map((o) => o.option));
        for (const [opt, orgCount] of orgMap.entries()) {
          if (seen.has(opt) || opt === '' || opt === 'null' || opt === 'undefined') continue;
          options.push({
            option: opt,
            count: 0,
            percent: 0,
            orgCount,
            orgPercent:
              orgTotalResponses > 0
                ? Math.round((orgCount / orgTotalResponses) * 1000) / 10
                : 0,
          });
        }
      }

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
      orgTotalResponses: compareToOrg ? orgTotalResponses : undefined,
      compareToOrg,
      userId: userIdParam ? String(userIdParam) : null,
      questions,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/voters-by-answer', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const { questionKey, option, surveyTemplateId } = req.query;
    if (!questionKey || !option) {
      return res.status(400).json({ error: 'questionKey and option are required' });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 200);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    const dateRange = parseDateRange(req, 'submittedAt');
    const cFilter = baseFilter(req);
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
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const cFilter = baseFilter(req);
    const dateRange = parseDateRange(req, 'timestamp');
    const match = {
      ...cFilter,
      ...dateRange,
      actionType: { $in: ['not_home', 'wrong_address', 'survey_submitted', 'lit_dropped'] },
    };

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
        { _id: { $in: householdIds }, organizationId: orgId },
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
    if (!ensureOrgScoped(req, res)) return;
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const skip = parseInt(req.query.skip, 10) || 0;
    const dateRange = parseDateRange(req, 'submittedAt');
    const cFilter = baseFilter(req);
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

// ─────────────────────────────────────────────────────────────────────────────
// Canvasser audit drilldown
// ─────────────────────────────────────────────────────────────────────────────

// Leaderboard CSV export — same shape as GET /canvassers, rendered as text/csv.
router.get('/canvassers.csv', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const cFilter = baseFilter(req);
    const tz = tzOf(req);
    const surveyMatch = { ...parseDateRange(req, 'submittedAt'), ...cFilter };
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter };

    const [surveyAgg, activityAgg, hoursAgg] = await Promise.all([
      SurveyResponse.aggregate([
        { $match: surveyMatch },
        { $group: { _id: '$userId', surveysSubmitted: { $sum: 1 } } },
      ]),
      CanvassActivity.aggregate([
        { $match: activityMatch },
        {
          $group: {
            _id: { userId: '$userId', actionType: '$actionType' },
            count: { $sum: 1 },
            firstAt: { $min: '$timestamp' },
            lastAt: { $max: '$timestamp' },
          },
        },
      ]),
      CanvassActivity.aggregate([
        { $match: activityMatch },
        {
          $group: {
            _id: { userId: '$userId', day: dayBucketExpr('timestamp', tz) },
            first: { $min: '$timestamp' },
            last: { $max: '$timestamp' },
          },
        },
        {
          $group: {
            _id: '$_id.userId',
            hoursOnDoors: {
              $sum: { $divide: [{ $subtract: ['$last', '$first'] }, 3600000] },
            },
            daysActive: { $sum: 1 },
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
          firstActivityAt: null,
          lastActivityAt: null,
          hoursOnDoors: 0,
          daysActive: 0,
        });
      }
      return byUser.get(key);
    };
    for (const r of surveyAgg) ensure(r._id).surveysSubmitted = r.surveysSubmitted;
    for (const r of activityAgg) {
      const u = ensure(r._id.userId);
      if (r._id.actionType === 'not_home') u.notHome = r.count;
      else if (r._id.actionType === 'wrong_address') u.wrongAddress = r.count;
      else if (r._id.actionType === 'lit_dropped') u.litDropped = r.count;
      if (!u.firstActivityAt || r.firstAt < u.firstActivityAt) u.firstActivityAt = r.firstAt;
      if (!u.lastActivityAt || r.lastAt > u.lastActivityAt) u.lastActivityAt = r.lastAt;
    }
    for (const r of hoursAgg) {
      const u = ensure(r._id);
      u.hoursOnDoors = r.hoursOnDoors;
      u.daysActive = r.daysActive;
    }

    const userIds = Array.from(byUser.keys()).map((id) => new mongoose.Types.ObjectId(id));
    const users = await User.find(
      { _id: { $in: userIds } },
      'firstName lastName email phone isActive'
    ).lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const headers = [
      'Rank', 'First name', 'Last name', 'Email', 'Phone', 'Active',
      'Houses knocked', 'Surveys', 'Lit drops', 'Not home', 'Wrong address',
      'Connection rate %', 'Hours on doors', 'Days active', 'Doors/hr', 'Surveys/hr',
      'First activity', 'Last activity',
    ];
    const enriched = Array.from(byUser.values())
      .map((u) => {
        const info = userMap.get(u.userId) || {};
        const homesKnocked = u.surveysSubmitted + u.notHome + u.wrongAddress + u.litDropped;
        const connection = homesKnocked > 0 ? (u.surveysSubmitted / homesKnocked) * 100 : 0;
        const doorsPerHour = u.hoursOnDoors > 0 ? homesKnocked / u.hoursOnDoors : 0;
        const surveysPerHour = u.hoursOnDoors > 0 ? u.surveysSubmitted / u.hoursOnDoors : 0;
        return {
          ...u,
          firstName: info.firstName || '',
          lastName: info.lastName || '',
          email: info.email || '',
          phone: info.phone || '',
          isActive: info.isActive ?? false,
          homesKnocked,
          connection,
          doorsPerHour,
          surveysPerHour,
        };
      })
      .sort(
        (a, b) =>
          b.surveysSubmitted - a.surveysSubmitted || b.homesKnocked - a.homesKnocked
      );

    const rows = enriched.map((u, i) => [
      i + 1,
      u.firstName,
      u.lastName,
      u.email,
      u.phone,
      u.isActive ? 'yes' : 'no',
      u.homesKnocked,
      u.surveysSubmitted,
      u.litDropped,
      u.notHome,
      u.wrongAddress,
      Math.round(u.connection * 10) / 10,
      Math.round(u.hoursOnDoors * 100) / 100,
      u.daysActive,
      Math.round(u.doorsPerHour * 100) / 100,
      Math.round(u.surveysPerHour * 100) / 100,
      u.firstActivityAt ? new Date(u.firstActivityAt).toISOString() : '',
      u.lastActivityAt ? new Date(u.lastActivityAt).toISOString() : '',
    ]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="canvassers-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(toCsv(headers, rows));
  } catch (err) {
    next(err);
  }
});

// Org-wide averages for the active range. Used for "vs team avg" badges and
// the Compare screen.
router.get('/team-averages', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const cFilter = baseFilter(req);
    const tz = tzOf(req);
    const surveyMatch = { ...parseDateRange(req, 'submittedAt'), ...cFilter };
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter };

    const [perUserActivity, perUserSurveys, perUserHours] = await Promise.all([
      CanvassActivity.aggregate([
        { $match: { ...activityMatch, actionType: { $in: KNOCK_ACTIONS } } },
        { $group: { _id: '$userId', homesKnocked: { $sum: 1 } } },
      ]),
      SurveyResponse.aggregate([
        { $match: surveyMatch },
        { $group: { _id: '$userId', surveysSubmitted: { $sum: 1 } } },
      ]),
      CanvassActivity.aggregate([
        { $match: activityMatch },
        {
          $group: {
            _id: { userId: '$userId', day: dayBucketExpr('timestamp', tz) },
            first: { $min: '$timestamp' },
            last: { $max: '$timestamp' },
          },
        },
        {
          $group: {
            _id: '$_id.userId',
            hoursOnDoors: {
              $sum: { $divide: [{ $subtract: ['$last', '$first'] }, 3600000] },
            },
            daysActive: { $sum: 1 },
          },
        },
      ]),
    ]);

    const byUser = new Map();
    for (const r of perUserActivity) byUser.set(String(r._id), { homesKnocked: r.homesKnocked, surveysSubmitted: 0, hoursOnDoors: 0, daysActive: 0 });
    for (const r of perUserSurveys) {
      const k = String(r._id);
      if (!byUser.has(k)) byUser.set(k, { homesKnocked: 0, surveysSubmitted: 0, hoursOnDoors: 0, daysActive: 0 });
      byUser.get(k).surveysSubmitted = r.surveysSubmitted;
    }
    for (const r of perUserHours) {
      const k = String(r._id);
      if (!byUser.has(k)) byUser.set(k, { homesKnocked: 0, surveysSubmitted: 0, hoursOnDoors: 0, daysActive: 0 });
      const u = byUser.get(k);
      u.hoursOnDoors = r.hoursOnDoors;
      u.daysActive = r.daysActive;
    }

    const users = Array.from(byUser.values());
    const n = users.length;
    function avg(field) {
      if (!n) return 0;
      return users.reduce((acc, u) => acc + (u[field] || 0), 0) / n;
    }
    function avgRate(num, den) {
      if (!n) return 0;
      const sumN = users.reduce((a, u) => a + (u[num] || 0), 0);
      const sumD = users.reduce((a, u) => a + (u[den] || 0), 0);
      return sumD > 0 ? sumN / sumD : 0;
    }

    const homesKnocked = avg('homesKnocked');
    const surveysSubmitted = avg('surveysSubmitted');
    const hoursOnDoors = avg('hoursOnDoors');
    const daysActive = avg('daysActive');

    res.json({
      canvasserCount: n,
      avg: {
        homesKnocked: Math.round(homesKnocked * 10) / 10,
        surveysSubmitted: Math.round(surveysSubmitted * 10) / 10,
        hoursOnDoors: Math.round(hoursOnDoors * 100) / 100,
        daysActive: Math.round(daysActive * 10) / 10,
        doorsPerHour:
          Math.round(avgRate('homesKnocked', 'hoursOnDoors') * 100) / 100,
        surveysPerHour:
          Math.round(avgRate('surveysSubmitted', 'hoursOnDoors') * 100) / 100,
        connectionRatePct:
          Math.round(avgRate('surveysSubmitted', 'homesKnocked') * 1000) / 10,
      },
    });
  } catch (err) {
    next(err);
  }
});

// One-shot summary for the per-canvasser Overview screen.
router.get('/canvassers/:userId/summary', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const orgId = activeOrgId(req);
    const cFilter = baseFilter(req);
    const tz = tzOf(req);
    const surveyMatch = { ...parseDateRange(req, 'submittedAt'), ...cFilter, userId };
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter, userId };

    const knockMatch = { ...activityMatch, actionType: { $in: KNOCK_ACTIONS } };

    const [user, memberships, actionAgg, hourAgg, dowAgg, dailyAgg, surveysCount, qualityAgg, distanceHist] =
      await Promise.all([
        User.findById(userId, 'firstName lastName email phone isActive lastLoginAt').lean(),
        Membership.find({ userId, organizationId: orgId }, 'role isActive').lean(),
        CanvassActivity.aggregate([
          { $match: activityMatch },
          { $group: { _id: '$actionType', count: { $sum: 1 } } },
        ]),
        CanvassActivity.aggregate([
          { $match: knockMatch },
          {
            $group: {
              _id: { $hour: { date: '$timestamp', timezone: tz } },
              count: { $sum: 1 },
            },
          },
        ]),
        CanvassActivity.aggregate([
          { $match: knockMatch },
          {
            $group: {
              _id: { $dayOfWeek: { date: '$timestamp', timezone: tz } },
              count: { $sum: 1 },
            },
          },
        ]),
        CanvassActivity.aggregate([
          { $match: knockMatch },
          {
            $group: {
              _id: dayBucketExpr('timestamp', tz),
              homesKnocked: { $sum: 1 },
              first: { $min: '$timestamp' },
              last: { $max: '$timestamp' },
            },
          },
          { $sort: { _id: -1 } },
        ]),
        SurveyResponse.countDocuments(surveyMatch),
        CanvassActivity.aggregate([
          { $match: activityMatch },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              offlineCount: { $sum: { $cond: ['$wasOfflineSubmission', 1, 0] } },
              avgDistance: { $avg: '$distanceFromHouseMeters' },
              farCount: {
                $sum: {
                  $cond: [{ $gt: ['$distanceFromHouseMeters', 50] }, 1, 0],
                },
              },
              firstActivityAt: { $min: '$timestamp' },
              lastActivityAt: { $max: '$timestamp' },
            },
          },
        ]),
        CanvassActivity.aggregate([
          { $match: activityMatch },
          {
            $bucket: {
              groupBy: { $ifNull: ['$distanceFromHouseMeters', -1] },
              boundaries: [-1, 0, 10, 25, 50, 100, 1000000],
              default: 'unknown',
              output: { count: { $sum: 1 } },
            },
          },
        ]),
      ]);

    if (!user) return res.status(404).json({ error: 'User not found' });

    const actions = { not_home: 0, wrong_address: 0, survey_submitted: 0, lit_dropped: 0, note_added: 0 };
    for (const r of actionAgg) actions[r._id] = r.count;
    const homesKnocked =
      actions.not_home + actions.wrong_address + actions.survey_submitted + actions.lit_dropped;

    const surveysSubmitted = surveysCount;

    // Per-day shift sum
    const dailySorted = [...dailyAgg].sort((a, b) => (a._id < b._id ? -1 : 1));
    let hoursOnDoors = 0;
    for (const d of dailySorted) {
      const ms = new Date(d.last) - new Date(d.first);
      hoursOnDoors += ms / 3600000;
    }
    const daysActive = dailySorted.length;

    // Best day (by homesKnocked)
    let bestDay = null;
    for (const d of dailySorted) {
      if (!bestDay || d.homesKnocked > bestDay.homesKnocked) {
        bestDay = { date: d._id, homesKnocked: d.homesKnocked };
      }
    }

    // Current streak — count consecutive days ending at "today (tz)" or last active day
    // working backwards.
    function dayKey(date) {
      return new Date(date).toLocaleDateString('en-CA', { timeZone: tz });
    }
    const dayKeys = new Set(dailySorted.map((d) => d._id));
    let streak = 0;
    let cursor = new Date();
    for (let i = 0; i < 365; i++) {
      const k = dayKey(cursor);
      if (dayKeys.has(k)) streak += 1;
      else if (i === 0) {
        // skip today if no activity, allow streak to be measured from yesterday
      } else break;
      cursor = new Date(cursor.getTime() - 86400000);
    }

    const hourBuckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    for (const r of hourAgg) hourBuckets[r._id].count = r.count;

    // mongo's $dayOfWeek is 1=Sun..7=Sat; expose 0=Sun..6=Sat
    const dowBuckets = Array.from({ length: 7 }, (_, i) => ({ dow: i, count: 0 }));
    for (const r of dowAgg) dowBuckets[r._id - 1].count = r.count;

    const lastSevenDays = dailySorted.slice(-7).map((d) => ({
      date: d._id,
      homesKnocked: d.homesKnocked,
      hoursOnDoors: Math.round(((new Date(d.last) - new Date(d.first)) / 3600000) * 100) / 100,
      firstActivityAt: d.first,
      lastActivityAt: d.last,
    }));

    const qual = qualityAgg[0] || {
      total: 0,
      offlineCount: 0,
      avgDistance: null,
      farCount: 0,
      firstActivityAt: null,
      lastActivityAt: null,
    };

    const distanceHistogram = [
      { bucket: '0-10m', count: 0 },
      { bucket: '10-25m', count: 0 },
      { bucket: '25-50m', count: 0 },
      { bucket: '50-100m', count: 0 },
      { bucket: '100m+', count: 0 },
      { bucket: 'unknown', count: 0 },
    ];
    const bucketIndex = { 0: 0, 10: 1, 25: 2, 50: 3, 100: 4 };
    for (const b of distanceHist) {
      if (b._id === 'unknown' || b._id === -1) distanceHistogram[5].count += b.count;
      else if (bucketIndex[b._id] !== undefined) distanceHistogram[bucketIndex[b._id]].count = b.count;
    }

    const doorsPerHour = hoursOnDoors > 0 ? homesKnocked / hoursOnDoors : 0;
    const surveysPerHour = hoursOnDoors > 0 ? surveysSubmitted / hoursOnDoors : 0;
    const avgMinutesPerDoor =
      homesKnocked > 0 && hoursOnDoors > 0 ? (hoursOnDoors * 60) / homesKnocked : 0;
    const connectionRatePct = homesKnocked > 0 ? (surveysSubmitted / homesKnocked) * 100 : 0;

    res.json({
      user: {
        id: String(user._id),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone || null,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
      },
      memberships: memberships.map((m) => ({
        role: m.role,
        isActive: m.isActive,
      })),
      range: {
        from: req.query.from || null,
        to: req.query.to || null,
        tz,
      },
      kpi: {
        homesKnocked,
        surveysSubmitted,
        litDropped: actions.lit_dropped,
        notHome: actions.not_home,
        wrongAddress: actions.wrong_address,
        notesAdded: actions.note_added,
        connectionRatePct: Math.round(connectionRatePct * 10) / 10,
        hoursOnDoors: Math.round(hoursOnDoors * 100) / 100,
        daysActive,
        doorsPerHour: Math.round(doorsPerHour * 100) / 100,
        surveysPerHour: Math.round(surveysPerHour * 100) / 100,
        avgMinutesPerDoor: Math.round(avgMinutesPerDoor * 10) / 10,
      },
      highlights: {
        bestDay,
        currentStreak: streak,
        firstActivityAt: qual.firstActivityAt,
        lastActivityAt: qual.lastActivityAt,
      },
      hourDistribution: hourBuckets,
      dayOfWeekDistribution: dowBuckets,
      lastSevenDays,
      quality: {
        totalActivities: qual.total,
        offlineCount: qual.offlineCount,
        offlinePercent:
          qual.total > 0 ? Math.round((qual.offlineCount / qual.total) * 1000) / 10 : 0,
        avgDistanceFromHouseMeters:
          qual.avgDistance != null ? Math.round(qual.avgDistance * 10) / 10 : null,
        farFromHouseCount: qual.farCount,
        farFromHousePercent:
          qual.total > 0 ? Math.round((qual.farCount / qual.total) * 1000) / 10 : 0,
        distanceHistogram,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Per-day breakdown across the active range.
router.get('/canvassers/:userId/daily', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const cFilter = baseFilter(req);
    const tz = tzOf(req);
    const surveyMatch = { ...parseDateRange(req, 'submittedAt'), ...cFilter, userId };
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter, userId };

    const [activityDaily, surveyDaily] = await Promise.all([
      CanvassActivity.aggregate([
        { $match: activityMatch },
        {
          $group: {
            _id: { day: dayBucketExpr('timestamp', tz), actionType: '$actionType' },
            count: { $sum: 1 },
            first: { $min: '$timestamp' },
            last: { $max: '$timestamp' },
          },
        },
      ]),
      SurveyResponse.aggregate([
        { $match: surveyMatch },
        {
          $group: {
            _id: dayBucketExpr('submittedAt', tz),
            surveysSubmitted: { $sum: 1 },
          },
        },
      ]),
    ]);

    const byDay = new Map();
    const ensure = (date) => {
      if (!byDay.has(date)) {
        byDay.set(date, {
          date,
          surveysSubmitted: 0,
          notHome: 0,
          wrongAddress: 0,
          litDropped: 0,
          notesAdded: 0,
          homesKnocked: 0,
          firstActivityAt: null,
          lastActivityAt: null,
        });
      }
      return byDay.get(date);
    };
    for (const r of activityDaily) {
      const d = ensure(r._id.day);
      const at = r._id.actionType;
      if (at === 'not_home') d.notHome = r.count;
      else if (at === 'wrong_address') d.wrongAddress = r.count;
      else if (at === 'lit_dropped') d.litDropped = r.count;
      else if (at === 'note_added') d.notesAdded = r.count;
      else if (at === 'survey_submitted') {
        // homesKnocked from activities side will use the agg below
      }
      if (KNOCK_ACTIONS.includes(at)) d.homesKnocked += r.count;
      if (!d.firstActivityAt || r.first < d.firstActivityAt) d.firstActivityAt = r.first;
      if (!d.lastActivityAt || r.last > d.lastActivityAt) d.lastActivityAt = r.last;
    }
    for (const r of surveyDaily) {
      const d = ensure(r._id);
      d.surveysSubmitted = r.surveysSubmitted;
    }

    const rows = Array.from(byDay.values())
      .map((d) => {
        const hoursOnDoors =
          d.firstActivityAt && d.lastActivityAt
            ? (new Date(d.lastActivityAt) - new Date(d.firstActivityAt)) / 3600000
            : 0;
        const connectionRatePct =
          d.homesKnocked > 0 ? (d.surveysSubmitted / d.homesKnocked) * 100 : 0;
        return {
          ...d,
          hoursOnDoors: Math.round(hoursOnDoors * 100) / 100,
          connectionRatePct: Math.round(connectionRatePct * 10) / 10,
          doorsPerHour:
            hoursOnDoors > 0 ? Math.round((d.homesKnocked / hoursOnDoors) * 100) / 100 : 0,
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    res.json({ days: rows, tz });
  } catch (err) {
    next(err);
  }
});

// Paginated raw activity feed. Supports actionType, flaggedOnly, order.
router.get('/canvassers/:userId/activities', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const cFilter = baseFilter(req);
    const dateRange = parseDateRange(req, 'timestamp');
    const filter = { ...dateRange, ...cFilter, userId };

    if (req.query.actionType) {
      const types = String(req.query.actionType).split(',');
      filter.actionType = { $in: types };
    }
    if (req.query.flaggedOnly === 'true') {
      filter.$or = [
        { wasOfflineSubmission: true },
        { distanceFromHouseMeters: { $gt: 50 } },
      ];
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    const order = req.query.order === 'asc' ? 1 : -1;

    const [total, activities] = await Promise.all([
      CanvassActivity.countDocuments(filter),
      CanvassActivity.find(filter)
        .sort({ timestamp: order })
        .skip(skip)
        .limit(limit)
        .populate('householdId', 'addressLine1 addressLine2 city state zipCode')
        .populate('voterId', 'fullName party')
        .lean(),
    ]);

    res.json({
      total,
      limit,
      skip,
      activities: activities.map((a) => ({
        id: String(a._id),
        actionType: a.actionType,
        timestamp: a.timestamp,
        note: a.note || null,
        location: a.location,
        distanceFromHouseMeters: a.distanceFromHouseMeters,
        wasOfflineSubmission: !!a.wasOfflineSubmission,
        household: a.householdId
          ? {
              id: String(a.householdId._id),
              addressLine1: a.householdId.addressLine1,
              addressLine2: a.householdId.addressLine2 || null,
              city: a.householdId.city,
              state: a.householdId.state,
              zipCode: a.householdId.zipCode,
            }
          : null,
        voter: a.voterId
          ? {
              id: String(a.voterId._id),
              fullName: a.voterId.fullName,
              party: a.voterId.party || null,
            }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Distinct households this canvasser interacted with in range.
router.get('/canvassers/:userId/households', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const cFilter = baseFilter(req);
    const dateRange = parseDateRange(req, 'timestamp');
    const match = { ...dateRange, ...cFilter, userId };

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: '$householdId',
          visits: { $sum: 1 },
          firstAt: { $min: '$timestamp' },
          lastAt: { $max: '$timestamp' },
          actionTypes: { $addToSet: '$actionType' },
          lastAction: { $last: '$actionType' },
        },
      },
      { $sort: { lastAt: -1 } },
    ];
    const all = await CanvassActivity.aggregate(pipeline);

    const householdIds = all.map((r) => r._id);
    const orgId = activeOrgId(req);
    let households = await Household.find(
      { _id: { $in: householdIds }, organizationId: orgId },
      'addressLine1 addressLine2 city state zipCode status'
    ).lean();

    // Optional address search
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      households = households.filter((h) =>
        `${h.addressLine1} ${h.city} ${h.state} ${h.zipCode}`.toLowerCase().includes(q)
      );
    }
    const hMap = new Map(households.map((h) => [String(h._id), h]));

    const enriched = all
      .map((r) => {
        const h = hMap.get(String(r._id));
        if (!h) return null;
        return {
          household: {
            id: String(h._id),
            addressLine1: h.addressLine1,
            addressLine2: h.addressLine2 || null,
            city: h.city,
            state: h.state,
            zipCode: h.zipCode,
            status: h.status,
          },
          visits: r.visits,
          firstAt: r.firstAt,
          lastAt: r.lastAt,
          actionTypes: r.actionTypes,
          finalAction: r.lastAction,
        };
      })
      .filter(Boolean);

    res.json({
      total: enriched.length,
      limit,
      skip,
      households: enriched.slice(skip, skip + limit),
    });
  } catch (err) {
    next(err);
  }
});

// Voters surveyed by this canvasser, with demographic mix summary.
router.get('/canvassers/:userId/voters', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const cFilter = baseFilter(req);
    const dateRange = parseDateRange(req, 'submittedAt');
    const filter = { ...dateRange, ...cFilter, userId };

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

    const [total, responses] = await Promise.all([
      SurveyResponse.countDocuments(filter),
      SurveyResponse.find(filter)
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('voterId', 'fullName party gender dateOfBirth')
        .populate('householdId', 'addressLine1 city state')
        .lean(),
    ]);

    // Party + gender breakdown over the full set (not just the page)
    const [partyAgg, genderAgg] = await Promise.all([
      SurveyResponse.aggregate([
        { $match: filter },
        { $lookup: { from: 'voters', localField: 'voterId', foreignField: '_id', as: 'v' } },
        { $unwind: '$v' },
        { $group: { _id: '$v.party', count: { $sum: 1 } } },
      ]),
      SurveyResponse.aggregate([
        { $match: filter },
        { $lookup: { from: 'voters', localField: 'voterId', foreignField: '_id', as: 'v' } },
        { $unwind: '$v' },
        { $group: { _id: '$v.gender', count: { $sum: 1 } } },
      ]),
    ]);

    res.json({
      total,
      limit,
      skip,
      partyBreakdown: partyAgg.map((p) => ({ value: p._id || 'Unknown', count: p.count })),
      genderBreakdown: genderAgg.map((g) => ({ value: g._id || 'Unknown', count: g.count })),
      voters: responses.map((r) => ({
        responseId: String(r._id),
        submittedAt: r.submittedAt,
        voter: r.voterId
          ? {
              id: String(r.voterId._id),
              fullName: r.voterId.fullName,
              party: r.voterId.party || null,
              gender: r.voterId.gender || null,
              dateOfBirth: r.voterId.dateOfBirth || null,
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
      })),
    });
  } catch (err) {
    next(err);
  }
});

// All notes left by this canvasser — union of activity notes and survey notes.
router.get('/canvassers/:userId/notes', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const cFilter = baseFilter(req);

    const [activityNotes, surveyNotes] = await Promise.all([
      CanvassActivity.find(
        {
          ...parseDateRange(req, 'timestamp'),
          ...cFilter,
          userId,
          note: { $exists: true, $ne: null, $not: /^\s*$/ },
        },
        '_id note timestamp actionType householdId voterId'
      )
        .populate('householdId', 'addressLine1 city state')
        .populate('voterId', 'fullName')
        .sort({ timestamp: -1 })
        .lean(),
      SurveyResponse.find(
        {
          ...parseDateRange(req, 'submittedAt'),
          ...cFilter,
          userId,
          note: { $exists: true, $ne: null, $not: /^\s*$/ },
        },
        '_id note submittedAt householdId voterId'
      )
        .populate('householdId', 'addressLine1 city state')
        .populate('voterId', 'fullName')
        .sort({ submittedAt: -1 })
        .lean(),
    ]);

    const merged = [
      ...activityNotes.map((a) => ({
        source: 'activity',
        id: String(a._id),
        note: a.note,
        timestamp: a.timestamp,
        actionType: a.actionType,
        household: a.householdId
          ? {
              id: String(a.householdId._id),
              addressLine1: a.householdId.addressLine1,
              city: a.householdId.city,
              state: a.householdId.state,
            }
          : null,
        voter: a.voterId
          ? { id: String(a.voterId._id), fullName: a.voterId.fullName }
          : null,
      })),
      ...surveyNotes.map((s) => ({
        source: 'survey',
        id: String(s._id),
        note: s.note,
        timestamp: s.submittedAt,
        actionType: 'survey_submitted',
        household: s.householdId
          ? {
              id: String(s.householdId._id),
              addressLine1: s.householdId.addressLine1,
              city: s.householdId.city,
              state: s.householdId.state,
            }
          : null,
        voter: s.voterId
          ? { id: String(s.voterId._id), fullName: s.voterId.fullName }
          : null,
      })),
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({ total: merged.length, notes: merged });
  } catch (err) {
    next(err);
  }
});

// Lat/lng + action points for map drawing.
router.get('/canvassers/:userId/path', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const cFilter = baseFilter(req);
    const dateRange = parseDateRange(req, 'timestamp');
    const filter = { ...dateRange, ...cFilter, userId };

    if (req.query.actionType) {
      filter.actionType = { $in: String(req.query.actionType).split(',') };
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 1000, 1), 5000);

    const points = await CanvassActivity.find(filter, {
      timestamp: 1,
      actionType: 1,
      location: 1,
      distanceFromHouseMeters: 1,
      householdId: 1,
      wasOfflineSubmission: 1,
    })
      .sort({ timestamp: 1 })
      .limit(limit)
      .populate('householdId', 'addressLine1 city state')
      .lean();

    res.json({
      total: points.length,
      points: points.map((p) => ({
        id: String(p._id),
        lat: p.location?.lat,
        lng: p.location?.lng,
        accuracy: p.location?.accuracy ?? null,
        timestamp: p.timestamp,
        actionType: p.actionType,
        distanceFromHouseMeters: p.distanceFromHouseMeters,
        wasOfflineSubmission: !!p.wasOfflineSubmission,
        household: p.householdId
          ? {
              id: String(p.householdId._id),
              addressLine1: p.householdId.addressLine1,
              city: p.householdId.city,
              state: p.householdId.state,
            }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Geo + sync quality audit.
router.get('/canvassers/:userId/quality', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const cFilter = baseFilter(req);
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter, userId };
    const surveyMatch = { ...parseDateRange(req, 'submittedAt'), ...cFilter, userId };

    const [distAgg, offlineAgg, syncAgg, flaggedList, lastSync] = await Promise.all([
      CanvassActivity.aggregate([
        { $match: activityMatch },
        {
          $bucket: {
            groupBy: { $ifNull: ['$distanceFromHouseMeters', -1] },
            boundaries: [-1, 0, 10, 25, 50, 100, 1000000],
            default: 'unknown',
            output: { count: { $sum: 1 } },
          },
        },
      ]),
      CanvassActivity.aggregate([
        { $match: activityMatch },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            offlineCount: { $sum: { $cond: ['$wasOfflineSubmission', 1, 0] } },
            avgDistance: { $avg: '$distanceFromHouseMeters' },
            farCount: {
              $sum: {
                $cond: [{ $gt: ['$distanceFromHouseMeters', 50] }, 1, 0],
              },
            },
          },
        },
      ]),
      SurveyResponse.aggregate([
        { $match: surveyMatch },
        {
          $project: {
            lagMs: { $subtract: ['$syncedAt', '$submittedAt'] },
            wasOfflineSubmission: 1,
          },
        },
        {
          $bucket: {
            groupBy: '$lagMs',
            boundaries: [-1, 1000, 60000, 600000, 3600000, 1e15],
            default: 'unknown',
            output: { count: { $sum: 1 } },
          },
        },
      ]),
      CanvassActivity.find(
        {
          ...activityMatch,
          $or: [
            { wasOfflineSubmission: true },
            { distanceFromHouseMeters: { $gt: 50 } },
          ],
        },
        '_id actionType timestamp wasOfflineSubmission distanceFromHouseMeters householdId location'
      )
        .populate('householdId', 'addressLine1 city state')
        .sort({ timestamp: -1 })
        .limit(100)
        .lean(),
      SurveyResponse.findOne(surveyMatch, 'syncedAt').sort({ syncedAt: -1 }).lean(),
    ]);

    const distanceHistogram = [
      { bucket: '0-10m', count: 0 },
      { bucket: '10-25m', count: 0 },
      { bucket: '25-50m', count: 0 },
      { bucket: '50-100m', count: 0 },
      { bucket: '100m+', count: 0 },
      { bucket: 'unknown', count: 0 },
    ];
    const bucketIndex = { 0: 0, 10: 1, 25: 2, 50: 3, 100: 4 };
    for (const b of distAgg) {
      if (b._id === 'unknown' || b._id === -1) distanceHistogram[5].count += b.count;
      else if (bucketIndex[b._id] !== undefined) distanceHistogram[bucketIndex[b._id]].count = b.count;
    }

    const syncLagLabels = ['<1s (immediate)', '1s–1m', '1m–10m', '10m–1h', '1h+'];
    const syncLagHistogram = syncLagLabels.map((label) => ({ bucket: label, count: 0 }));
    const syncIndex = { '-1': 0, '1000': 1, '60000': 2, '600000': 3, '3600000': 4 };
    for (const b of syncAgg) {
      const idx = syncIndex[String(b._id)];
      if (idx !== undefined) syncLagHistogram[idx].count = b.count;
    }

    const q = offlineAgg[0] || {
      total: 0,
      offlineCount: 0,
      avgDistance: null,
      farCount: 0,
    };

    res.json({
      totalActivities: q.total,
      offlineCount: q.offlineCount,
      offlinePercent: q.total > 0 ? Math.round((q.offlineCount / q.total) * 1000) / 10 : 0,
      avgDistanceFromHouseMeters:
        q.avgDistance != null ? Math.round(q.avgDistance * 10) / 10 : null,
      farFromHouseCount: q.farCount,
      farFromHousePercent:
        q.total > 0 ? Math.round((q.farCount / q.total) * 1000) / 10 : 0,
      distanceHistogram,
      syncLagHistogram,
      lastSyncAt: lastSync?.syncedAt || null,
      flaggedActivities: flaggedList.map((a) => ({
        id: String(a._id),
        actionType: a.actionType,
        timestamp: a.timestamp,
        wasOfflineSubmission: !!a.wasOfflineSubmission,
        distanceFromHouseMeters: a.distanceFromHouseMeters,
        location: a.location,
        household: a.householdId
          ? {
              id: String(a.householdId._id),
              addressLine1: a.householdId.addressLine1,
              city: a.householdId.city,
              state: a.householdId.state,
            }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Per-canvasser activity CSV export.
router.get('/canvassers/:userId/export.csv', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const cFilter = baseFilter(req);
    const filter = { ...parseDateRange(req, 'timestamp'), ...cFilter, userId };

    const activities = await CanvassActivity.find(filter, {
      timestamp: 1,
      actionType: 1,
      note: 1,
      location: 1,
      distanceFromHouseMeters: 1,
      wasOfflineSubmission: 1,
      householdId: 1,
      voterId: 1,
    })
      .sort({ timestamp: 1 })
      .populate('householdId', 'addressLine1 addressLine2 city state zipCode')
      .populate('voterId', 'fullName party')
      .lean();

    const headers = [
      'Timestamp', 'Action', 'Address', 'City', 'State', 'Zip', 'Voter', 'Party',
      'Latitude', 'Longitude', 'Accuracy (m)', 'Distance from house (m)',
      'Offline submission', 'Note',
    ];
    const rows = activities.map((a) => [
      new Date(a.timestamp).toISOString(),
      a.actionType,
      a.householdId?.addressLine1 || '',
      a.householdId?.city || '',
      a.householdId?.state || '',
      a.householdId?.zipCode || '',
      a.voterId?.fullName || '',
      a.voterId?.party || '',
      a.location?.lat ?? '',
      a.location?.lng ?? '',
      a.location?.accuracy ?? '',
      a.distanceFromHouseMeters ?? '',
      a.wasOfflineSubmission ? 'yes' : 'no',
      a.note || '',
    ]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="canvasser-${userId}-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(toCsv(headers, rows));
  } catch (err) {
    next(err);
  }
});

export default router;
