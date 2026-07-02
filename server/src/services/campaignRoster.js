import { CampaignAssignment } from '../models/CampaignAssignment.js';
import { Membership } from '../models/Membership.js';
import { User } from '../models/User.js';

// CampaignAssignment is the per-campaign roster that GATES mobile visibility — a
// canvasser only sees campaigns they're assigned to. Whenever a user is given work
// (a book), make sure they're on that campaign's roster, so they can actually SEE the
// campaign in the field app. Idempotent upsert keyed on the unique (campaignId,userId).
export async function ensureCampaignAssignments(campaignId, userIds, orgId, byUserId) {
  const ids = [...new Set((userIds || []).map((u) => String(u)))].filter(Boolean);
  for (const uid of ids) {
    await CampaignAssignment.updateOne(
      { campaignId, userId: uid },
      { $setOnInsert: { organizationId: orgId, assignedBy: byUserId || null, assignedAt: new Date() } },
      { upsert: true }
    );
  }
}

// Who may be assigned work (a book) in a campaign: users already on the campaign
// roster, OR org admins / superadmins — who can be assigned on the fly (incl. self)
// and get added to the roster when they are. Everyone else must be added on the Team
// page first. Returns { allowed, notOnTeam } as arrays of string ids (deduped).
export async function partitionAssignable({ campaignId, organizationId, userIds }) {
  const ids = [...new Set((userIds || []).map((u) => String(u)))].filter(Boolean);
  if (!ids.length) return { allowed: [], notOnTeam: [] };
  const [onRoster, admins, supers] = await Promise.all([
    CampaignAssignment.find({ campaignId, userId: { $in: ids } }).distinct('userId'),
    Membership.find({ organizationId, userId: { $in: ids }, role: 'admin', isActive: true }).distinct('userId'),
    User.find({ _id: { $in: ids }, isSuperAdmin: true }).distinct('_id'),
  ]);
  const ok = new Set([...onRoster, ...admins, ...supers].map(String));
  return {
    allowed: ids.filter((id) => ok.has(id)),
    notOnTeam: ids.filter((id) => !ok.has(id)),
  };
}
