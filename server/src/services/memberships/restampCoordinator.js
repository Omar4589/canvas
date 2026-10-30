import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { User } from '../../models/User.js';
import { NOT_BULK, KNOCK_ACTIONS, knocksPipeline } from '../reports/aggregations.js';

// Re-stamp the frozen TEAM tag on a canvasser's ledger history when their crew changes.
//
// THE RULE: the current coordinator owns all of that canvasser's history IN THIS CAMPAIGN — all
// time, but one campaign. So assigning a crew to someone who already knocked here pulls those
// earlier doors onto the new team, and moving someone from crew A to crew B takes their history
// with them — within this race, and no further.
//
// It was org-wide until crews became per-campaign (models/CampaignAssignment.js). That was coherent
// while a coordinator was an org-chart fact, and stopped being coherent the moment two campaigns
// wanted different crews: two leads reorganizing their own crews overwrote each other, and this
// re-stamp then moved the loser's doors in a race the winner did not manage.
//
// The counterpart rule, which is just as load-bearing: DEPARTURE never re-stamps. When a
// coordinator leaves a campaign or the org, services/users/deleteAccount.js (releaseAssignedWork)
// clears their crew's roster crew but deliberately leaves the ledger alone, so the departed
// coordinator's team keeps the doors it supervised. That is the 104-door fix; do not "unify" the two
// paths.
//
// INDEX HINTS. A one-person query here is hinted to the person's index, so the planner can't wander
// onto the org-wide one (restampFilter carries organizationId, and an org-scoped probe can read the
// whole org — the trap services/users/deleteAccount.js documents). The bulk preview reads many people
// in one campaign and is hinted to the campaign index instead: the person index would read each
// person's whole ledger. A hint names an index that must exist, which is why the integration preload
// builds these first (scripts/testIndexPreload.mjs) and the release dry-runs build-indexes.
export const PERSON_ACTIVITY_HINT = { userId: 1, timestamp: -1 };
export const PERSON_SURVEY_HINT = { userId: 1 };
export const CAMPAIGN_ACTIVITY_HINT = { campaignId: 1, timestamp: -1 };
export const CAMPAIGN_SURVEY_HINT = { campaignId: 1, submittedAt: -1 };
//
// Reversal needs no undo record: the operation is idempotent w.r.t. current state, so setting the
// coordinator back re-stamps everything back.

