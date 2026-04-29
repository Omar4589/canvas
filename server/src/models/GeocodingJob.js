import mongoose from 'mongoose';

const geocodingJobSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['census', 'mapbox'], required: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    totalHouseholds: { type: Number, default: 0 },
    processedHouseholds: { type: Number, default: 0 },
    matched: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    errors: { type: [mongoose.Schema.Types.Mixed], default: [] },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const GeocodingJob = mongoose.model('GeocodingJob', geocodingJobSchema);
