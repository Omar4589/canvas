import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Campaign } from '../../models/Campaign.js';
import { Membership } from '../../models/Membership.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { User } from '../../models/User.js';
import { requireAuth, requireCampaignManager } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { releaseAssignedWork } from '../../services/users/deleteAccount.js';
import { canvasserStanding } from '../../services/reports/canvasserIdentity.js';
import { sendMail } from '../../services/mail/mailer.js';
import { addedToCampaign } from '../../services/mail/templates.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireCampaignManager);

const assignSchema = z.object({
  userIds: z.array(z.string()).min(1),
});

function activeOrgId(req) {
  return req.activeOrg?._id;
}

async function loadOwnedCampaign(req) {
  if (!mongoose.isValidObjectId(req.params.campaignId)) return null;
  const campaign = await Campaign.findById(req.params.campaignId);
  if (!campaign) return null;
  if (!activeOrgId(req)) return null;
  if (String(campaign.organizationId) !== String(activeOrgId(req))) return null;
  return campaign;
}

router.get('/', async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const assignments = await CampaignAssignment.find({ campaignId: campaign._id })
      .populate({ path: 'userId', select: 'firstName lastName email isActive deletedAt isSuperAdmin' })
      .lean();
    // Join org roles + coordinator (the "team" grouping) so the pickers/Team page can
    // show the admin badge, search, and group/assign by crew.
    const userIds = assignments.filter((a) => a.userId).map((a) => a.userId._id);
    const memberships = await Membership.find({ organizationId: campaign.organizationId, userId: { $in: userIds } })
      .select('userId role coordinatorId isActive')
      .lean();
    const roleByUser = new Map(memberships.map((m) => [String(m.userId), m.role]));
    const membershipByUser = new Map(memberships.map((m) => [String(m.userId), m]));
    const coordByUser = new Map(memberships.map((m) => [String(m.userId), m.coordinatorId ? String(m.coordinatorId) : null]));
    // Resolve the distinct coordinator (lead) ids to display names for the crew label.
    const coordIds = [...new Set([...coordByUser.values()].filter(Boolean))];
    const coordNameById = new Map(
      coordIds.length
        ? (await User.find({ _id: { $in: coordIds } }).select('firstName lastName').lean()).map((u) => [
            String(u._id),
            `${u.firstName} ${u.lastName}`.trim(),
          ])
        : []
    );
    res.json({
      assignments: assignments
        .filter((a) => a.userId)
        .map((a) => {
          const coordinatorId = coordByUser.get(String(a.userId._id)) || null;
          // The composite standing, not User.isActive. This used to report User.isActive, which
          // only goes false on account DELETION — so a member an admin had DEACTIVATED still
          // came back as active, the book pickers kept offering them, and the server then
          // refused the assignment with a 409 (partitionAssignable checks BOTH flags). Now the
          // picker and the assign endpoint agree.
          const status = canvasserStanding(a.userId, membershipByUser.get(String(a.userId._id)));
          return {
            userId: String(a.userId._id),
            firstName: a.userId.firstName,
            lastName: a.userId.lastName,
            email: a.userId.email,
            status,
            isActive: status === 'active',
            isSuperAdmin: !!a.userId.isSuperAdmin,
            role: roleByUser.get(String(a.userId._id)) || 'canvasser',
            coordinatorId,
            coordinatorName: coordinatorId ? coordNameById.get(coordinatorId) || null : null,
            assignedAt: a.assignedAt,
          };
        }),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const { userIds } = assignSchema.parse(req.body);
    const orgId = activeOrgId(req);

    const validIds = userIds.filter((id) => mongoose.isValidObjectId(id));
    if (validIds.length !== userIds.length) {
      return res.status(400).json({ error: 'Invalid userId in list' });
    }

    const memberships = await Membership.find({
      userId: { $in: validIds },
      organizationId: orgId,
      isActive: true,
    }).lean();
    const memberSet = new Set(memberships.map((m) => String(m.userId)));
    const invalid = validIds.filter((id) => !memberSet.has(id));
    if (invalid.length) {
      return res.status(400).json({
        error: 'Some users are not active members of this org',
        invalidUserIds: invalid,
      });
    }

    let created = 0;
    const newlyAdded = []; // only rows actually INSERTED this call — re-adds / already-present send nothing
    for (const userId of validIds) {
      const result = await CampaignAssignment.updateOne(
        { campaignId: campaign._id, userId },
        {
          $setOnInsert: {
            campaignId: campaign._id,
            userId,
            organizationId: orgId,
            assignedBy: req.user._id,
            assignedAt: new Date(),
          },
        },
        { upsert: true }
      );
      if (result.upsertedCount) {
        created++;
        newlyAdded.push(userId);
      }
    }

    // Notify only the genuinely-new roster rows — best-effort, never awaited. SKIP anyone still holding a
    // temp password (mustChangePassword): a brand-new invitee's set-password email already named this
    // campaign (leadCrew), so a second "added to a campaign" note before they've even set a password is noise.
    if (newlyAdded.length) {
      const users = await User.find({ _id: { $in: newlyAdded } }).select('firstName email mustChangePassword').lean();
      for (const u of users) {
        if (u.mustChangePassword || !u.email) continue;
        sendMail({ to: u.email, ...addedToCampaign({ firstName: u.firstName, orgName: req.activeOrg.name, campaignName: campaign.name }), kind: 'addedToCampaign', meta: { organizationId: req.activeOrg._id, organizationName: req.activeOrg.name, userId: u._id } });
      }
    }
    res.status(201).json({ created, total: validIds.length });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.delete('/:userId', async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    // This used to drop the CampaignAssignment ONLY, which left the removed person still
    // holding every book (TurfAssignment) and effort-crew row they had on this campaign — so
    // their books stayed "assigned" to somebody who was off the roster, those doors never
    // resurfaced as unassigned, and the effort readiness rollup still counted them as crew.
    // Exactly the bug that was already fixed for remove-from-ORG (memberships.js).
    //
    // Scoped to THIS campaign: releaseAssignedWork's org scope would also strip the user's
    // books in every OTHER campaign of the org. Books are many-to-many, so co-assigned
    // canvassers keep theirs. Knock history is never touched.
    const released = await releaseAssignedWork(req.params.userId, { campaignId: campaign._id });
    res.json({ ok: true, released });
  } catch (err) {
    next(err);
  }
});

export default router;
