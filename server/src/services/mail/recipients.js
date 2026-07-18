import { Membership } from '../../models/Membership.js';
import { User } from '../../models/User.js';
import { Subscription } from '../../models/Subscription.js';

// Who to email about an ORG-level event (billing, wind-down, dormancy). A cascade, most-specific
// first, so a routine notice reaches the bill-payers and a last-resort notice still reaches someone:
//   1) active admins WITH billingAccess (the bill-payers) — their live users' emails
//   2) if none, ALL active admins' emails
//   3) if none, the Subscription.billingContact.email on file
// May return [] (an org with no reachable human) — the caller decides what an empty list means.
// Deduped, lowercased.
//
// The Membership → User two-step mirrors campaignRoster.js (activeMemberIdSet): Membership carries the
// userId, then a second query resolves the User account, which must be active AND not soft-deleted — a
// membership row can outlive a deactivated/deleted user.
export async function orgNotifyEmails(organizationId) {
  const emailsFor = async (memberships) => {
    const userIds = memberships.map((m) => m.userId);
    if (!userIds.length) return [];
    const users = await User.find({
      _id: { $in: userIds },
      isActive: true,
      deletedAt: null,
    }).select('email').lean();
    return users.map((u) => u.email).filter(Boolean);
  };

  const admins = await Membership.find({
    organizationId,
    role: 'admin',
    isActive: true,
  }).select('userId billingAccess').lean();

  // 1) bill-payers, 2) all active admins, 3) the billing contact of record.
  let emails = await emailsFor(admins.filter((m) => m.billingAccess));
  if (!emails.length) emails = await emailsFor(admins);
  if (!emails.length) {
    const sub = await Subscription.findOne({ organizationId }).select('billingContact').lean();
    const contact = sub?.billingContact?.email;
    if (contact) emails = [contact];
  }

  return [...new Set(emails.map((e) => String(e).toLowerCase().trim()).filter(Boolean))];
}
