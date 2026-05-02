import { Router } from 'express';
import { z } from 'zod';
import { User } from '../../models/User.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const createSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['admin', 'user']).default('user'),
});

const updateSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'user']).optional(),
});

const passwordSchema = z.object({ password: z.string().min(8) });

router.get('/', async (req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json({ users: users.map((u) => u.toSafeJSON()) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const passwordHash = await User.hashPassword(data.password);
    const user = await User.create({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email.toLowerCase(),
      role: data.role,
      passwordHash,
    });
    res.status(201).json({ user: user.toSafeJSON() });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Email already exists' });
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.patch('/:userId', async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    if (data.email) data.email = data.email.toLowerCase();

    // Don't let an admin demote themselves — that would lock them out of the
    // admin console mid-session. They can ask another admin to do it.
    if (
      data.role === 'user' &&
      String(req.params.userId) === String(req.user._id)
    ) {
      return res
        .status(400)
        .json({ error: "You can't change your own role. Ask another admin." });
    }

    const user = await User.findByIdAndUpdate(req.params.userId, data, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: user.toSafeJSON() });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Email already exists' });
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.patch('/:userId/deactivate', async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.userId, { isActive: false }, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

router.patch('/:userId/reactivate', async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.userId, { isActive: true }, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

router.patch('/:userId/password', async (req, res, next) => {
  try {
    const { password } = passwordSchema.parse(req.body);
    const passwordHash = await User.hashPassword(password);
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { passwordHash },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: user.toSafeJSON() });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

export default router;
