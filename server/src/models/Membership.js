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
      enum: ['admin', 'canvasser', 'client'],
      required: true,
    },
    // Only meaningful when role === 'client': the campaign(s) whose PUBLISHED client
    // reports this client may read. Empty for admins/canvassers. Org-level membership is
    // NOT enough for a client (an org holds many clients' campaigns) — every client
    // request is additionally scoped to this allow-list. See requireClientCampaignAccess.
    clientCampaignIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' }],
      default: [],
    },
    isActive: { type: Boolean, default: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // The admin (in this same org) who oversees this member. Used to group
    // canvassers under a team lead / coordinator. null = no coordinator.
    coordinatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // null = the user hasn't yet seen the "you were added to this org" banner;
    // a timestamp = they dismissed it. Existing rows are backfilled to createdAt
    // (see migrateAckMemberships.js) so we don't banner-spam current members.
    acknowledgedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

membershipSchema.index({ userId: 1, organizationId: 1 }, { unique: true });
membershipSchema.index({ organizationId: 1, role: 1 });
membershipSchema.index({ organizationId: 1, coordinatorId: 1 });
// "Which clients can see campaign X" (admin client-access management) + multikey scope.
membershipSchema.index({ organizationId: 1, role: 1, clientCampaignIds: 1 });

export const Membership = mongoose.model('Membership', membershipSchema);
