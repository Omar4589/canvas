import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';

// "Do restricted (inaccessible) doors count toward billable DOOR totals?" — resolved from the
// campaign override, falling back to the org default, falling back to false (today's behavior).
//
// Same fallback shape as the campaign→org timeZone chain (routes/admin/reports.js), which is the
// only other org-level default in the model layer. Kept here, in one place, because reading
// `campaign.billRestrictedDoors` directly silently collapses "inherit" (null) into "off" — an org
// that turned the default ON would quietly get the old numbers on every surface that skipped it.
//
// What this flag moves is narrow by design: `billableDoors` on invoice-facing surfaces. It never
// touches knocks, connection/contact rate, homesKnocked, or the coverage funnel (docs/METRICS.md),
// and it has no bearing on what Doorline charges the org (flat per campaign per month) or on when
// a campaign's billing clock starts (services/billing/statement.js — flag-independent).

// Pure form, for callers that already hold both docs. Explicit true/false on the campaign wins;
// null/undefined means inherit.
export function resolveBillRestricted(campaign, org) {
  const override = campaign?.billRestrictedDoors;
  if (override === true || override === false) return override;
  return Boolean(org?.billRestrictedDoors);
}

// Async form. `campaignId` is optional — org-wide surfaces (no campaign in scope) get the org
// default. The campaign lookup is org-scoped for the same reason every other lookup in the report
// layer is: an unscoped findById would let a foreign campaignId decide this org's invoice numbers.
export async function billRestrictedFor(organizationId, campaignId) {
  const [campaign, org] = await Promise.all([
    campaignId
      ? Campaign.findOne({ _id: campaignId, organizationId }, { billRestrictedDoors: 1 }).lean()
      : Promise.resolve(null),
    Organization.findById(organizationId, { billRestrictedDoors: 1 }).lean(),
  ]);
  return resolveBillRestricted(campaign, org);
}
