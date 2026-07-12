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
    // Denormalized ALL-TIME ledger counters, maintained by services/reports/campaignCounters.js
    // so the no-date-window dashboards (rollup "All time", campaigns list) read the campaign doc
    // instead of re-aggregating the whole CanvassActivity/SurveyResponse ledgers on every load.
    // Semantics mirror the live aggregations EXACTLY (see aggregations.js):
    //   knockCount..refusedKnockCount = knocksPipeline (distinct household×pass, billable);
    //   litDroppedCount = lit_dropped row volume; activityCount = every activity row (any type,
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
