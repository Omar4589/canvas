import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { hasBillingAccess } from '../../middleware/billingAccess.js';
import { Campaign } from '../../models/Campaign.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { NOT_DELETING } from '../../services/campaigns/deletionState.js';
import { fieldVisitMatch } from '../../services/reports/aggregations.js';
import { billingRuleFor, cycleBillingFrom, reminderDates } from '../../services/billing/billingMonths.js';
import { zonedDayStr } from '../../utils/timezone.js';

// WHICH RULES DOES EACH CAMPAIGN BILL UNDER — for the election-day archive reminder (client
// components/ArchiveNudge.jsx; docs/PROPOSAL_BILLING_CYCLES.md §F).
//
// Every org admin sees that reminder, but only billing admins may see billing. So the rule
// ('calendar' | 'cycle' | null) goes to every org admin — the reminder's wording depends on it, and it
// carries no date and no money — while the renewal dates go only to billing admins (the owner's
// decision 9), through the same hasBillingAccess the billing router gates on. That is also why this
// is a SIBLING prefix of /admin/billing rather than a route inside it: everything on that router is
// billing-gated, and stays so. Leads get FORBIDDEN_ROLE here, as they do there.
const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));

// The reminder asks about the campaigns past their election day; the cap keeps one request from
// walking a whole organization.
export const MAX_RENEWAL_IDS = 50;

// GET /admin/billing-renewals?ids=a,b,c
//   → { campaigns: [{ campaignId, billingRule }] } for every org admin, exactly those keys; for a
//     billing admin, an ACTIVE campaign on the new rules also carries reminderDates()
//     ({ nextRenewalDay, lastRenewalDay, graceUntilDay }, 'YYYY-MM-DD' on its own calendar).
//   Ids from another organization, or of a campaign being deleted, are left out, not refused.
router.get('/', async (req, res, next) => {
  try {
    if (!req.activeOrg) return res.status(400).json({ error: 'Active organization required' });
    const ids = [
      ...new Set(
        []
          .concat(req.query.ids ?? [])
          .flatMap((v) => String(v).split(','))
          .map((v) => v.trim())
          .filter(Boolean)
      ),
    ];
    if (ids.length > MAX_RENEWAL_IDS) {
      return res.status(400).json({ error: `Ask about at most ${MAX_RENEWAL_IDS} campaigns at a time` });
    }
    // A malformed id is the caller's mistake (400), not a CastError 500.
    if (!ids.every((id) => mongoose.isValidObjectId(id))) {
      return res.status(400).json({ error: 'ids must be campaign ids' });
    }
    const campaigns = ids.length
      ? await Campaign.find(
          { _id: { $in: ids }, organizationId: req.activeOrg._id, ...NOT_DELETING },
          { timeZone: 1, isActive: 1 }
        ).lean()
      : [];
    // Read once, so every campaign in the answer is judged against the same switch day.
    const cycleFrom = cycleBillingFrom();
    const withDates = hasBillingAccess(req);
    const now = new Date();
    const out = [];
    // Serially, like the statement paths: at most fifty one-row lookups.
    for (const c of campaigns) {
      const tz = c.timeZone || 'America/New_York';
      // The same "first field visit" that starts billing (statement.js) — so the rule here is the
      // rule the invoice will use.
      const first = await CanvassActivity.findOne(fieldVisitMatch(c._id), { timestamp: 1 }).sort({ timestamp: 1 }).lean();
      const firstVisitDay = first ? zonedDayStr(first.timestamp, tz) : null;
      const billingRule = billingRuleFor(firstVisitDay, cycleFrom);
      const row = { campaignId: String(c._id), billingRule };
      // Archived campaigns renew no more, and calendar or never-out ones have no renewal date.
      if (withDates && billingRule === 'cycle' && c.isActive) {
        Object.assign(row, reminderDates(firstVisitDay, zonedDayStr(now, tz)));
      }
      out.push(row);
    }
    res.json({ campaigns: out });
  } catch (err) {
    next(err);
  }
});

export default router;