// Rows whose team can move. Callers must NOT hand-roll this — previewRestamp and
// restampLedgerCoordinator share it so the number the UI promises is the number that moves.
//
// `coordinatorId: { $ne: next }` is LOAD-BEARING, not an optimization, for two reasons:
//
//   1. It makes modifiedCount === matchedCount, so what we report is exactly what moved. A filter
//      that re-writes rows already holding `next` would inflate "moved 4,412" with no-ops.
//   2. It sweeps legacy rows for free, and does so correctly in BOTH directions, because Mongo's
//      QUERY context treats a missing field as null-ish asymmetrically:
//        · next is a real id → {$ne: id} matches rows stamped with another id, rows holding an
//          explicit null, AND rows where the field is ABSENT (pre-backfill history). All swept.
//        · next is null      → {$ne: null} matches NEITHER explicit-null nor absent rows, only
//          rows carrying a real id. Exactly right: an absent row already reads as "no team"
//          everywhere, so writing to it would be churn with no semantic effect.
//
// ⚠️ This is the INVERSE of the rule in migrations/migrateActivityCoordinator.js, which keys on
// {$exists: false} precisely so it never overwrites a deliberate null. That migration was a
// one-time backfill and had to preserve nulls. This service is *supposed* to overwrite them: under
// the current-coordinator-owns-history rule a stale null is just another stale value. Do not
// "correct" this to $exists:false — that would quietly restore the frozen behavior.
export const restampFilter = ({ organizationId, userId, campaignId, coordinatorId, bulkAware = false }) => {
  // Without an org this is a cross-tenant write: the same person can hold memberships in two orgs,
  // which is exactly why Membership is unique on {userId, organizationId}.
  if (!organizationId) throw new Error('restampCoordinator: organizationId is required');
  if (!userId) throw new Error('restampCoordinator: userId is required');
  // And without a CAMPAIGN it is a cross-campaign write. A crew is per-campaign, so a re-stamp
  // must be too: two leads reorganizing their own crews used to clobber each other, and the
  // org-wide filter then dragged the first campaign's whole history onto the second lead's team.
  // Required rather than optional-with-a-default — an omitted scope silently means "everything",
  // and that is precisely the bug.
  if (!campaignId) throw new Error('restampCoordinator: campaignId is required');
  const next = coordinatorId ? new mongoose.Types.ObjectId(String(coordinatorId)) : null;
  return {
    organizationId: new mongoose.Types.ObjectId(String(organizationId)),
    campaignId: new mongoose.Types.ObjectId(String(campaignId)),
    userId: new mongoose.Types.ObjectId(String(userId)),
    // Bulk-restrict rows are stamped with the ADMIN's userId (routes/admin/turfs.js) and a
    // deliberate coordinatorId:null — desk work, not field work, so they sit outside every
    // per-team total. Without this an admin who bulk-restricted a gated community and is LATER
    // given a coordinator would have those office marks re-stamped onto a team.
    // Only CanvassActivity carries `via`; turfs.js never writes a SurveyResponse, so the survey
    // ledger needing no equivalent is correct rather than a gap.
    ...(bulkAware ? NOT_BULK : {}),
    coordinatorId: { $ne: next },
  };
};

// What WOULD move, for the confirmation UI. Returns raw row counts plus the deduped door count.
//
// `doors` is the number to put in front of a human: `activities` is a ROW count, while every team
// figure on /team-breakdown is distinct (householdId, passId). Quoting the row count next to the
// word "doors" would have the team row move by less than the confirmation promised, and an admin
// would reasonably conclude the feature is broken. Hence the shared knocksPipeline — an audit that
// can be wrong in the same way as the thing it audits is worth nothing.
export const previewRestamp = async ({ organizationId, userId, campaignId, coordinatorId }) => {
  const activityFilter = restampFilter({ organizationId, userId, campaignId, coordinatorId, bulkAware: true });
  const surveyFilter = restampFilter({ organizationId, userId, campaignId, coordinatorId });

  const [activities, surveys, doorAgg] = await Promise.all([
    CanvassActivity.countDocuments(activityFilter).hint(PERSON_ACTIVITY_HINT),
    SurveyResponse.countDocuments(surveyFilter).hint(PERSON_SURVEY_HINT),
    CanvassActivity.aggregate(knocksPipeline(activityFilter)).hint(PERSON_ACTIVITY_HINT),
  ]);

  return { activities, surveys, doors: doorAgg[0]?.knocks || 0 };
};

// The confirmation payload both assignment surfaces render — one builder, so a lead and an admin
// never see different wording (or different numbers) for the same act.
//
// `subjectRunsCrew` drives the warning that surprises people: assigning a coordinator to someone
// who is THEMSELVES a coordinator moves that person's OWN doors off their own team row and onto
// their new coordinator's. Their crew's doors are untouched. That follows the rule consistently,
// but it is not what an admin expects from "recording an org chart", so the UI says it out loud.
export const coordinatorPreviewBody = async ({ orgId, userId, campaignId, from, to }) => {
  const ids = [from, to].filter(Boolean).map((id) => String(id));
  const [counts, people, runsCrew] = await Promise.all([
    previewRestamp({ organizationId: orgId, userId, campaignId, coordinatorId: to }),
    ids.length ? User.find({ _id: { $in: ids } }, 'firstName lastName').lean() : [],
    // "Do they run a crew HERE?" — scoped to this campaign like everything else, so the warning
    // fires on the crew the admin is actually looking at rather than one in another race.
    CampaignAssignment.exists({ campaignId, coordinatorId: userId }),
  ]);
  const named = (id) => {
    if (!id) return null;
    const u = people.find((p) => String(p._id) === String(id));
    return { id: String(id), name: u ? `${u.firstName} ${u.lastName}`.trim() : 'Unknown' };
  };
  return { from: named(from), to: named(to), subjectRunsCrew: !!runsCrew, ...counts };
};

