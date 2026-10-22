import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { CampaignChange } from '../../models/CampaignChange.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { Household } from '../../models/Household.js';
import { Pass } from '../../models/Pass.js';
import { TurfSnapshot } from '../../models/TurfSnapshot.js';
import { UnknockRun } from '../../models/UnknockRun.js';
import { UnknockRunChunk, UNKNOCK_CHUNK_ROWS } from '../../models/UnknockRunChunk.js';
import { Voter } from '../../models/Voter.js';
import { recomputeHouseholdStatusesBatched, recomputeSurveyStatusesBatched } from './status.js';
import { recomputeCampaignStats } from '../reports/campaignCounters.js';
import { knocksPipeline, billableDoorsOf, contactRate, connectionRate, KNOCK_ACTIONS } from '../reports/aggregations.js';
import { archiveOverwrittenResponses, snapshotFromArchive, claimCopiesForWriteBack, releaseCopies, deleteUnlessReplaced } from '../surveys/archiveOverwrite.js';
import { bumpLive } from '../platform/platformStats.js';
import { doorKey } from './doorKey.js';
import { unknockHistoryRowId } from './unknockLease.js';
import { visitsClause } from './answerScope.js';
import { sweptAfter } from '../platform/lateWriteSweep.js';
import { answerEditBusy, ANSWER_EDIT_BUSY_ERROR, removalBusy } from './answerEditRuns.js';
import { fencesForSlots, withFences } from './answerEditWriter.js';
import { fingerprint } from './answerEdit.js';
import { insertAllowingDuplicates, idsOnFile } from './rawInsert.js';

// UNKNOCKING — striking door entries from the record so the doors read `unknocked` again.
//
// The other Door Outcomes acts rewrite what an entry SAYS. This one says the entry should not
// exist: a fabricated knock is not a mislabelled visit, it is a visit nobody made. Relabelling it
// to Not home (the tool that came first) leaves the knock counted and BILLED and only frees the
// door for the NEXT round's cut. Unknocking removes it from every total and returns the door to
// `unknocked` inside the round it is already in — so the crew can go knock it for real, and that
// knock bills as the first one, which it is.
//
// `unknocked` is not a value anyone writes. It is what resolveStatus returns for a door with no
// rows left (utils/statusPrecedence.js), which is why this is a deletion and not a flip, and why
// the settle step below is not optional: the door's status is a cache of its rows.
//
// THE SAFETY MODEL, in the order the steps run:
//   1. FREEZE FIRST. The run row — carrying the selected activity documents verbatim — is written
//      before anything is destroyed (the TurfSnapshot rule, services/turf/snapshot.js). A crash
//      after this point leaves a `pending` run that states exactly what was intended and holds the
//      originals; a crash before it leaves the ledger untouched.
//   2. ARCHIVE, NEVER DROP, the answers of a surveyed entry — the same posture, and the same
//      reason, as a Surveyed→outcome conversion: in an investigation the answers being removed are
//      the evidence.
//   3. DELETE the rows.
//   4. SETTLE: door status, voter survey status, the phones' delta clock, campaign counters.
//
// NEVER RATE-NEUTRAL. The reclassify path can prove some conversions move no number, because the
// (household, pass) groups it aggregates over are unchanged. A deletion changes group MEMBERSHIP,
// so there is no shortcut here: every run is priced against the production pipeline and every run
// recomputes counters.

/** Rows a run captured, keyed by the visit they belong to. */
const visitKeyOf = (row) => doorKey(row);

// Visits per read, and entries per delete: every step of a strike stays short, and the run beats
// between them (unknockLease.js).
const STRIKE_BATCH = 500;
// Voters per page of an undo's copies: their copies, holders and fences in memory at once (round 9). Read
// at call time, so a test can make the pages small.
const UNDO_VOTER_PAGE = () => Number(process.env.UNDO_VOTER_PAGE) || 1000;
const asId = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * What `Model` holds at these visits (door, round, canvasser) — one clause for the batch's doors and
 * rounds (visitsClause), the visits kept here. One `$or` clause per VISIT was the strike's survey read
 * until round 4: 28 s at 5,000 entries and 440 s at 25,000, most of it planning the query, which also put
 * the preview at the router's 30 s limit (code review round 4); one per round and canvasser grew the same
 * way with the crew (round 8). `projection` must keep householdId, passId and userId.
 */
const atVisits = async (Model, rows, { filter = {}, projection = null } = {}) => {
  if (!rows.length) return [];
  const keys = new Set(rows.map(visitKeyOf));
  const found = await Model.find({ ...visitsClause(rows), ...filter }, projection).lean();
  return found.filter((r) => keys.has(visitKeyOf(r)));
};

/** atVisits, STRIKE_BATCH visits at a time. */
const atVisitsBatched = async (Model, rows, opts) => {
  const out = [];
  for (let i = 0; i < rows.length; i += STRIKE_BATCH) out.push(...(await atVisits(Model, rows.slice(i, i + STRIKE_BATCH), opts)));
  return out;
};

/**
 * What this removal would do to the campaign's reported numbers.
 *
 * The "after" figures come from the SAME knocksPipeline that produces the "before" ones, with the
 * selected ids excluded ahead of it — a simulation through the production aggregation rather than
 * a parallel formula that could drift from it (the computeImpact rule in reclassifyOutcomes.js).
 * `$nin` is the delete's answer to that function's `$set`.
 */
