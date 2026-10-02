import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireCampaignManager } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { NOT_DELETING } from '../../services/campaigns/deletionState.js';
import { Voter } from '../../models/Voter.js';
import { isOrgAdmin } from '../../services/authz/campaignManagement.js';
import { listVoters, pageParams, isDirectoryTimeout } from '../../services/voters/voterDirectory.js';
import { buildVoterProfile } from '../../services/voters/voterProfile.js';
import { createVoterNote } from '../../services/voters/voterNotes.js';
import { addAuditSubjects } from '../../services/access/supportAccess.js';

// The campaign-scoped voter surface, /admin/campaigns/:campaignId/voters — a campaign's Voters
// tab and its profile, for everyone who MANAGES the campaign. A separate router rather than a
// carve-out on routes/admin/voters.js, for three reasons:
//
//   - The org router stays admin-only, every write included (requireOrgRole('admin') with no
//     per-route exceptions — docs/ROLES.md). A lead never gets an org-wide list, and never gets
//     the identity edit, the do-not-contact flag, the survey edits or the walk-up delete.
//   - A team lead may be the paying CLIENT (the 2026-09-30 ruling: lead-visible is
//     client-visible), and leads already read this campaign's voter search and the full profile
//     on the mobile admin app (routes/mobile/voters.js) and phone/DOB in lead-visible exports.
//     This is the web's parity with that, and the profile scope is the one the mobile route now
//     applies to a lead: THIS campaign's surveys and notes, no other campaign's.
//   - The URL is the scope. requireCampaignManager admits an org admin for any campaign and a
//     lead only for a campaign they were granted (403 FORBIDDEN_ROLE otherwise), every voter
//     read below checks the row is this campaign's, and a ?campaignId in a query is ignored.
//
// Refusals, deliberately: an ungranted campaign is the ROLE refusal (FORBIDDEN_ROLE means only
// "your role is too low"). A voter outside this campaign is a DOMAIN refusal, answered 404
// VOTER_NOT_IN_CAMPAIGN for every role, admins included — a 404 like an unknown id, never the
// 403 the mobile route sends, so a lead cannot use this surface to confirm which ids exist in
// campaigns they do not manage. The one write, a note, goes through services/voters/voterNotes.js
// — the writer the org and mobile note routes use too. Reads are audited like the org router's
// (the router.param tag below; the AccessLog classifies this mount as 'voters' —
// services/access/supportAccess.js).
const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireCampaignManager);

async function loadCampaign(req, res, next) {
  try {
    const orgId = req.activeOrg?._id;
    if (!orgId) return res.status(400).json({ error: 'Active organization required' });
    if (!mongoose.isValidObjectId(req.params.campaignId)) {
      return res.status(400).json({ error: 'Invalid campaignId' });
    }
    // NOT_DELETING: a mid-delete campaign reads as gone (services/campaigns/deletionState.js).
    const campaign = await Campaign.findOne({ _id: req.params.campaignId, organizationId: orgId, ...NOT_DELETING });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    req.campaign = campaign;
    next();
  } catch (err) {
    next(err);
  }
}
router.use(loadCampaign);

// Record-level audit tag: EVERY route with :voterId — current and future — marks the voter as
// this request's subject, so a staff read under a support grant logs WHICH record was opened
// (middleware/accessLog.js picks the tag up at finish; member requests never write a row).
// Invalid ids are skipped: a garbage param must not poison the audit write.
router.param('voterId', (req, res, next, voterId) => {
  if (mongoose.isValidObjectId(voterId)) addAuditSubjects(res, 'voter', voterId);
  next();
});

function activeOrgId(req) {
  return req.activeOrg?._id;
}

// The domain refusal (see the header): a real id that is not this campaign's row.
const NOT_IN_CAMPAIGN = { error: 'Voter not in this campaign', code: 'VOTER_NOT_IN_CAMPAIGN' };

// The entry voter must be THIS campaign's row — rows are per-campaign, so a shared person's row
// in a sibling campaign is a different id and is refused. Answers the 400/404s itself and returns
// null; the caller must `return` on null.
async function loadCampaignVoterOr404(req, res) {
  if (!mongoose.isValidObjectId(req.params.voterId)) {
    res.status(400).json({ error: 'Invalid voterId' });
    return null;
  }
  const voter = await Voter.findOne(
    { _id: req.params.voterId, organizationId: activeOrgId(req) },
    'campaignId'
  ).lean();
  if (!voter) {
    res.status(404).json({ error: 'Voter not found' });
    return null;
  }
  if (String(voter.campaignId) !== String(req.campaign._id)) {
    res.status(404).json(NOT_IN_CAMPAIGN);
    return null;
  }
  return voter;
}

// GET /admin/campaigns/:campaignId/voters — this campaign's directory: the org route's plain
// indexed branch (inside one campaign rows and people are the same thing, so no chips), same
// filters, same page shape.
router.get('/', async (req, res, next) => {
  try {
    const { limit, skip } = pageParams(req.query);
    res.json(
      await listVoters({ orgId: activeOrgId(req), campaignId: req.campaign._id, query: req.query, limit, skip })
    );
  } catch (err) {
    // Same mapping as the org route: the budget expired → an honest, coded 503.
    if (isDirectoryTimeout(err)) {
      // Same code as the org page so the client renders the same band; its own sentence, because
      // the org one says "pick a campaign" and here one already is (practically unreachable: this
      // branch is a plain indexed find).
      return res.status(503).json({ error: 'The voter list took too long to load. Try again.', code: 'DIRECTORY_TIMEOUT' });
    }
    next(err);
  }
});

// GET /admin/campaigns/:campaignId/voters/:voterId — the profile, scoped by who is asking. An
// org admin gets the org-wide union the org route builds (the person's surveys and notes across
// campaigns, the other campaigns linked); a lead gets THIS row only — this campaign's surveys,
// overwrites, field notes and admin notes, otherCampaigns empty — the scope the mobile profile
// applies to a lead. The do-not-contact reason, who flagged and when, and the voter's email are
// in the profile for both (the flag is org-wide by design); the Doorline staff-access card stays
// on the admin-only org route, with no campaign twin.
router.get('/:voterId', async (req, res, next) => {
  try {
    const voter = await loadCampaignVoterOr404(req, res);
    if (!voter) return;
    const profile = await buildVoterProfile(voter._id, {
      orgId: activeOrgId(req),
      scopeCampaignId: isOrgAdmin(req) ? null : req.campaign._id,
    });
    // The builder refuses a row outside its scope on its own (a mismatched scope can never
    // widen); the lookup above already answered that, so a null here is the same refusal.
    if (!profile) return res.status(404).json(NOT_IN_CAMPAIGN);
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// POST /admin/campaigns/:campaignId/voters/:voterId/notes { body } — the one write a lead has
// here: an admin note on a voter of this campaign (notes are org-level and follow the person, so
// the org profile shows it too). Same validation and 400 as the org and mobile note routes.
router.post('/:voterId/notes', async (req, res, next) => {
  try {
    const voter = await loadCampaignVoterOr404(req, res);
    if (!voter) return;
    const body = z.string().trim().min(1).max(5000).parse(req.body?.body);
    const note = await createVoterNote({
      orgId: activeOrgId(req),
      voterId: voter._id,
      authorId: req.user._id,
      body,
    });
    res.status(201).json({ id: String(note._id) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Note body required' });
    next(err);
  }
});

export default router;
