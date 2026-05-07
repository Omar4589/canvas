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

// Returns the date-specific stats for a single user/campaign in a [start, end)
// window. Used by /today and /day so behavior stays identical between the
// "today" sheet on the map and the day-detail screen.
async function computeDailyStats({ userId, campaignId, start, end }) {
  const timestampQuery = { $gte: start, $lt: end };
  const submittedAtQuery = { $gte: start, $lt: end };

  const [activities, responses, campaign] = await Promise.all([
    CanvassActivity.find({
      userId,
      campaignId,
      timestamp: timestampQuery,
      actionType: { $in: DOOR_ACTIONS },
    })
      .sort({ timestamp: 1 })
      .select('timestamp location actionType')
      .lean(),
    SurveyResponse.countDocuments({
      userId,
      campaignId,
      submittedAt: submittedAtQuery,
    }),
    Campaign.findById(campaignId).select('surveyTemplateId').lean(),
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
      SurveyTemplate.findById(campaign.surveyTemplateId)
        .select('questions')
        .lean(),
      SurveyResponse.find({
        userId,
        campaignId,
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

    const [stats, remaining] = await Promise.all([
      computeDailyStats({
        userId: req.user._id,
        campaignId: cId,
        start,
        end: new Date(now),
      }),
      Household.countDocuments({
        campaignId: cId,
        isActive: true,
        status: 'unknocked',
      }),
    ]);

    res.json({ ...stats, remaining });
  } catch (err) {
    next(err);
  }
});

// Single-day stats. Mobile passes [since, until) bookends already anchored to
// the canvasser's local midnight, so the server doesn't need to know about
// timezones for this endpoint.
router.get('/day', async (req, res, next) => {
  try {
    const { campaignId, since, until } = req.query;
    if (!campaignId || !mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ error: 'campaignId query param is required' });
    }
    const sinceMs = Date.parse(since);
    const untilMs = Date.parse(until);
    if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs <= sinceMs) {
      return res.status(400).json({ error: 'since and until ISO timestamps required' });
    }
    if (untilMs - sinceMs > 36 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'window too wide (max 36h)' });
    }

    const stats = await computeDailyStats({
      userId: req.user._id,
      campaignId: new mongoose.Types.ObjectId(campaignId),
      start: new Date(sinceMs),
      end: new Date(untilMs),
    });

    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// All-time history for one user in one campaign, binned by day in the
// canvasser's timezone. Returns: per-day summary rows, all-time totals,
// personal best (max doors in a day), and current streak. Single user × single
// campaign aggregation is bounded — even a long campaign produces a tractable
// payload (~150 bytes per day × <1y = under ~50KB).
router.get('/history', async (req, res, next) => {
  try {
    const { campaignId, tz } = req.query;
    if (!campaignId || !mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ error: 'campaignId query param is required' });
    }
    if (!tz) {
      return res.status(400).json({ error: 'tz query param required (IANA name)' });
    }

    const userId = req.user._id;
    const cId = new mongoose.Types.ObjectId(campaignId);

    const [activities, responses] = await Promise.all([
      CanvassActivity.find({
        userId,
        campaignId: cId,
        actionType: { $in: DOOR_ACTIONS },
      })
        .sort({ timestamp: 1 })
        .select('timestamp location actionType')
        .lean(),
      SurveyResponse.find({
        userId,
        campaignId: cId,
      })
        .select('submittedAt')
        .lean(),
    ]);

    // Validate the IANA name once by formatting `now` in it. Throws on bad
    // input — caught and returned as a 400 below.
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

    // Bin into a day map. Distance is computed per-day from the activity
    // sequence within that day (so the chain doesn't carry across the
    // overnight gap).
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

    // Current streak — consecutive days with activity ending today (or yesterday
    // if today hasn't had any yet, so the streak doesn't die at midnight).
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
