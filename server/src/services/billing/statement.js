import { Campaign } from '../../models/Campaign.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Household } from '../../models/Household.js';
import { Subscription } from '../../models/Subscription.js';
import { Organization } from '../../models/Organization.js';
import { BILLABLE_WITH_RESTRICTED, knocksPipeline, billableDoorsOf } from '../reports/aggregations.js';
import { resolveBillRestricted } from '../reports/billRestricted.js';
import { zonedDayRange, zonedDayStr } from '../../utils/timezone.js';
import { decideMonth, needsStartMonthVisitCount } from './billingMonths.js';
import { resolveRateCents } from './rate.js';

// Which generation of the billing rules produced a statement. Frozen into every issued Statement
// so a two-year-old invoice can still explain itself after the rules have moved on:
//   v1  bills from the first KNOCK month through the archive month.
//   v2  (Jul 2026) a non-bulk `restricted` mark also starts the clock — a canvasser who walked to
//       a gated community made the trip.
//   v3  (Jul 2026) start grace / end grace / floor — see services/billing/billingMonths.js.
// Bump this whenever billing SEMANTICS change, not when the code merely moves.
export const RULES_VERSION = 3;

// 'YYYY-MM' → { first: 'YYYY-MM-01', last: 'YYYY-MM-<lastDay>' } or null when malformed.
export function monthDayBounds(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return null;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const lastDay = new Date(Date.UTC(Number(m[1]), mo, 0)).getUTCDate();
  return { first: `${m[1]}-${m[2]}-01`, last: `${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}` };
}

// "A canvasser was at a door" — the match that both starts the billing clock and answers "did
// anyone go out this month". Scoped to `restricted`, NOT a blanket NOT_BULK: a via:'bulk' row on a
// KNOCK action is a real knock and must still count (same reasoning as knocksPipeline), while an
// admin bulk-restricting a whole book from the Turf Cutting page (routes/admin/turfs.js) is desk
// work and must never start an org's billing clock before anyone has walked. Notes never count.
function fieldVisitMatch(campaignId) {
  return {
    campaignId,
    actionType: { $in: BILLABLE_WITH_RESTRICTED },
    $nor: [{ actionType: 'restricted', via: 'bulk' }],
  };
}

