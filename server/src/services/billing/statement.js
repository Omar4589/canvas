import { Campaign } from '../../models/Campaign.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Household } from '../../models/Household.js';
import { Subscription } from '../../models/Subscription.js';
import { Organization } from '../../models/Organization.js';
import { BILLABLE_WITH_RESTRICTED, knocksPipeline, billableDoorsOf } from '../reports/aggregations.js';
import { resolveBillRestricted } from '../reports/billRestricted.js';
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
// (user decision, Jul 2026): a campaign bills in month M iff its FIRST FIELD VISIT
// happened before M ended, AND it wasn't archived before M began. Setup months are
// free; the archive month still bills; later months don't. Month boundaries use each
// campaign's own timezone (docs/TIMEZONES.md). Universe size (households) is reported
// for visibility but NEVER priced or enforced — the soft cap is a contract-level
// guideline only.
//
// "First field visit" (revised Jul 2026) = the earliest KNOCK_ACTIONS row OR the earliest
// NON-BULK `restricted` mark, whichever came first. A canvasser who walks to a gated community
// and finds it locked made the trip; the clock starts. This is deliberately INDEPENDENT of the
// billRestrictedDoors opt-in — that flag only decides whether the door shows up in the org's own
// invoice totals, and when Doorline starts charging is not a customer-tunable number.
//
// The bulk guard is what keeps that honest: an admin bulk-restricting a whole book from the Turf
// Cutting page (routes/admin/turfs.js) is desk work, and must never start an org's billing clock
// before anyone has walked. It is scoped to `restricted` rows only — a bulk row on a KNOCK action
// is a real knock. Notes still never start billing.
//
// Pricing is untouched by all of this: `amountCents` is a boolean × flat rate, so knock and door
// volume never multiply anything.
export async function monthlyStatement(organizationId, month) {
  const bounds = monthDayBounds(month);
  if (!bounds) {
    const err = new Error('month must be YYYY-MM');
    err.status = 400;
    throw err;
  }
  const [sub, campaigns, org] = await Promise.all([
    Subscription.findOne({ organizationId }).lean(),
    Campaign.find({ organizationId }).sort({ createdAt: 1 }).lean(),
    Organization.findById(organizationId, { billRestrictedDoors: 1 }).lean(),
  ]);
  const rateCents = sub?.pricePerCampaignCents ?? 30000;

  const lines = [];
  for (const c of campaigns) {
    const tz = c.timeZone || 'America/New_York';
    const window = zonedDayRange(bounds.first, bounds.last, tz); // { $gte, $lt }
    const billRestricted = resolveBillRestricted(c, org);
    const [firstKnock, knockAgg, households] = await Promise.all([
      CanvassActivity.findOne(
        {
          campaignId: c._id,
          actionType: { $in: BILLABLE_WITH_RESTRICTED },
          // Scoped to `restricted`, NOT a blanket NOT_BULK: a via:'bulk' row on a KNOCK action is
          // a real knock and must still start the clock (same reasoning as knocksPipeline).
          $nor: [{ actionType: 'restricted', via: 'bulk' }],
        },
        { timestamp: 1 }
      )
        .sort({ timestamp: 1 })
        .lean(),
      // Always run with includeRestricted so the line can report BOTH numbers; the flag only
      // decides which one the client presents as the invoice figure. Neither is ever priced.
      CanvassActivity.aggregate(
        knocksPipeline({ campaignId: c._id, timestamp: window }, { includeRestricted: true })
      ),
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
      // Renders as the "Billing started <date>" indicator on both billing surfaces; null means
      // "not started — no field activity yet", which is a real, useful state to show.
      firstKnockAt,
      households,
      knocksThisMonth: knockAgg?.[0]?.knocks || 0, // distinct (household, pass), same as billing everywhere
      // The org's OWN invoice figure when it bills for restricted doors. Equals knocksThisMonth
      // when the opt-in is off. Reported for visibility — never priced (see amountCents below).
      billableDoorsThisMonth: billableDoorsOf(knockAgg?.[0], billRestricted),
      restrictedDoorsThisMonth: knockAgg?.[0]?.restrictedDoors || 0,
      billRestrictedDoors: billRestricted,
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
// and (gated) the org's bill-payer admins — billable campaign count + running total, plus
// the per-campaign `billing` breakdown (which campaigns make up the total, and since when)
// and a `setupCount` of campaigns that are free because they haven't been canvassed yet.
export async function currentUsage(organizationId, now = new Date()) {
  const month = currentMonth(now);
  const stmt = await monthlyStatement(organizationId, month);
  const billing = stmt.lines
    .filter((l) => l.billable)
    .map((l) => ({
      campaignId: l.campaignId,
      name: l.name,
      isActive: l.isActive,
      archivedAt: l.archivedAt,
      firstKnockAt: l.firstKnockAt,
      amountCents: l.amountCents,
      knocksThisMonth: l.knocksThisMonth,
    }));
  return {
    month,
    rateCents: stmt.rateCents,
    billableCampaigns: billing.length,
    totalCents: stmt.totalCents,
    billing,
    // Active campaigns not yet billing (no first knock) — "free until the first knock".
    setupCount: stmt.lines.filter((l) => !l.billable && l.isActive && !l.firstKnockAt).length,
  };
}
