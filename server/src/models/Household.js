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
    addressLine1: { type: String, required: true, trim: true },
    addressLine2: { type: String, default: null, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true, uppercase: true },
    zipCode: { type: String, required: true, trim: true },

    normalizedAddress: { type: String, required: true, unique: true, index: true },

    location: { type: pointSchema, default: null },

    geocodeStatus: {
      type: String,
      enum: ['pending', 'success', 'failed'],
      default: 'pending',
      index: true,
    },
    geocodeProvider: {
      type: String,
      enum: ['census', 'mapbox', null],
      default: null,
    },
    geocodeRaw: { type: mongoose.Schema.Types.Mixed, default: null },

    status: {
      type: String,
      enum: ['unknocked', 'not_home', 'surveyed', 'wrong_address'],
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

export const Household = mongoose.model('Household', householdSchema);
