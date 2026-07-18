import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    isActive: { type: Boolean, default: true, index: true },
    // Doorline-owned org (the demo org and any future internal sandbox). SECURITY BOUNDARY:
    // this flag is what lets platform staff enter WITHOUT a support grant and WITHOUT
    // AccessLog rows (middleware/orgContext.js), so it is immutable — settable only when the
    // org is CREATED (break-glass only; routes/superAdmin/organizations.js) or by the three
    // sanctioned CLI-only raw-collection writes: migrations/migrateInternalOrgs.js,
    // migrations/migrateBilling.js (--internal slugs), and utils/seedDemoOrg.js.
    // It is deliberately absent from every update schema, and `immutable` strips it from any
    // Mongoose update as defense-in-depth: there is no API path that turns an existing
    // (customer-data-bearing) org into an internal one. Billing status is locked to
    // 'internal' while this is set, and 'internal' status is unreachable without it
    // (routes/superAdmin/billing.js).
    isInternal: { type: Boolean, default: false, immutable: true },
    // Set by migrate:activity-coordinator on a clean completion. Until then, history has no team
    // tag — and an unstamped row is invisible to `coordinatorId: <team>` while being swallowed by
    // the No-team bucket, so a half-backfilled org shows every team at ~zero and "No team"
    // enormous. Both look like data, not like an error. The team filter and the by-team breakdown
    // refuse to render until this is set: deploy order is not a safeguard, a gate is.
    teamAttributionReadyAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Set once, atomically, when this org's lifetime contribution has been banked into the platform
    // marketing counters (services/platform/platformStats.js), so a RETRIED deletion — the retention
    // sweep re-runs a partially-failed delete — can't capture the same org's counts twice. Deleted with
    // the org, so it never lingers.
    platformStatsCaptured: { type: Boolean, default: false },
    // Anchor timezone for ORG-WIDE rollups (multi-campaign), where a single campaign's
    // zone doesn't apply. Per-campaign views use Campaign.timeZone. Overridable in the UI.
    timeZone: { type: String, default: 'America/New_York' },
    // Dormancy-deletion warning bookkeeping (services/retention/triggers.js). `dormancyWarnedAt`
    // is stamped ONLY when the warning email was actually accepted for delivery (or the org has
    // no reachable recipient at all) — the purge refuses to run without it, and refuses before
    // `dormancyDeleteNotBefore`, the exact date the email promised. New activity, or a billing
    // status change, clears both: a stale warning must never license a deletion.
    dormancyWarnedAt: { type: Date, default: null },
    dormancyDeleteNotBefore: { type: Date, default: null },
  },
  { timestamps: true }
);

organizationSchema.statics.toSlug = function (name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
};

export const Organization = mongoose.model('Organization', organizationSchema);
