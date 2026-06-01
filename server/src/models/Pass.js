import mongoose from 'mongoose';

// A canvassing round over a campaign. One-way lifecycle (decision 10):
// draft -> active -> archived, never reopened; roundNumber auto-increments and
// is never reused; the name is free-form. Only one pass is active at a time.
const passSchema = new mongoose.Schema(
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
    roundNumber: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    walkListId: { type: mongoose.Schema.Types.ObjectId, ref: 'WalkList', default: null },
    status: {
      type: String,
      enum: ['draft', 'active', 'archived'],
      default: 'draft',
      index: true,
    },
    // Half-open attribution windows depend on activatedAt being monotonic.
    activatedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

passSchema.index({ campaignId: 1, roundNumber: 1 }, { unique: true });
passSchema.index({ campaignId: 1, status: 1 });

export const Pass = mongoose.model('Pass', passSchema);
