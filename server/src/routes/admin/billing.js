import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { Subscription } from '../../models/Subscription.js';
import { recomputeCampaignStats } from '../../services/reports/campaignCounters.js';
import { entitlementFor } from '../../services/billing/entitlement.js';
import {
  BILLING_HISTORY_MAX_MONTHS,
  currentUsage,
  historyRange,
  monthlyStatementRange,
  publicMonthHistory,
  publicUsage,
} from '../../services/billing/statement.js';

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

// No rate here, deliberately. Pricing is negotiated per client and per race, so it belongs in a
// conversation with the account manager rather than on the customer's dashboard — see
// publicUsage() in services/billing/statement.js for the same reasoning applied to the meter.
function publicView(sub) {
  const ent = entitlementFor(sub);
  return {
    status: sub?.status ?? 'active',
    entitlement: ent,
    trialEndsAt: sub?.trialEndsAt ?? null,
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
    // `usage` = which campaigns are canvassing this month and which are still free, with the
    // dollar figures stripped by publicUsage() before it leaves the server.
    res.json({
      ...publicView(sub),
      usage: publicUsage(usage),
      // The org-wide DEFAULT, not a resolved value: individual campaigns may override it
      // (services/reports/billRestricted.js). Affects only the org's own door totals — never
      // what Doorline charges, which is flat per campaign per month.
      billRestrictedDoors: Boolean(org?.billRestrictedDoors),
    });
  } catch (err) {
    next(err);
  }
});

// The month-by-month history behind the live meter — which campaigns were in the field in each of
// the last N months, and how many doors. Same billing-admin gate as everything else on this router.
//
// DOLLAR-FREE, and enforced one layer down: publicMonthHistory() is the only projector that decides
// what a customer may see, and it strips every cents field before this route ever gets the object.
// Hiding a price in JSX would still ship it to the browser — see the note on publicUsage().
//
// What this DOES give them is the useful half: an org that invoices its own client per door reads
// the `doors` column straight off this table, and the "count restricted homes" toggle below it is
// exactly the switch that decides what `doors` means.
router.get('/history', async (req, res, next) => {
  try {
    if (!req.activeOrg) return res.status(400).json({ error: 'Active organization required' });
    const { from, to } = historyRange(req.query.months);
    const range = await monthlyStatementRange(req.activeOrg._id, { from, to });
    res.json({ ...publicMonthHistory(range), maxMonths: BILLING_HISTORY_MAX_MONTHS });
  } catch (err) {
    if (err?.status === 400) return res.status(400).json({ error: err.message });
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
