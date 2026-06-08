import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { Household } from '../../models/Household.js';
import { resolveStatus } from '../../utils/statusPrecedence.js';
import { KNOCK_ACTIONS, knocksPipeline, connectionRate } from './aggregations.js';

// Compute service for the client report builder. Everything here is WINDOWED by an explicit
// UTC date range so a snapshot can be frozen for a given week (period) AND cumulatively
// (everything through the week's end). Activity/survey based — never reads live
// Household.status — so a frozen report can't drift when more knocks land later.
// See docs/CLIENT_PORTAL.md and routes/admin/clientReports.js.

// {$gte?,$lt?} → a field match, or {} when the range is empty (open-ended cumulative
// passes only $lt; the week passes both).
function dateMatch(field, range) {
  if (!range) return {};
  const r = {};
  if (range.$gte) r.$gte = range.$gte;
  if (range.$lt) r.$lt = range.$lt;
  if (!r.$gte && !r.$lt) return {};
  return { [field]: r };
}

function scopeFilter({ orgId, campaignId, effortId }) {
  const f = { organizationId: orgId, campaignId };
  if (effortId) f.effortId = effortId;
  return f;
}

// Per-question option counts/percent for the choice questions of a template, matching the
// admin /survey-results math (percent = count / totalResponses, rounded to 0.1). Text
// questions are skipped (no meaningful breakdown). isSupportQuestion flags the one the
// operator designated as the headline support question.
export async function computeSurveyBreakdowns({ surveyScopeMatch, template, supportQuestionKey = null }) {
  if (!template) return [];
  const templateMatch = { ...surveyScopeMatch, surveyTemplateId: template._id };
  const totalResponses = await SurveyResponse.countDocuments(templateMatch);

  const sortedQs = [...(template.questions || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const out = [];
  for (const q of sortedQs) {
    if (q.type !== 'single_choice' && q.type !== 'multiple_choice') continue;
    const pipeline = [
      { $match: templateMatch },
      { $unwind: '$answers' },
      { $match: { 'answers.questionKey': q.key } },
    ];
    if (q.type === 'multiple_choice') pipeline.push({ $unwind: '$answers.answer' });
    pipeline.push({ $group: { _id: '$answers.answer', count: { $sum: 1 } } });
    pipeline.push({ $sort: { count: -1 } });
    const agg = await SurveyResponse.aggregate(pipeline);

    const options = agg
      .filter((r) => r._id !== null && r._id !== undefined && r._id !== '')
      .map((r) => {
        const optionKey = typeof r._id === 'string' ? r._id : String(r._id);
        return {
          option: optionKey,
          count: r.count,
          percent: totalResponses > 0 ? Math.round((r.count / totalResponses) * 1000) / 10 : 0,
        };
      });

    out.push({
      questionKey: q.key,
      questionLabel: q.label,
      type: q.type,
      isSupportQuestion: supportQuestionKey ? q.key === supportQuestionKey : false,
      options,
    });
  }
  return out;
}

// One window's frozen aggregates: totals (KPI cards), contactBreakdown (voter-contact
// outcomes), and surveyBreakdowns. `range` is {$gte?,$lt?} in UTC. Reuses the shared knock
// primitives so the numbers match the admin dashboards.
export async function computeWindowStats({
  orgId,
  campaignId,
  effortId = null,
  range,
  template = null,
  supportQuestionKey = null,
}) {
  const scope = scopeFilter({ orgId, campaignId, effortId });
  const actMatch = { ...scope, ...dateMatch('timestamp', range) };
  const surveyScopeMatch = { ...scope, ...dateMatch('submittedAt', range) };

  const [knockAgg, eventAgg, surveysTaken, surveyedVoterIds, distinctHomes] = await Promise.all([
    CanvassActivity.aggregate(knocksPipeline(actMatch)),
    CanvassActivity.aggregate([
      { $match: actMatch },
      { $group: { _id: '$actionType', count: { $sum: 1 } } },
    ]),
    SurveyResponse.countDocuments(surveyScopeMatch),
    SurveyResponse.distinct('voterId', surveyScopeMatch),
    CanvassActivity.distinct('householdId', { ...actMatch, actionType: { $in: KNOCK_ACTIONS } }),
  ]);

  const k = knockAgg[0] || { knocks: 0, surveyedKnocks: 0, litKnocks: 0 };
  const events = { not_home: 0, wrong_address: 0, surveyed: 0, lit_dropped: 0 };
  for (const r of eventAgg) {
    if (r._id === 'not_home') events.not_home = r.count;
    else if (r._id === 'wrong_address') events.wrong_address = r.count;
    else if (r._id === 'survey_submitted') events.surveyed = r.count;
    else if (r._id === 'lit_dropped') events.lit_dropped = r.count;
  }

  const totals = {
    doorsKnocked: k.knocks, // billable knocks (distinct household+pass) — the headline number
    homesKnocked: distinctHomes.length, // distinct households touched
    surveysTaken,
    surveyedVoters: surveyedVoterIds.length,
    surveyedKnocks: k.surveyedKnocks,
    litKnocks: k.litKnocks,
    connectionRate: connectionRate(k),
  };

  const surveyBreakdowns = await computeSurveyBreakdowns({
    surveyScopeMatch,
    template,
    supportQuestionKey,
  });

  return { totals, contactBreakdown: events, coverage: {}, surveyBreakdowns };
}

// Build the FROZEN map points for a published report: every in-scope household with
// coordinates, its status AS OF rangeEndUtc (resolveStatus over activities < that instant —
// identical to how the live app derives status, but point-in-time), and the operator-
// whitelisted survey answers (latest response per household). No canvasser identity is
// included. Returns the point docs + a cumulative coverage tally derived from them.
export async function buildFrozenMapPoints({ report, campaign, mapAnswerKeys = [] }) {
  const orgId = report.organizationId;
  const campaignId = report.campaignId;
  const before = report.rangeEndUtc;

  const households = await Household.find(
    {
      organizationId: orgId,
      campaignId,
      isActive: true,
      'location.coordinates': { $exists: true, $ne: null },
    },
    { addressLine1: 1, city: 1, state: 1, location: 1 }
  ).lean();

  // As-of-date status: all activities before the window end, grouped per household.
  const actAgg = await CanvassActivity.aggregate([
    { $match: { organizationId: orgId, campaignId, timestamp: { $lt: before } } },
    {
      $group: {
        _id: '$householdId',
        acts: { $push: { actionType: '$actionType', timestamp: '$timestamp' } },
      },
    },
  ]);
  const actsByHh = new Map(actAgg.map((r) => [String(r._id), r.acts]));

  // Whitelisted survey answers — latest response per household wins (ascending sort, last
  // write per household sticks). Empty whitelist = no answers stored (map shows status only).
  const answersByHh = new Map();
  if (mapAnswerKeys.length) {
    const responses = await SurveyResponse.find(
      { organizationId: orgId, campaignId, submittedAt: { $lt: before } },
      { householdId: 1, submittedAt: 1, answers: 1 }
    )
      .sort({ submittedAt: 1 })
      .lean();
    for (const r of responses) {
      const picked = (r.answers || [])
        .filter((a) => mapAnswerKeys.includes(a.questionKey))
        .map((a) => ({ questionKey: a.questionKey, answer: a.answer }));
      if (picked.length) answersByHh.set(String(r.householdId), picked);
    }
  }

  const coverage = { unknocked: 0, not_home: 0, surveyed: 0, wrong_address: 0, lit_dropped: 0 };
  const points = [];
  for (const h of households) {
    const coords = h.location?.coordinates || [];
    if (coords.length < 2) continue;
    const status = resolveStatus(campaign.type, actsByHh.get(String(h._id)) || []);
    coverage[status] = (coverage[status] || 0) + 1;
    points.push({
      clientReportId: report._id,
      organizationId: orgId,
      campaignId,
      householdId: h._id,
      lng: coords[0],
      lat: coords[1],
      addressLine1: h.addressLine1 || '',
      city: h.city || '',
      state: h.state || '',
      status,
      answers: answersByHh.get(String(h._id)) || [],
    });
  }

  return { points, coverage, count: points.length };
}
