import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Campaign } from '../../models/Campaign.js';
import { isDeleting } from '../../services/campaigns/deletionState.js';
import { Membership } from '../../models/Membership.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { User } from '../../models/User.js';
import { requireAuth, requireCampaignManager } from '../../middleware/auth.js';
import { isOrgAdmin } from '../../services/authz/campaignManagement.js';
import { orgContext } from '../../middleware/orgContext.js';
import { requireActiveCampaign } from '../../middleware/campaignWritable.js';
import { releaseAssignedWork } from '../../services/users/deleteAccount.js';
import { canvasserStanding } from '../../services/reports/canvasserIdentity.js';
import { sendMail } from '../../services/mail/mailer.js';
import { addedToCampaign } from '../../services/mail/templates.js';
import { resolveCoordinatorId } from '../../services/memberships/createMember.js';
import { joinCampaignCrew, CREW_JOB } from '../../services/memberships/setCoordinator.js';
import { mapWithLimit } from '../../utils/mapWithLimit.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireCampaignManager);
// Archived campaign ⇒ read-only: the roster is frozen (GET still lists who walked it).
router.use(requireActiveCampaign());

// `userIds` stays uncapped: a released phone's Assign all shown sends every id in one request.
// `coordinatorId` is the crew the added people join: an id, or null for No crew — and an absent key
// means No crew too, which is what released phones and the phone's book self-assign send.
const assignSchema = z.object({
  userIds: z.array(z.string()).min(1),
  coordinatorId: z.string().nullable().optional(),
});

function activeOrgId(req) {
  return req.activeOrg?._id;
}

async function loadOwnedCampaign(req) {
  if (!mongoose.isValidObjectId(req.params.campaignId)) return null;
  const campaign = await Campaign.findById(req.params.campaignId);
  if (!campaign) return null;
  // A mid-delete campaign reads as gone (services/campaigns/deletionState.js).
  if (isDeleting(campaign)) return null;
  if (!activeOrgId(req)) return null;
  if (String(campaign.organizationId) !== String(activeOrgId(req))) return null;
  return campaign;
}

