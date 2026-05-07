import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User } from '../../models/User.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const DOOR_ACTIONS = ['not_home', 'wrong_address', 'survey_submitted', 'lit_dropped'];

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

// Phone is optional, max 40 chars after trim. Empty string from the client is
// normalized to null in route handlers below so admins can clear the field.
const phoneSchema = z.string().trim().max(40).optional();

const createSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: phoneSchema,
  password: z.string().min(8),
  role: z.enum(['admin', 'user']).default('user'),
});

const updateSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: phoneSchema,
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
      phone: data.phone ? data.phone : null,
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
    // Empty-string phone clears the field; non-empty stays as-is.
    if (data.phone === '') data.phone = null;

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

// Lifetime activity totals for one canvasser. Used by the admin user-profile
// modal. Distance is binned by day in the requested timezone so overnight
// straight-line jumps don't get summed as walking distance.
router.get('/:userId/stats', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const userId = new mongoose.Types.ObjectId(req.params.userId);
    const tz = req.query.tz || 'UTC';

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

    const [activities, surveysSubmitted] = await Promise.all([
      CanvassActivity.find({
        userId,
        actionType: { $in: DOOR_ACTIONS },
      })
        .sort({ timestamp: 1 })
        .select('timestamp location actionType campaignId')
        .lean(),
      SurveyResponse.countDocuments({ userId }),
    ]);

    let litDropped = 0;
    let lastActivityAt = null;
    const campaignSet = new Set();
    const distanceByDay = new Map();

    for (const a of activities) {
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
      doorsKnocked: activities.length,
      surveysSubmitted,
      litDropped,
      distanceMeters: Math.round(distanceMeters),
      campaignsWorked: campaignSet.size,
      lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
