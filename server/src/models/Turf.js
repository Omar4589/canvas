import mongoose from 'mongoose';

const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: undefined },
  },
  { _id: false }
);

const polygonSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Polygon'], default: 'Polygon' },
    coordinates: { type: [[[Number]]], default: undefined },
  },
  { _id: false }
);

// A "book": an ordered, walkable set of households within a pass. householdIds
// is ordered (= the walk sequence). boundary is a display-only concave hull.
const turfSchema = new mongoose.Schema(
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
    passId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Pass',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    mode: { type: String, enum: ['attribute', 'geometric', 'manual'], required: true },
    params: { type: mongoose.Schema.Types.Mixed, default: {} },
    boundary: { type: polygonSchema, default: null },
    centroid: { type: pointSchema, default: null },
    householdIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'Household', default: [] },
    doorCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
      index: true,
    },
    generationJobId: { type: String, default: null },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

turfSchema.index({ campaignId: 1, passId: 1 });
turfSchema.index({ passId: 1, householdIds: 1 }); // submit-time "which turf is this household in"
turfSchema.index({ boundary: '2dsphere' });
turfSchema.index({ centroid: '2dsphere' });

export const Turf = mongoose.model('Turf', turfSchema);
