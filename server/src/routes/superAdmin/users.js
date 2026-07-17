import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { requireAuth, requireSuperAdmin, requireBreakGlass } from '../../middleware/auth.js';
import { clearLoginLockout, loginLockoutStatus } from '../../middleware/loginRateLimit.js';

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

    let query = User.find(filter).sort({ createdAt: -1 });
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
