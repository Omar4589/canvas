import mongoose from 'mongoose';
import { crewSourceSchema } from './CampaignAssignment.js';

// Audit trail of team (coordinator) reassignments — one row per change, so we keep a full
// history of who moved whose work between teams, from which coordinator to which, and how
// many ledger rows moved with them.
//
// This exists because a crew change — or coming back to a campaign — RE-STAMPS history: the current
// coordinator owns all of that canvasser's doors (see services/memberships/restampCoordinator.js). A
// by-team number can therefore move without anyone knocking a door, and "why did Asa's team drop by
// 3,907?" has to be answerable after the fact.
//
// A crew job (services/memberships/setCoordinator.js) writes its record with its token as the _id, so
// a finish that runs twice, or two writers racing on one job, still leave one row: _id is unique
// already, and no other index is needed.
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
      enum: ['admin_users', 'lead_crew', 'member_create', 'repair', 'campaign_join'],
      required: true,
    },
    activitiesMoved: { type: Number, default: 0 },
    surveysMoved: { type: Number, default: 0 },
    // Set when the crew landed but the ledger re-stamp didn't finish (it threw, timed out, or lost its
    // hold). Without it a torn write leaves no trace anywhere and "the number moved less than the
    // preview said" becomes unexplainable. The job stays on the roster row, and Finish it on the
    // person's panel completes it and clears this.
    restampError: { type: String, default: null },
    // Every team the moved rows came from (crewSourceSchema). History says "Several teams" when there
    // is more than one; fromCoordinatorId is the single one, or the previous crew when none moved.
    sources: { type: [crewSourceSchema], default: undefined },
    // The doors (knocks, deduplicated) the change's check showed — what "N doors moved" means. The
    // activity count above is rows, which include notes and restricted marks.
    doorsMoved: { type: Number, default: undefined },
    // The crew job's run that last wrote this record (crewJob.run).
    run: { type: String, default: undefined },
    // An error record a later change finished: History stops showing it as incomplete.
    finishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'CoordinatorChange', default: null },
  },
  { timestamps: true }
);

coordinatorChangeSchema.index({ organizationId: 1, createdAt: -1 }); // "what happened in my org?"
coordinatorChangeSchema.index({ campaignId: 1, createdAt: -1 }); // "why did THIS campaign's team move?"
coordinatorChangeSchema.index({ userId: 1, createdAt: -1 }); // "why did this person's doors move?"

export const CoordinatorChange = mongoose.model('CoordinatorChange', coordinatorChangeSchema);
