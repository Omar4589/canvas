import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Household } from '../../models/Household.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { KNOCKABLE_DOOR_FILTER } from './knockableDoorFilter.js';
import { getPassStatusMap, getPassStatusMapMulti } from '../passes/passStatus.js';
import { activePassIdForEffort } from '../passes/activePasses.js';
import { recomputeHouseholdStatusesBatched } from './status.js';
import { recomputeCampaignStats } from '../reports/campaignCounters.js';

// THE ONE desk-mark writer. "Desk mark" = an admin marking doors Restricted Access from the
// console — a whole book (routes/admin/turfs.js restrict-bulk) or a single home (restrict-doors)
// — as REAL `restricted` CanvassActivity rows tagged via:'bulk'. Real rows keep the per-round
// view right (canvassers see slate doors, not fresh ones); the via tag keeps them OUT of the GPS
// audit, billing's first-field-visit clock, and every per-canvasser surface (NOT_BULK in
// reports/aggregations.js). Roughly fifty code sites in ~20 server files key off via:'bulk' and
// eleven int-test files pin it; a single-home mark that writes the SAME row class inherits every
// one of those promises for free, which is why there is no second `via` value and no second
// writer. Field rows are never deleted — latest-wins status recompute flips the door, and a
// later field re-disposition flips it right back. docs/PASSES_AND_TURF.md, docs/BILLING.md.
//
// Every desk row carries a NON-NULL passId: getPassStatusMap matches passId exactly, so a
// null-pass row would flip the global status but be invisible on every phone. The builder throws
// rather than write one. Pinned to actionType 'restricted' ONLY — a via:'bulk' row on a KNOCK
// action is contractually billable (knocksByPass.int.test.js), so this module refuses to build or
// delete anything else.
//
// Counts are ROWS everywhere (one aggregate `$sum:1`, `countDocuments`, `deletedCount`): two desk
// rows on one (pass, door) are reachable (mark → field knock → mark again; two admins racing; no
// unique index) and row-denominated counts tolerate it, so the web toast, the mobile Alerts and
// the "N marks will be removed" prompts all reconcile. The book-level count/undo is keyed by
// (passId, the book's CURRENT householdIds) — never the stamped turfId, which is provenance only
// (the door's book in that pass at write time; null for a loose door; a draft book's id dies on
// re-cut/discard while the mark lives on and counts under the door's next book).
//
// SUPERSEDED marks (2026-08-24). Because a field row out-votes a desk mark without deleting it,
// the rows on disk and the doors that still READ restricted come apart. That gap is reported as
// its own number (`deskMarkStateForPasses` → `countDeskMarksByBook`'s `superseded`), never by
// re-defining the row count: the row count is what the undo deletes, so the confirm's "N marks
// will be removed" must keep equalling the toast's `deletedCount`. A superseded mark is still a
// real mark — it stays deletable from every surface, and letting one become unreachable was the
// bug this split was written to close.

export const DESK_RESTRICT_MATCH = Object.freeze({ actionType: 'restricted', via: 'bulk' });

const oid = (v) => new mongoose.Types.ObjectId(String(v));

// Refuse a caller that tries to widen the match past restricted/bulk — spreading
// DESK_RESTRICT_MATCH last would silently win, so surface the mistake instead.
const assertDeskOnly = (filter = {}) => {
  for (const k of Object.keys(DESK_RESTRICT_MATCH)) {
    if (k in filter && filter[k] !== DESK_RESTRICT_MATCH[k]) {
      throw new Error(`deskRestrict: only ${k}:'${DESK_RESTRICT_MATCH[k]}' rows are desk marks`);
    }
  }
};

// `reached` = doors left alone under scope 'unknocked' because the crew already reached them
// (not-home / refused / wrong-address). Always 0 under 'incomplete'.
export const emptyDeskSkips = () => ({ completed: 0, alreadyRestricted: 0, ineligible: 0, reached: 0 });

