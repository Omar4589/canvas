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
    color: { type: String, default: null },
    // Optional per-effort survey; falls back to Campaign.surveyTemplateId.
    // Only meaningful for survey-type campaigns (lit-drop efforts carry none).
    surveyTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'SurveyTemplate', default: null },
    // Audit only: which walk list seeded this effort's door-set. Ownership is
    // materialized on Household.effortId, NOT re-derived from this list.
    seededFromWalkListId: { type: mongoose.Schema.Types.ObjectId, ref: 'WalkList', default: null },
    status: {
      type: String,
      enum: ['draft', 'active', 'archived'],
      default: 'active',
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

effortSchema.index({ campaignId: 1, status: 1 });

export const Effort = mongoose.model('Effort', effortSchema);
