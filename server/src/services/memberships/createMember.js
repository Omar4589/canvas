import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { Campaign } from '../../models/Campaign.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { convergeIfDeleted } from '../users/deleteAccount.js';
import { phoneSchema, nameSchema, emailSchema, passwordSchema } from '../../utils/validators.js';

// Shared member-creation + validation used by the org Users admin (memberships.js)
// and the team-lead crew router (leadCrew.js). Keeping it in one place means a lead
// creating a canvasser goes through the exact same email-link / new-account rules
// as an admin does.

// A typed error the routes map to an HTTP status + code.
export class MemberError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'MemberError';
    this.status = status;
    this.code = code;
  }
}

// The user-identity fields shared by "add a member" bodies. Callers add the
// role/coordinator/managed-campaign fields that make sense for their surface.
// Validation (phone/name/email/password) is centralized in utils/validators.js.
export const memberIdentityShape = {
  email: emailSchema,
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  phone: phoneSchema,
  // OPTIONAL since the emailed set-password invite became the primary way in: blank means
  // createOrgMember generates a random throwaway nobody ever sees. '' (an empty form field)
  // is normalized to absent so leaving the box empty never trips the min-8 rule.
  password: z.preprocess((v) => (v === '' || v == null ? undefined : v), passwordSchema.optional()),
  // true = link an EXISTING global account by email; false = create a new one.
  linkExisting: z.boolean().optional().default(false),
};

// Answer "who, if anyone, does this email address belong to HERE?" for the campaign add flow.
//
// THE BOUNDARY IS THE ORG, and it is the whole point of this function. Inside the caller's own
// organization we name the person, because they are already the caller's colleague and the campaign
// Team page would show them anyway. Everything else — no account anywhere, an account belonging to
// another customer, an address released by a deleted account — collapses into ONE outcome,
// 'outside', carrying no name, no role, no account status, and no hint that an account exists.
// A campaign-scoped team lead may be the CLIENT's own manager (docs/ROLES.md), so any difference
// visible between those cases would be a cross-tenant disclosure. Callers MUST return `outcome` and
// `person` only — never `user`, which is the internal branch key for the write path.
//
// Timing: the membership query below runs whether or not an account exists (against an id that can't
// match when there is none), which narrows the difference between "no account" and "an account at
// another customer". What is left is accepted and named rather than papered over with an artificial
// delay; the response body is byte-identical, and the flow's real defence is the per-actor rate limit
// (middleware/crewResolveLimit.js). An AccessLog line is written only for Doorline staff under a
// support grant (middleware/accessLog.js), so it is no defence against a customer's own staff.
const NO_SUCH_USER = new mongoose.Types.ObjectId('000000000000000000000000');
export async function resolveEmailInOrg({ orgId, campaignId = null, email }) {
  const normalized = String(email || '').toLowerCase().trim();
  const user = normalized ? await User.findOne({ email: normalized }) : null;
  const membership = await Membership.findOne({ userId: user ? user._id : NO_SUCH_USER, organizationId: orgId });

  // No account, or an account that is nothing to do with this organization. One answer for all of
  // them. `user` rides along for the write path and must never reach the wire.
  if (!user || !membership) return { outcome: 'outside', email: normalized, user: user || null };

  const person = {
    userId: String(user._id),
    firstName: user.firstName,
    lastName: user.lastName,
    role: membership.role,
  };
  const onCampaign = campaignId
    ? !!(await CampaignAssignment.exists({ campaignId, userId: user._id }))
    : false;
  // Checked BEFORE role, so a switched-off admin or lead can never resolve to a plain claim and
  // leave a roster row for someone who cannot appear. It is checked before the roster too, so a
  // switched-off person already on this campaign reads as switched off; `onCampaign` tells the add
  // step to offer only Switch on.
  if (!membership.isActive) return { outcome: 'in-org-inactive', person, user, membership, onCampaign };
  return { outcome: onCampaign ? 'on-campaign' : 'in-org', person, user, membership, onCampaign };
}

