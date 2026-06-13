import mongoose from 'mongoose';

// A reusable, per-org field-mapping for a given vendor export (i360, L2, a state
// file, etc). `mapping` maps our canonical field names -> the vendor's column
// header, e.g. { firstName: 'First Name', latitude: 'p_Latitude', stateVoterId: 'State Voter ID' }.
const importProfileSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    mapping: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Vendor namespace for this profile's `uid` column (e.g. 'i360'). Only when set
    // is a row's uid used as a cross-org Person match key — this prevents two
    // vendors' colliding ids from merging different people. Null = uid is stored
    // but not used for cross-org matching.
    uidSource: { type: String, default: null, trim: true },
    isBuiltIn: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

importProfileSchema.index({ organizationId: 1, name: 1 }, { unique: true });

export const ImportProfile = mongoose.model('ImportProfile', importProfileSchema);
