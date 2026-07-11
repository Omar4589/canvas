import { Router } from 'express';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
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

export default router;
