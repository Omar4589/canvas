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
  },
  { timestamps: true }
);

campaignSchema.pre('validate', function (next) {
  if (this.type === 'survey' && !this.surveyTemplateId) {
    return next(new Error('Survey campaigns require a surveyTemplateId.'));
  }
  if (this.type === 'lit_drop' && this.surveyTemplateId) {
    this.surveyTemplateId = null;
  }
  next();
});

export const Campaign = mongoose.model('Campaign', campaignSchema);
