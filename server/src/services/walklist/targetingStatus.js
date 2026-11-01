import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import {
  STATUS_ROW_MATCH,
  ANSWERED_ACTIONS,
  completionFor,
  resolveTargetingStatusFromSummary,
} from '../../utils/statusPrecedence.js';
import { NOT_DESK_MARK } from '../reports/aggregations.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

// Rows are fetched by door id in chunks, so the query document stays bounded and the cost is
// proportional to the ASKED doors' rows — never a whole-campaign scan (which, past a few hundred
// thousand rows, is seconds and hundreds of megabytes per request). Callers that only need the
// restricted / no-soliciting doors bound their ask first (generateTurf.js offLimitsDoorIds).
const CHUNK = 10000;

// The index the per-door match must ride. Left to itself the planner has been seen to pick a
// single-field actionType index for `{ campaignId, householdId: $in, actionType: $ne }` and walk
// 580k keys per chunk instead of 30k (round-2 review, 2026-10-14). This index has existed since
// the first turf-cutting release (2026-05), so every environment has it; should it ever be
// missing, the planner's complaint is caught and the aggregate re-runs unhinted rather than
// failing every status tick.
const HINT = { householdId: 1, timestamp: -1 };

// One $group per door: the action set, the newest row, and the newest ANSWERED row. No $sort: the
// newest row is a $max over { ts, actionType } documents — BSON compares the fields in order, so
// the timestamp decides and the action breaks a tie deterministically. $max skips the nulls the
// $cond emits for rows that are not answered outcomes, so `latestAnswered` is null only when
// nobody ever answered at the door, and the ladder never reads it in that case.
const groupStage = () => {
  const row = { ts: '$timestamp', actionType: '$actionType' };
  return {
    $group: {
      _id: '$householdId',
      actions: { $addToSet: '$actionType' },
      latest: { $max: row },
      latestAnswered: { $max: { $cond: [{ $in: ['$actionType', [...ANSWERED_ACTIONS]] }, row, null] } },
    },
  };
};

const aggregateHinted = async (pipeline) => {
  try {
    return await CanvassActivity.aggregate(pipeline).hint(HINT).allowDiskUse(true);
  } catch (err) {
    if (!/hint/i.test(err?.message || '')) throw err;
    return CanvassActivity.aggregate(pipeline).allowDiskUse(true);
  }
};

const runChunks = async (campaignId, ids, stages) => {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK).map(oid);
    out.push(
      ...(await aggregateHinted([
        { $match: { campaignId: oid(campaignId), householdId: { $in: part }, ...STATUS_ROW_MATCH } },
        groupStage(),
        ...stages,
      ]))
    );
  }
  return out;
};

// All-rounds TARGETING status per door → Map<idStr, { status, lastActionAt }>. A door with no
// rows is absent (callers read 'unknocked'). The ladder is resolveTargetingStatusFromSummary
// (utils/statusPrecedence.js). For the Turf Cutting page (what it draws and explains while
// Target doors is open) and the house pop-up — the surfaces that need every door's status and
// its newest visit. A STATUS TICK does not: it asks targetingIdsMatching below.
export async function getTargetingStatusMap(campaignId, householdIds, campaignType) {
  const map = new Map();
  const ids = [...new Set((householdIds || []).map(String))];
  if (!campaignId || !ids.length) return map;
  for (const a of await runChunks(campaignId, ids, [])) {
    map.set(String(a._id), {
      status: resolveTargetingStatusFromSummary(campaignType, {
        actions: a.actions,
        latestActionType: a.latest?.actionType,
        latestAnsweredActionType: a.latest && a.latestAnswered ? a.latestAnswered.actionType : undefined,
      }),
      lastActionAt: a.latest?.ts || null,
    });
  }
  return map;
}

