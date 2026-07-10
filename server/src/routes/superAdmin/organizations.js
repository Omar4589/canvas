import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Organization } from '../../models/Organization.js';
import { Membership } from '../../models/Membership.js';
import { Campaign } from '../../models/Campaign.js';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { slugSchema } from '../../utils/validators.js';
import { Subscription } from '../../models/Subscription.js';
import { SubscriptionEvent } from '../../models/SubscriptionEvent.js';
import { entitlementFor } from '../../services/billing/entitlement.js';

const router = Router();
router.use(requireAuth, requireSuperAdmin);

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema.optional(),
  isActive: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: slugSchema.optional(),
  isActive: z.boolean().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const orgs = await Organization.find().sort({ createdAt: -1 }).lean();
    const ids = orgs.map((o) => o._id);
    const memberCounts = await Membership.aggregate([
      { $match: { organizationId: { $in: ids }, isActive: true } },
      { $group: { _id: '$organizationId', count: { $sum: 1 } } },
    ]);
    const campaignCounts = await Campaign.aggregate([
      { $match: { organizationId: { $in: ids } } },
      { $group: { _id: '$organizationId', count: { $sum: 1 } } },
    ]);
    const memberMap = new Map(memberCounts.map((r) => [String(r._id), r.count]));
    const campaignMap = new Map(campaignCounts.map((r) => [String(r._id), r.count]));
    // Billing summary per org — status pill + "needs attention" strip data.
    const subs = await Subscription.find({ organizationId: { $in: ids } }).lean();
    const subMap = new Map(subs.map((s) => [String(s.organizationId), s]));
    res.json({
      organizations: orgs.map((o) => {
        const sub = subMap.get(String(o._id)) || null;
        const ent = entitlementFor(sub);
        return {
          id: String(o._id),
          name: o.name,
          slug: o.slug,
          isActive: o.isActive,
          memberCount: memberMap.get(String(o._id)) || 0,
          campaignCount: campaignMap.get(String(o._id)) || 0,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
          billing: {
            status: sub?.status ?? null,
            effective: ent.effective,
            trialEndsAt: sub?.trialEndsAt ?? null,
            trialDaysLeft: ent.trialDaysLeft,
          },
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const slug = (data.slug || Organization.toSlug(data.name)).toLowerCase();
    if (!slug) return res.status(400).json({ error: 'Could not derive slug from name' });
    const org = await Organization.create({
      name: data.name.trim(),
      slug,
      isActive: data.isActive !== false,
      createdBy: req.user._id,
    });
    // Every new org starts a 7-day trial (user decision, Jul 2026). The trial
    // clock runs from creation — create the org right after the demo call.
    await Subscription.create({
      organizationId: org._id,
      status: 'trial',
      trialEndsAt: new Date(Date.now() + 7 * 86400000),
      statusChangedAt: new Date(),
    });
    await SubscriptionEvent.create({
      organizationId: org._id,
      byUserId: req.user._id,
      toStatus: 'trial',
      reason: 'Organization created — 7-day trial started',
    });
    res.status(201).json({ organization: org });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Slug already exists' });
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.patch('/:orgId', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.orgId)) {
      return res.status(400).json({ error: 'Invalid orgId' });
    }
    const data = updateSchema.parse(req.body);
    const update = {};
    if (data.name !== undefined) update.name = data.name.trim();
    if (data.slug !== undefined) update.slug = data.slug.toLowerCase().trim();
    if (data.isActive !== undefined) update.isActive = data.isActive;
    const org = await Organization.findByIdAndUpdate(req.params.orgId, update, { new: true });
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    res.json({ organization: org });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Slug already exists' });
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

export default router;
