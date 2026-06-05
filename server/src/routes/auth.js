import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Membership } from '../models/Membership.js';
import { signUserToken } from '../services/auth/tokens.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// A temporary password (admin reset) is only usable for this long. After that the
// user must ask an admin to reset again — this bounds how long a leaked temp
// password is a working key to the user's other orgs. See passwordGate.js.
const TEMP_PASSWORD_TTL_HOURS = 72;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

async function loadMembershipsForUser(userId) {
  return Membership.find({ userId, isActive: true })
    .populate({ path: 'organizationId', select: 'name slug isActive' })
    .lean()
    .then((rows) =>
      rows
        .filter((m) => m.organizationId && m.organizationId.isActive)
        .map((m) => ({
          membershipId: String(m._id),
          organizationId: String(m.organizationId._id),
          organizationName: m.organizationId.name,
          organizationSlug: m.organizationId.slug,
          role: m.role,
          // null acknowledgedAt = the user hasn't dismissed the "added to org" banner yet.
          isNew: !m.acknowledgedAt,
        }))
    );
}

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const ok = await user.verifyPassword(password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    if (user.mustChangePassword && user.tempPasswordSetAt) {
      const ageMs = Date.now() - new Date(user.tempPasswordSetAt).getTime();
      if (ageMs > TEMP_PASSWORD_TTL_HOURS * 60 * 60 * 1000) {
        return res.status(401).json({
          error: 'This temporary password has expired. Ask an admin to reset it again.',
          code: 'TEMP_PASSWORD_EXPIRED',
        });
      }
    }

    User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }).catch(() => {});

    const token = signUserToken(user);
    const memberships = await loadMembershipsForUser(user._id);
    res.json({ token, user: user.toSafeJSON(), memberships });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const memberships = await loadMembershipsForUser(req.user._id);
    res.json({ user: req.user.toSafeJSON(), memberships });
  } catch (err) {
    next(err);
  }
});

// Self-service password change. Doubles as the forced "set a new password" step
// after an admin issues a temporary one. Only needs requireAuth — a locked-out
// multi-org user has no active org, so this must NOT depend on orgContext.
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const ok = await req.user.verifyPassword(currentPassword);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: 'New password must be different from the current one.' });
    }

    const passwordHash = await User.hashPassword(newPassword);
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { passwordHash, mustChangePassword: false, tempPasswordSetAt: null },
      { new: true }
    );
    const memberships = await loadMembershipsForUser(user._id);
    res.json({ user: user.toSafeJSON(), memberships });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Dismiss the "you were added to this org" banner. A user can only acknowledge
// their OWN memberships (scoped by req.user._id) — no org-admin rights needed.
router.post('/memberships/:membershipId/acknowledge', requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.membershipId)) {
      return res.status(400).json({ error: 'Invalid membershipId' });
    }
    const membership = await Membership.findOneAndUpdate(
      { _id: req.params.membershipId, userId: req.user._id, acknowledgedAt: null },
      { acknowledgedAt: new Date() },
      { new: true }
    );
    if (!membership) return res.status(404).json({ error: 'Membership not found or already acknowledged' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  res.json({ ok: true });
});

export default router;
