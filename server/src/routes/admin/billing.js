import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { Subscription } from '../../models/Subscription.js';
import { recomputeCampaignStats } from '../../services/reports/campaignCounters.js';
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
    const before = await Organization.findById(req.activeOrg._id, { billRestrictedDoors: 1 }).lean();
    const changed = Boolean(before?.billRestrictedDoors) !== data.billRestrictedDoors;
    await Organization.updateOne(
      { _id: req.activeOrg._id },
      { $set: { billRestrictedDoors: data.billRestrictedDoors } }
    );
    // Refresh the denormalized counters for every campaign that INHERITS this default (an
    // explicit per-campaign override is unaffected by an org-level flip, and recomputing it
    // would be wasted work). Campaigns created before this feature carry trusted stats with no
    // restrictedDoorCount, so without this the counter-backed dashboard would disagree with the
    // live-aggregated invoice export the moment someone opts in.
    //
    // Only on turning it ON: `stats.restrictedDoorCount` is read only while the policy resolves
    // true, so turning it off is free, and the next turn-on repairs anything that drifted. This
    // matters more here than on a single campaign — an org-wide flip fans out over every
    // inheriting campaign, and an admin trying the setting out shouldn't re-aggregate the whole
    // org's ledger twice. Rare admin op, same hook as re-cut/bulk-restrict; swallowErrors so a
    // slow recompute can't fail a setting that already saved.
    if (changed && data.billRestrictedDoors) {
      const inheriting = await Campaign.find(
        { organizationId: req.activeOrg._id, billRestrictedDoors: null },
        { _id: 1 }
      ).lean();
      await recomputeCampaignStats(inheriting.map((c) => c._id), { swallowErrors: true });
    }
    res.json({ billRestrictedDoors: data.billRestrictedDoors });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

export default router;
