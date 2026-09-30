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
    // The state the list that parked this ID was declared for (null for admin-set flags preserved
    // across a campaign delete, and for rows parked before the state scope existed). The graduation
    // job (services/dnc/reapplyDncLists.js) honors it: a parking stamped GA graduates only onto voters
    // in Georgia campaigns, because two states can issue the same digits; an unstamped one graduates
    // anywhere, as before. Recorded so the zero-insensitive graduation planned for after the 2026
    // election needs no backfill (docs/PROPOSAL_VOTER_ID_KEYS.md).
    state: { type: String, default: null, uppercase: true, trim: true },
    // Admin's original reason, carried so graduation restores it (uploads have none).
    reason: { type: String, default: null, trim: true },
  },
  { timestamps: true }
);

// Re-match lookup on import; (uploadId already indexed) for undo cleanup.
dncPendingIdSchema.index({ organizationId: 1, stateVoterId: 1 });

export const DncPendingId = mongoose.model('DncPendingId', dncPendingIdSchema);
