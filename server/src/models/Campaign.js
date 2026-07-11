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
  },
  { timestamps: true }
);

campaignSchema.pre('validate', function (next) {
  // A survey campaign MAY exist without a template — you attach one before going live; the
  // requirement is enforced at round activation (routes/admin/passes.js), not here.
  if (this.type === 'lit_drop' && this.surveyTemplateId) {
    this.surveyTemplateId = null;
  }
  next();
});

export const Campaign = mongoose.model('Campaign', campaignSchema);
