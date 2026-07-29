import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Organization } from '../../models/Organization.js';
import { requireAuth, requireSuperAdmin, requireBreakGlass } from '../../middleware/auth.js';
import { clearLoginLockout, loginLockoutStatus } from '../../middleware/loginRateLimit.js';
import { buildUserOversight } from '../../services/platform/userOversight.js';
import {
  resendInvite,
  loadResendUser,
  ResendInviteError,
} from '../../services/memberships/resendInvite.js';
import {
  checkDeletionBlockers,
  deleteAccount,
  AccountDeletionError,
} from '../../services/users/deleteAccount.js';

const router = Router();
router.use(requireAuth, requireSuperAdmin);

// The all-users list. Opt-in paging contract: without skip/limit the FULL list returns in the
// legacy shape (shipped mobile builds call it parameterless); with them, a page + exact totals,
// server-side search (`q` on name/email), and the operator filters that used to be impossible
// (deleted tombstones, temp passwords, orphans, supers).
router.get('/', async (req, res, next) => {
  try {
    const qText = (req.query.q || '').toString().trim();
    const filter = {};
    if (qText) {
      const rx = new RegExp(qText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }];
    }
    if (req.query.super === '1') filter.isSuperAdmin = true;
    if (req.query.deleted === '1') filter.deletedAt = { $ne: null };
    if (req.query.tempPassword === '1') filter.mustChangePassword = true;
    if (req.query.active === '1') filter.isActive = true;
    if (req.query.active === '0') filter.isActive = false;
    // Orphans (zero active memberships) can't be expressed as a find() predicate directly.
    if (req.query.orphan === '1') {
      const withMembership = await Membership.distinct('userId', { isActive: true });
      filter._id = { $nin: withMembership };
    }

    const paged = req.query.skip !== undefined || req.query.limit !== undefined;
    const limit = paged ? Math.min(Math.max(Number(req.query.limit) || 25, 1), 100) : 0;
    const skip = paged ? Math.max(Number(req.query.skip) || 0, 0) : 0;

    // Allowlisted sort (never user input into .sort() — the imports-route precedent). The default
    // CHANGED from { createdAt: -1 } to alphabetical: creation order reads as random, because no
    // list column shows it. Mobile sends no sort param, so the new default reaches it too.
    //
    // `_id` as the final tiebreaker is NOT decoration. Names collide, and Mongo gives ties no
    // stable order across separate skip/limit queries — without it, web's Prev/Next and mobile's
    // infinite scroll can duplicate or drop a row at a page boundary.
    //
    // lastActivityAt is deliberately absent: it is fetched per-row AFTER the page is chosen
    // (below) and withheld from the un-paged path — a test pins that. Sorting by it needs an
    // aggregation or a denormalized field; don't add it here casually.
    const SORTS = {
      name: { lastName: 1, firstName: 1, _id: 1 },
      email: { email: 1, _id: 1 },
      created: { createdAt: -1, _id: 1 },
      lastLogin: { lastLoginAt: -1, _id: 1 },
      lastSeen: { lastSeenAt: -1, _id: 1 },
    };
    const sortSpec = SORTS[req.query.sort] || SORTS.name;

    let query = User.find(filter).sort(sortSpec);
    if (paged) query = query.skip(skip).limit(limit);
    const [users, total, deletedCount] = await Promise.all([
      query.lean(),
      User.countDocuments(filter),
      // So the headline can say "N accounts · M deleted" instead of letting tombstones
      // silently inflate one number.
      User.countDocuments({ ...filter, deletedAt: { $ne: null } }),
    ]);

    const userIds = users.map((u) => u._id);
    const memberships = await Membership.find({ userId: { $in: userIds }, isActive: true })
      .populate({ path: 'organizationId', select: 'name slug' })
      .lean();
    const byUser = new Map();
    for (const m of memberships) {
      const arr = byUser.get(String(m.userId)) || [];
      if (m.organizationId) {
        arr.push({
          organizationId: String(m.organizationId._id),
          organizationName: m.organizationId.name,
          role: m.role,
        });
      }
      byUser.set(String(m.userId), arr);
    }

    // Last field activity per PAGE user — one indexed point-read each ({userId, timestamp: -1}).
    // Paged requests only: the legacy full-list path must not fan out a read per account.
    const lastActive = paged
      ? await Promise.all(
        users.map((u) => CanvassActivity.findOne({ userId: u._id }, 'timestamp').sort({ timestamp: -1 }).lean())
      )
      : [];

    res.json({
      users: users.map((u, i) => ({
        id: String(u._id),
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        phone: u.phone,
        isSuperAdmin: !!u.isSuperAdmin,
        // support vs break_glass — the field the whole least-privilege model hinges on.
        platformRole: u.isSuperAdmin ? (u.platformRole || 'support') : null,
        isActive: u.isActive,
        deletedAt: u.deletedAt || null,
        deletionLocked: !!u.deletionLocked,
        mustChangePassword: !!u.mustChangePassword,
        lastLoginAt: u.lastLoginAt,
        // Unlike lastActivityAt below, this is NOT gated on `paged` — it's already on the lean doc,
        // so the legacy full-list path carries it for free.
        lastSeenAt: u.lastSeenAt || null,
        lastActivityAt: paged ? lastActive[i]?.timestamp || null : undefined,
        createdAt: u.createdAt,
        memberships: byUser.get(String(u._id)) || [],
      })),
      total,
      deletedCount,
    });
  } catch (err) {
    next(err);
  }
});

