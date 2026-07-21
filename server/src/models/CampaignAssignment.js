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
    // The crew (coordinator) this person belongs to IN THIS CAMPAIGN.
    //
    // It lives here, not on Membership, because a crew is a per-campaign fact: the same canvasser
    // can work two races under two different coordinators, and a lead reorganizing their crew in
    // one campaign must not move a door in another. Membership is unique on {userId,
    // organizationId} — one slot — so two leads doing their jobs normally used to overwrite each
    // other, and the re-stamp then dragged the first campaign's history onto the second lead's team.
    //
    // Read at KNOCK TIME ONLY, to freeze the team onto the new ledger row (routes/mobile/canvass.js).
    // Past attribution is never re-derived from here — it lives on the frozen stamp, which is what
    // lets a departed coordinator's team keep the doors it supervised (the 104-door fix). That
    // containment is also why it is safe for this row to be hard-deleted when somebody is removed
    // from the campaign: they cannot knock this campaign any more, and their history is already told.
    //
    // null is a REAL value ("no crew"), not "unset" — a candidate knocking their own district, an
    // admin who parachutes onto a book. See services/reports/aggregations.js.
    coordinatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

campaignAssignmentSchema.index({ campaignId: 1, userId: 1 }, { unique: true });
campaignAssignmentSchema.index({ userId: 1, organizationId: 1 });
// "Who is on this crew, in this campaign?" — the roster grouping and the per-campaign lead set.
campaignAssignmentSchema.index({ campaignId: 1, coordinatorId: 1 });

export const CampaignAssignment = mongoose.model('CampaignAssignment', campaignAssignmentSchema);
