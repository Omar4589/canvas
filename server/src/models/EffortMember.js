import mongoose from 'mongoose';

// Roster membership: which canvassers belong to an EFFORT (the "North crew" /
// "volunteer team"). Persists across the effort's rounds; per-round book
// assignment (TurfAssignment) still decides who walks which book each round.
const effortMemberSchema = new mongoose.Schema(
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
    effortId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Effort',
      required: true,
      index: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

effortMemberSchema.index({ effortId: 1, userId: 1 }, { unique: true });
effortMemberSchema.index({ userId: 1, campaignId: 1 });

export const EffortMember = mongoose.model('EffortMember', effortMemberSchema);
