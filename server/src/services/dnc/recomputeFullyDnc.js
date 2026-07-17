import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';

// Recompute Household.fullyDnc for the given households: fullyDnc = the household has >=1 voter
// AND every one of them is flagged do-not-contact. Bulk + chunked. Called after a flag set/clear,
// a DNC list upload/undo, and after a regular import adds voters to an existing household.
//
// One deliberate divergence from its clone source (recomputeFullyVoted): NO campaignId parameter.
// DNC lives on the org-wide Voter doc, not in a campaign-scoped collection, so households from
// ANY campaign of the org recompute correctly in one call — callers just pass affected ids.
//
// The ≥1-voter guard matters more here than for fullyVoted: lit_drop campaigns support
// voter-less (address-only) doors, and "every voter is flagged" must never be vacuously true.
//
// The $set is UNCONDITIONAL for every listed household, even when the value didn't change.
// That is load-bearing: Mongoose 8 auto-applies schema timestamps to bulkWrite updateOnes, so
// every touched door's updatedAt bumps — and the mobile /changes delta keys on updatedAt, then
// re-sends ALL voters of each changed household. The bump is how an already-bootstrapped phone
// learns about a voter-level flag flip at a mixed door whose fullyDnc did NOT change. Never
// "optimize" this to skip unchanged docs, add `timestamps: false`, or drop to the raw driver —
// any of those silently strands phones on stale flags until a full re-bootstrap.
export async function recomputeFullyDnc(householdIds) {
  const ids = [...new Set((householdIds || []).map((x) => String(x)))].filter(Boolean);
  if (!ids.length) return { updated: 0 };

  const voters = await Voter.find(
    { householdId: { $in: ids } },
    { _id: 1, householdId: 1, 'doNotContact.flagged': 1 }
  ).lean();
  const votersByHh = new Map();
  for (const v of voters) {
    const k = String(v.householdId);
    const arr = votersByHh.get(k) || [];
    arr.push(v.doNotContact?.flagged === true);
    votersByHh.set(k, arr);
  }

  const ops = ids.map((id) => {
    const flags = votersByHh.get(id) || [];
    const fully = flags.length > 0 && flags.every(Boolean);
    return { updateOne: { filter: { _id: id }, update: { $set: { fullyDnc: fully } } } };
  });
  for (let i = 0; i < ops.length; i += 2000) {
    await Household.bulkWrite(ops.slice(i, i + 2000), { ordered: false });
  }
  return { updated: ops.length };
}
