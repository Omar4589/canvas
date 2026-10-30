import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { Organization } from '../../models/Organization.js';
import { Campaign } from '../../models/Campaign.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { CampaignManager } from '../../models/CampaignManager.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { FbTimeConnection } from '../../models/FbTimeConnection.js';
import { FbTimePersonLink } from '../../models/FbTimePersonLink.js';
import { DeletedUserRecord } from '../../models/DeletedUserRecord.js';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { isOrgAdmin, managedCampaignIds } from '../../services/authz/campaignManagement.js';
import {
  createOrgMember,
  MemberError,
  memberIdentityShape,
  resolveManagedCampaigns,
  resolveEmailInOrg,
  newAccountProblem,
} from '../../services/memberships/createMember.js';
import { restampSummary } from '../../services/memberships/setCoordinator.js';
import {
  campaignPicksSchema,
  checkCampaignPicks,
  joinCampaigns,
  campaignHistories,
  coordinatorChoices,
  sendJoinedEmail,
} from '../../services/memberships/joinCampaigns.js';
import { crewResolveLimiters } from '../../middleware/crewResolveLimit.js';
import {
  isLastBillingAdmin,
  strandsBilling,
  countLiveAdmins,
  LAST_BILLING_ADMIN_ERROR,
  LAST_ADMIN_ERROR,
} from '../../services/memberships/billingGuards.js';
import {
  releaseAssignedWork,
  reviewOrgDeletion,
  deleteAccount,
  convergeIfDeleted,
  AccountDeletionError,
} from '../../services/users/deleteAccount.js';
import { addAuditSubjects } from '../../services/access/supportAccess.js';
import { sendMail } from '../../services/mail/mailer.js';
import { inviteSetPassword, addedToOrg } from '../../services/mail/templates.js';
import { issuePasswordResetToken, INVITE_TOKEN_HOURS } from '../../services/auth/passwordReset.js';
import {
  resendInvite,
  loadResendUser,
  ResendInviteError,
} from '../../services/memberships/resendInvite.js';
import { refuseVendorStaffTarget } from '../../services/memberships/vendorGuards.js';
import { phoneSchema, nameSchema, emailSchema, passwordSchema as passwordField } from '../../utils/validators.js';

// Team leads reach this router too — READ scoped to their campaigns' rosters, and a narrow
// write set (temp password / deactivate / reactivate, CANVASSER targets only). Every other
// write stays admin-only via requireAdminRole below. Default-deny throughout: a lead with
// zero grants sees nobody and can touch nobody.
const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin', 'lead'));

// A support-grant holder is a VENDOR here — orgContext set req.supportGrant precisely because
// they have no membership. A grant now permits USER ADMINISTRATION, every write recorded by
// middleware/accessLog.js; the ONE refusal is a membership targeting a staff account. Rationale
// and rule live in services/memberships/vendorGuards.js — shared with leadCrew.js so the two
// routers cannot drift.
// The routes a lead may never touch (create, role/grants, delete, identity edits).
function requireAdminRole(req, res, next) {
  if (isOrgAdmin(req)) return next();
  return res.status(403).json({ error: 'Only an org admin can do this.', code: 'ADMIN_ONLY' });
}

// The users a LEAD may see: everyone rostered on a campaign they hold a CampaignManager
// grant for. Empty grant set → empty visibility (default-deny).
async function leadVisibleUserIds(req) {
  const campaignIds = await managedCampaignIds(req);
  if (!campaignIds.length) return new Set();
  const rows = await CampaignAssignment.find(
    { organizationId: req.activeOrg._id, campaignId: { $in: campaignIds } },
    'userId'
  ).lean();
  return new Set(rows.map((r) => String(r.userId)));
}

// May this LEAD manage (temp-password / deactivate / reactivate) the target account?
// Only CANVASSER accounts rostered on a campaign the lead manages — never a fellow lead,
// never an admin (that would be privilege escalation: a lead deactivating the admin who
// granted them access). Owner decision 2026-07-23.
async function leadMayManageTarget(req, userId) {
  if (!mongoose.isValidObjectId(userId)) return false;
  const target = await Membership.findOne(
    { userId, organizationId: req.activeOrg._id },
    'role'
  ).lean();
  if (!target || target.role !== 'canvasser') return false;
  const campaignIds = await managedCampaignIds(req);
  if (!campaignIds.length) return false;
  const shared = await CampaignAssignment.exists({
    organizationId: req.activeOrg._id,
    userId,
    campaignId: { $in: campaignIds },
  });
  return Boolean(shared);
}

// Read guard for the per-user drill routes (/crews, /campaigns, /stats, /recent-activity):
// a lead may look at anyone VISIBLE to them (any role, read-only); writes stay narrower.
async function leadMaySeeTarget(req, userId) {
  if (!mongoose.isValidObjectId(userId)) return false;
  const visible = await leadVisibleUserIds(req);
  return visible.has(String(userId));
}

// The guard above decides WHO a lead may look at; this decides how much of that person comes
// back. A team lead may be the CLIENT for their campaign (owner ruling 2026-09-23), and one
// canvasser can work several clients' campaigns, so a person's work (totals, recent doors, crews,
// campaign list) reaches a lead only from the campaigns that lead manages. The drills used to
// answer org-wide, and the phone profile showed a lead another client's door addresses
// (docs/PRIVACY_VERIFICATION.md item 40). null = an admin or staff: no narrowing. An empty grant
// set narrows to nothing (default-deny).
const leadCampaignScope = async (req) => (isOrgAdmin(req) ? null : managedCampaignIds(req));
const inLeadScope = (scope) => (scope ? { campaignId: { $in: scope } } : {});

// Hand copy of KNOCK_ACTIONS (services/reports/aggregations.js) — every knock outcome must be here.
const DOOR_ACTIONS = ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped', 'no_soliciting', 'not_target'];


const addSchema = z.object({
  ...memberIdentityShape,
  role: z.enum(['admin', 'lead', 'canvasser']).default('canvasser'),
  // NO coordinatorId. A crew is per-campaign (models/CampaignAssignment.js), and this adds somebody
  // to the ORGANIZATION — there is no campaign here to be on a crew of. It is set on a campaign's
  // Team tab, where the confirmation can quote that campaign's door count. Absent from the schema
  // rather than accepted-and-ignored: a caller still sending it is working from a stale contract.
  // For role: 'lead' — the campaigns this lead may manage (CampaignManager grants).
  managedCampaignIds: z.array(z.string()).optional(),
});

// The org view's add by email (POST /by-email): who, the role a NEW member gets, the campaigns to put
// them on with a crew for each, and a new lead's grants. `linkExisting` rides in memberIdentityShape and
// is ignored here: what the address resolves to decides, as on the campaign Team page's add.
const byEmailSchema = z.object({
  ...memberIdentityShape,
  role: z.enum(['admin', 'lead', 'canvasser']).default('canvasser'),
  campaigns: campaignPicksSchema.optional().default([]),
  managedCampaignIds: z.array(z.string()).optional(),
});

const resolveSchema = z.object({ email: memberIdentityShape.email });

const addCampaignsSchema = z.object({ campaigns: campaignPicksSchema.refine((p) => p.length > 0, { message: 'Pick at least one campaign.' }) });

const updateMembershipSchema = z.object({
  role: z.enum(['admin', 'lead', 'canvasser']).optional(),
  isActive: z.boolean().optional(),
  coordinatorId: z.string().nullable().optional(),
  managedCampaignIds: z.array(z.string()).optional(),
  // Grant/revoke the Billing surface. Only meaningful for admins; only a caller who
  // already has billing access (or a super admin) may change it (guarded in the handler).
  billingAccess: z.boolean().optional(),
});

const updateUserSchema = z.object({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  email: emailSchema.optional(),
  phone: phoneSchema,
});

const passwordSchema = z.object({ password: passwordField });

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


