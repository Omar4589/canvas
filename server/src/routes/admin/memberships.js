import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));

const DOOR_ACTIONS = ['not_home', 'wrong_address', 'survey_submitted', 'lit_dropped'];
const phoneSchema = z.string().trim().max(40).optional();

const addSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'canvasser']).default('canvasser'),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: phoneSchema,
  password: z.string().min(8).optional(),
  // true = the admin intends to link an EXISTING global account by email.
  // false = create a brand-new account. Lets us give a clear error either way.
  linkExisting: z.boolean().optional().default(false),
});

const updateMembershipSchema = z.object({
  role: z.enum(['admin', 'canvasser']).optional(),
  isActive: z.boolean().optional(),
});

const updateUserSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: phoneSchema,
});

const passwordSchema = z.object({ password: z.string().min(8) });

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

router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const memberships = await Membership.find({ organizationId: activeOrgId(req) })
      .populate({ path: 'userId' })
      .sort({ createdAt: -1 })
      .lean();
    const members = memberships.filter((m) => m.userId);

    // How many active orgs each member belongs to GLOBALLY — so the UI can lock
    // the login-email field for multi-org users. We expose only a boolean, never
    // which other orgs they're in.
    const userIds = members.map((m) => m.userId._id);
    const counts = await Membership.aggregate([
      { $match: { userId: { $in: userIds }, isActive: true } },
      { $group: { _id: '$userId', count: { $sum: 1 } } },
    ]);
    const orgCount = new Map(counts.map((c) => [String(c._id), c.count]));

    res.json({
      members: members.map((m) => ({
        membershipId: String(m._id),
        role: m.role,
        isActive: m.isActive,
        addedAt: m.createdAt,
        user: {
          id: String(m.userId._id),
          firstName: m.userId.firstName,
          lastName: m.userId.lastName,
          email: m.userId.email,
          phone: m.userId.phone,
          isSuperAdmin: !!m.userId.isSuperAdmin,
          isActive: m.userId.isActive,
          isMultiOrg: (orgCount.get(String(m.userId._id)) || 0) >= 2,
          lastLoginAt: m.userId.lastLoginAt,
          createdAt: m.userId.createdAt,
        },
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const data = addSchema.parse(req.body);
    const email = data.email.toLowerCase().trim();
    let user = await User.findOne({ email });

    if (data.linkExisting) {
      // Link-an-existing-account intent: there must already be an account.
      if (!user) {
        return res.status(404).json({
          error: "No account exists with that email. Uncheck 'Existing user' to create a new one.",
          code: 'EMAIL_NOT_FOUND',
        });
      }
    } else if (user) {
      // Create-new intent but the email is already taken globally — guide the
      // admin to the link path instead of silently reusing the other account.
      return res.status(409).json({
        error:
          "An account with this email already exists. Check 'Existing user (by email)' to link them to this org instead.",
        code: 'EMAIL_EXISTS_USE_LINK',
      });
    } else {
      if (!data.password || !data.firstName || !data.lastName) {
        return res.status(400).json({
          error: 'New user requires firstName, lastName, and password.',
        });
      }
      const passwordHash = await User.hashPassword(data.password);
      user = await User.create({
        firstName: data.firstName,
        lastName: data.lastName,
        email,
        phone: data.phone || null,
        passwordHash,
        isActive: true,
      });
    }

    const existing = await Membership.findOne({
      userId: user._id,
      organizationId: activeOrgId(req),
    });
    if (existing) {
      return res.status(409).json({ error: 'User already a member of this org' });
    }

    const membership = await Membership.create({
      userId: user._id,
      organizationId: activeOrgId(req),
      role: data.role,
      isActive: true,
      addedBy: req.user._id,
    });

    res.status(201).json({
      membership: {
        membershipId: String(membership._id),
        role: membership.role,
        isActive: membership.isActive,
        addedAt: membership.createdAt,
        user: user.toSafeJSON(),
      },
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Conflict' });
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.patch('/:userId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    const data = updateMembershipSchema.parse(req.body);
    if (
      data.role === 'canvasser' &&
      String(req.params.userId) === String(req.user._id) &&
      !req.user.isSuperAdmin
    ) {
      return res.status(400).json({
        error: "You can't change your own role. Ask another admin.",
      });
    }
    const membership = await Membership.findOneAndUpdate(
      { userId: req.params.userId, organizationId: activeOrgId(req) },
      data,
      { new: true }
    );
    if (!membership) return res.status(404).json({ error: 'Membership not found' });
    res.json({ membership });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.delete('/:userId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    if (
      String(req.params.userId) === String(req.user._id) &&
      !req.user.isSuperAdmin
    ) {
      return res.status(400).json({ error: "You can't remove yourself from this org." });
    }
    const orgId = activeOrgId(req);
    await Membership.deleteOne({ userId: req.params.userId, organizationId: orgId });
    await CampaignAssignment.deleteMany({ userId: req.params.userId, organizationId: orgId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/:userId/user', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    const membership = await Membership.findOne({
      userId: req.params.userId,
      organizationId: activeOrgId(req),
    });
    if (!membership) return res.status(404).json({ error: 'Member not in this org' });

    const targetUser = await User.findById(req.params.userId);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

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

    const user = await User.findByIdAndUpdate(req.params.userId, data, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
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
    const membership = await Membership.findOne({
      userId: req.params.userId,
      organizationId: activeOrgId(req),
    });
    if (!membership) return res.status(404).json({ error: 'Member not in this org' });

    const { password } = passwordSchema.parse(req.body);
    const passwordHash = await User.hashPassword(password);
    // This is a TEMPORARY password: the user is forced to choose a new one at
    // their next login, so an admin never holds a working key to the user's
    // other orgs. See passwordGate.js and POST /auth/change-password.
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { passwordHash, mustChangePassword: true, tempPasswordSetAt: new Date() },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: user.toSafeJSON() });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.patch('/:userId/deactivate', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const membership = await Membership.findOneAndUpdate(
      { userId: req.params.userId, organizationId: activeOrgId(req) },
      { isActive: false },
      { new: true }
    );
    if (!membership) return res.status(404).json({ error: 'Membership not found' });
    res.json({ membership });
  } catch (err) {
    next(err);
  }
});

router.patch('/:userId/reactivate', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const membership = await Membership.findOneAndUpdate(
      { userId: req.params.userId, organizationId: activeOrgId(req) },
      { isActive: true },
      { new: true }
    );
    if (!membership) return res.status(404).json({ error: 'Membership not found' });
    res.json({ membership });
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
    const orgId = activeOrgId(req);
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
        organizationId: orgId,
        actionType: { $in: DOOR_ACTIONS },
      })
        .sort({ timestamp: 1 })
        .select('timestamp location actionType campaignId')
        .lean(),
      SurveyResponse.countDocuments({ userId, organizationId: orgId }),
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

router.get('/:userId/recent-activity', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const orgId = activeOrgId(req);
    const userId = new mongoose.Types.ObjectId(req.params.userId);
    const requested = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), 100)
      : 20;

    const activities = await CanvassActivity.find({
      userId,
      organizationId: orgId,
      actionType: { $in: DOOR_ACTIONS },
    })
      .sort({ timestamp: -1 })
      .limit(limit)
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
