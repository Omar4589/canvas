import mongoose from 'mongoose';

// One queued export in the Export Center: requested by an admin/lead, built in the
// background on the worker dyno, downloadable until expiresAt, then swept (the artifact is
// deleted; this doc survives as the history row). The doc — not the HTTP response — is the
// durable record of rows/bytes/subjects, because middleware/accessLog.js can only count rows
// on a single buffered res.end and a streamed artifact download records rows:null.

// The canonical export-type keys. services/export/exportTypes.js keys its registry off this
// list (importing it from here avoids a model↔builder import cycle), and the DNC guard test
// iterates it so a new type is born covered.
export const EXPORT_TYPE_KEYS = [
  'canvass-activity',
  'doors-by-round',
  'survey-results',
  'survey-answers',
  'voter-file',
  'voters-filtered',
  'voter-notes',
  'full-backup',
];

const exportJobSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    // null = org-wide (full-backup only; admin-only by construction — a lead's history
    // filter is $in their managed campaigns, which never matches null).
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
    type: { type: String, enum: EXPORT_TYPE_KEYS, required: true },
    // Frozen, validated request snapshot: passId/effortId/userId/date window/filter JSON/
    // importJobId — plus anchorTz, resolved at POST time because the worker has no req and
    // must never fall back to UTC for the local Date/Time columns (docs/DATE_FILTERS.md).
    params: { type: mongoose.Schema.Types.Mixed, default: {} },

    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed', 'canceled', 'expired'],
      default: 'pending',
    },
    progress: { type: Number, default: 0 }, // 0-100
    processedRows: { type: Number, default: 0 },
    totalRowsEstimate: { type: Number, default: 0 }, // countDocuments up front; progress denominator

    // Per-file accounting (a full-backup ZIP holds several CSVs; a CSV export has one entry).
    files: { type: [{ name: String, rows: Number, _id: false }], default: [] },
    rowCount: { type: Number, default: 0 }, // total data rows across files
    bytes: { type: Number, default: 0 }, // stored artifact size
    // Honest-undercount disclosure: rows/identities withheld by the do-not-contact
    // exclusion, so the UI can explain why export totals can trail dashboard counts.
    excludedDncCount: { type: Number, default: 0 },
    // Survey rows whose voter doc no longer exists (import undo) — dropped, but counted,
    // for the same honesty reason.
    orphanedRows: { type: Number, default: 0 },

    artifact: {
      gridFsId: { type: mongoose.Schema.Types.ObjectId, default: null }, // nulled by the sweeper
      filename: { type: String, default: null },
      contentType: { type: String, default: null }, // 'text/csv; charset=utf-8' | 'application/zip'
    },

    // Record-level audit payload for GET /:id/download → addAuditSubjects: the ids ACTUALLY
    // written (post-DNC), capped at supportAccess's SUBJECT_CAP with the honest remainder.
    audit: {
      subjectType: { type: String, default: 'voter' },
      subjectIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
      subjectsTruncated: { type: Boolean, default: false },
      subjectsTotal: { type: Number, default: 0 },
    },

    error: { type: String, default: null },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    queueJobId: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    // Set on completion. Deliberately NOT a Mongo TTL index: TTL would delete this doc and
    // strand the GridFS artifact (and erase the history row). The sweeper in
    // services/export/sweepExpiredExports.js deletes the artifact and flips status instead.
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// History list, newest first (routes/admin/exports.js GET /).
exportJobSchema.index({ organizationId: 1, createdAt: -1 });
// Per-org active-job throttle count (POST /).
exportJobSchema.index({ organizationId: 1, status: 1 });
// Sweeper scan: completed jobs past their expiry.
exportJobSchema.index({ status: 1, expiresAt: 1 });

export const ExportJob = mongoose.model('ExportJob', exportJobSchema);
