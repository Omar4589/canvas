import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Membership } from '../models/Membership.js';
import { signUserToken } from '../services/auth/tokens.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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

router.post('/logout', requireAuth, async (req, res) => {
  res.json({ ok: true });
});

export default router;
