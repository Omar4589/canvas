import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgMember } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { Household } from '../../models/Household.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgMember);

const DOOR_ACTIONS = ['not_home', 'wrong_address', 'survey_submitted', 'lit_dropped'];

function activeOrgId(req) {
  return req.activeOrg?._id;
}

function isOrgAdminOrSuper(req) {
  if (req.user.isSuperAdmin) return true;
  return req.activeMembership?.role === 'admin';
}

async function assertCampaignAccess(req, campaignId) {
  if (!mongoose.isValidObjectId(campaignId)) return { error: 400, message: 'Invalid campaignId' };
  const orgId = activeOrgId(req);
  if (!orgId) return { error: 400, message: 'Active organization required' };
  const campaign = await Campaign.findOne({ _id: campaignId, organizationId: orgId }).lean();
  if (!campaign) return { error: 404, message: 'Campaign not found' };
  if (isOrgAdminOrSuper(req)) return { campaign };
  const assigned = await CampaignAssignment.exists({ campaignId: campaign._id, userId: req.user._id });
  if (!assigned) return { error: 403, message: 'Not assigned to this campaign' };
  return { campaign };
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function computeDailyStats({ orgId, userId, campaignId, start, end }) {
  const timestampQuery = { $gte: start, $lt: end };
  const submittedAtQuery = { $gte: start, $lt: end };

  const [activities, responses, campaign] = await Promise.all([
    CanvassActivity.find({
      userId,
      campaignId,
      organizationId: orgId,
      timestamp: timestampQuery,
      actionType: { $in: DOOR_ACTIONS },
    })
      .sort({ timestamp: 1 })
      .select('timestamp location actionType')
      .lean(),
    SurveyResponse.countDocuments({
      userId,
      campaignId,
      organizationId: orgId,
      submittedAt: submittedAtQuery,
    }),
    Campaign.findOne({ _id: campaignId, organizationId: orgId }).select('surveyTemplateId').lean(),
  ]);

  const doorsKnocked = activities.length;
  let litDropped = 0;
  let firstDoorAt = null;
  let lastDoorAt = null;
  let distanceMeters = 0;
  let prev = null;
  for (const a of activities) {
    if (a.actionType === 'lit_dropped') litDropped += 1;
    if (!firstDoorAt) firstDoorAt = a.timestamp;
    lastDoorAt = a.timestamp;
    if (a.location && prev?.location) {
      distanceMeters += haversineMeters(
        prev.location.lat,
        prev.location.lng,
        a.location.lat,
        a.location.lng
      );
    }
    prev = a;
  }

  let answerBreakdown = [];
  if (campaign?.surveyTemplateId) {
    const [template, todaysResponses] = await Promise.all([
      SurveyTemplate.findOne({
        _id: campaign.surveyTemplateId,
        organizationId: orgId,
      })
        .select('questions')
        .lean(),
      SurveyResponse.find({
        userId,
        campaignId,
        organizationId: orgId,
        submittedAt: submittedAtQuery,
      })
        .select('answers')
        .lean(),
    ]);

    const choiceKeys = new Set(
      (template?.questions || [])
        .filter((q) => q.type === 'single_choice' || q.type === 'multiple_choice')
        .map((q) => q.key)
    );

    const counts = {};
    for (const r of todaysResponses) {
      for (const a of r.answers || []) {
        if (!choiceKeys.has(a.questionKey)) continue;
        if (!counts[a.questionKey]) {
          counts[a.questionKey] = {
            questionLabel: a.questionLabel,
            options: {},
          };
        }
        const ops = counts[a.questionKey].options;
        if (Array.isArray(a.answer)) {
          for (const opt of a.answer) {
            if (opt) ops[opt] = (ops[opt] || 0) + 1;
          }
        } else if (a.answer) {
          ops[a.answer] = (ops[a.answer] || 0) + 1;
        }
      }
    }

    answerBreakdown = Object.entries(counts).map(([questionKey, q]) => ({
      questionKey,
      questionLabel: q.questionLabel,
      topOptions: Object.entries(q.options)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([option, count]) => ({ option, count })),
    }));
  }

  return {
    doorsKnocked,
    responses,
    litDropped,
    firstDoorAt: firstDoorAt ? firstDoorAt.toISOString() : null,
    lastDoorAt: lastDoorAt ? lastDoorAt.toISOString() : null,
    distanceMeters: Math.round(distanceMeters),
    answerBreakdown,
  };
}

router.get('/today', async (req, res, next) => {
  try {
    const orgId = activeOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Active organization required' });
    const { campaignId, since } = req.query;
    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId query param is required' });
    }
    const access = await assertCampaignAccess(req, campaignId);
    if (access.error) return res.status(access.error).json({ error: access.message });
    const cId = access.campaign._id;

    const now = Date.now();
    const minStart = now - 36 * 60 * 60 * 1000;
    let start;
    const sinceMs = since ? Date.parse(since) : NaN;
    if (Number.isFinite(sinceMs) && sinceMs >= minStart && sinceMs <= now) {
      start = new Date(sinceMs);
    } else {
      start = new Date();
      start.setHours(0, 0, 0, 0);
    }

    const [stats, remaining] = await Promise.all([
      computeDailyStats({
        orgId,
        userId: req.user._id,
        campaignId: cId,
        start,
        end: new Date(now),
      }),
      Household.countDocuments({
        campaignId: cId,
        organizationId: orgId,
        isActive: true,
        status: 'unknocked',
      }),
    ]);

    res.json({ ...stats, remaining });
  } catch (err) {
    next(err);
  }
});

