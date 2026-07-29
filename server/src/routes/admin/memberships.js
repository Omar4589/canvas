import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { Organization } from '../../models/Organization.js';
import { Campaign } from '../../models/Campaign.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { CampaignManager } from '../../models/CampaignManager.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { isOrgAdmin, managedCampaignIds } from '../../services/authz/campaignManagement.js';
import {
  createOrgMember,
  MemberError,
  memberIdentityShape,
  resolveManagedCampaigns,
} from '../../services/memberships/createMember.js';
import { restampSummary } from '../../services/memberships/setCoordinator.js';
import {
  isLastBillingAdmin,
  strandsBilling,
  LAST_BILLING_ADMIN_ERROR,
} from '../../services/memberships/billingGuards.js';
import { releaseAssignedWork } from '../../services/users/deleteAccount.js';
import { sendMail } from '../../services/mail/mailer.js';
import { inviteSetPassword, addedToOrg } from '../../services/mail/templates.js';
import { issuePasswordResetToken, INVITE_TOKEN_HOURS } from '../../services/auth/passwordReset.js';
import {
  resendInvite,
  loadResendUser,
  ResendInviteError,
} from '../../services/memberships/resendInvite.js';
import { refuseVendorStaffTarget } from '../../services/memberships/vendorGuards.js';
import { phoneSchema, nameSchema, emailSchema, passwordSchema as passwordField } from '../../utils/validators.js';

// Team leads reach this router too — READ scoped to their campaigns' rosters, and a narrow
// write set (temp password / deactivate / reactivate, CANVASSER targets only). Every other
// write stays admin-only via requireAdminRole below. Default-deny throughout: a lead with
// zero grants sees nobody and can touch nobody.
const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin', 'lead'));

// A support-grant holder is a VENDOR here — orgContext set req.supportGrant precisely because
// they have no membership. A grant now permits USER ADMINISTRATION, every write recorded by
// middleware/accessLog.js; the ONE refusal is a membership targeting a staff account. Rationale
// and rule live in services/memberships/vendorGuards.js — shared with leadCrew.js so the two
// routers cannot drift.
// The routes a lead may never touch (create, role/grants, delete, identity edits).
function requireAdminRole(req, res, next) {
  if (isOrgAdmin(req)) return next();
  return res.status(403).json({ error: 'Only an org admin can do this.', code: 'ADMIN_ONLY' });
}

// The users a LEAD may see: everyone rostered on a campaign they hold a CampaignManager
// grant for. Empty grant set → empty visibility (default-deny).
async function leadVisibleUserIds(req) {
  const campaignIds = await managedCampaignIds(req);
  if (!campaignIds.length) return new Set();
  const rows = await CampaignAssignment.find(
    { organizationId: req.activeOrg._id, campaignId: { $in: campaignIds } },
    'userId'
  ).lean();
  return new Set(rows.map((r) => String(r.userId)));
}

// May this LEAD manage (temp-password / deactivate / reactivate) the target account?
// Only CANVASSER accounts rostered on a campaign the lead manages — never a fellow lead,
// never an admin (that would be privilege escalation: a lead deactivating the admin who
// granted them access). Owner decision 2026-07-23.
async function leadMayManageTarget(req, userId) {
  if (!mongoose.isValidObjectId(userId)) return false;
  const target = await Membership.findOne(
    { userId, organizationId: req.activeOrg._id },
    'role'
  ).lean();
  if (!target || target.role !== 'canvasser') return false;
  const campaignIds = await managedCampaignIds(req);
  if (!campaignIds.length) return false;
  const shared = await CampaignAssignment.exists({
    organizationId: req.activeOrg._id,
    userId,
    campaignId: { $in: campaignIds },
  });
  return Boolean(shared);
}

// Read guard for the per-user drill routes (/crews, /campaigns, /stats, /recent-activity):
// a lead may look at anyone VISIBLE to them (any role, read-only); writes stay narrower.
async function leadMaySeeTarget(req, userId) {
  if (!mongoose.isValidObjectId(userId)) return false;
  const visible = await leadVisibleUserIds(req);
  return visible.has(String(userId));
}

