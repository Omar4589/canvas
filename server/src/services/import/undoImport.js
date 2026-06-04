import mongoose from 'mongoose';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { recomputeHouseholdActive } from './recomputeHouseholdActive.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const CHUNK = 5000;

async function findInChunks(Model, field, values, projection, extraFilter = {}) {
  const out = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    const slice = values.slice(i, i + CHUNK);
    if (!slice.length) continue;
    out.push(...(await Model.find({ ...extraFilter, [field]: { $in: slice } }, projection).lean()));
  }
  return out;
}

// Which of `ids` currently appear as `field` in Model (batched) — i.e. are "in use".
async function presentIds(Model, field, ids) {
  const found = new Set();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK).map(oid);
    if (!slice.length) continue;
    for (const v of await Model.distinct(field, { [field]: { $in: slice } })) found.add(String(v));
  }
  return found;
}

/**
 * Undo a CSV import by deleting the records it INSERTED — but only those still
 * untouched. Never reverts updates to pre-existing records (re-housing/field changes),
 * never deletes anything claimed into an effort, cut into a book, canvassed, surveyed,
 * marked voted, or sharing a door with other voters. Conservative: it under-deletes
 * rather than over-deletes. Returns counts + aggregated skip reasons.
 */
export async function undoImport(importJob) {
  const campaignId = importJob.campaignId;
  const Vins = (importJob.insertedVoterIds || []).map(String);
  const Hins = (importJob.insertedHouseholdIds || []).map(String);
  const VinsSet = new Set(Vins);
  const empty = { doorsDeleted: 0, doorsSkipped: 0, votersDeleted: 0, votersSkipped: 0, skipReasons: {} };
  if (!Vins.length && !Hins.length) return empty;

  const skipReasons = {};
  const bump = (r) => { skipReasons[r] = (skipReasons[r] || 0) + 1; };

  // In-use inserted voters: voted / surveyed / canvassed.
  const voterInUse = new Set();
  for (const s of [
    await presentIds(VotedVoter, 'voterId', Vins),
    await presentIds(SurveyResponse, 'voterId', Vins),
    await presentIds(CanvassActivity, 'voterId', Vins),
  ]) for (const v of s) voterInUse.add(v);

  // In-use inserted households: by household-level downstream state.
  const actHh = await presentIds(CanvassActivity, 'householdId', Hins);
  const survHh = await presentIds(SurveyResponse, 'householdId', Hins);
  const votedHh = await presentIds(VotedVoter, 'householdId', Hins);

  // Current voters at the inserted households → flag any door that holds a "foreign"
  // voter (re-housed in, or from a later import) so we never gut a door we keep.
  const votersAtHins = await findInChunks(Voter, 'householdId', Hins.map(oid), { _id: 1, householdId: 1 });
  const hhWithForeignVoter = new Set();
  for (const v of votersAtHins) {
    if (!VinsSet.has(String(v._id))) hhWithForeignVoter.add(String(v.householdId));
  }

  // Decide which inserted households to keep vs delete.
  const hhDocs = await findInChunks(
    Household, '_id', Hins.map(oid), { _id: 1, effortId: 1, turfId: 1, status: 1, fullyVoted: 1 }, { campaignId }
  );
  const hhById = new Map(hhDocs.map((h) => [String(h._id), h]));
  const keptHh = new Set();
  for (const hid of Hins) {
    const h = hhById.get(hid);
    if (!h) continue; // already gone — neither kept nor deleted
    let reason = null;
    if (h.effortId) reason = 'claimed into an effort';
    else if (h.turfId) reason = 'cut into a book';
    else if (h.status && h.status !== 'unknocked') reason = 'already canvassed';
    else if (h.fullyVoted) reason = 'fully voted';
    else if (actHh.has(hid)) reason = 'already canvassed';
    else if (survHh.has(hid)) reason = 'surveyed';
    else if (votedHh.has(hid)) reason = 'has voted residents';
    else if (hhWithForeignVoter.has(hid)) reason = 'shares the door with other voters';
    if (reason) { keptHh.add(hid); bump(reason); }
  }
  const deletableHhSet = new Set(Hins.filter((h) => hhById.has(h) && !keptHh.has(h)));

  // Decide which inserted voters to delete: not in use, and not sitting in a KEPT door.
  const vinDocs = await findInChunks(Voter, '_id', Vins.map(oid), { _id: 1, householdId: 1 });
  const hhByVoter = new Map(vinDocs.map((v) => [String(v._id), v.householdId ? String(v.householdId) : null]));
  const deletableV = [];
  for (const vid of Vins) {
    if (!hhByVoter.has(vid)) continue; // already gone
    if (voterInUse.has(vid)) continue; // in use → keep
    const hh = hhByVoter.get(vid);
    if (hh && keptHh.has(hh)) continue; // don't partially gut a kept door
    deletableV.push(vid);
  }

  // Final re-validation immediately before deleting — shrink the check→delete window:
  // drop any voter that has since become in-use, or whose door has since become kept.
  const recheckInUse = new Set();
  for (const s of [
    await presentIds(VotedVoter, 'voterId', deletableV),
    await presentIds(SurveyResponse, 'voterId', deletableV),
    await presentIds(CanvassActivity, 'voterId', deletableV),
  ]) for (const v of s) recheckInUse.add(v);
  const curV = await findInChunks(Voter, '_id', deletableV.map(oid), { _id: 1, householdId: 1 });
  const curHhByVoter = new Map(curV.map((v) => [String(v._id), v.householdId ? String(v.householdId) : null]));
  const curHhIds = [...new Set(curV.map((v) => v.householdId).filter(Boolean).map(String))];
  const curHh = await findInChunks(
    Household, '_id', curHhIds.map(oid), { _id: 1, effortId: 1, turfId: 1, status: 1, fullyVoted: 1 }, { campaignId }
  );
  const nowKept = new Set();
  for (const h of curHh) {
    if (h.effortId || h.turfId || (h.status && h.status !== 'unknocked') || h.fullyVoted) nowKept.add(String(h._id));
  }
  const finalV = deletableV.filter((vid) => {
    const hh = curHhByVoter.get(vid);
    return hh && !recheckInUse.has(vid) && !nowKept.has(hh);
  });

  // Delete the validated voters.
  let votersDeleted = 0;
  for (let i = 0; i < finalV.length; i += CHUNK) {
    const r = await Voter.deleteMany({ _id: { $in: finalV.slice(i, i + CHUNK).map(oid) } });
    votersDeleted += r.deletedCount || 0;
  }

  // Delete only inserted households that are now EMPTY and STILL pristine. The field
  // guards live in the delete filter, so a door claimed / cut / canvassed / voted in the
  // meantime is left intact — atomic at the DB, no transaction needed.
  const deletableHh = [...deletableHhSet];
  const remaining = await findInChunks(Voter, 'householdId', deletableHh.map(oid), { householdId: 1 });
  const stillOccupied = new Set(remaining.map((v) => String(v.householdId)));
  const emptyHh = deletableHh.filter((h) => !stillOccupied.has(h));
  let doorsDeleted = 0;
  for (let i = 0; i < emptyHh.length; i += CHUNK) {
    const r = await Household.deleteMany({
      _id: { $in: emptyHh.slice(i, i + CHUNK).map(oid) },
      campaignId,
      effortId: null,
      turfId: null,
      status: 'unknocked',
      fullyVoted: { $ne: true },
    });
    doorsDeleted += r.deletedCount || 0;
  }

  // Existing doors that lost a net-new voter may now be empty → re-check isActive.
  const affected = new Set();
  for (const vid of finalV) {
    const hh = curHhByVoter.get(vid);
    if (hh && !deletableHhSet.has(hh)) affected.add(hh);
  }
  if (affected.size) await recomputeHouseholdActive(campaignId, [...affected]);

  return {
    doorsDeleted,
    doorsSkipped: hhDocs.length - doorsDeleted,
    votersDeleted,
    votersSkipped: vinDocs.length - votersDeleted,
    skipReasons,
  };
}
