import mongoose from 'mongoose';

const campaignAssignmentSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
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
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assignedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

campaignAssignmentSchema.index({ campaignId: 1, userId: 1 }, { unique: true });
campaignAssignmentSchema.index({ userId: 1, organizationId: 1 });

export const CampaignAssignment = mongoose.model('CampaignAssignment', campaignAssignmentSchema);
