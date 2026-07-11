import { Campaign } from '../../models/Campaign.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Household } from '../../models/Household.js';
import { Subscription } from '../../models/Subscription.js';
import { KNOCK_ACTIONS, knocksPipeline } from '../reports/aggregations.js';
import { zonedDayRange } from '../../utils/timezone.js';

// 'YYYY-MM' → { first: 'YYYY-MM-01', last: 'YYYY-MM-<lastDay>' } or null when malformed.
export function monthDayBounds(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return null;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const lastDay = new Date(Date.UTC(Number(m[1]), mo, 0)).getUTCDate();
  return { first: `${m[1]}-${m[2]}-01`, last: `${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}` };
}

// The monthly statement an account manager invoices from. Billing months rule
// (user decision, Jul 2026): a campaign bills in month M iff its FIRST KNOCK
// (earliest KNOCK_ACTIONS activity — restricted marks and notes never start
// billing) happened before M ended, AND it wasn't archived before M began.
// Setup months are free; the archive month still bills; later months don't.
// Month boundaries use each campaign's own timezone (docs/TIMEZONES.md).
// Universe size (households) is reported for visibility but NEVER priced or
// enforced — the soft cap is a contract-level guideline only.
export async function monthlyStatement(organizationId, month) {
  const bounds = monthDayBounds(month);
  if (!bounds) {
    const err = new Error('month must be YYYY-MM');
    err.status = 400;
    throw err;
  }
  const [sub, campaigns] = await Promise.all([
    Subscription.findOne({ organizationId }).lean(),
    Campaign.find({ organizationId }).sort({ createdAt: 1 }).lean(),
  ]);
  const rateCents = sub?.pricePerCampaignCents ?? 30000;

  const lines = [];
  for (const c of campaigns) {
    const tz = c.timeZone || 'America/New_York';
    const window = zonedDayRange(bounds.first, bounds.last, tz); // { $gte, $lt }
    const [firstKnock, knockAgg, households] = await Promise.all([
      CanvassActivity.findOne(
        { campaignId: c._id, actionType: { $in: KNOCK_ACTIONS } },
        { timestamp: 1 }
      )
        .sort({ timestamp: 1 })
        .lean(),
      CanvassActivity.aggregate(knocksPipeline({ campaignId: c._id, timestamp: window })),
      Household.countDocuments({ campaignId: c._id, isActive: true }),
    ]);
    const firstKnockAt = firstKnock?.timestamp || null;
    // Legacy archived campaigns predate Campaign.archivedAt — fall back to
    // updatedAt (the migration backfills this, but stay safe either way).
    const archivedAt = c.isActive ? null : c.archivedAt || c.updatedAt || null;
    const started = Boolean(firstKnockAt && firstKnockAt < window.$lt);
    const archivedBeforeMonth = Boolean(archivedAt && archivedAt < window.$gte);
    const billable = started && !archivedBeforeMonth;
    lines.push({
      campaignId: String(c._id),
      name: c.name,
      isActive: c.isActive,
      archivedAt,
      firstKnockAt,
      households,
      knocksThisMonth: knockAgg?.[0]?.knocks || 0, // distinct (household, pass), same as billing everywhere
      billable,
      amountCents: billable ? rateCents : 0,
    });
  }
  return {
    month,
    rateCents,
    lines,
    totalCents: lines.reduce((sum, l) => sum + l.amountCents, 0),
  };
}

// The current calendar month as 'YYYY-MM' (UTC). "This month" is inherently tz-fuzzy at
// the boundary, but monthlyStatement still evaluates each campaign in its own timezone —
// this only picks which month to summarize, which is fine for a live usage indicator.
export function currentMonth(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// A light "this month so far" usage summary for the live meter shown to the super admin
// and (gated) the org's bill-payer admins — billable campaign count + running total.
export async function currentUsage(organizationId, now = new Date()) {
  const month = currentMonth(now);
  const stmt = await monthlyStatement(organizationId, month);
  return {
    month,
    rateCents: stmt.rateCents,
    billableCampaigns: stmt.lines.filter((l) => l.billable).length,
    totalCents: stmt.totalCents,
  };
}