export async function computeUnknockImpact({ campaign, ids, billRestricted }) {
  const campaignId = campaign._id;
  const opts = { includeRestricted: true };
  const totalsOf = (row) => ({
    knocks: row?.knocks || 0,
    billableDoors: billableDoorsOf(row || {}, billRestricted),
    restrictedDoors: row?.restrictedDoors || 0,
    contactRate: contactRate(row || {}),
    connectionRate: connectionRate(row || {}),
  });
  const [beforeRow] = await CanvassActivity.aggregate(knocksPipeline({ campaignId }, opts));
  const [afterRow] = await CanvassActivity.aggregate([
    { $match: { campaignId, _id: { $nin: ids } } },
    ...knocksPipeline({ campaignId }, opts),
  ]);
  return { before: totalsOf(beforeRow), after: totalsOf(afterRow) };
}

/**
 * The answer-ledger half of the price: whose answers this removal would archive, by name.
 *
 * Scoped to the visit triple of each surveyed row — one canvasser's visit to one door in one
 * round — which is the same scope the archive step below uses, so the preview cannot promise a
 * different set than the run takes. A door where a SECOND canvasser also surveyed keeps their
 * answers: their visit is not the one being struck.
 */
export async function computeUnknockAnswers({ rows }) {
  const surveyed = rows.filter((r) => r.actionType === 'survey_submitted');
  if (!surveyed.length) return { responsesToArchive: 0, votersAffected: 0, manifest: [], manifestTotal: 0, manifestTruncated: false };

  // Each survey once: two Surveyed entries at one visit (an older shape) can fall in two batches, and
  // both read its answers (round 5: the preview counted 600 for 599).
  const found = await atVisitsBatched(SurveyResponse, surveyed, { projection: 'voterId householdId passId userId submittedAt answers' });
  const existing = [...new Map(found.map((s) => [String(s._id), s])).values()];
  const voterIds = [...new Set(existing.map((s) => String(s.voterId)))];
  const names = await Voter.find({ _id: { $in: voterIds.slice(0, 50) } }, 'fullName').lean();
  const nameById = new Map(names.map((v) => [String(v._id), v.fullName]));
  return {
    responsesToArchive: existing.length,
    votersAffected: voterIds.length,
    manifest: existing.slice(0, 50).map((s) => ({
      voterId: String(s.voterId),
      voterName: nameById.get(String(s.voterId)) || 'Unknown voter',
      submittedAt: s.submittedAt,
      answerCount: (s.answers || []).length,
    })),
    manifestTotal: existing.length,
    manifestTruncated: existing.length > 50,
  };
}

/** Door status + last-action facts + voter survey status + the phones' delta clock + counters. */
async function settle({ campaign, doorIds, voterIds }) {
  await settleDoors(campaign, doorIds);
  if (voterIds.length) await recomputeSurveyStatusesBatched([...new Set(voterIds.map(String))]);
  // Always — a deletion can never be proven rate-neutral. Idempotent, so a re-run is safe.
  await recomputeCampaignStats(campaign._id);
}

/** Door status + last-action facts for these doors (the phones' delta clock rides on the status write). */
async function settleDoors(campaign, doorIds) {
  const doors = [...new Set(doorIds.map(String))].map((s) => new mongoose.Types.ObjectId(s));
  // recomputeHouseholdStatusesBatched carries timestamps:true, which is what pushes a recolored
  // (now unknocked) pin to the phones through /mobile/changes.
  if (doors.length) await recomputeHouseholdStatusesBatched(doors, campaign.type);

  // lastActionAt / lastActionBy are write-time facts (routes/mobile/canvass.js sets them beside
  // each insert) that nothing else recomputes — the desk-restrict paths could leave them alone
  // because "nothing happened to the door", but here the visit those fields NAME may be the one
  // just struck. Re-derive both from the surviving rows; a door with none goes back to null.
  if (doors.length) {
    const latest = await CanvassActivity.aggregate([
      { $match: { householdId: { $in: doors }, actionType: { $ne: 'note_added' } } },
      { $sort: { timestamp: -1 } },
      { $group: { _id: '$householdId', at: { $first: '$timestamp' }, by: { $first: '$userId' } } },
    ]);
    const byDoor = new Map(latest.map((r) => [String(r._id), r]));
    await Household.bulkWrite(
      doors.map((id) => {
        const l = byDoor.get(String(id));
        return {
          updateOne: {
            filter: { _id: id },
            update: { $set: { lastActionAt: l?.at || null, lastActionBy: l?.by || null } },
          },
        };
      }),
      { ordered: false }
    );
  }
}

// A run's History row, once (unknockHistoryRowId): a strike or an undo that is retried — or that
// stopped after writing it — never logs twice (round 5).
const historyRow = (campaign, byUserId, runId, { swap = false } = {}) =>
  CampaignChange.updateOne(
    { _id: unknockHistoryRowId(runId, swap ? 'undo' : 'strike') },
    {
      $setOnInsert: {
        organizationId: campaign.organizationId,
        campaignId: campaign._id,
        field: 'unknock',
        // Reads left-to-right in the history feed, so a revert says the opposite of the run.
        fromValue: swap ? 'unknocked' : 'recorded',
        toValue: swap ? 'recorded' : 'unknocked',
        byUserId: byUserId || null,
        source: 'unknock',
      },
    },
    { upsert: true }
  );