// The drill-in composite: full identity (incl. tempPasswordSetAt/deletionLocked, which no list
// surface carries), ALL memberships including deactivated ones (the list hard-filters those out —
// removed ones can't appear anywhere; the row is hard-deleted), structural activity counts, staff
// grant/access history when the account is a super admin, and DeletedUserRecord STATUS (dates only,
// never the tombstone's name content). Pure metadata — no grant needed, no AccessLog row written.
router.get('/:userId', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    const detail = await buildUserOversight(req.params.userId);
    if (!detail) return res.status(404).json({ error: 'User not found' });
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

// Read a user's current login-lockout state (per-email failed-attempt counter). Honest caveat:
// the store is per web process, so this reflects the dyno that served THIS request — the UI must
// say "on this server". The env allowlist is the durable, dyno-independent fix.
router.get('/:userId/lockout', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    const target = await User.findById(req.params.userId, 'email').lean();
    if (!target) return res.status(404).json({ error: 'User not found' });
    const status = await loginLockoutStatus(target.email);
    res.json({ email: target.email, scope: 'this-process', ...status });
  } catch (err) {
    next(err);
  }
});

const platformRoleSchema = z.object({ platformRole: z.enum(['support', 'break_glass']) });

// Break-glass only: the support/break-glass split is the least-privilege model itself.
// Refuses to demote the LAST break-glass account — someone must always be able to escalate
// (same spirit as the last-billing-admin guard on account deletion).
router.patch('/:userId/platform-role', requireBreakGlass, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    const { platformRole } = platformRoleSchema.parse(req.body);
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!target.isSuperAdmin) {
      return res.status(400).json({ error: 'Only super-admin accounts have a platform role.' });
    }
    if ((target.platformRole || 'support') === platformRole) {
      return res.status(400).json({ error: `Already ${platformRole}.` });
    }
    if (platformRole === 'support') {
      const otherBreakGlass = await User.countDocuments({
        _id: { $ne: target._id },
        isSuperAdmin: true,
        platformRole: 'break_glass',
        isActive: true,
      });
      if (!otherBreakGlass) {
        return res.status(400).json({
          error: 'This is the last break-glass account — grant another one before demoting it.',
          code: 'LAST_BREAK_GLASS',
        });
      }
    }
    target.platformRole = platformRole;
    await target.save();
    res.json({ user: target.toSafeJSON() });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Break-glass only: granting platform authority is how a support account would become a god account.