// Soft threshold. No hard cap: refusing the write would strand an admin in a UI dead end with no
// path out, and the operation is a single indexed updateMany either way.
const RESTAMP_WARN_ROWS = 50_000;

// Move the team tag on both ledgers. One updateMany per collection, run in sequence — NOT chunked.
// With no transactions available (the test harness is a standalone mongod), splitting the write
// into _id ranges would multiply the partial-failure states rather than reduce them; one
// server-side op per collection is the most atomic shape actually on offer.
//
// The crew job (services/memberships/setCoordinator.js) passes:
//   beforeWrite — renews its hold before EACH write, and throws when the hold was lost, so a run that
//                 stalled past its hold never writes over a later change;
//   maxTimeMS   — so mongod abandons a write the server has given up on (it keeps executing an
//                 updateMany after a client socket timeout). A write cut off this way has moved some
//                 rows and reports none; the job's planned counts and Finish it cover that.
export const restampLedgerCoordinator = async ({
  organizationId,
  userId,
  campaignId,
  coordinatorId,
  beforeWrite = null,
  maxTimeMS = undefined,
}) => {
  const next = coordinatorId ? new mongoose.Types.ObjectId(String(coordinatorId)) : null;
  const activityFilter = restampFilter({ organizationId, userId, campaignId, coordinatorId, bulkAware: true });
  const surveyFilter = restampFilter({ organizationId, userId, campaignId, coordinatorId });
  const options = (hint) => ({ hint, ...(maxTimeMS ? { maxTimeMS } : {}) });

  if (beforeWrite) await beforeWrite();
  const act = await CanvassActivity.updateMany(activityFilter, { $set: { coordinatorId: next } }, options(PERSON_ACTIVITY_HINT));
  if (beforeWrite) await beforeWrite();
  const srv = await SurveyResponse.updateMany(surveyFilter, { $set: { coordinatorId: next } }, options(PERSON_SURVEY_HINT));

  const activities = act.modifiedCount || 0;
  const surveys = srv.modifiedCount || 0;
  if (activities + surveys > RESTAMP_WARN_ROWS) {
    console.warn(
      `[restampCoordinator] large re-stamp: org=${organizationId} user=${userId} ` +
        `activities=${activities} surveys=${surveys}`
    );
  }
  return { activities, surveys };
};

// Group rows by the team they are stamped with, on BOTH ledgers and every kind of row (knocks,
// surveys, notes, restricted marks). Each team carries its rows on each ledger, its doors (knocks,
// deduplicated to (household, pass) within the team — the number a person sees) and its latest row,
// newest team first. One shape for a person (planSources, historyByTeam), keyed by person for the bulk
// preview (bulkPlan), and keyed by campaign for one person's history on every campaign at once
// (historiesByCampaign).
const activityGroupStages = (byUser, byCampaign = false) => [
  {
    $group: {
      _id: {
        ...(byUser ? { u: '$userId' } : {}),
        ...(byCampaign ? { c: '$campaignId' } : {}),
        from: { $ifNull: ['$coordinatorId', null] },
        door: { $cond: [{ $in: ['$actionType', KNOCK_ACTIONS] }, { h: '$householdId', p: '$passId' }, null] },
      },
      rows: { $sum: 1 },
      latest: { $max: '$timestamp' },
    },
  },
  {
    $group: {
      _id: { ...(byUser ? { u: '$_id.u' } : {}), ...(byCampaign ? { c: '$_id.c' } : {}), from: '$_id.from' },
      activities: { $sum: '$rows' },
      doors: { $sum: { $cond: [{ $eq: ['$_id.door', null] }, 0, 1] } },
      latest: { $max: '$latest' },
    },
  },
];
const surveyGroupStage = (byUser, byCampaign = false) => ({
  $group: {
    _id: {
      ...(byUser ? { u: '$userId' } : {}),
      ...(byCampaign ? { c: '$campaignId' } : {}),
      from: { $ifNull: ['$coordinatorId', null] },
    },
    surveys: { $sum: 1 },
    latest: { $max: '$submittedAt' },
  },
});

