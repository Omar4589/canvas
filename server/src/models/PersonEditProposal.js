import mongoose from 'mongoose';

const { Schema } = mongoose;

// A proposed change to a Person's shared identity made by an org that does NOT own
// the canonical record (or by an import row that diverges from canonical). Held
// for super-admin review. `baseIdentityVersion` + `canonicalSnapshot` let approval
// detect that the Person drifted since the proposal was filed.
const personEditProposalSchema = new Schema(
  {
    personId: { type: Schema.Types.ObjectId, ref: 'Person', required: true, index: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    source: { type: String, enum: ['admin_edit', 'import'], required: true },
    fields: { type: Schema.Types.Mixed, default: () => ({}) }, // field -> proposed value
    canonicalSnapshot: { type: Schema.Types.Mixed, default: () => ({}) }, // canonical values at filing time
    baseIdentityVersion: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'superseded'],
      default: 'pending',
    },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

personEditProposalSchema.index({ status: 1, personId: 1 });

export const PersonEditProposal = mongoose.model('PersonEditProposal', personEditProposalSchema);
