import mongoose from 'mongoose';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

// Recompute Household.isActive for the given households in a campaign:
// a door with >=1 voter is active; a door emptied of all voters is deactivated so it
// stops showing up as a phantom door (every door-pool query already filters isActive).
// Symmetric: a previously-emptied door that gets a voter again is reactivated.
// Scope the ids to the set actually touched by an import so unrelated doors are untouched.
// Returns { deactivated, reactivated } (true active↔inactive transitions, for the audit).
export async function recomputeHouseholdActive(campaignId, householdIds) {
  const ids = [...new Set((householdIds || []).map((x) => String(x)))].filter(Boolean);
  if (!ids.length) return { deactivated: 0, reactivated: 0 };

  const households = await Household.find(
    { _id: { $in: ids }, campaignId },
    { _id: 1, isActive: 1 }
  ).lean();
  if (!households.length) return { deactivated: 0, reactivated: 0 };
  const scopedIds = households.map((h) => String(h._id));
  const wasActive = new Map(households.map((h) => [String(h._id), h.isActive !== false]));

  const counts = await Voter.aggregate([
    { $match: { householdId: { $in: scopedIds.map(oid) } } },
    { $group: { _id: '$householdId', n: { $sum: 1 } } },
  ]);
  const countByHh = new Map(counts.map((c) => [String(c._id), c.n]));

  const ops = [];
  let deactivated = 0;
  let reactivated = 0;
  for (const id of scopedIds) {
    const hasVoters = (countByHh.get(id) || 0) > 0;
    const active = wasActive.get(id);
    if (!hasVoters && active) {
      ops.push({ updateOne: { filter: { _id: id }, update: { $set: { isActive: false } } } });
      deactivated += 1;
    } else if (hasVoters && !active) {
      ops.push({ updateOne: { filter: { _id: id }, update: { $set: { isActive: true } } } });
      reactivated += 1;
    }
  }
  for (let i = 0; i < ops.length; i += 2000) {
    await Household.bulkWrite(ops.slice(i, i + 2000), { ordered: false });
  }
  return { deactivated, reactivated };
}
