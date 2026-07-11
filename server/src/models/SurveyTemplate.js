import mongoose from 'mongoose';

// An answer option. `id` is the STABLE per-question key — reports/tracking join on it,
// so `text` is freely editable without breaking counts. `tag` (Phase 3) groups options;
// `script` (Phase 2) is the response the canvasser reads when it's picked; `retired`
// soft-hides it from the field while keeping its past answers in reports.
const optionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    tag: { type: String, default: null },
    script: { type: String, default: null },
    retired: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

// Conditional display (Phase 2): a question is shown iff its rules hold (all/any) against
// the in-progress answers. One rule references an earlier question's chosen option ids.
const ruleSchema = new mongoose.Schema(
  {
    questionKey: { type: String, required: true },
    op: { type: String, enum: ['is', 'is_not', 'any_of', 'answered', 'not_answered'], required: true },
    optionIds: { type: [String], default: [] },
  },
  { _id: false }
);

const visibleIfSchema = new mongoose.Schema(
  {
    logic: { type: String, enum: ['all', 'any'], default: 'all' },
    rules: { type: [ruleSchema], default: [] },
  },
  { _id: false }
);

const questionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // stable per-survey question id (slug); never reused once retired
    label: { type: String, required: true },
    type: {
      type: String,
      enum: ['single_choice', 'multiple_choice', 'text'],
      required: true,
    },
    options: { type: [optionSchema], default: [] },
    required: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    retired: { type: Boolean, default: false }, // soft-retire a whole question (hidden in field, kept in reports)
    visibleIf: { type: visibleIfSchema, default: null }, // Phase 2 conditional display
    otherOption: { type: Boolean, default: false }, // an "Other: ___" choice that captures typed text
    refusalOption: { type: Boolean, default: false }, // a tracked "Refused to answer" choice
  },
  { _id: false }
);

const surveyTemplateSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    isActive: { type: Boolean, default: false, index: true },
    version: { type: Number, default: 1 },
    intro: { type: String, default: '' },
    closing: { type: String, default: '' },
    questions: { type: [questionSchema], default: [] },
    tags: { type: [String], default: [] }, // Phase 3 tag palette (display casing; matching is case-insensitive)
    // Soft-archive: hidden from the default library list & from pickers (unless
    // currently selected). Null = active. Existing docs default to null — no migration.
    archivedAt: { type: Date, default: null, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

export const SurveyTemplate = mongoose.model('SurveyTemplate', surveyTemplateSchema);