// One desk row. The house's own pin (accuracy null, distance 0) — it is not a device reading.
export const buildDeskRestrictRow = ({ hh, userId, passId, turfId = null, now, actionType = 'restricted' }) => {
  if (actionType !== DESK_RESTRICT_MATCH.actionType) {
    throw new Error(`deskRestrict: a desk mark is always '${DESK_RESTRICT_MATCH.actionType}' (got '${actionType}')`);
  }
  if (!passId) throw new Error('deskRestrict: a desk mark must carry a passId (a null-pass row is invisible per-round)');
  const [lng, lat] = hh.location.coordinates;
  return {
    organizationId: hh.organizationId,
    campaignId: hh.campaignId,
    householdId: hh._id,
    voterId: null,
    userId,
    actionType: DESK_RESTRICT_MATCH.actionType,
    via: DESK_RESTRICT_MATCH.via,
    note: null,
    location: { lat, lng, accuracy: null }, // the house's own pin
    distanceFromHouseMeters: 0,
    timestamp: now,
    wasOfflineSubmission: false,
    passId,
    turfId: turfId || null,
    effortId: hh.effortId || null,
    // Explicitly NO team. An admin's own coordinator is not a field-work attribution — the
    // same reason lastActionBy is deliberately left unset in commitDeskRestrict ("don't
    // attribute a whole community to the admin"). Desk rows already sit outside every
    // per-canvasser surface (NOT_BULK), and they must sit outside every per-TEAM total too.
    coordinatorId: null,
  };
};

// Plan the rows for one round: which of `householdIds` get a desk mark, which are skipped and
// why. Eligibility is the same clause as /:turfId/households (KNOCKABLE + coords, scoped to the
// campaign), so the marked set equals what the canvasser actually sees. Per-round status decides
// the ladder:
//   scope 'incomplete' (default) — every door not surveyed/lit-dropped/restricted, INCLUDING the
//     ones the crew reached (not-home / refused / wrong-address); the field row stays.
//   scope 'unknocked' — ONLY doors nobody has touched this round; every reached door keeps its
//     status and its knock (`skipped.reached`).
// `turfIdFor(hh)` supplies the provenance turfId (the book, or null for a loose door).
export const planDeskRestrict = async ({ campaign, passId, householdIds, userId, turfIdFor, scope = 'incomplete', now = new Date() }) => {
  const skipped = emptyDeskSkips();
  const rows = [];
  const touched = [];
  const ids = householdIds || [];
  const eligibleDoors = ids.length
    ? await Household.find(
        {
          _id: { $in: ids },
          campaignId: campaign._id,
          ...KNOCKABLE_DOOR_FILTER,
          'location.coordinates': { $exists: true, $ne: null },
        },
        { location: 1, effortId: 1, organizationId: 1, campaignId: 1 }
      ).lean()
    : [];
  skipped.ineligible += ids.length - eligibleDoors.length;
  const statusMap = await getPassStatusMap(passId, eligibleDoors.map((h) => h._id), campaign.type);
  for (const hh of eligibleDoors) {
    const s = statusMap.get(String(hh._id))?.status || 'unknocked';
    // scope 'unknocked': leave every door the crew reached exactly as it is (this also
    // subsumes the completed/restricted skips below, but count them there for a truthful
    // breakdown rather than lumping them into `reached`).
    if (scope === 'unknocked' && s !== 'unknocked' && s !== 'surveyed' && s !== 'lit_dropped' && s !== 'restricted') {
      skipped.reached += 1;
      continue;
    }
    if (s === 'surveyed' || s === 'lit_dropped') {
      skipped.completed += 1; // a done door keeps its result
      continue;
    }
    if (s === 'restricted') {
      skipped.alreadyRestricted += 1; // idempotent re-runs
      continue;
    }
    rows.push(buildDeskRestrictRow({ hh, userId, passId, turfId: turfIdFor ? turfIdFor(hh) : null, now }));
    touched.push(hh._id);
  }
  return { rows, touched, skipped };
};

// Write the planned rows and settle every derived value in one move. No-op on an empty plan.
export const commitDeskRestrict = async ({ campaign, rows, touched, now }) => {
  if (!rows.length) return;
  await CanvassActivity.insertMany(rows);
  // The BATCHED recompute (2 round trips per 500-door chunk), not the per-document one: a lasso
  // on the map hands this 1,000 doors in one request, and ~3 serial round trips per door would
  // sit at the edge of Heroku's 30 s router timeout. Same answer either way — resolveStatus is
  // pure and Household declares no save hooks.
  await recomputeHouseholdStatusesBatched(touched, campaign.type);
  // lastActionAt is a real field the single-door path also sets, and the touch doubles as the
  // delta-poll guarantee — the mobile poll (/changes filters updatedAt > since) must deliver
  // every touched door even when the recomputed status is unchanged (e.g. a door restricted in
  // a PRIOR pass). lastActionBy is deliberately NOT set (don't attribute a whole community to
  // the admin).
  await Household.updateMany({ _id: { $in: touched } }, { $set: { lastActionAt: now } });
  // Desk rows change activityCount (campaign tallies include them) but never the
  // knock/canvasser counters (restricted ∉ KNOCK_ACTIONS; via:'bulk' is NOT_BULK-excluded) —
  // recompute keeps every stats field exact in one move.
  await recomputeCampaignStats(campaign._id, { swallowErrors: true });
};