// The strike's heartbeat (unknockLease.js), and its stop: each beat is a compare-and-swap on no undo
// having begun — `undoBegunAt`, which the undo's claim sets and nothing clears (round 5: a failed undo
// cleared `revertingAt`, and a strike that woke after its lease then completed over the partial undo) —
// so a strike that stalled long enough to read stopped, and was undone meanwhile, stops before its next
// removal instead of removing what the undo put back (round 4).
export const UNKNOCK_UNDONE_ERROR = 'That unknock was undone while it was still removing entries, so it stopped.';
const NO_UNDO = { revertingAt: null, revertedAt: null, undoBegunAt: null };
const undoneMidStrike = () => Object.assign(new Error(UNKNOCK_UNDONE_ERROR), { code: 'UNKNOCK_UNDONE' });
const beat = async (runId, set = {}) => {
  const res = await UnknockRun.updateOne({ _id: runId, ...NO_UNDO }, { $set: { heartbeatAt: new Date(), ...set } });
  if (res.matchedCount !== 1) throw undoneMidStrike();
};

/**
 * Remove a selection from the record.
 *
 * `rows` are the resolved selection (resolveSelection's projection: _id, householdId, actionType,
 * userId, passId). The full documents are re-read here rather than trusted from that projection —
 * the frozen copy has to be complete enough to restore byte-for-byte.
 */
async function strike({ campaign, rows, byUserId, scope = {}, byIds = false, scopeSummary = null }) {
  const ids = rows.map((r) => r._id);
  // The moment of the freeze, taken before the read: an entry recorded after it is newer work to the undo
  // (round 8: taken after, one recorded in between read as the visit as it stood).
  const frozenAt = new Date();
  const frozen = await CanvassActivity.find({ _id: { $in: ids } }).lean();
  const doorIds = [...new Set(frozen.map((r) => String(r.householdId)))];

  // 1. FREEZE FIRST — before a single row is touched. The run row is written before its chunks
  // so a crash mid-freeze leaves a `pending` run with partial chunks rather than orphan chunks
  // nothing points at; a pending run is never offered a Revert.
  const run = await UnknockRun.create({
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    byUserId: byUserId || null,
    status: 'pending',
    frozenRows: frozen.length,
    selection: { scope, byIds },
    scopeSummary,
    counts: { entriesRemoved: frozen.length, doorsAffected: doorIds.length },
    heartbeatAt: new Date(),
  });
  // One change at a time, made atomic: the route's check can race an answer edit's create, so with
  // this run on file it runs again, before a single row is touched — whichever create checks second
  // sees the other and steps back (code review 2026-10-19). ...and another removal, the same way: a
  // second unknock of rows the first is still removing, or a conversion writing the same visits,
  // interleaved with this one's read-archive-delete (round 6). Either check failing outright takes the
  // run with it too — nothing is touched yet, and left on file it read Removing… for ten minutes,
  // holding every removal and answer edit back (round 7).
  let refusal = null;
  try {
    if (await answerEditBusy(campaign._id)) {
      refusal = Object.assign(new Error(ANSWER_EDIT_BUSY_ERROR.error), { code: ANSWER_EDIT_BUSY_ERROR.code, raced: true });
    } else {
      const busy = await removalBusy(campaign._id, { exceptUnknockId: run._id });
      if (busy) refusal = Object.assign(new Error(busy.error), { code: busy.code, raced: true, refusal: busy });
    }
  } catch (err) {
    // ...and if even that fails, the run reads stopped at once — Did not finish, nothing removed — rather
    // than Removing… for ten minutes with every change on the campaign waiting (round 9).
    await UnknockRun.deleteOne({ _id: run._id }).catch(() => UnknockRun.updateOne({ _id: run._id }, { $set: { stoppedAt: new Date() } }).catch(() => {}));
    err.notStarted = true;
    throw err;
  }
  if (refusal) {
    await UnknockRun.deleteOne({ _id: run._id });
    throw refusal;
  }
  try {
    return await strikeFrozen({ campaign, run, frozen, frozenAt, ids, doorIds, byUserId });
  } catch (err) {
    // A strike that failed (a database error, not a dyno restart) is over: it reads stopped at once —
    // Stopped part-way, or Did not finish — instead of Removing… for ten minutes, holding its Undo and
    // every answer edit back (round 5). The moment goes on `stoppedAt`, never the heartbeat: Restore's
    // hold on the struck visits ends when the strike stopped (round 6 — an epoch heartbeat ended it in
    // 1970, and a Restore swapped struck answers over a real later survey).
    if (err?.code !== 'UNKNOCK_UNDONE') {
      await UnknockRun.updateOne({ _id: run._id, status: 'pending', ...NO_UNDO }, { $set: { stoppedAt: new Date() } }).catch(() => {});
    }
    // The route answers with the run, so the page says it stopped, and where (round 7).
    err.unknockRunId = run._id;
    throw err;
  }
}

