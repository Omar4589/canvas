import { Campaign } from '../../models/Campaign.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Household } from '../../models/Household.js';
import { Subscription } from '../../models/Subscription.js';
import { Organization } from '../../models/Organization.js';
import { BILLABLE_WITH_RESTRICTED, knocksPipeline, billableDoorsOf } from '../reports/aggregations.js';
import { resolveBillRestricted } from '../reports/billRestricted.js';
import { zonedDayRange, zonedDayStr } from '../../utils/timezone.js';
import { addMonths, decideMonth, needsStartMonthVisitCount } from './billingMonths.js';
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
// admin desk-marking a whole book or a single home restricted (services/canvass/deskRestrict.js,
// behind the Turf Cutting / Map pages) is desk work and must never start an org's billing clock
// before anyone has walked. Notes never count.
function fieldVisitMatch(campaignId) {
  return {
    campaignId,
    actionType: { $in: BILLABLE_WITH_RESTRICTED },
    $nor: [{ actionType: 'restricted', via: 'bulk' }],
  };
}

// ONE owner for a statement line, shared by the single-month path (monthlyStatement) and the range
// path (monthlyStatementRange) so the two can never drift into different SHAPES — the range view and
// the invoice have to be the same object or the history stops being evidence of what was billed.
// `agg` is that campaign's knocks row for THIS month (undefined when nothing happened), always
// computed restricted-inclusive so the line can report both numbers.
function statementLine({
  campaign,
  month,
  firstVisitDay,
  archivedDay,
  firstKnockAt,
  archivedAt,
  households,
  billRestricted,
  lineRate,
  agg,
  visitsInStartMonth,
}) {
  // "Did anyone go out this month" must be FLAG-INDEPENDENT, so it reads `billableDoors` (every
  // distinct (household, pass) group, restricted marks included) rather than billableDoorsOf(),
  // which collapses to the knock count when the org hasn't opted in. A month whose only activity
  // was non-bulk restricted marks is a month someone walked, and must not win the end grace.
  const visitsThisMonth = agg?.billableDoors || 0;
  const { billable, reason } = decideMonth({
    month,
    firstVisitDay,
    archivedDay,
    visitsThisMonth,
    visitsInStartMonth,
  });
  return {
    campaignId: String(campaign._id),
    name: campaign.name,
    isActive: campaign.isActive,
    archivedAt,
    // Renders as the "Billing started <date>" indicator on both billing surfaces; null means
    // "not started — no field activity yet", which is a real, useful state to show.
    firstKnockAt,
    households,
    knocksThisMonth: agg?.knocks || 0, // distinct (household, pass), same as billing everywhere
    // The org's OWN invoice figure when it bills for restricted doors. Equals knocksThisMonth
    // when the opt-in is off. Reported for visibility — never priced (see amountCents below).
    billableDoorsThisMonth: billableDoorsOf(agg, billRestricted),
    restrictedDoorsThisMonth: agg?.restrictedDoors || 0,
    billRestrictedDoors: billRestricted,
    billable,
    // WHY this line is (or isn't) on the invoice — 'billable' | 'start-grace' | 'end-grace' |
    // 'floor' | 'before-start' | 'archived-earlier' | 'no-field-visit'. See billingMonths.js.
    reason,
    // This campaign's resolved rate, which may differ from the statement's `rateCents`.
    rateCents: lineRate,
    // The raw override, so the UI can tell "negotiated" from "inherits the org rate".
    pricePerCampaignCents: campaign.pricePerCampaignCents ?? null,
    amountCents: billable ? lineRate : 0,
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
// The desk guard is what keeps that honest: an admin marking a whole book — or a single home —
// restricted from the console (services/canvass/deskRestrict.js, via:'bulk') is desk work, and
// must never start an org's billing clock before anyone has walked. It is scoped to `restricted`
// rows only — a bulk row on a KNOCK action is a real knock. Notes still never start billing.
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

    lines.push(
      statementLine({
        campaign: c,
        month,
        firstVisitDay,
        archivedDay,
        firstKnockAt,
        archivedAt,
        households,
        billRestricted,
        lineRate,
        agg: knockAgg?.[0],
        visitsInStartMonth,
      })
    );
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

// How far back a history view may reach. Two years is well past any campaign's life and keeps the
// worst case bounded: the range owner below is O(campaigns), not O(campaigns x months), so the cap
// is about payload size and screen legibility rather than query cost.
export const BILLING_HISTORY_MAX_MONTHS = 24;

// Inclusive 'YYYY-MM' list from..to, newest LAST. Throws a 400-shaped error on a malformed or
// inverted range, and truncates from the FRONT at the cap so `to` — the month you actually asked
// about — always survives.
export function monthsBetween(from, to, max = BILLING_HISTORY_MAX_MONTHS) {
  if (!monthDayBounds(from) || !monthDayBounds(to)) {
    const err = new Error('from and to must be YYYY-MM');
    err.status = 400;
    throw err;
  }
  if (from > to) {
    const err = new Error('from must not be after to');
    err.status = 400;
    throw err;
  }
  const out = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out.length > max ? out.slice(out.length - max) : out;
}

// EVERY month in a range, in ONE pass — the same statement lines monthlyStatement() produces, for
// each month, without paying its round-trips per month.
//
// The naive version (loop monthlyStatement) is O(months x campaigns x 3) round-trips: fourteen
// months of an eight-campaign org is ~336 queries, which is why the history view didn't exist. This
// is THREE queries per campaign for any range length — first field visit, household count, and one
// month-BUCKETED knocks aggregation (knocksPipeline's `monthTimeZone`, which puts the campaign-tz
// month in the inner _id so a bucket is identical to what a separately-windowed run would report).
// The org, its subscription and its campaigns load once instead of once per month.
//
// The rules themselves are untouched: the decision is still billingMonths.js `decideMonth`, and the
// line is still `statementLine`, so a month here is the same object monthlyStatement returns for
// that month. test/statementRange.int.test.js asserts exactly that, month by month — if the two ever
// diverge, the history stops being evidence of what was invoiced.
//
// Campaigns are walked SERIALLY, like monthlyStatement and /billing-rollup: an org with fifty
// campaigns firing 150 concurrent queries is a worse neighbour than one that takes a moment.
export async function monthlyStatementRange(organizationId, { from, to }) {
  const months = monthsBetween(from, to);
  const first = months[0];
  const last = months[months.length - 1];
  const [sub, campaigns, org] = await Promise.all([
    Subscription.findOne({ organizationId }).lean(),
    Campaign.find({ organizationId }).select('+pricePerCampaignCents').sort({ createdAt: 1 }).lean(),
    Organization.findById(organizationId, { billRestrictedDoors: 1 }).lean(),
  ]);
  const rateCents = resolveRateCents(null, sub);

  // The floor can need the visit count of the month AFTER the first-visit month (see
  // needsStartMonthVisitCount). When the first-visit month is the LAST month of the range, that
  // fact lives outside it — so the aggregation window runs one month long. It costs nothing (the
  // extra month is read for existence only, never rendered) and without it a campaign whose start
  // grace was overturned in the following month would show the floor firing when it shouldn't.
  const aggLast = addMonths(last, 1);
  const perCampaign = [];
  for (const c of campaigns) {
    const tz = c.timeZone || 'America/New_York';
    const window = zonedDayRange(monthDayBounds(first).first, monthDayBounds(aggLast).last, tz);
    const [firstKnock, buckets, households] = await Promise.all([
      CanvassActivity.findOne(fieldVisitMatch(c._id), { timestamp: 1 }).sort({ timestamp: 1 }).lean(),
      // includeRestricted for the same reason monthlyStatement uses it: the line reports both
      // numbers and the flag only decides which one reads as the invoice figure.
      CanvassActivity.aggregate(
        knocksPipeline({ campaignId: c._id, timestamp: window }, { includeRestricted: true, monthTimeZone: tz })
      ),
      Household.countDocuments({ campaignId: c._id, isActive: true }),
    ]);
    const firstKnockAt = firstKnock?.timestamp || null;
    const archivedAt = c.isActive ? null : c.archivedAt || c.updatedAt || null;
    perCampaign.push({
      campaign: c,
      lineRate: resolveRateCents(c, sub),
      billRestricted: resolveBillRestricted(c, org),
      households,
      firstKnockAt,
      archivedAt,
      firstVisitDay: firstKnockAt ? zonedDayStr(firstKnockAt, tz) : null,
      archivedDay: archivedAt ? zonedDayStr(archivedAt, tz) : null,
      // Keyed by 'YYYY-MM'. Drive lookups off the REQUESTED month list, never off these keys: the
      // map holds whatever months had activity, which is neither the range nor a subset of it (the
      // window deliberately overruns by a month, and a campaign-tz bucket at the window edge can
      // name the month before it).
      byMonth: new Map(buckets.map((b) => [b._id, b])),
    });
  }

  const statements = months.map((month) => {
    const lines = perCampaign.map((pc) =>
      statementLine({
        campaign: pc.campaign,
        month,
        firstVisitDay: pc.firstVisitDay,
        archivedDay: pc.archivedDay,
        firstKnockAt: pc.firstKnockAt,
        archivedAt: pc.archivedAt,
        households: pc.households,
        billRestricted: pc.billRestricted,
        lineRate: pc.lineRate,
        agg: pc.byMonth.get(month),
        // Already in hand, so the narrow extra probe monthlyStatement has to make never happens
        // here. Still asked for through the same predicate, so the two paths agree on WHEN it
        // matters, not just on the number.
        visitsInStartMonth: (() => {
          const need = needsStartMonthVisitCount({
            month,
            firstVisitDay: pc.firstVisitDay,
            archivedDay: pc.archivedDay,
          });
          if (!need) return undefined;
          return pc.byMonth.get(need)?.billableDoors ? 1 : 0;
        })(),
      })
    );
    return {
      month,
      rateCents,
      rulesVersion: RULES_VERSION,
      lines,
      totalCents: lines.reduce((sum, l) => sum + l.amountCents, 0),
    };
  });

  return { from: first, to: last, rateCents, rulesVersion: RULES_VERSION, statements };
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

// The last N calendar months ending with the current one, as a { from, to } range. UTC-picked for
// the same reason currentMonth() is: it only chooses WHICH months to summarize, and each campaign is
// still evaluated in its own timezone inside.
export function historyRange(months, now = new Date()) {
  const to = currentMonth(now);
  const n = Math.max(1, Math.min(BILLING_HISTORY_MAX_MONTHS, Number(months) || 12));
  return { from: addMonths(to, -(n - 1)), to };
}

// The customer-facing projection of `monthlyStatementRange` — the same discipline as publicUsage()
// one function down, and for the same reason: pricing is negotiated per client and per race, so the
// money has to leave the PAYLOAD, not just the page. This is the ONLY place that decides what a
// customer may see of their own history, and test/billing.int.test.js walks the whole response
// asserting no key ending in `Cents` survives at any depth.
//
// What a customer DOES get is the thing they asked for: which campaigns were in the field in each
// month, and how many doors — because an org that invoices its own client per door bills from those
// numbers (the `billRestrictedDoors` opt-in on this very page decides which figure `doors` is).
//
// Per-campaign rows are trimmed to the months where a campaign had something to say: it billed, it
// had door activity, or a grace/floor rule made it free. The silent states (never been to the field,
// archived long ago) would otherwise repeat every campaign on every row for years and bury the
// months that matter; their counts still surface as `setupCount`.
const HISTORY_INTERESTING_REASONS = ['start-grace', 'end-grace', 'floor'];

export function publicMonthHistory(range) {
  return {
    from: range.from,
    to: range.to,
    months: range.statements
      .map((stmt) => {
        const campaigns = stmt.lines
          .filter(
            (l) =>
              l.billable ||
              l.knocksThisMonth > 0 ||
              l.restrictedDoorsThisMonth > 0 ||
              HISTORY_INTERESTING_REASONS.includes(l.reason)
          )
          .map((l) => ({
            campaignId: l.campaignId,
            name: l.name,
            isActive: l.isActive,
            archivedAt: l.archivedAt,
            firstKnockAt: l.firstKnockAt,
            billable: l.billable,
            reason: l.reason,
            households: l.households,
            knocks: l.knocksThisMonth,
            // The org's OWN invoice figure — knocks unless it opted into billing restricted doors.
            doors: l.billableDoorsThisMonth,
            restrictedDoors: l.restrictedDoorsThisMonth,
            billRestrictedDoors: l.billRestrictedDoors,
          }));
        return {
          month: stmt.month,
          billableCampaigns: stmt.lines.filter((l) => l.billable).length,
          setupCount: stmt.lines.filter((l) => l.reason === 'no-field-visit' && l.isActive).length,
          graceCount: stmt.lines.filter((l) => l.reason === 'start-grace').length,
          knocks: campaigns.reduce((n, c) => n + c.knocks, 0),
          doors: campaigns.reduce((n, c) => n + c.doors, 0),
          campaigns,
        };
      })
      // Newest first — a history is read from the present backwards.
      .reverse(),
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
