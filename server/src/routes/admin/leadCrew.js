import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireCampaignManager } from '../../middleware/auth.js';
import { refuseVendorStaffTarget } from '../../services/memberships/vendorGuards.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { NOT_DELETING } from '../../services/campaigns/deletionState.js';
import { Membership } from '../../models/Membership.js';
import { User } from '../../models/User.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import {
  createOrgMember,
  MemberError,
  memberIdentityShape,
  resolveCoordinatorId,
  resolveEmailInOrg,
} from '../../services/memberships/createMember.js';
import { crewResolveLimiters } from '../../middleware/crewResolveLimit.js';
import { addAuditSubjects } from '../../services/access/supportAccess.js';
import { isOrgAdmin } from '../../services/authz/campaignManagement.js';
import { assertCampaignWritable } from '../../middleware/campaignWritable.js';
import {
  setMemberCoordinator,
  restampSummary,
  joinCampaignCrew,
  planCrewJob,
  finishItOffered,
  CREW_JOB,
} from '../../services/memberships/setCoordinator.js';
import { coordinatorPreviewBody, historyByTeam, bulkPlan } from '../../services/memberships/restampCoordinator.js';
import { mapWithLimit } from '../../utils/mapWithLimit.js';
import {
  isLastBillingAdmin,
  strandsBilling,
  LAST_BILLING_ADMIN_ERROR,
} from '../../services/memberships/billingGuards.js';
import { sendMail } from '../../services/mail/mailer.js';
import { inviteSetPassword, addedToOrg, addedToCampaign } from '../../services/mail/templates.js';
import { issuePasswordResetToken, INVITE_TOKEN_HOURS } from '../../services/auth/passwordReset.js';
import { convergeIfDeleted } from '../../services/users/deleteAccount.js';

// A team lead's crew surface, scoped to ONE campaign they manage (requireCampaignManager
// gates the mount): list org members to add, create a brand-new canvasser (or link a
// returning one by email) onto this campaign, set a crew member's coordinator — one person, or
// several at once (coordinator-bulk) — and switch a canvasser's access off and back on.
// Adding/removing existing members and reading the roster still go through .../assignments, where a
// lead may add only themselves by id and remove only canvassers and themselves (PRIVACY_VERIFICATION
// item 41).
//
// Every crew change here runs as one job through services/memberships/setCoordinator.js, which keeps
// the change on the person's roster row so it can't be left half-done (docs/PROPOSAL_PEOPLE_PAGES.md
// §B.6): a collision answers 409 `changed-meanwhile` (the crew moved since the caller looked) or
// `busy` (another change for this person is still running, with retryAfterSeconds).
//
// It used to say this router gave a lead crew-building "WITHOUT the org-wide Users administration."
// That stopped being true when deactivate/reactivate landed — see the warning below and
// docs/ROLES.md. Everything ELSE here is still campaign-shaped.
//
// ⚠️ ONE ROUTE HERE IS NOT CAMPAIGN-SHAPED. deactivate/reactivate write Membership.isActive, and
// Membership has NO campaignId (models/Membership.js) — one row per person per ORG. So that write
// reaches every campaign in the org, including ones this lead does not manage. It is deliberate and
// disclosed rather than prevented (the response carries `alsoAffects` so the UI can name the other
// campaigns before committing), but it means the usual "the URL param bounds the blast radius"
// reasoning does NOT hold for those two routes. Guard them on the target, not on the campaign.
const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireCampaignManager);

// An ARCHIVED campaign is read-only, and this router was the hole in that: adding an EXISTING person
// to a finished campaign correctly 409'd (assignments.js mounts the guard), while "+ New canvasser"
// here would happily mint an account and roster them onto it.
//
// Applied per-route rather than on the whole router, because two routes here are deliberately NOT
// campaign writes. deactivate/reactivate set Membership.isActive, which has no campaignId — an
// org-wide act that merely arrives through a campaign URL, and freezing it would strand an operator
// whose only campaign is archived. /resolve writes nothing at all.
const requireWritableCampaign = (campaign, res) => assertCampaignWritable(res, campaign);

// Vendor writes: a support grant now permits crew administration — every write recorded by
// middleware/accessLog.js — with ONE refusal: any membership write targeting a Doorline staff
// account. Rule + rationale in services/memberships/vendorGuards.js, shared with memberships.js
// so an identical write can never be 200 through one door and 403 through the other.

function activeOrgId(req) {
  return req.activeOrg?._id;
}

async function loadOwnedCampaign(req) {
  if (!mongoose.isValidObjectId(req.params.campaignId)) return null;
  const orgId = activeOrgId(req);
  if (!orgId) return null;
  // NOT_DELETING: a mid-delete campaign reads as gone (services/campaigns/deletionState.js).
  const campaign = await Campaign.findOne({ _id: req.params.campaignId, organizationId: orgId, ...NOT_DELETING });
  return campaign || null;
}

// A lead builds their crew the same way an org admin adds a member on the Users page:
// create a brand-new canvasser, OR link an EXISTING global account by email (a lead owns
// onboarding, and a returning canvasser may already have a Door Line login from another
// org). memberIdentityShape carries the same email-link / new-account rules and privacy
// guards the admin path uses; createOrgMember enforces name+password on the create-new path.
const createSchema = z.object({
  ...memberIdentityShape,
  coordinatorId: z.string().nullable().optional(),
});

