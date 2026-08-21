import mongoose from 'mongoose';

// Shared report aggregation primitives. Extracted from routes/admin/reports.js so the
// admin dashboards AND the client report builder compute knocks/connection-rate/coverage
// identically (one source of truth). These are pure — no req, no DB handles — so they can
// be composed into any pipeline with any match (org/campaign/effort/date-window).

// Action types that count as a "knock" (a door interaction). note_added is excluded
// because it can be left without an actual visit decision. `no_soliciting` IS a knock — the
// canvasser reached the door and a posted sign ended the visit, the same walk as any other
// door — but it is NOT a contact, so it never enters the contactRate numerator below.
// `restricted` is the only disposition that is a visit without being a knock (never reached
// the door); it lives in BILLABLE_WITH_RESTRICTED instead.
export const KNOCK_ACTIONS = ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped', 'no_soliciting'];

// The wider set used ONLY for billable-DOOR counting when an org opts in
// (Campaign/Organization.billRestrictedDoors — resolve via billRestricted.js). A restricted mark
// is still not a knock and never becomes one: it can add a *door* to an invoice, never a knock to
// a rate. Also the set that decides when a campaign's billing clock STARTS, which is deliberately
// flag-independent (services/billing/statement.js).
export const BILLABLE_WITH_RESTRICTED = [...KNOCK_ACTIONS, 'restricted'];

// Apply the billable-door POLICY to a knocksPipeline row. Callers run the pipeline with
// includeRestricted so `restrictedDoors` always reports how many inaccessible doors are there —
// the same number whether or not the org bills for them, which is what lets the UI say "you have
// N restricted doors, turn this on to bill them". This helper is then the ONE place that decides
// whether they count, so `restrictedDoors` can't mean "exists" on one surface and "is billed" on
// another. Returns the number to present as billable doors.
export function billableDoorsOf(row, billRestricted) {
  if (!row) return 0;
  return billRestricted ? row.billableDoors || 0 : row.knocks || 0;
}

// Excludes admin DESK-authored rows (via:'bulk' — today only desk restricted marks,
// a whole book or a single home, services/canvass/deskRestrict.js) from
// per-CANVASSER surfaces: timelines, leaderboards, shift windows, travel, the
// GPS audit, activity feeds, active-now. Desk rows still drive door status,
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
  // $ifNull is LOAD-BEARING, not defensive fluff. Rows written before the coordinatorId field
  // existed have it ABSENT (the backfill only stamps members who HAVE a coordinator — a lead's own
  // history stays unstamped). In aggregation expressions, missing is NOT equal to null
  // ({$ne: [missing, null]} → true — verified empirically on Mongo 7), so without the $ifNull the
  // fold takes the "has a team" branch, emits a MISSING team, and $group then collapses missing to
  // null — silently parking every lead's own pre-backfill doors in the "No team" bucket. The
  // reconciliation still balances (the doors are counted, in the wrong row), so no sum-check can
  // catch it. (Query-context filters are unaffected: {coordinatorId: null} DOES match absent.)
  const coord = { $ifNull: ['$coordinatorId', null] };
  return {
    $set: {
      team: {
        $cond: [
          { $ne: [coord, null] },
          coord,
          { $cond: [{ $in: ['$userId', ids] }, '$userId', null] },
        ],
      },
    },
  };
}

// The QUERY-context twin of teamFoldStage: resolve a ?coordinatorId into a match clause.
//
// A team is its crew PLUS THE LEAD'S OWN DOORS. `coordinatorId` answers "who oversees me", so a
// lead's own knocks stamp *their* coordinator (usually nobody) and would otherwise fall into the
// No-team bucket — the lead would be missing from their own team's number. Hence the $or.
// `none` then has to exclude the leads, or their doors would be counted twice.
//
//   coordinatorId=<id>   → that team ($or: stamped onto the team, or the lead's own null rows)
//   coordinatorId=none   → the "No team" bucket (a candidate knocking their own district, etc.)
//
// `allLeadIds` (only needed for `none`) comes from leadIdsForScope in routes/admin/reports.js —
// ledger-derived, deliberately. The ids arrive as STRINGS and are cast here because this clause
// is used in aggregation $matches too (knocksByPass coverageGained, /canvasser-timeline), where
// Mongoose does no schema casting — a string $nin against an ObjectId userId excludes nothing
// and silently double-counts every lead's doors into `none`. Same reason teamFoldStage casts.
//
// teamAttribution.int.test.js asserts this filter and the teamFoldStage fold never drift.
export function teamMatch(coordinatorId, allLeadIds = []) {
  if (!coordinatorId) return {};
  if (coordinatorId === 'none') {
    const ids = allLeadIds.map((s) => new mongoose.Types.ObjectId(String(s)));
    return ids.length
      ? { coordinatorId: null, userId: { $nin: ids } }
      : { coordinatorId: null };
  }
  const id = new mongoose.Types.ObjectId(String(coordinatorId));
  return { $or: [{ coordinatorId: id }, { userId: id, coordinatorId: null }] };
}

