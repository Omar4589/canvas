import mongoose from 'mongoose';

// The FROZEN selection of an answer-edit run, in chunks — the companion-collection pattern
// (UnknockRunChunk, ClientReportMapPoint). Written by the create call, before anything is edited:
// each item is one survey as it was reviewed, so the run edits exactly what the admin saw priced,
// and a survey that changed in between is named rather than overwritten.
//
// campaignId and organizationId are REQUIRED: the delete cascades filter every model by them under
// strictQuery, and a model without the field would be swept with deleteMany({}) — every tenant's
// chunks at once (review round 2's blocker).
const itemSchema = new mongoose.Schema(
  {
    r: { type: mongoose.Schema.Types.ObjectId, required: true }, // the SurveyResponse id as reviewed
    h: { type: String, required: true }, // its fingerprint as reviewed (answerEdit.js)
    // The survey's SLOT. The writer and the undo find the live survey by {voterId, passId}, never
    // by `r`: a revert elsewhere (unknock, a conversion) or a restore into the gap re-creates it
    // under a new id, and Pick up after one of those must still find it.
    v: { type: mongoose.Schema.Types.ObjectId, required: true },
    p: { type: mongoose.Schema.Types.ObjectId, default: null },
    // The archive row of this run's edit once it LANDED on this survey (answerEditWriter.js). What
    // tells the undo a survey it can no longer find a row for was erased, restored on the profile or
    // cleared with a re-cut — rather than never changed — and what "12 of 30 done" counts.
    a: { type: mongoose.Schema.Types.ObjectId, default: undefined },
    // The undo PUT THIS SURVEY BACK (the copy id it put back, or whose receipt proved it): recorded
    // per item so the undo's count only grows, whatever happens to the survey afterwards (round 3).
    u: { type: mongoose.Schema.Types.ObjectId, default: undefined },
    // ...and that proof was the first build's (no receipt): its History row was written back then.
    l: { type: Boolean, default: undefined },
    // ...settled by the pass that finished the survey (its erased reading done): never read again (round 8).
    us: { type: Boolean, default: undefined },
    // A one-person session's survey: the questions its saves have counted, so a survey saved twice is
    // still one survey changed, and each question one survey (round 5). Question keys only.
    cq: { type: [String], default: undefined },
    // ...and every copy its saves made (one per save; `a` is the latest): the undo reads a survey as
    // erased only for a copy of THIS run that is gone (round 6 — it took any recent mark for this run's,
    // and a note-only profile edit whose copy was erased read a survey put back as erased).
    as: { type: [mongoose.Schema.Types.ObjectId], default: undefined },
  },
  { _id: false }
);

const answerEditRunChunkSchema = new mongoose.Schema(
  {
    runId: { type: mongoose.Schema.Types.ObjectId, ref: 'AnswerEditRun', required: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    seq: { type: Number, required: true },
    items: { type: [itemSchema], default: [] },
    // Written together with `counts` in ONE update, so a re-processed chunk replaces its own counts
    // instead of adding to them.
    done: { type: Boolean, default: false },
    counts: { type: mongoose.Schema.Types.Mixed, default: null },
    // The bulk done-write's revision: each delivery recounts the chunk from the database and writes
    // by compare-and-swap on this, re-reading on a miss, so a landed copy (`a`) another delivery
    // recorded is never written away (answerEditRuns.js runApply).
    countRev: { type: Number, default: undefined },
    // A one-person session's chunk is rewritten per step; two admins stepping one session at once
    // compare-and-swap on this so neither loses the other's step (code review 2026-10-19). Declared,
    // or strict mode would drop it from the filter and the swap would always win.
    stepRev: { type: Number, default: 0 },
    // Set by the undo before it reads this chunk: an apply delivery still running never rewrites
    // what the undo classified (answerEditRuns.js). Declared, or strict mode drops it from the filter.
    fenced: { type: Boolean, default: undefined },
  },
  { timestamps: true }
);

// The processor and the undo read a run's chunks in order; one chunk per (run, seq).
answerEditRunChunkSchema.index({ runId: 1, seq: 1 }, { unique: true });
// "Which runs' undos have reached this survey?" — a survey written back from an older copy takes
// their fences (answerEditWriter.js fencesForSlots). Partial: only fenced chunks are indexed.
answerEditRunChunkSchema.index(
  { campaignId: 1, 'items.v': 1 },
  { partialFilterExpression: { fenced: true } }
);

export const AnswerEditRunChunk = mongoose.model('AnswerEditRunChunk', answerEditRunChunkSchema);
export const ANSWER_EDIT_CHUNK_ITEMS = 500;