// Undo — removes ONLY desk rows matching `filter` (any admin's). Field-recorded restricted marks
// never match and stay reversible per-door in the field. Returns row count + distinct doors.
export const removeDeskRestrict = async ({ campaign, filter }) => {
  assertDeskOnly(filter);
  const match = { campaignId: campaign._id, ...filter, ...DESK_RESTRICT_MATCH };
  const touched = await CanvassActivity.distinct('householdId', match);
  const r = await CanvassActivity.deleteMany(match);
  if (touched.length) {
    await recomputeHouseholdStatusesBatched(touched, campaign.type);
    // Same delta guarantee in reverse, for a door whose recomputed status is unchanged (it was
    // already restricted in a PRIOR pass). Nothing "happened to" the door, so bump updatedAt
    // without touching lastActionAt.
    await Household.updateMany({ _id: { $in: touched } }, { $currentDate: { updatedAt: true } });
    // Desk ledger delete → keep Campaign.stats.activityCount exact (see commitDeskRestrict).
    await recomputeCampaignStats(campaign._id, { swallowErrors: true });
  }
  return { unmarked: r.deletedCount, households: touched.length };
};

// Which (non-archived) book holds each door in this round — Map<householdIdStr, turfId>. Rides
// the { passId, householdIds } index on Turf.
export const bookOfDoorsInPass = async ({ campaignId, passId, householdIds }) => {
  const out = new Map();
  if (!householdIds?.length) return out;
  const wanted = new Set(householdIds.map(String));
  const turfs = await Turf.find(
    { campaignId, passId, status: { $ne: 'archived' }, householdIds: { $in: householdIds } },
    { householdIds: 1 }
  ).lean();
  for (const t of turfs) {
    for (const id of t.householdIds || []) {
      const k = String(id);
      if (wanted.has(k)) out.set(k, t._id);
    }
  }
  return out;
};

// The round a desk mark lands on when the caller names none, for ONE door: the door's own
// effort's ACTIVE round (one per effort by construction) → else the effort's SINGLE non-archived
// (draft) round (several drafts per effort are legal, hence "exactly one") → else null. An
// Intake door (effortId null) can NEVER be marked: Pass.effortId is required, so no round can own
// it — short-circuited before any query. Shared by resolveDeskPassForDoors and the
// /activity `currentPassId` read so the client and the writer agree by construction.
export const currentDeskPassForDoor = async ({ campaignId, effortId }) => {
  if (!effortId) return null;
  const active = await activePassIdForEffort(effortId);
  if (active) return active;
  const open = await Pass.find({ campaignId, effortId, status: { $ne: 'archived' } }, { _id: 1 }).limit(2).lean();
  return open.length === 1 ? open[0]._id : null;
};

// Group doors by the round their desk mark belongs to.
//   explicit passId → every door lands on it. For a MARK (forMark) the pass must belong to the
//     campaign (`passProblem:'not-found'`) and not be archived (`'archived'` — phones only receive
//     active-pass books, so an archived-round mark would be invisible to canvassers yet flip
//     global status); a door whose effortId ≠ the pass's effortId is `ineligible` (Intake doors
//     included). An UNMARK applies NONE of those checks — it deletes whatever the client names
//     (the mark's own round from /activity), so a mark whose draft pass was later deleted or
//     whose door was re-housed can always be removed.
//   no passId → currentDeskPassForDoor per effort; doors with no answer come back in
//     `unresolved` as { id, reason:'intake'|'no-round' } (the route refuses all-or-nothing).
export const resolveDeskPassForDoors = async ({ campaign, households, passId = null, forMark }) => {
  const byPass = new Map();
  const unresolved = [];
  const ineligible = [];
  const add = (pid, hh) => {
    const k = String(pid);
    if (!byPass.has(k)) byPass.set(k, []);
    byPass.get(k).push(hh);
  };
  if (passId) {
    let passEffortId = null;
    if (forMark) {
      const pass = await Pass.findOne({ _id: passId, campaignId: campaign._id }, { status: 1, effortId: 1 }).lean();
      if (!pass) return { byPass, unresolved, ineligible, passProblem: 'not-found' };
      if (pass.status === 'archived') return { byPass, unresolved, ineligible, passProblem: 'archived' };
      passEffortId = String(pass.effortId);
    }
    for (const hh of households) {
      if (forMark && String(hh.effortId || '') !== passEffortId) ineligible.push(hh);
      else add(passId, hh);
    }
    return { byPass, unresolved, ineligible, passProblem: null };
  }
  const byEffort = new Map();
  for (const hh of households) {
    if (!hh.effortId) {
      unresolved.push({ id: String(hh._id), reason: 'intake' });
      continue;
    }
    const k = String(hh.effortId);
    if (!byEffort.has(k)) byEffort.set(k, []);
    byEffort.get(k).push(hh);
  }
  for (const [effortId, hhs] of byEffort) {
    const pid = await currentDeskPassForDoor({ campaignId: campaign._id, effortId: oid(effortId) });
    if (!pid) for (const hh of hhs) unresolved.push({ id: String(hh._id), reason: 'no-round' });
    else for (const hh of hhs) add(pid, hh);
  }
  return { byPass, unresolved, ineligible, passProblem: null };
};