// The monthly statement an account manager invoices from. WHICH months a campaign bills is decided
// by services/billing/billingMonths.js — the first-visit month through the archive month, minus a
// start grace (first visit in the last 7 days of a month → that month is free), minus an end grace
// (archived in the first 3 days with nobody out that month → free), plus a floor that guarantees a
// campaign which went to the field always bills at least one month. That module owns the rule and
// its own unit tests; this file owns the QUERIES that feed it. Month boundaries use each campaign's
// own timezone (docs/TIMEZONES.md). Universe size (households) is reported for visibility but NEVER
// priced or enforced — the soft cap is a contract-level guideline only.
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
    // `+pricePerCampaignCents` because the path is `select: false` (models/Campaign.js) — it is
    // hidden from the org-admin routes by default and has to be asked for here.
    Campaign.find({ organizationId }).select('+pricePerCampaignCents').sort({ createdAt: 1 }).lean(),
    Organization.findById(organizationId, { billRestrictedDoors: 1 }).lean(),
  ]);
  // The ORG's rate — the default every campaign inherits, and what the header/rollup mean by
  // "rate". Individual lines may carry their own (services/billing/rate.js), so nothing may assume
  // totalCents === billableCount × this number.
  const rateCents = resolveRateCents(null, sub);

  const lines = [];
  for (const c of campaigns) {
    const tz = c.timeZone || 'America/New_York';
    const lineRate = resolveRateCents(c, sub);
    const window = zonedDayRange(bounds.first, bounds.last, tz); // { $gte, $lt }
    const billRestricted = resolveBillRestricted(c, org);
    const [firstKnock, knockAgg, households] = await Promise.all([
      CanvassActivity.findOne(fieldVisitMatch(c._id), { timestamp: 1 })
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

    // Hand the rule engine civil dates in the CAMPAIGN'S timezone. This is exactly equivalent to
    // the Date comparisons it replaced — `window` was built from these same day strings — but it
    // lets billingMonths.js stay pure and testable at every calendar boundary.
    const firstVisitDay = firstKnockAt ? zonedDayStr(firstKnockAt, tz) : null;
    const archivedDay = archivedAt ? zonedDayStr(archivedAt, tz) : null;
    // "Did anyone go out this month" must be FLAG-INDEPENDENT, so it reads `billableDoors` (every
    // distinct (household, pass) group, restricted marks included) rather than billableDoorsOf(),
    // which collapses to the knock count when the org hasn't opted in. A month whose only activity
    // was non-bulk restricted marks is a month someone walked, and must not win the end grace.
    const visitsThisMonth = knockAgg?.[0]?.billableDoors || 0;

    // The floor occasionally needs the visit count of a DIFFERENT month than this one (see
    // needsStartMonthVisitCount). Existence is enough — any qualifying row means at least one
    // door — so this probes rather than counts, and only in that one narrow corner.
    const needMonth = needsStartMonthVisitCount({ month, firstVisitDay, archivedDay });
    let visitsInStartMonth;
    if (needMonth) {
      const nb = monthDayBounds(needMonth);
      const probe = await CanvassActivity.findOne(
        { ...fieldVisitMatch(c._id), timestamp: zonedDayRange(nb.first, nb.last, tz) },
        { _id: 1 }
      ).lean();
      visitsInStartMonth = probe ? 1 : 0;
    }

    const { billable, reason } = decideMonth({
      month,
      firstVisitDay,
      archivedDay,
      visitsThisMonth,
      visitsInStartMonth,
    });
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
      // WHY this line is (or isn't) on the invoice — 'billable' | 'start-grace' | 'end-grace' |
      // 'floor' | 'before-start' | 'archived-earlier' | 'no-field-visit'. See billingMonths.js.
      reason,
      // This campaign's resolved rate, which may differ from the statement's `rateCents`.
      rateCents: lineRate,
      // The raw override, so the UI can tell "negotiated" from "inherits the org rate".
      pricePerCampaignCents: c.pricePerCampaignCents ?? null,
      amountCents: billable ? lineRate : 0,
    });
  }
  return {
    month,
    rateCents,
    rulesVersion: RULES_VERSION,
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

// The customer-facing projection of `currentUsage`: which campaigns are canvassing and which are
// still free, with every DOLLAR FIGURE removed.
//
// Pricing is negotiated per client and per race (services/billing/rate.js), so what a customer owes
// is a conversation with their account manager, not a number on a dashboard — a running total on
// their screen only invites "why does this say $300 when we agreed on $250". The money has to leave
// the PAYLOAD, not just the page: hiding it in JSX still ships it to the browser.
//
// A named projector rather than a flag on currentUsage, so there is exactly one place computing the
// numbers and exactly one place deciding who may see them — the super-admin surfaces still need the
// money and go on calling currentUsage directly.
export function publicUsage(usage) {
  return {
    month: usage.month,
    billableCampaigns: usage.billableCampaigns,
    setupCount: usage.setupCount,
    graceCount: usage.graceCount,
    billing: usage.billing.map((b) => ({
      campaignId: b.campaignId,
      name: b.name,
      isActive: b.isActive,
      archivedAt: b.archivedAt,
      firstKnockAt: b.firstKnockAt,
      knocksThisMonth: b.knocksThisMonth,
    })),
  };
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
      // Carried per line because a campaign may be on a negotiated rate — a caller that
      // multiplied the org rate by the campaign count would be wrong (services/billing/rate.js).
      rateCents: l.rateCents,
      knocksThisMonth: l.knocksThisMonth,
    }));
  return {
    month,
    rateCents: stmt.rateCents,
    billableCampaigns: billing.length,
    totalCents: stmt.totalCents,
    billing,
    // Active campaigns not yet billing (never been to the field) — "free until the first knock".
    setupCount: stmt.lines.filter((l) => l.reason === 'no-field-visit' && l.isActive).length,
    // Campaigns that DID go out this month but are free on the start grace. Without this they'd be
    // invisible on the meter — they're not in `billing` and they're not in `setupCount` — and the
    // first question an account manager asks about a $0 line is "why".
    graceCount: stmt.lines.filter((l) => l.reason === 'start-grace').length,
  };
}
