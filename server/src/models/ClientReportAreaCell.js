import mongoose from 'mongoose';

// One FROZEN area of an area-view client report: a fixed H3 hexagon (resolution 9 for small
// areas, 8 for large) with how many doors were reached there, how they went, and — only where the
// all-or-nothing rule allows (services/reports/areaCells.js) — single-choice answer counts. Never
// an address, a coordinate of a door, a voter or a canvasser. Written once per build, under the
// build's snapshotId; readers serve the report's live snapshot only.
//
// Every tenant id is DECLARED: strictQuery strips undeclared filter keys, so a cascade delete on an
// undeclared organizationId would match — and wipe — every cell of every organization.

const optionCountSchema = new mongoose.Schema(
  {
    option: { type: String, required: true }, // the canonical option label (publicPointAnswer)
    count: { type: Number, default: 0 },
  },
  { _id: false }
);

// One single-choice question's answers in this area. `n` = homes in the area that answered it.
// An array, not an object keyed by question or label: either can hold a '.' or start with '$'.
const cellAnswerSchema = new mongoose.Schema(
  {
    questionKey: { type: String, required: true },
    n: { type: Number, default: 0 },
    options: { type: [optionCountSchema], default: [] },
  },
  { _id: false }
);

const clientReportAreaCellSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    clientReportId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientReport', required: true },
    snapshotId: { type: mongoose.Schema.Types.ObjectId, required: true },
    h3: { type: String, required: true },
    // Doors reached in the area, and by status — shown for every area, even a one-home one.
    doors: { type: Number, default: 0 },
    byStatus: { type: mongoose.Schema.Types.Mixed, default: {} },
    answers: { type: [cellAnswerSchema], default: [] },
  },
  { timestamps: false }
);

// One row per area per build; a redelivered insert can never double a cell.
clientReportAreaCellSchema.index({ snapshotId: 1, h3: 1 }, { unique: true });
// The readers and every delete: a report's rows by snapshot.
clientReportAreaCellSchema.index({ clientReportId: 1, snapshotId: 1 });

export const ClientReportAreaCell = mongoose.model('ClientReportAreaCell', clientReportAreaCellSchema);
