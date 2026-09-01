// A user-actionable export failure ("that import was undone — nothing to reconstruct"),
// as opposed to an infrastructure fault. Routes 400 it at validation time; the processor
// writes .message verbatim onto ExportJob.error (no stack — the admin reads this string).
export class ExportUserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExportUserError';
    this.isExportUserError = true;
  }
}

// The fanned canvass-activity estimate hit its maxTimeMS (exportBuilders countCanvassActivityRows).
// Only the estimate catches it — it answers with the floor count instead — the worker never sets
// a cap, so a build can never see one.
export class EstimateTimeout extends Error {
  constructor() {
    super('estimate timed out');
    this.name = 'EstimateTimeout';
    this.isEstimateTimeout = true;
  }
}