async function strikeFrozen({ campaign, run, frozen, frozenAt, ids, doorIds, byUserId }) {
  const frozenIds = new Set(frozen.map((r) => String(r._id)));
  for (let i = 0; i < frozen.length; i += UNKNOCK_CHUNK_ROWS) {
    if (i > 0) await beat(run._id);
    const slice = frozen.slice(i, i + UNKNOCK_CHUNK_ROWS);
    // The other entries at these visits as they stand — the second entry of an older visit that held two —
    // so the undo can tell the visit as it stood from an entry put back there since (round 8).
    const beside = await atVisits(CanvassActivity, slice, { filter: { actionType: { $ne: 'note_added' } }, projection: { householdId: 1, passId: 1, userId: 1 } });
    await UnknockRunChunk.create({
      runId: run._id,
      campaignId: campaign._id,
      organizationId: campaign.organizationId,
      seq: i / UNKNOCK_CHUNK_ROWS,
      rows: slice,
      visitKeys: [...new Set(slice.map(visitKeyOf))],
      coEntryIds: beside.filter((a) => !frozenIds.has(String(a._id))).map((a) => a._id),
      frozenAt,
    });
  }

  // Marked before the FIRST removal (the answers' delete below): a strike that stops past this point
  // reads as one that removed — the guard holds it and, once it has stopped, Undo is offered — never
  // as "nothing was removed" (round 3). In History from here, so one that stops part-way is listed
  // (round 5); the row is written once whatever happens after.
  await beat(run._id, { deletingAt: new Date() });
  await historyRow(campaign, byUserId, run._id);

  // 2. ARCHIVE the answers of every surveyed entry, at its own visit triple — a batch at a time, each
  // batch's voters settled as it goes, so a strike that stops part-way leaves nothing stale behind it
  // (round 5: their doors and voters read surveyed until an Undo).
  const surveyed = frozen.filter((r) => r.actionType === 'survey_submitted');
  // Where it has got to, with each beat: the answers' batches, then the entries' — it reads completed as soon
  // as its last removal is done, so the row goes from its last batch's share to Undo (the 95% cap only keeps
  // it from reading done before it is).
  const steps = surveyed.length + ids.length || 1;
  const at = (n) => ({ progress: { phase: 'removing', pct: Math.min(95, Math.floor((n / steps) * 95)) } });
  let responsesArchived = 0;
  const archivedVoterIds = [];
  for (let i = 0; i < surveyed.length; i += STRIKE_BATCH) {
    if (i > 0) await beat(run._id, at(i));
    const responses = await atVisits(SurveyResponse, surveyed.slice(i, i + STRIKE_BATCH));
    if (!responses.length) continue;
    await archiveOverwrittenResponses(responses, { byUserId, via: 'unknock', unknockRunId: run._id });
    await beat(run._id);
    // ...each only while it still holds the submission read (round 9: a profile Restore swapped in between
    // was deleted with it — archiveOverwrite.js deleteUnlessReplaced).
    await deleteUnlessReplaced(responses);
    responsesArchived += responses.length;
    archivedVoterIds.push(...responses.map((r) => r.voterId));
    await recomputeSurveyStatusesBatched([...new Set(responses.map((r) => String(r.voterId)))]);
  }

  // 3. DELETE, each batch's doors settled as it goes.
  let entriesRemoved = 0;
  for (let i = 0; i < ids.length; i += STRIKE_BATCH) {
    await beat(run._id, at(surveyed.length + i));
    const batch = ids.slice(i, i + STRIKE_BATCH);
    const del = await CanvassActivity.deleteMany({ _id: { $in: batch } });
    entriesRemoved += del.deletedCount || 0;
    const inBatch = new Set(batch.map(String));
    await settleDoors(campaign, frozen.filter((r) => inBatch.has(String(r._id))).map((r) => r.householdId));
  }

  // When the strike finished: Restore holds a copy of these visits' answers made up to now to the
  // strike (restoreGuard.js), which the chunks' visitKeys record. A compare-and-swap, never a save of
  // the run as read: an undo that began while this strike stalled owns the run now (round 4).
  const completedAt = new Date();
  const counts = {
    ...run.toObject().counts,
    entriesRemoved,
    responsesArchived,
    votersAffected: new Set(archivedVoterIds.map(String)).size,
  };
  const finished = await UnknockRun.updateOne(
    { _id: run._id, status: 'pending', ...NO_UNDO },
    { $set: { status: 'completed', completedAt, heartbeatAt: completedAt, counts } }
  );
  const landed = finished.matchedCount === 1;
  if (landed) {
    run.status = 'completed';
    run.completedAt = completedAt;
    run.counts = counts;
  }

  // 4. SETTLE — whoever owns the run now. The doors and voters settled batch by batch as they went;
  // what is left is the campaign's own numbers (round 6: settling every door and voter again here took
  // half of a 25,000-entry strike). A read cache the nightly reconcile heals, so a failure is logged, as on
  // every request path — never "stopped before it finished" for a run that reads completed (round 7).
  await recomputeCampaignStats(campaign._id, { swallowErrors: true });
  if (!landed) throw undoneMidStrike();

  // Best-effort platform counters. The nightly recomputeLive SETs these from real rows and is the
  // true healer (services/platform/platformStats.js) — the same posture every other delete path
  // takes, stated rather than assumed.
  const knockRows = frozen.filter((r) => KNOCK_ACTIONS.includes(r.actionType)).length;
  const opts = { orgId: campaign.organizationId };
  if (knockRows) await bumpLive('doorsKnocked', -knockRows, opts);
  if (responsesArchived) await bumpLive('surveyResponses', -responsesArchived, opts);

  return run;
}

