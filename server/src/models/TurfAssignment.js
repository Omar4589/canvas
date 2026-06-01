import mongoose from 'mongoose';

// Many-to-many: multiple canvassers per book, many books per canvasser.
// Mirrors the CampaignAssignment pattern. campaignId/passId are denormalized
// from the turf for fast bootstrap/matrix lookups.
const turfAssignmentSchema = new mongoose.Schema(
  {
    turfId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Turf',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    passId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pass', required: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assignedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

turfAssignmentSchema.index({ turfId: 1, userId: 1 }, { unique: true });
turfAssignmentSchema.index({ userId: 1, passId: 1 }); // hot bootstrap path
turfAssignmentSchema.index({ campaignId: 1, passId: 1 });

export const TurfAssignment = mongoose.model('TurfAssignment', turfAssignmentSchema);
