import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireOrgMember } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { NOT_DELETING } from '../../services/campaigns/deletionState.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { activePassIds } from '../../services/passes/activePasses.js';
import { Turf } from '../../models/Turf.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { buildVoterProfile } from '../../services/voters/voterProfile.js';
import { createVoterNote } from '../../services/voters/voterNotes.js';
import { addAuditSubjects } from '../../services/access/supportAccess.js';
import { canManageCampaign } from '../../services/authz/campaignManagement.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgMember);

// Record-level audit tag for :voterId (see routes/admin/voters.js) — staff reads through the
// mobile surface under a grant log the record too.
router.param('voterId', (req, res, next, voterId) => {
  if (mongoose.isValidObjectId(voterId)) addAuditSubjects(res, 'voter', voterId);
  next();
});

function activeOrgId(req) {
  return req.activeOrg?._id;
}
function isAdminOrSuper(req) {
  return req.user.isSuperAdmin || req.activeMembership?.role === 'admin';
}
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A domain refusal, not a role one: the caller's role is fine, the voter just isn't in the
// campaign they resolved. Stays a 403 (the shipped app inspects 403 codes) but never
// FORBIDDEN_ROLE — that code means "your role is too low", and the app answers it by
// refetching the role.
function notInCampaign(res) {
  return res.status(403).json({ error: 'Voter not in this campaign', code: 'VOTER_NOT_IN_CAMPAIGN' });
}

// Managers pass without a roster row: super/admin, or a lead granted THIS campaign.
// The surfaces this router serves are the admin Voter search and Notes screens
// (lead/admin), so a campaign's manager gets campaign scope, never their walker books —
// a granted lead used to 403 here unless someone happened to roster them as a walker,
// and a rostered lead was book-scoped into an empty "no voters" search. Cached on the
// request because two of the three routes ask twice.
async function managesCampaign(req, campaign) {
  if (isAdminOrSuper(req)) return true;
  const key = String(campaign._id);
  if (req._managesCampaignId !== key) {
    req._managesCampaignId = key;
    req._managesCampaign = await canManageCampaign(req, campaign._id);
  }
  return req._managesCampaign;
}

// Campaign comes from ?campaignId / body.campaignId; canvassers must be assigned to it,
// managers (see above) need no roster row.
async function resolveCampaign(req, res) {
  const cid = req.query.campaignId || req.body?.campaignId;
  if (!activeOrgId(req)) {
    res.status(400).json({ error: 'Active organization required (X-Org-Id header)' });
    return null;
  }
  if (!mongoose.isValidObjectId(cid)) {
    res.status(400).json({ error: 'campaignId required' });
    return null;
  }
  // NOT_DELETING: a mid-delete campaign reads as gone (services/campaigns/deletionState.js).
  const campaign = await Campaign.findOne({ _id: cid, organizationId: activeOrgId(req), ...NOT_DELETING }).lean();
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return null;
  }
  if (!isAdminOrSuper(req)) {
    const assigned = await CampaignAssignment.exists({ campaignId: campaign._id, userId: req.user._id });
    if (!assigned && !(await managesCampaign(req, campaign))) {
      res.status(403).json({ error: 'Not assigned to this campaign' });
      return null;
    }
  }
  return campaign;
}

// Household ids a canvasser may look up: their assigned books across all active
// rounds. null = no restriction (admin/super/granted lead). Empty array = sees nothing.
async function scopeHouseholdIds(req, campaign) {
  if (await managesCampaign(req, campaign)) return null;
  const passIds = await activePassIds(campaign._id);
  if (!passIds.length) return [];
  const myTurfs = await TurfAssignment.find(
    { userId: req.user._id, campaignId: campaign._id, passId: { $in: passIds } },
    { turfId: 1 }
  ).lean();
  if (!myTurfs.length) return [];
  const books = await Turf.find({ _id: { $in: myTurfs.map((a) => a.turfId) } }, { householdIds: 1 }).lean();
  return [...new Set(books.flatMap((b) => (b.householdIds || []).map(String)))];
}

