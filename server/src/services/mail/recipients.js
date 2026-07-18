import { Membership } from '../../models/Membership.js';
import { User } from '../../models/User.js';
import { Subscription } from '../../models/Subscription.js';

// Who to email about an ORG-level event (support-access grants, wind-down and dormancy deletion
// warnings). BILLING IDENTITIES ONLY — owner decision 2026-07-18: these notices go to the
// bill-payers, never to every admin of the org:
//   1) active admins WITH billingAccess (the bill-payers) — their live users' emails
//   2) if none, the Subscription.billingContact.email on file
// There is deliberately NO "all active admins" fallback. May return [] (an org with no billing
// identity at all) — the caller decides what an empty list means; for the deletion warnings
// that is the loud zero-recipient stamp in services/retention/triggers.js. In practice every
// provisioned org starts with a billing identity: the first admin is created with
// billingAccess: true (routes/superAdmin/organizations.js).
//
// The Membership → User two-step mirrors campaignRoster.js (activeMemberIdSet): Membership carries
// the userId, then a second query resolves the User account, which must be active AND not
// soft-deleted — a membership row can outlive a deactivated/deleted user.
export async function billingNotifyEmails(organizationId) {
  const admins = await Membership.find({
    organizationId,
    role: 'admin',
    isActive: true,
    billingAccess: true,
  }).select('userId').lean();

  let emails = [];
  if (admins.length) {
    const users = await User.find({
      _id: { $in: admins.map((m) => m.userId) },
      isActive: true,
      deletedAt: null,
    }).select('email').lean();
    emails = users.map((u) => u.email).filter(Boolean);
  }
  if (!emails.length) {
    const sub = await Subscription.findOne({ organizationId }).select('billingContact').lean();
    const contact = sub?.billingContact?.email;
    if (contact) emails = [contact];
  }

  return [...new Set(emails.map((e) => String(e).toLowerCase().trim()).filter(Boolean))];
}
