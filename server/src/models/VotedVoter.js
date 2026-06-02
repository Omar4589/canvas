import mongoose from 'mongoose';

// A voter marked as "already voted" within a single campaign (early voting).
// Campaign-scoped on purpose: voters are shared org-wide, but a vote in one
// campaign must not bleed into another campaign/election. One row per voter per
// campaign; grouped by uploadId so an upload can be undone wholesale.
const votedVoterSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    voterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Voter', required: true, index: true },
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', default: null, index: true },
    stateVoterId: { type: String, required: true, trim: true },
    voteMethod: { type: String, default: null, trim: true },
    votedAt: { type: Date, default: Date.now },
    uploadId: { type: mongoose.Schema.Types.ObjectId, ref: 'VotedUpload', required: true, index: true },
  },
  { timestamps: true }
);

votedVoterSchema.index({ campaignId: 1, voterId: 1 }, { unique: true });

export const VotedVoter = mongoose.model('VotedVoter', votedVoterSchema);
