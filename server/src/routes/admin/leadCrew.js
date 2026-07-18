import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireCampaignManager, denyVendorPrivilegeWrite } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { Membership } from '../../models/Membership.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import {
  createOrgMember,
  MemberError,
  memberIdentityShape,
  resolveCoordinatorId,
} from '../../services/memberships/createMember.js';
import { sendMail } from '../../services/mail/mailer.js';
import { inviteSetPassword, addedToOrg } from '../../services/mail/templates.js';
import { issuePasswordResetToken, INVITE_TOKEN_HOURS } from '../../services/auth/passwordReset.js';

// A team lead's crew surface, scoped to ONE campaign they manage (requireCampaignManager
// gates the mount). It gives a lead the crew-building an org admin does on the Users
// page — WITHOUT the org-wide Users administration: list org members to add, create a
// brand-new canvasser (or link a returning one by email) onto this campaign, and set a
// crew member's coordinator. Adding/removing existing members and reading the roster
// still go through .../assignments.
const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireCampaignManager);

function activeOrgId(req) {
  return req.activeOrg?._id;
}

async function loadOwnedCampaign(req) {
  if (!mongoose.isValidObjectId(req.params.campaignId)) return null;
  const orgId = activeOrgId(req);
  if (!orgId) return null;
  const campaign = await Campaign.findOne({ _id: req.params.campaignId, organizationId: orgId });
  return campaign || null;
}

// A lead builds their crew the same way an org admin adds a member on the Users page:
// create a brand-new canvasser, OR link an EXISTING global account by email (a lead owns
// onboarding, and a returning canvasser may already have a Door Line login from another
// org). memberIdentityShape carries the same email-link / new-account rules and privacy
// guards the admin path uses; createOrgMember enforces name+password on the create-new path.
const createSchema = z.object({
  ...memberIdentityShape,
  coordinatorId: z.string().nullable().optional(),
});

// The active org members a lead can pick from to add to their campaign.
router.get('/', async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const memberships = await Membership.find({ organizationId: campaign.organizationId, isActive: true })
      .populate({ path: 'userId', select: 'firstName lastName email isActive isSuperAdmin' })
      .sort({ createdAt: -1 })
      .lean();
    res.json({
      members: memberships
        .filter((m) => m.userId && m.userId.isActive)
        .map((m) => ({
          role: m.role,
          isActive: m.isActive,
          coordinatorId: m.coordinatorId ? String(m.coordinatorId) : null,
          user: {
            id: String(m.userId._id),
            firstName: m.userId.firstName,
            lastName: m.userId.lastName,
            email: m.userId.email,
            isActive: m.userId.isActive,
            isSuperAdmin: !!m.userId.isSuperAdmin,
          },
        })),
    });
  } catch (err) {
    next(err);
  }
});

// Create a brand-new canvasser and put them on this campaign in one step.
router.post('/', denyVendorPrivilegeWrite, async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const orgId = activeOrgId(req);
    const data = createSchema.parse(req.body);

    const coordRes = await resolveCoordinatorId({ orgId, raw: data.coordinatorId, memberUserId: null });
    if (!coordRes.ok) return res.status(400).json({ error: coordRes.error });

    let user;
    try {
      ({ user } = await createOrgMember({
        orgId,
        addedBy: req.user._id,
        data, // linkExisting:true links an existing account; false → create-new (existing email → EMAIL_EXISTS_USE_LINK)
        role: 'canvasser', // a lead can only create/link canvassers for their crew
        coordinatorId: coordRes.value || null,
        // New accounts get a temp password + forced change on first login. A linked existing
        // account keeps its own password (the flag only applies on the create-new branch).
        mustChangePassword: true,
      }));
    } catch (err) {
      if (err instanceof MemberError) return res.status(err.status).json({ error: err.message, code: err.code });
      throw err;
    }

    await CampaignAssignment.updateOne(
      { campaignId: campaign._id, userId: user._id },
      {
        $setOnInsert: {
          campaignId: campaign._id,
          userId: user._id,
          organizationId: orgId,
          assignedBy: req.user._id,
          assignedAt: new Date(),
        },
      },
      { upsert: true }
    );

    // ONE combined email — best-effort, never awaited (a mail hiccup must not fail the lead's add).
    // A new account gets a set-password invite naming BOTH the org and this campaign; an existing account
    // linked in gets a no-credentials "you've been added" note that names the campaign.
    if (data.linkExisting) {
      sendMail({ to: user.email, ...addedToOrg({ firstName: user.firstName, orgName: req.activeOrg.name, campaignName: campaign.name }), kind: 'addedToOrg' });
    } else {
      const { url } = await issuePasswordResetToken(user._id, { hours: INVITE_TOKEN_HOURS });
      sendMail({ to: user.email, ...inviteSetPassword({ firstName: user.firstName, orgName: req.activeOrg.name, campaignName: campaign.name, setPasswordUrl: url }), kind: 'inviteSetPassword' });
    }

    res.status(201).json({ user: user.toSafeJSON() });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Conflict' });
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Set (or clear) a crew member's coordinator. Scoped to this campaign's roster so a
// lead can only reorganize their own crew, not arbitrary org members.
router.patch('/:userId/coordinator', denyVendorPrivilegeWrite, async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!mongoose.isValidObjectId(req.params.userId)) return res.status(400).json({ error: 'Invalid userId' });
    const orgId = activeOrgId(req);

    const onCampaign = await CampaignAssignment.exists({ campaignId: campaign._id, userId: req.params.userId });
    if (!onCampaign) return res.status(404).json({ error: 'That member is not on this campaign' });

    const coordRes = await resolveCoordinatorId({ orgId, raw: req.body?.coordinatorId, memberUserId: req.params.userId });
    if (!coordRes.ok) return res.status(400).json({ error: coordRes.error });
    if (coordRes.skip) return res.status(400).json({ error: 'coordinatorId is required' });

    const membership = await Membership.findOneAndUpdate(
      { userId: req.params.userId, organizationId: orgId },
      { coordinatorId: coordRes.value ?? null },
      { new: true }
    );
    if (!membership) return res.status(404).json({ error: 'Member not in this org' });
    res.json({ ok: true, coordinatorId: membership.coordinatorId ? String(membership.coordinatorId) : null });
  } catch (err) {
    next(err);
  }
});

export default router;
