import { Campaign } from '../../models/Campaign.js';
import { Subscription } from '../../models/Subscription.js';

// "What do we charge for THIS campaign, this month?" — resolved from the campaign override,
// falling back to the org's negotiated rate, falling back to the $300 default.
//
// Same fallback shape as services/reports/billRestricted.js, and here for the same reason: reading
// `campaign.pricePerCampaignCents` directly collapses "inherit" (null) into "free", which would
// silently zero out a customer's invoice.
//
// WHY a per-campaign tier exists: the rate used to live only on Subscription, one per org. A
// consulting firm running a governor's race and a school-board race billed both identically, which
// made the one thing sales actually does — price to the size of the race — impossible without
// splitting the client into two orgs. Universe size is still never enforced in code; this is a
// negotiated number an account manager sets, not a computed one.
//
// The override is SUPER-ADMIN ONLY (routes/superAdmin/billing.js). It is deliberately absent from
// routes/admin/campaigns.js, which org admins and team leads can reach — and the schema path
// carries `select: false` so it can't ride along in a `...campaign` spread on some future route.

// ⚠️ This number is PUBLISHED. Since Aug 2026 the marketing site names it as the starting price
// — client/src/marketing/Hero.jsx (the line under the hero CTAs), the "What does it cost?" FAQ in
// client/src/marketing/Faq.jsx, and the `offers` node in client/index.html's JSON-LD. Changing the
// default rate means changing all three in the same commit, or doorline.app advertises a price we
// don't charge. (Negotiated org/campaign overrides are private and unaffected — only this default
// is public, and only as "starts at".)
export const DEFAULT_RATE_CENTS = 30000;

// Pure form, for callers that already hold both docs.
//
// The null checks are explicit rather than `||` on purpose: 0 IS a legal rate (the zod schema
// allows `min(0)`, and a comped campaign is a real thing an account manager sets up), so `||`
// would silently promote a deliberate $0 back to $300. `??` would be correct today; the explicit
// form is here so the next person to touch it can see that 0 was considered.
export function resolveRateCents(campaign, sub) {
  const override = campaign?.pricePerCampaignCents;
  if (override !== null && override !== undefined) return override;
  const orgRate = sub?.pricePerCampaignCents;
  if (orgRate !== null && orgRate !== undefined) return orgRate;
  return DEFAULT_RATE_CENTS;
}

// Async form. `campaignId` is optional — org-wide surfaces get the org default. The campaign lookup
// is org-scoped for the same reason billRestrictedFor's is: an unscoped findById would let a
// foreign campaignId decide this org's invoice numbers. `+pricePerCampaignCents` is required
// because the path is `select: false`.
export async function rateCentsFor(organizationId, campaignId) {
  const [campaign, sub] = await Promise.all([
    campaignId
      ? Campaign.findOne({ _id: campaignId, organizationId })
          .select('+pricePerCampaignCents')
          .lean()
      : Promise.resolve(null),
    Subscription.findOne({ organizationId }, { pricePerCampaignCents: 1 }).lean(),
  ]);
  return resolveRateCents(campaign, sub);
}