/**
 * Put a run back.
 *
 * Both ledgers follow the same rule, and it is the important one: NEVER CLOBBER NEWER REAL WORK.
 * The whole point of an unknock is that the crew goes and knocks the door for real — so by the
 * time someone reverts, a door may hold a genuine visit. That visit is the truth; the frozen
 * original is what we removed. So a row is restored only into a visit that is still empty, an
 * answer only into a {voterId, passId} slot that is still free, and everything skipped is counted
 * and reported rather than forced.
 *
 * Deciding "is the slot free" by an explicit READ, not by whether a unique index happens to fire,
 * is the surveyConversion.js rule: production builds indexes in a deploy step, and a
 * data-destroying decision must not depend on one existing.
 */
// Entries of this run a LATER unknock that still stands has struck since — this one stopped before
// removing them, and an admin unknocked them again. That strike owns them now: putting them back undid
// it, the fake knocks billed again under a run that still read completed (code review round 5). Each
// maps to the latest such run (an earlier one that froze it too stopped before removing it).
const entriesStruckLater = async (campaign, run, chunks) => {
  const frozenAt = chunks.reduce((m, c) => (c.frozenAt && (!m || c.frozenAt > m) ? c.frozenAt : m), null);
  const keys = [...new Set(chunks.flatMap((c) => c.visitKeys || []))];
  const others = [];
  for (let i = 0; i < keys.length; i += STRIKE_BATCH) {
    others.push(
      ...(await UnknockRunChunk.find(
        { campaignId: campaign._id, visitKeys: { $in: keys.slice(i, i + STRIKE_BATCH) }, runId: { $ne: run._id }, ...(frozenAt ? { frozenAt: { $gt: frozenAt } } : {}) },
        { runId: 1, frozenAt: 1, 'rows._id': 1 }
      ).lean())
    );
  }
  if (!others.length) return new Map();
  const standing = new Set(
    (
      await UnknockRun.find(
        { _id: { $in: [...new Set(others.map((c) => String(c.runId)))] }, revertedAt: null, $or: [{ status: 'completed' }, { status: 'pending', deletingAt: { $ne: null } }] },
        { _id: 1 }
      ).lean()
    ).map((r) => String(r._id))
  );
  const latest = new Map(); // entry id -> { runId, frozenAt }
  for (const c of others) {
    if (!standing.has(String(c.runId))) continue;
    for (const r of c.rows || []) {
      const was = latest.get(String(r._id));
      if (!was || new Date(c.frozenAt) > new Date(was.frozenAt)) latest.set(String(r._id), { runId: String(c.runId), frozenAt: c.frozenAt });
    }
  }
  return new Map([...latest].map(([id, v]) => [id, v.runId]));
};

const slotOf = (r) => `${r.voterId}|${r.passId ?? 'null'}`;
// The same submission — same canvasser, same moment, same answers and note — already holds the slot: the
// copy's answers are on file (never removed: the strike stopped before deleting them; or put back by an
// attempt of this undo that died before deleting the copy). The conversion undo's rule (round 6).
const sameSubmission = (holder, copy) => {
  const snap = snapshotFromArchive(copy);
  return (
    String(holder.userId) === String(copy.userId) &&
    !!holder.submittedAt &&
    !!copy.submittedAt &&
    new Date(holder.submittedAt).getTime() === new Date(copy.submittedAt).getTime() &&
    fingerprint(holder) === fingerprint(snap) &&
    (holder.note ?? null) === (snap.note ?? null)
  );
};
const HOLDER_FIELDS = 'voterId passId userId submittedAt answers editedBy editedAt note';
// Only the copies' own rounds, and only the slots asked for, are kept: every round's surveys of every voter,
// answers and all, grew the web dyno's heap by half a gigabyte at the cap (round 8).
const holdersOf = async (copies) => {
  const wanted = new Set(copies.map(slotOf));
  const passIds = [...new Map(copies.map((d) => [String(d.passId ?? null), d.passId ?? null])).values()];
  const voterIds = [...new Set(copies.map((d) => String(d.voterId)))].map(asId);
  const out = new Map();
  for (let i = 0; i < voterIds.length; i += STRIKE_BATCH) {
    for (const r of await SurveyResponse.find({ voterId: { $in: voterIds.slice(i, i + STRIKE_BATCH) }, passId: { $in: passIds } }, HOLDER_FIELDS).lean()) {
      if (wanted.has(slotOf(r))) out.set(slotOf(r), r);
    }
  }
  return out;
};

// An undo's progress for its row — beside the run, never through it: `updatedAt` stays the run's own
// (the page reads it as when the run last changed).
const undoProgress = (run, pct) =>
  UnknockRun.updateOne({ _id: run._id }, { $set: { progress: { phase: 'undoing', pct } } }, { timestamps: false });

