import mongoose from 'mongoose';

// A canvassing ROUND within an effort. One-way lifecycle (decision 10):
// draft -> active -> archived, never reopened; roundNumber auto-increments per
// EFFORT and is never reused; the name is free-form. At most one round is active
// per effort (a campaign can have several active rounds — one per active effort).
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
    // The effort this round belongs to. The round's door-set is the effort's
    // owned households (Household.effortId), not walkListId (which is retired).
    effortId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Effort',
      required: true,
      index: true,
    },
    roundNumber: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    // Deprecated: door-set now comes from the effort's owned households. Kept on
    // existing docs for history; new rounds leave it null.
    walkListId: { type: mongoose.Schema.Types.ObjectId, ref: 'WalkList', default: null },
    // Optional targeting for a follow-up round: a walk-list-shaped filter
    // (knock status + survey answers) the cut was restricted to, scoped to this
    // round's effort. null/empty = the full effort universe. Stored for
    // reproducibility + a round label. Resolution lives in resolveWalkList.
    targetFilter: { type: mongoose.Schema.Types.Mixed, default: null },
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
    // Advisory lock so concurrent discard/restore re-cuts can't interleave.
    recutLock: {
      lockedAt: { type: Date, default: null },
      lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
  },
  { timestamps: true }
);

passSchema.index({ effortId: 1, roundNumber: 1 }, { unique: true }); // roundNumber resets per effort
passSchema.index({ campaignId: 1, status: 1 });
passSchema.index({ effortId: 1, status: 1 });

export const Pass = mongoose.model('Pass', passSchema);
