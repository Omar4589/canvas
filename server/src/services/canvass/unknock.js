import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { CampaignChange } from '../../models/CampaignChange.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { Household } from '../../models/Household.js';
import { UnknockRun } from '../../models/UnknockRun.js';
import { UnknockRunChunk, UNKNOCK_CHUNK_ROWS } from '../../models/UnknockRunChunk.js';
import { Voter } from '../../models/Voter.js';
import { recomputeHouseholdStatusesBatched, recomputeSurveyStatusesBatched } from './status.js';
import { recomputeCampaignStats } from '../reports/campaignCounters.js';
import { knocksPipeline, billableDoorsOf, contactRate, connectionRate, KNOCK_ACTIONS } from '../reports/aggregations.js';
import { archiveOverwrittenResponses, snapshotFromArchive } from '../surveys/archiveOverwrite.js';
import { bumpLive } from '../platform/platformStats.js';
import { doorKey } from './doorKey.js';

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

  const or = surveyed.map((r) => ({ householdId: r.householdId, passId: r.passId ?? null, userId: r.userId }));
  const existing = await SurveyResponse.find({ $or: or }, 'voterId householdId passId userId submittedAt answers').lean();
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

  if (voterIds.length) await recomputeSurveyStatusesBatched([...new Set(voterIds.map(String))]);
  // Always — a deletion can never be proven rate-neutral. Idempotent, so a re-run is safe.
  await recomputeCampaignStats(campaign._id);
}

const historyRow = (campaign, byUserId, { swap = false } = {}) =>
  CampaignChange.create({
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    field: 'unknock',
    // Reads left-to-right in the history feed, so a revert says the opposite of the run.
    fromValue: swap ? 'unknocked' : 'recorded',
    toValue: swap ? 'recorded' : 'unknocked',
    byUserId: byUserId || null,
    source: 'unknock',
  });

/**
 * Remove a selection from the record.
 *
 * `rows` are the resolved selection (resolveSelection's projection: _id, householdId, actionType,
 * userId, passId). The full documents are re-read here rather than trusted from that projection —
 * the frozen copy has to be complete enough to restore byte-for-byte.
 */