// GET /mobile/voters?campaignId=&search= — campaign-scoped search (read).
router.get('/voters', async (req, res, next) => {
  try {
    const campaign = await resolveCampaign(req, res);
    if (!campaign) return;
    const orgId = activeOrgId(req);
    const scope = await scopeHouseholdIds(req, campaign);
    if (Array.isArray(scope) && scope.length === 0) return res.json({ voters: [] });

    // A manager's scope is the campaign itself, so the filter rides Voter.campaignId (rows are
    // per-campaign) on the {organizationId, campaignId, lastName, firstName} index. It used to
    // fetch EVERY household id of the campaign to build a householdId $in — measured on a large
    // campaign at 150,000 ids / 2.9 MB / 0.4-0.9 s per keystroke, against 2.6 ms through
    // campaignId. A canvasser's scope is their books' household ids, already in hand from the
    // Turf rows, so the whole-campaign Household round trip that re-validated them is gone too.
    // Same rows either way.
    const bookHhIds = scope ? scope.map((id) => new mongoose.Types.ObjectId(id)) : null;
    const voterFilter = bookHhIds
      ? { organizationId: orgId, householdId: { $in: bookHhIds } }
      : { organizationId: orgId, campaignId: campaign._id };

    const search = (req.query.search || '').trim();
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      // The address match narrows the same way — the campaign's households for a manager, the
      // books' for a canvasser — never a $in of the whole campaign.
      const addrHh = (
        await Household.find(
          {
            ...(bookHhIds ? { _id: { $in: bookHhIds } } : { organizationId: orgId, campaignId: campaign._id }),
            $or: [{ addressLine1: rx }, { city: rx }, { zipCode: rx }],
          },
          '_id'
        )
          .limit(2000)
          .lean()
      ).map((h) => h._id);
      voterFilter.$or = [{ fullName: rx }, { stateVoterId: search }, { householdId: { $in: addrHh } }];
    }

    const rows = await Voter.find(voterFilter).sort({ lastName: 1, firstName: 1 }).limit(50).lean();
    const households = await Household.find(
      { _id: { $in: rows.map((v) => v.householdId) } },
      'addressLine1 city state'
    ).lean();
    const hMap = new Map(households.map((h) => [String(h._id), h]));
    const votedSet = new Set(
      (await VotedVoter.find({ campaignId: campaign._id, voterId: { $in: rows.map((v) => v._id) } }, 'voterId').lean()).map(
        (r) => String(r.voterId)
      )
    );

    res.json({
      voters: rows.map((v) => {
        const h = hMap.get(String(v.householdId));
        return {
          id: String(v._id),
          fullName: v.fullName,
          party: v.party || null,
          surveyStatus: v.surveyStatus,
          dnc: !!v.doNotContact?.flagged,
          voted: votedSet.has(String(v._id)),
          household: h ? { addressLine1: h.addressLine1, city: h.city, state: h.state } : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// GET /mobile/voters/:voterId?campaignId= — read profile. MANAGEMENT-ONLY (super,
// org admin, or a lead with a grant for this campaign): the profile carries the
// voter's full cross-round survey history WITH answers, raw DOB, and phone — none of
// which a canvasser at the door should hold. The door screen deliberately presents
// each round fresh (per-round surveyStatus on the wire), and shipping last round's
// answers here would let a knock be "confirmed" without a conversation. The only
// screens calling this are the admin Voter search and Notes surfaces (lead/admin);
// the old canvasser entry point was removed from the app long ago — this closes the
// vestigial server side of it (the authorization gap PRIVACY_VERIFICATION.md
// recorded against this route).
router.get('/voters/:voterId', async (req, res, next) => {
  try {
    const campaign = await resolveCampaign(req, res);
    if (!campaign) return;
    if (!mongoose.isValidObjectId(req.params.voterId)) {
      return res.status(400).json({ error: 'Invalid voterId' });
    }
    if (!(await managesCampaign(req, campaign))) {
      return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN_ROLE' });
    }
    const voter = await Voter.findOne(
      { _id: req.params.voterId, organizationId: activeOrgId(req) },
      'householdId campaignId'
    ).lean();
    if (!voter) return res.status(404).json({ error: 'Voter not found' });
    // A lead's grant is per-campaign: the entry voter must belong to the campaign the
    // grant covers (admins/super stay org-wide, as before — ruling 5, 2026-09-30: an admin
    // opening a voter through a campaign still sees the person's other campaigns).
    if (!isAdminOrSuper(req) && String(voter.campaignId) !== String(campaign._id)) return notInCampaign(res);
    // A lead's profile narrows to THIS campaign (ruling 4): surveys, archived overwrites, field
    // notes and admin notes are this row's only and otherCampaigns is empty — the same scope the
    // web campaign profile applies, so the two surfaces disclose alike. Admins pass no scope and
    // keep the org-wide union. The builder re-checks the scope itself (a mismatched scope can
    // never widen), so a null under a scope is that same refusal; without one it can only be a
    // voter deleted between the two reads.
    const scopeCampaignId = isAdminOrSuper(req) ? null : campaign._id;
    const profile = await buildVoterProfile(req.params.voterId, { orgId: activeOrgId(req), scopeCampaignId });
    if (!profile) return scopeCampaignId ? notInCampaign(res) : res.status(404).json({ error: 'Voter not found' });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// POST /mobile/voters/:voterId/notes { campaignId, body } — adds a note to the voter (a
// VoterNote: org-level, it follows the person — services/voters/voterNotes.js).
router.post('/voters/:voterId/notes', async (req, res, next) => {
  try {
    const campaign = await resolveCampaign(req, res);
    if (!campaign) return;
    if (!mongoose.isValidObjectId(req.params.voterId)) {
      return res.status(400).json({ error: 'Invalid voterId' });
    }
    const voter = await Voter.findOne(
      { _id: req.params.voterId, organizationId: activeOrgId(req) },
      'householdId campaignId'
    ).lean();
    if (!voter) return res.status(404).json({ error: 'Voter not found' });
    const scope = await scopeHouseholdIds(req, campaign);
    // A lead annotates through the campaign they resolved: their grant is per-campaign and must
    // not reach another campaign's row through it. Org admins are org-wide here as on the
    // profile read (ruling 5). Canvassers stay book-scoped.
    if (!scope && !isAdminOrSuper(req) && String(voter.campaignId) !== String(campaign._id)) return notInCampaign(res);
    if (scope && !scope.includes(String(voter.householdId))) {
      return res.status(403).json({ error: 'Voter not in your assigned books' });
    }
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
