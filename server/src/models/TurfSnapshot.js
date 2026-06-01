import mongoose from 'mongoose';

// A reversible snapshot of a pass's book layout (+ assignments, + optionally the
// knock history that was cleared) captured immediately BEFORE a destructive
// discard / re-cut, so an admin can undo a mistake. Books are stored as plain
// data (NOT live Turf _ids); restore recreates fresh Turf docs and re-maps
// assignments by book index. Cleared knocks are stored verbatim for exact restore.
const snapBookSchema = new mongoose.Schema(
  {
    name: String,
    mode: String,
    params: mongoose.Schema.Types.Mixed,
    boundary: mongoose.Schema.Types.Mixed,
    centroid: mongoose.Schema.Types.Mixed,
    householdIds: [mongoose.Schema.Types.ObjectId],
    doorCount: Number,
    status: String,
  },
  { _id: false }
);

const snapAssignmentSchema = new mongoose.Schema(
  {
    bookIndex: Number, // index into books[]
    userId: mongoose.Schema.Types.ObjectId,
    assignedBy: mongoose.Schema.Types.ObjectId,
    assignedAt: Date,
  },
  { _id: false }
);

const turfSnapshotSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    passId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pass', required: true, index: true },
    reason: { type: String, enum: ['discard', 'recut'], default: 'discard' },

    books: { type: [snapBookSchema], default: [] },
    assignments: { type: [snapAssignmentSchema], default: [] },

    // Verbatim knock history (only when the admin chose to also clear knocks).
    clearedKnocks: { type: Boolean, default: false },
    activities: { type: [mongoose.Schema.Types.Mixed], default: [] },
    responses: { type: [mongoose.Schema.Types.Mixed], default: [] },

    bookCount: { type: Number, default: 0 },
    knockCount: { type: Number, default: 0 },
    restoredAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

turfSnapshotSchema.index({ passId: 1, createdAt: -1 });

export const TurfSnapshot = mongoose.model('TurfSnapshot', turfSnapshotSchema);
