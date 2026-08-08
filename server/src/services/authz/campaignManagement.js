import mongoose from 'mongoose';
import { CampaignManager } from '../../models/CampaignManager.js';
import { Campaign } from '../../models/Campaign.js';
import { Effort } from '../../models/Effort.js';

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

// Can the requester CREATE/EDIT/DUPLICATE this survey template? Surveys are org-level
// templates, so admins manage any; a LEAD may only touch one they authored (createdBy)
// or one attached to a campaign they manage — as that campaign's default
// (Campaign.surveyTemplateId) OR any walk-list override (Effort.surveyTemplateId).
// Default-deny. `survey` is a SurveyTemplate doc/lean object (needs _id, createdBy).
export async function canManageSurvey(req, survey) {
  if (isOrgAdmin(req)) return true;
  if (req.activeMembership?.role !== 'lead') return false;
  if (!survey) return false;
  // createdBy FIRST — a lead can edit a survey they just created but haven't
  // attached to anything yet (the create-then-edit-before-attach case).
  if (survey.createdBy && req.user?._id && String(survey.createdBy) === String(req.user._id)) {
    return true;
  }
  const managed = await managedCampaignIds(req);
  if (!managed.length) return false;
  const orgId = req.activeOrg?._id;
  const [asDefault, asOverride] = await Promise.all([
    Campaign.exists({ organizationId: orgId, _id: { $in: managed }, surveyTemplateId: survey._id }),
    Effort.exists({ organizationId: orgId, campaignId: { $in: managed }, surveyTemplateId: survey._id }),
  ]);
  return Boolean(asDefault || asOverride);
}

// The SET form of canManageSurvey's "attached" arm: every template id attached to a
// campaign in `managed` — as the campaign default or any walk-list override. Kept
// beside canManageSurvey so the per-doc and set predicates can't drift apart.
// `managed` is the caller's already-computed managedCampaignIds (no second grant read).
export async function attachedSurveyTemplateIds(req, managed) {
  const orgId = req.activeOrg?._id;
  if (!orgId || !managed?.length) return [];
  const [defaults, overrides] = await Promise.all([
    Campaign.distinct('surveyTemplateId', {
      organizationId: orgId,
      _id: { $in: managed },
      surveyTemplateId: { $ne: null },
    }),
    Effort.distinct('surveyTemplateId', {
      organizationId: orgId,
      campaignId: { $in: managed },
      surveyTemplateId: { $ne: null },
    }),
  ]);
  return [...defaults, ...overrides];
}
