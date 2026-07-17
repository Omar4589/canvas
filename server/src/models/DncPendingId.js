import mongoose from 'mongoose';

// A stateVoterId from a do-not-contact list upload that did NOT match any voter in the org at
// upload time. Kept so the request is "sticky": when that voter is later imported, the
// regular-import path graduates the pending id onto the real Voter row (source:'upload', with
// this upload's attribution), so a do-not-contact request made before the voter entered the
// universe is still honored. Org-wide (no campaignId) — DNC transcends campaigns. Deleted when
// the id graduates, or when its upload is undone.
const dncPendingIdSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    uploadId: { type: mongoose.Schema.Types.ObjectId, ref: 'DncUpload', required: true, index: true },
    stateVoterId: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

// Re-match lookup on import; (uploadId already indexed) for undo cleanup.
dncPendingIdSchema.index({ organizationId: 1, stateVoterId: 1 });

export const DncPendingId = mongoose.model('DncPendingId', dncPendingIdSchema);
