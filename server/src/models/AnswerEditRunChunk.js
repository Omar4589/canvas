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
  },
  { timestamps: true }
);

// The processor and the undo read a run's chunks in order; one chunk per (run, seq).
answerEditRunChunkSchema.index({ runId: 1, seq: 1 }, { unique: true });

export const AnswerEditRunChunk = mongoose.model('AnswerEditRunChunk', answerEditRunChunkSchema);
export const ANSWER_EDIT_CHUNK_ITEMS = 500;