const idKey = (id) => (id ? String(id) : 'none');
const mergeTeams = (acts, srvs) => {
  const by = new Map();
  for (const a of acts) {
    by.set(idKey(a._id.from), { coordinatorId: a._id.from ?? null, activities: a.activities, surveys: 0, doors: a.doors, latest: a.latest || null });
  }
  for (const s of srvs) {
    const cur = by.get(idKey(s._id.from)) || { coordinatorId: s._id.from ?? null, activities: 0, surveys: 0, doors: 0, latest: null };
    cur.surveys += s.surveys;
    if (!cur.latest || (s.latest && new Date(s.latest) > new Date(cur.latest))) cur.latest = s.latest;
    by.set(idKey(s._id.from), cur);
  }
  return [...by.values()].sort((a, b) => new Date(b.latest || 0) - new Date(a.latest || 0));
};

// What WOULD move for one person, by the team it is stamped with: the crew job's `sources`. Uses the
// write's own filters, so a team listed here is a team the write takes rows from.
export const planSources = async ({ organizationId, userId, campaignId, coordinatorId }) => {
  const activityFilter = restampFilter({ organizationId, userId, campaignId, coordinatorId, bulkAware: true });
  const surveyFilter = restampFilter({ organizationId, userId, campaignId, coordinatorId });
  const [acts, srvs] = await Promise.all([
    CanvassActivity.aggregate([{ $match: activityFilter }, ...activityGroupStages(false)]).hint(PERSON_ACTIVITY_HINT),
    SurveyResponse.aggregate([{ $match: surveyFilter }, surveyGroupStage(false)]).hint(PERSON_SURVEY_HINT),
  ]);
  return mergeTeams(acts, srvs);
};

// Everything a person has on each of these campaigns, by the team it counts for today — the add steps'
// "Pat has 120 doors here from before: 100 on Dana's team, 20 on No team". Desk marks excluded, as
// everywhere a person's doors are counted. `doors` is the person's own total on that campaign,
// deduplicated across teams: a door re-knocked in the same round after a crew change counts once for
// them, though it counts in each of the two teams' lines.
//
// ONE pass per ledger for every campaign asked about, grouped by campaign: the person index can narrow
// only by person, so a pass per campaign read their whole history once per campaign (the org view's add
// asks about every active campaign at once). Returns Map campaignId → { teams, doors }, one entry per
// campaign asked about, empty where they have nothing.
export const historiesByCampaign = async ({ organizationId, userId, campaignIds }) => {
  const ids = (campaignIds || []).map((c) => new mongoose.Types.ObjectId(String(c)));
  const out = new Map(ids.map((id) => [String(id), { teams: [], doors: 0 }]));
  if (!ids.length) return out;
  const match = {
    organizationId: new mongoose.Types.ObjectId(String(organizationId)),
    campaignId: { $in: ids },
    userId: new mongoose.Types.ObjectId(String(userId)),
  };
  const [acts, srvs, doorAgg] = await Promise.all([
    CanvassActivity.aggregate([{ $match: { ...match, ...NOT_BULK } }, ...activityGroupStages(false, true)]).hint(PERSON_ACTIVITY_HINT),
    SurveyResponse.aggregate([{ $match: match }, surveyGroupStage(false, true)]).hint(PERSON_SURVEY_HINT),
    CanvassActivity.aggregate(knocksPipeline({ ...match, ...NOT_BULK }, { byCampaign: true })).hint(PERSON_ACTIVITY_HINT),
  ]);
  const byCampaign = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = String(r._id.c);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  };
  const actsBy = byCampaign(acts);
  const srvsBy = byCampaign(srvs);
  for (const id of out.keys()) out.set(id, { teams: mergeTeams(actsBy.get(id) || [], srvsBy.get(id) || []), doors: 0 });
  for (const d of doorAgg) if (out.has(String(d._id))) out.get(String(d._id)).doors = d.knocks || 0;
  return out;
};

