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
  restampOnJoin,
} from '../../services/memberships/createMember.js';
import { crewResolveLimiter } from '../../middleware/crewResolveLimit.js';
import { addAuditSubjects } from '../../services/access/supportAccess.js';
import { isOrgAdmin } from '../../services/authz/campaignManagement.js';
import { assertCampaignWritable } from '../../middleware/campaignWritable.js';
import { setMemberCoordinator, restampSummary } from '../../services/memberships/setCoordinator.js';
import { coordinatorPreviewBody } from '../../services/memberships/restampCoordinator.js';
import {
  isLastBillingAdmin,
  strandsBilling,
  LAST_BILLING_ADMIN_ERROR,
} from '../../services/memberships/billingGuards.js';
import { sendMail } from '../../services/mail/mailer.js';
import { inviteSetPassword, addedToOrg, addedToCampaign } from '../../services/mail/templates.js';
import { issuePasswordResetToken, INVITE_TOKEN_HOURS } from '../../services/auth/passwordReset.js';

// A team lead's crew surface, scoped to ONE campaign they manage (requireCampaignManager
// gates the mount): list org members to add, create a brand-new canvasser (or link a
// returning one by email) onto this campaign, set a crew member's coordinator, and switch a
// canvasser's access off and back on. Adding/removing existing members and reading the roster
// still go through .../assignments.
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
// history entry, or a proxy log. Rate-limited per actor, and every answer that NAMES somebody
// writes the same record-level audit line that opening their profile does — a lookup is a
// single-record read, so it is recorded like one.
//
// The org boundary is the whole design; see resolveEmailInOrg. The response carries `outcome` and
// `person` and nothing else — never the resolver's internal `user`/`membership`, which would leak
// the existence of accounts belonging to other customers.
const resolveSchema = z.object({ email: memberIdentityShape.email });