// ── Book-level counts, keyed by (passId, current book membership) ──────────────────────────
// One aggregate over the rounds in play → Map<"passId|householdId", rowCount>. Bounded by the
// passes (rides the { campaignId, passId, householdId } prefix) and by the desk rows themselves —
// restricted marks are a small minority of any ledger — rather than by a 250k-id $in.
export const deskMarkCountsForPasses = async (campaignId, passIds) => {
  const out = new Map();
  if (!passIds?.length) return out;
  const agg = await CanvassActivity.aggregate([
    { $match: { campaignId, passId: { $in: passIds.map(oid) }, ...DESK_RESTRICT_MATCH } },
    { $group: { _id: { passId: '$passId', householdId: '$householdId' }, n: { $sum: 1 } } },
  ]);
  for (const r of agg) out.set(`${r._id.passId}|${r._id.householdId}`, r.n);
  return out;
};

// Above the cap we skip the status half and report `live: null` — "not computed" — rather than a
// guessed value. Every consumer must treat null as unknown and print nothing; a wrong zero would
// read as "no superseded marks", which is the exact lie this whole change exists to stop.
const DESK_MARK_STATE_MAX = 20000;

// The rows on disk AND whether each one still holds → Map<"passId|householdId", { rows, live }>.
//
// `rows` is what the undo deletes; `live` is whether that round still READS restricted. They come
// apart when a canvasser's later field row out-votes the mark (latest-wins / sticky completion):
// the row stays on file — deliberately, it is the admin's history and the book-level undo still
// reaches it — but the door is no longer restricted. A desk mark in that state is SUPERSEDED.
// Reporting rows alone is what made "Unmark restricted (N desk marks)" count doors the same
// page's status chips showed as Surveyed.
//
// Cost: the door-id `$in` is bounded by the desk rows themselves (restricted + via:'bulk' is a
// small minority of any ledger — see deskMarkCountsForPasses above), never by the campaign's
// door count, and it rides the same { campaignId, passId, householdId } prefix. No new index.
export const deskMarkStateForPasses = async (campaignId, passIds, campaignType) => {
  const counts = await deskMarkCountsForPasses(campaignId, passIds);
  const out = new Map();
  if (!counts.size) return out;
  if (counts.size > DESK_MARK_STATE_MAX) {
    for (const [k, rows] of counts) out.set(k, { rows, live: null });
    return out;
  }
  const doorIds = [...new Set([...counts.keys()].map((k) => k.split('|')[1]))];
  const statuses = await getPassStatusMapMulti(passIds, doorIds, campaignType);
  for (const [k, rows] of counts) out.set(k, { rows, live: statuses.get(k)?.status === 'restricted' });
  return out;
};

// Sum those rows per book over its CURRENT householdIds → Map<turfIdStr, { rows, superseded }>.
// Same O(booked doors) walk eligibleSetOf already does. Archived (merge-absorbed) stubs count 0.
//
// `rows` keeps its exact historical meaning — every desk row on the book's current doors for its
// round, i.e. what Unmark deletes and what the toast's deletedCount will report. `superseded` is
// the subset whose round no longer reads restricted. A book with even one uncomputed entry (the
// cap above) reports `superseded: null`, never a partial sum.
export const countDeskMarksByBook = (turfs, state) => {
  const out = new Map();
  for (const t of turfs) {
    let rows = 0;
    let superseded = 0;
    let unknown = false;
    if (t.status !== 'archived' && state.size) {
      for (const id of t.householdIds || []) {
        const e = state.get(`${t.passId}|${id}`);
        if (!e) continue;
        rows += e.rows;
        if (e.live === null) unknown = true;
        else if (e.live === false) superseded += e.rows;
      }
    }
    out.set(String(t._id), { rows, superseded: unknown ? null : superseded });
  }
  return out;
};

// The delete/count filter for one book's desk marks — its round × its current doors.
export const deskMarkFilterForBook = (turf) => ({
  passId: turf.passId,
  householdId: { $in: turf.householdIds || [] },
});
