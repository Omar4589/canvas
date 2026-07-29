import { User } from '../../models/User.js';

// The vendor rule for user administration, in one place (memberships.js and leadCrew.js both
// enforce it — two copies of a security rule is how one of them rots).
//
// A support grant permits USER ADMINISTRATION in a customer org — create accounts, temp
// passwords, resend invites, roles, deactivate — and every such write is recorded by
// middleware/accessLog.js, exactly like the many grant-holder writes the other admin routers
// already allow. Support means being able to help, as yourself, on the record.
//
// ONE write stays refused: a membership whose TARGET is a super-admin account. That is the
// single write that ENDS the audit trail instead of being captured by it — a staff membership
// (their own account, or an alias with staff powers) flips orgContext to the member branch,
// req.supportGrant stops being set, and logging goes silent. This cannot make vendor access
// technically impossible — the vendor runs the database; the point is that the ordinary path
// stays the logged one, and any other path leaves evidence: the creation itself is logged, and
// the new member is visible in the customer's own Users list.
//
// The MEMBER path is untouched: a customer's admin adding a super admin to their org carries no
// supportGrant, so this never fires there. The customer can authorize staff membership; staff
// cannot self-authorize.
export const STAFF_TARGET_ERROR = {
  error:
    'Support access cannot create or modify a membership for a Doorline staff account — that would ' +
    'convert logged support access into unlogged member access. If this organization wants staff ' +
    'as a member, their own administrator can add them.',
  code: 'STAFF_SELF_MINT',
};

// Refuse a vendor write aimed at a staff account. `target` may be a user id or an email —
// creates only know the email; every other write knows the id. Returns true if it responded.
export async function refuseVendorStaffTarget(req, res, { userId, email } = {}) {
  if (!req.supportGrant) return false; // a member's write — the ordinary role guards apply
  const target = userId
    ? await User.findById(userId).select('isSuperAdmin').lean()
    : email
      ? await User.findOne({ email: String(email).toLowerCase() }).select('isSuperAdmin').lean()
      : null;
  if (target?.isSuperAdmin) {
    res.status(403).json(STAFF_TARGET_ERROR);
    return true;
  }
  return false;
}