// Replace a lead's CampaignManager grants in this org with exactly `campaignIds`
// (an array of ObjectId already validated by resolveManagedCampaigns). Additive
// upserts keep existing grantedBy/grantedAt; anything not in the set is removed.
async function reconcileManagedCampaigns({ orgId, userId, grantedBy, campaignIds }) {
  await CampaignManager.deleteMany({
    userId,
    organizationId: orgId,
    campaignId: { $nin: campaignIds },
  });
  for (const campaignId of campaignIds) {
    await CampaignManager.updateOne(
      { userId, organizationId: orgId, campaignId },
      { $setOnInsert: { userId, organizationId: orgId, campaignId, grantedBy, grantedAt: new Date() } },
      { upsert: true }
    );
  }
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// reason → how the Users list words it ("Deleted by Alex Kim", "Deleted their own account", ...).
const DELETION_HOW = { self: 'self', org_admin: 'admin', super_admin: 'support', operator: 'support' };

const tombstoneDeletionLines = async (userIds, orgId) => {
  if (!userIds.length) return new Map();
  const records = await DeletedUserRecord.find({ userId: { $in: userIds } })
    .select('userId reason deletedBy deletedAt pendingAt finishedAt')
    .lean();
  const settled = records.filter((r) => !r.pendingAt || r.finishedAt);
  const deleterIds = [...new Set(settled.filter((r) => r.reason === 'org_admin' && r.deletedBy).map((r) => String(r.deletedBy)))];
  const [deleterMembers, deleters] = deleterIds.length
    ? await Promise.all([
        Membership.find({ organizationId: orgId, userId: { $in: deleterIds } }).distinct('userId'),
        User.find({ _id: { $in: deleterIds }, deletedAt: null }).select('firstName lastName').lean(),
      ])
    : [[], []];
  const memberHere = new Set(deleterMembers.map(String));
  const nameById = new Map(deleters.map((u) => [String(u._id), `${u.firstName || ''} ${u.lastName || ''}`.trim()]));
  return new Map(
    settled.map((r) => {
      const how = DELETION_HOW[r.reason] || 'unknown';
      const byName = how === 'admin' && memberHere.has(String(r.deletedBy)) ? nameById.get(String(r.deletedBy)) || null : null;
      return [String(r.userId), { at: r.deletedAt, how, byName }];
    })
  );
};

router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const memberships = await Membership.find({ organizationId: activeOrgId(req) })
      .populate({ path: 'userId' })
      .sort({ createdAt: -1 })
      .lean();
    let members = memberships.filter((m) => m.userId);
    // A lead's list is their campaigns' rosters, deduped — not the whole org.
    if (!isOrgAdmin(req)) {
      const visible = await leadVisibleUserIds(req);
      members = members.filter((m) => visible.has(String(m.userId._id)));
    }

    // How many active orgs each member belongs to GLOBALLY — so the UI can lock
    // the login-email field for multi-org users. We expose only a boolean, never
    // which other orgs they're in.
    const userIds = members.map((m) => m.userId._id);
    const counts = await Membership.aggregate([
      { $match: { userId: { $in: userIds }, isActive: true } },
      { $group: { _id: '$userId', count: { $sum: 1 } } },
    ]);
    const orgCount = new Map(counts.map((c) => [String(c._id), c.count]));

    // The campaigns each team lead is granted (CampaignManager), so the Users page
    // can show + edit a lead's scope without a per-row fetch. Narrowed for a LEAD reader
    // below, like the assignment set: a fellow lead's grants on campaigns this lead doesn't
    // manage are another client's campaigns.
    const grants = await CampaignManager.find({ organizationId: activeOrgId(req) })
      .select('userId campaignId')
      .lean();
    const managedByUser = new Map();
    for (const g of grants) {
      const k = String(g.userId);
      if (!managedByUser.has(k)) managedByUser.set(k, []);
      managedByUser.get(k).push(String(g.campaignId));
    }

    // The campaigns each member is ROSTERED on (CampaignAssignment) — distinct from
    // managedCampaignIds above, which is a lead's GRANT. Ids only: any caller that
    // wants names already holds GET /admin/campaigns, and a campaign mid-deletion
    // ships in that response's separate deletingCampaigns array by design, so an id
    // resolving to nothing there is correct rather than missing.
    //
    // SCOPED FOR LEADS, like the grants block it mirrors. The member LIST is already
    // narrowed by leadVisibleUserIds, but an assignment SET is not: unfiltered, a lead
    // would learn every campaign each of their canvassers is on, including campaigns
    // the lead holds no grant for at all. That is an access widening, so it is cut here.
    const assignments = await CampaignAssignment.find({ organizationId: activeOrgId(req) })
      .select('userId campaignId')
      .lean();
    const leadScope = isOrgAdmin(req)
      ? null
      : new Set((await managedCampaignIds(req)).map(String));
    const campaignsByUser = new Map();
    for (const a of assignments) {
      const cid = String(a.campaignId);
      if (leadScope && !leadScope.has(cid)) continue;
      const k = String(a.userId);
      if (!campaignsByUser.has(k)) campaignsByUser.set(k, []);
      campaignsByUser.get(k).push(cid);
    }

    // FbTime link state, org-wide — ADMIN ONLY, and only when a connection exists.
    // The whole /admin/integrations router is admin-gated, and the one lead-visible
    // disclosure is deliberately per-user (GET /:userId/stats, for a canvasser already
    // inside their scope). An org-wide roll-up for leads is its own decision, not a
    // side effect of a UI change.
    let fbtimeByUser = null;
    if (isOrgAdmin(req)) {
      const connected = await FbTimeConnection.findOne({
        organizationId: activeOrgId(req),
        status: 'connected',
      })
        .select('_id')
        .lean();
      if (connected) {
        const [fbLinks, conn] = await Promise.all([
          FbTimePersonLink.find({ organizationId: activeOrgId(req) }).select('userId fbtimeName source fbtimePersonId').lean(),
          FbTimeConnection.findOne({ organizationId: activeOrgId(req) }).select('keptAccounts').lean(),
        ]);
        fbtimeByUser = new Map(fbLinks.map((l) => [String(l.userId), l]));
        // A kept earlier account (Unlink → "Yes — keep") still owns the hours it clocked
        // before it was kept, so it reads as measured, never "Not linked".
        const nameByPerson = new Map(fbLinks.map((l) => [String(l.fbtimePersonId).toLowerCase(), l.fbtimeName]));
        for (const k of conn?.keptAccounts || []) {
          const uid = String(k.userId);
          if (fbtimeByUser.has(uid)) continue;
          fbtimeByUser.set(uid, {
            fbtimeName: nameByPerson.get(String(k.fbtimePersonId).toLowerCase()) || null,
            source: null,
            kept: true,
          });
        }
      }
    }

    // Who deleted a tombstone row, and when — for this org's admins (a deleted account's roster rows
    // are released, so a lead's list never holds one). A pending record (a deletion still finishing)
    // reads as plain "Deleted account". The deleter is NAMED only when they are an admin with a
    // membership (any status) in THIS org: a link that raced the deletion into another org must not
    // show that org's admin by name.
    const deletionByUser = await tombstoneDeletionLines(
      members.filter((m) => m.userId.deletedAt).map((m) => m.userId._id),
      activeOrgId(req)
    );

    res.json({
      members: members.map((m) => ({
        membershipId: String(m._id),
        role: m.role,
        isActive: m.isActive,
        addedAt: m.createdAt,
        deletion: deletionByUser.get(String(m.userId._id)) || null,
        billingAccess: !!m.billingAccess,
        managedCampaignIds: (managedByUser.get(String(m.userId._id)) || []).filter(
          (cid) => !leadScope || leadScope.has(cid)
        ),
        campaignIds: campaignsByUser.get(String(m.userId._id)) || [],
        // null when the org has no FbTime connection, or the reader is a lead —
        // the client renders the column only when the field is present.
        fbtime: fbtimeByUser
          ? {
              linked: fbtimeByUser.has(String(m.userId._id)),
              personName: fbtimeByUser.get(String(m.userId._id))?.fbtimeName || null,
              source: fbtimeByUser.get(String(m.userId._id))?.source || null,
              kept: fbtimeByUser.get(String(m.userId._id))?.kept === true,
            }
          : null,
        user: {
          id: String(m.userId._id),
          firstName: m.userId.firstName,
          lastName: m.userId.lastName,
          email: m.userId.email,
          phone: m.userId.phone,
          isSuperAdmin: !!m.userId.isSuperAdmin,
          isActive: m.userId.isActive,
          isMultiOrg: (orgCount.get(String(m.userId._id)) || 0) >= 2,
          // Already loaded by .populate('userId'); it just was never projected, so
          // clients had to sniff the tombstone email domain to spot a deleted account.
          isDeleted: !!m.userId.deletedAt,
          lastLoginAt: m.userId.lastLoginAt,
          createdAt: m.userId.createdAt,
        },
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAdminRole, async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const data = addSchema.parse(req.body);
    // Vendor rule: a grant-holder may administer users, never mint a STAFF membership (see
    // the STAFF_TARGET_ERROR comment). Creates only know the email at this point.
    if (await refuseVendorStaffTarget(req, res, { email: data.email })) return;

    // Validate the grant set up front (fail before creating anything) for leads.
    let managed = [];
    if (data.role === 'lead') {
      const mres = await resolveManagedCampaigns({ orgId, raw: data.managedCampaignIds ?? [] });
      if (!mres.ok) return res.status(400).json({ error: mres.error });
      managed = mres.value;
    }

    let user;
    let membership;
    let restamp;
    try {
      ({ user, membership, restamp } = await createOrgMember({
        orgId,
        addedBy: req.user._id,
        data,
        role: data.role,
        // Every newly created account gets a temp password + forced change on first login.
        // Harmless when linking an existing account: createOrgMember only applies the flag on
        // the create-new branch, so a linked account keeps its own password untouched.
        mustChangePassword: true,
      }));
    } catch (err) {
      if (err instanceof MemberError) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      throw err;
    }

    if (data.role === 'lead' && managed.length) {
      await reconcileManagedCampaigns({
        orgId,
        userId: user._id,
        grantedBy: req.user._id,
        campaignIds: managed,
      });
      // createOrgMember re-checked after its insert; the grants above are this route's last write.
      if (await convergeIfDeleted({ userId: user._id, organizationId: orgId, membershipId: membership._id })) {
        return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });
      }
    }

    // Notify the person we just added — best-effort, never awaited (a mail hiccup must not fail the
    // admin's add). A brand-new account gets a set-password invite; the admin-typed temp password stays
    // in the 201 response below as a manual fallback and never appears in the email. An existing account
    // linked into this org gets a no-credentials "you've been added" note.
    if (data.linkExisting) {
      sendMail({ to: user.email, ...addedToOrg({ firstName: user.firstName, orgName: req.activeOrg.name, role: data.role }), kind: 'addedToOrg', meta: { organizationId: req.activeOrg._id, organizationName: req.activeOrg.name, userId: user._id } });
    } else {
      const { url } = await issuePasswordResetToken(user._id, { hours: INVITE_TOKEN_HOURS });
      // A url only comes back null for an account deleted in the meantime; there is nobody to invite.
      if (url) sendMail({ to: user.email, ...inviteSetPassword({ firstName: user.firstName, orgName: req.activeOrg.name, setPasswordUrl: url, role: data.role }), kind: 'inviteSetPassword', meta: { organizationId: req.activeOrg._id, organizationName: req.activeOrg.name, userId: user._id } });
    }

    res.status(201).json({
      membership: {
        membershipId: String(membership._id),
        role: membership.role,
        isActive: membership.isActive,
        addedAt: membership.createdAt,
        managedCampaignIds: managed.map((id) => String(id)),
        user: user.toSafeJSON(),
      },
      // Non-zero only when linkExisting attached an account that already had ledger history in
      // this org (org removal deletes the Membership but keeps the knocks). It is the only signal
      // the admin gets that the person they just re-added brought work with them.
      restamp: restampSummary({ changed: true, ...restamp }),
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Conflict' });
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// ── The org view's add by email, and a profile's Add to campaigns ──────────────────────────────────
// docs/PROPOSAL_ADD_TO_CAMPAIGNS.md. The phone's Users hub on All campaigns and the web Users page used
// to add someone to the organization on NO campaign (POST / above, still there for phones without the
// update); these put them on the campaigns picked, each with its own crew, in one step. Org admins only:
// a team lead adds through a campaign's Team page (leadCrew.js), and none of this reaches them.

// "Who owns this address, here?" — the org view's version of the Team page's lookup (leadCrew.js POST
// /resolve), and drawing on THE SAME two hourly counters per person (the same limiter instances), so
// adding from either screen can't double the ceiling. `outside` is one answer for every address — no
// account, an account at another customer, a deleted account's old address — carrying nothing about
// the address (`coordinators` is the organization's, the same for any address). A named person comes
// back with their standing and doors on each active campaign (`campaigns`), which is what lets the add
// step mark the campaigns they're on and pre-pick an old crew where one can still lead.
router.post('/resolve', requireAdminRole, ...crewResolveLimiters, async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const { email } = resolveSchema.parse(req.body);
    const orgId = activeOrgId(req);
    const found = await resolveEmailInOrg({ orgId, email });
    // Which limiter keeps this lookup (crewResolveLimit.js): one that finds nobody, or one that names.
    res.locals.lookup = found.outcome === 'outside' ? 'outside' : 'named';
    const coordinators = await coordinatorChoices(orgId);
    if (!found.person) return res.json({ outcome: found.outcome, person: null, campaigns: [], coordinators });
    addAuditSubjects(res, 'user', found.person.userId);
    res.json({
      outcome: found.outcome,
      person: found.person,
      campaigns: await campaignHistories({ orgId, userId: found.user._id }),
      coordinators,
    });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Add someone keyed on their EMAIL ADDRESS, and put them on the campaigns picked. One door for every
// case, resolved first and then branched exactly as the Team page's add (leadCrew.js POST /):
//   outside           create the account — or, when the address has one elsewhere, attach that real person
//                     and drop what was typed (a stranger's name isn't ours to overwrite, their password not
//                     ours to set) — with the role picked, and a new lead's grants
//   in-org            already a member: no membership write, so their role never changes here
//   in-org-inactive   switched off: switched back on (this route is admin-only, so always allowed)
// Then every pick is joined (services/memberships/joinCampaigns.js), and ONE email goes out. Every pick is
// checked BEFORE the first write, so a bad one refuses the whole add instead of leaving someone on half of
// what was asked. Sent twice, the second answer changes nothing: the address now resolves in-org, every
// pick is already-on, and no email goes out.
router.post('/by-email', requireAdminRole, async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const data = byEmailSchema.parse(req.body);
    if (await refuseVendorStaffTarget(req, res, { email: data.email })) return;

    // 1. Who the address belongs to, here.
    const found = await resolveEmailInOrg({ orgId, email: data.email });
    const named = found.outcome !== 'outside';
    // A deleted member's switched-off membership still resolves (their tombstone address). Refuse it BEFORE
    // any write: switching them on and joining would move their earlier doors to the crew picked, and the
    // convergence after the last write undoes the roster and the membership but never the ledger — a
    // departure must never move doors (services/memberships/restampCoordinator.js, the 104-door rule).
    if (named && found.user.deletedAt) return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });
    // Every outside address gets the same checks, whether or not it has an account elsewhere — or the
    // refusal would say which (createMember.js newAccountProblem).
    if (!named) {
      const problem = newAccountProblem(data);
      if (problem) return res.status(400).json(problem);
    }

    // 2. Everything checked before anything is written: the picks, and a new lead's grants.
    const picks = await checkCampaignPicks({ orgId, picks: data.campaigns, memberUserId: named ? found.user._id : null });
    if (!picks.ok) return res.status(picks.status).json({ error: picks.error, ...(picks.code ? { code: picks.code } : {}) });
    let managed = [];
    if (!named && data.role === 'lead') {
      const mres = await resolveManagedCampaigns({ orgId, raw: data.managedCampaignIds ?? [] });
      if (!mres.ok) return res.status(400).json({ error: mres.error });
      managed = mres.value;
    }

    // 3. The membership.
    if (found.outcome === 'in-org-inactive') {
      await Membership.updateOne({ _id: found.membership._id }, { $set: { isActive: true } });
    }
    let user = found.user;
    let membership = found.membership || null;
    // 'attach' — the address has an account, but not one of ours. The operator learns whose only once
    // this succeeds: the answer costs a real add and an email to the person, not a free probe.
    const attaching = !named && !!found.user;
    if (!named) {
      try {
        ({ user, membership } = await createOrgMember({
          orgId,
          addedBy: req.user._id,
          data: { ...data, linkExisting: attaching },
          role: data.role,
          // New accounts get a temp password + forced change on first login; a linked account keeps its
          // own password (createOrgMember applies the flag on the create branch only).
          mustChangePassword: true,
        }));
      } catch (err) {
        // Another add for the same address landed between this lookup and this create (two admins at once):
        // the account or its membership now exists. These codes are only reachable that way here, and their
        // own messages point at the old form's Existing-user checkbox, so say what happened instead. Looking
        // the address up again finds the person as a colleague.
        if (err?.code === 11000 || (err instanceof MemberError && ['EMAIL_EXISTS_USE_LINK', 'ALREADY_MEMBER'].includes(err.code))) {
          return res.status(409).json({ error: 'Someone else just added this address. Go back and look it up again.', code: 'ADDED_MEANWHILE' });
        }
        if (err instanceof MemberError) return res.status(err.status).json({ error: err.message, code: err.code });
        throw err;
      }
      if (data.role === 'lead' && managed.length) {
        await reconcileManagedCampaigns({ orgId, userId: user._id, grantedBy: req.user._id, campaignIds: managed });
      }
    }
    addAuditSubjects(res, 'user', user._id);

    // 4. The campaigns, each with its crew; a returning person's earlier doors on each move to it.
    const campaigns = await joinCampaigns({ orgId, userId: user._id, picks: picks.value, actorUserId: req.user._id });
    const joined = campaigns.filter((c) => c.result === 'joined');

    // An account deleted while this add ran is put back the way the deletion left it. After the LAST write.
    if (
      await convergeIfDeleted({
        userId: user._id,
        organizationId: orgId,
        membershipId: membership?._id || null,
        campaignIds: joined.map((c) => c.campaignId),
      })
    ) {
      return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });
    }

    const role = named ? found.membership.role : data.role;
    await sendJoinedEmail({
      kind: attaching ? 'attached' : named ? 'joined' : 'created',
      user,
      role,
      campaignNames: joined.map((c) => c.campaignName),
      org: req.activeOrg,
    });

    // `outcome` tells the client which sentence to say; `attached` means the typed name was discarded in
    // favour of a real person the operator hadn't met, so the result must name who actually landed.
    res.status(201).json({
      user: user.toSafeJSON(),
      outcome: attaching ? 'attached' : named ? found.outcome : 'created',
      attached: attaching,
      role,
      managedCampaignIds: managed.map(String),
      campaigns,
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Conflict' });
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// A person's standing and doors on each active campaign, and who can run a crew — what a profile's Add to
// campaigns needs to mark where they are and pre-pick an old crew. Read only when that sheet opens. Not
// rate-limited: it names nobody new (the admin opened this person from a list that already shows them).
router.get('/:userId/campaign-history', requireAdminRole, async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) return res.status(400).json({ error: 'Invalid userId' });
    const orgId = activeOrgId(req);
    if (!(await Membership.exists({ userId: req.params.userId, organizationId: orgId }))) {
      return res.status(404).json({ error: 'Not a member of this organization' });
    }
    addAuditSubjects(res, 'user', req.params.userId);
    const [campaigns, coordinators] = await Promise.all([
      campaignHistories({ orgId, userId: req.params.userId }),
      coordinatorChoices(orgId),
    ]);
    res.json({ campaigns, coordinators });
  } catch (err) {
    next(err);
  }
});

// A profile's Add to campaigns: put this member on the campaigns picked, each with its crew, and send ONE
// email naming them. It used to be read-only there (an add with no crew choice would have moved a
// returning person's doors unseen); the picks carry the crew now, and the screen shows the doors line.
// A switched-off account is switched on first — that is an org-wide act with its own question.
router.post('/:userId/campaigns', requireAdminRole, async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) return res.status(400).json({ error: 'Invalid userId' });
    const orgId = activeOrgId(req);
    const { campaigns: raw } = addCampaignsSchema.parse(req.body);
    const [membership, user] = await Promise.all([
      Membership.findOne({ userId: req.params.userId, organizationId: orgId }, 'role isActive').lean(),
      User.findById(req.params.userId, 'firstName email mustChangePassword deletedAt'),
    ]);
    if (!membership || !user) return res.status(404).json({ error: 'Not a member of this organization' });
    if (user.deletedAt) return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });
    if (!membership.isActive) {
      return res.status(409).json({ error: 'This account is switched off. Switch it back on first.', code: 'MEMBER_DEACTIVATED' });
    }
    const picks = await checkCampaignPicks({ orgId, picks: raw, memberUserId: user._id });
    if (!picks.ok) return res.status(picks.status).json({ error: picks.error, ...(picks.code ? { code: picks.code } : {}) });
    addAuditSubjects(res, 'user', user._id);

    const campaigns = await joinCampaigns({ orgId, userId: user._id, picks: picks.value, actorUserId: req.user._id });
    const joined = campaigns.filter((c) => c.result === 'joined');
    if (await convergeIfDeleted({ userId: user._id, organizationId: orgId, campaignIds: joined.map((c) => c.campaignId) })) {
      return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });
    }
    await sendJoinedEmail({ kind: 'joined', user, role: membership.role, campaignNames: joined.map((c) => c.campaignName), org: req.activeOrg });
    res.status(201).json({ campaigns });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Which crew this person is on, IN EACH CAMPAIGN they are rostered to. Read-only.
