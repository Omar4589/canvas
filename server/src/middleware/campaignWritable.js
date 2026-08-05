import mongoose from 'mongoose';
import { Campaign } from '../models/Campaign.js';

// ── Archived campaigns are READ-ONLY ──
//
// "Archive ... the campaign becomes read-only" is a promise the product makes in
// docs/CAMPAIGNS.md and in the Help Center, but for a long time nothing enforced it for
// ADMINS: the only campaign.isActive check in the server was the canvasser bootstrap
// (routes/mobile/bootstrap.js), so a finished race could still have books assigned, crew
// added, and pins moved from either console. This blocks the field-mutating writes and
// leaves reads alone.
//
// NOT blocked, deliberately:
//   - exports         a read; middleware/entitlement.js already lets even a read-only ORG
//                     create them, because the export window is a legal promise.
//   - flag review     bookkeeping ABOUT past activity, not new field work.
//   - campaign PATCH  you must be able to rename — and above all REACTIVATE — an archive.
//
// 409 rather than 403 is load-bearing: mobile/lib/api.js inspects 400/403/404 for
// ORG_CONTEXT / FORBIDDEN_ROLE and can eject the user to the org picker on a 403 it
// doesn't recognise, so an already-released bundle would turn "this campaign is finished"
// into "your session is broken". A 409 falls through to a plain error message, and it
// matches the archived-PASS refusal turfs.js already returns.
//
// ROUTE LAYER ONLY. Never push this down into services/campaignRoster.js or the turf
// services: deleteOrganization, deleteAccount (releaseAssignedWork), deleteCampaign,
// restampCoordinator/setCoordinator and the demo seeders all write assignments through
// them, and every one of those must keep working on an org holding an archived campaign.

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const CAMPAIGN_ARCHIVED = 'campaign-archived';
const ARCHIVED_MESSAGE = 'This campaign is archived — reactivate it to make changes.';

export const rejectArchivedCampaign = (res) =>
  res.status(409).json({ error: ARCHIVED_MESSAGE, code: CAMPAIGN_ARCHIVED });

// Inline form, for a handler that already holds the campaign (or resolves it from
// something other than :campaignId). Returns false once it has sent the 409.
export const assertCampaignWritable = (res, campaign) => {
  if (campaign && campaign.isActive === false) {
    rejectArchivedCampaign(res);
    return false;
  }
  return true;
};

const loadCampaignState = async (req) => {
  const orgId = req.activeOrg?._id;
  const { campaignId } = req.params;
  if (!orgId || !campaignId || !mongoose.isValidObjectId(campaignId)) return null;
  return Campaign.findOne({ _id: campaignId, organizationId: orgId }).select('isActive').lean();
};

// Router-level form, for the routers mounted under /admin/campaigns/:campaignId. Reads
// req.campaign when a loadCampaign middleware has already put it there (no second query),
// otherwise looks up the id itself.
//
// `readOnlyPosts` is the same carve-out shape entitlement.js uses for the exports
// estimate: a RegExp of paths that are POSTs but persist nothing (preview/count
// endpoints), matched against req.path so they stay available on an archive.
export const requireActiveCampaign = ({ readOnlyPosts } = {}) => async (req, res, next) => {
  try {
    if (!WRITE_METHODS.has(req.method)) return next();
    if (readOnlyPosts && req.method === 'POST' && readOnlyPosts.test(req.path)) return next();
    const campaign = req.campaign || (await loadCampaignState(req));
    // Nothing resolved (bad id, another org's campaign) — let the route's own 404 answer,
    // so this guard never invents a different error for a campaign that isn't there.
    if (!campaign) return next();
    return assertCampaignWritable(res, campaign) ? next() : undefined;
  } catch (err) {
    next(err);
  }
};
