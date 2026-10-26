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
    // "Team attribution is complete for this org." Until it is, history has no team tag — and an
    // unstamped row is invisible to `coordinatorId: <team>` while being swallowed by the No-team
    // bucket, so a half-backfilled org shows every team at ~zero and "No team" enormous. Both look
    // like data, not like an error. The team filter and the by-team breakdown refuse to render
    // until this is set: deploy order is not a safeguard, a gate is.
    //
    // Defaults to NOW because a brand-new org has zero ledger rows, so the claim is vacuously
    // true. That default is load-bearing, not a convenience: this was previously `null` and the
    // ONLY writer was migrate:activity-coordinator, which sits below two `continue` guards and so
    // never ran for an org with nothing to backfill. Every org created after that release was
    // therefore permanently gated OFF — team surfaces silently absent, forever. The default lives
    // on the schema rather than in the create route because there are two creation paths
    // (routes/superAdmin/organizations.js and utils/seedDemoOrg.js) and a third would inherit the
    // bug. repair:team-stamps backfills the orgs that predate this.
    teamAttributionReadyAt: { type: Date, default: () => new Date() },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Set once this org's lifetime contribution has been banked into the platform marketing counters
    // (services/platform/platformStats.js) — or, for an internal org, once its capture found nothing to
    // bank. A RETRIED deletion (the retention sweep re-runs a partially-failed delete) reads it as
    // "captured already"; the bank ledger on PlatformStats is what guarantees the bank lands once. It
    // also keeps the org's surviving rows out of the live counts while its cascade runs (or waits for
    // Retry), and tells late Door Outcomes writers that the cascade has begun (lateWriteSweep.js).
    // Deleted with the org, so it never lingers.
    platformStatsCaptured: { type: Boolean, default: false },
    // Anchor timezone for ORG-WIDE rollups (multi-campaign), where a single campaign's
    // zone doesn't apply. Per-campaign views use Campaign.timeZone. Overridable in the UI.
    timeZone: { type: String, default: 'America/New_York' },
    // Org-wide DEFAULT for "do restricted (inaccessible) doors count toward the billable door
    // totals we invoice our client from". Campaign.billRestrictedDoors overrides it per campaign
    // (null there = inherit this); resolve via services/reports/billRestricted.js — never read
    // either field directly. Default false = today's behavior (restricted is never a billable
    // door). This affects ONLY door totals on invoice-facing surfaces: knocks, every rate, and
    // the coverage funnel are untouched in both states (docs/METRICS.md). It also has no bearing
    // on what DOORLINE charges this org — our price is flat per campaign per month.
    // Set by the org's own billing admin (PATCH /admin/billing/settings).
    billRestrictedDoors: { type: Boolean, default: false },
    // The weekday client-report weeks start on (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §C): 0 = Sunday … 6 =
    // Saturday, Monday unless an admin changes it (PATCH /admin/client-reports/settings). It sets the dates New
    // report suggests and what Next report makes after an odd-length report, for every campaign; reports
    // already made keep their dates. Read through reportWeekStartsOnOf (services/reports/reportPeriods.js) —
    // `?? 1`, so an organization saved before this field existed is Monday with no migration. Other pages'
    // This/Last week presets stay Monday-based (client/src/lib/datePresets.js).
    reportWeekStartsOn: { type: Number, min: 0, max: 6, default: 1 },
    // Automatic pause (docs/PROPOSAL_PACE_PAUSE.md §H). On for every customer by default; read
    // `pacePause?.enabled !== false`, so an org saved before this field existed is on with no migration.
    // `alertUserIds` undefined = nobody chosen beyond the billing admins (never default an array here: a []
    // default would be written into every org on its next save). `enabledAt` is stamped ONLY by an off → on
    // change and restarts every member's count; `changedAt`/`changedBy` record any change. Set by a billing
    // admin (PATCH /admin/pace-pauses/settings), always by dotted path.
    pacePause: {
      enabled: { type: Boolean, default: true },
      billingAdmins: { type: Boolean, default: true },
      alertUserIds: { type: [mongoose.Schema.Types.ObjectId], default: undefined },
      enabledAt: { type: Date, default: null },
      changedAt: { type: Date, default: null },
      changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
    // Dormancy-deletion warning bookkeeping (services/retention/triggers.js). `dormancyWarnedAt`
    // is stamped ONLY when the warning email was actually accepted for delivery (or the org has
    // no reachable recipient at all) — the purge refuses to run without it, and refuses before
    // `dormancyDeleteNotBefore`, the exact date the email promised. New activity, or a billing
    // status change, clears both: a stale warning must never license a deletion.
    dormancyWarnedAt: { type: Date, default: null },
    dormancyDeleteNotBefore: { type: Date, default: null },
    // Hard-delete runs as a background job on the worker dyno (services/platform/deleteOrgProcessor.js),
    // and the Organization doc itself is the job record — success is the row being GONE, so only
    // in-flight/failed state lives here. `requestedAt` is THE truth flag (null ⇒ not deleting;
    // services/platform/orgDeletionState.js exports the shared filter): while set, the WHOLE TENANT is
    // walled — middleware/orgContext.js resolves the org as gone, so every /admin and /mobile request
    // 404s and every picker drops it. All FOUR delete paths stamp this (break-glass, and the three
    // retention triggers), which is why `source` exists; `requestId` lets the job close the
    // OrgDeletionRequest row that asked for it. A `failed` deletion keeps requestedAt set on purpose
    // (the cascade may have half-run); the only exits are Retry or completion. No index: ≈0-1 deleting
    // rows platform-wide, and every read rides _id or a few-hundred-doc scan.
    deletion: {
      requestedAt: { type: Date, default: null },
      requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      source: { type: String, enum: ['break_glass', 'wind_down', 'dormancy', 'requested'], default: null },
      requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'OrgDeletionRequest', default: null },
      status: { type: String, enum: ['pending', 'running', 'failed'], default: null },
      heartbeatAt: { type: Date, default: null },
      error: { type: String, default: null },
    },
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