router.get('/', async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const assignments = await CampaignAssignment.find({ campaignId: campaign._id })
      // lastLoginAt rides along for the Team panel's "Resend invite" affordance (shown only for
      // someone who has never signed in). Not a new disclosure: /admin/memberships already returns
      // it, to admins and leads alike, for exactly the people this roster can contain.
      .populate({ path: 'userId', select: 'firstName lastName email phone isActive deletedAt isSuperAdmin lastLoginAt createdAt' })
      .lean();
    // Join org roles + coordinator (the "team" grouping) so the pickers/Team page can
    // show the admin badge, search, and group/assign by crew.
    const userIds = assignments.filter((a) => a.userId).map((a) => a.userId._id);
    const memberships = await Membership.find({ organizationId: campaign.organizationId, userId: { $in: userIds } })
      .select('userId role isActive')
      .lean();
    const roleByUser = new Map(memberships.map((m) => [String(m.userId), m.role]));
    const membershipByUser = new Map(memberships.map((m) => [String(m.userId), m]));
    // The crew comes off THIS campaign's roster rows, not the org membership. Membership still
    // carries a legacy coordinatorId that nothing reads any more; joining it here made the Team
    // page DISPLAY a different field than it WRITES, so a crew change appeared to revert on the
    // next refetch. `assignments` are already this campaign's rows, so no extra query.
    const coordByUser = new Map(
      assignments.map((a) => [String(a.userId?._id || a.userId), a.coordinatorId ? String(a.coordinatorId) : null])
    );
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
            phone: a.userId.phone || null,
            status,
            isActive: status === 'active',
            isSuperAdmin: !!a.userId.isSuperAdmin,
            lastLoginAt: a.userId.lastLoginAt || null,
            // When the account was made: before 2026-05-15 Doorline didn't record sign-ins, so the
            // Team page reads a missing lastLoginAt as "No sign-in recorded" rather than "Never signed
            // in" for an older account (services/users/deleteAccount.js CLOCKS_RELIABLE_FROM).
            createdAt: a.userId.createdAt || null,
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
    const { userIds, coordinatorId: rawCrew } = assignSchema.parse(req.body);
    const orgId = activeOrgId(req);

    // A team lead may put only THEMSELVES on a campaign by id: the phone's self-assign when a lead
    // takes a book (books.jsx, book/[turfId].jsx). Anyone else they add by email (POST .../crew,
    // after the lookup that names them, which is rate-limited). This used to accept any active member, and the roster then read
    // back that person's email and phone, so a lead, who may be the client, could read the
    // organization's directory one id at a time (PRIVACY_VERIFICATION item 41, owner ruling
    // 2026-10-25, narrowing the 2026-08 never-role-filter ruling to everyone but the lead
    // themself). One answer for every other id, given before the membership check below, so the
    // refusal never says who is a member. Plain message: never FORBIDDEN_ROLE, which the phone
    // treats as a role-recovery signal.
    if (!isOrgAdmin(req) && userIds.some((id) => String(id) !== String(req.user._id))) {
      return res.status(403).json({ error: 'A team lead can add only themselves here. Add anyone else by email on the Team page.' });
    }

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

    // The crew, validated before any roster row is written.
    const coordRes = await resolveCoordinatorId({ orgId, raw: rawCrew, memberUserId: null });
    if (!coordRes.ok) return res.status(400).json({ error: coordRes.error });
    const coordinatorId = coordRes.value ?? null;
    if (coordinatorId && validIds.some((id) => String(id) === String(coordinatorId))) {
      return res.status(400).json({ error: "A member can't be their own coordinator." });
    }

    // Joining a campaign is a crew assignment (owner rulings 2026-10-25 and -26, for every role): each
    // person this call puts on the roster joins with the crew sent, or none, and their earlier doors on
    // this campaign follow them (services/memberships/setCoordinator.js joinCampaignCrew, whose insert
    // replaces this route's own upsert and still settles a race).
    //
    // The roster is read once. Someone already on it is skipped and their crew is never changed by an
    // add, so a stale list can't re-crew a person another admin just added; re-crewing is what Move to
    // crew is for. The joins run four at a time. A ledger error leaves the person added, with the job
    // on their row for Finish it.
    const crew = { set: coordinatorId ? String(coordinatorId) : null, skipped: [], doors: 0, activities: 0, surveys: 0 };
    const onRoster = new Set(
      (await CampaignAssignment.find({ campaignId: campaign._id, userId: { $in: validIds } }, 'userId').lean()).map((r) => String(r.userId))
    );
    const toJoin = [];
    for (const userId of validIds) {
      if (onRoster.has(String(userId))) crew.skipped.push({ userId, reason: 'already-on-campaign' });
      else toJoin.push(userId);
    }
    const joins = await mapWithLimit(toJoin, CREW_JOB.sideBySide, async (userId) => {
      try {
        return { userId, ...(await joinCampaignCrew({ organizationId: orgId, campaignId: campaign._id, userId, coordinatorId, actorUserId: req.user._id, source: 'campaign_join' })) };
      } catch (err) {
        return { userId, thrown: err?.message || String(err) };
      }
    });

    let created = 0;
    const newlyAdded = []; // only rows actually INSERTED this call — re-adds / already-present send nothing
    for (const j of joins) {
      if (j.thrown) {
        crew.skipped.push({ userId: j.userId, reason: 'error', error: j.thrown });
        continue;
      }
      if (!j.joined) {
        crew.skipped.push({ userId: j.userId, reason: 'already-on-campaign' });
        continue;
      }
      created++;
      newlyAdded.push(j.userId);
      // Added, but their earlier doors didn't finish moving (or the plan failed and they were added
      // plainly): Finish it on their panel completes it.
      if (j.restampError) crew.skipped.push({ userId: j.userId, reason: 'unfinished', error: j.restampError });
      crew.doors += j.doors || 0;
      crew.activities += j.activities || 0;
      crew.surveys += j.surveys || 0;
    }

    // Notify only the genuinely-new roster rows — best-effort, never awaited. SKIP anyone still holding a
    // temp password (mustChangePassword): a brand-new invitee's set-password email already named this
    // campaign (leadCrew), so a second "added to a campaign" note before they've even set a password is noise.
    if (newlyAdded.length) {
      const users = await User.find({ _id: { $in: newlyAdded } }).select('firstName email mustChangePassword').lean();
      // Role decides whether the mail points at the app or the console (services/mail/templates.js).
      // Reuses the `memberships` already loaded above for the is-a-member check — that query is
      // .lean() with no projection, so `role` is already on every row, and `newlyAdded ⊆ validIds`
      // by construction. No second round trip.
      //
      // The `|| 'canvasser'` is unreachable, not a real default: every id in `newlyAdded` passed the
      // membership check, and {userId, organizationId} is uniquely indexed (models/Membership.js).
      // It is here so a missing row degrades to the field-role email rather than throwing inside a
      // best-effort notify — do NOT "tidy" it into a throw.
      const roleByUser = new Map(memberships.map((m) => [String(m.userId), m.role]));
      for (const u of users) {
        if (u.mustChangePassword || !u.email) continue;
        const role = roleByUser.get(String(u._id)) || 'canvasser';
        sendMail({ to: u.email, ...addedToCampaign({ firstName: u.firstName, orgName: req.activeOrg.name, campaignName: campaign.name, role }), kind: 'addedToCampaign', meta: { organizationId: req.activeOrg._id, organizationName: req.activeOrg.name, userId: u._id } });
      }
    }
    res.status(201).json({ created, total: validIds.length, crew });
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
    // A team lead removes canvassers from their campaign, and themselves (owner ruling 2026-10-25,
    // item 41). Org admins, other leads and Doorline staff are an org admin's to remove, the same
    // wall as a lead's other account powers (leadMayManageTarget, memberships.js). Someone with no
    // membership here any more is no one's to protect, so a lead may tidy their row. Plain-message
    // 403, never FORBIDDEN_ROLE.
    if (!isOrgAdmin(req) && String(req.params.userId) !== String(req.user._id)) {
      const [membership, onRoster] = await Promise.all([
        Membership.findOne({ userId: req.params.userId, organizationId: activeOrgId(req) }, 'role').lean(),
        CampaignAssignment.exists({ campaignId: campaign._id, userId: req.params.userId }),
      ]);
      // Only someone this organization or campaign actually has is looked at further. Anyone else is
      // the same harmless no-op as a made-up id, so the answer never says an id is Doorline staff.
      const target = membership || onRoster ? await User.findById(req.params.userId, 'isSuperAdmin').lean() : null;
      if (target?.isSuperAdmin || (membership && membership.role !== 'canvasser')) {
        return res.status(403).json({
          error: 'A team lead can remove canvassers from this campaign, and themselves. An org admin can remove anyone else.',
        });
      }
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
