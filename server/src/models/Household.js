import mongoose from 'mongoose';

const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: undefined },
  },
  { _id: false }
);

const householdSchema = new mongoose.Schema(
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

    addressLine1: { type: String, required: true, trim: true },
    addressLine2: { type: String, default: null, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true, uppercase: true },
    zipCode: { type: String, required: true, trim: true },
    county: { type: String, default: null, trim: true },

    normalizedAddress: { type: String, required: true, index: true },

    location: { type: pointSchema, default: null },

    status: {
      type: String,
      enum: ['unknocked', 'not_home', 'surveyed', 'wrong_address', 'lit_dropped'],
      default: 'unknocked',
      index: true,
    },
    isActive: { type: Boolean, default: true },

    lastActionAt: { type: Date, default: null },
    lastActionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Denormalized cut attributes (turf-cutting). *Value = modal voter value;
    // cutConflicts flags attributes where the household's voters disagree.
    precinctValue: { type: String, default: null },
    congressionalValue: { type: String, default: null },
    stateSenateValue: { type: String, default: null },
    stateHouseValue: { type: String, default: null },
    cityValue: { type: String, default: null },
    zipValue: { type: String, default: null },
    countyValue: { type: String, default: null },
    cutConflicts: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Which EFFORT owns this door (null = Intake — newly imported / unassigned,
    // not yet canvassable). Source of truth for door ownership + per-effort
    // coverage; a door belongs to at most one effort (disjointness).
    effortId: { type: mongoose.Schema.Types.ObjectId, ref: 'Effort', default: null, index: true },

    // Turf membership mirror (set by turf generation / edits).
    turfId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turf', default: null },
    walkOrder: { type: Number, default: null },

    // Early voting: true when EVERY voter at this address has already voted, so
    // the door drops off the canvasser's map/books (recomputed on voted-import).
    fullyVoted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

householdSchema.index({ location: '2dsphere' });
householdSchema.index({ campaignId: 1, normalizedAddress: 1 }, { unique: true });
householdSchema.index({ campaignId: 1, precinctValue: 1 });
householdSchema.index({ campaignId: 1, countyValue: 1 });
householdSchema.index({ campaignId: 1, cityValue: 1 });
householdSchema.index({ turfId: 1, walkOrder: 1 });
householdSchema.index({ campaignId: 1, effortId: 1 }); // per-effort ownership / coverage / intake

export const Household = mongoose.model('Household', householdSchema);