router.post('/:userId/promote', requireBreakGlass, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    if (String(req.params.userId) === String(req.user._id)) {
      return res
        .status(400)
        .json({ error: "You can't change your own super-admin flag." });
    }
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    target.isSuperAdmin = !target.isSuperAdmin;
    await target.save();
    res.json({ user: target.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

// Re-send a set-password invite into ANY org, including one staff are not members of.
//
// Why this exists as a staff route rather than by relaxing a guard: the org-scoped button
// (POST /admin/memberships/:userId/resend-invite) needs MEMBERSHIP, and staff entering a customer
// org get req.supportGrant, which that router refuses for every non-GET (VENDOR_READ_ONLY). So a
// provisioned client whose 72h temp password lapsed — "I'm trying to use it but I can't get in" —
// could not be helped from the console at all.
//
// This is NOT a VENDOR_READ_ONLY bypass, and the distinction is the point. That guard stops a
// grant-holder WRITING through the customer-facing /admin router, up to and including minting
// themselves a membership. This is one named capability on /super-admin that cannot change a role,
// cannot create an account, and exposes no data: it emails the address already on the account a
// link to set THEIR OWN password. Staff never learn a credential and cannot sign in as them —
// which is exactly why the sibling action (set a temporary password, where staff choose the secret
// and could then impersonate) is deliberately NOT offered here.
//
// Tier: plain super-admin, not break-glass. Unsticking a locked-out user is already support-tier
// work — see POST /:userId/clear-lockout below. The line is recoverable help → support tier,
// irreversible destruction → break-glass (see DELETE /:userId).
//
// Attribution is free: sendMail writes an EmailLog row carrying kind, to, organizationId and
// userId, visible at super-admin → Emails. No new model.
router.post('/:userId/resend-invite', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    // REQUIRED, never inferred. A user can belong to several orgs and the invite email names one
    // ("You've been added to {orgName}"), so guessing would mail a client the wrong company's name.
    // The console never has to ask: buildUserOversight already returns memberships with org names,
    // so the action sits on a specific membership row.
    const organizationId = String(req.body?.organizationId || '');
    if (!mongoose.isValidObjectId(organizationId)) {
      return res.status(400).json({
        error: 'organizationId is required — an invite names the organization it is for.',
        code: 'ORG_REQUIRED',
      });
    }

    const [org, membership, user] = await Promise.all([
      Organization.findById(organizationId, 'name').lean(),
      Membership.findOne({ userId: req.params.userId, organizationId }, 'role').lean(),
      loadResendUser(req.params.userId),
    ]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (!membership) {
      return res.status(404).json({ error: 'That user is not a member of that organization.' });
    }
    // Someone who has signed in already has a working password; the honest remedy for them is
    // Forgot password, not an admin silently killing whatever link they hold.
    if (user.lastLoginAt) {
      return res.status(409).json({
        error: 'This person has already signed in — they should use Forgot password instead.',
        code: 'ALREADY_SIGNED_IN',
      });
    }

    const result = await resendInvite({ user, membership, org });
    console.warn(
      `[staff-resend-invite] ${req.user.email || req.user._id} re-invited ${user.email} to '${org.name}'`
    );
    res.json(result);
  } catch (err) {
    if (err instanceof ResendInviteError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    next(err);
  }
});

// What would stand in the way of deleting this account. The console calls this BEFORE offering
// the button, so an operator sees "sole admin of Acme" instead of discovering it on submit.
// Mirrors GET /auth/account/deletion-check, which the mobile deletion sheet uses for the same
// reason. Break-glass because it is the preflight for a break-glass action: showing a support
// tier a refusal list for a button they can never press is noise.
router.get('/:userId/deletion-check', requireBreakGlass, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    const { user, blockers } = await checkDeletionBlockers(req.params.userId);
    res.json({
      canDelete: blockers.length === 0,
      blockers,
      // The console echoes this back as the typed confirmation, so it must come from the server
      // rather than from whatever the list happened to be showing.
      confirmEmail: user.email,
    });
  } catch (err) {
    if (err instanceof AccountDeletionError) {
      // NOT_FOUND → 404; ALREADY_DELETED → 409. checkDeletionBlockers THROWS these rather than
      // returning them as blockers, so they need mapping or they surface as a 500.
      return res.status(err.code === 'NOT_FOUND' ? 404 : 409).json({ error: err.message, code: err.code });
    }
    next(err);
  }
});

// Delete an account from the console — the GUI replacement for `npm run delete:account`, which
// until now was the ONLY staff path and required Heroku Run-console access.
//
// Break-glass, matching DELETE /super-admin/organizations/:orgId ("this destroys a customer's
// entire account, irreversibly"). Deleting one person should not be easier than deleting their org.
//
// `confirmEmail` is the analogue of that route's typed `confirmSlug`, and is deliberately the SAME
// string the CLI takes — so this is a one-for-one replacement for the command it retires, not a new
// and looser way in. Every blocker still applies and there is no force flag, matching the CLI's
// "Deliberately no --force".
router.delete('/:userId', requireBreakGlass, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    const target = await User.findById(req.params.userId, 'email').lean();
    if (!target) return res.status(404).json({ error: 'User not found' });

    const confirmEmail = String(req.body?.confirmEmail || '').trim().toLowerCase();
    if (confirmEmail !== String(target.email || '').toLowerCase()) {
      return res.status(400).json({
        error: `Type the account's email (${target.email}) to confirm deletion.`,
        code: 'confirm-email-mismatch',
      });
    }

    const result = await deleteAccount(req.params.userId, {
      reason: 'super_admin',
      deletedBy: req.user._id,
    });
    // Mirrors [org-delete]. Ephemeral on Heroku, so it is the incident-response copy, not the
    // record — DeletedUserRecord.deletedBy/reason is the durable one.
    console.warn(
      `[user-delete] ${req.user.email || req.user._id} deleted account ${target.email} ` +
        `(orgs: ${result.organizationIds.length})`
    );
    res.json(result);
  } catch (err) {
    if (err instanceof AccountDeletionError) {
      if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message, code: err.code });
      if (err.code === 'ALREADY_DELETED') return res.status(409).json({ error: err.message, code: err.code });
      // BLOCKED carries the refusal list, so the console can name what has to change first.
      return res.status(409).json({ error: err.message, code: err.code, ...err.details });
    }
    next(err);
  }
});

// Recovery for a user stuck behind the login lockout: clears their per-email failed-attempt
// counter so they can retry immediately. See middleware/loginRateLimit.js for the store caveat.
router.post('/:userId/clear-lockout', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    const target = await User.findById(req.params.userId).lean();
    if (!target) return res.status(404).json({ error: 'User not found' });
    const cleared = clearLoginLockout(target.email);
    res.json({ ok: true, cleared, email: target.email });
  } catch (err) {
    next(err);
  }
});

export default router;