// Merge a team clause into a match. NEVER spread it — teamMatch can return `$or` (which a plain
// spread would clobber against the cross-timezone date windows' own `$or`), and the `none` shape
// carries a `userId` key that would silently REPLACE a canvasser-drill's userId filter. $and
// composes safely no matter what either side contains, so it is used unconditionally.
export function withTeam(match, team) {
  if (!team || !Object.keys(team).length) return match;
  return { ...match, $and: [...(match.$and || []), team] };
}

// Billable "knock" = one distinct (household, pass). Re-knocking a house within the SAME
// pass (a correction, or a second/overlapping canvasser) counts once; going back in a NEW
// pass counts again. passId:null collapses to a single legacy bucket per household (pre-turf
// data = one knock/house). The pipeline also tallies how many of those knocks landed a
// survey / lit drop, so the connection rate's numerator is always a subset of knocks.
//
// `byPass` promotes the inner group's passId to the OUTER group — one row per round.
// The inner (household, pass) dedup is identical either way, so Σ(byPass rows) equals the
// collapsed campaign total by construction: per-round numbers can never disagree with the
// headline they break down. passId:null surfaces as one legacy row (_id: null).
//
// `includeRestricted` widens the action set so an inaccessible door counts as a BILLABLE DOOR
// (opt-in per org/campaign — see billRestricted.js). It deliberately does NOT make restricted a
// knock: the flag adds rows to the dedup, and the extra `hasKnock` fold below keeps `knocks`
// meaning exactly what it always meant. So every rate built on `knocks` (connectionRate,
// contactRate) and every surveyed/lit/refused sub-count are byte-identical in both states, and
// with the flag OFF `billableDoors === knocks` and `restrictedDoors === 0` — an org that never
// opts in sees nothing in the product change. That equivalence is the invariant this function
// exists to hold; test/billableRestricted.int.test.js asserts it.
export function knocksPipeline(match, { byCampaign = false, byPass = false, includeRestricted = false } = {}) {
  const inner = { householdId: '$householdId', passId: '$passId' };
  if (byCampaign) inner.campaignId = '$campaignId';
  const actions = includeRestricted ? BILLABLE_WITH_RESTRICTED : KNOCK_ACTIONS;
  return [
    { $match: { ...match, actionType: { $in: actions } } },
    // Drop DESK-authored RESTRICTED rows (via:'bulk' — a whole book or a single home,
    // services/canvass/deskRestrict.js): an admin marking a gated community or one locked gate
    // from the console did no field work, and the whole point of the opt-in is paying for the
    // walk.
    //
    // Scoped to `restricted` on purpose — a blanket NOT_BULK here is WRONG and was caught by
    // knocksByPass.int.test.js. A via:'bulk' row on a KNOCK action is a real billable knock that
    // round totals are contractually required to include (only per-CANVASSER surfaces exclude
    // bulk — see NOT_BULK above), so filtering it out silently deletes a door from the invoice.
    //
    // $nor rather than a top-level $or so it can never clobber an $or the CALLER put in `match`
    // (the team/crew filters do). Adjacent $match stages are coalesced by the query planner.
    ...(includeRestricted ? [{ $match: { $nor: [{ actionType: 'restricted', via: 'bulk' }] } }] : []),
    {
      $group: {
        _id: inner,
        // Constant 1 when includeRestricted is false — which is what makes `knocks` below
        // identical to the historical `{ $sum: 1 }`.
        hasKnock: { $max: { $cond: [{ $in: ['$actionType', KNOCK_ACTIONS] }, 1, 0] } },
        hasSurvey: { $max: { $cond: [{ $eq: ['$actionType', 'survey_submitted'] }, 1, 0] } },
        hasLit: { $max: { $cond: [{ $eq: ['$actionType', 'lit_dropped'] }, 1, 0] } },
        hasRefused: { $max: { $cond: [{ $eq: ['$actionType', 'refused'] }, 1, 0] } },
        hasNoSoliciting: { $max: { $cond: [{ $eq: ['$actionType', 'no_soliciting'] }, 1, 0] } },
      },
    },
    {
      $group: {
        _id: byCampaign ? '$_id.campaignId' : byPass ? '$_id.passId' : null,
        // Unchanged meaning: a door someone actually knocked. Rates read THIS.
        knocks: { $sum: '$hasKnock' },
        // What an opted-in org invoices from. The (household, pass) dedup does the hard part for
        // free: a door where one canvasser marked restricted and another knocked is ONE billable
        // door, and a restricted mark later superseded by a real disposition folds into the knock
        // rather than adding to it.
        billableDoors: { $sum: 1 },
        restrictedDoors: { $sum: { $cond: [{ $eq: ['$hasKnock', 0] }, 1, 0] } },
        surveyedKnocks: { $sum: '$hasSurvey' },
        litKnocks: { $sum: '$hasLit' },
        refusedKnocks: { $sum: '$hasRefused' },
        // A knock, never a contact — reported so the invoice-grade export and the by-round
        // table can show it, but deliberately absent from contactRate below.
        noSolicitingKnocks: { $sum: '$hasNoSoliciting' },
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

// Coverage-funnel bucket. Doors that are suppressed AND otherwise unknocked are pulled out of
// `unknocked` into their own synthetic segment, so suppression doesn't inflate "unknocked"
// (those doors dropped off the canvasser's list and will never be knocked). Knocked doors keep
// their real status. THREE synthetic segments, in precedence order: `doNotKnock` (the address
// itself asked that nobody come back — permanent, and never auto-reopens) outranks `dnc` (every
// resident individually asked not to be contacted — permanent, but reopens for a new resident),
// which outranks `voted` (this election's early voting — cyclical). A door in two or three
// buckets counts ONCE, in the strongest, so segment totals always sum to the universe.
// Used by the status group-by in /overview and /campaign-rollup.
// "Houses knocked" — the ONE definition (owner ruling 2026-07-29: a door we could not knock is
// not a knocked door). Two forms because two kinds of surface consume it:
//
//   NON_KNOCKED_STATUSES — for queries over RAW Household.status. `restricted` is excluded:
//     a gated community nobody could enter was never knocked, and counting it inflated the
//     Campaigns page 20 points over the dashboard (11,390 vs 8,164 on a real campaign).
//   NON_KNOCKED_BUCKETS — for queries over coverageBucketExpr output (below). Adds `doNotKnock`,
//     `dnc` and `voted`, which are SYNTHETIC buckets carved exclusively out of raw-`unknocked`
//     doors — so at bucket level they must be excluded too, or a suppressed door nobody visited
//     counts as knocked. (The rollup excluded voted but not dnc — that was a bug, not a choice.)
//
// Every "houses knocked" / knockedPct on any surface must derive from one of these two.
export const NON_KNOCKED_STATUSES = ['unknocked', 'restricted'];
export const NON_KNOCKED_BUCKETS = [...NON_KNOCKED_STATUSES, 'doNotKnock', 'dnc', 'voted'];

export const coverageBucketExpr = {
  $switch: {
    branches: [
      {
        case: { $and: [{ $eq: ['$doNotKnock', true] }, { $eq: ['$status', 'unknocked'] }] },
        then: 'doNotKnock',
      },
      {
        case: { $and: [{ $eq: ['$fullyDnc', true] }, { $eq: ['$status', 'unknocked'] }] },
        then: 'dnc',
      },
      {
        case: { $and: [{ $eq: ['$fullyVoted', true] }, { $eq: ['$status', 'unknocked'] }] },
        then: 'voted',
      },
    ],
    default: '$status',
  },
};