// One campaign's history: the same passes, asked about one campaign, so every screen gives a campaign
// the same numbers.
export const historyByTeam = async ({ organizationId, userId, campaignId }) => {
  const id = new mongoose.Types.ObjectId(String(campaignId));
  return (await historiesByCampaign({ organizationId, userId, campaignIds: [id] })).get(String(id));
};

// The bulk preview (Move to crew…, up to 500 people): per person, what would move, by source team, on
// both ledgers, plus the exact deduplicated door total over every mover — one knocksPipeline, so a
// house two movers both knocked counts once. A person's own `doors` is deduplicated the same way, per
// person, so it matches their one-person preview (a door they knocked under two teams counts once).
// Hinted to the CAMPAIGN index (see INDEX HINTS above).
export const bulkPlan = async ({ organizationId, campaignId, userIds, coordinatorId }) => {
  const ids = userIds.map((u) => new mongoose.Types.ObjectId(String(u)));
  if (!ids.length) return { byUser: new Map(), totalDoors: 0 };
  // restampFilter needs one person; widen it to the set.
  const activityMatch = { ...restampFilter({ organizationId, userId: ids[0], campaignId, coordinatorId, bulkAware: true }), userId: { $in: ids } };
  const surveyMatch = { ...restampFilter({ organizationId, userId: ids[0], campaignId, coordinatorId }), userId: { $in: ids } };
  const [acts, srvs, total, perPerson] = await Promise.all([
    CanvassActivity.aggregate([{ $match: activityMatch }, ...activityGroupStages(true)]).hint(CAMPAIGN_ACTIVITY_HINT),
    SurveyResponse.aggregate([{ $match: surveyMatch }, surveyGroupStage(true)]).hint(CAMPAIGN_SURVEY_HINT),
    CanvassActivity.aggregate(knocksPipeline(activityMatch)).hint(CAMPAIGN_ACTIVITY_HINT),
    CanvassActivity.aggregate([
      { $match: { ...activityMatch, actionType: { $in: KNOCK_ACTIONS } } },
      { $group: { _id: { u: '$userId', h: '$householdId', p: '$passId' } } },
      { $group: { _id: '$_id.u', doors: { $sum: 1 } } },
    ]).hint(CAMPAIGN_ACTIVITY_HINT),
  ]);
  const doorsOf = new Map(perPerson.map((r) => [String(r._id), r.doors]));
  const actsBy = new Map();
  const srvsBy = new Map();
  for (const a of acts) {
    const k = String(a._id.u);
    if (!actsBy.has(k)) actsBy.set(k, []);
    actsBy.get(k).push(a);
  }
  for (const r of srvs) {
    const k = String(r._id.u);
    if (!srvsBy.has(k)) srvsBy.set(k, []);
    srvsBy.get(k).push(r);
  }
  const byUser = new Map();
  for (const id of ids.map(String)) {
    const sources = mergeTeams(actsBy.get(id) || [], srvsBy.get(id) || []);
    byUser.set(id, {
      sources,
      activities: sources.reduce((n, x) => n + x.activities, 0),
      surveys: sources.reduce((n, x) => n + x.surveys, 0),
      doors: doorsOf.get(id) || 0,
    });
  }
  return { byUser, totalDoors: total[0]?.knocks || 0 };
};
