import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';

// Who a canvasser IS, for a report that already knows what they DID.
//
// Every per-canvasser report is ledger-first: it aggregates CanvassActivity, and the row set is
// whoever knocked. This helper only decorates those rows with a name and a standing. It must
// NEVER filter — a departed canvasser's work stays in every total and on the invoice, so their
// row has to survive here even if their account is gone entirely.
//
// The standing is genuinely a composite, and the two flags behind it mean different things:
//
//   Membership.isActive  — what the admin "Deactivate" button writes. Per-org, reversible.
//   User.isActive        — written by NOTHING except terminal account deletion, which also
//                          sets deletedAt and scrubs the name to "Deleted user".
//
// Reports used to return User.isActive and label it "active", which in any real database just
// means "not deleted" — it never went false for someone an admin had deactivated. So the
// Inactive badge never appeared for the people it was meant for, and the mobile "hide inactive"
// switch hid the wrong set. `status` is the honest answer; `isActive` is kept as the boolean
// shorthand for it so existing consumers keep working, but now it tells the truth.
//
//   'active'      — on the team and able to log in
//   'deactivated' — membership exists but was switched off (reversible)
//   'removed'     — no membership row at all (removal from the org hard-deletes it)
//   'deleted'     — the account was deleted; the User row survives only to anchor the ledger
export function canvasserStanding(user, membership) {
  if (!user || user.deletedAt) return 'deleted';
  if (!membership) return 'removed';
  if (!membership.isActive || !user.isActive) return 'deactivated';
  return 'active';
}

// userIds -> Map(id -> { firstName, lastName, email, phone, status, isActive }).
// A user id with no User doc still gets an entry, so a caller mapping over the LEDGER's ids can
// always resolve one and never has to drop a row.
export async function hydrateCanvassers(userIds, orgId, { fields = '' } = {}) {
  const ids = [...new Set((userIds || []).map(String))];
  const out = new Map();
  if (!ids.length) return out;

  const select = `firstName lastName email isActive deletedAt${fields ? ` ${fields}` : ''}`;
  const [users, memberships] = await Promise.all([
    User.find({ _id: { $in: ids } }, select).lean(),
    Membership.find({ userId: { $in: ids }, organizationId: orgId }, 'userId isActive').lean(),
  ]);
  const mById = new Map(memberships.map((m) => [String(m.userId), m]));

  for (const id of ids) {
    const u = users.find((x) => String(x._id) === id) || null;
    const status = canvasserStanding(u, mById.get(id));
    out.set(id, {
      firstName: u?.firstName || '',
      lastName: u?.lastName || '',
      email: u?.email || '',
      phone: u?.phone || null,
      status,
      isActive: status === 'active',
    });
  }
  return out;
}
