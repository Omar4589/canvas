import mongoose from 'mongoose';
import { CampaignManager } from '../../models/CampaignManager.js';

// ── Authorization helpers for the team-lead (campaign-scoped admin) role ──
//
// A LEAD is an admin whose authority is scoped to the campaigns they hold a
// CampaignManager grant for. A super-admin or an org `admin` is unscoped (manages
// every campaign in the org). Everything here is default-deny: no grant → no access.

// Super-admins and org admins manage the whole org; leads do not.
export function isOrgAdmin(req) {
  return Boolean(req.user?.isSuperAdmin) || req.activeMembership?.role === 'admin';
}

// Who may see the admin console / mobile admin app at all: super, admin, or lead.
export function isConsoleUser(req) {
  if (req.user?.isSuperAdmin) return true;
  const role = req.activeMembership?.role;
  return role === 'admin' || role === 'lead';
}

// The campaigns a LEAD manages in the active org (their grant set). Returns an
// array of ObjectId. Empty for admins/super — they aren't grant-scoped, so
// callers should treat "unscoped" via isOrgAdmin(), not an empty array here.
export async function managedCampaignIds(req) {
  const orgId = req.activeOrg?._id;
  if (!orgId || !req.user) return [];
  const grants = await CampaignManager.find({
    userId: req.user._id,
    organizationId: orgId,
  })
    .select('campaignId')
    .lean();
  return grants.map((g) => g.campaignId);
}

// Can the requester manage THIS campaign? super/org-admin → yes (org ownership is
// verified separately, e.g. by each router's loadCampaign or an org-scoped query);
// lead → only if they hold a grant for it in the active org. Invalid id → deny.
export async function canManageCampaign(req, campaignId) {
  if (isOrgAdmin(req)) return true;
  if (req.activeMembership?.role !== 'lead') return false;
  const orgId = req.activeOrg?._id;
  if (!orgId || !campaignId || !mongoose.isValidObjectId(campaignId)) return false;
  const grant = await CampaignManager.exists({
    userId: req.user._id,
    organizationId: orgId,
    campaignId,
  });
  return Boolean(grant);
}
