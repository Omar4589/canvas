import mongoose from 'mongoose';

// An org-level tag in the managed library (Phase 3.1). Survey options reference a tag
// by its canonical display `name` (a plain string on the option), and THIS collection is
// the managed picklist + the target of rename/merge/delete. `normalizedName`
// (trim+lowercase, see services/surveys/tags.js normalizeTag) is the dedupe key — the
// unique (organizationId, normalizedName) index makes duplicate tags structurally
// impossible. `color` is reserved for a future colored-chip UI. See docs/SURVEYS.md.
const tagSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true },
    color: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

tagSchema.index({ organizationId: 1, normalizedName: 1 }, { unique: true });

export const Tag = mongoose.model('Tag', tagSchema);
