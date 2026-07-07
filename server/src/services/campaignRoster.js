import { CampaignAssignment } from '../models/CampaignAssignment.js';
import { Membership } from '../models/Membership.js';
import { User } from '../models/User.js';

// CampaignAssignment is the per-campaign roster that GATES mobile visibility — a
// canvasser only sees campaigns they're assigned to. Whenever a user is given work
// (a book), make sure they're on that campaign's roster, so they can actually SEE the
// campaign in the field app. Idempotent upsert keyed on the unique (campaignId,userId).
export async function ensureCampaignAssignments(campaignId, userIds, orgId, byUserId) {
  const ids = [...new Set((userIds || []).map((u) => String(u)))].filter(Boolean);
  if (!ids.length) return;
  const now = new Date();
  await CampaignAssignment.bulkWrite(
    ids.map((uid) => ({
      updateOne: {
        filter: { campaignId, userId: uid },
        update: { $setOnInsert: { organizationId: orgId, assignedBy: byUserId || null, assignedAt: now } },
        upsert: true,
      },
    })),
    { ordered: false }
  );
}

// The subset of `ids` that are ACTIVATED members of this org: an active membership whose
// user account is also active. This is what "and activated" means for assignment — it
// mirrors the book pickers, which hide anyone whose user.isActive/membership.isActive is false.
async function activeMemberIdSet(organizationId, ids) {
  const memberIds = await Membership.find(
    { organizationId, userId: { $in: ids }, isActive: true }
  ).distinct('userId');
  if (!memberIds.length) return new Set();
  const activeUserIds = await User.find({ _id: { $in: memberIds }, isActive: true }).distinct('_id');
  return new Set(activeUserIds.map(String));
}

// Who may be assigned work (a book) in a campaign: users on the campaign roster, OR org
// admins — who can be assigned on the fly (incl. self) and get added to the roster when
// they are — but in BOTH cases only if they are currently ACTIVATED (active org membership
// + active user account), so a since-deactivated person can no longer be given new work.
// Superadmins are always allowed (cross-org oversight + self-assign). Everyone else must be
// added on the Team page first. Returns { allowed, notOnTeam } as arrays of string ids (deduped).
export async function partitionAssignable({ campaignId, organizationId, userIds }) {
  const ids = [...new Set((userIds || []).map((u) => String(u)))].filter(Boolean);
  if (!ids.length) return { allowed: [], notOnTeam: [] };
  const [onRoster, admins, supers, activeSet] = await Promise.all([
    CampaignAssignment.find({ campaignId, userId: { $in: ids } }).distinct('userId'),
    Membership.find({ organizationId, userId: { $in: ids }, role: 'admin', isActive: true }).distinct('userId'),
    User.find({ _id: { $in: ids }, isSuperAdmin: true }).distinct('_id'),
    activeMemberIdSet(organizationId, ids),
  ]);
  const roster = new Set(onRoster.map(String));
  const admin = new Set(admins.map(String));
  const superSet = new Set(supers.map(String));
  // Roster/admin candidates must ALSO be activated; superadmins bypass (oversight).
  const ok = new Set(
    ids.filter((id) => superSet.has(id) || ((roster.has(id) || admin.has(id)) && activeSet.has(id)))
  );
  return {
    allowed: ids.filter((id) => ok.has(id)),
    notOnTeam: ids.filter((id) => !ok.has(id)),
  };
}