//
// The org Users page used to set one coordinator here, because a coordinator was one org-level
// fact. Crews are per-campaign now (models/CampaignAssignment.js), so a single value on a person's
// org profile cannot be true — somebody on two campaigns has two crews, and picking one to display
// would misreport the other. The page therefore shows the list and links out; the write lives on
// the campaign's Team tab, where its blast radius is one campaign and the confirmation can quote
// that campaign's door count.
router.get('/:userId/crews', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    if (!isOrgAdmin(req) && !(await leadMaySeeTarget(req, req.params.userId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const orgId = activeOrgId(req);
    const rows = await CampaignAssignment.find(
      { userId: req.params.userId, organizationId: orgId },
      'campaignId coordinatorId'
    ).lean();
    // Every campaign keeps its NAME for every reader: the switch-off warning has to say which
    // campaigns an org-wide switch reaches (ROLES.md, the deactivate disclosure). For a lead, the
    // rest of a campaign they don't manage stays out: who runs that crew, and whether the
    // campaign is live. Those rows come back with nulls, which no lead screen renders.
    const scope = await leadCampaignScope(req);
    const managed = scope && new Set(scope.map(String));
    const shown = (cid) => !managed || managed.has(String(cid));

    const campaignIds = [...new Set(rows.map((r) => String(r.campaignId)))];
    const coordIds = [
      ...new Set(rows.filter((r) => shown(r.campaignId)).map((r) => r.coordinatorId).filter(Boolean).map(String)),
    ];
    const shownIds = rows.filter((r) => shown(r.campaignId)).map((r) => r.campaignId);
    const [campaigns, coords, crewCounts] = await Promise.all([
      campaignIds.length ? Campaign.find({ _id: { $in: campaignIds } }, 'name isActive').lean() : [],
      coordIds.length ? User.find({ _id: { $in: coordIds } }, 'firstName lastName').lean() : [],
      // `crewSize`: how many people on each campaign have THIS person as their coordinator — what taking
      // them off a campaign leaves with no coordinator, for the profile's Remove question.
      shownIds.length
        ? CampaignAssignment.aggregate([
            { $match: { campaignId: { $in: shownIds }, coordinatorId: new mongoose.Types.ObjectId(req.params.userId) } },
            { $group: { _id: '$campaignId', n: { $sum: 1 } } },
          ])
        : [],
    ]);
    const campaignById = new Map(campaigns.map((c) => [String(c._id), c]));
    const nameById = new Map(
      coords.map((u) => [String(u._id), `${u.firstName || ''} ${u.lastName || ''}`.trim()])
    );
    const crewSizeOf = new Map(crewCounts.map((g) => [String(g._id), g.n]));

    res.json({
      crews: rows.map((r) => {
        const c = campaignById.get(String(r.campaignId));
        if (!shown(r.campaignId)) {
          return {
            campaignId: String(r.campaignId),
            campaignName: c?.name || 'Unknown campaign',
            campaignIsActive: null,
            coordinatorId: null,
            coordinatorName: null,
          };
        }
        const coordinatorId = r.coordinatorId ? String(r.coordinatorId) : null;
        return {
          campaignId: String(r.campaignId),
          campaignName: c?.name || 'Unknown campaign',
          campaignIsActive: c?.isActive !== false,
          coordinatorId,
          // null = the "No crew" bucket for that campaign, which is a real answer.
          coordinatorName: coordinatorId ? nameById.get(coordinatorId) || 'Unknown' : null,
          crewSize: crewSizeOf.get(String(r.campaignId)) || 0,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/:userId', requireAdminRole, async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return;
    const orgId = activeOrgId(req);
    const data = updateMembershipSchema.parse(req.body);
    // A deleted account's row is a tombstone: no role, no billing flag, no reactivation. Asked before
    // any billing or role logic, and again after the last write below for a deletion that raced it.
    const targetAccount = await User.findById(req.params.userId).select('deletedAt').lean();
    if (targetAccount?.deletedAt) {
      return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });
    }
    // You can't strip your own org-admin (demote yourself to lead or canvasser) —
    // that would lock you out of org administration. Ask another admin.
    if (
      data.role && data.role !== 'admin' &&
      String(req.params.userId) === String(req.user._id) &&
      !req.user.isSuperAdmin
    ) {
      return res.status(400).json({
        error: "You can't change your own role. Ask another admin.",
      });
    }

    // Only a bill-payer admin (or super admin) can hand out billing access — otherwise a
    // non-billing admin could grant themselves the surface they're meant to be kept out of.
    if (data.billingAccess !== undefined && !req.user.isSuperAdmin && !req.activeMembership?.billingAccess) {
      return res.status(403).json({ error: 'Only a billing admin can change billing access.' });
    }

    const membership = await Membership.findOne({
      userId: req.params.userId,
      organizationId: orgId,
    });
    if (!membership) return res.status(404).json({ error: 'Membership not found' });

    // Any change that would strip this membership's billing standing — the flag itself, the
    // admin role it rides on, or the membership's active status — is refused on the last one.
    const stripsBilling =
      data.billingAccess === false ||
      (data.role !== undefined && data.role !== 'admin') ||
      data.isActive === false;
    if (stripsBilling && (await isLastBillingAdmin(membership))) {
      return res.status(409).json(LAST_BILLING_ADMIN_ERROR);
    }
    // Snapshot the billing-standing fields BEFORE the mutating save, so the post-write backstop
    // (below) can undo exactly this strip if it raced another to zero. Captured only when it could
    // matter — the target was a billing admin and the request strips it.
    const wasBillingAdmin =
      membership.billingAccess && membership.role === 'admin' && membership.isActive;
    const billingBefore = wasBillingAdmin
      ? { billingAccess: membership.billingAccess, role: membership.role, isActive: membership.isActive }
      : null;
    // The same snapshot for admin standing: demoting or switching off an active admin is re-counted
    // after the save (LAST_ADMIN_ERROR in billingGuards.js).
    const adminBefore =
      membership.role === 'admin' && membership.isActive
        ? { role: membership.role, isActive: membership.isActive, billingAccess: membership.billingAccess }
        : null;
    const stripsAdmin = Boolean(adminBefore) && ((data.role !== undefined && data.role !== 'admin') || data.isActive === false);

    const nextRole = data.role || membership.role;
    // Validate the grant set before writing anything (only when the result is a lead).
    let managedResult = null;
    if (nextRole === 'lead' && data.managedCampaignIds !== undefined) {
      const mres = await resolveManagedCampaigns({ orgId, raw: data.managedCampaignIds });
      if (!mres.ok) return res.status(400).json({ error: mres.error });
      managedResult = mres.value;
    }

    // managedCampaignIds lives in CampaignManager, not on the membership doc. coordinatorId is
    // dropped outright: a crew is a per-campaign fact now, so there is nothing here to set. The
    // key is still destructured away so an older client that keeps sending it gets a clean no-op
    // rather than writing a field that no longer means anything.
    const { managedCampaignIds: _omitGrants, coordinatorId: _omitCoord, ...membershipUpdate } = data;
    // Automatic pause: a role change restarts this member's count (docs/PROPOSAL_PACE_PAUSE.md §B.5), so a
    // lead's paper entry earlier today can't pause them the moment they are a canvasser again. Forward only.
    if (data.role !== undefined && data.role !== membership.role) {
      const now = new Date();
      if (!membership.paceRestartAt || membership.paceRestartAt < now) membership.paceRestartAt = now;
    }
    Object.assign(membership, membershipUpdate);
    await membership.save();

    // Post-write backstop for the concurrency race (see isLastBillingAdmin/strandsBilling). Runs
    // BEFORE grant reconciliation so a revert leaves no half-applied side effects.
    if (stripsBilling && billingBefore && (await strandsBilling(orgId))) {
      membership.set(billingBefore);
      await membership.save();
      return res.status(409).json(LAST_BILLING_ADMIN_ERROR);
    }
    if (stripsAdmin && (await countLiveAdmins(orgId)) === 0) {
      membership.set(adminBefore);
      await membership.save();
      return res.status(409).json(LAST_ADMIN_ERROR);
    }

    // Reconcile grants: leaving the lead role clears every grant; staying/becoming
    // a lead with an explicit set replaces it (an omitted set leaves grants as-is).
    if (nextRole !== 'lead') {
      await CampaignManager.deleteMany({ userId: req.params.userId, organizationId: orgId });
    } else if (managedResult !== null) {
      await reconcileManagedCampaigns({
        orgId,
        userId: membership.userId,
        grantedBy: req.user._id,
        campaignIds: managedResult,
      });
    }

    // A deletion that finished while this request ran: put back what it undid (off, no billing, no
    // grants) rather than leave the tombstone an active admin. After the LAST write, grants included.
    if (await convergeIfDeleted({ userId: req.params.userId, organizationId: orgId, membershipId: membership._id })) {
      return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });
    }

    const finalGrants = await CampaignManager.find({ userId: req.params.userId, organizationId: orgId })
      .select('campaignId')
      .lean();
    res.json({
      membership: {
        ...membership.toObject(),
        managedCampaignIds: finalGrants.map((g) => String(g.campaignId)),
      },
    });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.delete('/:userId', requireAdminRole, async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return;
    if (
      String(req.params.userId) === String(req.user._id) &&
      !req.user.isSuperAdmin
    ) {
      return res.status(400).json({ error: "You can't remove yourself from this org." });
    }
    const orgId = activeOrgId(req);
    const target = await Membership.findOne({ userId: req.params.userId, organizationId: orgId });
    // Billing access protects its holder from removal too: otherwise Remove followed by re-adding the
    // same email would quietly strip a billing admin's flag (the account-deletion rule's back door).
    // Staff are exempt, and so is a DELETED account's row — anyone may tidy a tombstone away, and
    // accounts deleted before this rule never had the flag cleared.
    if (target?.billingAccess && !req.user.isSuperAdmin && !req.activeMembership?.billingAccess) {
      const account = await User.findById(req.params.userId).select('deletedAt').lean();
      if (!account?.deletedAt) {
        return res.status(403).json({
          error: 'Only an admin with billing access can remove this person.',
          code: 'BILLING_ACCESS_REQUIRED',
        });
      }
    }
    if (target && (await isLastBillingAdmin(target))) {
      return res.status(409).json(LAST_BILLING_ADMIN_ERROR);
    }
    const wasBillingAdmin =
      target && target.billingAccess && target.role === 'admin' && target.isActive;
    const wasAdmin = target && target.role === 'admin' && target.isActive;
    await Membership.deleteOne({ userId: req.params.userId, organizationId: orgId });
    // Post-write backstop for the concurrency race (see isLastBillingAdmin/strandsBilling). Re-count
    // BEFORE releaseAssignedWork, and re-insert the exact row (same _id) if this delete raced the
    // org to zero — releaseAssignedWork hasn't run yet, so nothing needs unwinding.
    if (wasBillingAdmin && (await strandsBilling(orgId))) {
      await Membership.create(target.toObject());
      return res.status(409).json(LAST_BILLING_ADMIN_ERROR);
    }
    // …and the same for LIVE admins: a Remove racing an account deletion of the remover (or a staff
    // actor removing the only admin) must not leave the org with nobody to administer it.
    if (wasAdmin && (await countLiveAdmins(orgId)) === 0) {
      await Membership.create(target.toObject());
      return res.status(409).json(LAST_ADMIN_ERROR);
    }
    // This used to drop CampaignAssignment + CampaignManager only, which left the removed
    // person still holding every TurfAssignment and EffortMember row they had — so their
    // books stayed "assigned" to somebody who was no longer in the org, those doors never
    // resurfaced as unassigned, and the effort readiness rollup still counted them as crew.
    // releaseAssignedWork is shared with account deletion so the two paths can't drift.
    const released = await releaseAssignedWork(req.params.userId, { organizationId: orgId });
    res.json({ ok: true, released });
  } catch (err) {
    next(err);
  }
});

// ── Delete a member's account (docs/PROPOSAL_ADMIN_ACCOUNT_DELETION.md) ───────────────────────
// Admins only — never leads (requireAdminRole). An account can be deleted from here only when it
// belongs to this organization alone; the rules, in order, live in reviewOrgDeletion, which both
// routes run so the review the admin read and the rule the DELETE enforces are the same code.
// Both routes name the person in the support-access log when a grant-holder calls them.

const deletionGuards = async (req, res) => {
  if (!ensureOrgScoped(req, res)) return false;
  if (!mongoose.isValidObjectId(req.params.userId)) {
    res.status(400).json({ error: 'Invalid userId' });
    return false;
  }
  if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return false;
  addAuditSubjects(res, 'user', req.params.userId);
  return true;
};

// An unknown id and a member of another org get the SAME 404, so the route can't be used to test
// whether an id exists elsewhere.
const deletionErrorResponse = (res, err) => {
  if (err.code === 'NOT_A_MEMBER') return res.status(404).json({ error: 'Member not in this org', code: 'NOT_A_MEMBER' });
  if (err.code === 'NOT_FOUND') return res.status(404).json({ error: 'Member not in this org', code: 'NOT_A_MEMBER' });
  return res.status(409).json({ error: err.message, code: err.code, ...err.details });
};

// The review: what deleting this person means, worked out from their own records, and anything that
// stands in the way. A membership elsewhere answers with that one blocker and nothing else.
router.get('/:userId/deletion-check', requireAdminRole, async (req, res, next) => {
  try {
    if (!(await deletionGuards(req, res))) return;
    const review = await reviewOrgDeletion({ userId: req.params.userId, req });
    if (review.otherOrganization) {
      return res.json({ canDelete: false, blockers: review.blockers });
    }
    res.json({
      canDelete: review.blockers.length === 0,
      blockers: review.blockers,
      confirmEmail: review.confirmEmail,
      kind: review.kind,
      usage: review.usage,
      holding: review.holding,
    });
  } catch (err) {
    if (err instanceof AccountDeletionError) return deletionErrorResponse(res, err);
    next(err);
  }
});

// Delete it. `confirmEmail` is the address the admin typed back; `expectKind` is the kind the review
// showed them, so an account that changed from unused to used since (they just signed in) is
// refused rather than deleted on terms the admin never read.
router.delete('/:userId/account', requireAdminRole, async (req, res, next) => {
  try {
    if (!(await deletionGuards(req, res))) return;
    const orgId = activeOrgId(req);
    const review = await reviewOrgDeletion({ userId: req.params.userId, req });
    if (review.blockers.length) {
      return res.status(409).json({ error: 'This account can’t be deleted.', code: 'BLOCKED', blockers: review.blockers });
    }
    const confirmEmail = String(req.body?.confirmEmail || '').trim().toLowerCase();
    if (!confirmEmail || confirmEmail !== String(review.confirmEmail || '').toLowerCase()) {
      return res.status(400).json({
        error: 'Type the account’s email exactly to confirm.',
        code: 'confirm-email-mismatch',
      });
    }
    if (req.body?.expectKind !== review.kind) {
      return res.status(409).json({
        error: 'Something about this account changed since you reviewed it. Review it again before deleting.',
        code: 'USAGE_CHANGED',
      });
    }
    const result = await deleteAccount(req.params.userId, {
      reason: review.reason,
      deletedBy: req.user._id,
      org: { organizationId: orgId, unused: review.kind === 'unused' },
      reviewed: true,
    });
    // Ids, never the address: Heroku's log is the incident-response copy, DeletedUserRecord the record.
    console.warn(`[user-delete] ${req.user._id} deleted account ${req.params.userId} in org ${orgId} (${review.kind})`);
    res.json({ ok: true, deletedAt: result.deletedAt, kind: review.kind, released: result.released });
  } catch (err) {
    if (err instanceof AccountDeletionError) return deletionErrorResponse(res, err);
    next(err);
  }
});

// Identity edits (name/email/phone). Admin: anyone in the org. LEAD (since 2026-08-09, owner
// ruling): their canvassers only — the same leadMayManageTarget wall as the temp-password power
// they already hold, which is the more dangerous of the two. A lead owns onboarding, so fixing
// their own hire's typo'd name or email shouldn't need an admin. Every guard below the gate
// (vendor staff, tombstone, the multi-org email lock, dup-email 409) applies to both roles —
// the lock matters most here: a User is platform-wide, and it is what keeps a lead (or admin)
// from rewriting the login email of somebody who also works for another organization.
router.patch('/:userId/user', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    if (!isOrgAdmin(req) && !(await leadMayManageTarget(req, req.params.userId))) {
      return res.status(403).json({ error: 'You can only edit canvassers on your campaigns.' });
    }
    if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return;
    const membership = await Membership.findOne({
      userId: req.params.userId,
      organizationId: activeOrgId(req),
    });
    if (!membership) return res.status(404).json({ error: 'Member not in this org' });

    const targetUser = await User.findById(req.params.userId);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    // A deleted account is terminal. Without this guard an admin could write a real name and
    // a routable email straight back onto the tombstone — un-deleting the PII the user asked
    // us to destroy — because this route only checks that a Membership exists in the org.
    if (targetUser.deletedAt) return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });

    const data = updateUserSchema.parse(req.body);
    if (data.email) data.email = data.email.toLowerCase();
    if (data.phone === '') data.phone = null;

    // The login email of a multi-org user is shared across every org they belong
    // to, so only the user themselves or a super-admin may change it. Name/phone
    // stay editable. (The admin UI also disables the field, but this is the real
    // guard against a tampered request.)
    if (data.email && data.email !== targetUser.email) {
      const isSelf = String(req.params.userId) === String(req.user._id);
      if (!req.user.isSuperAdmin && !isSelf) {
        const activeCount = await Membership.countDocuments({
          userId: req.params.userId,
          isActive: true,
        });
        if (activeCount >= 2) {
          return res.status(403).json({
            error:
              'This user belongs to multiple organizations; their login email can only be changed by the user or a super-admin.',
            code: 'MULTI_ORG_EMAIL_LOCKED',
          });
        }
      }
    }

    // Conditional on the account still being live: a deletion that lands between the check above and
    // this write must not get a real name and email written back onto its tombstone.
    const user = await User.findOneAndUpdate({ _id: req.params.userId, deletedAt: null }, data, { new: true });
    if (!user) return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });
    res.json({ user: user.toSafeJSON() });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Email already exists' });
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.patch('/:userId/password', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return;
    // A lead may reset only a CANVASSER on a campaign they manage — never a fellow
    // lead or an admin.
    if (!isOrgAdmin(req) && !(await leadMayManageTarget(req, req.params.userId))) {
      return res.status(403).json({ error: 'You can only reset passwords for canvassers on your campaigns.' });
    }
    const membership = await Membership.findOne({
      userId: req.params.userId,
      organizationId: activeOrgId(req),
    });
    if (!membership) return res.status(404).json({ error: 'Member not in this org' });

    // Without this, "deleted" would be resurrectable: an admin re-issues a temp password and
    // the account is alive again. Apple: "only offering to temporarily deactivate or disable
    // an account is insufficient." Deletion has to be the one thing an admin cannot undo.
    const target = await User.findById(req.params.userId).select('deletedAt');
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.deletedAt) return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });

    // NOTE (item 14 — cross-org link-and-reset): passwords are per-USER, not per-org (one User row, one
    // passwordHash, shared across every org the person belongs to), so an admin of one org resetting a
    // multi-org member's password affects that person's login everywhere. A self-serve email reset NOW
    // EXISTS (POST /auth/forgot-password — a locked-out multi-org user can rescue themselves), which
    // removes the old "blocking would strand them" objection — but by owner decision the admin path
    // stays unrestricted: field reality is a canvasser at a door with a dead login and an email they
    // can't reach. If that trade ever flips, the guard is one MULTI_ORG_EMAIL_LOCKED-shaped step away
    // (see the email route above). The standing mitigation: the new password is TEMPORARY
    // (mustChangePassword forces a change at next login), so misuse is not silent — the legitimate
    // user is locked out visibly the moment their old password stops working. Flagged for counsel in
    // docs/PRIVACY_VERIFICATION.md (item 14, open by decision).
    const { password } = passwordSchema.parse(req.body);
    const passwordHash = await User.hashPassword(password);
    // This is a TEMPORARY password: the user is forced to choose a new one at
    // their next login, so an admin never holds a working key to the user's
    // other orgs. See passwordGate.js and POST /auth/change-password.
    const user = await User.findOneAndUpdate(
      { _id: req.params.userId, deletedAt: null },
      { passwordHash, mustChangePassword: true, tempPasswordSetAt: new Date() },
      { new: true }
    );
    if (!user) return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });
    res.json({ user: user.toSafeJSON() });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Re-send the set-password invite. Until this existed, an invite was sent ONCE, at account
