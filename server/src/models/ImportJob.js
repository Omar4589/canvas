import mongoose from 'mongoose';

const importJobSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true,
    },
    filename: { type: String, default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: {
      type: String,
      enum: ['pending', 'parsing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    totalRows: { type: Number, default: 0 },
    uniqueVoters: { type: Number, default: 0 },
    uniqueHouseholds: { type: Number, default: 0 },
    newVoters: { type: Number, default: 0 },
    updatedVoters: { type: Number, default: 0 },
    newHouseholds: { type: Number, default: 0 },
    duplicateStateVoterIds: { type: [String], default: [] },
    errors: { type: [mongoose.Schema.Types.Mixed], default: [] },
    errorCount: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const ImportJob = mongoose.model('ImportJob', importJobSchema);
