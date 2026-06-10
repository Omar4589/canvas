import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Turf } from '../../models/Turf.js';
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

// Per-ROUND status for a set of household docs ({ _id, turfId }): each door's
// status IN ITS BOOK'S ROUND (door → turfId → Turf.passId → getPassStatusMap),
// so a door re-targeted in a NEW round reads as fresh/unknocked to the canvasser
// even if it was surveyed/not-home in a prior round. Returns Map<id, status>;
// doors not in a book are absent (caller keeps their global status). Used by the
// mobile bootstrap, /changes, and the "remaining" count.
export async function resolvePerRoundStatuses(households, campaignType) {
  const out = new Map();
  const turfIds = [...new Set(households.map((h) => h.turfId).filter(Boolean).map(String))];
  if (!turfIds.length) return out;
  const turfPass = new Map(
    (await Turf.find({ _id: { $in: turfIds } }, { passId: 1 }).lean()).map((t) => [
      String(t._id),
      t.passId ? String(t.passId) : null,
    ])
  );
  const byPass = new Map();
  for (const h of households) {
    const pid = h.turfId ? turfPass.get(String(h.turfId)) : null;
    if (!pid) continue;
    let arr = byPass.get(pid);
    if (!arr) { arr = []; byPass.set(pid, arr); }
    arr.push(String(h._id));
  }
  for (const [pid, hids] of byPass) {
    const m = await getPassStatusMap(pid, hids, campaignType);
    for (const hid of hids) out.set(hid, m.get(hid)?.status || 'unknocked');
  }
  return out;
}

export function statusCountsFromMap(map, householdIds) {
  const counts = { unknocked: 0, not_home: 0, wrong_address: 0, lit_dropped: 0, surveyed: 0 };
  for (const id of householdIds) {
    const s = map.get(String(id))?.status || 'unknocked';
    counts[s] = (counts[s] || 0) + 1;
  }
  return counts;
}
