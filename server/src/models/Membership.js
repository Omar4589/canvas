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
      // 'lead' = team lead: a campaign-scoped admin whose authority is the set of
      // campaigns granted via CampaignManager. Additive enum — no migration needed.
      enum: ['admin', 'lead', 'canvasser'],
      required: true,
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
    // Only admins with this see the Billing surface (page, nav, cost view) — the
    // bill-payers, not every admin. Default false; the first admin seated at
    // provisioning gets true, and migrateBillingAccess grandfathers existing admins.
    billingAccess: { type: Boolean, default: false },
  },
  { timestamps: true }
);

membershipSchema.index({ userId: 1, organizationId: 1 }, { unique: true });
membershipSchema.index({ organizationId: 1, role: 1 });
membershipSchema.index({ organizationId: 1, coordinatorId: 1 });

export const Membership = mongoose.model('Membership', membershipSchema);