// THIS CAMPAIGN'S people. Not the organization's.
//
// It used to be `Membership.find({ organizationId, isActive: true })` — every active member of the
// whole org, with name and email, handed to whoever could open a campaign they manage. That made
// the campaign Team page's add-picker a directory of the entire organization for a team lead, who
// may be the CLIENT's own campaign manager and has no business seeing another client's staff. Worse,
// it was WIDER than the org Users list the same lead gets (memberships.js scopes that one to their
// managed campaigns), so the careful scoping there was undone by the campaign page's own picker.
//
// Adding someone now goes through POST /resolve + POST / (type an address), never by browsing.
//
// Rows narrowed, FIELDS UNCHANGED — deliberately. The shipped mobile app reads this list for its
// book-assign pickers and already intersects it with the campaign roster
// (mobile/app/(app)/admin/books.jsx), so narrowing the rows is a no-op there; removing a field would
// not have been.
router.get('/', async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    // The crew is a per-campaign fact, so it comes off THIS campaign's roster rows — not off the
    // org membership, which has no campaign and used to hand every campaign the same answer.
    const roster = await CampaignAssignment.find(
      { campaignId: campaign._id },
      'userId coordinatorId'
    ).lean();
    const crewByUser = new Map(
      roster.map((r) => [String(r.userId), r.coordinatorId ? String(r.coordinatorId) : null])
    );
    const [memberships, eligibleCoordinators] = await Promise.all([
      Membership.find({
        organizationId: campaign.organizationId,
        isActive: true,
        userId: { $in: roster.map((r) => r.userId) },
      })
        .populate({ path: 'userId', select: 'firstName lastName email isActive isSuperAdmin' })
        .sort({ createdAt: -1 })
        .lean(),
      // Who may RUN a crew is an org-level fact, not a roster one: resolveCoordinatorId accepts any
      // active admin or lead in the org (services/memberships/createMember.js), and managing a
      // campaign deliberately does not put you on its roster. Derive the picker from the same rule
      // the write enforces, or the crew dropdown collapses to "nobody" on a campaign whose lead
      // doesn't walk it. Admins and leads only — never the canvasser body of the org.
      Membership.find({
        organizationId: campaign.organizationId,
        isActive: true,
        role: { $in: ['admin', 'lead'] },
      })
        .populate({ path: 'userId', select: 'firstName lastName isActive' })
        .lean(),
    ]);
    res.json({
      members: memberships
        .filter((m) => m.userId && m.userId.isActive)
        .map((m) => ({
          role: m.role,
          isActive: m.isActive,
          coordinatorId: crewByUser.get(String(m.userId._id)) ?? null,
          user: {
            id: String(m.userId._id),
            firstName: m.userId.firstName,
            lastName: m.userId.lastName,
            email: m.userId.email,
            isActive: m.userId.isActive,
            isSuperAdmin: !!m.userId.isSuperAdmin,
          },
        })),
      // Name and role only — no email. This is a list of who can be picked as a coordinator, not a
      // directory, and it is the one org-level fact this endpoint still answers.
      coordinators: eligibleCoordinators
        .filter((m) => m.userId && m.userId.isActive)
        .map((m) => ({
          id: String(m.userId._id),
          firstName: m.userId.firstName,
          lastName: m.userId.lastName,
          role: m.role,
        })),
    });
  } catch (err) {
    next(err);
  }
});

// "Who owns this address, here?" — the lookup behind the Team page's add box.
//
// POST, not GET: the address is a person's identifier and has no business in a URL, a browser
// history entry, or a proxy log. Rate-limited per actor: 60 lookups an hour that find nobody, 30 that
// name somebody (middleware/crewResolveLimit.js). An answer that names somebody also adds them to the
// record-level audit subjects, which AccessLog keeps only for Doorline staff working under a support
// grant (middleware/accessLog.js) — not for a customer's own staff.
//
// The org boundary is the whole design; see resolveEmailInOrg. The response carries `outcome` and
// `person` (plus, for a named person, this campaign's history and, when switched off, whether they're
// already on it) — never the resolver's internal `user`/`membership`, which would leak the existence of
// accounts belonging to other customers. The `outside` body is byte-identical for every address.
const resolveSchema = z.object({ email: memberIdentityShape.email });

