import mongoose from 'mongoose';

// An admin/canvasser note about a voter. Org-level on purpose: the note is about the person and
// follows them across campaigns (voters are org-scoped). Distinct from canvass-activity and survey
// notes, which are produced in the field and shown read-only on the profile.
const voterNoteSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    voterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Voter', required: true, index: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    body: { type: String, required: true, trim: true },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

voterNoteSchema.index({ voterId: 1, createdAt: -1 });

export const VoterNote = mongoose.model('VoterNote', voterNoteSchema);
