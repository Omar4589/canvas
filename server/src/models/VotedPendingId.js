import mongoose from 'mongoose';

// A stateVoterId from a voted-list upload that did NOT match a voter in the campaign at upload
// time (the voter wasn't in the universe yet). Kept so early voting is "sticky": when that voter
// is later imported, the regular-import path graduates the pending id into a real VotedVoter row,
// so a door whose occupants all actually voted doesn't wrongly re-open. Deleted when the id
// graduates, or when its upload is undone.
const votedPendingIdSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    uploadId: { type: mongoose.Schema.Types.ObjectId, ref: 'VotedUpload', required: true, index: true },
    stateVoterId: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

// Re-match lookup on import; (uploadId already indexed) for undo cleanup.
votedPendingIdSchema.index({ campaignId: 1, stateVoterId: 1 });

export const VotedPendingId = mongoose.model('VotedPendingId', votedPendingIdSchema);
