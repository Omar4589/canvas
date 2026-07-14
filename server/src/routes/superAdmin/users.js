import { Router } from 'express';
import mongoose from 'mongoose';
import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { requireAuth, requireSuperAdmin, requireBreakGlass } from '../../middleware/auth.js';
import { clearLoginLockout } from '../../middleware/loginRateLimit.js';

const router = Router();
router.use(requireAuth, requireSuperAdmin);

router.get('/', async (req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).lean();
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
    res.json({
      users: users.map((u) => ({
        id: String(u._id),
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        phone: u.phone,
        isSuperAdmin: !!u.isSuperAdmin,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
        memberships: byUser.get(String(u._id)) || [],
      })),
    });
  } catch (err) {
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
