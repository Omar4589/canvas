import mongoose from 'mongoose';

// A saved, named, FROZEN selection of voters/households from a campaign's pool.
// The `filter` is kept for reference/reproducibility; the frozen householdIds/
// voterIds are the source of truth (decision 8 — lists do not re-resolve).
const answerFilterSchema = new mongoose.Schema(
  {
    questionKey: { type: String, required: true },
    values: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { _id: false }
);

const filterSchema = new mongoose.Schema(
  {
    // Demographics
    genders: { type: [String], default: undefined },
    parties: { type: [String], default: undefined },
    precincts: { type: [String], default: undefined },
    congressionalDistricts: { type: [String], default: undefined },
    stateSenateDistricts: { type: [String], default: undefined },
    stateHouseDistricts: { type: [String], default: undefined },
    cities: { type: [String], default: undefined },
    zips: { type: [String], default: undefined },
    counties: { type: [String], default: undefined },
    ageMin: { type: Number, default: null },
    ageMax: { type: Number, default: null },
    // Prior-round canvassing state
    priorPassId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pass', default: null },
    priorPassStatuses: { type: [String], default: undefined },
    surveyResponse: { type: String, enum: ['any', 'exists', 'not_exists'], default: 'any' },
    answerFilters: { type: [answerFilterSchema], default: [] },
    combine: { type: String, enum: ['and', 'or'], default: 'and' },
  },
  { _id: false }
);

const walkListSchema = new mongoose.Schema(
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
    filter: { type: filterSchema, default: () => ({}) },
    // Frozen snapshot of the resolved set.
    householdIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'Household', default: [] },
    voterIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'Voter', default: [] },
    householdCount: { type: Number, default: 0 },
    voterCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

walkListSchema.index({ campaignId: 1, createdAt: -1 });

export const WalkList = mongoose.model('WalkList', walkListSchema);
