import mongoose from 'mongoose';

// One team a person's moving rows are stamped with, as a crew job planned it
// (services/memberships/restampCoordinator.js planSources): its rows on each ledger, its doors (knocks,
// deduplicated — the number a person sees) and its latest row, so the newest team can be named first.
export const crewSourceSchema = new mongoose.Schema(
  {
    coordinatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    activities: { type: Number, default: 0 },
    surveys: { type: Number, default: 0 },
    doors: { type: Number, default: 0 },
    latest: { type: Date, default: null },
  },
  { _id: false }
);

// A crew change in progress, kept ON the roster row it changes (services/memberships/setCoordinator.js).
// One conditional write sets the crew and this together, so there is never a note without a change or
// a change without a note. Present while a change runs, and after a cut-off one until Finish it.
//   token — the job, and its CoordinatorChange record's _id
//   run   — this attempt at the job: the first run and each Finish it get a fresh one, and every
//           renewal and the release check it, so a stalled earlier run can't carry on
//   until — the hold; another change waits ("busy") until it has passed
const crewJobSchema = new mongoose.Schema(
  {
    token: { type: mongoose.Schema.Types.ObjectId, required: true },
    run: { type: String, required: true },
    until: { type: Date, required: true },
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sources: { type: [crewSourceSchema], default: undefined },
    activities: { type: Number, default: 0 },
    surveys: { type: Number, default: 0 },
    doors: { type: Number, default: 0 },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    source: { type: String, default: null },
  },
  { _id: false }
);

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
    // Read at KNOCK TIME to freeze the team onto the new ledger row (routes/mobile/canvass.js).
    // Past attribution is never re-derived from here — it lives on the frozen stamp, which is what
    // lets a departed coordinator's team keep the doors it supervised (the 104-door fix). That
    // containment is also why it is safe for this row to be hard-deleted when somebody is removed
    // from the campaign: they cannot knock this campaign any more, and their history is already told.
    //
    // null is a REAL value ("no crew"), not "unset" — a candidate knocking their own district, an
    // admin who parachutes onto a book. See services/reports/aggregations.js.
    coordinatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // The crew change running or left unfinished on this row (crewJobSchema above). `default:
    // undefined` is load-bearing: a nested object would plant `crewJob: {}` on every roster create, and
    // an undeclared path would be stripped from the claim's filter under strictQuery, so a second
    // claim during the hold would match. "A job is on the row" means crewJob.token is set.
    crewJob: { type: crewJobSchema, default: undefined },
  },
  { timestamps: true }
);

campaignAssignmentSchema.index({ campaignId: 1, userId: 1 }, { unique: true });
campaignAssignmentSchema.index({ userId: 1, organizationId: 1 });
// "Who is on this crew, in this campaign?" — the roster grouping and the per-campaign lead set.
campaignAssignmentSchema.index({ campaignId: 1, coordinatorId: 1 });

export const CampaignAssignment = mongoose.model('CampaignAssignment', campaignAssignmentSchema);
