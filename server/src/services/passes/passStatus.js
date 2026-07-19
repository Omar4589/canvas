import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { ACTION_TO_STATUS } from '../../utils/statusPrecedence.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

// Per-pass door status, DERIVED (never stored). For each household: the sticky
// completion (surveyed / lit_dropped) if it happened this pass, else the latest
// action this pass; absent => unknocked. Used by pass progress, the segment
// builder, and (later) the mobile map. Distinct from Household.status, which is
// the global "latest across all passes".
export async function getPassStatusMap(passId, householdIds, campaignType) {
  const map = new Map();
  if (!passId || !householdIds?.length) return map;
  const ids = householdIds.map(oid);
  const agg = await CanvassActivity.aggregate([
    { $match: { passId: oid(passId), householdId: { $in: ids }, actionType: { $ne: 'note_added' } } },
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: '$householdId',
        actions: { $addToSet: '$actionType' },
        latestActionType: { $first: '$actionType' },
        latestTimestamp: { $first: '$timestamp' },
      },
    },
  ]);
  const completion = campaignType === 'lit_drop' ? 'lit_dropped' : 'survey_submitted';
  const completionStatus = campaignType === 'lit_drop' ? 'lit_dropped' : 'surveyed';
  for (const a of agg) {
    const status = a.actions.includes(completion)
      ? completionStatus
      : ACTION_TO_STATUS[a.latestActionType] || 'unknocked';
    map.set(String(a._id), { status, lastActionAt: a.latestTimestamp });
  }
  return map;
}

// One canvasser's OWN door status — the same completion-sticky rule as getPassStatusMap,
// but resolved from ONLY that user's activities (optionally within one pass). Powers the
// admin map when it is filtered to a single canvasser: a door that person surveyed reads
// 'surveyed', one they only not-home'd reads 'not_home' — even if someone else surveyed it.
// (Their survey writes a survey_submitted activity under their own userId, so filtering
// CanvassActivity by userId captures it.)
export async function getUserStatusMap(userId, householdIds, campaignType, passId = null) {
  const map = new Map();
  if (!userId || !householdIds?.length) return map;
  const match = { userId: oid(userId), householdId: { $in: householdIds.map(oid) }, actionType: { $ne: 'note_added' } };
  if (passId) match.passId = oid(passId);
  const agg = await CanvassActivity.aggregate([
    { $match: match },
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: '$householdId',
        actions: { $addToSet: '$actionType' },
        latestActionType: { $first: '$actionType' },
        latestTimestamp: { $first: '$timestamp' },
      },
    },
  ]);
  const completion = campaignType === 'lit_drop' ? 'lit_dropped' : 'survey_submitted';
  const completionStatus = campaignType === 'lit_drop' ? 'lit_dropped' : 'surveyed';
  for (const a of agg) {
    const status = a.actions.includes(completion)
      ? completionStatus
      : ACTION_TO_STATUS[a.latestActionType] || 'unknocked';
    map.set(String(a._id), { status, lastActionAt: a.latestTimestamp });
  }
  return map;
}

// Per-round status from an EXPLICIT door→pass map (e.g. the canvasser's assigned
// book's round) — correct even when Household.turfId points at a freshly-cut future
// round. Returns Map<doorIdStr, status>; doors absent from the map get nothing.
export async function statusesFromDoorPass(doorPass, campaignType) {
  const out = new Map();
  if (!doorPass || !doorPass.size) return out;
  const byPass = new Map();
  for (const [hid, pid] of doorPass) {
    if (!pid) continue;
    let arr = byPass.get(pid);
    if (!arr) { arr = []; byPass.set(pid, arr); }
    arr.push(hid);
  }
  for (const [pid, hids] of byPass) {
    const m = await getPassStatusMap(pid, hids, campaignType);
    for (const hid of hids) out.set(hid, m.get(hid)?.status || 'unknocked');
  }
  return out;
}

export function statusCountsFromMap(map, householdIds) {
  const counts = { unknocked: 0, not_home: 0, wrong_address: 0, refused: 0, lit_dropped: 0, surveyed: 0, restricted: 0 };
  for (const id of householdIds) {
    const s = map.get(String(id))?.status || 'unknocked';
    counts[s] = (counts[s] || 0) + 1;
  }
  return counts;
}