// creation, and there was no second chance: the admin-typed temp password expires after
// TEMP_PASSWORD_TTL_HOURS (72), so a person who never signed in within three days — or who was
// created before invite emails existed at all — was simply stranded. Their only escape was
// self-serve /auth/forgot-password, which requires telling them to go and do it.
//
// This re-mints the SAME 72h invite token and re-sends the SAME template the create path uses,
// so there is one invite experience rather than two that can drift.
router.post('/:userId/resend-invite', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return;
    // Same boundary as the temp-password reset: a lead may act only on a CANVASSER rostered to a
    // campaign they manage. Re-sending an invite is strictly LESS powerful than setting someone's
    // password, which leads can already do, so refusing it here would be inconsistent.
    // isOrgAdmin covers org admins AND super admins.
    if (!isOrgAdmin(req) && !(await leadMayManageTarget(req, req.params.userId))) {
      return res
        .status(403)
        .json({ error: 'You can only resend invites for canvassers on your campaigns.' });
    }

    const membership = await Membership.findOne({
      userId: req.params.userId,
      organizationId: activeOrgId(req),
    }).lean();
    if (!membership) return res.status(404).json({ error: 'Member not in this org' });

    const user = await loadResendUser(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // The send itself lives in services/memberships/resendInvite.js, shared with the staff route
    // (POST /super-admin/users/:userId/resend-invite) so the two can never drift.
    const result = await resendInvite({ user, membership, org: req.activeOrg });
    res.json(result);
  } catch (err) {
    if (err instanceof ResendInviteError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    next(err);
  }
});

