import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    isActive: { type: Boolean, default: true, index: true },
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
