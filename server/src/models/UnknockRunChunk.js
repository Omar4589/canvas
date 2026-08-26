import mongoose from 'mongoose';

// The frozen originals of an UNKNOCK run, in chunks — the companion-collection pattern
// (models/ClientReportMapPoint.js, and the reason SurveyConversionRun refuses to hold a manifest
// at all).
//
// WHY NOT AN ARRAY ON THE RUN: an unknock is capped at 25,000 entries, and a CanvassActivity row
// carries a note of up to 2,000 characters plus an embedded `replaced` snapshot with its own
// location subdoc. SurveyConversionRun's header rejects even a bare ID list at that scale as
// "megabytes of BSON"; whole documents are an order of magnitude worse and would breach the 16MB
// cap on a large run — the one run most worth being able to undo.
//
// Chunked rather than one-doc-per-row: a run is written and read whole, so ~500 rows per chunk
// keeps the document count sane while leaving every chunk far under the cap.
const unknockRunChunkSchema = new mongoose.Schema(
  {
    runId: { type: mongoose.Schema.Types.ObjectId, ref: 'UnknockRun', required: true },
    // Denormalized so the delete cascades can sweep by campaign without joining the run.
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    seq: { type: Number, required: true },
    // Verbatim .lean() CanvassActivity documents, _ids included — restored with a raw driver
    // insertMany so they come back byte-exact (the services/turf/snapshot.js rule).
    rows: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // The VISITS these rows belonged to — `${householdId}|${passId ?? 'null'}|${userId}`, the
    // doorKey format. Indexed and searchable, which `rows` (Mixed) is not, so an offline replay
    // can ask "was this visit struck?" in one lookup. See the tombstone guard in
    // routes/mobile/canvass.js.
    visitKeys: { type: [String], default: [] },
    // The instant the run froze these rows. A replay recorded BEFORE this is the struck visit
    // arriving late; one recorded after is new work and is always let through.
    frozenAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// Revert reads a run's chunks in order.
unknockRunChunkSchema.index({ runId: 1, seq: 1 });
// The offline-replay tombstone probe: "did an unknock strike this visit?" Multikey on visitKeys,
// campaign-scoped so it never scans another campaign's runs. DISTINCT key shape from the index
// above — buildIndexes.js diffs by key shape alone.
unknockRunChunkSchema.index({ campaignId: 1, visitKeys: 1 });

export const UnknockRunChunk = mongoose.model('UnknockRunChunk', unknockRunChunkSchema);
export const UNKNOCK_CHUNK_ROWS = 500;