// A named person's doors on THIS campaign, by the team they count for today, newest team first, so the
// add step can say "120 doors here from before: 100 on Dana's team" and pre-pick the newest team when
// its coordinator can still run a crew (`canLead`, the same rule resolveCoordinatorId enforces).
const campaignHistory = async ({ orgId, campaignId, userId }) => {
  const history = await historyByTeam({ organizationId: orgId, userId, campaignId });
  const teams = history.teams.filter((t) => t.doors > 0);
  const ids = teams.map((t) => t.coordinatorId).filter(Boolean);
  const [people, leaders] = await Promise.all([
    ids.length ? User.find({ _id: { $in: ids } }, 'firstName lastName').lean() : [],
    ids.length ? Membership.find({ organizationId: orgId, userId: { $in: ids }, isActive: true, role: { $in: ['admin', 'lead'] } }, 'userId').lean() : [],
  ]);
  const nameOf = new Map(people.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
  const canLead = new Set(leaders.map((m) => String(m.userId)));
  return {
    doors: history.doors,
    sources: teams.map((t) => {
      const id = t.coordinatorId ? String(t.coordinatorId) : null;
      return { coordinatorId: id, name: id ? nameOf.get(id) || 'Unknown' : null, doors: t.doors, canLead: id ? canLead.has(id) : false };
    }),
  };
};

router.post('/resolve', ...crewResolveLimiters, async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const { email } = resolveSchema.parse(req.body);
    const orgId = activeOrgId(req);
    const found = await resolveEmailInOrg({ orgId, campaignId: campaign._id, email });
    // Which limiter keeps this lookup (crewResolveLimit.js): one that finds nobody, or one that names.
    res.locals.lookup = found.outcome === 'outside' ? 'outside' : 'named';
    if (!found.person) return res.json({ outcome: found.outcome, person: null });
    addAuditSubjects(res, 'user', found.person.userId);
    res.json({
      outcome: found.outcome,
      person: found.person,
      history: await campaignHistory({ orgId, campaignId: campaign._id, userId: found.user._id }),
      ...(found.outcome === 'in-org-inactive' ? { onCampaign: !!found.onCampaign } : {}),
    });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Put a person on this campaign, keyed on their EMAIL ADDRESS. One door for all four cases: a
// brand-new canvasser, a colleague already in the org, someone already on this very campaign, and
// an address that turns out to belong to an account elsewhere on the platform.
//
// RESOLVE FIRST, THEN BRANCH. The caller's `linkExisting` is accepted (already-released mobile
// binaries still send it) but IGNORED — what the address actually resolves to decides, so no client
// can pick the wrong door and no operator has to guess a checkbox. That also retires the
// EMAIL_EXISTS_USE_LINK / ALREADY_MEMBER round trip: both were the server asking the client to try
// again with different intent, and both are now outcomes this handler simply completes.
//
// The typed name and password apply ONLY when we genuinely mint an account. If the address already
// has one, we attach the real person and drop what was typed on the floor — overwriting a
// stranger's name would be a lie, and setting their password would be a takeover (the per-user
// password reaches every org they belong to; docs/PRIVACY_VERIFICATION.md item 14).
// Names for the teams a person's earlier doors came from, for an answer's `restamp.sources`.
const namedSources = async (sources) => {
  const ids = (sources || []).map((x) => x.coordinatorId).filter(Boolean);
  const people = ids.length ? await User.find({ _id: { $in: ids } }, 'firstName lastName').lean() : [];
  const nameOf = new Map(people.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
  return (sources || []).map((x) => {
    const id = x.coordinatorId ? String(x.coordinatorId) : null;
    return { coordinatorId: id, name: id ? nameOf.get(id) || 'Unknown' : null, doors: x.doors || 0 };
  });
};

router.post('/', async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!requireWritableCampaign(campaign, res)) return;
    const orgId = activeOrgId(req);
    const data = createSchema.parse(req.body);
    if (await refuseVendorStaffTarget(req, res, { email: data.email })) return;

    // 1. Who the address belongs to, here.
    const found = await resolveEmailInOrg({ orgId, campaignId: campaign._id, email: data.email });

    // 2. The crew, validated before anything is written. Only a NAMED person gets the
    // can't-be-your-own-coordinator check: for an `outside` address the check would have to use the
    // account behind it, and its 400 would then say whether the address belongs to that account — a
    // cross-tenant oracle. An outside person can't be a coordinator here anyway (they aren't a member).
    const named = found.outcome !== 'outside';
    const coordRes = await resolveCoordinatorId({ orgId, raw: data.coordinatorId, memberUserId: named ? found.user._id : null });
    if (!coordRes.ok) return res.status(400).json({ error: coordRes.error });
    const coordinatorId = coordRes.value ?? null;

    // A membership that has been switched off is not a roster problem, and rostering them would
    // leave a row for someone who cannot sign in. Reactivating is an ORG-wide act: an admin may do
    // it inline, a lead must ask — the same boundary memberships.js draws for a target who isn't on
    // one of their campaigns yet.
    if (found.outcome === 'in-org-inactive') {
      if (!isOrgAdmin(req)) {
        return res.status(409).json({
          error: `${found.person.firstName} ${found.person.lastName} is in your organization but their account is switched off. An org admin can switch it back on.`,
          code: 'MEMBER_DEACTIVATED',
          person: found.person,
        });
      }
      await Membership.updateOne({ _id: found.membership._id }, { $set: { isActive: true } });
    }

    const unchanged = (user, outcome) => ({
      user: user.toSafeJSON(),
      outcome,
      attached: false,
      restamp: { ...restampSummary({ changed: false }), sources: [] },
    });

    // 3. Already on this campaign: an add changes nothing — crew included — and sends no email
    // (teamLead.int.test.js pins this as idempotent). It used to $set the crew it was sent, which
    // cleared the crew of anyone whose email was typed in again with none picked, and let the second
    // of two simultaneous adds move a person a second time with no check. A switched-off person
    // already here was switched back on just above, and nothing else changes for them either.
    if (found.onCampaign) {
      if (await convergeIfDeleted({ userId: found.user._id, organizationId: orgId, campaignId: campaign._id })) {
        return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });
      }
      return res.status(201).json(unchanged(found.user, found.outcome));
    }

    let user = found.user;
    // 'claim' — already ours, just not on this campaign. No membership write, so nobody is silently
    // promoted or demoted.
    const claiming = named;
    // 'attach' — the address has an account, but not one of ours. The operator does not learn that
    // until this succeeds, which is the point: the answer costs a real add and an email to the
    // person, instead of being a free probe.
    const attaching = !claiming && !!found.user;
    if (!claiming) {
      try {
        ({ user } = await createOrgMember({
          orgId,
          addedBy: req.user._id,
          // The resolution decides, not the request: an address with an account elsewhere is linked,
          // a free one is created. `data` still carries the typed name/password, which
          // createOrgMember uses only on the create branch.
          data: { ...data, linkExisting: attaching },
          role: 'canvasser', // a lead can only create/link canvassers for their crew
          // New accounts get a temp password + forced change on first login. A linked existing
          // account keeps its own password (the flag only applies on the create-new branch).
          mustChangePassword: true,
        }));
      } catch (err) {
        if (err instanceof MemberError) return res.status(err.status).json({ error: err.message, code: err.code });
        throw err;
      }
    }

    // 4. Join: the roster insert is the claim, with the crew picked (or none), and the person's
    // earlier doors on this campaign move to it (services/memberships/setCoordinator.js). An account
    // linked back in can have history here — org removal deletes the membership, not the ledger.
    const joined = await joinCampaignCrew({
      organizationId: orgId,
      campaignId: campaign._id,
      userId: user._id,
      coordinatorId,
      actorUserId: req.user._id,
      source: 'campaign_join',
    });
    // Somebody else's add inserted the row first: nothing moved here, and the answer is the same
    // no-op an add of someone already on the campaign gets.
    if (!joined.joined) return res.status(201).json(unchanged(user, 'on-campaign'));
    // An account deleted while this add ran (its inline reactivation or roster row landing after the
    // deletion released everything) is put back the way the deletion left it. After the LAST write.
    if (await convergeIfDeleted({ userId: user._id, organizationId: orgId, campaignId: campaign._id })) {
      return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });
    }

    // EXACTLY ONE email per add, and only for a row this add inserted — best-effort, never awaited (a
    // mail hiccup must not fail the add). A new account gets a set-password invite naming BOTH the org
    // and this campaign; an account attached from elsewhere gets the no-credentials "added to the org"
    // note; a colleague we claimed onto the campaign gets the campaign note, unless they haven't set a
    // password yet (their invite already named this campaign).
    if (attaching) {
      sendMail({ to: user.email, ...addedToOrg({ firstName: user.firstName, orgName: req.activeOrg.name, campaignName: campaign.name, role: 'canvasser' }), kind: 'addedToOrg', meta: { organizationId: req.activeOrg._id, organizationName: req.activeOrg.name, userId: user._id } });
    } else if (claiming) {
      if (user.email && !user.mustChangePassword) {
        sendMail({ to: user.email, ...addedToCampaign({ firstName: user.firstName, orgName: req.activeOrg.name, campaignName: campaign.name, role: found.person.role }), kind: 'addedToCampaign', meta: { organizationId: req.activeOrg._id, organizationName: req.activeOrg.name, userId: user._id } });
      }
    } else {
      const { url } = await issuePasswordResetToken(user._id, { hours: INVITE_TOKEN_HOURS });
      // A url only comes back null for an account deleted in the meantime; there is nobody to invite.
      if (url) sendMail({ to: user.email, ...inviteSetPassword({ firstName: user.firstName, orgName: req.activeOrg.name, campaignName: campaign.name, setPasswordUrl: url, role: 'canvasser' }), kind: 'inviteSetPassword', meta: { organizationId: req.activeOrg._id, organizationName: req.activeOrg.name, userId: user._id } });
    }

    // `outcome` tells the client which sentence to say. `attached` is the one that matters: it means
    // the typed name was discarded in favour of a real person the operator had not met yet, so the
    // UI must name who actually landed on the roster rather than echoing what was typed.
    // `restamp` says what moved and from which teams (newest first), for the result screen.
    res.status(201).json({
      user: user.toSafeJSON(),
      outcome: attaching ? 'attached' : found.outcome === 'outside' ? 'created' : found.outcome,
      attached: attaching,
      restamp: { ...restampSummary({ ...joined, changed: true }), sources: await namedSources(joined.sources) },
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Conflict' });
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Only a NEW pick is validated: repeating the current crew (the panel's open-time preview, Finish it)
// is not, because switching a coordinator off or changing their role leaves their crews in place, and
// validating would refuse that crew's members a panel and leave their unfinished jobs unfinishable.
// Returns { ok, value, repeat } like resolveCoordinatorId, or the 400 body.
const crewPick = async ({ orgId, raw, current, memberUserId }) => {
  if (raw === undefined) return { ok: false, error: 'coordinatorId is required' };
  const pick = raw === null || raw === '' ? null : raw;
  if (String(pick) === String(current ?? null)) return { ok: true, value: current ?? null, repeat: true };
  const res = await resolveCoordinatorId({ orgId, raw: pick, memberUserId });
  return res.ok ? { ok: true, value: res.value ?? null, repeat: false } : res;
};

// Dry run of the coordinator change, so the lead sees what moves before it commits. Same builder
// and same filter as the write — see services/memberships/restampCoordinator.js. With the CURRENT crew
// as the pick it is what the panel runs when it opens a person: `unfinished`, `busy` and the rows still
// off their crew decide whether Finish it shows (`finishIt`).
router.get('/:userId/coordinator-preview', async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!mongoose.isValidObjectId(req.params.userId)) return res.status(400).json({ error: 'Invalid userId' });
    const orgId = activeOrgId(req);

    const onCampaign = await CampaignAssignment.findOne(
      { campaignId: campaign._id, userId: req.params.userId },
      'coordinatorId'
    ).lean();
    if (!onCampaign) return res.status(404).json({ error: 'That member is not on this campaign' });

    const pick = await crewPick({
      orgId,
      raw: req.query.coordinatorId === 'none' ? null : req.query.coordinatorId,
      current: onCampaign.coordinatorId,
      memberUserId: req.params.userId,
    });
    if (!pick.ok) return res.status(400).json({ error: pick.error });

    const [body, plan] = await Promise.all([
      coordinatorPreviewBody({
        orgId,
        userId: req.params.userId,
        campaignId: campaign._id,
        from: onCampaign.coordinatorId ?? null,
        to: pick.value,
      }),
      planCrewJob({ organizationId: orgId, campaignId: campaign._id, userId: req.params.userId, to: pick.value }),
    ]);
    res.json({
      ...body,
      unfinished: plan.unfinished,
      busy: plan.busy,
      retryAfterSeconds: plan.retryAfterSeconds,
      sources: await namedSources(plan.sources),
      finishIt: pick.repeat ? finishItOffered(plan) : false,
    });
  } catch (err) {
    next(err);
  }
});

