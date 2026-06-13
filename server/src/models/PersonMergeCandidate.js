import mongoose from 'mongoose';

const { Schema } = mongoose;

// A pair of Persons that MIGHT be the same human but were not auto-merged (the
// matcher never merges across the uid/svid boundary, and never cross-links keyless
// rows). Surfaced to the super-admin for a manual merge/split decision.
// `personIdB` is null for single-person flags (keyless / state_missing).
const personMergeCandidateSchema = new Schema(
  {
    personIdA: { type: Schema.Types.ObjectId, ref: 'Person', required: true, index: true },
    personIdB: { type: Schema.Types.ObjectId, ref: 'Person', default: null }, // sorted A<B when both present
    reason: {
      type: String,
      enum: ['uid_svid_conflict', 'keyless', 'state_missing', 'manual'],
      required: true,
    },
    sampleUid: { type: String, default: null },
    sampleSvid: { type: String, default: null },
    sampleState: { type: String, default: null },
    status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Deterministic key so a re-run of the backfill (or repeated imports) never
// duplicates the same candidate.
personMergeCandidateSchema.index(
  { personIdA: 1, personIdB: 1, reason: 1 },
  { unique: true }
);

export const PersonMergeCandidate = mongoose.model('PersonMergeCandidate', personMergeCandidateSchema);
