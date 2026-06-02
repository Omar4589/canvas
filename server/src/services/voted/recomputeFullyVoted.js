import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { VotedVoter } from '../../models/VotedVoter.js';

// Recompute Household.fullyVoted for the given households in a campaign:
// fullyVoted = the household has >=1 voter AND every one of them has a VotedVoter
// row for this campaign. Bulk + chunked. Called after a voted-import, an undo,
// and after a regular import adds voters to an existing household.
export async function recomputeFullyVoted(campaignId, householdIds) {
  const ids = [...new Set((householdIds || []).map((x) => String(x)))].filter(Boolean);
  if (!ids.length) return { updated: 0 };

  const voters = await Voter.find({ householdId: { $in: ids } }, { _id: 1, householdId: 1 }).lean();
  const votersByHh = new Map();
  for (const v of voters) {
    const k = String(v.householdId);
    const arr = votersByHh.get(k) || [];
    arr.push(String(v._id));
    votersByHh.set(k, arr);
  }

  const voted = await VotedVoter.find(
    { campaignId, voterId: { $in: voters.map((v) => v._id) } },
    { voterId: 1 }
  ).lean();
  const votedSet = new Set(voted.map((r) => String(r.voterId)));

  const ops = ids.map((id) => {
    const hhVoters = votersByHh.get(id) || [];
    const fully = hhVoters.length > 0 && hhVoters.every((vid) => votedSet.has(vid));
    return { updateOne: { filter: { _id: id }, update: { $set: { fullyVoted: fully } } } };
  });
  for (let i = 0; i < ops.length; i += 2000) {
    await Household.bulkWrite(ops.slice(i, i + 2000), { ordered: false });
  }
  return { updated: ops.length };
}
