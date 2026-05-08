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
  },
  { timestamps: true }
);

householdSchema.index({ location: '2dsphere' });
householdSchema.index({ campaignId: 1, normalizedAddress: 1 }, { unique: true });

export const Household = mongoose.model('Household', householdSchema);
