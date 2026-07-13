import mongoose from 'mongoose';

// Shared report aggregation primitives. Extracted from routes/admin/reports.js so the
// admin dashboards AND the client report builder compute knocks/connection-rate/coverage
// identically (one source of truth). These are pure — no req, no DB handles — so they can
// be composed into any pipeline with any match (org/campaign/effort/date-window).

// Action types that count as a "knock" (a door interaction). note_added is excluded
// because it can be left without an actual visit decision.
export const KNOCK_ACTIONS = ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped'];

// Excludes admin BULK-authored rows (via:'bulk', today only bulk-restrict) from
// per-CANVASSER surfaces: timelines, leaderboards, shift windows, travel, the
// GPS audit, activity feeds, active-now. Bulk rows still drive door status,
// per-round views, coverage, and campaign-scope tallies. Spread into a $match:
// `{ ...match, ...NOT_BULK }`. `$ne` matches docs without the field, so legacy
// rows need no backfill.
export const NOT_BULK = { via: { $ne: 'bulk' } };

// The $set stage that folds a TEAM LEAD'S OWN work onto the team they run.
//
// `coordinatorId` on a knock answers "who oversees the person who knocked this". A lead is overseen
// by nobody, so their own knocks and surveys stamp `null` and would land in the "No team" bucket —
// the bucket admins deliberately EXCLUDE when reporting a team's number to a client. The lead would
// be missing from their own team, and the No-team bucket would be inflated by every lead's work.
//
// This MUST be applied identically to the CanvassActivity aggregate AND the SurveyResponse
// aggregate. It once wasn't: doors were folded and voters-surveyed were not, so a team whose lead
// knocks showed a row with the lead's DOORS included and their VOTERS excluded. A sum-based
// reconciliation check cannot see that — the row just quietly lies. Hence ONE definition, shared by
// routes/admin/reports.js and migrations/auditTeamCounts.js (an audit that can be wrong in the same
// way as the thing it audits is worth nothing).
//
// `leadIds` = every userId that is somebody's coordinator in this org (whatever their ROLE — an
// admin can run a crew just as a lead can). Anyone who is nobody's coordinator and has no
// coordinator of their own — a plain org admin, a super-admin, a candidate knocking their own
// district — correctly falls to `null`: the "No team" bucket, which is a real answer, not a
// fallback for people the system lost track of.
export function teamFoldStage(leadIds) {
  const ids = (leadIds || []).map((s) => new mongoose.Types.ObjectId(String(s)));
  return {
    $set: {
      team: {
        $cond: [
          { $ne: ['$coordinatorId', null] },
          '$coordinatorId',
          { $cond: [{ $in: ['$userId', ids] }, '$userId', null] },
        ],
      },
    },
  };
}

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
        hasRefused: { $max: { $cond: [{ $eq: ['$actionType', 'refused'] }, 1, 0] } },
      },
    },
    {
      $group: {
        _id: byCampaign ? '$_id.campaignId' : null,
        knocks: { $sum: 1 },
        surveyedKnocks: { $sum: '$hasSurvey' },
        litKnocks: { $sum: '$hasLit' },
        refusedKnocks: { $sum: '$hasRefused' },
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

// "Reached a person" / contact rate = of the knocks we made, how many reached a live person —
// a completed survey OR a refusal (both mean someone answered the door). Always a subset of
// knocks, so always <= 100. Distinct from connectionRate (survey/lit completions only): a
// refused door is reached but not surveyed, so it lifts the contact rate without the survey rate.
export function contactRate({ knocks = 0, surveyedKnocks = 0, refusedKnocks = 0 } = {}) {
  if (!knocks) return 0;
  return Math.round(((surveyedKnocks + refusedKnocks) / knocks) * 100);
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