router.get('/day', async (req, res, next) => {
  try {
    const orgId = activeOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Active organization required' });
    const { campaignId, since, until } = req.query;
    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId query param is required' });
    }
    const access = await assertCampaignAccess(req, campaignId);
    if (access.error) return res.status(access.error).json({ error: access.message });

    const sinceMs = Date.parse(since);
    const untilMs = Date.parse(until);
    if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs <= sinceMs) {
      return res.status(400).json({ error: 'since and until ISO timestamps required' });
    }
    if (untilMs - sinceMs > 36 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'window too wide (max 36h)' });
    }

    const stats = await computeDailyStats({
      orgId,
      userId: req.user._id,
      campaignId: access.campaign._id,
      start: new Date(sinceMs),
      end: new Date(untilMs),
    });

    res.json(stats);
  } catch (err) {
    next(err);
  }
});

router.get('/history', async (req, res, next) => {
  try {
    const orgId = activeOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Active organization required' });
    const { campaignId, tz } = req.query;
    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId query param is required' });
    }
    if (!tz) {
      return res.status(400).json({ error: 'tz query param required (IANA name)' });
    }
    const access = await assertCampaignAccess(req, campaignId);
    if (access.error) return res.status(access.error).json({ error: access.message });
    const userId = req.user._id;
    const cId = access.campaign._id;

    const [activities, responses] = await Promise.all([
      CanvassActivity.find({
        userId,
        campaignId: cId,
        organizationId: orgId,
        actionType: { $in: DOOR_ACTIONS },
      })
        .sort({ timestamp: 1 })
        .select('timestamp location actionType')
        .lean(),
      SurveyResponse.find({
        userId,
        campaignId: cId,
        organizationId: orgId,
      })
        .select('submittedAt')
        .lean(),
    ]);

    let dayFormatter;
    try {
      dayFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      dayFormatter.format(new Date());
    } catch {
      return res.status(400).json({ error: 'invalid tz' });
    }
    const dayStr = (date) => dayFormatter.format(date);

    const dayMap = new Map();
    function ensureDay(d) {
      if (!dayMap.has(d)) {
        dayMap.set(d, {
          date: d,
          doorsKnocked: 0,
          litDropped: 0,
          responses: 0,
          firstDoorAt: null,
          lastDoorAt: null,
          distanceMeters: 0,
          _prevLocation: null,
        });
      }
      return dayMap.get(d);
    }

    for (const a of activities) {
      const d = dayStr(a.timestamp);
      const day = ensureDay(d);
      day.doorsKnocked++;
      if (a.actionType === 'lit_dropped') day.litDropped++;
      const ts = a.timestamp.toISOString();
      if (!day.firstDoorAt) day.firstDoorAt = ts;
      day.lastDoorAt = ts;
      if (a.location && day._prevLocation) {
        day.distanceMeters += haversineMeters(
          day._prevLocation.lat,
          day._prevLocation.lng,
          a.location.lat,
          a.location.lng
        );
      }
      if (a.location) day._prevLocation = a.location;
    }
    for (const r of responses) {
      ensureDay(dayStr(r.submittedAt)).responses++;
    }

    const days = Array.from(dayMap.values())
      .map((d) => ({
        date: d.date,
        doorsKnocked: d.doorsKnocked,
        litDropped: d.litDropped,
        responses: d.responses,
        firstDoorAt: d.firstDoorAt,
        lastDoorAt: d.lastDoorAt,
        distanceMeters: Math.round(d.distanceMeters),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const allTime = {
      doorsKnocked: days.reduce((s, d) => s + d.doorsKnocked, 0),
      surveysSubmitted: days.reduce((s, d) => s + d.responses, 0),
      litDropped: days.reduce((s, d) => s + d.litDropped, 0),
      distanceMeters: days.reduce((s, d) => s + d.distanceMeters, 0),
      daysActive: days.filter((d) => d.doorsKnocked > 0).length,
    };

    let personalBest = null;
    for (const d of days) {
      if (d.doorsKnocked === 0) continue;
      if (!personalBest || d.doorsKnocked > personalBest.doorsKnocked) {
        personalBest = { date: d.date, doorsKnocked: d.doorsKnocked };
      }
    }

    const activeDates = new Set(
      days.filter((d) => d.doorsKnocked > 0).map((d) => d.date)
    );
    function decDate(s) {
      const [y, m, d] = s.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d - 1));
      return dt.toISOString().slice(0, 10);
    }
    let streak = 0;
    let cursor = dayStr(new Date());
    if (!activeDates.has(cursor)) {
      cursor = decDate(cursor);
    }
    while (activeDates.has(cursor)) {
      streak++;
      cursor = decDate(cursor);
    }

    res.json({
      days,
      allTime,
      personalBest,
      currentStreak: streak,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
