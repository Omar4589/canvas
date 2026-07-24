import mongoose from 'mongoose';

// A stateVoterId whose do-not-contact request has no live Voter row to sit on. Two sources:
// a DNC list upload whose id did NOT match any voter at upload time, and a campaign deletion
// that removed the LAST row of a flagged person (uploadId then carries the flag's original
// attribution — null for an admin-set flag). Kept so the request is "sticky": when that voter
// is later imported, the regular-import path graduates the pending id onto the real Voter row
// with the original source/attribution, so a do-not-contact request made before the voter
// (re-)entered the universe is still honored. Org-wide (no campaignId) — DNC transcends
// campaigns. Deleted when the id graduates, or when its upload is undone.
const dncPendingIdSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    // null = admin-set flag preserved across a campaign delete (no upload to attribute to).
    uploadId: { type: mongoose.Schema.Types.ObjectId, ref: 'DncUpload', default: null, index: true },
    stateVoterId: { type: String, required: true, trim: true },
    // Admin's original reason, carried so graduation restores it (uploads have none).
    reason: { type: String, default: null, trim: true },
  },
  { timestamps: true }
);

// Re-match lookup on import; (uploadId already indexed) for undo cleanup.
dncPendingIdSchema.index({ organizationId: 1, stateVoterId: 1 });

export const DncPendingId = mongoose.model('DncPendingId', dncPendingIdSchema);
