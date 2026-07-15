import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { Household } from '../../models/Household.js';
import { resolveStatus } from '../../utils/statusPrecedence.js';
import { KNOCK_ACTIONS, knocksPipeline, connectionRate, contactRate } from './aggregations.js';
import { choiceKeyStages, mergeOptionRows } from '../surveys/answerAgg.js';

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
// admin /survey-results math: percent = count / THIS question's own answer total (Σ of its non-null
// option counts), so single-choice → 100% of answerers and multiple-choice → 100% of selections —
// not the global response count. Text questions are skipped (no meaningful breakdown).
// isSupportQuestion flags the one the operator designated as the headline support question.
export async function computeSurveyBreakdowns({ surveyScopeMatch, template, supportQuestionKey = null }) {
  if (!template) return [];
  const templateMatch = { ...surveyScopeMatch, surveyTemplateId: template._id };

  const sortedQs = [...(template.questions || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const out = [];
  for (const q of sortedQs) {
    if (q.type !== 'single_choice' && q.type !== 'multiple_choice') continue;
    // Dual-read: group on stable option ids (id-native) or legacy answer text.
    const agg = await SurveyResponse.aggregate([
      { $match: templateMatch },
      ...choiceKeyStages(q.key),
      { $group: { _id: '$_answerKeys', count: { $sum: 1 } } },
    ]);
    const merged = mergeOptionRows(q, agg);
    const questionTotal = merged.reduce((s, o) => s + o.count, 0);
    const options = merged.map((o) => ({
      option: o.text,
      id: o.id,
      retired: o.retired,
      count: o.count,
      percent: questionTotal > 0 ? Math.round((o.count / questionTotal) * 1000) / 10 : 0,
    }));

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
  campaignType = null,
  template = null,
  supportQuestionKey = null,
}) {
  const scope = scopeFilter({ orgId, campaignId, effortId });
  const actMatch = { ...scope, ...dateMatch('timestamp', range) };
  const surveyScopeMatch = { ...scope, ...dateMatch('submittedAt', range) };

  const [knockAgg, knockGroups, surveysTaken, surveyedVoterIds, distinctHomes] = await Promise.all([
    CanvassActivity.aggregate(knocksPipeline(actMatch)),
    // Contact breakdown is a DOOR-OUTCOME breakdown, not a raw-event count: collapse each
    // (household, pass) to its single resolved outcome (the same resolveStatus the live app uses
    // for door status), so the breakdown sums to doorsKnocked (billable knocks) instead of
    // over-counting. A door knocked by two canvassers in the SAME pass — an "overlap" — has two
    // CanvassActivity rows but is one knock with one outcome here. Same (household, pass) grouping
    // and window as knocksPipeline, so the two always agree (Σ events === knocks; events.surveyed
    // === surveyedKnocks). See docs/METRICS.md (overlaps) and docs/CLIENT_PORTAL.md.
    CanvassActivity.aggregate([
      { $match: { ...actMatch, actionType: { $in: KNOCK_ACTIONS } } },
      {
        $group: {
          _id: { householdId: '$householdId', passId: '$passId' },
          acts: { $push: { actionType: '$actionType', timestamp: '$timestamp' } },
        },
      },
    ]),
    SurveyResponse.countDocuments(surveyScopeMatch),
    SurveyResponse.distinct('voterId', surveyScopeMatch),
    CanvassActivity.distinct('householdId', { ...actMatch, actionType: { $in: KNOCK_ACTIONS } }),
  ]);

  const k = knockAgg[0] || { knocks: 0, surveyedKnocks: 0, litKnocks: 0, refusedKnocks: 0 };
  // One outcome per (household, pass): every group has >=1 knock action so resolveStatus never
  // returns 'unknocked'. Σ(events) === knockGroups.length === k.knocks === doorsKnocked. `refused`
  // is a knock outcome too, so it MUST be a key here or the breakdown stops summing to doorsKnocked.
  const events = { not_home: 0, wrong_address: 0, refused: 0, surveyed: 0, lit_dropped: 0 };
  for (const g of knockGroups) {
    const status = resolveStatus(campaignType, g.acts);
    if (status in events) events[status] += 1;
  }

  const totals = {
    doorsKnocked: k.knocks, // billable knocks (distinct household+pass) — the headline number
    homesKnocked: distinctHomes.length, // distinct households touched
    surveysTaken,
    surveyedVoters: surveyedVoterIds.length,
    surveyedKnocks: k.surveyedKnocks,
    litKnocks: k.litKnocks,
    refusedKnocks: k.refusedKnocks || 0,
    connectionRate: connectionRate(k),
    contactRate: contactRate(k), // "reached a person" = (surveyed + refused) / knocks
  };

  const surveyBreakdowns = await computeSurveyBreakdowns({
    surveyScopeMatch,
    template,
    supportQuestionKey,
  });

  return { totals, contactBreakdown: events, coverage: {}, surveyBreakdowns };
}

// A public map point may carry the CHOICE VALUE only — never anything a canvasser typed. A
// choice question can have an "Other: ___" write-in whose typed text lands verbatim in the
// response's answer snapshot, and canvasser-typed text pinned to a street address on an
// unauthenticated page can be anything, including a voter's name. So the public answer is
// rebuilt from option ids against the template's canonical labels ('__other__' → the literal
// 'Other'); rows with no option ids (pre-option-id responses) keep only snapshot values that
// exactly match a canonical label. Also reused by migrations/scrubMapPointAnswers.js, whose
// stored rows have no optionIds and therefore always take the snapshot-matching branch.
export function publicPointAnswer(question, row) {
  if (!question || question.type === 'text') return null; // text questions never reach the map
  const labelById = new Map((question.options || []).map((o) => [o.id, o.text]));
  const ids = Array.isArray(row.optionIds) ? row.optionIds : [];
  let values;
  if (ids.length) {
    values = ids
      .map((id) => (id === '__other__' ? 'Other' : labelById.get(id)))
      .filter((v) => v != null);
  } else {
    const allowed = new Set(labelById.values());
    const texts = row.answer == null ? [] : Array.isArray(row.answer) ? row.answer : [row.answer];
    values = texts.map((t) => (allowed.has(t) ? t : 'Other'));
  }
  values = [...new Set(values)];
  if (!values.length) return null;
  return question.type === 'multiple_choice' ? values : values[0];
}

// Build the FROZEN map points for a published report: every in-scope household with
// coordinates, its status AS OF rangeEndUtc (resolveStatus over activities < that instant —
// identical to how the live app derives status, but point-in-time), and the operator-
// whitelisted survey answers (latest response per household), sanitized to canonical choice
// values via publicPointAnswer. No canvasser identity is included. Returns the point docs +
// a cumulative coverage tally derived from them.
export async function buildFrozenMapPoints({ report, campaign, template = null, mapAnswerKeys = [] }) {
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
  // Every emitted answer passes through publicPointAnswer: a missing template question (or a
  // template that can't be resolved) drops the row rather than passing typed text through.
  const answersByHh = new Map();
  if (mapAnswerKeys.length) {
    const questionByKey = new Map(((template && template.questions) || []).map((q) => [q.key, q]));
    const responses = await SurveyResponse.find(
      { organizationId: orgId, campaignId, submittedAt: { $lt: before } },
      { householdId: 1, submittedAt: 1, answers: 1 }
    )
      .sort({ submittedAt: 1 })
      .lean();
    for (const r of responses) {
      const picked = (r.answers || [])
        .filter((a) => mapAnswerKeys.includes(a.questionKey))
        .map((a) => ({
          questionKey: a.questionKey,
          answer: publicPointAnswer(questionByKey.get(a.questionKey), a),
        }))
        .filter((a) => a.answer != null);
      if (picked.length) answersByHh.set(String(r.householdId), picked);
    }
  }

  const coverage = { unknocked: 0, not_home: 0, surveyed: 0, wrong_address: 0, refused: 0, lit_dropped: 0, restricted: 0 };
  const points = [];
  for (const h of households) {
    const coords = h.location?.coordinates || [];
    if (coords.length < 2) continue;
    const status = resolveStatus(campaign.type, actsByHh.get(String(h._id)) || []);
    coverage[status] = (coverage[status] || 0) + 1;
    // The client map shows only doors we actually reached — skip unknocked points (coverage
    // above still counts them). The client UI also filters unknocked for older snapshots.
    if (status === 'unknocked') continue;
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
