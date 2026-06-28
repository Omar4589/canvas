import mongoose from 'mongoose';

const answerSchema = new mongoose.Schema(
  {
    questionKey: { type: String, required: true },
    questionLabel: { type: String, required: true },
    // Snapshot text (string | string[] | free text). Kept for human display AND as the
    // legacy reporting fallback for responses recorded before stable option ids existed.
    answer: { type: mongoose.Schema.Types.Mixed, default: null },
    // Stable option id(s) chosen — the id-native tracking key. Single → 1, multi → N,
    // empty for free-text. Reporting groups on this, falling back to `answer` text.
    optionIds: { type: [String], default: [] },
    // Text typed into an "Other: ___" option.
    otherText: { type: String, default: null },
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

    // Pass/turf/effort tags — metadata only (null = pre-turf history).
    passId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pass', default: null },
    turfId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turf', default: null },
    effortId: { type: mongoose.Schema.Types.ObjectId, ref: 'Effort', default: null, index: true },

    // Audit trail for in-place edits from the admin voter profile (null = never edited).
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One survey per voter PER PASS — DB-enforced so a double-submit race can't persist two rows.
// The submit route upserts on this key. passId is always set (a real id or the legacy null
// bucket), so a plain unique index is correct; different passes/voters are unaffected. NOTE: a
// pre-existing DB must be deduped before this can build — see migrations/migrateSurveyDedup.js.
surveyResponseSchema.index({ voterId: 1, passId: 1 }, { unique: true });
surveyResponseSchema.index({ householdId: 1, passId: 1 }); // per-pass survey existence

export const SurveyResponse = mongoose.model('SurveyResponse', surveyResponseSchema);
