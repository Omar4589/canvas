import mongoose from 'mongoose';

// Audit trail of team (coordinator) reassignments — one row per change, so we keep a full
// history of who moved whose work between teams, from which coordinator to which, and how
// many ledger rows moved with them.
//
// This exists because a coordinator change now RE-STAMPS history: the current coordinator owns
// all of that canvasser's doors (see services/memberships/restampCoordinator.js). A by-team
// number can therefore move without anyone knocking a door, and "why did Asa's team drop by
// 3,907?" has to be answerable after the fact.
//
// Deliberately NOT AccessLog: that collection is scoped to platform staff reading customer
// content under a support grant, and carries an owner-decided keep-forever policy tied to
// published Privacy Policy text. A customer's own admin reorganizing their own crews is not
// vendor access, and logging it there would bury the signal AccessLog exists to carry.
const coordinatorChangeSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    // WHICH campaign's crew moved. A crew is per-campaign, so "why did this team's number move?"
    // is only answerable per campaign. Not `required`, because rows written before crews became
    // per-campaign have no campaign to name and must stay readable — absent means "org-wide, under
    // the old model", which is the honest reading of them.
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // whose coordinator changed
    // null is a REAL value on both sides ("No coordinator"), the same way it is on the ledger —
    // hence nullable ObjectIds rather than a sentinel string.
    fromCoordinatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    toCoordinatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // the actor
    source: {
      type: String,
      enum: ['admin_users', 'lead_crew', 'member_create', 'repair'],
      required: true,
    },
    activitiesMoved: { type: Number, default: 0 },
    surveysMoved: { type: Number, default: 0 },
    // Set when the Membership write landed but the ledger re-stamp threw. Without it a torn
    // write leaves no trace anywhere and "the number moved less than the preview said" becomes
    // unexplainable. Re-running the same assignment (or repair:team-stamps) converges.
    restampError: { type: String, default: null },
  },
  { timestamps: true }
);

coordinatorChangeSchema.index({ organizationId: 1, createdAt: -1 }); // "what happened in my org?"
coordinatorChangeSchema.index({ campaignId: 1, createdAt: -1 }); // "why did THIS campaign's team move?"
coordinatorChangeSchema.index({ userId: 1, createdAt: -1 }); // "why did this person's doors move?"

export const CoordinatorChange = mongoose.model('CoordinatorChange', coordinatorChangeSchema);