// Find/link/create the user and create their membership in `orgId` with `role`.
// Throws MemberError on the same conditions the memberships route enforces.
// `mustChangePassword` forces a temp-password reset on first login (client provisioning);
// `billingAccess` seats a bill-payer admin. Both default off, so existing callers are
// unaffected. Returns { user, membership, restamp }.
//
// Joining an ORG carries no campaign and no crew — a crew only means something inside a campaign.
// Putting the person on a campaign, and moving their earlier doors there, is the caller's
// joinCampaignCrew (services/memberships/setCoordinator.js). That matters for linkExisting: removal
// from the org hard-deletes the Membership while the ledger rows survive, so an account linked back in
// can already have history here, which the join then moves to the crew it joins.
export async function createOrgMember({
  orgId,
  addedBy,
  data,
  role,
  mustChangePassword = false,
  billingAccess = false,
}) {
  const email = data.email.toLowerCase().trim();
  let user = await User.findOne({ email });

  if (data.linkExisting) {
    if (!user) {
      throw new MemberError(
        404,
        "No account exists with that email. Uncheck 'Existing user' to create a new one.",
        'EMAIL_NOT_FOUND'
      );
    }
    if (user.deletedAt) throw new MemberError(409, 'This account was deleted.', 'ACCOUNT_DELETED');
  } else if (user) {
    throw new MemberError(
      409,
      "An account with this email already exists. Check 'Existing user (by email)' to link them to this org instead.",
      'EMAIL_EXISTS_USE_LINK'
    );
  } else {
    if (!data.firstName || !data.lastName) {
      throw new MemberError(400, 'New user requires firstName and lastName.');
    }
    // No typed temp password → generate a strong random throwaway that NOBODY ever sees (not
    // returned, not logged, never emailed). The account's real way in is the emailed
    // set-password invite; the typed temp password survives purely as the manual fallback for
    // someone who can't reach their inbox. mustChangePassword still gates either way.
    const passwordHash = await User.hashPassword(
      data.password || crypto.randomBytes(18).toString('base64url')
    );
    user = await User.create({
      firstName: data.firstName,
      lastName: data.lastName,
      email,
      phone: data.phone || null,
      passwordHash,
      isActive: true,
      ...(mustChangePassword ? { mustChangePassword: true, tempPasswordSetAt: new Date() } : {}),
    });
  }

  const existing = await Membership.findOne({ userId: user._id, organizationId: orgId });
  if (existing) throw new MemberError(409, 'User already a member of this org', 'ALREADY_MEMBER');

  const membership = await Membership.create({
    userId: user._id,
    organizationId: orgId,
    role,
    isActive: true,
    addedBy,
    billingAccess: !!billingAccess,
  });
  // A link that raced a deletion of this account: the account is dead, so the new membership is left
  // the way the deletion leaves every other one (off, no billing) and the add is refused.
  if (await convergeIfDeleted({ userId: user._id, organizationId: orgId, membershipId: membership._id })) {
    throw new MemberError(409, 'This account was deleted.', 'ACCOUNT_DELETED');
  }

  return { user, membership, restamp: { activities: 0, surveys: 0, restampError: null } };
}

// Validate a coordinatorId for a membership in this org. A coordinator oversees a
// crew, so they must be an active admin OR lead in the same org, and not the member
// themselves. Returns { ok, value } where value is ObjectId|null (null = clear).
// raw === undefined → { ok, skip:true } (field not sent; leave unchanged).
export async function resolveCoordinatorId({ orgId, raw, memberUserId }) {
  if (raw === undefined) return { ok: true, skip: true };
  if (raw === null || raw === '') return { ok: true, value: null };
  if (!mongoose.isValidObjectId(raw)) return { ok: false, error: 'Invalid coordinatorId.' };
  if (memberUserId && String(raw) === String(memberUserId)) {
    return { ok: false, error: "A member can't be their own coordinator." };
  }
  const coord = await Membership.findOne({
    userId: raw,
    organizationId: orgId,
    role: { $in: ['admin', 'lead'] },
    isActive: true,
  });
  if (!coord) {
    return { ok: false, error: 'Coordinator must be an active admin or team lead in this organization.' };
  }
  return { ok: true, value: new mongoose.Types.ObjectId(String(raw)) };
}

// Validate the campaign grant set for a team lead: every id must be a campaign in
// this org. Returns { ok, value } where value is a deduped array of ObjectId.
// raw === undefined → { ok, skip:true } (leave grants unchanged).
export async function resolveManagedCampaigns({ orgId, raw }) {
  if (raw === undefined) return { ok: true, skip: true };
  if (raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'managedCampaignIds must be an array.' };
  const ids = [...new Set(raw.map((x) => String(x)))];
  for (const id of ids) {
    if (!mongoose.isValidObjectId(id)) return { ok: false, error: `Invalid campaignId: ${id}` };
  }
  const found = await Campaign.countDocuments({ _id: { $in: ids }, organizationId: orgId });
  if (found !== ids.length) {
    return { ok: false, error: 'One or more campaigns are not in this organization.' };
  }
  return { ok: true, value: ids.map((id) => new mongoose.Types.ObjectId(id)) };
}
