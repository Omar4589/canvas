import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Organization } from '../../models/Organization.js';
import { Subscription } from '../../models/Subscription.js';
import { entitlementFor } from '../../services/billing/entitlement.js';
import { currentUsage } from '../../services/billing/statement.js';

// The org-admin-facing slice of the subscription: enough to render the plan summary and the
// banner. The billing contact and internal fields (notes, source, Stripe ids) never leave the
// super-admin surface.
const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));
// Billing is restricted to the bill-payer admins (Membership.billingAccess) — not
// every org admin. Super admins always pass.
router.use((req, res, next) => {
  if (req.user?.isSuperAdmin) return next();
  if (req.activeMembership?.billingAccess) return next();
  return res.status(403).json({ error: 'Billing is restricted to billing admins.', code: 'billing-access-required' });
});

function publicView(sub) {
  const ent = entitlementFor(sub);
  return {
    status: sub?.status ?? 'active',
    entitlement: ent,
    trialEndsAt: sub?.trialEndsAt ?? null,
    pricePerCampaignCents: sub?.pricePerCampaignCents ?? 30000,
  };
}

router.get('/', async (req, res, next) => {
  try {
    if (!req.activeOrg) return res.status(400).json({ error: 'Active organization required' });
    const [sub, usage, org] = await Promise.all([
      Subscription.findOne({ organizationId: req.activeOrg._id }).lean(),
      currentUsage(req.activeOrg._id),
      Organization.findById(req.activeOrg._id, { billRestrictedDoors: 1 }).lean(),
    ]);
    // `usage` = this month's live meter (billable campaigns × rate) so the bill-payer
    // sees the running cost, not just the rate — no invoice surprises.
    res.json({
      ...publicView(sub),
      usage,
      // The org-wide DEFAULT, not a resolved value: individual campaigns may override it
      // (services/reports/billRestricted.js). Affects only the org's own door totals — never
      // what Doorline charges, which is flat per campaign per month.
      billRestrictedDoors: Boolean(org?.billRestrictedDoors),
    });
  } catch (err) {
    next(err);
  }
});

const settingsSchema = z.object({ billRestrictedDoors: z.boolean() });

// The org-wide default for "count restricted doors as billable doors". Lives here rather than on
// an org-settings page because there is none — every other org mutation is super-admin-only — and
// because this IS a billing-counting policy, so the bill-payer gate above is exactly the right
// audience. Campaigns can still override it either way.
router.patch('/settings', async (req, res, next) => {
  try {
    if (!req.activeOrg) return res.status(400).json({ error: 'Active organization required' });
    const data = settingsSchema.parse(req.body);
    await Organization.updateOne(
      { _id: req.activeOrg._id },
      { $set: { billRestrictedDoors: data.billRestrictedDoors } }
    );
    res.json({ billRestrictedDoors: data.billRestrictedDoors });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

export default router;
