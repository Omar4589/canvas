import { CampaignAssignment } from '../models/CampaignAssignment.js';

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
