import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { resolveStatus } from '../../utils/statusPrecedence.js';

// Shared door/voter status recomputation. Extracted from the mobile canvass
// write path so other callers (e.g. clearing a pass's knocks during a re-cut)
// recompute the exact same way.

// Chunk size shared by both batched recomputes below.
const STATUS_BATCH = 500;

// household.status = the "latest across all passes" convenience value, resolved
// with the sticky-completion precedence rule. Mutates the doc; caller saves.
export async function recomputeHouseholdStatus(household, campaignType) {
  const acts = await CanvassActivity.find(
    { householdId: household._id, actionType: { $ne: 'note_added' } },
    { actionType: 1, timestamp: 1 }
  ).lean();
  household.status = resolveStatus(campaignType, acts);
}

// "Ever surveyed" — recomputed from existence so deleting surveys corrects it.
// One exists + one updateOne PER VOTER: right for a door's worth of voters, far too slow for a
// bulk sweep — use recomputeSurveyStatusesBatched below for that.
export async function recomputeSurveyStatus(voterIds) {
  for (const vid of voterIds) {
    const exists = await SurveyResponse.exists({ voterId: vid });
    await Voter.updateOne({ _id: vid }, { $set: { surveyStatus: exists ? 'surveyed' : 'not_surveyed' } });
  }
}

// Same answer as the loop above, two round trips per CHUNK instead of two per voter. A
// survey-conversion run can touch tens of thousands of voters, where the per-voter version is
// ~100k round trips and becomes the whole job — the same bottleneck
// recomputeHouseholdStatusesBatched was written to kill one collection over.
//
// `updateMany` bumps Voter.updatedAt (the model declares timestamps and Mongoose honors them on
// updates unless told otherwise), which matters because GET /mobile/changes ships voters whose own
// updatedAt moved. That is the belt to the door-level braces — surveyConversion.int.test.js
// asserts it rather than assuming it.
export async function recomputeSurveyStatusesBatched(voterIds) {
  const ids = [...new Set(voterIds.map(String))];
  for (let i = 0; i < ids.length; i += STATUS_BATCH) {
    const chunk = ids.slice(i, i + STATUS_BATCH);
    const surveyed = await SurveyResponse.distinct('voterId', { voterId: { $in: chunk } });
    const surveyedSet = new Set(surveyed.map(String));
    const yes = chunk.filter((id) => surveyedSet.has(id));
    const no = chunk.filter((id) => !surveyedSet.has(id));
    if (yes.length) await Voter.updateMany({ _id: { $in: yes } }, { $set: { surveyStatus: 'surveyed' } });
    if (no.length) await Voter.updateMany({ _id: { $in: no } }, { $set: { surveyStatus: 'not_surveyed' } });
  }
}

// Bulk variant: load each household by id, recompute, and persist. Used after a
// knock wipe, where the affected set is just the households that had activity.
// One find + one save PER DOOR — fine for a re-cut, too slow for a 10k-door sweep;
// recomputeHouseholdStatusesBatched below is the same result in 2 round trips per chunk.
export async function recomputeHouseholdStatusesByIds(householdIds, campaignType) {
  for (const id of householdIds) {
    const hh = await Household.findById(id);
    if (!hh) continue;
    await recomputeHouseholdStatus(hh, campaignType);
    await hh.save();
  }
}

// Same result as the loop above, but two round trips per chunk instead of two per door:
// read every relevant activity for the chunk at once, resolve each door's status in memory
// (resolveStatus is pure), and persist with one bulkWrite. That is what makes a
// several-thousand-door reclassification finish inside a web request.
//
// `timestamps: true` on the bulkWrite is LOAD-BEARING, not tidiness: GET /mobile/changes finds
// changed doors with `updatedAt: { $gt: since }`, so a status write that doesn't bump updatedAt
// never reaches the phones and the pin keeps its old color until a full re-bootstrap.
// reclassifyOutcomes.int.test.js asserts updatedAt actually moves.
//
// Safe as a bulkWrite because Household declares no pre-save/validate hooks — the per-door
// version's `save()` had nothing to run beyond the timestamp this replaces.
export async function recomputeHouseholdStatusesBatched(householdIds, campaignType) {
  for (let i = 0; i < householdIds.length; i += STATUS_BATCH) {
    const ids = householdIds.slice(i, i + STATUS_BATCH);
    const acts = await CanvassActivity.find(
      { householdId: { $in: ids }, actionType: { $ne: 'note_added' } },
      { householdId: 1, actionType: 1, timestamp: 1 }
    ).lean();

    const byDoor = new Map();
    for (const a of acts) {
      const k = String(a.householdId);
      if (!byDoor.has(k)) byDoor.set(k, []);
      byDoor.get(k).push(a);
    }

    const ops = ids.map((id) => ({
      updateOne: {
        filter: { _id: id },
        // A door with no rows left resolves to 'unknocked' — resolveStatus's own answer for an
        // empty list, so an emptied door is corrected rather than frozen at its last status.
        update: { $set: { status: resolveStatus(campaignType, byDoor.get(String(id)) || []) } },
      },
    }));
    if (ops.length) await Household.bulkWrite(ops, { ordered: false, timestamps: true });
  }
}
