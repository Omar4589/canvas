import mongoose from 'mongoose';

const { Schema } = mongoose;

// An audit + undo record for every merge/split. Captures full pre-merge snapshots
// of BOTH persons and which Voters moved, so a split is a true value-level inverse
// and a bad merge is auditable and reversible.
const fieldDecisionSchema = new Schema(
  {
    field: { type: String, required: true },
    chosenValue: { type: Schema.Types.Mixed, default: null },
    losingValue: { type: Schema.Types.Mixed, default: null },
    fromPersonId: { type: Schema.Types.ObjectId, ref: 'Person', default: null },
  },
  { _id: false }
);

const personMergeLogSchema = new Schema(
  {
    survivorId: { type: Schema.Types.ObjectId, ref: 'Person', required: true, index: true },
    victimId: { type: Schema.Types.ObjectId, ref: 'Person', default: null },
    action: { type: String, enum: ['merge', 'split'], required: true },
    byUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    survivorSnapshot: { type: Schema.Types.Mixed, default: () => ({}) },
    victimSnapshot: { type: Schema.Types.Mixed, default: () => ({}) },
    movedVoterIds: { type: [Schema.Types.ObjectId], default: [] },
    fieldDecisions: { type: [fieldDecisionSchema], default: [] },
  },
  { timestamps: true }
);

export const PersonMergeLog = mongoose.model('PersonMergeLog', personMergeLogSchema);
