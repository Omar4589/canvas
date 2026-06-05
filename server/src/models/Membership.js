import mongoose from 'mongoose';

const membershipSchema = new mongoose.Schema(
  {
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
    role: {
      type: String,
      enum: ['admin', 'canvasser'],
      required: true,
    },
    isActive: { type: Boolean, default: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // null = the user hasn't yet seen the "you were added to this org" banner;
    // a timestamp = they dismissed it. Existing rows are backfilled to createdAt
    // (see migrateAckMemberships.js) so we don't banner-spam current members.
    acknowledgedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

membershipSchema.index({ userId: 1, organizationId: 1 }, { unique: true });
membershipSchema.index({ organizationId: 1, role: 1 });

export const Membership = mongoose.model('Membership', membershipSchema);
