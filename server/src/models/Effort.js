import mongoose from 'mongoose';

// A first-class canvassing EFFORT within a campaign — e.g. "North Dallas" or
// "Volunteer crew". An effort owns a DISJOINT set of households (the source of
// truth is Household.effortId), an optional survey override, and a team
// (EffortMember). Its Rounds are Pass docs (Pass.effortId); a Pass is still the
// cut/assign/billing unit. Efforts within a campaign never share a door.
const effortSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    // Optional per-effort survey; falls back to Campaign.surveyTemplateId.
    // Only meaningful for survey-type campaigns (lit-drop efforts carry none).
    surveyTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'SurveyTemplate', default: null },
    // Audit only: which SAVED SEARCH seeded this effort's door-set. Ownership is
    // materialized on Household.effortId, NOT re-derived from this list. (Field name
    // kept as seededFromWalkListId for back-compat; it refs the SavedSearch model.)
    seededFromWalkListId: { type: mongoose.Schema.Types.ObjectId, ref: 'SavedSearch', default: null },
    status: {
      type: String,
      enum: ['draft', 'active', 'archived'],
      default: 'active',
      index: true,
    },
    // Who archived it and when (services/passes/passLifecycle.js). Cleared on unarchive — the
    // campaign History keeps both. Null on walk lists archived before these fields existed.
    archivedAt: { type: Date, default: null },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // The live pass the CURRENT archive ended, so Unarchive can offer to bring it back. Read only
    // while the walk list is archived; each archive rewrites it, unarchive clears it.
    endedPassId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pass', default: null },
    // Serializes every lifecycle write across ALL passes of this walk list — archive, unarchive,
    // archive / bring back / activate a pass, and the deletes — which per-pass recut locks can't
    // (two passes, two locks). Compare-and-set with Pass.recutLock's staleness rule.
    lifecycleLock: {
      lockedAt: { type: Date, default: null },
      token: { type: String, default: null },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

effortSchema.index({ campaignId: 1, status: 1 });

export const Effort = mongoose.model('Effort', effortSchema);
