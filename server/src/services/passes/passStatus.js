import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { ACTION_TO_STATUS } from '../../utils/statusPrecedence.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

// The completion pair for a campaign type — the action that is STICKY within a round, and the
// status it resolves to. Shared by every resolver below so the ladder is stated once.
const completionOf = (campaignType) =>
  campaignType === 'lit_drop'
    ? { action: 'lit_dropped', status: 'lit_dropped' }
    : { action: 'survey_submitted', status: 'surveyed' };

// WHO put the door in its current state, when that state is `restricted`: 'desk' for an admin's
// desk mark (via:'bulk' — services/canvass/deskRestrict.js, a whole book or a single home),
// 'field' for a canvasser's own Restricted access at the door, null for every other status.
// Derived from the SAME newest row the status came from, so the two can never disagree.
//
// This is what lets the canvasser's phone tell the office's prediction ("we think this block is
// gated") from a colleague's observation ("I stood at this gate"). It is deliberately NOT a
// permission: the door stays knockable and every outcome button stays enabled — a canvasser who
// gets in is producing better evidence than the mark, and the field row supersedes it by design
// (bulkRestrict.int.test.js 'field re-disposition overrides a bulk mark').
const restrictedFromOf = (status, latestVia) =>
  status === 'restricted' ? (latestVia === 'bulk' ? 'desk' : 'field') : null;

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
        // Free: the $sort is already paid for, and this reads the SAME newest document
        // latestActionType does. Powers `restrictedFrom` — see restrictedFromOf above.
        latestVia: { $first: '$via' },
      },
    },
  ]);
  const completion = completionOf(campaignType);
  for (const a of agg) {
    const status = a.actions.includes(completion.action)
      ? completion.status
      : ACTION_TO_STATUS[a.latestActionType] || 'unknocked';
    map.set(String(a._id), {
      status,
      lastActionAt: a.latestTimestamp,
      restrictedFrom: restrictedFromOf(status, a.latestVia),
    });
  }
  return map;
}

// getPassStatusMap over SEVERAL rounds at once → Map<"passId|householdId", { status, lastActionAt,
// restrictedFrom }>. Same aggregate, same completion-sticky ladder, grouped by the (pass, door)
// PAIR instead of the door — because a door can sit in more than one round at once and each round
// answers for itself.
//
// It exists for one job: deciding whether a desk mark is still LIVE. `deskMarkCountsForPasses`
// counts rows on disk, which is what the undo deletes; this says whether each of those rounds
// still READS restricted. The gap between the two is a superseded mark — a desk row a canvasser's
// later field row out-voted — and reporting them as one number is what made the book chip
// disagree with its own status chips.
//
// Keys are pipe-separated, matching deskMarkCountsForPasses exactly. Deliberately NOT the `\0`
// composite convention used in services/person and services/dnc: those keys join two ids where
// either could contain the separator, and the NUL bytes blind plain grep (see CLAUDE.md). Here
// both halves are ObjectIds, which cannot contain a pipe.
export async function getPassStatusMapMulti(passIds, householdIds, campaignType) {
  const map = new Map();
  if (!passIds?.length || !householdIds?.length) return map;
  const agg = await CanvassActivity.aggregate([
    {
      $match: {
        passId: { $in: passIds.map(oid) },
        householdId: { $in: householdIds.map(oid) },
        actionType: { $ne: 'note_added' },
      },
    },
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: { passId: '$passId', householdId: '$householdId' },
        actions: { $addToSet: '$actionType' },
        latestActionType: { $first: '$actionType' },
        latestTimestamp: { $first: '$timestamp' },
        latestVia: { $first: '$via' },
      },
    },
  ]);
  const completion = completionOf(campaignType);
  for (const a of agg) {
    const status = a.actions.includes(completion.action)
      ? completion.status
      : ACTION_TO_STATUS[a.latestActionType] || 'unknocked';
    map.set(`${a._id.passId}|${a._id.householdId}`, {
      status,
      lastActionAt: a.latestTimestamp,
      restrictedFrom: restrictedFromOf(status, a.latestVia),
    });
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
        latestVia: { $first: '$via' },
      },
    },
  ]);
  const completion = completionOf(campaignType);
  for (const a of agg) {
    const status = a.actions.includes(completion.action)
      ? completion.status
      : ACTION_TO_STATUS[a.latestActionType] || 'unknocked';
    // Same shape as getPassStatusMap so a caller can swap resolvers without re-shaping. A desk
    // row is authored by the ADMIN, so it never appears in one canvasser's own rows — a
    // restricted door here is always 'field', which is exactly the truth this view reports.
    map.set(String(a._id), {
      status,
      lastActionAt: a.latestTimestamp,
      restrictedFrom: restrictedFromOf(status, a.latestVia),
    });
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
      // This REBUILDS the entry field by field rather than spreading it, so anything added to
      // getPassStatusMap's shape must be named here too or it is silently dropped on the way to
      // every per-round wire (bootstrap, /changes, me.js, the action responses).
      out.set(hid, {
        status: e?.status || 'unknocked',
        lastActionAt: e?.lastActionAt || null,
        restrictedFrom: e?.restrictedFrom || null,
      });
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

// The zero-filled 8-key shape every per-status tally starts from — one literal, so a new
// status lands in every consumer (pass progress, the map's /map/counts facet) at once.
export function emptyStatusCounts() {
  return { unknocked: 0, not_home: 0, wrong_address: 0, refused: 0, lit_dropped: 0, surveyed: 0, restricted: 0, no_soliciting: 0 };
}

export function statusCountsFromMap(map, householdIds) {
  const counts = emptyStatusCounts();
  for (const id of householdIds) {
    const s = map.get(String(id))?.status || 'unknocked';
    counts[s] = (counts[s] || 0) + 1;
  }
  return counts;
}
