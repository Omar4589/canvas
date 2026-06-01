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

export function statusCountsFromMap(map, householdIds) {
  const counts = { unknocked: 0, not_home: 0, wrong_address: 0, lit_dropped: 0, surveyed: 0 };
  for (const id of householdIds) {
    const s = map.get(String(id))?.status || 'unknocked';
    counts[s] = (counts[s] || 0) + 1;
  }
  return counts;
}
