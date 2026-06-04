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
    // Re-housing audit: voters whose household changed, and doors emptied + deactivated by it.
    movedVoters: { type: Number, default: 0 },
    deactivatedDoors: { type: Number, default: 0 },
    // Households the incoming voters lived at BEFORE this import (captured pre-apply).
    // Persisted so a BullMQ retry — which would re-read post-move state — still knows
    // which doors to re-check for emptiness. Source of retry-safe orphan deactivation.
    sourceHouseholdIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'Household', default: [] },
    duplicateStateVoterIds: { type: [String], default: [] },
    errors: { type: [mongoose.Schema.Types.Mixed], default: [] },
    errorCount: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    // Async queue execution (M1).
    progress: { type: Number, default: 0 },
    processedRows: { type: Number, default: 0 },
    queueJobId: { type: String, default: null },
    // Column mapping used for this import (resolved canonical -> vendor column).
    importProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'ImportProfile', default: null },
    fieldMapping: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

export const ImportJob = mongoose.model('ImportJob', importJobSchema);
