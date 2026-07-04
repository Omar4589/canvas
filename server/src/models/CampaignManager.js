import mongoose from 'mongoose';

// A team LEAD's grant to manage a specific campaign — the store behind the
// campaign-scoped "lead" role. Deliberately SEPARATE from CampaignAssignment
// (the walker roster) so a lead can MANAGE a campaign without walking it, and
// can also be a walker on it independently. A lead's authority is exactly the
// set of campaigns they hold a grant for (see services/authz/campaignManagement).
const campaignManagerSchema = new mongoose.Schema(
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
    grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    grantedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

campaignManagerSchema.index({ campaignId: 1, userId: 1 }, { unique: true });
campaignManagerSchema.index({ userId: 1, organizationId: 1 });

export const CampaignManager = mongoose.model('CampaignManager', campaignManagerSchema);