const DOOR_ACTIONS = ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped'];


const addSchema = z.object({
  ...memberIdentityShape,
  role: z.enum(['admin', 'lead', 'canvasser']).default('canvasser'),
  // NO coordinatorId. A crew is per-campaign (models/CampaignAssignment.js), and this adds somebody
  // to the ORGANIZATION — there is no campaign here to be on a crew of. It is set on a campaign's
  // Team tab, where the confirmation can quote that campaign's door count. Absent from the schema
  // rather than accepted-and-ignored: a caller still sending it is working from a stale contract.
  // For role: 'lead' — the campaigns this lead may manage (CampaignManager grants).
  managedCampaignIds: z.array(z.string()).optional(),
});

const updateMembershipSchema = z.object({
  role: z.enum(['admin', 'lead', 'canvasser']).optional(),
  isActive: z.boolean().optional(),
  coordinatorId: z.string().nullable().optional(),
  managedCampaignIds: z.array(z.string()).optional(),
  // Grant/revoke the Billing surface. Only meaningful for admins; only a caller who
  // already has billing access (or a super admin) may change it (guarded in the handler).
  billingAccess: z.boolean().optional(),
});

const updateUserSchema = z.object({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  email: emailSchema.optional(),
  phone: phoneSchema,
});

const passwordSchema = z.object({ password: passwordField });

function activeOrgId(req) {
  return req.activeOrg?._id;
}

function ensureOrgScoped(req, res) {
  if (!activeOrgId(req)) {
    res.status(400).json({ error: 'Active organization required (X-Org-Id header)' });
    return false;
  }
  return true;
}


