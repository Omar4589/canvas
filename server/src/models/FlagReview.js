import mongoose from 'mongoose';

// A reviewer's DECISION about one flagged action. Flags themselves are NEVER stored —
// they're computed live by services/audit/flagDetection.js. The only persisted state is
// the human decision, keyed to a stable (actionModel, actionId). Absence of a record IS
// the "open" status (nothing to store until someone actions it), so a flag can never be
// silently lost and reopening simply deletes the record.
const flagReviewSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true,
    },

    // The flagged action this decision is about. Almost always a CanvassActivity (the
    // door-action ledger the detector reads); kept generic so a standalone SurveyResponse
    // could be reviewed too.
    actionModel: {
      type: String,
      enum: ['CanvassActivity', 'SurveyResponse'],
      required: true,
    },
    actionId: { type: mongoose.Schema.Types.ObjectId, required: true },

    // 'open' is NEVER stored — the absence of a record means open.
    status: {
      type: String,
      enum: ['reviewed', 'dismissed', 'confirmed'],
      required: true,
    },
    note: { type: String, default: null },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reviewedAt: { type: Date, default: () => new Date() },

    // Snapshot of the reasons at decision time, so a decision survives later threshold
    // changes (if an action stops being flagged, its review just goes dormant).
    reasonsAtReview: { type: [String], default: [] },
  },
  { timestamps: true }
);

// One decision per action (the upsert key).
flagReviewSchema.index({ organizationId: 1, actionModel: 1, actionId: 1 }, { unique: true });
// Per-campaign audit trail / feed.
flagReviewSchema.index({ campaignId: 1, reviewedAt: -1 });

export const FlagReview = mongoose.model('FlagReview', flagReviewSchema);
