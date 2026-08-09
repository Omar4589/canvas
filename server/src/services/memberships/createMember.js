import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { Campaign } from '../../models/Campaign.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { CoordinatorChange } from '../../models/CoordinatorChange.js';
import { restampLedgerCoordinator } from './restampCoordinator.js';
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
// Timing: a never-seen address costs one indexed lookup less than a taken one. That residual is
// accepted and named rather than papered over with an artificial delay; the response body is
// byte-identical, and the flow's real defences are the per-actor rate limit and the audit line the
// route writes whenever a person is named.
export async function resolveEmailInOrg({ orgId, campaignId = null, email }) {
  const normalized = String(email || '').toLowerCase().trim();
  const user = normalized ? await User.findOne({ email: normalized }) : null;
  const membership = user
    ? await Membership.findOne({ userId: user._id, organizationId: orgId })
    : null;

  // No account, or an account that is nothing to do with this organization. One answer for all of
  // them. `user` rides along for the write path and must never reach the wire.
  if (!user || !membership) return { outcome: 'outside', email: normalized, user: user || null };

  const person = {
    userId: String(user._id),
    firstName: user.firstName,
    lastName: user.lastName,
    role: membership.role,
  };
  // Checked BEFORE role, so a switched-off admin or lead can never resolve to a plain claim and
  // leave a roster row for someone who cannot appear.
  if (!membership.isActive) return { outcome: 'in-org-inactive', person, user, membership };

  const onCampaign = campaignId
    ? await CampaignAssignment.exists({ campaignId, userId: user._id })
    : null;
  return { outcome: onCampaign ? 'on-campaign' : 'in-org', person, user, membership };
}

// Move this person's ledger history in ONE campaign onto the crew they are joining with, and record
// the move. Shared by every door onto a campaign roster — create, link, and claim — so a returning
// canvasser's history follows the same rule however they came back. See the long note in
// createOrgMember for why a join re-stamps at all.
export async function restampOnJoin({ orgId, campaignId, userId, coordinatorId = null, byUserId = null, source }) {
  let restamp = { activities: 0, surveys: 0, restampError: null };
  if (!campaignId) return restamp;
  try {
    const moved = await restampLedgerCoordinator({
      organizationId: orgId,
      userId,
      campaignId,
      coordinatorId: coordinatorId || null,
    });
    restamp = { ...moved, restampError: null };
  } catch (err) {
    restamp.restampError = err?.message || String(err);
  }
  if (restamp.activities || restamp.surveys || restamp.restampError) {
    await CoordinatorChange.create({
      organizationId: orgId,
      campaignId,
      userId,
      fromCoordinatorId: null,
      toCoordinatorId: coordinatorId || null,
      byUserId: byUserId || null,
      source,
      activitiesMoved: restamp.activities,
      surveysMoved: restamp.surveys,
      restampError: restamp.restampError,
    });
  }
  return restamp;
}

// Find/link/create the user and create their membership in `orgId` with `role`.
// Throws MemberError on the same conditions the memberships route enforces.
// `mustChangePassword` forces a temp-password reset on first login (client provisioning);
// `billingAccess` seats a bill-payer admin. Both default off, so existing callers are
// unaffected. Returns { user, membership, restamp } — see the re-stamp note below for why a
// CREATE can move ledger rows.
export async function createOrgMember({
  orgId,
  addedBy,
  data,
  role,
  // The campaign this person is being added to, when there is one. Only the lead's
  // create-a-canvasser path has one; adding somebody to the ORG alone does not, and carries no
  // crew — a crew only means something inside a campaign. Without it the ledger re-stamp below is
  // skipped entirely, because there is no campaign whose history this call has authority over.
  campaignId = null,
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

  // NOT a no-op for a brand-new member, and this is the easy thing to miss. Removal from the ORG
  // hard-deletes the Membership while the CanvassActivity/SurveyResponse rows survive, so
  // linkExisting can attach an account that already has ledger history in this org — stamped with
  // whatever team they were on when they left. Under the current-coordinator-owns-history rule
  // that history belongs to their new crew (or to No team, if they have none).
  // A genuinely new account simply matches zero rows.
  //
  // Scoped to the campaign they are being added to, because that is the only campaign whose crew
  // this call sets. History they have in OTHER campaigns keeps the team it was earned under — the
  // caller has no authority over those races, and silently moving them is the bug this whole
  // change exists to remove.
  const restamp = await restampOnJoin({
    orgId,
    campaignId,
    userId: user._id,
    coordinatorId,
    byUserId: addedBy,
    source: 'member_create',
  });

  return { user, membership, restamp };
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
