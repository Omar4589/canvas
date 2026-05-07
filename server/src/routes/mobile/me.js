import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../../middleware/auth.js';
import { Campaign } from '../../models/Campaign.js';
import { Household } from '../../models/Household.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';

const router = Router();
router.use(requireAuth);

const DOOR_ACTIONS = ['not_home', 'wrong_address', 'survey_submitted', 'lit_dropped'];

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

router.get('/today', async (req, res, next) => {
  try {
    const { campaignId, since } = req.query;
    if (!campaignId || !mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ error: 'campaignId query param is required' });
    }
    const cId = new mongoose.Types.ObjectId(campaignId);

    // The mobile client sends `since` = start-of-today in its local timezone
    // (as an absolute ISO timestamp). We use that directly. If absent or
    // invalid, fall back to start-of-today in the server's TZ. We clamp the
    // accepted window to [now-36h, now] so a malformed/forged value can't
    // inflate counts beyond ~one day.
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

    // Pull today's door-knocking activities for this user once and derive
    // doorsKnocked, litDropped, firstDoorAt, lastDoorAt, distanceMeters from
    // the same array. Saves 2 separate countDocuments calls vs the old code.
    const [activities, responses, remaining, campaign] = await Promise.all([
      CanvassActivity.find({
        userId: req.user._id,
        campaignId: cId,
        timestamp: { $gte: start },
        actionType: { $in: DOOR_ACTIONS },
      })
        .sort({ timestamp: 1 })
        .select('timestamp location actionType')
        .lean(),
      SurveyResponse.countDocuments({
        userId: req.user._id,
        campaignId: cId,
        submittedAt: { $gte: start },
      }),
      Household.countDocuments({
        campaignId: cId,
        isActive: true,
        status: 'unknocked',
      }),
      Campaign.findById(cId).select('surveyTemplateId').lean(),
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

    // Top answers per choice-question for today's submissions. Only ship
    // single_choice / multiple_choice keys — text answers don't aggregate
    // meaningfully and would bloat the payload.
    let answerBreakdown = [];
    if (campaign?.surveyTemplateId) {
      const [template, todaysResponses] = await Promise.all([
        SurveyTemplate.findById(campaign.surveyTemplateId)
          .select('questions')
          .lean(),
        SurveyResponse.find({
          userId: req.user._id,
          campaignId: cId,
          submittedAt: { $gte: start },
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

    res.json({
      doorsKnocked,
      responses,
      litDropped,
      remaining,
      firstDoorAt: firstDoorAt ? firstDoorAt.toISOString() : null,
      lastDoorAt: lastDoorAt ? lastDoorAt.toISOString() : null,
      distanceMeters: Math.round(distanceMeters),
      answerBreakdown,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