router.post('/resolve', crewResolveLimiter, async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const { email } = resolveSchema.parse(req.body);
    const found = await resolveEmailInOrg({
      orgId: activeOrgId(req),
      campaignId: campaign._id,
      email,
    });
    if (found.person) addAuditSubjects(res, 'user', found.person.userId);
    res.json({ outcome: found.outcome, person: found.person || null });
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
router.post('/', async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!requireWritableCampaign(campaign, res)) return;
    const orgId = activeOrgId(req);
    const data = createSchema.parse(req.body);
    if (await refuseVendorStaffTarget(req, res, { email: data.email })) return;

    const coordRes = await resolveCoordinatorId({ orgId, raw: data.coordinatorId, memberUserId: null });
    if (!coordRes.ok) return res.status(400).json({ error: coordRes.error });
    const coordinatorId = coordRes.value || null;

    const found = await resolveEmailInOrg({ orgId, campaignId: campaign._id, email: data.email });

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

    let user = found.user;
    let restamp = { activities: 0, surveys: 0, restampError: null };
    // 'claim' — already ours, just not on this campaign (or already on it: a no-op add that still
    // honours a newly-picked crew). No membership write, so nobody is silently promoted or demoted.
    const claiming = found.outcome !== 'outside';
    // 'attach' — the address has an account, but not one of ours. The operator does not learn that
    // until this succeeds, which is the point: the answer costs a real add, an email to the person,
    // and an audit row, instead of being a free probe.
    const attaching = !claiming && !!found.user;

    if (claiming) {
      restamp = await restampOnJoin({
        orgId,
        campaignId: campaign._id,
        userId: user._id,
        coordinatorId,
        byUserId: req.user._id,
        source: 'member_create',
      });
    } else {
      try {
        ({ user, restamp } = await createOrgMember({
          orgId,
          addedBy: req.user._id,
          // The resolution decides, not the request: an address with an account elsewhere is linked,
          // a free one is created. `data` still carries the typed name/password, which
          // createOrgMember uses only on the create branch.
          data: { ...data, linkExisting: attaching },
          role: 'canvasser', // a lead can only create/link canvassers for their crew
          // The crew is set on the campaign roster row below, not on the org membership — joining an
          // ORG carries no crew, because a crew only means something inside a campaign.
          campaignId: campaign._id,
          coordinatorId,
          // New accounts get a temp password + forced change on first login. A linked existing
          // account keeps its own password (the flag only applies on the create-new branch).
          mustChangePassword: true,
        }));
      } catch (err) {
        if (err instanceof MemberError) return res.status(err.status).json({ error: err.message, code: err.code });
        throw err;
      }
    }

    await CampaignAssignment.updateOne(
      { campaignId: campaign._id, userId: user._id },
      {
        $setOnInsert: {
          campaignId: campaign._id,
          userId: user._id,
          organizationId: orgId,
          assignedBy: req.user._id,
          assignedAt: new Date(),
        },
        // $set, not $setOnInsert: linking a RETURNING canvasser who is already on this campaign
        // should honour the crew the lead just picked rather than silently keep the old one.
        $set: { coordinatorId },
      },
      { upsert: true }
    );

    // EXACTLY ONE email per add — best-effort, never awaited (a mail hiccup must not fail the add).
    // A new account gets a set-password invite naming BOTH the org and this campaign; an account
    // attached from elsewhere gets the no-credentials "added to the org" note; a colleague we
    // claimed onto the campaign gets the campaign note, and only if they are genuinely new to it —
    // re-picking someone's crew is not news, and neither is a person who hasn't set a password yet
    // (their invite already named this campaign).
    if (attaching) {
      sendMail({ to: user.email, ...addedToOrg({ firstName: user.firstName, orgName: req.activeOrg.name, campaignName: campaign.name, role: 'canvasser' }), kind: 'addedToOrg', meta: { organizationId: req.activeOrg._id, organizationName: req.activeOrg.name, userId: user._id } });
    } else if (claiming) {
      if (found.outcome !== 'on-campaign' && user.email && !user.mustChangePassword) {
        sendMail({ to: user.email, ...addedToCampaign({ firstName: user.firstName, orgName: req.activeOrg.name, campaignName: campaign.name, role: found.person.role }), kind: 'addedToCampaign', meta: { organizationId: req.activeOrg._id, organizationName: req.activeOrg.name, userId: user._id } });
      }
    } else {
      const { url } = await issuePasswordResetToken(user._id, { hours: INVITE_TOKEN_HOURS });
      sendMail({ to: user.email, ...inviteSetPassword({ firstName: user.firstName, orgName: req.activeOrg.name, campaignName: campaign.name, setPasswordUrl: url, role: 'canvasser' }), kind: 'inviteSetPassword', meta: { organizationId: req.activeOrg._id, organizationName: req.activeOrg.name, userId: user._id } });
    }

    // `outcome` tells the client which sentence to say. `attached` is the one that matters: it means
    // the typed name was discarded in favour of a real person the operator had not met yet, so the
    // UI must name who actually landed on the roster rather than echoing what was typed.
    // Non-zero restamp only when a returning canvasser still has ledger history here.
    res.status(201).json({
      user: user.toSafeJSON(),
      outcome: attaching ? 'attached' : found.outcome === 'outside' ? 'created' : found.outcome,
      attached: attaching,
      restamp: restampSummary({ changed: true, ...restamp }),
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Conflict' });
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Dry run of the coordinator change, so the lead sees what moves before it commits. Same builder
// and same filter as the write — see services/memberships/restampCoordinator.js.
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

    const coordRes = await resolveCoordinatorId({
      orgId,
      raw: req.query.coordinatorId === 'none' ? null : req.query.coordinatorId,
      memberUserId: req.params.userId,
    });
    if (!coordRes.ok) return res.status(400).json({ error: coordRes.error });
    if (coordRes.skip) return res.status(400).json({ error: 'coordinatorId is required' });

    res.json(
      await coordinatorPreviewBody({
        orgId,
        userId: req.params.userId,
        campaignId: campaign._id,
        from: onCampaign.coordinatorId ?? null,
        to: coordRes.value ?? null,
      })
    );
  } catch (err) {
    next(err);
  }
});

// Set (or clear) a crew member's coordinator. Scoped to this campaign's roster so a
// lead can only reorganize their own crew, not arbitrary org members.
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

    const onCampaign = await CampaignAssignment.exists({ campaignId: campaign._id, userId: req.params.userId });
    if (!onCampaign) return res.status(404).json({ error: 'That member is not on this campaign' });

    const coordRes = await resolveCoordinatorId({ orgId, raw: req.body?.coordinatorId, memberUserId: req.params.userId });
    if (!coordRes.ok) return res.status(400).json({ error: coordRes.error });
    if (coordRes.skip) return res.status(400).json({ error: 'coordinatorId is required' });

    // setMemberCoordinator also RE-STAMPS this person's knock history onto the new team — scoped to
    // THIS campaign, keyed on req.params.campaignId. That the campaign id comes from the URL is
    // load-bearing, not incidental: requireCampaignManager gates on the same param, so a lead
    // physically cannot address a campaign they were not granted. Taking it from the body would
    // reopen exactly that hole.
    const restamp = await setMemberCoordinator({
      organizationId: orgId,
      userId: req.params.userId,
      campaignId: campaign._id,
      coordinatorId: coordRes.value ?? null,
      actorUserId: req.user._id,
      source: 'lead_crew',
    });
    if (!restamp) return res.status(404).json({ error: 'That member is not on this campaign' });
    res.json({
      ok: true,
      coordinatorId: restamp.next ? String(restamp.next) : null,
      restamp: restampSummary(restamp),
    });
  } catch (err) {
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
  // Necessary but NOT a real barrier: POST .../assignments has no role filter, so a lead can put
  // any active org member on their campaign first. Kept so the route is coherent, never relied on.
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
