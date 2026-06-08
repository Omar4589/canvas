// Shared report aggregation primitives. Extracted from routes/admin/reports.js so the
// admin dashboards AND the client report builder compute knocks/connection-rate/coverage
// identically (one source of truth). These are pure — no req, no DB handles — so they can
// be composed into any pipeline with any match (org/campaign/effort/date-window).

// Action types that count as a "knock" (a door interaction). note_added is excluded
// because it can be left without an actual visit decision.
export const KNOCK_ACTIONS = ['not_home', 'wrong_address', 'survey_submitted', 'lit_dropped'];

// Billable "knock" = one distinct (household, pass). Re-knocking a house within the SAME
// pass (a correction, or a second/overlapping canvasser) counts once; going back in a NEW
// pass counts again. passId:null collapses to a single legacy bucket per household (pre-turf
// data = one knock/house). The pipeline also tallies how many of those knocks landed a
// survey / lit drop, so the connection rate's numerator is always a subset of knocks.
export function knocksPipeline(match, { byCampaign = false } = {}) {
  const inner = { householdId: '$householdId', passId: '$passId' };
  if (byCampaign) inner.campaignId = '$campaignId';
  return [
    { $match: { ...match, actionType: { $in: KNOCK_ACTIONS } } },
    {
      $group: {
        _id: inner,
        hasSurvey: { $max: { $cond: [{ $eq: ['$actionType', 'survey_submitted'] }, 1, 0] } },
        hasLit: { $max: { $cond: [{ $eq: ['$actionType', 'lit_dropped'] }, 1, 0] } },
      },
    },
    {
      $group: {
        _id: byCampaign ? '$_id.campaignId' : null,
        knocks: { $sum: 1 },
        surveyedKnocks: { $sum: '$hasSurvey' },
        litKnocks: { $sum: '$hasLit' },
      },
    },
  ];
}

// Connection rate = of the knocks we made, how many landed a completion action (a survey, or
// a lit drop). Survey/lit completions are mutually exclusive within a campaign, so the
// numerator is just their sum; it's always a subset of knocks, so the rate is always <= 100.
// Returns an integer percentage. (The UI labels it "Survey rate" / "Lit rate" by campaign type;
// the value is identical either way.)
export function connectionRate({ knocks = 0, surveyedKnocks = 0, litKnocks = 0 } = {}) {
  if (!knocks) return 0;
  return Math.round(((surveyedKnocks + litKnocks) / knocks) * 100);
}

// Coverage-funnel bucket. Doors that are fully early-voted AND otherwise unknocked are pulled
// out of `unknocked` into their own `voted` segment, so early voting doesn't inflate "unknocked"
// (those doors dropped off the canvasser's list and will never be knocked). Knocked doors keep
// their real status. Used by the status group-by in /overview and /campaign-rollup.
export const coverageBucketExpr = {
  $cond: [
    { $and: [{ $eq: ['$fullyVoted', true] }, { $eq: ['$status', 'unknocked'] }] },
    'voted',
    '$status',
  ],
};
