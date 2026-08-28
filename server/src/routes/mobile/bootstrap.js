import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgMember } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { canManageCampaign } from '../../services/authz/campaignManagement.js';
import { KNOCKABLE_DOOR_FILTER } from '../../services/canvass/knockableDoorFilter.js';
import { Campaign } from '../../models/Campaign.js';
import { NOT_DELETING } from '../../services/campaigns/deletionState.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { Pass } from '../../models/Pass.js';
import { Effort } from '../../models/Effort.js';
import { activePassIds } from '../../services/passes/activePasses.js';
import { doorStateFromDoorPass, surveyedVotersFromDoorPass } from '../../services/passes/passStatus.js';
import { canvasserScopeWithPasses, isOrgAdminOrSuper } from '../../services/canvass/canvasserScope.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgMember);

// The ONE place a voter is shaped for the phone. Both the bootstrap and the /changes delta go
// through it, so the two projections cannot drift apart.
//
// It exists to drop `dateOfBirth`. The app downloads a canvasser's whole book and keeps it in an
// AsyncStorage cache so the doors still work in a dead zone — which meant every voter's full date
// of birth was sitting on every canvasser's phone. And the only thing the app ever did with it was
// derive an integer age for the "Party · Age · Gender" line (mobile/lib/voters.js).
//
// A DOB is the most identity-theft-useful field in a voter file; an age is close to worthless. So
// the arithmetic happens here and the date itself never leaves the server. The strongest protection
// for a field is not sending it — a cached-but-encrypted DOB is still a DOB on a volunteer's phone.
//
// Keep the `dateOfBirth: 1` in the Mongo projections above: we need it HERE to compute the age. It
// just must not survive into the response.
function toWireVoter(v, voted) {
  const { dateOfBirth, doNotContact, ...rest } = v;
  // Do-not-contact ships as a bare boolean — the reason/who/when stamp never reaches the phone's
  // offline cache (same principle as the DOB: the strongest protection is not sending it). The
  // badge and the disabled survey CTA only need true/false.
  return { ...rest, age: ageFromDob(dateOfBirth), voted, dnc: doNotContact?.flagged === true };
}

// Per-round voter state + the smart-confirm flag, in ONE place so the bootstrap and the
// /changes delta cannot drift (a delta voter is never a partial view — the client spread-merges
// it whole). `surveyedByMe` ships ONLY when the voter reads 'surveyed' this round: true = the
// requesting canvasser took it, false = a teammate did (the door confirms before re-asking).
// The teammate's IDENTITY never ships — a boolean, same minimalism as the dnc flag. Voters at
// legacy null-pass doors keep the global status and carry no flag, matching door status.
function stampPerRoundSurvey(w, doorPass, surveyedThisRound, meId) {
  if (!doorPass.has(String(w.householdId))) return w;
  const by = surveyedThisRound.get(String(w._id)) || null;
  w.surveyStatus = by ? 'surveyed' : 'not_surveyed';
  if (by) w.surveyedByMe = by === String(meId);
  return w;
}

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const age = Math.floor((Date.now() - d.getTime()) / (365.25 * 86400000));
  // A voter file with a garbage DOB shouldn't render "Party · 1124 yrs · F" at a door.
  return age >= 0 && age < 120 ? age : null;
}

function activeOrgId(req) {
  return req.activeOrg?._id;
}

function ensureOrgScoped(req, res) {
  if (!activeOrgId(req)) {
    res.status(400).json({ error: 'Active organization required (X-Org-Id header)' });
    return false;
  }
  return true;
}

async function assertCampaignAccess(req, campaignId) {
  if (!mongoose.isValidObjectId(campaignId)) return { error: 400, message: 'Invalid campaignId' };
  const orgId = activeOrgId(req);
  if (!orgId) return { error: 400, message: 'Active organization required' };
  // NOT_DELETING: a mid-delete campaign reads as gone — the 404 walls canvassing against
  // it the instant the delete is requested (services/campaigns/deletionState.js).
  const campaign = await Campaign.findOne({ _id: campaignId, organizationId: orgId, ...NOT_DELETING }).lean();
  if (!campaign) return { error: 404, message: 'Campaign not found' };
  if (isOrgAdminOrSuper(req)) return { campaign };
  const assigned = await CampaignAssignment.exists({ campaignId: campaign._id, userId: req.user._id });
  // A lead GRANTED this campaign passes like an admin does: unrostered, they get the
  // same empty-books bootstrap an unrostered admin gets — never a 403 wall on a
  // campaign they manage. Walking still requires a real roster row (books come from
  // TurfAssignments, and the knock routes keep their own roster gate).
  if (!assigned && !(await canManageCampaign(req, campaign._id))) {
    return { error: 403, message: 'Not assigned to this campaign' };
  }
  return { campaign };
}