async function revertStrike({ campaign, run, byUserId }) {
  // From the start: a Retry undo showed the stopped attempt's percentage until its first page (code review
  // of 12b56fa).
  await undoProgress(run, 0);
  const chunks = await UnknockRunChunk.find({ runId: run._id }).sort({ seq: 1 }).lean();
  const frozen = chunks.flatMap((c) => c.rows || []);
  const struckLater = await entriesStruckLater(campaign, run, chunks);

  // What holds each visit now — read at the exact triples we would restore into (by door, a batch at a
  // time — atVisits). An entry recorded since this run froze the visit is NEWER work: nothing goes back into
  // it, and the strike stands there. One from before is the visit as it stood when it is one the strike
  // recorded beside its own (`coEntryIds` — the other entry of an older visit that held two), or one of its
  // own it never got to delete: it doesn't block (round 7: with any entry counted, the undo of one of a
  // visit's two entries could never put it back). Any other older entry was put back there since — by
  // another unknock's undo, a snapshot restore: nothing goes back beside it either (round 8: two Surveyed
  // entries for one visit counted the canvasser twice), but the visit reads as it did, so the strike is
  // lifted there and its answers stay earlier answers on the profile. A run frozen before `coEntryIds`
  // can't tell the two older kinds apart, and reads every one as put back since — no entry doubled. Notes
  // don't occupy a visit — a note_added row legally coexists with an outcome row at the same triple (the
  // field path never replaces one), so a note surviving the unknock must not block its own door's outcome
  // from coming back.
  const frozenAt = chunks.reduce((m, c) => (c.frozenAt && (!m || c.frozenAt > m) ? c.frozenAt : m), null);
  const ownIds = new Set(frozen.map((r) => String(r._id)));
  const recordsBeside = chunks.some((c) => Array.isArray(c.coEntryIds));
  const besideIds = new Set(chunks.flatMap((c) => (c.coEntryIds || []).map(String)));
  const live = await atVisitsBatched(CanvassActivity, frozen, {
    filter: { actionType: { $ne: 'note_added' } },
    projection: { householdId: 1, passId: 1, userId: 1, createdAt: 1 },
  });
  const newerAt = new Set();
  const putBackSinceAt = new Set();
  for (const a of live) {
    if (ownIds.has(String(a._id))) continue;
    if (frozenAt && a.createdAt && new Date(a.createdAt) > frozenAt) newerAt.add(visitKeyOf(a));
    else if (!recordsBeside || !besideIds.has(String(a._id))) putBackSinceAt.add(visitKeyOf(a));
  }
  // ...nor into a round whose history went since: one cleared after this run with its snapshot unrestored —
  // the Undo got here only because that round can't take the snapshot back (roundClearedSince) — or one no
  // longer on file. The strike stands there, as at newer work (round 9: put back into a round worked again,
  // an archived one or a deleted one, the struck entries came back beside the work that replaced them, or
  // under a round that no longer existed, with their answers gone with the snapshot).
  const struckRounds = [...new Map(frozen.filter((r) => r.passId).map((r) => [String(r.passId), r.passId])).values()];
  if (struckRounds.length) {
    const [onFile, cleared] = await Promise.all([
      Pass.distinct('_id', { _id: { $in: struckRounds } }),
      TurfSnapshot.distinct('passId', { campaignId: campaign._id, clearedKnocks: true, restoredAt: null, createdAt: { $gt: run.createdAt }, passId: { $in: struckRounds } }),
    ]);
    const kept = new Set(onFile.map(String));
    const gone = new Set([...struckRounds.map(String).filter((p) => !kept.has(p)), ...cleared.map(String)]);
    for (const r of frozen) if (r.passId && gone.has(String(r.passId))) newerAt.add(visitKeyOf(r));
  }
  const takenVisits = new Set([...newerAt, ...putBackSinceAt]);

  const restorable = frozen.filter((r) => !takenVisits.has(visitKeyOf(r)) && !struckLater.has(String(r._id)));
  if (restorable.length) {
    // Raw driver insert: preserves the original _ids so a restore is byte-exact (the
    // snapshot.js:142-154 precedent). Mongoose would mint new ones.
    //
    // ordered:false AND an E11000 swallow, together: a revert that crashed part-way must be
    // retryable, and on retry the rows it already restored collide on _id. Ordered inserts abort
    // at the first collision and would leave everything after it permanently unrestored, behind a
    // revertedAt flag that never got set.
    await insertAllowingDuplicates(CanvassActivity.collection, restorable);
  }

  const frozenIds = frozen.map((r) => r._id);
  const onFile = frozenIds.length
    ? await CanvassActivity.find({ _id: { $in: frozenIds } }, { householdId: 1, passId: 1, userId: 1, actionType: 1, reclassified: 1 }).lean()
    : [];
  const entriesBack = new Set(onFile.map(visitKeyOf));
  // The visits a later unknock still standing struck since are THAT run's — their entries and their
  // answers: this undo skipped the entries but wrote the answers back, putting back what the later run
  // had removed, or under an entry it then deleted (round 6). This run's copies there go to it, so its
  // Undo writes them back — unless one of this run's own entries there is back that the later run never
  // struck: that visit is this run's to put back, answers and all (round 7: an older visit holding two
  // entries, one struck later, came back Surveyed with its answers handed away, and the later run's Undo
  // could never put them back — the visit was no longer free). An entry back only because neither run
  // deleted it is the later run's.
  const ownBack = new Set(onFile.filter((r) => !struckLater.has(String(r._id))).map(visitKeyOf));
  const handedTo = new Map(); // visitKey -> later run id
  for (const r of frozen) {
    const later = struckLater.get(String(r._id));
    if (later && !ownBack.has(visitKeyOf(r))) handedTo.set(visitKeyOf(r), later);
  }
  // The answer side, same rule — and only under a visit's own entry, back and still Surveyed: an
  // answer put back at a visit newer work holds counted a survey under a door that says otherwise
  // (round 3), and so did one put back under an entry another admin had since converted (round 5).
  const surveysBack = new Set(
    onFile.filter((r) => r.actionType === 'survey_submitted' && !r.reclassified && !handedTo.has(visitKeyOf(r))).map(visitKeyOf)
  );
  // Not restored: a frozen entry that isn't on file now — newer work held its visit, or a later
  // unknock struck it. Read from what is on file, so an entry an unknock stopped part-way never
  // removed is not called "not restored".
  const onFileIds = new Set(onFile.map((r) => String(r._id)));
  const rowsNotRestored = frozen.filter((r) => !onFileIds.has(String(r._id))).length;
  let responsesNotRestored = 0;
  let promoted = 0;
  const restoredVoterIds = [];
  // A page of voters at a time — their copies, the surveys holding their slots, their fences — never every
  // copy of the run at once: a voter's copies are all on one page, so a slot's copies are judged together
  // (round 9: 50,000 copies of a twelve-question survey took the web dyno's heap 833 MB up).
  const copyVoters = await SurveyResponseArchive.distinct('voterId', { unknockRunId: run._id });
  // Counted not put back on every attempt: kept on this run as they go, since a retry no longer finds
  // them among its own (round 7: Retry undo dropped them from the count).
  let handedNow = 0;
  for (let page = 0; page < copyVoters.length; page += UNDO_VOTER_PAGE()) {
    await undoProgress(run, 10 + Math.floor((page / copyVoters.length) * 80));
    const archived = await SurveyResponseArchive.find({ unknockRunId: run._id, voterId: { $in: copyVoters.slice(page, page + UNDO_VOTER_PAGE()) } }).lean();
    const handOff = new Map(); // later run id -> copy ids
    for (const d of archived) {
      const later = handedTo.get(visitKeyOf(d));
      if (later) handOff.set(later, [...(handOff.get(later) || []), d._id]);
    }
    for (const [later, ids] of handOff) {
      const moved = await SurveyResponseArchive.updateMany({ _id: { $in: ids }, unknockRunId: run._id }, { $set: { unknockRunId: asId(later) } });
      if (!moved.modifiedCount) continue;
      await UnknockRun.updateOne({ _id: later }, { $inc: { 'counts.responsesArchived': moved.modifiedCount } });
      await UnknockRun.updateOne({ _id: run._id }, { $inc: { 'counts.responsesHanded': moved.modifiedCount } });
      handedNow += moved.modifiedCount;
    }

    const mine = archived.filter((d) => !handedTo.has(visitKeyOf(d)));
    if (!mine.length) continue;
    const holders = await holdersOf(mine);
    // A survey written back keeps the fences of answer-edit runs whose undo reached it meanwhile.
    const fences = await fencesForSlots(campaign._id, mine.map((d) => ({ voterId: d.voterId, passId: d.passId ?? null })));
    const already = [];
    const candidates = [];
    const twins = []; // a second copy of a slot this pass also writes back — judged once that one lands
    const chosen = new Set();
    const newestFirst = [...mine].sort((x, y) => new Date(y.overwrittenAt || 0) - new Date(x.overwrittenAt || 0));
    for (const doc of newestFirst) {
      const holder = holders.get(slotOf(doc));
      if (holder && sameSubmission(holder, doc)) already.push(doc);
      else if (holder || !surveysBack.has(visitKeyOf(doc))) responsesNotRestored += 1;
      else if (chosen.has(slotOf(doc))) twins.push(doc);
      else {
        chosen.add(slotOf(doc));
        candidates.push(doc);
      }
    }
    if (already.length) {
      await SurveyResponseArchive.deleteMany({ _id: { $in: already.map((d) => d._id) } });
      restoredVoterIds.push(...already.map((d) => d.voterId));
    }
    // Written back a batch at a time, from copies this undo holds (claimCopiesForWriteBack, this run's
    // claim — its own retry takes back what an attempt that failed left, round 6): a copy erased
    // meanwhile stays erased, counted not restored (round 5). Not re-validated: a verbatim copy of a
    // row that was already on file (archiveOverwrite.js), so an old row today's schema would refuse
    // can't make the undo fail. One insert per batch, not per survey (round 5: 25,000 took 24 s). A copy
    // goes only once its survey is read back on file. The batch's claim is let go however it ends — the
    // claim itself, the insert, the read-back or the delete failing (round 7: a claim whose own read
    // failed, and a landed copy whose delete failed, stayed held ten minutes) — by this run's token, so a
    // copy already gone matches nothing and a landed one left behind reads `already` on the retry. Only a
    // database that can't take the release, or a process that dies, leaves the claim to lapse in ten
    // minutes.
    for (let i = 0; i < candidates.length; i += STRIKE_BATCH) {
      const ids = candidates.slice(i, i + STRIKE_BATCH).map((d) => d._id);
      const landed = [];
      try {
        const held = await claimCopiesForWriteBack(ids, run._id);
        responsesNotRestored += ids.length - held.length;
        const now = new Date();
        const docs = held.map((d) => ({ ...withFences(snapshotFromArchive(d), fences), _id: new mongoose.Types.ObjectId(), createdAt: now, updatedAt: now }));
        await insertAllowingDuplicates(SurveyResponse.collection, docs);
        const written = await idsOnFile(SurveyResponse.collection, docs.map((x) => x._id));
        held.forEach((d, k) => {
          if (written.has(String(docs[k]._id))) landed.push(d);
        });
        responsesNotRestored += held.length - landed.length;
        if (landed.length) await SurveyResponseArchive.deleteMany({ _id: { $in: landed.map((d) => d._id) } });
      } finally {
        await releaseCopies(ids, run._id);
      }
      promoted += landed.length;
      restoredVoterIds.push(...landed.map((d) => d.voterId));
    }
    // A second copy of a slot just written back: the same submission is a duplicate and goes; anything
    // else stays on the profile as history, not put back.
    if (twins.length) {
      const now = await holdersOf(twins);
      const dupes = twins.filter((d) => now.get(slotOf(d)) && sameSubmission(now.get(slotOf(d)), d));
      if (dupes.length) await SurveyResponseArchive.deleteMany({ _id: { $in: dupes.map((d) => d._id) } });
      responsesNotRestored += twins.length - dupes.length;
    }
  }
  const responsesHanded = (run.counts?.responsesHanded || 0) + handedNow;
  responsesNotRestored += responsesHanded;

  // The visits this undo could NOT put back (newer work holds them): the strike stands there, so every
  // kept copy of their struck answers stays held to it (restoreGuard.js). Read from what is on file now
  // — each frozen entry back by its own id or not — so a retry after a part-way attempt, or two presses
  // at once, record the same truth (round 3: a second attempt counted the visits the first had put back
  // as taken). A visit handed to a later unknock is that run's to hold (round 6). Written on every
  // chunk, empty or not.
  // A visit an older entry was put back to since reads as it did: not this undo's to hold (round 8).
  const liftedAt = (k) => putBackSinceAt.has(k) && !newerAt.has(k);
  for (const c of chunks) {
    const keys = [...new Set((c.rows || []).filter((r) => !entriesBack.has(visitKeyOf(r)) && !handedTo.has(visitKeyOf(r)) && !liftedAt(visitKeyOf(r))).map(visitKeyOf))];
    await UnknockRunChunk.updateOne({ _id: c._id }, { $set: { notRestoredKeys: keys } });
  }

  // History and the settle BEFORE the run reads reverted (the conversion undo's order): an undo that
  // dies in between is retried — the row is written once, and the doors and voters it put back settle
  // — instead of leaving an undone run nothing will ever settle (round 5).
  await historyRow(campaign, byUserId, run._id, { swap: true });
  await undoProgress(run, 95);
  await settle({
    campaign,
    doorIds: frozen.map((r) => r.householdId),
    voterIds: restoredVoterIds,
  });

  run.counts.rowsNotRestored = rowsNotRestored;
  run.counts.responsesNotRestored = responsesNotRestored;
  run.counts.responsesHanded = responsesHanded;
  run.status = 'reverted';
  run.revertedAt = new Date();
  await run.save();

  const knockRows = restorable.filter((r) => KNOCK_ACTIONS.includes(r.actionType)).length;
  const opts = { orgId: campaign.organizationId };
  if (knockRows) await bumpLive('doorsKnocked', knockRows, opts);
  if (promoted) await bumpLive('surveyResponses', promoted, opts);

  return run;
}