// Replace a lead's CampaignManager grants in this org with exactly `campaignIds`
// (an array of ObjectId already validated by resolveManagedCampaigns). Additive
// upserts keep existing grantedBy/grantedAt; anything not in the set is removed.
async function reconcileManagedCampaigns({ orgId, userId, grantedBy, campaignIds }) {
  await CampaignManager.deleteMany({
    userId,
    organizationId: orgId,
    campaignId: { $nin: campaignIds },
  });
  for (const campaignId of campaignIds) {
    await CampaignManager.updateOne(
      { userId, organizationId: orgId, campaignId },
      { $setOnInsert: { userId, organizationId: orgId, campaignId, grantedBy, grantedAt: new Date() } },
      { upsert: true }
    );
  }
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const memberships = await Membership.find({ organizationId: activeOrgId(req) })
      .populate({ path: 'userId' })
      .sort({ createdAt: -1 })
      .lean();
    let members = memberships.filter((m) => m.userId);
    // A lead's list is their campaigns' rosters, deduped — not the whole org.
    if (!isOrgAdmin(req)) {
      const visible = await leadVisibleUserIds(req);
      members = members.filter((m) => visible.has(String(m.userId._id)));
    }

    // How many active orgs each member belongs to GLOBALLY — so the UI can lock
    // the login-email field for multi-org users. We expose only a boolean, never
    // which other orgs they're in.
    const userIds = members.map((m) => m.userId._id);
    const counts = await Membership.aggregate([
      { $match: { userId: { $in: userIds }, isActive: true } },
      { $group: { _id: '$userId', count: { $sum: 1 } } },
    ]);
    const orgCount = new Map(counts.map((c) => [String(c._id), c.count]));

    // The campaigns each team lead is granted (CampaignManager), so the Users page
    // can show + edit a lead's scope without a per-row fetch.
    const grants = await CampaignManager.find({ organizationId: activeOrgId(req) })
      .select('userId campaignId')
      .lean();
    const managedByUser = new Map();
    for (const g of grants) {
      const k = String(g.userId);
      if (!managedByUser.has(k)) managedByUser.set(k, []);
      managedByUser.get(k).push(String(g.campaignId));
    }

    res.json({
      members: members.map((m) => ({
        membershipId: String(m._id),
        role: m.role,
        isActive: m.isActive,
        addedAt: m.createdAt,
        billingAccess: !!m.billingAccess,
        managedCampaignIds: managedByUser.get(String(m.userId._id)) || [],
        user: {
          id: String(m.userId._id),
          firstName: m.userId.firstName,
          lastName: m.userId.lastName,
          email: m.userId.email,
          phone: m.userId.phone,
          isSuperAdmin: !!m.userId.isSuperAdmin,
          isActive: m.userId.isActive,
          isMultiOrg: (orgCount.get(String(m.userId._id)) || 0) >= 2,
          lastLoginAt: m.userId.lastLoginAt,
          createdAt: m.userId.createdAt,
        },
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAdminRole, async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const data = addSchema.parse(req.body);
    // Vendor rule: a grant-holder may administer users, never mint a STAFF membership (see
    // the STAFF_TARGET_ERROR comment). Creates only know the email at this point.
    if (await refuseVendorStaffTarget(req, res, { email: data.email })) return;

    // Validate the grant set up front (fail before creating anything) for leads.
    let managed = [];
    if (data.role === 'lead') {
      const mres = await resolveManagedCampaigns({ orgId, raw: data.managedCampaignIds ?? [] });
      if (!mres.ok) return res.status(400).json({ error: mres.error });
      managed = mres.value;
    }

    let user;
    let membership;
    let restamp;
    try {
      ({ user, membership, restamp } = await createOrgMember({
        orgId,
        addedBy: req.user._id,
        data,
        role: data.role,
        // Every newly created account gets a temp password + forced change on first login.
        // Harmless when linking an existing account: createOrgMember only applies the flag on
        // the create-new branch, so a linked account keeps its own password untouched.
        mustChangePassword: true,
      }));
    } catch (err) {
      if (err instanceof MemberError) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      throw err;
    }

    if (data.role === 'lead' && managed.length) {
      await reconcileManagedCampaigns({
        orgId,
        userId: user._id,
        grantedBy: req.user._id,
        campaignIds: managed,
      });
    }

    // Notify the person we just added — best-effort, never awaited (a mail hiccup must not fail the
    // admin's add). A brand-new account gets a set-password invite; the admin-typed temp password stays
    // in the 201 response below as a manual fallback and never appears in the email. An existing account
    // linked into this org gets a no-credentials "you've been added" note.
    if (data.linkExisting) {
      sendMail({ to: user.email, ...addedToOrg({ firstName: user.firstName, orgName: req.activeOrg.name, role: data.role }), kind: 'addedToOrg', meta: { organizationId: req.activeOrg._id, organizationName: req.activeOrg.name, userId: user._id } });
    } else {
      const { url } = await issuePasswordResetToken(user._id, { hours: INVITE_TOKEN_HOURS });
      sendMail({ to: user.email, ...inviteSetPassword({ firstName: user.firstName, orgName: req.activeOrg.name, setPasswordUrl: url, role: data.role }), kind: 'inviteSetPassword', meta: { organizationId: req.activeOrg._id, organizationName: req.activeOrg.name, userId: user._id } });
    }

    res.status(201).json({
      membership: {
        membershipId: String(membership._id),
        role: membership.role,
        isActive: membership.isActive,
        addedAt: membership.createdAt,
        managedCampaignIds: managed.map((id) => String(id)),
        user: user.toSafeJSON(),
      },
      // Non-zero only when linkExisting attached an account that already had ledger history in
      // this org (org removal deletes the Membership but keeps the knocks). It is the only signal
      // the admin gets that the person they just re-added brought work with them.
      restamp: restampSummary({ changed: true, ...restamp }),
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Conflict' });
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Which crew this person is on, IN EACH CAMPAIGN they are rostered to. Read-only.
//
// The org Users page used to set one coordinator here, because a coordinator was one org-level
// fact. Crews are per-campaign now (models/CampaignAssignment.js), so a single value on a person's
// org profile cannot be true — somebody on two campaigns has two crews, and picking one to display
// would misreport the other. The page therefore shows the list and links out; the write lives on
// the campaign's Team tab, where its blast radius is one campaign and the confirmation can quote
// that campaign's door count.
router.get('/:userId/crews', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    if (!isOrgAdmin(req) && !(await leadMaySeeTarget(req, req.params.userId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const orgId = activeOrgId(req);
    const rows = await CampaignAssignment.find(
      { userId: req.params.userId, organizationId: orgId },
      'campaignId coordinatorId'
    ).lean();

    const campaignIds = [...new Set(rows.map((r) => String(r.campaignId)))];
    const coordIds = [...new Set(rows.map((r) => r.coordinatorId).filter(Boolean).map(String))];
    const [campaigns, coords] = await Promise.all([
      campaignIds.length ? Campaign.find({ _id: { $in: campaignIds } }, 'name isActive').lean() : [],
      coordIds.length ? User.find({ _id: { $in: coordIds } }, 'firstName lastName').lean() : [],
    ]);
    const campaignById = new Map(campaigns.map((c) => [String(c._id), c]));
    const nameById = new Map(
      coords.map((u) => [String(u._id), `${u.firstName || ''} ${u.lastName || ''}`.trim()])
    );

    res.json({
      crews: rows.map((r) => {
        const c = campaignById.get(String(r.campaignId));
        const coordinatorId = r.coordinatorId ? String(r.coordinatorId) : null;
        return {
          campaignId: String(r.campaignId),
          campaignName: c?.name || 'Unknown campaign',
          campaignIsActive: c?.isActive !== false,
          coordinatorId,
          // null = the "No crew" bucket for that campaign, which is a real answer.
          coordinatorName: coordinatorId ? nameById.get(coordinatorId) || 'Unknown' : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/:userId', requireAdminRole, async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return;
    const orgId = activeOrgId(req);
    const data = updateMembershipSchema.parse(req.body);
    // You can't strip your own org-admin (demote yourself to lead or canvasser) —
    // that would lock you out of org administration. Ask another admin.
    if (
      data.role && data.role !== 'admin' &&
      String(req.params.userId) === String(req.user._id) &&
      !req.user.isSuperAdmin
    ) {
      return res.status(400).json({
        error: "You can't change your own role. Ask another admin.",
      });
    }

    // Only a bill-payer admin (or super admin) can hand out billing access — otherwise a
    // non-billing admin could grant themselves the surface they're meant to be kept out of.
    if (data.billingAccess !== undefined && !req.user.isSuperAdmin && !req.activeMembership?.billingAccess) {
      return res.status(403).json({ error: 'Only a billing admin can change billing access.' });
    }

    const membership = await Membership.findOne({
      userId: req.params.userId,
      organizationId: orgId,
    });
    if (!membership) return res.status(404).json({ error: 'Membership not found' });

    // Any change that would strip this membership's billing standing — the flag itself, the
    // admin role it rides on, or the membership's active status — is refused on the last one.
    const stripsBilling =
      data.billingAccess === false ||
      (data.role !== undefined && data.role !== 'admin') ||
      data.isActive === false;
    if (stripsBilling && (await isLastBillingAdmin(membership))) {
      return res.status(409).json(LAST_BILLING_ADMIN_ERROR);
    }
    // Snapshot the billing-standing fields BEFORE the mutating save, so the post-write backstop
    // (below) can undo exactly this strip if it raced another to zero. Captured only when it could
    // matter — the target was a billing admin and the request strips it.
    const wasBillingAdmin =
      membership.billingAccess && membership.role === 'admin' && membership.isActive;
    const billingBefore = wasBillingAdmin
      ? { billingAccess: membership.billingAccess, role: membership.role, isActive: membership.isActive }
      : null;

    const nextRole = data.role || membership.role;
    // Validate the grant set before writing anything (only when the result is a lead).
    let managedResult = null;
    if (nextRole === 'lead' && data.managedCampaignIds !== undefined) {
      const mres = await resolveManagedCampaigns({ orgId, raw: data.managedCampaignIds });
      if (!mres.ok) return res.status(400).json({ error: mres.error });
      managedResult = mres.value;
    }

    // managedCampaignIds lives in CampaignManager, not on the membership doc. coordinatorId is
    // dropped outright: a crew is a per-campaign fact now, so there is nothing here to set. The
    // key is still destructured away so an older client that keeps sending it gets a clean no-op
    // rather than writing a field that no longer means anything.
    const { managedCampaignIds: _omitGrants, coordinatorId: _omitCoord, ...membershipUpdate } = data;
    Object.assign(membership, membershipUpdate);
    await membership.save();

    // Post-write backstop for the concurrency race (see isLastBillingAdmin/strandsBilling). Runs
    // BEFORE grant reconciliation so a revert leaves no half-applied side effects.
    if (stripsBilling && billingBefore && (await strandsBilling(orgId))) {
      membership.set(billingBefore);
      await membership.save();
      return res.status(409).json(LAST_BILLING_ADMIN_ERROR);
    }

    // Reconcile grants: leaving the lead role clears every grant; staying/becoming
    // a lead with an explicit set replaces it (an omitted set leaves grants as-is).
    if (nextRole !== 'lead') {
      await CampaignManager.deleteMany({ userId: req.params.userId, organizationId: orgId });
    } else if (managedResult !== null) {
      await reconcileManagedCampaigns({
        orgId,
        userId: membership.userId,
        grantedBy: req.user._id,
        campaignIds: managedResult,
      });
    }

    const finalGrants = await CampaignManager.find({ userId: req.params.userId, organizationId: orgId })
      .select('campaignId')
      .lean();
    res.json({
      membership: {
        ...membership.toObject(),
        managedCampaignIds: finalGrants.map((g) => String(g.campaignId)),
      },
    });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.delete('/:userId', requireAdminRole, async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return;
    if (
      String(req.params.userId) === String(req.user._id) &&
      !req.user.isSuperAdmin
    ) {
      return res.status(400).json({ error: "You can't remove yourself from this org." });
    }
    const orgId = activeOrgId(req);
    const target = await Membership.findOne({ userId: req.params.userId, organizationId: orgId });
    if (target && (await isLastBillingAdmin(target))) {
      return res.status(409).json(LAST_BILLING_ADMIN_ERROR);
    }
    const wasBillingAdmin =
      target && target.billingAccess && target.role === 'admin' && target.isActive;
    await Membership.deleteOne({ userId: req.params.userId, organizationId: orgId });
    // Post-write backstop for the concurrency race (see isLastBillingAdmin/strandsBilling). Re-count
    // BEFORE releaseAssignedWork, and re-insert the exact row (same _id) if this delete raced the
    // org to zero — releaseAssignedWork hasn't run yet, so nothing needs unwinding.
    if (wasBillingAdmin && (await strandsBilling(orgId))) {
      await Membership.create(target.toObject());
      return res.status(409).json(LAST_BILLING_ADMIN_ERROR);
    }
    // This used to drop CampaignAssignment + CampaignManager only, which left the removed
    // person still holding every TurfAssignment and EffortMember row they had — so their
    // books stayed "assigned" to somebody who was no longer in the org, those doors never
    // resurfaced as unassigned, and the effort readiness rollup still counted them as crew.
    // releaseAssignedWork is shared with account deletion so the two paths can't drift.
    const released = await releaseAssignedWork(req.params.userId, { organizationId: orgId });
    res.json({ ok: true, released });
  } catch (err) {
    next(err);
  }
});

router.patch('/:userId/user', requireAdminRole, async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return;
    const membership = await Membership.findOne({
      userId: req.params.userId,
      organizationId: activeOrgId(req),
    });
    if (!membership) return res.status(404).json({ error: 'Member not in this org' });

    const targetUser = await User.findById(req.params.userId);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    // A deleted account is terminal. Without this guard an admin could write a real name and
    // a routable email straight back onto the tombstone — un-deleting the PII the user asked
    // us to destroy — because this route only checks that a Membership exists in the org.
    if (targetUser.deletedAt) return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });

    const data = updateUserSchema.parse(req.body);
    if (data.email) data.email = data.email.toLowerCase();
    if (data.phone === '') data.phone = null;

    // The login email of a multi-org user is shared across every org they belong
    // to, so only the user themselves or a super-admin may change it. Name/phone
    // stay editable. (The admin UI also disables the field, but this is the real
    // guard against a tampered request.)
    if (data.email && data.email !== targetUser.email) {
      const isSelf = String(req.params.userId) === String(req.user._id);
      if (!req.user.isSuperAdmin && !isSelf) {
        const activeCount = await Membership.countDocuments({
          userId: req.params.userId,
          isActive: true,
        });
        if (activeCount >= 2) {
          return res.status(403).json({
            error:
              'This user belongs to multiple organizations; their login email can only be changed by the user or a super-admin.',
            code: 'MULTI_ORG_EMAIL_LOCKED',
          });
        }
      }
    }

    const user = await User.findByIdAndUpdate(req.params.userId, data, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: user.toSafeJSON() });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Email already exists' });
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.patch('/:userId/password', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return;
    // A lead may reset only a CANVASSER on a campaign they manage — never a fellow
    // lead or an admin.
    if (!isOrgAdmin(req) && !(await leadMayManageTarget(req, req.params.userId))) {
      return res.status(403).json({ error: 'You can only reset passwords for canvassers on your campaigns.' });
    }
    const membership = await Membership.findOne({
      userId: req.params.userId,
      organizationId: activeOrgId(req),
    });
    if (!membership) return res.status(404).json({ error: 'Member not in this org' });

    // Without this, "deleted" would be resurrectable: an admin re-issues a temp password and
    // the account is alive again. Apple: "only offering to temporarily deactivate or disable
    // an account is insufficient." Deletion has to be the one thing an admin cannot undo.
    const target = await User.findById(req.params.userId).select('deletedAt');
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.deletedAt) return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });

    // NOTE (item 14 — cross-org link-and-reset): passwords are per-USER, not per-org (one User row, one
    // passwordHash, shared across every org the person belongs to), so an admin of one org resetting a
    // multi-org member's password affects that person's login everywhere. A self-serve email reset NOW
    // EXISTS (POST /auth/forgot-password — a locked-out multi-org user can rescue themselves), which
    // removes the old "blocking would strand them" objection — but by owner decision the admin path
    // stays unrestricted: field reality is a canvasser at a door with a dead login and an email they
    // can't reach. If that trade ever flips, the guard is one MULTI_ORG_EMAIL_LOCKED-shaped step away
    // (see the email route above). The standing mitigation: the new password is TEMPORARY
    // (mustChangePassword forces a change at next login), so misuse is not silent — the legitimate
    // user is locked out visibly the moment their old password stops working. Flagged for counsel in
    // docs/PRIVACY_VERIFICATION.md (item 14, open by decision).
    const { password } = passwordSchema.parse(req.body);
    const passwordHash = await User.hashPassword(password);
    // This is a TEMPORARY password: the user is forced to choose a new one at
    // their next login, so an admin never holds a working key to the user's
    // other orgs. See passwordGate.js and POST /auth/change-password.
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { passwordHash, mustChangePassword: true, tempPasswordSetAt: new Date() },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: user.toSafeJSON() });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Re-send the set-password invite. Until this existed, an invite was sent ONCE, at account
// creation, and there was no second chance: the admin-typed temp password expires after
// TEMP_PASSWORD_TTL_HOURS (72), so a person who never signed in within three days — or who was
// created before invite emails existed at all — was simply stranded. Their only escape was
// self-serve /auth/forgot-password, which requires telling them to go and do it.
//
// This re-mints the SAME 72h invite token and re-sends the SAME template the create path uses,
// so there is one invite experience rather than two that can drift.
router.post('/:userId/resend-invite', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return;
    // Same boundary as the temp-password reset: a lead may act only on a CANVASSER rostered to a
    // campaign they manage. Re-sending an invite is strictly LESS powerful than setting someone's
    // password, which leads can already do, so refusing it here would be inconsistent.
    // isOrgAdmin covers org admins AND super admins.
    if (!isOrgAdmin(req) && !(await leadMayManageTarget(req, req.params.userId))) {
      return res
        .status(403)
        .json({ error: 'You can only resend invites for canvassers on your campaigns.' });
    }

    const membership = await Membership.findOne({
      userId: req.params.userId,
      organizationId: activeOrgId(req),
    }).lean();
    if (!membership) return res.status(404).json({ error: 'Member not in this org' });

    const user = await loadResendUser(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // The send itself lives in services/memberships/resendInvite.js, shared with the staff route
    // (POST /super-admin/users/:userId/resend-invite) so the two can never drift.
    const result = await resendInvite({ user, membership, org: req.activeOrg });
    res.json(result);
  } catch (err) {
    if (err instanceof ResendInviteError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    next(err);
  }
});

router.patch('/:userId/deactivate', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return;
    // Same lead boundary as /password. The write is still org-wide by design (Membership
    // has no campaignId) — the disclosure lives in the leadCrew variant's alsoAffects.
    if (!isOrgAdmin(req) && !(await leadMayManageTarget(req, req.params.userId))) {
      return res.status(403).json({ error: 'You can only deactivate canvassers on your campaigns.' });
    }
    const existing = await Membership.findOne({ userId: req.params.userId, organizationId: activeOrgId(req) });
    if (!existing) return res.status(404).json({ error: 'Membership not found' });
    if (await isLastBillingAdmin(existing)) {
      return res.status(409).json(LAST_BILLING_ADMIN_ERROR);
    }
    const wasBillingAdmin = existing.billingAccess && existing.role === 'admin' && existing.isActive;
    const membership = await Membership.findOneAndUpdate(
      { userId: req.params.userId, organizationId: activeOrgId(req) },
      { isActive: false },
      { new: true }
    );
    if (!membership) return res.status(404).json({ error: 'Membership not found' });
    // Post-write backstop for the concurrency race (see isLastBillingAdmin/strandsBilling).
    if (wasBillingAdmin && (await strandsBilling(activeOrgId(req)))) {
      await Membership.updateOne({ _id: existing._id }, { isActive: true });
      return res.status(409).json(LAST_BILLING_ADMIN_ERROR);
    }
    res.json({ membership });
  } catch (err) {
    next(err);
  }
});

router.patch('/:userId/reactivate', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return;
    if (!isOrgAdmin(req) && !(await leadMayManageTarget(req, req.params.userId))) {
      return res.status(403).json({ error: 'You can only reactivate canvassers on your campaigns.' });
    }
    // Reactivating a deleted user's membership would put a tombstone back on the roster and
    // back into the team headcount. The login stays shut either way (auth gates on
    // deletedAt), but the org should never see them offered as assignable again.
    const target = await User.findById(req.params.userId).select('deletedAt');
    if (target?.deletedAt) {
      return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });
    }
    const membership = await Membership.findOneAndUpdate(
      { userId: req.params.userId, organizationId: activeOrgId(req) },
      { isActive: true },
      { new: true }
    );
    if (!membership) return res.status(404).json({ error: 'Membership not found' });
    res.json({ membership });
  } catch (err) {
    next(err);
  }
});

// Which campaigns this user is on the roster for (drives the mobile profile "Campaigns"
// section — assign a canvasser to campaigns from their own page). Read-only.
router.get('/:userId/campaigns', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (!isOrgAdmin(req) && !(await leadMaySeeTarget(req, req.params.userId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const rows = await CampaignAssignment.find(
      { userId: req.params.userId, organizationId: activeOrgId(req) },
      { campaignId: 1 }
    ).lean();
    res.json({ campaignIds: rows.map((r) => String(r.campaignId)) });
  } catch (err) {
    next(err);
  }
});

router.get('/:userId/stats', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (!isOrgAdmin(req) && !(await leadMaySeeTarget(req, req.params.userId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const orgId = activeOrgId(req);
    const userId = new mongoose.Types.ObjectId(req.params.userId);
    // Day-bucket in the ORG's timezone (this stat spans the user's activity across all
    // campaigns, so no single campaign tz applies) — not the viewer's device tz, so the
    // per-day chart matches the dashboard and reads the same for every admin.
    const org = await Organization.findById(orgId, { timeZone: 1 }).lean();
    const tz = org?.timeZone || 'America/New_York';

    let dayFormatter;
    try {
      dayFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      dayFormatter.format(new Date());
    } catch {
      return res.status(400).json({ error: 'Invalid tz' });
    }
    const dayStr = (date) => dayFormatter.format(date);

    const [activities, surveysSubmitted] = await Promise.all([
      CanvassActivity.find({
        userId,
        organizationId: orgId,
        actionType: { $in: [...DOOR_ACTIONS, 'restricted'] },
        via: { $ne: 'bulk' }, // admin bulk marks aren't this user's field work
      })
        .sort({ timestamp: 1 })
        .select('timestamp location actionType campaignId')
        .lean(),
      SurveyResponse.countDocuments({ userId, organizationId: orgId }),
    ]);

    let doorsKnocked = 0;
    let restricted = 0;
    let litDropped = 0;
    let lastActivityAt = null;
    const campaignSet = new Set();
    const distanceByDay = new Map();

    for (const a of activities) {
      // Restricted counts toward the campaign set / last-activity / travel, but not doorsKnocked.
      if (a.actionType === 'restricted') restricted++;
      else doorsKnocked++;
      if (a.actionType === 'lit_dropped') litDropped++;
      if (a.campaignId) campaignSet.add(String(a.campaignId));
      lastActivityAt = a.timestamp;

      const d = dayStr(a.timestamp);
      let bucket = distanceByDay.get(d);
      if (!bucket) {
        bucket = { prev: null, total: 0 };
        distanceByDay.set(d, bucket);
      }
      if (a.location && bucket.prev) {
        bucket.total += haversineMeters(
          bucket.prev.lat,
          bucket.prev.lng,
          a.location.lat,
          a.location.lng
        );
      }
      if (a.location) bucket.prev = a.location;
    }

    let distanceMeters = 0;
    for (const b of distanceByDay.values()) distanceMeters += b.total;

    res.json({
      doorsKnocked,
      restricted,
      surveysSubmitted,
      litDropped,
      distanceMeters: Math.round(distanceMeters),
      campaignsWorked: campaignSet.size,
      lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:userId/recent-activity', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (!isOrgAdmin(req) && !(await leadMaySeeTarget(req, req.params.userId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const orgId = activeOrgId(req);
    const userId = new mongoose.Types.ObjectId(req.params.userId);
    const requested = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), 100)
      : 20;

    const activities = await CanvassActivity.find({
      userId,
      organizationId: orgId,
      actionType: { $in: [...DOOR_ACTIONS, 'restricted'] },
    })
      .sort({ timestamp: -1 })
      .limit(limit)
      .populate('householdId', 'addressLine1 city state zipCode')
      .populate('campaignId', 'name')
      .lean();

    res.json({
      activities: activities.map((a) => ({
        id: String(a._id),
        actionType: a.actionType,
        timestamp: a.timestamp.toISOString(),
        household: a.householdId
          ? {
              id: String(a.householdId._id),
              addressLine1: a.householdId.addressLine1,
              city: a.householdId.city,
              state: a.householdId.state,
              zipCode: a.householdId.zipCode,
            }
          : null,
        campaign: a.campaignId
          ? { id: String(a.campaignId._id), name: a.campaignId.name }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