// The 409s a crew change can answer, worded for the person who made it.
const crewConflict = (res, r) => {
  if (r.skip === 'busy') {
    return res.status(409).json({
      error: 'Another change for this person is still finishing — try again in a minute or two.',
      code: 'busy',
      retryAfterSeconds: r.retryAfterSeconds,
    });
  }
  return res.status(409).json({
    error: 'Their crew changed since you looked. Check it again before changing it.',
    code: 'changed-meanwhile',
    now: r.now ?? null,
  });
};

// Set (or clear) a crew member's coordinator. Scoped to this campaign's roster so a
// lead can only reorganize their own crew, not arbitrary org members.
//
// `fromCoordinatorId` is the crew the caller previewed: an id, or null for No crew (`Object.hasOwn`
// tells null from absent). A change only goes through if the crew is still that. A released client
// sends none, and the server uses the crew it just read — except for a repeat of that crew, which
// skips validation and so is held to the crew it read, or a switched-off coordinator re-sent just as
// someone else moves the person would become an unvalidated new pick.
router.patch('/:userId/coordinator', async (req, res, next) => {
  try {
    if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return;
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    // Setting a crew re-stamps this campaign's ledger history onto the new coordinator, so it is a
    // write to frozen reporting on an archived campaign, not just a roster tweak.
    if (!requireWritableCampaign(campaign, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) return res.status(400).json({ error: 'Invalid userId' });
    const orgId = activeOrgId(req);

    const onCampaign = await CampaignAssignment.findOne({ campaignId: campaign._id, userId: req.params.userId }, 'coordinatorId').lean();
    if (!onCampaign) return res.status(404).json({ error: 'That member is not on this campaign' });

    const body = req.body || {};
    const pick = await crewPick({ orgId, raw: body.coordinatorId, current: onCampaign.coordinatorId, memberUserId: req.params.userId });
    if (!pick.ok) return res.status(400).json({ error: pick.error });

    let from;
    if (Object.hasOwn(body, 'fromCoordinatorId')) {
      const f = body.fromCoordinatorId;
      if (f === null || f === '') from = null;
      else if (mongoose.isValidObjectId(f)) from = String(f);
      else return res.status(400).json({ error: 'Invalid fromCoordinatorId' });
    } else if (pick.repeat) {
      from = onCampaign.coordinatorId ?? null;
    }

    // setMemberCoordinator also RE-STAMPS this person's knock history onto the new team — scoped to
    // THIS campaign, keyed on req.params.campaignId. That the campaign id comes from the URL is
    // load-bearing, not incidental: requireCampaignManager gates on the same param, so a lead
    // physically cannot address a campaign they were not granted. Taking it from the body would
    // reopen exactly that hole.
    const restamp = await setMemberCoordinator({
      organizationId: orgId,
      userId: req.params.userId,
      campaignId: campaign._id,
      coordinatorId: pick.value,
      actorUserId: req.user._id,
      source: 'lead_crew',
      from,
    });
    if (!restamp) return res.status(404).json({ error: 'That member is not on this campaign' });
    if (restamp.skip === 'busy' || restamp.skip === 'changed-meanwhile' || restamp.skip === 'lost-hold') {
      return crewConflict(res, restamp);
    }
    res.json({
      ok: true,
      coordinatorId: restamp.next !== undefined ? (restamp.next ? String(restamp.next) : null) : pick.value ? String(pick.value) : null,
      restamp: restampSummary(restamp),
      finished: !!restamp.finished,
    });
  } catch (err) {
    next(err);
  }
});

// ── Several people at once: Move to crew… (docs/PROPOSAL_PEOPLE_PAGES.md §B.3) ─────────────────────
//
// The preview takes the whole selection (up to 500) in one call, because its door total must be exact
// and deduplicated across everyone moving — one knocksPipeline over all of them. The write takes up to
// 10 people per request, each through the same job as a single change, with the `from` its preview
// showed. Neither gives any power the single routes don't.
//
// Skips, per person:
//   not-on-campaign   a lead's id that isn't on this campaign's roster — checked FIRST, and the row
//                     names no one and counts nothing, so a lead learns nothing about it; also anyone's
//                     id off the roster in the write, and in a preview with intent 'move'
//   not-in-org        an admin's id with no membership in this org (no name either)
//   already-on-campaign   an id on the roster, in a preview with intent 'join' (an add leaves them be)
//   deleted, switched-off   an admin's id off the roster whose account is deleted, or whose membership
//                     here is switched off: they can't be added (POST …/assignments refuses them too)
//   staff             Doorline staff, for a lead or under a support grant (after the roster check)
//   is-coordinator    the person is the coordinator being picked
//   same-crew         the roster crew already equals the pick, no job is on the row, and either the
//                     pick is No crew or nothing would move
//   changed-meanwhile, busy   from the job (§B.6)
const bulkPreviewSchema = z.object({
  userIds: z.array(z.string()).min(1).max(500),
  coordinatorId: z.string().nullable(),
  // Which write the preview is for, so its totals are exactly what that write does: 'move' (PATCH
  // …/coordinator-bulk, which never adds anyone) leaves out anyone off the roster as not-on-campaign;
  // 'join' (POST …/assignments, which never re-crews anyone) leaves out anyone already on it as
  // already-on-campaign. Absent: both kinds are modelled, as the first clients of this route expected.
  intent: z.enum(['move', 'join']).optional(),
});
const bulkWriteSchema = z.object({
  people: z
    .array(z.object({ userId: z.string(), from: z.string().nullable().optional() }))
    .min(1)
    .max(10),
  coordinatorId: z.string().nullable(),
});

// Who among `ids` is on this campaign's roster, who is a member of the org (and switched on), and who
// is staff or a deleted account.
const bulkFacts = async ({ campaignId, orgId, ids }) => {
  const [rows, memberships, flagged] = await Promise.all([
    CampaignAssignment.find({ campaignId, userId: { $in: ids } }, 'userId coordinatorId crewJob').lean(),
    Membership.find({ organizationId: orgId, userId: { $in: ids } }, 'userId isActive').lean(),
    User.find({ _id: { $in: ids }, $or: [{ isSuperAdmin: true }, { deletedAt: { $ne: null } }] }, 'isSuperAdmin deletedAt').lean(),
  ]);
  return {
    rowOf: new Map(rows.map((r) => [String(r.userId), r])),
    inOrg: new Set(memberships.map((m) => String(m.userId))),
    switchedOn: new Set(memberships.filter((m) => m.isActive).map((m) => String(m.userId))),
    isStaff: new Set(flagged.filter((u) => u.isSuperAdmin).map((u) => String(u._id))),
    isDeleted: new Set(flagged.filter((u) => u.deletedAt).map((u) => String(u._id))),
  };
};

// The first skip that applies to one person, in the order a lead must see them.
//
// Someone off the roster is only ever PREVIEWED, and only for an org admin: the add from the
// organization (web) and Assign all shown (phone) preview their joins here, then add them through
// POST …/assignments, which checks the membership again. The WRITE never joins anyone (`write`): a
// row missing at write time is someone removed since the preview, and joining them would undo that
// removal — or put a deleted account back on the roster with its doors moved.
const bulkSkip = ({ id, to, facts, lead, vendor, write = false }) => {
  const row = facts.rowOf.get(id);
  if (!row) {
    if (lead || write) return 'not-on-campaign';
    if (!facts.inOrg.has(id)) return 'not-in-org';
    if (facts.isDeleted.has(id)) return 'deleted';
    if (!facts.switchedOn.has(id)) return 'switched-off';
  }
  if (facts.isStaff.has(id) && (lead || vendor)) return 'staff';
  if (to && id === String(to)) return 'is-coordinator';
  return null;
};

const validateBulkPick = async ({ orgId, raw }) => {
  const coordRes = await resolveCoordinatorId({ orgId, raw, memberUserId: null });
  return coordRes.ok ? { ok: true, value: coordRes.value ?? null } : coordRes;
};

router.post('/coordinator-bulk/preview', async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const orgId = activeOrgId(req);
    const { userIds, coordinatorId: raw, intent } = bulkPreviewSchema.parse(req.body);
    const ids = [...new Set(userIds)];
    if (ids.length !== userIds.length) return res.status(400).json({ error: 'Each person can appear once.' });
    if (ids.some((id) => !mongoose.isValidObjectId(id))) return res.status(400).json({ error: 'Invalid userId in list' });
    const pick = await validateBulkPick({ orgId, raw });
    if (!pick.ok) return res.status(400).json({ error: pick.error });
    const to = pick.value;
    const lead = !isOrgAdmin(req);
    const vendor = !!req.supportGrant;

    const facts = await bulkFacts({ campaignId: campaign._id, orgId, ids });
    // A bare No-crew repeat moves nothing (setMemberCoordinator: what every departure leaves), so it
    // is skipped before the plan and stays out of the door total.
    const noCrewRepeat = (id) => {
      const row = facts.rowOf.get(id);
      return !!row && !to && !row.coordinatorId && !row.crewJob?.token;
    };
    const alreadyHere = (id) => intent === 'join' && facts.rowOf.has(id);
    const skipOf = new Map(
      ids.map((id) => [
        id,
        bulkSkip({ id, to, facts, lead, vendor, write: intent === 'move' }) ||
          (alreadyHere(id) ? 'already-on-campaign' : null) ||
          (noCrewRepeat(id) ? 'same-crew' : null),
      ])
    );
    const now = Date.now();
    // A change still running for someone makes them `busy`; they are left out of the door total too,
    // so the total stays exactly what this move would change.
    const heldJob = (id) => {
      const job = facts.rowOf.get(id)?.crewJob;
      return job?.token && new Date(job.until).getTime() >= now ? job : null;
    };
    const movers = ids.filter((id) => !skipOf.get(id) && !heldJob(id));
    const [plan, runsCrew, people] = await Promise.all([
      bulkPlan({ organizationId: orgId, campaignId: campaign._id, userIds: movers, coordinatorId: to }),
      movers.length ? CampaignAssignment.distinct('coordinatorId', { campaignId: campaign._id, coordinatorId: { $in: movers } }) : [],
      User.find({ _id: { $in: ids.filter((id) => skipOf.get(id) !== 'not-on-campaign' && skipOf.get(id) !== 'not-in-org') } }, 'firstName lastName').lean(),
    ]);
    const runsCrewSet = new Set(runsCrew.map(String));
    const nameOf = new Map(people.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
    const sourceIds = [...new Set([...plan.byUser.values()].flatMap((p) => p.sources.map((x) => x.coordinatorId).filter(Boolean).map(String)))];
    const sourcePeople = sourceIds.length ? await User.find({ _id: { $in: sourceIds } }, 'firstName lastName').lean() : [];
    const sourceName = new Map(sourcePeople.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));

    const totals = { people: 0, doors: plan.totalDoors, activities: 0, surveys: 0 };
    const rows = ids.map((id) => {
      const skip = skipOf.get(id);
      if (skip === 'not-on-campaign' || skip === 'not-in-org') return { userId: id, skip };
      const row = facts.rowOf.get(id) || null;
      const base = { userId: id, name: nameOf.get(id) || 'Unknown', onCampaign: !!row, from: row?.coordinatorId ? String(row.coordinatorId) : null };
      if (skip) return { ...base, skip };
      const p = plan.byUser.get(id) || { sources: [], activities: 0, surveys: 0, doors: 0 };
      const job = row?.crewJob?.token ? row.crewJob : null;
      const held = !!heldJob(id);
      const out = {
        ...base,
        sources: p.sources.map((x) => {
          const sid = x.coordinatorId ? String(x.coordinatorId) : null;
          return { coordinatorId: sid, name: sid ? sourceName.get(sid) || 'Unknown' : null, doors: x.doors };
        }),
        doors: p.doors,
        activities: p.activities,
        surveys: p.surveys,
        subjectRunsCrew: runsCrewSet.has(id),
        unfinished: !!job && !held,
        busy: held,
      };
      if (held) return { ...out, skip: 'busy', retryAfterSeconds: Math.max(1, Math.ceil((new Date(job.until).getTime() - now) / 1000)) };
      if (row && String(row.coordinatorId ?? null) === String(to ?? null) && !job && (!to || !(p.activities + p.surveys))) {
        return { ...out, skip: 'same-crew' };
      }
      totals.people += 1;
      totals.activities += p.activities;
      totals.surveys += p.surveys;
      return out;
    });
    res.json({ to: to ? String(to) : null, people: rows, totals });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.patch('/coordinator-bulk', async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!requireWritableCampaign(campaign, res)) return;
    const orgId = activeOrgId(req);
    const { people, coordinatorId: raw } = bulkWriteSchema.parse(req.body);
    const ids = people.map((p) => p.userId);
    if (new Set(ids).size !== ids.length) return res.status(400).json({ error: 'Each person can appear once.' });
    if (ids.some((id) => !mongoose.isValidObjectId(id))) return res.status(400).json({ error: 'Invalid userId in list' });
    // Validated once, up front.
    const pick = await validateBulkPick({ orgId, raw });
    if (!pick.ok) return res.status(400).json({ error: pick.error });
    const to = pick.value;
    const lead = !isOrgAdmin(req);
    const facts = await bulkFacts({ campaignId: campaign._id, orgId, ids });

    const answer = (userId, r) => ({
      userId,
      changed: !!r?.changed,
      finished: !!r?.finished,
      doors: r?.doors || 0,
      activities: r?.activities || 0,
      surveys: r?.surveys || 0,
      error: r?.restampError || null,
      ...(r?.skip ? { skip: r.skip } : {}),
      ...(r?.retryAfterSeconds ? { retryAfterSeconds: r.retryAfterSeconds } : {}),
    });
    // The request's jobs run four at a time, so their second-pass waits overlap.
    const results = await mapWithLimit(people, CREW_JOB.sideBySide, async (p) => {
      const id = String(p.userId);
      const skip = bulkSkip({ id, to, facts, lead, vendor: !!req.supportGrant, write: true });
      if (skip) return { userId: id, changed: false, skip };
      try {
        const r = await setMemberCoordinator({
          organizationId: orgId,
          userId: id,
          campaignId: campaign._id,
          coordinatorId: to,
          actorUserId: req.user._id,
          source: 'lead_crew',
          from: Object.hasOwn(p, 'from') ? p.from ?? null : undefined,
        });
        if (!r) return answer(id, { skip: 'not-on-campaign' });
        return answer(id, r.skip === 'lost-hold' ? { ...r, skip: 'changed-meanwhile' } : r);
      } catch (err) {
        return { userId: id, changed: false, error: err?.message || String(err) };
      }
    });
    res.json({ to: to ? String(to) : null, results });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// The OTHER campaigns a status change reaches. Membership.isActive is org-wide, so switching
// someone off here switches them off everywhere — including campaigns this lead does not manage.
// Returned on both routes so the UI can say so BEFORE committing, the same way the crew change
// quotes its door count. Disclosure is the mitigation; there is no campaign-scoped version of this
// write to fall back on.
async function otherCampaignsFor({ userId, organizationId, exceptCampaignId }) {
  const rows = await CampaignAssignment.find(
    { userId, organizationId, campaignId: { $ne: exceptCampaignId } },
    'campaignId'
  ).lean();
  if (!rows.length) return [];
  const campaigns = await Campaign.find(
    { _id: { $in: rows.map((r) => r.campaignId) } },
    'name'
  ).lean();
  return campaigns.map((c) => ({ campaignId: String(c._id), name: c.name }));
}

// Shared by deactivate and reactivate: everything that must be true of the TARGET before either
// write. Returns { error, status } to send, or { membership } to proceed with.
async function loadStatusTarget(req, campaign) {
  if (!mongoose.isValidObjectId(req.params.userId)) {
    return { status: 400, error: 'Invalid userId' };
  }
  const onCampaign = await CampaignAssignment.exists({
    campaignId: campaign._id,
    userId: req.params.userId,
  });
  // Necessary, and since 2026-10-25 a real barrier for a lead too: a lead can no longer put another
  // member on their campaign by id (.../assignments takes only their own id) or by book or walk-list
  // crew (partitionAssignable selfOnlyFor), so the people reachable here are this campaign's team.
  if (!onCampaign) return { status: 404, error: 'That member is not on this campaign' };

  const user = await User.findById(req.params.userId, 'isSuperAdmin deletedAt').lean();
  if (!user) return { status: 404, error: 'Member not in this org' };
  if (user.deletedAt) {
    return { status: 409, error: 'This account was deleted.', code: 'ACCOUNT_DELETED' };
  }
  // A super-admin can hold an ordinary canvasser membership in a customer org (orgContext seats
  // them as a MEMBER when one exists, precisely so their own admin work is not logged as vendor
  // intrusion). Switching that membership off would force Doorline staff onto the support-grant
  // path and poison the very audit trail that ordering exists to keep clean. Never reachable from
  // a customer's console.
  if (user.isSuperAdmin) {
    return { status: 403, error: 'That account can only be managed by Doorline staff.' };
  }
  return { user };
}

// Switch a canvasser's access OFF. Org-wide — see the router note and `alsoAffects`.
router.patch('/:userId/deactivate', async (req, res, next) => {
  try {
    if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return;
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const orgId = activeOrgId(req);

    const target = await loadStatusTarget(req, campaign);
    if (target.error) {
      return res.status(target.status).json({ error: target.error, ...(target.code ? { code: target.code } : {}) });
    }

    const existing = await Membership.findOne({ userId: req.params.userId, organizationId: orgId });
    if (!existing) return res.status(404).json({ error: 'Member not in this org' });
    // A lead may switch off a CANVASSER only. Admins, other leads and their own account stay out of
    // reach — deactivating a membership is unscoped org authority, and requireCampaignManager admits
    // leads, so without this the campaign door would be an escalation path.
    if (existing.role !== 'canvasser') {
      return res.status(403).json({ error: 'Only a canvasser can be deactivated from a campaign.' });
    }
    if (await isLastBillingAdmin(existing)) {
      return res.status(409).json(LAST_BILLING_ADMIN_ERROR);
    }
    const wasBillingAdmin = existing.billingAccess && existing.role === 'admin' && existing.isActive;

    // The role condition lives INSIDE the filter, not in the read above. Read-then-write is a race:
    // a concurrent PATCH promoting this person to {role:'admin', billingAccess:true} would land
    // between the two, and BOTH billing layers were computed against the stale canvasser snapshot.
    // Matching on role here means the write simply misses a doc that stopped qualifying.
    const membership = await Membership.findOneAndUpdate(
      { userId: req.params.userId, organizationId: orgId, role: 'canvasser' },
      { isActive: false },
      { new: true }
    );
    if (!membership) {
      return res.status(409).json({ error: 'That member changed while you were working. Try again.' });
    }

    // Post-write backstop, guarded on whether this write could STRIP a billing admin at all.
    // Without that guard it fires in any org that simply has no billing admin — a legitimate state
    // — and reverts every deactivate with a baffling 409. (It did. A test caught it.)
    //
    // With the canvasser-only filter above, wasBillingAdmin is structurally always false, so this
    // is unreachable today: the race it exists for is already handled by the role living IN the
    // filter, which makes the write miss rather than land. It stays because the guard belongs with
    // the write, so that relaxing the role restriction later cannot silently drop the protection.
    if (wasBillingAdmin && (await strandsBilling(orgId))) {
      await Membership.updateOne({ _id: membership._id }, { isActive: true });
      return res.status(409).json(LAST_BILLING_ADMIN_ERROR);
    }

    // Deliberately NOT releaseAssignedWork. Deactivate is a REVERSIBLE toggle whose inverse sits
    // right below, so their books stay put — someone switched off mid-shift and back on tomorrow
    // expects to still hold them. Only removal from the campaign (.../assignments DELETE) and
    // account deletion release work.
    res.json({
      ok: true,
      isActive: false,
      alsoAffects: await otherCampaignsFor({
        userId: req.params.userId,
        organizationId: orgId,
        exceptCampaignId: campaign._id,
      }),
    });
  } catch (err) {
    next(err);
  }
});

// Switch it back ON. The inverse is what makes the pair defensible: without it a lead could end
// someone's access and be unable to restore it, and their books would be frozen in a state only an
// org admin could unfreeze.
router.patch('/:userId/reactivate', async (req, res, next) => {
  try {
    if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return;
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const orgId = activeOrgId(req);

    const target = await loadStatusTarget(req, campaign);
    if (target.error) {
      return res.status(target.status).json({ error: target.error, ...(target.code ? { code: target.code } : {}) });
    }

    const membership = await Membership.findOneAndUpdate(
      { userId: req.params.userId, organizationId: orgId, role: 'canvasser' },
      { isActive: true },
      { new: true }
    );
    if (!membership) {
      return res.status(403).json({ error: 'Only a canvasser can be reactivated from a campaign.' });
    }
    // loadStatusTarget refused a deleted account; this catches one deleted in between.
    if (await convergeIfDeleted({ userId: req.params.userId, organizationId: orgId, membershipId: membership._id })) {
      return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });
    }

    res.json({
      ok: true,
      isActive: true,
      alsoAffects: await otherCampaignsFor({
        userId: req.params.userId,
        organizationId: orgId,
        exceptCampaignId: campaign._id,
      }),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
