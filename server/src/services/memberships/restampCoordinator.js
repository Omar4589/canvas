import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { User } from '../../models/User.js';
import { NOT_BULK, knocksPipeline } from '../reports/aggregations.js';

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
// coordinator leaves the org, services/users/deleteAccount.js clears their crew's
// Membership.coordinatorId but deliberately leaves the ledger alone, so the departed coordinator's
// team keeps the doors it supervised. That is the 104-door fix; do not "unify" the two paths.
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
    CanvassActivity.countDocuments(activityFilter),
    SurveyResponse.countDocuments(surveyFilter),
    CanvassActivity.aggregate(knocksPipeline(activityFilter)),
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
export const restampLedgerCoordinator = async ({ organizationId, userId, campaignId, coordinatorId }) => {
  const next = coordinatorId ? new mongoose.Types.ObjectId(String(coordinatorId)) : null;
  const activityFilter = restampFilter({ organizationId, userId, campaignId, coordinatorId, bulkAware: true });
  const surveyFilter = restampFilter({ organizationId, userId, campaignId, coordinatorId });

  const act = await CanvassActivity.updateMany(activityFilter, { $set: { coordinatorId: next } });
  const srv = await SurveyResponse.updateMany(surveyFilter, { $set: { coordinatorId: next } });

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
