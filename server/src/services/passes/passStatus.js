import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
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

// Group an explicit door→pass map by pass. Shared by the per-round wire helpers below.
function groupDoorPass(doorPass) {
  const byPass = new Map();
  if (!doorPass || !doorPass.size) return byPass;
  for (const [hid, pid] of doorPass) {
    if (!pid) continue;
    let arr = byPass.get(pid);
    if (!arr) { arr = []; byPass.set(pid, arr); }
    arr.push(hid);
  }
  return byPass;
}

// Per-round door STATE from an EXPLICIT door→pass map (e.g. the canvasser's assigned
// book's round) — status AND last visit, both scoped to the door's round, correct even
// when Household.turfId points at a freshly-cut future round. A door with no activity
// in its round reads { status: 'unknocked', lastActionAt: null } — the round-fresh
// presentation. Doors absent from the map get nothing (callers keep the global value).
export async function doorStateFromDoorPass(doorPass, campaignType) {
  const out = new Map();
  for (const [pid, hids] of groupDoorPass(doorPass)) {
    const m = await getPassStatusMap(pid, hids, campaignType);
    for (const hid of hids) {
      const e = m.get(hid);
      out.set(hid, { status: e?.status || 'unknocked', lastActionAt: e?.lastActionAt || null });
    }
  }
  return out;
}

// Status-only view of doorStateFromDoorPass — Map<doorIdStr, status>. Kept for
// callers that only color doors (e.g. /mobile/me/today's "Remaining").
export async function statusesFromDoorPass(doorPass, campaignType) {
  const state = await doorStateFromDoorPass(doorPass, campaignType);
  const out = new Map();
  for (const [hid, s] of state) out.set(hid, s.status);
  return out;
}

// The VOTER-level analog of doorStateFromDoorPass: which voters have a SurveyResponse
// in THE ROUND their door's assigned book belongs to. Returns Set<voterIdStr>. This is
// what makes the phone's per-voter "Surveyed" badge per-round — the stored
// Voter.surveyStatus stays the campaign-global "ever surveyed" for admin/reports,
// exactly as Household.status stays global while the wire status is per-round.
// Rides the { householdId, passId } index ("per-pass survey existence").
// Returns Map<voterIdStr, surveyorUserIdStr> — the id so the wire can also stamp
// `surveyedByMe` (the door's smart re-survey confirm). `.has()` keeps working for the
// membership checks; each voter appears at most once (one household → one pass in
// doorPass, and {voterId, passId} is unique).
export async function surveyedVotersFromDoorPass(doorPass) {
  const out = new Map();
  for (const [pid, hids] of groupDoorPass(doorPass)) {
    const rows = await SurveyResponse.find(
      { householdId: { $in: hids.map(oid) }, passId: oid(pid) },
      { voterId: 1, userId: 1 }
    ).lean();
    for (const r of rows) out.set(String(r.voterId), String(r.userId));
  }
  return out;
}

export function statusCountsFromMap(map, householdIds) {
  const counts = { unknocked: 0, not_home: 0, wrong_address: 0, refused: 0, lit_dropped: 0, surveyed: 0, restricted: 0, no_soliciting: 0 };
  for (const id of householdIds) {
    const s = map.get(String(id))?.status || 'unknocked';
    counts[s] = (counts[s] || 0) + 1;
  }
  return counts;
}
