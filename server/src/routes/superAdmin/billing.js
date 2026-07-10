import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { Organization } from '../../models/Organization.js';
import { Subscription } from '../../models/Subscription.js';
import { SubscriptionEvent } from '../../models/SubscriptionEvent.js';
import { entitlementFor } from '../../services/billing/entitlement.js';
import { monthlyStatement } from '../../services/billing/statement.js';

// The account-manager surface: /super-admin/organizations/:orgId/billing.
// Super-admin only — org admins get the read-mostly /admin/billing instead.
const router = Router({ mergeParams: true });
router.use(requireAuth, requireSuperAdmin);

const BILLING_STATUSES = ['trial', 'active', 'past_due', 'suspended', 'canceled', 'internal'];

const patchSchema = z.object({
  pricePerCampaignCents: z.number().int().min(0).max(10_000_000).optional(),
  billingContact: z
    .object({ name: z.string().max(200).optional(), email: z.string().max(200).optional() })
    .optional(),
  notes: z.string().max(5000).optional(),
});

const statusSchema = z.object({
  to: z.enum(BILLING_STATUSES),
  reason: z.string().max(2000).optional(),
});

const extendSchema = z.object({
  days: z.number().int().min(1).max(90).optional(),
  until: z.string().datetime().optional(),
});

// Load org + its subscription, creating a default record for orgs that predate
// the billing migration (status 'active' — identical to entitlementFor(null)'s
// fail-open resolution, so materializing it changes nothing about access).
async function loadOrgSub(req, res) {
  const { orgId } = req.params;
  if (!mongoose.isValidObjectId(orgId)) {
    res.status(400).json({ error: 'Invalid organization id' });
    return null;
  }
  const org = await Organization.findById(orgId).lean();
  if (!org) {
    res.status(404).json({ error: 'Organization not found' });
    return null;
  }
  let sub = await Subscription.findOne({ organizationId: org._id });
  if (!sub) {
    sub = await Subscription.create({
      organizationId: org._id,
      status: 'active',
      statusChangedAt: new Date(),
    });
    await SubscriptionEvent.create({
      organizationId: org._id,
      byUserId: req.user._id,
      toStatus: 'active',
      reason: 'Backfilled — org predates billing',
    });
  }
  return { org, sub };
}

router.get('/', async (req, res, next) => {
  try {
    const loaded = await loadOrgSub(req, res);
    if (!loaded) return;
    const { org, sub } = loaded;
    const events = await SubscriptionEvent.find({ organizationId: org._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('byUserId', 'firstName lastName')
      .lean();
    res.json({
      organization: { id: String(org._id), name: org.name, slug: org.slug, isActive: org.isActive },
      subscription: sub.toObject(),
      entitlement: entitlementFor(sub),
      events,
    });
  } catch (err) {
    next(err);
  }
});

// Rate / contact / notes edits. Status moves through POST /status only, so every
// transition is forced through the reason + statusChangedAt bookkeeping.
router.patch('/', async (req, res, next) => {
  try {
    const loaded = await loadOrgSub(req, res);
    if (!loaded) return;
    const { org, sub } = loaded;
    const data = patchSchema.parse(req.body);
    const changes = {};
    if (data.pricePerCampaignCents !== undefined && data.pricePerCampaignCents !== sub.pricePerCampaignCents) {
      changes.pricePerCampaignCents = { from: sub.pricePerCampaignCents, to: data.pricePerCampaignCents };
      sub.pricePerCampaignCents = data.pricePerCampaignCents;
    }
    if (data.billingContact !== undefined) {
      const next_ = {
        name: data.billingContact.name ?? sub.billingContact?.name ?? '',
        email: data.billingContact.email ?? sub.billingContact?.email ?? '',
      };
      if (next_.name !== (sub.billingContact?.name || '') || next_.email !== (sub.billingContact?.email || '')) {
        changes.billingContact = { from: sub.billingContact, to: next_ };
        sub.billingContact = next_;
      }
    }
    if (data.notes !== undefined && data.notes !== sub.notes) {
      changes.notes = { updated: true }; // don't duplicate free text into the log
      sub.notes = data.notes;
    }
    if (Object.keys(changes).length) {
      await sub.save();
      await SubscriptionEvent.create({
        organizationId: org._id,
        byUserId: req.user._id,
        changes,
      });
    }
    res.json({ subscription: sub.toObject(), entitlement: entitlementFor(sub) });
  } catch (err) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.issues?.[0]?.message || 'Invalid input' });
    next(err);
  }
});

// The status chokepoint. Any → any (the account manager is trusted); suspend and
// cancel REQUIRE a reason — future-you reads the History to learn why. A manual
// transition also reclaims `source` so a later Stripe webhook can't override it.
router.post('/status', async (req, res, next) => {
  try {
    const loaded = await loadOrgSub(req, res);
    if (!loaded) return;
    const { org, sub } = loaded;
    const data = statusSchema.parse(req.body);
    if (data.to === sub.status) {
      return res.status(400).json({ error: `Already ${sub.status}.` });
    }
    if (['suspended', 'canceled'].includes(data.to) && !data.reason?.trim()) {
      return res.status(400).json({ error: 'A reason is required to suspend or cancel.' });
    }
    const from = sub.status;
    sub.status = data.to;
    sub.statusChangedAt = new Date();
    sub.source = 'manual';
    if (data.to === 'trial' && !sub.trialEndsAt) {
      sub.trialEndsAt = new Date(Date.now() + 7 * 86400000);
    }
    await sub.save();
    await SubscriptionEvent.create({
      organizationId: org._id,
      byUserId: req.user._id,
      fromStatus: from,
      toStatus: data.to,
      reason: data.reason?.trim() || '',
    });
    res.json({ subscription: sub.toObject(), entitlement: entitlementFor(sub) });
  } catch (err) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.issues?.[0]?.message || 'Invalid input' });
    next(err);
  }
});

// Extend (or revive) a trial: +N days from whichever is later (now vs current
// end), or an explicit date. Only meaningful while status is 'trial' — an
// expired trial is still status 'trial' (suspension is computed), so extending
// it un-suspends the org with no separate reactivation step.
router.post('/extend-trial', async (req, res, next) => {
  try {
    const loaded = await loadOrgSub(req, res);
    if (!loaded) return;
    const { org, sub } = loaded;
    if (sub.status !== 'trial') {
      return res.status(400).json({ error: 'Only a trialing org can have its trial extended.' });
    }
    const data = extendSchema.parse(req.body);
    const from = sub.trialEndsAt;
    if (data.until) {
      sub.trialEndsAt = new Date(data.until);
    } else {
      const days = data.days ?? 7;
      const base = Math.max(Date.now(), sub.trialEndsAt ? new Date(sub.trialEndsAt).getTime() : 0);
      sub.trialEndsAt = new Date(base + days * 86400000);
    }
    await sub.save();
    await SubscriptionEvent.create({
      organizationId: org._id,
      byUserId: req.user._id,
      changes: { trialEndsAt: { from, to: sub.trialEndsAt } },
      reason: 'Trial extended',
    });
    res.json({ subscription: sub.toObject(), entitlement: entitlementFor(sub) });
  } catch (err) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.issues?.[0]?.message || 'Invalid input' });
    next(err);
  }
});

router.get('/statement', async (req, res, next) => {
  try {
    const loaded = await loadOrgSub(req, res);
    if (!loaded) return;
    const { org } = loaded;
    const statement = await monthlyStatement(org._id, req.query.month);
    res.json(statement);
  } catch (err) {
    if (err?.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

export default router;