router.patch('/:userId/deactivate', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return;
    // Same lead boundary as /password. The write is still org-wide by design (Membership
    // has no campaignId) — the disclosure lives in the leadCrew variant's alsoAffects.
    if (!isOrgAdmin(req) && !(await leadMayManageTarget(req, req.params.userId))) {
      return res.status(403).json({ error: 'You can only deactivate canvassers on your campaigns.' });
    }
    const existing = await Membership.findOne({ userId: req.params.userId, organizationId: activeOrgId(req) });
    if (!existing) return res.status(404).json({ error: 'Membership not found' });
    if (await isLastBillingAdmin(existing)) {
      return res.status(409).json(LAST_BILLING_ADMIN_ERROR);
    }
    const wasBillingAdmin = existing.billingAccess && existing.role === 'admin' && existing.isActive;
    const membership = await Membership.findOneAndUpdate(
      { userId: req.params.userId, organizationId: activeOrgId(req) },
      { isActive: false },
      { new: true }
    );
    if (!membership) return res.status(404).json({ error: 'Membership not found' });
    // Post-write backstop for the concurrency race (see isLastBillingAdmin/strandsBilling).
    if (wasBillingAdmin && (await strandsBilling(activeOrgId(req)))) {
      await Membership.updateOne({ _id: existing._id }, { isActive: true });
      return res.status(409).json(LAST_BILLING_ADMIN_ERROR);
    }
    if (existing.role === 'admin' && existing.isActive && (await countLiveAdmins(activeOrgId(req))) === 0) {
      await Membership.updateOne({ _id: existing._id }, { isActive: true });
      return res.status(409).json(LAST_ADMIN_ERROR);
    }
    res.json({ membership });
  } catch (err) {
    next(err);
  }
});

