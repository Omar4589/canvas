import mongoose from 'mongoose';
import { z } from 'zod';
import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { Campaign } from '../../models/Campaign.js';
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
  password: passwordSchema.optional(),
  // true = link an EXISTING global account by email; false = create a new one.
  linkExisting: z.boolean().optional().default(false),
};

// Find/link/create the user and create their membership in `orgId` with `role`.
// Throws MemberError on the same conditions the memberships route enforces.
// `mustChangePassword` forces a temp-password reset on first login (client provisioning);
// `billingAccess` seats a bill-payer admin. Both default off, so existing callers are
// unaffected. Returns { user, membership }.
export async function createOrgMember({
  orgId,
  addedBy,
  data,
  role,
  coordinatorId = null,
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
  } else if (user) {
    throw new MemberError(
      409,
      "An account with this email already exists. Check 'Existing user (by email)' to link them to this org instead.",
      'EMAIL_EXISTS_USE_LINK'
    );
  } else {
    if (!data.password || !data.firstName || !data.lastName) {
      throw new MemberError(400, 'New user requires firstName, lastName, and password.');
    }
    const passwordHash = await User.hashPassword(data.password);
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
    coordinatorId: coordinatorId || null,
    billingAccess: !!billingAccess,
  });
  return { user, membership };
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
