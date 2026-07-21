import { Membership } from '../../models/Membership.js';

// An org must never lose its LAST billing admin through a console action: the billing-grade
// notices — support-access grants and the wind-down/dormancy DELETION WARNINGS — go only to
// billingAccess admins (services/mail/recipients.js), so an org with none has nobody to warn
// before its data is deleted. These guard every console door that could reach zero: toggling
// billing access off, demoting the role, deactivating or removing the membership — on the org
// Users admin AND on the campaign crew panel, which is why they live here rather than inside
// either router. Account deletion blocks on the same invariant (services/users/deleteAccount.js).
//
// No super-admin bypass on purpose — hand billing access to another admin first, then proceed.
//
// TWO LAYERS, because the check-and-write isn't atomic (no Mongo transaction — the deploy runs a
// standalone-friendly setup and the codebase uses none): isLastBillingAdmin is the cheap PRE-write
// gate that catches the ordinary single-admin case without touching anything; strandsBilling is the
// POST-write backstop for the concurrency race the pre-write count can't see. With exactly two
// billing admins, two simultaneous strips each observe the OTHER as sufficient and both pass the
// pre-write gate — so after each write we re-count and undo the one that raced the org to zero.
// The undo can over-fire (both revert, both 409) but can never STRAND: the org keeps a billing
// admin no matter the interleaving, and a retry succeeds once the dust settles.
//
// ⚠️ THE COMPENSATING REVERT IS NOT SHARED, AND CANNOT BE. Each caller undoes its OWN write, and the
// three writes have three different shapes: a field-snapshot restore (PATCH /:userId), a re-insert
// of a deleted document with its original _id (DELETE /:userId), and a plain flag flip
// (deactivate). Only the caller knows what it did. Call strandsBilling after your write and undo it
// yourself — do not look for a revert() to import.
//
// ⚠️ AND THE PRE-WRITE GATE IS ONLY AS GOOD AS THE WRITE IT GUARDS. isLastBillingAdmin short-circuits
// to false for anyone who is not an active billing ADMIN, so a caller that reads a membership,
// decides it is an ordinary canvasser, and then writes without re-asserting that in the update
// filter has a race: a concurrent promotion to {role:'admin', billingAccess:true} lands in between,
// and BOTH layers were computed against the stale snapshot. Put the role condition in the update
// filter itself (see routes/admin/leadCrew.js's deactivate) so the write cannot land on a doc that
// stopped matching.

export async function isLastBillingAdmin(membership) {
  if (!membership?.billingAccess || membership.role !== 'admin' || !membership.isActive) return false;
  const others = await Membership.countDocuments({
    organizationId: membership.organizationId,
    userId: { $ne: membership.userId },
    role: 'admin',
    isActive: true,
    billingAccess: true,
  });
  return others === 0;
}

// Post-write backstop: true when the org now has ZERO active billing admins. Counts ALL of them
// (not "others") because the just-written doc already reflects the strip. Only worth calling after
// a write that actually stripped a billing admin — an ordinary member edit can't reach zero.
export async function strandsBilling(organizationId) {
  const remaining = await Membership.countDocuments({
    organizationId,
    role: 'admin',
    isActive: true,
    billingAccess: true,
  });
  return remaining === 0;
}

// Would removing THIS person leave the org with no billing admin? The same question
// isLastBillingAdmin asks, for callers that collect blockers rather than throwing a 409
// (services/users/deleteAccount.js). Shares the count so the two cannot drift into disagreeing
// about who is last.
export async function wouldStrandBilling({ organizationId, userId }) {
  const others = await Membership.countDocuments({
    organizationId,
    userId: { $ne: userId },
    role: 'admin',
    isActive: true,
    billingAccess: true,
  });
  return others === 0;
}

export const LAST_BILLING_ADMIN_ERROR = {
  error:
    'This is the only admin with billing access — the one who receives billing and account notices. ' +
    'Give billing access to another admin first.',
  code: 'LAST_BILLING_ADMIN',
};
