import mongoose from 'mongoose';

// An answer option. `id` is the STABLE per-question key — reports/tracking join on it,
// so `text` is freely editable without breaking counts. `tag` (Phase 3) groups options;
// `script` (Phase 2) is the response the canvasser reads when it's picked; `retired`
// soft-hides it from the field while keeping its past answers in reports. `goTo` is the
// answer's "then go to" in Script flow: null = the following live block, a later block's
// key, or '__end__'. The compiler (services/surveys/routing.js) turns it into the visibleIf
// every phone evaluates at save; no phone follows it.
const optionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    tag: { type: String, default: null },
    script: { type: String, default: null },
    retired: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    goTo: { type: String, default: null },
  },
  { _id: false }
);

// A web link on a block, opened by the canvasser on an explicit tap to show the voter. Only
// http(s) URLs are accepted (routes/admin/surveys.js); nothing is fetched or appended.
const linkSchema = new mongoose.Schema(
  {
    label: { type: String, default: '' },
    url: { type: String, required: true },
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

// One block of a survey. Most blocks are questions; a `statement` is read aloud and records
// nothing (no options, never required, never a stored answer row). Statements live in this same
// array so ordering, reconcile, duplicate, the bootstrap and the evaluator need no second
// plumbing — the evaluator never reads `type`. On a statement `label` IS the read-aloud body (up
// to 5000 characters), so a phone on an older bundle, which prints only `label`, still reads the
// whole text. See docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md §E1.
const questionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // stable per-survey question id (slug); never reused once retired
    label: { type: String, required: true },
    type: {
      type: String,
      enum: ['single_choice', 'multiple_choice', 'text', 'statement'],
      required: true,
    },
    // Statements only: 'statement' (read aloud mid-conversation) or 'closing' (a goodbye that
    // replaces the default closing). NO default, on purpose: a subdocument default is stamped onto
    // EVERY question on hydrate, so a plain question would come back role: 'statement'. The
    // admin route sets it on statements and strips it from questions; readers check type first.
    role: { type: String, enum: ['statement', 'closing'] },
    title: { type: String, default: null }, // a statement's short name ("Close 2") for headers and messages
    note: { type: String, default: null }, // canvasser-only, never read aloud, never exported or printed
    links: { type: [linkSchema], default: [] },
    // Script-flow routes, compiled into visibleIf at save (no phone follows them; every phone
    // evaluates the compiled visibleIf): `goTo` on a statement or text question, `otherGoTo` for
    // the "Other (specify)" pick. null = the following live block; '__end__' ends the conversation.
    goTo: { type: String, default: null },
    otherGoTo: { type: String, default: null },
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
    // The DEFAULT closing: the goodbye on any path that reaches no closing block. A survey with
    // no closing blocks (every survey before Script flow) renders it exactly as it always did.
    closing: { type: String, default: '' },
    questions: { type: [questionSchema], default: [] },
    // How the stored visibleIf came to be: 'list' = hand-authored "Show only if" conditions;
    // 'script' = compiled from the routes at every save, so the incoming visibleIf is ignored and
    // overwritten. Stored rather than inferred from "any route exists", so one stray route can
    // never flip recording semantics. Lean readers see it absent on older templates: `?? 'list'`.
    flow: { type: String, enum: ['list', 'script'], default: 'list' },
    // How the phone shows it: 'scroll' = today's single page; 'steps' = one block per screen.
    // Pure presentation — both walk the same evaluator-visible list, so answers can't differ.
    presentation: { type: String, enum: ['scroll', 'steps'], default: 'scroll' },
    tags: { type: [String], default: [] }, // Phase 3 tag palette (display casing; matching is case-insensitive)
    // Soft-archive: hidden from the default library list & from pickers (unless
    // currently selected). Null = active. Existing docs default to null — no migration.
    archivedAt: { type: Date, default: null, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

export const SurveyTemplate = mongoose.model('SurveyTemplate', surveyTemplateSchema);
