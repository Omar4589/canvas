import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { Organization } from '../../models/Organization.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { CampaignManager } from '../../models/CampaignManager.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import {
  createOrgMember,
  MemberError,
  memberIdentityShape,
  resolveCoordinatorId,
  resolveManagedCampaigns,
} from '../../services/memberships/createMember.js';
import { releaseAssignedWork } from '../../services/users/deleteAccount.js';
import { sendMail } from '../../services/mail/mailer.js';
import { inviteSetPassword, addedToOrg } from '../../services/mail/templates.js';
import { issuePasswordResetToken, INVITE_TOKEN_HOURS } from '../../services/auth/passwordReset.js';
import { phoneSchema, nameSchema, emailSchema, passwordSchema as passwordField } from '../../utils/validators.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));

// A support-grant holder is a VENDOR in this organization, not a member — orgContext set req.supportGrant
// precisely because they have no membership here. They may READ team data to do support, but they must
// not create accounts, change roles, grant billing, or reset passwords in a customer's org. That path is
// the membership self-mint escalation: requireOrgRole('admin') passes any super-admin unconditionally
// (auth.js), so without this a grant-holder could POST a Membership for THEMSELVES, at which point
// orgContext takes the member branch forever after and their access stops being logged. A grant buys
// read access to help; it does not buy the power to make yourself a permanent, unaudited member.
router.use((req, res, next) => {
  if (req.supportGrant && req.method !== 'GET') {
    return res.status(403).json({
      error:
        'Support access is read-only for team management. Creating or changing accounts, roles, or ' +
        'passwords must be done by an administrator who is a member of this organization.',
      code: 'VENDOR_READ_ONLY',
    });
  }
  next();
});

const DOOR_ACTIONS = ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped'];

const addSchema = z.object({
  ...memberIdentityShape,
  role: z.enum(['admin', 'lead', 'canvasser']).default('canvasser'),
  // Optional supervising admin/lead (in this org). Empty string / null = none.
  coordinatorId: z.string().nullable().optional(),
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
    const members = memberships.filter((m) => m.userId);

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
        coordinatorId: m.coordinatorId ? String(m.coordinatorId) : null,
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

router.post('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const data = addSchema.parse(req.body);

    const coordRes = await resolveCoordinatorId({ orgId, raw: data.coordinatorId, memberUserId: null });
    if (!coordRes.ok) return res.status(400).json({ error: coordRes.error });

    // Validate the grant set up front (fail before creating anything) for leads.
    let managed = [];
    if (data.role === 'lead') {
      const mres = await resolveManagedCampaigns({ orgId, raw: data.managedCampaignIds ?? [] });
      if (!mres.ok) return res.status(400).json({ error: mres.error });
      managed = mres.value;
    }

    let user;
    let membership;
    try {
      ({ user, membership } = await createOrgMember({
        orgId,
        addedBy: req.user._id,
        data,
        role: data.role,
        coordinatorId: coordRes.value || null,
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
      sendMail({ to: user.email, ...addedToOrg({ firstName: user.firstName, orgName: req.activeOrg.name }), kind: 'addedToOrg' });
    } else {
      const { url } = await issuePasswordResetToken(user._id, { hours: INVITE_TOKEN_HOURS });
      sendMail({ to: user.email, ...inviteSetPassword({ firstName: user.firstName, orgName: req.activeOrg.name, setPasswordUrl: url }), kind: 'inviteSetPassword' });
    }

    res.status(201).json({
      membership: {
        membershipId: String(membership._id),
        role: membership.role,
        isActive: membership.isActive,
        addedAt: membership.createdAt,
        coordinatorId: membership.coordinatorId ? String(membership.coordinatorId) : null,
        managedCampaignIds: managed.map((id) => String(id)),
        user: user.toSafeJSON(),
      },
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Conflict' });
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.patch('/:userId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
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

    if ('coordinatorId' in data) {
      const coordRes = await resolveCoordinatorId({
        orgId,
        raw: data.coordinatorId,
        memberUserId: req.params.userId,
      });
      if (!coordRes.ok) return res.status(400).json({ error: coordRes.error });
      data.coordinatorId = coordRes.value ?? null;
    }

    const nextRole = data.role || membership.role;
    // Validate the grant set before writing anything (only when the result is a lead).
    let managedResult = null;
    if (nextRole === 'lead' && data.managedCampaignIds !== undefined) {
      const mres = await resolveManagedCampaigns({ orgId, raw: data.managedCampaignIds });
      if (!mres.ok) return res.status(400).json({ error: mres.error });
      managedResult = mres.value;
    }

    // managedCampaignIds lives in CampaignManager, not on the membership doc.
    const { managedCampaignIds: _omitGrants, ...membershipUpdate } = data;
    Object.assign(membership, membershipUpdate);
    await membership.save();

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

router.delete('/:userId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    if (
      String(req.params.userId) === String(req.user._id) &&
      !req.user.isSuperAdmin
    ) {
      return res.status(400).json({ error: "You can't remove yourself from this org." });
    }
    const orgId = activeOrgId(req);
    await Membership.deleteOne({ userId: req.params.userId, organizationId: orgId });
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

router.patch('/:userId/user', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
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

router.patch('/:userId/deactivate', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const membership = await Membership.findOneAndUpdate(
      { userId: req.params.userId, organizationId: activeOrgId(req) },
      { isActive: false },
      { new: true }
    );
    if (!membership) return res.status(404).json({ error: 'Membership not found' });
    res.json({ membership });
  } catch (err) {
    next(err);
  }
});

router.patch('/:userId/reactivate', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
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
