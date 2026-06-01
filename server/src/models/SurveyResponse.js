import mongoose from 'mongoose';

const answerSchema = new mongoose.Schema(
  {
    questionKey: { type: String, required: true },
    questionLabel: { type: String, required: true },
    answer: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const locationSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy: { type: Number, default: null },
  },
  { _id: false }
);

const surveyResponseSchema = new mongoose.Schema(
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
    voterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Voter', required: true, index: true },
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    surveyTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'SurveyTemplate', required: true },
    surveyTemplateVersion: { type: Number, required: true },

    answers: { type: [answerSchema], default: [] },
    note: { type: String, default: null },

    location: { type: locationSchema, required: true },
    distanceFromHouseMeters: { type: Number, default: null },

    submittedAt: { type: Date, required: true },
    syncedAt: { type: Date, default: () => new Date() },
    wasOfflineSubmission: { type: Boolean, default: false },

    // Pass/turf tags — metadata only (null = pre-turf history).
    passId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pass', default: null },
    turfId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turf', default: null },
  },
  { timestamps: true }
);

surveyResponseSchema.index({ voterId: 1, passId: 1 }); // within-pass survey dedup
surveyResponseSchema.index({ householdId: 1, passId: 1 }); // per-pass survey existence

export const SurveyResponse = mongoose.model('SurveyResponse', surveyResponseSchema);