// The SAME ladder, folded into the pipeline: rung by rung over the $group above, exactly as
// resolveTargetingStatus reads it in JS. test 8 in turfTargeting.int.test.js pins that the two
// agree door for door.
const ladderExpr = (campaignType) => {
  const { action, status } = completionFor(campaignType);
  // survey_submitted is the one action whose status is spelled differently (ACTION_TO_STATUS).
  const statusOf = (expr) => ({ $cond: [{ $eq: [expr, 'survey_submitted'] }, 'surveyed', expr] });
  return {
    $switch: {
      branches: [
        { case: { $in: ['restricted', '$actions'] }, then: 'restricted' },
        { case: { $in: [action, '$actions'] }, then: status },
        { case: { $gt: [{ $size: { $setIntersection: ['$actions', [...ANSWERED_ACTIONS]] } }, 0] }, then: '$latestAnswered.actionType' },
        { case: { $in: ['not_home', '$actions'] }, then: 'not_home' },
      ],
      default: statusOf('$latest.actionType'),
    },
  };
};

// WHICH of the asked doors read one of `statuses` → Set<idStr>. What a status tick on Target /
// Exclude doors or the saved-search builder needs, and nothing more: the ladder runs in the
// database and only ids come back, so a 250k-door resolve ships neither action sets nor
// timestamps (measured at 25k doors: a third less time and a fifth of the heap of the full map).
// 'unknocked' is the complement — the asked doors with no rows at all — so when it is wanted the
// pipeline returns every door with rows and the complement is taken here.
export async function targetingIdsMatching(campaignId, householdIds, campaignType, statuses) {
  const out = new Set();
  const ids = [...new Set((householdIds || []).map(String))];
  const wanted = new Set(statuses || []);
  if (!campaignId || !ids.length || !wanted.size) return out;
  const stages = [{ $project: { status: ladderExpr(campaignType) } }];
  const withRows = wanted.has('unknocked') ? new Set() : null;
  if (!withRows) stages.push({ $match: { status: { $in: [...wanted] } } });
  for (const a of await runChunks(campaignId, ids, stages)) {
    const id = String(a._id);
    if (withRows) withRows.add(id);
    if (wanted.has(a.status)) out.add(id);
  }
  if (withRows) for (const id of ids) if (!withRows.has(id)) out.add(id);
  return out;
}

// A canvasser at the door: any result recorded in the field — every status row except a desk mark (an
// admin's Mark restricted, which nobody walked to). What "Visited in the last N days" counts
// (docs/PROPOSAL_RECENT_VISITS.md). NOT_DESK_MARK owns a `$nor`; nothing else here does.
export const VISIT_ROW_MATCH = Object.freeze({ ...STATUS_ROW_MATCH, ...NOT_DESK_MARK });

// WHICH of the asked doors have a field visit at or after `since` → Set<idStr>. Chunked and hinted like
// the ladder above: both index keys are bounded (the door ids, then the time), so the cost follows the
// rows inside the window, never the campaign's ledger. `since` must be a Date — pipelines are not cast,
// and a string would silently match nothing.
export const visitedIdsSince = async (campaignId, householdIds, since) => {
  const out = new Set();
  const ids = [...new Set((householdIds || []).map(String))];
  if (!campaignId || !ids.length || !(since instanceof Date)) return out;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK).map(oid);
    const rows = await aggregateHinted([
      { $match: { campaignId: oid(campaignId), householdId: { $in: part }, timestamp: { $gte: since }, ...VISIT_ROW_MATCH } },
      { $group: { _id: '$householdId' } },
    ]);
    for (const r of rows) out.add(String(r._id));
  }
  return out;
};

// One door's newest field visit, for the house pop-up while the line is ticked. Deliberately unhinted:
// for a single door the planner takes { householdId, timestamp } on its own, and a hint naming an index
// the database lacks fails the query outright (scripts/testIndexPreload.mjs builds only the indexes
// hinted without a fallback, and this one is not among them).
export const lastVisitAt = async (campaignId, householdId) => {
  const row = await CanvassActivity.findOne(
    { campaignId: oid(campaignId), householdId: oid(householdId), ...VISIT_ROW_MATCH },
    { timestamp: 1 }
  )
    .sort({ timestamp: -1 })
    .lean();
  return row?.timestamp || null;
};
