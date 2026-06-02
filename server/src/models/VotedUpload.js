import mongoose from 'mongoose';

// Audit record for one "voted list" CSV upload — the unit of undo. Its
// VotedVoter rows reference it via uploadId.
const votedUploadSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    fileName: { type: String, default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    totalRows: { type: Number, default: 0 },
    matched: { type: Number, default: 0 }, // voters newly marked by this upload
    alreadyVoted: { type: Number, default: 0 }, // matched but already marked (skipped)
    notFound: { type: Number, default: 0 }, // ids not in this campaign's pool
    doorsDropped: { type: Number, default: 0 }, // households that became fully-voted
    undone: { type: Boolean, default: false },
    undoneAt: { type: Date, default: null },
  },
  { timestamps: true }
);

votedUploadSchema.index({ campaignId: 1, createdAt: -1 });

export const VotedUpload = mongoose.model('VotedUpload', votedUploadSchema);
