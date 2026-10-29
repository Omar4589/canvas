import mongoose from 'mongoose';
import { Campaign } from '../models/Campaign.js';
import { Effort } from '../models/Effort.js';
import { passLabel } from '../services/passes/passLabel.js';

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
//   - snapshot delete DELETE /turfs/snapshots/:id changes no book; it is the way out of a Door
//                     Outcomes undo held by a cleared snapshot (answerEditRuns.js roundClearedSince),
//                     which must never require a Reactivate — that back-bills. Carved out in turfs.js.
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
// Deleting comes first: a mid-delete campaign is beyond "read-only" — it is going away —
// and 409 (not 403/404) keeps the same already-shipped-mobile safety as the archived case.
export const assertCampaignWritable = (res, campaign) => {
  if (campaign && campaign.deletion?.requestedAt) {
    res.status(409).json({ error: 'This campaign is being deleted.', code: 'campaign-deleting' });
    return false;
  }
  if (campaign && campaign.isActive === false) {
    rejectArchivedCampaign(res);
    return false;
  }
  return true;
};

// ── Archived walk lists are READ-ONLY, archived passes VIEW-ONLY ──
// (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §B.8). Same 409 contract as the campaign guard above, for the
// same already-shipped-phone reason. What stays allowed on purpose: renaming an archived walk list,
// claiming doors OUT of it (a re-carve), deleting a snapshot, unmarking a desk mark, and everything
// that only reads or corrects history (Door Outcomes, flag review, notes, exports).

export const WALK_LIST_ARCHIVED = 'walk-list-archived';
export const PASS_ARCHIVED = 'pass-archived';

export const walkListArchivedBody = (effort) => ({
  error: `Walk list "${effort?.name || ''}" is archived — unarchive it to change it.`,
  code: WALK_LIST_ARCHIVED,
});

export const passArchivedBody = (pass) => ({
  error: `${passLabel(pass)} is archived — bring it back to change it.`,
  code: PASS_ARCHIVED,
});

export const assertWalkListWritable = (res, effort) => {
  if (effort?.status === 'archived') {
    res.status(409).json(walkListArchivedBody(effort));
    return false;
  }
  return true;
};

// A pass is writable when it isn't archived AND its walk list isn't — the second covers the drafts
// of an archived walk list, which stay drafts but are frozen. Pass `effort` when the caller already
// has it; otherwise it is looked up. Returns false once it has sent the 409.
export const assertPassWritable = async (res, pass, effort) => {
  if (!pass) return true;
  if (pass.status === 'archived') {
    res.status(409).json(passArchivedBody(pass));
    return false;
  }
  const eff = effort !== undefined ? effort : await Effort.findById(pass.effortId, { name: 1, status: 1 }).lean();
  return assertWalkListWritable(res, eff);
};

const loadCampaignState = async (req) => {
  const orgId = req.activeOrg?._id;
  const { campaignId } = req.params;
  if (!orgId || !campaignId || !mongoose.isValidObjectId(campaignId)) return null;
  return Campaign.findOne({ _id: campaignId, organizationId: orgId }).select('isActive deletion.requestedAt').lean();
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