// Both writers, swept after on a campaign or organization being deleted, however they end — what
// they wrote then outlives the delete cascade's last sweep otherwise (lateWriteSweep.js, round 3).
const tenantOf = (campaign) => ({ campaignId: campaign._id, organizationId: campaign.organizationId });
export const runUnknock = (args) => sweptAfter(tenantOf(args.campaign), () => strike(args));
export const revertUnknock = (args) => sweptAfter(tenantOf(args.campaign), () => revertStrike(args));

/**
 * Was this visit struck by an unknock that still stands?
 *
 * The offline queue can deliver a knock hours after it was tapped, and `supersededByNewer` — the
 * guard that stops a stale replay clobbering newer work — can only compare a replay against rows
 * that EXIST. An unknock leaves none, so without this the struck knock walks straight back in,
 * re-billing the visit and flipping the door off `unknocked`, with nothing anywhere reporting it.
 * In the fraud case that matters most, the phone holding the queue is the fraudulent canvasser's.
 *
 * Deliberately narrow, so it can never reject honest work:
 *   • replays only — the caller gates on `wasOfflineSubmission`, so a live write never pays the
 *     lookup or the risk;
 *   • the visit must match exactly (door, round, canvasser);
 *   • the tap must PREDATE the freeze — a knock recorded after the cleanup is new work;
 *   • a reverted run does not tombstone: undoing an unknock restores the world, replays included.
 */
export async function struckByUnknock({ campaignId, householdId, passId, userId, ts }) {
  const key = doorKey({ householdId, passId, userId });
  // distinct, not findOne: a visit can be struck by one run, restored, and struck again by a
  // later one — the answer is "does ANY standing run hold it", not whichever chunk indexes first.
  const runIds = await UnknockRunChunk.distinct('runId', {
    campaignId,
    visitKeys: key,
    frozenAt: { $gte: ts },
  });
  if (!runIds.length) return null;
  // Standing as Restore reads it (restoreGuard.js): completed, or stopped part-way after it began
  // removing — what it removed stays removed until its Undo (round 3).
  const run = await UnknockRun.findOne(
    { _id: { $in: runIds }, revertedAt: null, $or: [{ status: 'completed' }, { status: 'pending', deletingAt: { $ne: null } }] },
    { _id: 1 }
  ).lean();
  return run ? run._id : null;
}
