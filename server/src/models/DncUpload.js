import mongoose from 'mongoose';

// Audit record for one do-not-contact list CSV upload — the unit of undo. Unlike VotedUpload
// there is NO campaignId: DNC is an org-wide, campaign-transcending fact on the Voter itself
// (Voter.doNotContact), so an upload flags voters wherever they live and its undo reverts only
// the rows it flagged (matched via Voter.doNotContact.uploadId — admin-set flags are never touched).
const dncUploadSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    fileName: { type: String, default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    totalRows: { type: Number, default: 0 },
    matched: { type: Number, default: 0 }, // voters newly flagged by this upload
    alreadyFlagged: { type: Number, default: 0 }, // matched but already flagged (skipped)
    notFound: { type: Number, default: 0 }, // ids with no voter anywhere in the org (→ pending)
    doorsDropped: { type: Number, default: 0 }, // households that became fully-DNC (all campaigns)
    // The state the list was declared for: the lookup runs inside that state's campaigns only,
    // because two states can issue the same digits (services/import/parseVoterIdList.js). Voters the
    // file named OUTSIDE that state were reported, not flagged — `outsideState` counts them.
    state: { type: String, default: null, uppercase: true, trim: true },
    outsideState: { type: Number, default: 0 },
    // Which column the list was matched on, and how many of its IDs matched a voter only under
    // another spelling (leading zeros ignored). Strict schema: undeclared fields drop silently.
    idColumn: { type: String, default: null },
    matchedViaZeros: { type: Number, default: 0 },
    undone: { type: Boolean, default: false },
    undoneAt: { type: Date, default: null },
  },
  { timestamps: true }
);

dncUploadSchema.index({ organizationId: 1, createdAt: -1 });

export const DncUpload = mongoose.model('DncUpload', dncUploadSchema);