router.patch('/:userId/reactivate', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (await refuseVendorStaffTarget(req, res, { userId: req.params.userId })) return;
    if (!isOrgAdmin(req) && !(await leadMayManageTarget(req, req.params.userId))) {
      return res.status(403).json({ error: 'You can only reactivate canvassers on your campaigns.' });
    }
    // Reactivating a deleted user's membership would put a tombstone back on the roster and
    // back into the team headcount. The login stays shut either way (auth gates on
    // deletedAt), but the org should never see them offered as assignable again.
    const target = await User.findById(req.params.userId).select('deletedAt');
    if (target?.deletedAt) {
      return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });
    }
    const membership = await Membership.findOneAndUpdate(
      { userId: req.params.userId, organizationId: activeOrgId(req) },
      { isActive: true },
      { new: true }
    );
    if (!membership) return res.status(404).json({ error: 'Membership not found' });
    // The check above can't see a deletion that finishes in between; this one can.
    if (await convergeIfDeleted({ userId: req.params.userId, organizationId: activeOrgId(req), membershipId: membership._id })) {
      return res.status(409).json({ error: 'This account was deleted.', code: 'ACCOUNT_DELETED' });
    }
    res.json({ membership });
  } catch (err) {
    next(err);
  }
});

// Which campaigns this user is on the roster for (drives the mobile profile "Campaigns"
// section — assign a canvasser to campaigns from their own page). Read-only.
router.get('/:userId/campaigns', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (!isOrgAdmin(req) && !(await leadMaySeeTarget(req, req.params.userId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // A lead gets only the campaigns they manage, the same cut GET / makes on campaignIds.
    const rows = await CampaignAssignment.find(
      { userId: req.params.userId, organizationId: activeOrgId(req), ...inLeadScope(await leadCampaignScope(req)) },
      { campaignId: 1 }
    ).lean();
    res.json({ campaignIds: rows.map((r) => String(r.campaignId)) });
  } catch (err) {
    next(err);
  }
});

router.get('/:userId/stats', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (!isOrgAdmin(req) && !(await leadMaySeeTarget(req, req.params.userId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const orgId = activeOrgId(req);
    const userId = new mongoose.Types.ObjectId(req.params.userId);
    // Day-bucket in the ORG's timezone (this stat spans the user's activity across all
    // campaigns, so no single campaign tz applies) — not the viewer's device tz, so the
    // per-day chart matches the dashboard and reads the same for every admin.
    const org = await Organization.findById(orgId, { timeZone: 1 }).lean();
    const tz = org?.timeZone || 'America/New_York';

    let dayFormatter;
    try {
      dayFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      dayFormatter.format(new Date());
    } catch {
      return res.status(400).json({ error: 'Invalid tz' });
    }
    const dayStr = (date) => dayFormatter.format(date);
    // A lead's totals cover the campaigns they manage only (leadCampaignScope).
    const scope = inLeadScope(await leadCampaignScope(req));

    const [activities, surveysSubmitted, fbtimeConn, fbtimeLink] = await Promise.all([
      CanvassActivity.find({
        userId,
        organizationId: orgId,
        actionType: { $in: [...DOOR_ACTIONS, 'restricted'] },
        via: { $ne: 'bulk' }, // admin bulk marks aren't this user's field work
        ...scope,
      })
        .sort({ timestamp: 1 })
        .select('timestamp location actionType campaignId')
        .lean(),
      SurveyResponse.countDocuments({ userId, organizationId: orgId, ...scope }),
      // Whether THIS person's hours are measured — answerable only here, because the
      // Integrations page is admin-only and a lead had no way to find out at all.
      FbTimeConnection.findOne({ organizationId: orgId, status: 'connected' })
        .select('_id keptAccounts')
        .lean(),
      FbTimePersonLink.findOne({ organizationId: orgId, userId })
        .select('fbtimeName fbtimeEmail source linkedAt')
        .lean(),
    ]);
    // Not linked, but kept for an FbTime person (Unlink → "Yes — keep"): the hours it clocked
    // before it was kept are still its own, so it must not read "count nowhere until linked".
    const keptEntry = !fbtimeLink
      ? (fbtimeConn?.keptAccounts || []).find((k) => String(k.userId) === String(userId))
      : null;
    const keptPersonLink = keptEntry
      ? await FbTimePersonLink.findOne({
          organizationId: orgId,
          fbtimePersonId: new RegExp(`^${String(keptEntry.fbtimePersonId).toLowerCase()}$`, 'i'),
        })
          .select('fbtimeName')
          .lean()
      : null;

    let doorsKnocked = 0;
    let restricted = 0;
    let litDropped = 0;
    let lastActivityAt = null;
    const campaignSet = new Set();
    const distanceByDay = new Map();

    for (const a of activities) {
      // Restricted counts toward the campaign set / last-activity / travel, but not doorsKnocked.
      if (a.actionType === 'restricted') restricted++;
      else doorsKnocked++;
      if (a.actionType === 'lit_dropped') litDropped++;
      if (a.campaignId) campaignSet.add(String(a.campaignId));
      lastActivityAt = a.timestamp;

      const d = dayStr(a.timestamp);
      let bucket = distanceByDay.get(d);
      if (!bucket) {
        bucket = { prev: null, total: 0 };
        distanceByDay.set(d, bucket);
      }
      if (a.location && bucket.prev) {
        bucket.total += haversineMeters(
          bucket.prev.lat,
          bucket.prev.lng,
          a.location.lat,
          a.location.lng
        );
      }
      if (a.location) bucket.prev = a.location;
    }

    let distanceMeters = 0;
    for (const b of distanceByDay.values()) distanceMeters += b.total;

    res.json({
      doorsKnocked,
      restricted,
      surveysSubmitted,
      litDropped,
      distanceMeters: Math.round(distanceMeters),
      campaignsWorked: campaignSet.size,
      lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
      // Link state only — never this person's hours. The modal answers "are their
      // doors-per-hour built on clock time?", which the mapping alone decides; the
      // numbers themselves stay on the report surfaces that already carry them.
      // `connected:false` collapses the whole thing to nothing on screen, so an org
      // that never connected FbTime sees no new row.
      fbtime: {
        connected: Boolean(fbtimeConn),
        linked: Boolean(fbtimeLink || keptEntry),
        personName: fbtimeLink?.fbtimeName || fbtimeLink?.fbtimeEmail || keptPersonLink?.fbtimeName || null,
        source: fbtimeLink?.source || null,
        // An earlier account kept for that FbTime person — its hours before it was kept count.
        // (Lead-visible like the rest of this block, so no dates: just the fact.)
        kept: Boolean(keptEntry),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:userId/recent-activity', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (!isOrgAdmin(req) && !(await leadMaySeeTarget(req, req.params.userId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const orgId = activeOrgId(req);
    const userId = new mongoose.Types.ObjectId(req.params.userId);
    const requested = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), 100)
      : 20;
    // Show more pages with `skip`. There is no total: a client stops when a page comes back short or
    // adds no new ids, because a server that predates `skip` answers page one again.
    const skipped = parseInt(req.query.skip, 10);
    const skip = Number.isFinite(skipped) ? Math.min(Math.max(skipped, 0), 10_000) : 0;

    // Door addresses and campaign names: for a lead, from the campaigns they manage only
    // (leadCampaignScope). Desk marks (via: 'bulk') are left out, as in /stats and every report.
    const activities = await CanvassActivity.find({
      userId,
      organizationId: orgId,
      actionType: { $in: [...DOOR_ACTIONS, 'restricted'] },
      via: { $ne: 'bulk' },
      ...inLeadScope(await leadCampaignScope(req)),
    })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      // One person's ledger: the person index, so the org-scoped filter can't send the planner to the
      // organization's (services/memberships/restampCoordinator.js INDEX HINTS).
      .hint({ userId: 1, timestamp: -1 })
      .populate('householdId', 'addressLine1 city state zipCode')
      .populate('campaignId', 'name')
      .lean();

    res.json({
      activities: activities.map((a) => ({
        id: String(a._id),
        actionType: a.actionType,
        timestamp: a.timestamp.toISOString(),
        household: a.householdId
          ? {
              id: String(a.householdId._id),
              addressLine1: a.householdId.addressLine1,
              city: a.householdId.city,
              state: a.householdId.state,
              zipCode: a.householdId.zipCode,
            }
          : null,
        campaign: a.campaignId
          ? { id: String(a.campaignId._id), name: a.campaignId.name }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
