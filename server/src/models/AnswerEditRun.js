import mongoose from 'mongoose';

// One Door Outcomes ANSWER EDIT — changing, clearing or taking picks out of answers on surveys that
// stay surveyed (docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §F). Two modes:
//   'bulk'  — one plan applied to a frozen selection of surveys, on the worker (answer-edit-queue);
//   'queue' — one person at a time: the admin steps through the frozen selection, each survey edited
//             through the same writer; the session stays `open` between steps.
//
// WHY ITS OWN MODEL, not a third direction on SurveyConversionRun: every caller of that model
// branches two ways and reads `else` as from_survey, and its platform-counter bump would subtract
// an edit's archived copies from the survey total. The house pattern is one run model per act.
//
// WHAT IS NOT HERE: the frozen selection. Up to 50k (survey, fingerprint) pairs would be megabytes
// on one document; they live in AnswerEditRunChunk, 500 to a chunk. What each survey looked like
// before the edit lives in SurveyResponseArchive (via 'answer_edit', linked by answerEditRunId).
//
// Phase rules (services/canvass/answerEditRuns.js enforces them, the processor re-checks before
// every chunk):
//   • Pick up (resume) is a compare-and-swap on { status: 'failed', 'undo.status': null }: once an
//     undo has started, the change can never be applied again.
//   • Undo only from `completed` or `failed`, never while a phase runs or a session is open.
//   • Retry undo only from undo.status 'failed'.
const planEntrySchema = new mongoose.Schema(
  {
    questionKey: { type: String, required: true },
    questionLabel: { type: String, default: null },
    op: { type: String, enum: ['clear', 'set', 'adjust'], required: true },
    optionIds: { type: [String], default: undefined },
    remove: { type: [String], default: undefined },
    removeTexts: { type: [String], default: undefined },
    replaceWith: { type: [String], default: undefined },
  },
  // `remove` is the plan's own word (answerEdit.js validatePlan) and shadows a subdocument method
  // nothing here ever calls — plan entries are written once and only read back.
  { _id: false, suppressReservedKeysWarning: true }
);

const nameSchema = new mongoose.Schema(
  {
    voterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Voter' },
    voterName: String,
    // The reason list (§H2): 'changed_since' | 'restored_on_profile' | 'waiting' | 'cleared' |
    // 'erased' | 'gone' on an undo; 'changed_since_review' | 'not_found' on the apply.
    reason: String,
    // Plain words naming who changed it since, or which change holds it ("Unknock, Oct 20").
    detail: { type: String, default: null },
  },
  { _id: false }
);

const answerEditRunSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    mode: { type: String, enum: ['bulk', 'queue'], required: true },

    // FROZEN at create: the applier and the visibility evaluator run against this copy, never the
    // live survey, so a survey saved mid-run (a lead can save one) changes nothing about what this
    // run does — and its undo never depends on the survey still having these questions.
    template: {
      surveyTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'SurveyTemplate', required: true },
      version: { type: Number, default: 1 },
      name: { type: String, default: null },
      flow: { type: String, default: null },
      questions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },
    // Bulk: the validated plan (answerEdit.js validatePlan). Empty for a queue session.
    plan: { type: [planEntrySchema], default: [] },
    // One English line, frozen like scopeSummary: it quotes the survey's own wording as the admin
    // saw it. A queue session builds it from its steps as it goes.
    planSummary: { type: String, default: null },

    // What was reviewed: the wire scope, whether rows were hand-ticked, and the digest + asOf the
    // create call re-checked (a mismatch is 409 REVIEW_STALE, written before anything else).
    selection: {
      scope: { type: mongoose.Schema.Types.Mixed, default: {} },
      byIds: { type: Boolean, default: false },
      digest: { type: String, default: null },
      asOf: { type: Date, default: null },
      total: { type: Number, default: 0 },
    },
    scopeSummary: { type: String, default: null },

    // Set ONCE at create: every survey a bulk run edits carries it as editedAt, and every copy it
    // archives carries it as overwrittenAt — so a resumed run stamps exactly what the first
    // delivery would have.
    editedAt: { type: Date, required: true },

    // The APPLY phase. 'open' is a queue session between steps.
    status: {
      type: String,
      enum: ['open', 'pending', 'running', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    queueJobId: { type: String, default: null },
    error: { type: String, default: null },
    // Queue mode: the position of the next frozen survey to show.
    cursor: { type: Number, default: 0 },
    progress: {
      done: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },

    // The UNDO phase, separate so "has an undo started?" is one field the resume CAS can read.
    undo: {
      status: { type: String, enum: ['pending', 'running', 'done', 'failed'], default: null },
      jobId: { type: String, default: null },
      // When the latest undo was asked for — an undo still `pending` 10 minutes later reads
      // "Waiting for the worker" and offers Start again.
      requestedAt: { type: Date, default: null },
      // Who asked for it — the History row names them, never the change's author: on a shared
      // campaign the admin who undoes is often not the one who edited.
      requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      startedAt: { type: Date, default: null },
      lastRunAt: { type: Date, default: null },
      error: { type: String, default: null },
      passes: { type: Number, default: 0 },
      // The last pass's outcome, STORED (§H2): the run card and Details read this, never the mere
      // presence of archive rows — a re-cut or an Erase removes rows without undoing anything.
      summary: {
        putBack: { type: Number, default: 0 },
        changedSince: { type: Number, default: 0 },
        restoredOnProfile: { type: Number, default: 0 },
        waiting: { type: Number, default: 0 },
        cleared: { type: Number, default: 0 },
        erased: { type: Number, default: 0 },
        gone: { type: Number, default: 0 },
        names: { type: [nameSchema], default: [] },
        namesTotal: { type: Number, default: 0 },
      },
    },

    // The sum of the chunks' counts (each chunk writes its own with its done flag, so a re-processed
    // chunk overwrites rather than adds).
    counts: {
      surveysTargeted: { type: Number, default: 0 },
      surveysChanged: { type: Number, default: 0 },
      // Changed between the review and the write (re-surveyed, edited): named, untouched.
      changedSinceReview: { type: Number, default: 0 },
      // No longer on file when the run reached it.
      notFound: { type: Number, default: 0 },
      // { reason: n } — surveys the plan left alone, by the first reason (answerEdit.js skips).
      skipped: { type: mongoose.Schema.Types.Mixed, default: {} },
      droppedFollowUps: { type: Number, default: 0 },
      endsScript: { type: Number, default: 0 },
      // { questionKey: { label, surveys } } — surveys changed per question (a queue session's
      // summary is built from it).
      byQuestion: { type: mongoose.Schema.Types.Mixed, default: {} },
      // Picks taken out and put in, per question and pick (an option id, or an old answer's text).
      byOption: {
        type: [
          {
            _id: false,
            questionKey: String,
            key: String,
            label: String,
            removed: { type: Number, default: 0 },
            added: { type: Number, default: 0 },
          },
        ],
        default: [],
      },
    },

    // Named examples behind the counts, capped — an admin acts on names, not totals.
    samples: { type: [nameSchema], default: [] },
    samplesTruncated: { type: Boolean, default: false },
    samplesTotal: { type: Number, default: 0 },

    // How many changed surveys Campaign History has reported. Each History write reports the rest
    // (CAS'd on this), so a run that stops part-way is logged when it stops, and again for what it
    // changes after Pick up — never twice for one survey.
    historyCount: { type: Number, default: 0 },

    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The runs list on the Door Outcomes page — newest first.
answerEditRunSchema.index({ campaignId: 1, createdAt: -1 });
// "Is a change already running on this campaign?" — the one-change-at-a-time check.
answerEditRunSchema.index({ organizationId: 1, status: 1 });

export const AnswerEditRun = mongoose.model('AnswerEditRun', answerEditRunSchema);