// The user's assigned books across ALL active rounds, each tagged with its effortId
// + resolved surveyTemplateId (effort override || campaign default). Applies to
// EVERYONE (admins included — an admin canvasses scoped to their own books); empty
// `{ books: [], efforts: [] }` when nothing is assigned.
async function canvasserBooks(req, campaign) {
  const passIds = await activePassIds(campaign._id);
  if (!passIds.length) return { books: [], efforts: [] };
  const myTurfs = await TurfAssignment.find(
    { userId: req.user._id, campaignId: campaign._id, passId: { $in: passIds } },
    { turfId: 1 }
  ).lean();
  if (!myTurfs.length) return { books: [], efforts: [] };
  const books = await Turf.find(
    { _id: { $in: myTurfs.map((a) => a.turfId) } },
    { name: 1, centroid: 1, doorCount: 1, householdIds: 1, passId: 1 }
  ).lean();

  // book → round (pass) → effort → survey override (falls back to campaign default).
  const passes = await Pass.find({ _id: { $in: books.map((b) => b.passId) } }, { effortId: 1 }).lean();
  const passEffort = new Map(passes.map((p) => [String(p._id), p.effortId ? String(p.effortId) : null]));
  const efforts = await Effort.find(
    { _id: { $in: passes.map((p) => p.effortId).filter(Boolean) } },
    { name: 1, surveyTemplateId: 1 }
  ).lean();
  const effortSurvey = new Map(
    efforts.map((e) => [String(e._id), e.surveyTemplateId ? String(e.surveyTemplateId) : null])
  );
  const campaignSurvey = campaign.surveyTemplateId ? String(campaign.surveyTemplateId) : null;

  // doorCount reflects REMAINING doors — exclude fully-voted (and inactive) households.
  const allHhIds = books.flatMap((b) => b.householdIds || []);
  const eligible = new Set(
    (
      await Household.find(
        { _id: { $in: allHhIds }, ...KNOCKABLE_DOOR_FILTER },
        { _id: 1 }
      ).lean()
    ).map((h) => String(h._id))
  );
  const booksOut = books.map((b) => {
    const effortId = passEffort.get(String(b.passId)) || null;
    const surveyTemplateId = (effortId && effortSurvey.get(effortId)) || campaignSurvey;
    return {
      id: String(b._id),
      name: b.name,
      centroid: b.centroid,
      doorCount: (b.householdIds || []).filter((id) => eligible.has(String(id))).length,
      effortId,
      surveyTemplateId,
    };
  });

  // The distinct efforts the canvasser has books in — so the app can offer an
  // effort switcher (book numbers restart per effort, so two efforts can both
  // have a "Book 6"). Only efforts that actually own one of these books.
  const bookEffortIds = new Set(booksOut.map((b) => b.effortId).filter(Boolean));
  const effortList = efforts
    .filter((e) => bookEffortIds.has(String(e._id)))
    .map((e) => ({ id: String(e._id), name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { books: booksOut, efforts: effortList };
}

// The distinct efforts the user has assigned books in for one campaign — a light
// slice of canvasserBooks() that skips the household/voter/survey work, just
// enough for the campaign picker to offer an effort shortcut. Empty when the
// user has no assigned books, or only default-effort (null) books. Effort ids
// match the bootstrap's effort list, so a choice here scopes the book picker.
async function canvasserEffortsForCampaign(req, campaign) {
  const passIds = await activePassIds(campaign._id);
  if (!passIds.length) return [];
  const myTurfs = await TurfAssignment.find(
    { userId: req.user._id, campaignId: campaign._id, passId: { $in: passIds } },
    { turfId: 1 }
  ).lean();
  if (!myTurfs.length) return [];
  const books = await Turf.find({ _id: { $in: myTurfs.map((a) => a.turfId) } }, { passId: 1 }).lean();
  const passes = await Pass.find({ _id: { $in: books.map((b) => b.passId) } }, { effortId: 1 }).lean();
  const effortIds = [...new Set(passes.map((p) => p.effortId).filter(Boolean).map(String))];
  if (!effortIds.length) return [];
  const efforts = await Effort.find({ _id: { $in: effortIds } }, { name: 1 }).lean();
  return efforts
    .map((e) => ({ id: String(e._id), name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

router.get('/campaigns', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    let campaignFilter = { organizationId: orgId, isActive: true, ...NOT_DELETING };
    if (!isOrgAdminOrSuper(req)) {
      const assignedIds = await CampaignAssignment.find({
        userId: req.user._id,
        organizationId: orgId,
      }).distinct('campaignId');
      campaignFilter._id = { $in: assignedIds };
    }
    const campaigns = await Campaign.find(campaignFilter)
      .sort({ createdAt: -1 })
      .select('name type state surveyTemplateId timeZone electionDay earlyVotingStart earlyVotingEnd datesNote disabledOutcomes')
      .lean();
    // `efforts` is additive — older clients ignore it; the picker uses it to let a
    // multi-effort canvasser pick their effort up front and jump straight into the
    // scoped book list.
    const campaignsOut = await Promise.all(
      campaigns.map(async (c) => ({
        id: String(c._id),
        name: c.name,
        type: c.type,
        state: c.state,
        timeZone: c.timeZone || 'America/New_York',
        // Key dates — additive; older clients ignore them.
        electionDay: c.electionDay ?? null,
        earlyVotingStart: c.earlyVotingStart ?? null,
        earlyVotingEnd: c.earlyVotingEnd ?? null,
        datesNote: c.datesNote ?? '',
        disabledOutcomes: c.disabledOutcomes ?? [],
        efforts: await canvasserEffortsForCampaign(req, c),
      }))
    );
    res.json({
      user: req.user.toSafeJSON(),
      campaigns: campaignsOut,
      // Billing entitlement (attached by requireEntitlement; null for super
      // admins) — the picker shows trial/paused notices from this.
      entitlement: req.entitlement || null,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/bootstrap', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const { campaignId } = req.query;
    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId query param is required' });
    }
    const access = await assertCampaignAccess(req, campaignId);
    if (access.error) return res.status(access.error).json({ error: access.message });
    const campaign = access.campaign;
    if (!campaign.isActive) return res.status(404).json({ error: 'Campaign inactive' });

    const householdFilter = {
      campaignId: campaign._id,
      organizationId: orgId,
      // Drops fully-voted, fully-DNC, and admin-excluded doors — the phone never sees them.
      ...KNOCKABLE_DOOR_FILTER,
      'location.coordinates': { $exists: true, $ne: null },
    };
    const { scope, doorPass, doorTurf } = await canvasserScopeWithPasses(req, campaign);
    householdFilter._id = { $in: scope };

    const households = await Household.find(householdFilter, {
      addressLine1: 1,
      addressLine2: 1,
      city: 1,
      state: 1,
      zipCode: 1,
      location: 1,
      status: 1,
      lastActionAt: 1,
      turfId: 1,
      walkOrder: 1, // list-view "walk order" sort
      coordSource: 1, // pin provenance: 'file' | 'geocodio' | 'corrected'
      coordConfidence: 1, // 'exact' | 'interpolated' | null (approximate-pin badge)
      locationConfirmedAt: 1, // confirm-in-place stamp (Pin Fixes) — badge reads "confirmed"
    }).lean();

    const householdIds = households.map((h) => h._id);

    // Per-round status + last visit: each door as it stands IN THE ROUND OF THE
    // CANVASSER'S ASSIGNED BOOK (from doorPass), so prepping a future round (which
    // moves Household.turfId) can't flip an active round's worked doors to "fresh".
    // lastActionAt is rewritten too — a door untouched this round reads unknocked
    // with NO last visit (the round-fresh presentation the docs promise), instead of
    // "Unknocked · Last visit 3 weeks ago". Household.status / lastActionAt stay
    // global for admin/reports.
    const perRound = await doorStateFromDoorPass(doorPass, campaign.type);
    for (const h of households) {
      const s = perRound.get(String(h._id));
      if (s) {
        h.status = s.status;
        h.lastActionAt = s.lastActionAt;
        // 'desk' | 'field' | null — WHO put a restricted door in that state, for the round the
        // canvasser is working. Lets the door screen say "the office marked this" instead of
        // leaving an office prediction indistinguishable from a colleague's observation at the
        // gate. Additive: an older bundle ignores it.
        h.restrictedFrom = s.restrictedFrom;
      }
      // turfId/walkOrder rewritten the same way as status above: FROM THE CANVASSER'S OWN
      // ASSIGNED BOOK, never the raw Household mirror. The shipped app filters doors into
      // books by h.turfId, and the mirror follows the latest cut anywhere in the campaign —
      // cutting a draft round used to blank every phone's book until the mirror was
      // repaired. The door is in scope precisely because it is in one of the canvasser's
      // books, so the map always has it.
      const t = doorTurf.get(String(h._id));
      if (t) {
        h.turfId = t.turfId;
        h.walkOrder = t.walkOrder;
      }
    }

    const [votersRaw, survey, votedRecs, surveyedThisRound] = await Promise.all([
      campaign.type === 'survey'
        ? Voter.find(
            { householdId: { $in: householdIds }, organizationId: orgId },
            {
              householdId: 1,
              fullName: 1,
              firstName: 1,
              lastName: 1,
              party: 1,
              gender: 1,
              dateOfBirth: 1,
              surveyStatus: 1,
              'doNotContact.flagged': 1, // → toWireVoter's `dnc` boolean; never the reason
            }
          ).lean()
        : Promise.resolve([]),
      campaign.surveyTemplateId
        ? SurveyTemplate.findOne({
            _id: campaign.surveyTemplateId,
            organizationId: orgId,
          }).lean()
        : Promise.resolve(null),
      VotedVoter.find({ campaignId: campaign._id }, { voterId: 1 }).lean(),
      campaign.type === 'survey' ? surveyedVotersFromDoorPass(doorPass) : Promise.resolve(new Map()),
    ]);
    // Early voting: flag (not hide) voters who already voted so the app can show
    // a ✓ next to their name. Fully-voted doors were already dropped above.
    const votedSet = new Set(votedRecs.map((r) => String(r.voterId)));
    // Per-round voter state, same principle as the door status above: on the wire,
    // 'surveyed' means surveyed in THIS round (the round of the door's assigned book),
    // so a pass-1 supporter presents fresh in a pass-3 book — no "Surveyed" badge, no
    // Re-survey label, no cross-round tell. The stored Voter.surveyStatus stays the
    // campaign-global "ever surveyed" for admin/reports. Voters at doors outside
    // doorPass (legacy null-pass books) keep the global value, matching door status.
    const voters = votersRaw.map((v) =>
      stampPerRoundSurvey(toWireVoter(v, votedSet.has(String(v._id))), doorPass, surveyedThisRound, req.user._id)
    );

    const { books, efforts } = await canvasserBooks(req, campaign);
    // The campaign's active round ids — the client compares this to the /changes
    // poll to detect a round activation and refresh (per-round colors).
    const activePasses = (await activePassIds(campaign._id)).map(String);
    // Per-effort surveys: every survey a door in scope might need (effort
    // overrides + campaign default), keyed by id. The app resolves a voter's
    // survey via household → book → surveyTemplateId → surveys[id], falling back
    // to activeSurvey (the campaign default).
    const surveyIds = new Set();
    if (campaign.surveyTemplateId) surveyIds.add(String(campaign.surveyTemplateId));
    for (const b of books) if (b.surveyTemplateId) surveyIds.add(String(b.surveyTemplateId));
    const surveyTemplates = surveyIds.size
      ? await SurveyTemplate.find({ _id: { $in: [...surveyIds] }, organizationId: orgId }).lean()
      : [];
    const surveys = {};
    for (const t of surveyTemplates) surveys[String(t._id)] = t;

    res.json({
      user: req.user.toSafeJSON(),
      campaign: {
        id: String(campaign._id),
        name: campaign.name,
        type: campaign.type,
        state: campaign.state,
        timeZone: campaign.timeZone || 'America/New_York',
        // Key dates — additive; older clients ignore them. Carried in-campaign (not just on the
        // picker) so the Books header + mobile admin detail can show the Election Day countdown.
        electionDay: campaign.electionDay ?? null,
        earlyVotingStart: campaign.earlyVotingStart ?? null,
        earlyVotingEnd: campaign.earlyVotingEnd ?? null,
        datesNote: campaign.datesNote ?? '',
        // Door outcomes turned off for this campaign — additive; older clients ignore it and
        // keep showing every button (the OUTCOME_DISABLED backstop in canvass.js covers them).
        disabledOutcomes: campaign.disabledOutcomes || [],
      },
      activeSurvey: survey,
      surveys,
      households,
      voters,
      books,
      efforts,
      activePassIds: activePasses,
      // Billing entitlement — the field app gates new dispositions on
      // canCanvass and shows the banner state (null for super admins).
      entitlement: req.entitlement || null,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/changes', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const { campaignId, since } = req.query;
    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId query param is required' });
    }
    const access = await assertCampaignAccess(req, campaignId);
    if (access.error) return res.status(access.error).json({ error: access.message });

    const sinceMs = since ? Date.parse(since) : NaN;
    if (!Number.isFinite(sinceMs)) {
      return res.status(400).json({ error: 'since query param is required (ISO datetime)' });
    }
    const sinceDate = new Date(sinceMs);
    const cId = access.campaign._id;

    const changedFilter = {
      campaignId: cId,
      organizationId: orgId,
      updatedAt: { $gt: sinceDate },
    };
    const { scope, doorPass } = await canvasserScopeWithPasses(req, access.campaign);
    changedFilter._id = { $in: scope };

    const changedHouseholds = await Household.find(changedFilter, {
      _id: 1,
      status: 1,
      lastActionAt: 1,
      isActive: 1,
      fullyVoted: 1, // client drops doors where everyone has now voted
      fullyDnc: 1, // client drops doors where everyone is do-not-contact
      doNotKnock: 1, // client drops doors whose address asked that nobody come back

      location: 1, // so an admin pin-move (or another canvasser's fix) reflects live
      coordSource: 1,
      coordConfidence: 1,
      locationConfirmedAt: 1, // mirrors the bootstrap projection (Pin Fixes confirm stamp)
    }).lean();
    // Per-round status + last visit from the canvasser's book round (same as
    // bootstrap) so deltas don't re-introduce a global status — or a prior round's
    // "Last visit" — for a door fresh in its current round. Skipped entirely on the
    // (common) empty poll.
    if (changedHouseholds.length) {
      const perRound = await doorStateFromDoorPass(doorPass, access.campaign.type);
      for (const h of changedHouseholds) {
        const s = perRound.get(String(h._id));
        if (s) {
          h.status = s.status;
          h.lastActionAt = s.lastActionAt;
          h.restrictedFrom = s.restrictedFrom; // same per-round provenance as the bootstrap
        }
      }
    }

    // Identity-cache fields (match the bootstrap projection) so voter changes reach an
    // already-bootstrapped client via the delta poll, not only a full re-bootstrap.
    const VOTER_DELTA_PROJ = { _id: 1, householdId: 1, surveyStatus: 1, fullName: 1, firstName: 1, lastName: 1, party: 1, gender: 1, dateOfBirth: 1, 'doNotContact.flagged': 1 };

    // Voters ride the delta on TWO tracks, unioned:
    //  1. ALL voters of a changed household (not only docs whose own updatedAt moved):
    //     marking a voter voted writes a VotedVoter row, not the Voter doc, so an
    //     updatedAt filter would miss the ✓. The recompute bumps the household, so its
    //     door is already in this delta.
    //  2. Voters whose OWN updatedAt moved — a pure identity edit (admin correction,
    //     Person propagation, re-import reconcile) touches only the Voter doc, never the
    //     household, so track 1 alone would strand it until a cold re-bootstrap. Same
    //     cost class as the household delta above: index seeks over the canvasser's own
    //     book scope.
    let changedVoters = [];
    {
      const hhIds = changedHouseholds.map((h) => h._id);
      const [byHousehold, byOwnEdit] = await Promise.all([
        hhIds.length > 0
          ? Voter.find({ householdId: { $in: hhIds }, organizationId: orgId }, VOTER_DELTA_PROJ).lean()
          : Promise.resolve([]),
        scope.length > 0
          ? Voter.find(
              { householdId: { $in: scope }, organizationId: orgId, updatedAt: { $gt: sinceDate } },
              VOTER_DELTA_PROJ
            ).lean()
          : Promise.resolve([]),
      ]);
      const seen = new Set(byHousehold.map((v) => String(v._id)));
      const raw = [...byHousehold, ...byOwnEdit.filter((v) => !seen.has(String(v._id)))];
      if (raw.length > 0) {
        const [votedRecs, surveyedThisRound] = await Promise.all([
          VotedVoter.find(
            { campaignId: cId, voterId: { $in: raw.map((v) => v._id) } },
            { voterId: 1 }
          ).lean(),
          // Per-round voter state (same rewrite as the bootstrap) so a delta can't
          // re-introduce the global "ever surveyed" for a round-fresh voter.
          surveyedVotersFromDoorPass(doorPass),
        ]);
        const votedSet = new Set(votedRecs.map((r) => String(r.voterId)));
        changedVoters = raw.map((v) =>
          stampPerRoundSurvey(toWireVoter(v, votedSet.has(String(v._id))), doorPass, surveyedThisRound, req.user._id)
        );
      }
    }

    res.json({
      serverTime: new Date().toISOString(),
      households: changedHouseholds,
      voters: changedVoters,
      // For round-change detection: if this differs from the client's bootstrap
      // set, a round activated/archived → the client refetches the bootstrap.
      activePassIds: (await activePassIds(cId)).map(String),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
