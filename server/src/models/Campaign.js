import mongoose from 'mongoose';

const campaignSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['survey', 'lit_drop'],
      required: true,
    },
    state: { type: String, required: true, trim: true, uppercase: true },
    surveyTemplateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SurveyTemplate',
      default: null,
    },
    isActive: { type: Boolean, default: true, index: true },
    // Do restricted (inaccessible) doors count toward this campaign's BILLABLE DOOR totals —
    // the number an org invoices its client from? TRI-STATE: null = inherit
    // Organization.billRestrictedDoors, true/false = explicit override. Always resolve through
    // services/reports/billRestricted.js; reading this field raw treats "inherit" as "off".
    // Scope is deliberately narrow: it moves `billableDoors` on invoice-facing surfaces only.
    // `knocks`, connection/contact rate, homesKnocked, and the coverage funnel are IDENTICAL in
    // both states — nobody answered a restricted door, so it can never enter a rate denominator
    // (docs/METRICS.md). Unrelated to what Doorline charges (flat per campaign per month) and to
    // when billing STARTS (a first non-bulk restricted mark starts the clock either way —
    // services/billing/statement.js). Not locked by hasCanvassed: it's a reporting policy and
    // every read is live, so flipping it mid-campaign is legitimate and fully reversible.
    billRestrictedDoors: { type: Boolean, default: null },
    // What DOORLINE charges for this campaign per month, in cents. TRI-STATE like the flag above:
    // null = inherit Subscription.pricePerCampaignCents, a number = negotiated override. This is
    // how a firm running a governor's race and a school-board race prices them differently inside
    // one org. Always resolve through services/billing/rate.js — reading it raw turns "inherit"
    // into "free". 0 is a LEGAL value (a comped campaign), so never coalesce it with `||`.
    //
    // `select: false` is load-bearing, not tidiness: routes/admin/campaigns.js returns campaigns by
    // spreading a lean doc (`...c`) and by returning the mongoose doc from PATCH, and org admins AND
    // team leads reach that router. Without this, the negotiated price would appear in their API
    // responses the moment this field existed. Writes are super-admin-only
    // (routes/superAdmin/billing.js); mongoose skips unselected paths on save(), so an org-admin
    // PATCH that loads the campaign without this path can never clear it.
    pricePerCampaignCents: { type: Number, default: null, select: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // The project's timezone (defines "a day" for the same-day collision /
    // per-day knock reporting). Admin-set in the UI.
    // NOTE: active rounds are NOT cached here — a campaign can have several active
    // rounds (one per active effort). Derive them via activePassIds() from
    // Pass.status === 'active' (services/passes/activePasses.js).
    timeZone: { type: String, default: 'America/New_York' },
    // Key dates — 'YYYY-MM-DD' civil-date strings interpreted in the campaign's own
    // timeZone (strings on purpose: a Date here would shift a day across UTC midnight).
    electionDay: { type: String, default: null },
    earlyVotingStart: { type: String, default: null },
    earlyVotingEnd: { type: String, default: null },
    // Free-form admin note shown beside the dates (e.g. polling-place quirks).
    datesNote: { type: String, default: '', trim: true, maxlength: 280 },
    // When an admin dismisses the "Setup complete — this campaign is live" dashboard
    // banner. Set once (for all admins of the campaign); null = never dismissed. Only
    // silences the go-live confirmation — incomplete-setup guidance still shows.
    setupLiveDismissedAt: { type: Date, default: null },
    // Set when an admin archives (isActive → false), cleared on reactivate.
    // Billing: a campaign bills through its archive month and not beyond
    // (services/billing/statement.js). Legacy archived campaigns have null —
    // migrate:billing backfills updatedAt.
    archivedAt: { type: Date, default: null },
    // Set once, atomically, when this campaign's contribution has been banked into the platform
    // marketing counters (services/platform/platformStats.js), so a RETRIED hard-delete can't capture
    // its counts twice into the permanent `deleted` bucket. Deleted with the campaign.
    platformStatsCaptured: { type: Boolean, default: false },
    // Denormalized ALL-TIME ledger counters, maintained by services/reports/campaignCounters.js
    // so the no-date-window dashboards (rollup "All time", campaigns list) read the campaign doc
    // instead of re-aggregating the whole CanvassActivity/SurveyResponse ledgers on every load.
    // Semantics mirror the live aggregations EXACTLY (see aggregations.js):
    //   knockCount..refusedKnockCount = knocksPipeline (distinct household×pass, billable);
    //   restrictedDoorCount = distinct household×pass doors whose ONLY disposition is a non-bulk
    //   `restricted` mark (knocksPipeline with includeRestricted, `restrictedDoors`) — so
    //   knockCount + restrictedDoorCount = billableDoors, and the two never double-count the
    //   same door; litDroppedCount = lit_dropped row volume; activityCount = every activity row (any type,
    //   bulk included — powers hasCanvassed); surveyCount = SurveyResponse rows;
    //   lastActivityAt / canvasserIds = NON-bulk only (matching NOT_BULK canvasser surfaces;
    //   canvasserIds is bounded by the campaign roster, ~dozens).
    // `reconciledAt` is the trust marker: readers fall back to live aggregation when it's null
    // (legacy docs pre-backfill), and the counter bump no-ops until the reconcile seeds it —
    // stats are either exact or absent, never partial. Repair/backfill: migrate:campaign-stats.
    stats: {
      activityCount: { type: Number, default: 0 },
      knockCount: { type: Number, default: 0 },
      surveyedKnockCount: { type: Number, default: 0 },
      litKnockCount: { type: Number, default: 0 },
      refusedKnockCount: { type: Number, default: 0 },
      restrictedDoorCount: { type: Number, default: 0 },
      litDroppedCount: { type: Number, default: 0 },
      surveyCount: { type: Number, default: 0 },
      lastActivityAt: { type: Date, default: null },
      canvasserIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
      // Trust marker. Default NULL on purpose: a legacy doc that materializes this subdoc via an
      // unrelated .save() must stay untrusted (its true counts aren't zero). Only genuinely NEW
      // campaigns are stamped (pre-validate below — all-zero is exact at birth); legacy docs get
      // stamped by the backfill migration.
      reconciledAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

campaignSchema.pre('validate', function (next) {
  // A survey campaign MAY exist without a template — you attach one before going live; the
  // requirement is enforced at round activation (routes/admin/passes.js), not here.
  if (this.type === 'lit_drop' && this.surveyTemplateId) {
    this.surveyTemplateId = null;
  }
  // A brand-new campaign has an empty ledger, so its all-zero stats are exact — stamp it trusted
  // at birth. Existing docs (isNew false) are never stamped here; see the stats comment above.
  if (this.isNew && this.stats && !this.stats.reconciledAt) {
    this.stats.reconciledAt = new Date();
  }
  next();
});

export const Campaign = mongoose.model('Campaign', campaignSchema);