export async function runUnknock({ campaign, rows, byUserId, scope = {}, byIds = false, scopeSummary = null }) {
  const ids = rows.map((r) => r._id);
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
  });
  const frozenAt = new Date();
  for (let i = 0; i < frozen.length; i += UNKNOCK_CHUNK_ROWS) {
    const slice = frozen.slice(i, i + UNKNOCK_CHUNK_ROWS);
    await UnknockRunChunk.create({
      runId: run._id,
      campaignId: campaign._id,
      organizationId: campaign.organizationId,
      seq: i / UNKNOCK_CHUNK_ROWS,
      rows: slice,
      visitKeys: [...new Set(slice.map(visitKeyOf))],
      frozenAt,
    });
  }

  // 2. ARCHIVE the answers of every surveyed entry, at its own visit triple.
  const surveyed = frozen.filter((r) => r.actionType === 'survey_submitted');
  let responses = [];
  if (surveyed.length) {
    const or = surveyed.map((r) => ({ householdId: r.householdId, passId: r.passId ?? null, userId: r.userId }));
    responses = await SurveyResponse.find({ $or: or }).lean();
    if (responses.length) {
      await archiveOverwrittenResponses(responses, { byUserId, via: 'unknock', unknockRunId: run._id });
      await SurveyResponse.deleteMany({ _id: { $in: responses.map((r) => r._id) } });
    }
  }

  // 3. DELETE.
  const del = await CanvassActivity.deleteMany({ _id: { $in: ids } });

  run.counts.entriesRemoved = del.deletedCount || 0;
  run.counts.responsesArchived = responses.length;
  run.counts.votersAffected = new Set(responses.map((r) => String(r.voterId))).size;
  run.status = 'completed';
  await run.save();

  await historyRow(campaign, byUserId);

  // 4. SETTLE.
  await settle({ campaign, doorIds, voterIds: responses.map((r) => r.voterId) });

  // Best-effort platform counters. The nightly recomputeLive SETs these from real rows and is the
  // true healer (services/platform/platformStats.js) — the same posture every other delete path
  // takes, stated rather than assumed.
  const knockRows = frozen.filter((r) => KNOCK_ACTIONS.includes(r.actionType)).length;
  const opts = { orgId: campaign.organizationId };
  if (knockRows) await bumpLive('doorsKnocked', -knockRows, opts);
  if (responses.length) await bumpLive('surveyResponses', -responses.length, opts);

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
export async function revertUnknock({ campaign, run, byUserId }) {
  const chunks = await UnknockRunChunk.find({ runId: run._id }).sort({ seq: 1 }).lean();
  const frozen = chunks.flatMap((c) => c.rows || []);

  // Which visits are occupied now? One query over the exact triples we would restore into.
  // Notes don't occupy a visit — a note_added row legally coexists with an outcome row at the
  // same triple (the field path never replaces one), so a note surviving the unknock must not
  // block its own door's outcome from coming back.
  const or = frozen.map((r) => ({ householdId: r.householdId, passId: r.passId ?? null, userId: r.userId }));
  const live = or.length
    ? await CanvassActivity.find(
        { $or: or, actionType: { $ne: 'note_added' } },
        { householdId: 1, passId: 1, userId: 1 }
      ).lean()
    : [];
  const takenVisits = new Set(live.map(visitKeyOf));

  const restorable = frozen.filter((r) => !takenVisits.has(visitKeyOf(r)));
  const rowsNotRestored = frozen.length - restorable.length;
  if (restorable.length) {
    // Raw driver insert: preserves the original _ids so a restore is byte-exact (the
    // snapshot.js:142-154 precedent). Mongoose would mint new ones.
    //
    // ordered:false AND an E11000 swallow, together: a revert that crashed part-way must be
    // retryable, and on retry the rows it already restored collide on _id. Ordered inserts abort
    // at the first collision and would leave everything after it permanently unrestored, behind a
    // revertedAt flag that never got set.
    try {
      await CanvassActivity.collection.insertMany(restorable, { ordered: false });
    } catch (e) {
      const onlyDuplicates =
        e?.code === 11000 || (e?.writeErrors || []).every((w) => w?.err?.code === 11000 || w?.code === 11000);
      if (!onlyDuplicates) throw e;
    }
  }

  // The answer side, same rule.
  const archived = await SurveyResponseArchive.find({ unknockRunId: run._id }).lean();
  let responsesNotRestored = 0;
  const promoted = [];
  const restoredVoterIds = [];
  if (archived.length) {
    const wanted = archived.map((d) => ({ voterId: d.voterId, passId: d.passId ?? null }));
    const taken = await SurveyResponse.find({ $or: wanted }, 'voterId passId').lean();
    const takenSlots = new Set(taken.map((r) => `${r.voterId}|${r.passId ?? 'null'}`));
    for (const doc of archived) {
      if (takenSlots.has(`${doc.voterId}|${doc.passId ?? 'null'}`)) {
        responsesNotRestored += 1;
        continue;
      }
      try {
        await SurveyResponse.create(snapshotFromArchive(doc));
        promoted.push(doc._id);
        restoredVoterIds.push(doc.voterId);
      } catch (e) {
        if (e?.code !== 11000) throw e;
        responsesNotRestored += 1;
      }
    }
    if (promoted.length) await SurveyResponseArchive.deleteMany({ _id: { $in: promoted } });
  }

  run.counts.rowsNotRestored = rowsNotRestored;
  run.counts.responsesNotRestored = responsesNotRestored;
  run.status = 'reverted';
  run.revertedAt = new Date();
  await run.save();

  await historyRow(campaign, byUserId, { swap: true });

  await settle({
    campaign,
    doorIds: frozen.map((r) => r.householdId),
    voterIds: restoredVoterIds,
  });

  const knockRows = restorable.filter((r) => KNOCK_ACTIONS.includes(r.actionType)).length;
  const opts = { orgId: campaign.organizationId };
  if (knockRows) await bumpLive('doorsKnocked', knockRows, opts);
  if (promoted.length) await bumpLive('surveyResponses', promoted.length, opts);

  return run;
}

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
  const run = await UnknockRun.findOne(
    { _id: { $in: runIds }, revertedAt: null, status: 'completed' },
    { _id: 1 }
  ).lean();
  return run ? run._id : null;
}
