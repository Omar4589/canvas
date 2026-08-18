import mongoose from 'mongoose';

// Exported (not module-private) because SurveyResponseArchive embeds the SAME schemas —
// an archived response is a verbatim snapshot, and sharing the schema objects means the
// snapshot shape can never drift from the live one.
export const answerSchema = new mongoose.Schema(
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

export const locationSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy: { type: Number, default: null },
    // GPS-audit provenance — kept in lockstep with CanvassActivity's locationSchema so
    // the two ledgers can't drift (audits read CanvassActivity; this is the survey copy).
    mocked: { type: Boolean, default: null },
    fixTimestamp: { type: Date, default: null },
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

    // The TEAM this survey belongs to — the canvasser's coordinator when they took it, frozen.
    // Mirrors CanvassActivity.coordinatorId (see the long note there); kept in step so a team's
    // SURVEY numbers survive a canvasser leaving exactly like their door numbers do.
    // An admin editing a response later must NOT restamp this — it records who did the fieldwork.
    coordinatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Audit trail for in-place edits from the admin voter profile (null = never edited).
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    editedAt: { type: Date, default: null },

    // DESK-ENTERED: this response was typed by an admin converting a door outcome into Surveyed
    // (services/canvass/surveyConversion.js), NOT submitted from a phone at the door. Every other
    // field above still describes the ORIGINAL KNOCK — userId, coordinatorId, location, submittedAt
    // and the pass/turf/effort tags are copied verbatim off the CanvassActivity row being converted,
    // because the knock really happened; only the answers are the admin's entry.
    //
    // ABSENCE is the field-submission marker (the CanvassActivity.reclassified shape), so every
    // existing reader is unaffected and `{ 'deskEntry': { $exists: true } }` is the exact query.
    // Distinct from editedBy/editedAt, which mean "a real submission was edited afterwards" — a
    // desk-entered row was AUTHORED, never edited, and sets both to null.
    deskEntry: {
      type: new mongoose.Schema(
        {
          runId: { type: mongoose.Schema.Types.ObjectId, ref: 'SurveyConversionRun', required: true },
          byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // the ADMIN who typed it
          at: { type: Date, required: true },
          source: { type: String, enum: ['converted_outcome'], required: true },
          // The outcome the door entry said before the conversion ('not_home', 'refused', …), so
          // the profile can say WHICH mistake was being corrected rather than just "entered by an
          // admin". Mirrors CanvassActivity.reclassified.from on the paired row.
          fromOutcome: { type: String, default: null },
        },
        { _id: false }
      ),
      default: undefined,
    },
  },
  { timestamps: true }
);

// One survey per voter PER PASS — DB-enforced so a double-submit race can't persist two rows.
// The submit route upserts on this key. passId is always set (a real id or the legacy null
// bucket), so a plain unique index is correct; different passes/voters are unaffected. NOTE: a
// pre-existing DB must be deduped before this can build — see migrations/migrateSurveyDedup.js.
surveyResponseSchema.index({ voterId: 1, passId: 1 }, { unique: true });
surveyResponseSchema.index({ householdId: 1, passId: 1 }); // per-pass survey existence
// Reports/dashboards: campaign-scoped, date-ranged, submittedAt-sorted (voters-by-answer,
// campaign-rollup, canvassers, notes, survey-results). Twin of CanvassActivity {campaignId,timestamp}.
surveyResponseSchema.index({ campaignId: 1, submittedAt: -1 });
// Org-wide, date-ranged reports (no campaignId) — twin of CanvassActivity {organizationId,timestamp}.
surveyResponseSchema.index({ organizationId: 1, submittedAt: -1 });
// Reverting a desk-entry run deletes exactly the rows THAT run created. Without this the
// deleteMany collection-scans every response in the org. Partial so it stays near-empty for orgs
// that never convert an outcome. DELIBERATE distinct key shape (see the CanvassActivity note):
// buildIndexes.js diffs by key shape alone, so a partial reusing an existing shape is silently
// reported as already-present and never built.
surveyResponseSchema.index(
  { 'deskEntry.runId': 1 },
  { partialFilterExpression: { 'deskEntry.runId': { $exists: true } } }
);

export const SurveyResponse = mongoose.model('SurveyResponse', surveyResponseSchema);
