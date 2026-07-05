import mongoose from 'mongoose';

// A saved, named, FROZEN selection of voters/households from a campaign's pool — the thing
// users see as a "Saved search". The `filter` is kept for reference/reproducibility; the frozen
// householdIds/voterIds are the source of truth (decision 8 — lists do not re-resolve).
//
// NAMING: this model was formerly `WalkList`. It was renamed to `SavedSearch` because that's what
// it actually is, and because the user-facing "Walk List" is the *Effort* model (see Effort.js) —
// having a `WalkList` model that ISN'T the user's walk list was a persistent trap. The DB
// collection is deliberately PINNED to `walklists` below, so this is a code-only rename with NO
// data migration. (Historical wire names — the `/walklists` route, the `walkLists` response key,
// and Effort.seededFromWalkListId — are likewise retained for compatibility.)
const answerFilterSchema = new mongoose.Schema(
  {
    questionKey: { type: String, required: true },
    values: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { _id: false }
);

// A survey-tag predicate: every option carrying `tag` (across questions) OR'd together.
const tagFilterSchema = new mongoose.Schema({ tag: { type: String, required: true } }, { _id: false });

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
    answerTagFilters: { type: [tagFilterSchema], default: [] },
    combine: { type: String, enum: ['and', 'or'], default: 'and' },
  },
  { _id: false }
);

const savedSearchSchema = new mongoose.Schema(
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
    // How this list was built: 'filter' (the demographic/geo builder) or 'csv' (an
    // uploaded Voter-ID list matched by stateVoterId). The frozen householdIds/voterIds
    // are the source of truth either way; sourceMeta is provenance for the UI/audit only.
    source: { type: String, enum: ['filter', 'csv'], default: 'filter' },
    sourceMeta: {
      fileName: { type: String, default: null },
      idColumn: { type: String, default: null },
      idsInFile: { type: Number, default: 0 },
      matchedVoters: { type: Number, default: 0 },
      notFound: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

savedSearchSchema.index({ campaignId: 1, createdAt: -1 });

// Third arg pins the collection to `walklists` (was auto-derived from the old model name) so the
// rename needs no data migration.
export const SavedSearch = mongoose.model('SavedSearch', savedSearchSchema, 'walklists');
