import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Subscription } from '../../models/Subscription.js';
import { SubscriptionEvent } from '../../models/SubscriptionEvent.js';
import { entitlementFor } from '../../services/billing/entitlement.js';
import { currentUsage } from '../../services/billing/statement.js';

// The org-admin-facing slice of the subscription: enough to render the plan
// summary, the banner, and the billing-contact form. Internal fields (notes,
// source, Stripe ids) never leave the super-admin surface.
const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));
// Billing is restricted to the bill-payer admins (Membership.billingAccess) — not
// every org admin. Super admins always pass.
router.use((req, res, next) => {
  if (req.user?.isSuperAdmin) return next();
  if (req.activeMembership?.billingAccess) return next();
  return res.status(403).json({ error: 'Billing is restricted to billing admins.', code: 'billing-access-required' });
});

const contactSchema = z.object({
  name: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
});

function publicView(sub) {
  const ent = entitlementFor(sub);
  return {
    status: sub?.status ?? 'active',
    entitlement: ent,
    trialEndsAt: sub?.trialEndsAt ?? null,
    pricePerCampaignCents: sub?.pricePerCampaignCents ?? 30000,
    billingContact: sub?.billingContact ?? { name: '', email: '' },
  };
}

router.get('/', async (req, res, next) => {
  try {
    if (!req.activeOrg) return res.status(400).json({ error: 'Active organization required' });
    const [sub, usage] = await Promise.all([
      Subscription.findOne({ organizationId: req.activeOrg._id }).lean(),
      currentUsage(req.activeOrg._id),
    ]);
    // `usage` = this month's live meter (billable campaigns × rate) so the bill-payer
    // sees the running cost, not just the rate — no invoice surprises.
    res.json({ ...publicView(sub), usage });
  } catch (err) {
    next(err);
  }
});

router.patch('/contact', async (req, res, next) => {
  try {
    if (!req.activeOrg) return res.status(400).json({ error: 'Active organization required' });
    const data = contactSchema.parse(req.body);
    const sub = await Subscription.findOneAndUpdate(
      { organizationId: req.activeOrg._id },
      {
        $set: {
          'billingContact.name': data.name ?? '',
          'billingContact.email': data.email ?? '',
        },
        $setOnInsert: { status: 'active', statusChangedAt: new Date() },
      },
      { new: true, upsert: true }
    ).lean();
    await SubscriptionEvent.create({
      organizationId: req.activeOrg._id,
      byUserId: req.user._id,
      changes: { billingContact: { to: sub.billingContact } },
      reason: 'Billing contact updated by org admin',
    });
    res.json(publicView(sub));
  } catch (err) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.issues?.[0]?.message || 'Invalid input' });
    next(err);
  }
});

export default router;
